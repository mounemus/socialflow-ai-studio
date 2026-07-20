/**
 * Shared metadata for each integration we support.
 * Used by both /admin/connections and /admin/setup/[provider] wizards.
 */

export interface EnvVarSpec {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'boolean' | 'url';
  required?: boolean;
  hint?: string;
  defaultValue?: string;
}

export interface IntegrationConfig {
  id: string;                  // url slug + provider id
  label: string;
  category: 'AI' | 'Design' | 'Social' | 'Storage' | 'Billing' | 'Infra' | 'Collab';
  icon?: string;               // emoji shortcut
  docs: string;                // user docs URL
  getKeysAt: string;           // where to get keys
  oauthStart?: string;         // if OAuth: the route that starts the flow
  envVars: EnvVarSpec[];
  description: string;
  notes?: string;              // any special notes (e.g., app review needed)
}

export const INTEGRATIONS: IntegrationConfig[] = [
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    category: 'AI',
    icon: '🧠',
    docs: 'https://docs.anthropic.com/',
    getKeysAt: 'https://console.anthropic.com/settings/keys',
    description: 'Power Claude assistant + autonomous operator + dev agent.',
    envVars: [
      { key: 'ANTHROPIC_API_KEY', label: 'API Key', type: 'password', required: true, hint: 'starts with sk-ant-...' },
      { key: 'ENABLE_REAL_AI', label: 'Activer IA réelle', type: 'boolean', defaultValue: 'true' },
      { key: 'AI_DEFAULT_TEXT_PROVIDER', label: 'Default provider', defaultValue: 'anthropic', hint: 'openai | anthropic | gemini | mock' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    category: 'AI',
    icon: '🤖',
    docs: 'https://platform.openai.com/docs',
    getKeysAt: 'https://platform.openai.com/api-keys',
    description: 'Alternative AI provider for text + DALL-E images.',
    envVars: [
      { key: 'OPENAI_API_KEY', label: 'API Key', type: 'password', required: true, hint: 'starts with sk-...' },
      { key: 'OPENAI_MODEL', label: 'Default model', defaultValue: 'gpt-4o-mini' },
    ],
  },
  {
    id: 'canva',
    label: 'Canva Connect',
    category: 'Design',
    icon: '🎨',
    docs: 'https://www.canva.dev/docs/connect/',
    getKeysAt: 'https://www.canva.com/developers/integrations',
    oauthStart: '/api/canva/connect',
    description: 'List/create designs, attach to posts, manage brand templates.',
    notes: 'Required scopes: design:meta:read, design:content:read, asset:read, profile:read. ' +
           'Public distribution requires Canva app review (~2 weeks). Development mode works for the app owner immediately.',
    envVars: [
      { key: 'CANVA_CLIENT_ID', label: 'Client ID', type: 'text', required: true, hint: 'visible on the Canva integration Configuration tab' },
      { key: 'CANVA_CLIENT_SECRET', label: 'Client Secret', type: 'password', required: true, hint: 'shown once when you generate it' },
      { key: 'CANVA_REDIRECT_URI', label: 'Redirect URI', type: 'url', required: true, defaultValue: 'https://socialflow-ai-studio.vercel.app/api/canva/callback', hint: 'must EXACTLY match the URI in Canva integration settings' },
      { key: 'ENABLE_CANVA_API', label: 'Activer Canva API', type: 'boolean', defaultValue: 'true' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    category: 'AI',
    icon: '✨',
    docs: 'https://ai.google.dev/',
    getKeysAt: 'https://aistudio.google.com/apikey',
    description: 'Google Gemini text + multimodal.',
    envVars: [{ key: 'GOOGLE_GEMINI_API_KEY', label: 'API Key', type: 'password', required: true }],
  },
  {
    id: 'stability',
    label: 'Stability AI',
    category: 'AI',
    icon: '🖼️',
    docs: 'https://platform.stability.ai/',
    getKeysAt: 'https://platform.stability.ai/account/keys',
    description: 'SDXL image generation.',
    envVars: [{ key: 'STABILITY_API_KEY', label: 'API Key', type: 'password', required: true }],
  },
  {
    id: 'replicate',
    label: 'Replicate',
    category: 'AI',
    icon: '🐠',
    docs: 'https://replicate.com/docs',
    getKeysAt: 'https://replicate.com/account/api-tokens',
    description: 'Run any open-source model.',
    envVars: [{ key: 'REPLICATE_API_TOKEN', label: 'API Token', type: 'password', required: true }],
  },
  {
    id: 'redis',
    label: 'Upstash Redis',
    category: 'Infra',
    icon: '🟥',
    docs: 'https://upstash.com/docs/redis',
    getKeysAt: 'https://console.upstash.com/redis',
    description: 'BullMQ queues for async publishing + cron + operator agent.',
    envVars: [{ key: 'REDIS_URL', label: 'Redis URL', type: 'password', required: true, hint: 'rediss://default:TOKEN@host:port' }],
  },
  {
    id: 'stripe',
    label: 'Stripe Billing',
    category: 'Billing',
    icon: '💳',
    docs: 'https://stripe.com/docs/api',
    getKeysAt: 'https://dashboard.stripe.com/apikeys',
    description: 'Subscription billing for Pro/Agency plans.',
    envVars: [
      { key: 'STRIPE_SECRET_KEY', label: 'Secret Key', type: 'password', required: true, hint: 'sk_live_... or sk_test_...' },
      { key: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook Secret', type: 'password', required: false, hint: 'whsec_... — endpoint URL: /api/billing/webhook' },
      { key: 'STRIPE_PRICE_PRO', label: 'Price ID — Pro plan (29€/mo)', type: 'text', required: false, hint: 'price_xxx from Stripe dashboard' },
      { key: 'STRIPE_PRICE_AGENCY', label: 'Price ID — Agency plan (99€/mo)', type: 'text', required: false },
      { key: 'STRIPE_PRICE_ENTERPRISE', label: 'Price ID — Enterprise', type: 'text', required: false },
      { key: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', label: 'Publishable Key (client-side)', type: 'text', required: false },
    ],
  },
  {
    id: 'late',
    label: 'Late / Zernio (agrégateur)',
    category: 'Social',
    icon: '🌉',
    docs: 'https://docs.zernio.com/',
    getKeysAt: 'https://zernio.com/',
    description: 'Passerelle multi-réseaux (X, TikTok, YouTube, Pinterest…) sans app reviews individuelles.',
    notes: 'Chaque compte social doit être connecté côté Late puis mappé via metadata.lateAccountId. ' +
           'Webhook: /api/webhooks/late (signé HMAC avec LATE_WEBHOOK_SECRET).',
    envVars: [
      { key: 'LATE_API_KEY', label: 'API Key', type: 'password', required: true },
      { key: 'LATE_API_BASE', label: 'API Base URL', type: 'url', required: false, defaultValue: 'https://zernio.com/api/v1' },
      { key: 'LATE_WEBHOOK_SECRET', label: 'Webhook Secret', type: 'password', required: false },
    ],
  },
  {
    id: 'facebook',
    label: 'Facebook / Instagram',
    category: 'Social',
    icon: '📘',
    docs: 'https://developers.facebook.com/docs/graph-api/',
    getKeysAt: 'https://developers.facebook.com/apps/',
    description: 'Publish to Facebook Pages + Instagram Business accounts.',
    notes: 'App review required for pages_manage_posts and instagram_content_publish scopes.',
    envVars: [
      { key: 'FACEBOOK_APP_ID', label: 'App ID', type: 'text', required: true },
      { key: 'FACEBOOK_APP_SECRET', label: 'App Secret', type: 'password', required: true },
      { key: 'INSTAGRAM_APP_ID', label: 'Instagram App ID', type: 'text', required: false },
      { key: 'INSTAGRAM_APP_SECRET', label: 'Instagram Secret', type: 'password', required: false },
    ],
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    category: 'Social',
    icon: '💼',
    docs: 'https://learn.microsoft.com/en-us/linkedin/',
    getKeysAt: 'https://www.linkedin.com/developers/apps',
    description: 'Publish to LinkedIn personal + Company pages.',
    notes: 'w_organization_social requires Marketing Developer Platform access.',
    envVars: [
      { key: 'LINKEDIN_CLIENT_ID', label: 'Client ID', type: 'text', required: true },
      { key: 'LINKEDIN_CLIENT_SECRET', label: 'Client Secret', type: 'password', required: true },
    ],
  },
  {
    id: 'twitter',
    label: 'X (Twitter)',
    category: 'Social',
    icon: '𝕏',
    docs: 'https://developer.twitter.com/en/docs',
    getKeysAt: 'https://developer.twitter.com/en/portal/dashboard',
    description: 'Publish tweets + threads.',
    notes: 'Posting via v2 API requires Basic tier minimum (~$100/month).',
    envVars: [
      { key: 'TWITTER_CLIENT_ID', label: 'Client ID', type: 'text', required: true },
      { key: 'TWITTER_CLIENT_SECRET', label: 'Client Secret', type: 'password', required: true },
    ],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    category: 'Social',
    icon: '🎵',
    docs: 'https://developers.tiktok.com/doc/content-posting-api-get-started/',
    getKeysAt: 'https://developers.tiktok.com/',
    description: 'Publish videos to TikTok business accounts.',
    notes: 'Content Posting API requires partner approval (~4-8 weeks).',
    envVars: [
      { key: 'TIKTOK_CLIENT_KEY', label: 'Client Key', type: 'text', required: true },
      { key: 'TIKTOK_CLIENT_SECRET', label: 'Client Secret', type: 'password', required: true },
    ],
  },
  {
    id: 'youtube',
    label: 'YouTube',
    category: 'Social',
    icon: '▶️',
    docs: 'https://developers.google.com/youtube/v3',
    getKeysAt: 'https://console.cloud.google.com/apis/credentials',
    description: 'Upload videos + manage channels.',
    notes: 'Data API v3 quota: 10,000 units/day. videos.insert = 1,600 units.',
    envVars: [
      { key: 'YOUTUBE_CLIENT_ID', label: 'Client ID', type: 'text', required: true },
      { key: 'YOUTUBE_CLIENT_SECRET', label: 'Client Secret', type: 'password', required: true },
    ],
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    category: 'Social',
    icon: '📌',
    docs: 'https://developers.pinterest.com/docs/api/v5/',
    getKeysAt: 'https://developers.pinterest.com/apps/',
    description: 'Create pins + manage boards.',
    envVars: [
      { key: 'PINTEREST_APP_ID', label: 'App ID', type: 'text', required: true },
      { key: 'PINTEREST_APP_SECRET', label: 'App Secret', type: 'password', required: true },
    ],
  },
  {
    id: 'supabase',
    label: 'Supabase Storage',
    category: 'Storage',
    icon: '📦',
    docs: 'https://supabase.com/docs/guides/storage',
    getKeysAt: 'https://supabase.com/dashboard/project/_/settings/api',
    description: 'Media upload for posts + designs.',
    envVars: [
      { key: 'SUPABASE_URL', label: 'Project URL', type: 'url', required: true },
      { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Service Role Key', type: 'password', required: true, hint: 'NOT the anon key — service role for server-side uploads' },
      { key: 'SUPABASE_STORAGE_BUCKET', label: 'Bucket name', type: 'text', defaultValue: 'socialflow-media' },
    ],
  },
];

export function getIntegration(id: string): IntegrationConfig | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

export function integrationsByCategory() {
  const map: Record<string, IntegrationConfig[]> = {};
  for (const i of INTEGRATIONS) {
    (map[i.category] ||= []).push(i);
  }
  return map;
}
