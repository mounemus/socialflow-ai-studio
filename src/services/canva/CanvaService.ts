/**
 * CanvaService — connects Canva API when credentials available, otherwise falls back to manual mode.
 *
 * MANUAL FALLBACK MODE (default for MVP):
 *   - User pastes a Canva URL → stored in CanvaDesign.canvaUrl
 *   - User uploads a Canva export (PNG/PDF) → stored as MediaAsset
 *   - User attaches the link/file to a Post manually
 *
 * REAL API MODE (when CANVA_CLIENT_ID + CANVA_CLIENT_SECRET present and ENABLE_CANVA_API=true):
 *   - OAuth flow with PKCE: see https://www.canva.dev/docs/connect/api-reference/authentication/
 *   - Endpoints used (subject to Canva approval per app review): designs, exports, brand templates.
 *
 * LIMITATIONS (documented for the user):
 *   1. Canva Connect API requires app submission + review for distribution.
 *   2. Some scopes (design:write, brand_template:read) require enterprise tier on Canva side.
 *   3. There is NO public API to render/preview a design instantly server-side without an export job.
 *   4. Export is async — we poll with a BullMQ job (max 60s).
 *   5. Brand kit access (for templates per brand) requires Canva for Teams / Enterprise.
 */

import { db } from '@/lib/db';
import { ExternalApiError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { CanvaConnectService } from '@/services/integrations/CanvaConnectService';

const CANVA_API_BASE = 'https://api.canva.com/rest/v1';

export interface CanvaDesignSummary {
  id: string;
  title?: string;
  url: string;
  previewUrl?: string;
  format?: string;
  source: 'canva-api' | 'manual-link' | 'manual-upload';
}

export interface CreateFromTemplateInput {
  brandId: string;
  templateUrl: string;
  title?: string;
  brief?: string;
}

export interface AttachDesignInput {
  postId: string;
  organizationId: string;
  canvaUrl: string;
  brandId?: string;
  previewUrl?: string;
}

export const CanvaService = {
  isApiEnabled(): boolean {
    return CanvaConnectService.isConfigured();
  },

  async hasActiveConnection(organizationId: string): Promise<boolean> {
    const token = await CanvaConnectService.getValidAccessToken(organizationId);
    return !!token;
  },

  /**
   * Get OAuth start URL. User clicks → Canva consent → /api/canva/callback.
   */
  buildOAuthUrl(state: string): string | null {
    if (!this.isApiEnabled()) return null;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.CANVA_CLIENT_ID!,
      redirect_uri: process.env.CANVA_REDIRECT_URI ?? '',
      scope: 'design:meta:read design:content:read asset:read',
      state,
    });
    return `https://www.canva.com/api/oauth/authorize?${params.toString()}`;
  },

  /**
   * List designs from Canva API. Returns empty list in manual mode.
   * Caller should also query DB for manually-linked designs.
   */
  async listCanvaDesigns(organizationId: string): Promise<CanvaDesignSummary[]> {
    const dbDesigns = await db.canvaDesign.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const manualList: CanvaDesignSummary[] = dbDesigns.map((d) => ({
      id: d.id,
      title: d.format ?? 'Canva design',
      url: d.canvaUrl,
      previewUrl: d.previewUrl ?? undefined,
      format: d.format ?? undefined,
      source: 'manual-link',
    }));

    try {
      const token = await CanvaConnectService.getValidAccessToken(organizationId);
      if (token) {
        const live = await CanvaConnectService.listDesigns(organizationId, 30);
        const liveList: CanvaDesignSummary[] = live.map((d: { id: string; title?: string; urls?: { edit_url?: string; view_url?: string }; thumbnail?: { url?: string } }) => ({
          id: d.id,
          title: d.title ?? 'Untitled',
          url: d.urls?.edit_url ?? d.urls?.view_url ?? '',
          previewUrl: d.thumbnail?.url,
          source: 'canva-api',
        }));
        return [...liveList, ...manualList];
      }
    } catch (err) {
      logger.warn('Canva live fetch failed, fallback to manual only', { err: (err as Error).message });
    }
    return manualList;
  },

  /**
   * Create a design from a brand template URL.
   * In manual mode: opens Canva in a new tab; we just store the resulting URL when user pastes it back.
   */
  async createFromTemplate(input: CreateFromTemplateInput, organizationId: string): Promise<CanvaDesignSummary> {
    if (!this.isApiEnabled()) {
      // Manual flow → just record the template URL as a starting point.
      const created = await db.canvaDesign.create({
        data: {
          organizationId,
          brandId: input.brandId,
          canvaUrl: input.templateUrl,
          format: input.title ?? 'template',
          metadata: { brief: input.brief ?? null, mode: 'manual' },
        },
      });
      return {
        id: created.id,
        title: input.title,
        url: created.canvaUrl,
        source: 'manual-link',
      };
    }
    throw new ExternalApiError('canva', 'createFromTemplate real API not implemented yet');
  },

  /**
   * Attach a Canva design (link or upload) to a Post.
   * Works fully in manual mode.
   */
  async attachDesignToPost(input: AttachDesignInput): Promise<void> {
    const post = await db.post.findFirst({
      where: { id: input.postId, organizationId: input.organizationId },
    });
    if (!post) throw new NotFoundError('Post not found');

    await db.canvaDesign.create({
      data: {
        organizationId: input.organizationId,
        brandId: input.brandId ?? post.brandId,
        postId: post.id,
        canvaUrl: input.canvaUrl,
        previewUrl: input.previewUrl,
        metadata: { mode: this.isApiEnabled() ? 'api' : 'manual' },
      },
    });
    await db.post.update({
      where: { id: post.id },
      data: { status: 'DESIGN_LINKED' },
    });
  },

  /**
   * Produce an AI brief that the user can paste into Canva to guide their design.
   * This works without any Canva API at all.
   */
  generateCanvaBrief(args: {
    brandName: string;
    format: string;
    topic: string;
    tone?: string;
    audience?: string;
    cta?: string;
    primaryColor?: string;
    visualStyle?: string;
  }): string {
    return [
      `# Brief Canva — ${args.brandName}`,
      ``,
      `**Format:** ${args.format}`,
      `**Sujet:** ${args.topic}`,
      args.audience ? `**Audience:** ${args.audience}` : null,
      args.tone ? `**Ton visuel:** ${args.tone}` : null,
      args.cta ? `**Call to action:** ${args.cta}` : null,
      args.primaryColor ? `**Couleur principale:** ${args.primaryColor}` : null,
      args.visualStyle ? `**Style visuel:** ${args.visualStyle}` : null,
      ``,
      `## Composition recommandée`,
      `- Titre fort en 4-7 mots, en haut`,
      `- Sous-titre/contexte 1 ligne`,
      `- Visuel ou illustration centrée`,
      `- CTA visible en bas`,
      `- Logo de la marque discret en coin`,
      ``,
      `## Conseils`,
      `- Garder un contraste élevé pour la lisibilité mobile`,
      `- Réserver la zone "safe" de chaque plateforme`,
      `- Exporter en PNG haute résolution + carrousel si besoin`,
    ]
      .filter(Boolean)
      .join('\n');
  },

  async getDesignPreview(designId: string): Promise<string | null> {
    const d = await db.canvaDesign.findUnique({ where: { id: designId } });
    return d?.previewUrl ?? null;
  },

  handleApiError(err: unknown, context: string): never {
    logger.error('CanvaService error', { context, err: (err as Error).message });
    throw new ExternalApiError('canva', (err as Error).message);
  },

  /**
   * Quick check: does this brand have a CanvaTemplate linked?
   * Used by AIRouter to decide whether to include Canva in the variants chain.
   */
  async hasTemplateForBrand(brandId: string): Promise<boolean> {
    if (!brandId) return false;
    const count = await db.canvaTemplate.count({ where: { brandId } });
    return count > 0;
  },

  /**
   * Pick the first CanvaTemplate linked to a brand.
   * Returns null when no template is configured for the brand.
   */
  async findTemplateForBrand(brandId: string) {
    if (!brandId) return null;
    return db.canvaTemplate.findFirst({
      where: { brandId },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Create a design from a brand template. When the live Canva Connect API is
   * available + the org has an active token, we call it; otherwise we degrade
   * to a deterministic mock that still persists a CanvaDesign row so the rest
   * of the pipeline (UI, scheduling, MediaAsset) keeps working.
   *
   * Returns the same shape regardless of mode: { id, editUrl, thumbnailUrl }.
   */
  async createDesignFromBrandTemplate(args: {
    templateId: string;
    organizationId: string;
    brandId?: string | null;
    variables?: {
      title?: string;
      body?: string;
      hashtags?: string[];
      image?: string;
      [k: string]: string | string[] | undefined;
    };
  }): Promise<{ id: string; editUrl: string; thumbnailUrl: string; mocked: boolean }> {
    const template = await db.canvaTemplate.findUnique({ where: { id: args.templateId } });
    if (!template) {
      throw new NotFoundError(`CanvaTemplate ${args.templateId} not found`);
    }

    const editUrl = template.canvaUrl;
    let thumbnailUrl = template.previewUrl ?? '';
    const mocked = true;
    const externalDesignId: string | undefined = undefined;

    if (this.isApiEnabled()) {
      try {
        const token = await CanvaConnectService.getValidAccessToken(args.organizationId);
        if (token) {
          // NOTE: real Canva Connect "create design from brand template" requires
          // enterprise scopes + the brand_template_id (NOT the URL). When/if those
          // are configured upstream, we'd call CanvaConnectService.createDesignFromTemplate.
          // For now we keep the mock path so the rest of the pipeline doesn't break.
          logger.info('CanvaService.createDesignFromBrandTemplate: token present but live API not wired — using mock fallback', {
            templateId: args.templateId,
          });
        }
      } catch (err) {
        logger.warn('CanvaService.createDesignFromBrandTemplate live API failed → mock', {
          err: (err as Error).message,
        });
      }
    }

    // Deterministic mock fallback — persist a CanvaDesign so the UI can link/open it.
    const created = await db.canvaDesign.create({
      data: {
        organizationId: args.organizationId,
        brandId: args.brandId ?? template.brandId,
        templateId: template.id,
        canvaDesignId: externalDesignId,
        canvaUrl: editUrl,
        previewUrl: thumbnailUrl || null,
        format: template.format ?? null,
        metadata: {
          mode: mocked ? 'mock' : 'api',
          variables: args.variables ?? {},
          templateName: template.name,
          producedAt: new Date().toISOString(),
          via: 'createDesignFromBrandTemplate',
        } as never,
      },
    });

    // If no preview URL on the template, synthesize a placeholder so the UI
    // doesn't render an empty <img>.
    if (!thumbnailUrl) {
      const label = encodeURIComponent(args.variables?.title?.slice(0, 40) ?? template.name ?? 'Canva');
      thumbnailUrl = `https://placehold.co/1024x1024/0ea5e9/ffffff/png?text=${label}`;
    }

    return {
      id: created.id,
      editUrl,
      thumbnailUrl,
      mocked,
    };
  },
};
