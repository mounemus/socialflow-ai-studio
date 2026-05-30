/**
 * GeminiService — uses Google Gemini for what it's BEST at:
 *
 *   1. VISION (multimodal): analyze images natively
 *   2. LONG CONTEXT (1M+ tokens): digest entire orgs' content at once
 *   3. GROUNDING (Google Search): real-time facts + citations
 *
 * Strategic positioning:
 *   - Claude (Anthropic) = agentic reasoning, tool use, code
 *   - GPT (OpenAI) = creative writing, structured outputs
 *   - Gemini = vision, long context, real-time grounding
 *
 * We route requests to Gemini specifically when these capabilities matter.
 */
import { ExternalApiError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

// Latest stable models as of 2026
const MODEL_TEXT = process.env.GEMINI_TEXT_MODEL ?? 'gemini-2.5-flash';
const MODEL_VISION = process.env.GEMINI_VISION_MODEL ?? 'gemini-2.5-flash';
const MODEL_PRO = process.env.GEMINI_PRO_MODEL ?? 'gemini-2.5-pro';

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } };

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      webSearchQueries?: string[];
    };
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

function getKey(): string {
  const key = process.env.GOOGLE_GEMINI_API_KEY;
  if (!key) throw new ExternalApiError('gemini', 'GOOGLE_GEMINI_API_KEY missing');
  return key;
}

async function callGemini(model: string, body: Record<string, unknown>): Promise<GeminiResponse> {
  const key = getKey();
  const res = await fetch(`${GEMINI_API}/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new ExternalApiError('gemini', `${res.status} ${txt.slice(0, 300)}`);
  }
  return res.json();
}

function extractText(response: GeminiResponse): string {
  return response.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

export const GeminiService = {
  isConfigured(): boolean {
    return !!process.env.GOOGLE_GEMINI_API_KEY;
  },

  // ============================================================================
  // TEXT (basic)
  // ============================================================================
  async generateText(opts: {
    prompt: string;
    systemInstruction?: string;
    maxTokens?: number;
    temperature?: number;
    usePro?: boolean;
  }): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
    const start = Date.now();
    const response = await callGemini(opts.usePro ? MODEL_PRO : MODEL_TEXT, {
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
      systemInstruction: opts.systemInstruction ? { parts: [{ text: opts.systemInstruction }] } : undefined,
      generationConfig: {
        maxOutputTokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.7,
      },
    });
    const text = extractText(response);
    logger.info('Gemini.generateText', { model: opts.usePro ? MODEL_PRO : MODEL_TEXT, ms: Date.now() - start });
    return {
      text,
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    };
  },

  // ============================================================================
  // IMAGE GENERATION — Gemini 2.0 flash image generation ("nanobanana") / Imagen
  // ============================================================================
  /**
   * Generate an image via Google's image-gen model.
   * Uses gemini-2.0-flash-exp-image-generation by default; can be overridden with
   * 'imagen-3.0-generate-002' for higher-quality output (where the key allows it).
   *
   * Falls back to a placeholder URL if the API key is missing or the call fails.
   */
  async generateImage(opts: {
    prompt: string;
    aspectRatio?: '1:1' | '4:5' | '9:16' | '16:9';
    styleHint?: string;
    model?: 'gemini-2.5-flash-image-preview' | 'imagen-3.0-generate-002' | 'imagen-4.0-generate-preview-06-06';
  }): Promise<{ url: string; mocked: boolean; model: string }> {
    if (!this.isConfigured()) {
      logger.warn('Gemini.generateImage: missing key, mocking');
      return {
        url: `https://placehold.co/1024x1024/png?text=${encodeURIComponent(opts.prompt.slice(0, 40))}`,
        mocked: true,
        model: 'mock',
      };
    }

    const finalPrompt = opts.styleHint ? `${opts.prompt}\n\nStyle: ${opts.styleHint}` : opts.prompt;
    const key = getKey();

    // Try models in priority order. The experimental flash-exp model is gone for
    // most keys; gemini-2.5-flash-image-preview ("Nano Banana") is the new public one,
    // and imagen-3.0-generate-002 is the stable fallback.
    const modelsToTry: string[] = opts.model
      ? [opts.model]
      : ['gemini-2.5-flash-image-preview', 'imagen-3.0-generate-002'];

    let lastError = '';
    for (const model of modelsToTry) {
      try {
        // imagen-* models use the predict API with a different schema; gemini-*
        // image-preview uses the generateContent API with responseModalities.
        const isImagen = model.startsWith('imagen-');
        const url = isImagen
          ? `${GEMINI_API}/models/${model}:predict?key=${key}`
          : `${GEMINI_API}/models/${model}:generateContent?key=${key}`;
        const body = isImagen
          ? {
              instances: [{ prompt: finalPrompt }],
              parameters: {
                sampleCount: 1,
                aspectRatio: opts.aspectRatio ?? '1:1',
              },
            }
          : {
              contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
              generationConfig: {
                responseModalities: ['IMAGE', 'TEXT'],
                temperature: 0.8,
              },
            };

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const txt = await res.text();
          lastError = `${model} ${res.status} ${txt.slice(0, 200)}`;
          continue; // try next model
        }

        const data = (await res.json()) as {
          // imagen response shape
          predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
          // gemini response shape
          candidates?: Array<{
            content?: {
              parts?: Array<{
                text?: string;
                inlineData?: { mimeType?: string; data?: string };
              }>;
            };
          }>;
        };

        // Try imagen-style response first
        const pred = data.predictions?.[0];
        if (pred?.bytesBase64Encoded) {
          return {
            url: `data:${pred.mimeType ?? 'image/png'};base64,${pred.bytesBase64Encoded}`,
            mocked: false,
            model,
          };
        }

        // Then gemini-style response
        const parts = data.candidates?.[0]?.content?.parts ?? [];
        for (const p of parts) {
          if (p.inlineData?.data) {
            const mime = p.inlineData.mimeType ?? 'image/png';
            return {
              url: `data:${mime};base64,${p.inlineData.data}`,
              mocked: false,
              model,
            };
          }
        }
        lastError = `${model} returned no image bytes`;
      } catch (err) {
        lastError = `${model}: ${(err as Error).message}`;
      }
    }

    logger.warn('Gemini.generateImage exhausted all models', { lastError });
    throw new ExternalApiError('gemini', lastError || 'all image models failed');
  },

  // ============================================================================
  // VISION (multimodal) — Gemini's strongest unique capability
  // ============================================================================
  async analyzeImage(opts: {
    imageUrl?: string;
    imageBase64?: string;
    mimeType?: string;
    prompt: string;
    structured?: boolean;
  }): Promise<{ text: string; parsed?: unknown }> {
    if (!opts.imageUrl && !opts.imageBase64) {
      throw new Error('Either imageUrl or imageBase64 required');
    }

    let inlinePart: GeminiPart;
    if (opts.imageBase64) {
      inlinePart = {
        inlineData: {
          mimeType: opts.mimeType ?? 'image/png',
          data: opts.imageBase64.replace(/^data:[^;]+;base64,/, ''),
        },
      };
    } else {
      // Fetch URL → base64 (Gemini needs inline data for public URLs)
      const r = await fetch(opts.imageUrl!);
      if (!r.ok) throw new ExternalApiError('gemini', `Cannot fetch image: ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get('content-type') ?? opts.mimeType ?? 'image/png';
      inlinePart = { inlineData: { mimeType: mime, data: buf.toString('base64') } };
    }

    const response = await callGemini(MODEL_VISION, {
      contents: [{ role: 'user', parts: [inlinePart, { text: opts.prompt }] }],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.4,
        responseMimeType: opts.structured ? 'application/json' : 'text/plain',
      },
    });

    const text = extractText(response);
    let parsed: unknown;
    if (opts.structured) {
      try {
        parsed = JSON.parse(text);
      } catch { /* ignore */ }
    }
    return { text, parsed };
  },

  // ============================================================================
  // LONG CONTEXT — digest entire corpora
  // ============================================================================
  async longContextAnalysis(opts: {
    documents: Array<{ title?: string; content: string }>;
    prompt: string;
    usePro?: boolean;
  }): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
    const combined = opts.documents
      .map((d, i) => `<<<DOCUMENT ${i + 1}${d.title ? ` — ${d.title}` : ''}>>>\n${d.content}\n<<<END DOCUMENT ${i + 1}>>>`)
      .join('\n\n');
    return this.generateText({
      prompt: `${opts.prompt}\n\n${combined}`,
      maxTokens: 4096,
      usePro: opts.usePro ?? combined.length > 30_000,
    });
  },

  // ============================================================================
  // GROUNDED RESEARCH — Google Search integration
  // ============================================================================
  async groundedResearch(opts: {
    query: string;
    maxResults?: number;
  }): Promise<{ text: string; sources: Array<{ uri: string; title: string }>; queriesRun: string[] }> {
    const response = await callGemini(MODEL_TEXT, {
      contents: [{ role: 'user', parts: [{ text: opts.query }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.4,
      },
    });

    const text = extractText(response);
    const meta = response.candidates?.[0]?.groundingMetadata;
    const sources: Array<{ uri: string; title: string }> = (meta?.groundingChunks ?? [])
      .map((c) => ({ uri: c.web?.uri ?? '', title: c.web?.title ?? c.web?.uri ?? '' }))
      .filter((s) => s.uri)
      .slice(0, opts.maxResults ?? 10);
    const queriesRun = meta?.webSearchQueries ?? [];

    return { text, sources, queriesRun };
  },

  // ============================================================================
  // HIGH-LEVEL: brand visual audit (vision-powered)
  // ============================================================================
  async brandVisualAudit(opts: {
    brandName: string;
    primaryColor?: string;
    visualStyle?: string;
    imageUrl: string;
  }): Promise<{
    overallScore: number;
    colorMatch: number;
    styleMatch: number;
    issues: string[];
    suggestions: string[];
  }> {
    const prompt = `Tu es un brand strategist senior. Analyse cette image par rapport à la charte de la marque "${opts.brandName}".

Charte:
- Couleur principale: ${opts.primaryColor ?? 'non définie'}
- Style visuel: ${opts.visualStyle ?? 'non défini'}

Évalue:
1. Conformité couleur (0-100)
2. Conformité style (0-100)
3. Score global (0-100)
4. Issues détectées (liste précise)
5. Suggestions concrètes pour mieux respecter la charte

Réponds UNIQUEMENT en JSON valide:
{
  "overallScore": 0-100,
  "colorMatch": 0-100,
  "styleMatch": 0-100,
  "issues": ["..."],
  "suggestions": ["..."]
}`;

    const { parsed, text } = await this.analyzeImage({
      imageUrl: opts.imageUrl,
      prompt,
      structured: true,
    });
    if (parsed && typeof parsed === 'object') {
      return parsed as never;
    }
    // Fallback parse
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch { /* ignore */ }
    }
    return { overallScore: 0, colorMatch: 0, styleMatch: 0, issues: ['Parse failed'], suggestions: [] };
  },

  // ============================================================================
  // HIGH-LEVEL: daily intelligence brief (long-context)
  // ============================================================================
  async dailyIntelligenceBrief(opts: {
    brandContext: { name: string; industry?: string | null; toneOfVoice?: string | null };
    trendItems: Array<{ title: string; summary?: string | null; url?: string | null; score?: number }>;
    competitorPosts: Array<{ competitor: string; caption?: string; postedAt?: Date | null }>;
    recentPosts: Array<{ title?: string | null; body?: string | null; impressions?: number; engagement?: number }>;
  }): Promise<{
    summary: string;
    insights: string[];
    opportunities: string[];
    risks: string[];
    suggestedActions: Array<{ title: string; description: string; priority: 'high' | 'medium' | 'low' }>;
  }> {
    const docs: Array<{ title: string; content: string }> = [
      {
        title: 'Brand context',
        content: `Brand: ${opts.brandContext.name}\nIndustry: ${opts.brandContext.industry ?? 'N/A'}\nTone: ${opts.brandContext.toneOfVoice ?? 'N/A'}`,
      },
      {
        title: 'Recent trend items',
        content: opts.trendItems
          .slice(0, 50)
          .map((t, i) => `${i + 1}. ${t.title}${t.summary ? `\n   ${t.summary.slice(0, 300)}` : ''}${t.url ? `\n   ${t.url}` : ''}${t.score ? ` [score ${(t.score * 100).toFixed(0)}]` : ''}`)
          .join('\n\n'),
      },
      {
        title: 'Competitor recent posts',
        content: opts.competitorPosts
          .slice(0, 30)
          .map((p, i) => `${i + 1}. [${p.competitor}] ${p.caption?.slice(0, 400) ?? '(no caption)'}`)
          .join('\n\n'),
      },
      {
        title: 'Our recent posts performance',
        content: opts.recentPosts
          .slice(0, 30)
          .map((p, i) => `${i + 1}. ${p.title ?? p.body?.slice(0, 80) ?? 'untitled'} — impressions ${p.impressions ?? 0}, engagement ${p.engagement ?? 0}`)
          .join('\n'),
      },
    ];

    const prompt = `Tu es un consultant marketing senior. Analyse l'ensemble des données ci-dessous et produis un briefing journalier actionnable pour cette marque.

Réponds UNIQUEMENT en JSON valide :
{
  "summary": "2-3 phrases sur l'état actuel et le contexte",
  "insights": ["3-5 insights précis tirés des données"],
  "opportunities": ["3-5 opportunités concrètes à saisir maintenant"],
  "risks": ["2-3 risques à surveiller"],
  "suggestedActions": [
    { "title": "...", "description": "...", "priority": "high|medium|low" }
  ]
}

Sois précis, pas générique. Cite les chiffres et tendances qui justifient chaque point.`;

    const { text } = await this.longContextAnalysis({ documents: docs, prompt, usePro: true });
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch { /* ignore */ }
    return {
      summary: text.slice(0, 500),
      insights: [],
      opportunities: [],
      risks: [],
      suggestedActions: [],
    };
  },
};
