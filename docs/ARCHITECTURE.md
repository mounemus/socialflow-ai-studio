# Architecture — SocialFlow AI Studio

## Vision

Plateforme SaaS pour piloter **plusieurs marques**, **plusieurs comptes sociaux**, **plusieurs supports marketing** depuis un seul espace, avec IA, veille concurrentielle et intégration Canva.

## Principes

1. **Multi-tenant strict** : toute requête passe par `requireTenant()` qui résout `userId → organizationId` via `TeamMember`. Aucune table publique n'est lue sans `organizationId`.
2. **Layered architecture** : UI → API routes → Services → Adapters → External APIs / DB. Aucune couche ne saute la suivante.
3. **Mock par défaut** : tout adaptateur externe (AI, Canva, Publishers) a une version `mock` qui marche sans clé. Le mode réel s'active par feature flag (`ENABLE_REAL_AI`, `ENABLE_REAL_PUBLISHING`, `ENABLE_CANVA_API`).
4. **Queue-first publishing** : aucune publication réelle n'est synchrone. Tout passe par BullMQ (`SocialPublisherService.enqueue`), avec fallback sync si Redis absent.
5. **RBAC fin** : 8 rôles + 18 permissions. Voir [src/lib/rbac.ts](../src/lib/rbac.ts).
6. **Chiffrement obligatoire** : tous les tokens OAuth sont chiffrés AES-256-GCM côté serveur uniquement.

## Schéma Prisma — vue d'ensemble

40+ modèles regroupés en 9 domaines :

```
TENANCY            : User, Organization, TeamMember, Client
BRAND              : Brand, BrandProfile
SOCIAL             : SocialAccount, SocialToken, SocialPage, PlatformPermission
CONTENT            : Post, PostVariant, PostSchedule, MediaAsset
CANVA              : CanvaDesign, CanvaTemplate
CAMPAIGN           : Campaign, CalendarEvent
AUTOMATION         : Automation, AutomationStep, AutomationRun
INTELLIGENCE       : TrendWatch, TrendItem, KeywordWatch, HashtagWatch
COMPETITOR         : Competitor, CompetitorSocialAccount, CompetitorPost
AI / ANALYTICS     : AIRequest, AIProvider, AnalyticsSnapshot, PostAnalytics, CampaignAnalytics
GOVERNANCE         : ApprovalRequest, ApprovalComment, Notification, AuditLog, ApiLog, ErrorLog
BILLING            : Subscription
```

Tous les modèles tenant-aware ont un index sur `organizationId`. Les soft-relations (`brandId`, `campaignId`) utilisent `onDelete: SetNull` pour préserver l'historique.

## Pourquoi cette stack ?

- **Next.js App Router** : SSR + Server Components pour les pages list/detail (zéro round-trip client pour les CRUD), Client Components ciblés pour les forms.
- **Prisma** : type-safety totale entre schema → SQL → TS, migrations versionnées.
- **NextAuth v5** : flexible (JWT + Adapter), supporte Credentials, Google, GitHub, et bientôt social OAuth.
- **BullMQ** : standard de fait pour les queues Node, retries exponentiels, scheduled jobs natifs.
- **next-intl** : i18n SSR-first avec cookies, sans complexité de routing par locale.

## Workflow type — créer + publier un post via IA

```
1. UI: /ai-studio
   → user remplit form (brand, platform, format, tone, prompt)
   → POST /api/ai/generate-post { saveAsDraft: true }

2. API route
   → requireTenant() + requirePermission('ai.use')
   → charge brand + profile
   → AIProviderService.generateText() → adapter mock|openai|anthropic
   → db.aIRequest.create()  (audit + cost tracking)
   → db.post.create() avec status AI_GENERATED
   → ok({ text, post })

3. UI: /posts/[id] → user édite, valide
   → POST /api/posts/[id]/schedule { socialAccountId, scheduledFor }

4. API route
   → crée PostSchedule
   → SocialPublisherService.enqueue() → BullMQ ou sync

5. Worker (src/workers/index.ts)
   → consomme la queue
   → SocialPublisherService.publishNow()
   → adapter platform.publish() → mock|real API
   → maj status PUBLISHED / FAILED
```

## Évolution

- **Phase 2** : Stripe billing + plans, Supabase Storage upload, OAuth réel par plateforme
- **Phase 3** : Worker dédié (Render/Railway/Fly), Vercel Cron pour veille, Webhooks Meta/LinkedIn pour analytics push
- **Phase 4** : Embeddings (pgvector) pour scoring relevance trends, LLM router auto-cost
