import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant, getActiveBrandId } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AIRouterService } from '@/services/ai/AIRouterService';
import { learnedStrategyBlock } from '@/services/watch/learning';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const schema = z.object({
  brief: z.string().min(1).max(4000),
  subject: z.string().max(300).optional(),
});

/**
 * POST /api/outreach/generate-email — génère un email HTML complet (autonome,
 * CSS inline-compatible, aux couleurs de la marque active) à partir d'un brief.
 * Jamais de mock : si aucun fournisseur IA réel ne répond, erreur explicite.
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const { brief, subject } = schema.parse(await req.json());

  const brandId = await getActiveBrandId(ctx.organizationId);
  const brand = brandId
    ? await db.brand.findFirst({ where: { id: brandId }, include: { profile: true } })
    : null;
  const p = brand?.profile;

  const brandBlock = brand
    ? [
        `Marque : ${brand.name}`,
        p?.slogan ? `Slogan : ${p.slogan}` : null,
        brand.description ? `Description : ${brand.description}` : null,
        p?.mission ? `Mission : ${p.mission}` : null,
        p?.audienceTarget ? `Audience : ${p.audienceTarget}` : null,
        p?.toneOfVoice ? `Ton : ${p.toneOfVoice}` : null,
        p?.primaryColor ? `Couleur principale : ${p.primaryColor}` : null,
        p?.secondaryColor ? `Couleur secondaire : ${p.secondaryColor}` : null,
        p?.accentColor ? `Couleur d'accent : ${p.accentColor}` : null,
        p?.wordsToUse?.length ? `Vocabulaire à utiliser : ${p.wordsToUse.join(', ')}` : null,
        p?.wordsToAvoid?.length ? `À éviter : ${p.wordsToAvoid.join(', ')}` : null,
        (p?.importantLinks as { label?: string; url?: string }[] | undefined)?.length
          ? `Liens : ${(p!.importantLinks as { label?: string; url?: string }[])
              .map((l) => `${l.label ?? ''} ${l.url ?? ''}`.trim()).join(' · ')}`
          : null,
      ].filter(Boolean).join('\n')
    : 'Aucune marque active — style sobre et professionnel.';

  const result = await AIRouterService.generateTextForTask('TEXT_EMAIL', {
    prompt:
      `Brief de l'email : ${brief}\n` +
      (subject ? `Objet prévu : ${subject}\n` : '') +
      `\nContexte de marque :\n${brandBlock}${await learnedStrategyBlock(ctx.organizationId)}`,
    systemPrompt:
      `Tu es un designer d'emails marketing. Génère un email HTML COMPLET et autonome, en français (vouvoiement), ` +
      `prêt à envoyer tel quel via Gmail.\n` +
      `Règles STRICTES :\n` +
      `- Document complet : <!DOCTYPE html><html>…</html>, tout le CSS dans un <style> du <head> plus styles inline sur les blocs clés (compatibilité clients mail).\n` +
      `- Largeur max 640px centrée, design moderne : header avec nom de marque, hero coloré (dégradé des couleurs de la marque), sections claires, bouton CTA (lien mailto: ou URL du contexte), signature et footer avec coordonnées + lien "Se désabonner" (href="#").\n` +
      `- AUCUNE image externe (pas de <img> vers des fichiers locaux ou inexistants) — utilise couleurs, typographie et les icônes ci-dessous.\n` +
      `- Icônes : JAMAIS d'emojis colorés. Utilise uniquement ces glyphes unicode monochromes en présentation texte (suffixe &#xFE0E;), teintés de la couleur principale de la marque via style inline — ex. <span style="color:#0052CC;font-family:Inter,'Segoe UI Symbol','Noto Sans Symbols 2','Apple Symbols',sans-serif;">&#x2726;&#xFE0E;</span> :\n` +
      `  ✎ design graphique · ▣ UI/UX · ◇ 3D · ✦ IA · ⚙ robotique/automatisation · ⌨ développement web · ▦ design system/parcours · ✒ Illustrator · ⊞ Canva/Figma · ◎ parcours UX · ◉ prototypage · ◈ impression 3D · ○ Blender · ≋ scan 3D/IoT · ✶ découpe laser · ✧ Midjourney · ◌ ChatGPT · ⊙ Arduino · ⌘ électronique · ▤ WordPress · ϟ JavaScript.\n` +
      `- Utilise {{nom}} là où le nom du destinataire doit apparaître (ex. "Bonjour {{nom}},").\n` +
      `- Aucun texte inventé engageant : pas de chiffres de clientèle, pas de témoignage nominatif, pas d'approbation officielle.\n` +
      `- Réponds UNIQUEMENT avec le code HTML, sans balises markdown, sans commentaire avant ou après.`,
    language: 'fr',
    maxTokens: 8000,
  });

  if (result.mocked) {
    return ok(
      { error: 'Aucun fournisseur IA disponible (Claude/GPT/Gemini) — vérifie les clés API.' },
      { status: 502 },
    );
  }

  // Certains modèles enveloppent quand même dans ```html … ```.
  const html = result.text.replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  if (!/<html/i.test(html)) {
    return ok({ error: `Le modèle n'a pas produit de HTML complet (${result.provider}).` }, { status: 502 });
  }
  return ok({ html, provider: result.provider });
});
