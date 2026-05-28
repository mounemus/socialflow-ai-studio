# Audit système — SocialFlow AI Studio

_Date_: 2026-05-26 · _Version_: 0.3 · _Status_: production beta

Vue d'ensemble brutalement honnête de ce qui est solide, ce qui est fragile, et ce qui manque.

---

## 🟢 Solide (production-ready)

### Architecture
- **Multi-tenant strict** : `requireTenant()` + `resolveBrandContext()` + `active_org_id` cookie. Plus de fuite cross-org possible.
- **Couches isolées** : UI → API routes → Services → Adapters → DB/External. Aucune couche ne saute la suivante.
- **Mock/Real par feature flag** : `ENABLE_REAL_AI`, `ENABLE_REAL_PUBLISHING`, `ENABLE_CANVA_API`. Le code marche sans aucune clé.
- **RBAC 8 rôles × 18 permissions** : centralisé dans `src/lib/rbac.ts`.
- **Tokens OAuth chiffrés AES-256-GCM** : `SocialToken`, `UserIntegration`.

### Stack technique
- Next.js 15.5 App Router, React 19, TS strict ✓
- Prisma 6 + Postgres Supabase ✓
- NextAuth v5 (Credentials + Google/GitHub OAuth ready) ✓
- BullMQ + Redis (fallback sync sans Redis) ✓
- next-intl FR/EN ✓
- 80+ routes, build clean

### Super-Admin Dashboard
- 7 sections : Overview, Orgs, Users, Intégrations, API Keys, Agent IA, Système & Audit
- Création/suppression cross-org possible
- Health checks live (7 probes : DB, Auth, Vercel, Anthropic, OpenAI, GitHub, Redis)
- Audit log de toutes les actions sensibles

### Agents Claude
- **Assistant in-app** (/assistant) : chat tool-calling avec 21 tools
- **Operator agent autonome** : schedules cron-driven (5 min tick) avec Claude
- **Dev Agent** : crée des PR GitHub avec propositions de code

### Intégrations
- **15 wizards** dédiés (1 par intégration) avec batch save + redeploy auto + test connection
- **Canva OAuth réel** (PKCE) + listing designs live + blend manuel
- **Vercel API** gérée depuis l'UI super-admin

---

## 🟡 Fragile (acceptable pour beta, à muscler pour scale)

### Performance
- ❌ Pas de cache Redis pour les requêtes lourdes (analytics, listings)
- ❌ Pas de CDN pour les medias (URLs distantes uniquement)
- ❌ Pas d'index sur certains champs souvent filtrés (e.g., `Post.format`, `TrendItem.contentOpportunityScore`)
- ⚠️ Prisma `findMany` sans pagination sur plusieurs endpoints — limit max 100/200

### Observabilité
- ✅ Logs JSON structurés (`src/lib/logger.ts`)
- ⚠️ Pas de tracing distribué (OpenTelemetry pas branché)
- ⚠️ Pas d'alerting (Sentry, Datadog)
- ❌ Pas de dashboards externe (Grafana ou équivalent)

### Tests
- ❌ Aucun test automatisé. Pas de Jest, pas de Playwright, pas de Vitest.
- ❌ Pas de CI (GitHub Actions vide)
- ⚠️ Validation manuelle uniquement → risque de régression

### Workers
- ✅ BullMQ structure prête
- ⚠️ Worker process pas déployé en prod (Vercel = serverless, pas long-running)
- ❌ Pas de Render/Railway/Fly setup automatique

### Stripe / Billing
- ✅ Modèle `Subscription` prêt
- ❌ Pas de webhooks Stripe implémentés
- ❌ Pas de gating de features par plan (FREE/PRO/AGENCY/ENTERPRISE)
- ❌ Pas de quota AI / posts par plan

### Storage
- ✅ Wizard Supabase Storage
- ❌ Pas d'upload UI fonctionnelle (médiathèque vide, ajout manuel d'URL seulement)
- ❌ Pas de compression/resize d'images
- ❌ Pas de signed URLs

---

## 🔴 Manquant (gap concurrentiel)

### Versus HubSpot AI (CRM + Breeze)
- ❌ CRM contacts (ContactPerson, Lead, Opportunity)
- ❌ Email marketing avec deliverability tracking
- ❌ Workflows visuels drag-and-drop (Visual Workflow Builder)
- ❌ Scoring prédictif (lead scoring AI)
- ❌ Smart properties IA (enrichment automatique de contacts)

### Versus Brevo (PME multi-canal)
- ❌ SMS marketing
- ❌ WhatsApp Business
- ❌ Chat/livechat avec IA
- ❌ Segmentation comportementale fine
- ❌ Drag-and-drop email builder

### Versus Sprout Social (social listening)
- ⚠️ Social listening : seulement RSS (Sprout = Twitter API, mentions, brand monitoring)
- ❌ Inbox unifié (DMs Instagram + Facebook + LinkedIn + Twitter)
- ❌ Sentiment analysis sur mentions
- ❌ Influencer identification
- ❌ Competitive benchmarking auto-mesuré (KPIs vs concurrents)

### Versus Metricool (planning multi-plateforme)
- ⚠️ Calendrier éditorial existant mais basique (14 jours, pas mois/semaine/jour switch)
- ❌ AI optimization timing (suggest best posting hour per audience)
- ❌ Bulk upload posts via CSV
- ❌ White-label pour agences (logo custom, sous-domaines)

### Versus Hootsuite
- ❌ Inbox social unifié
- ❌ Approval workflows complexes (multi-step + multi-stakeholder)
- ❌ Hashtag generator avec score performance estimé

### Versus Canva Magic Studio
- ⚠️ Brief Canva existe (text only) — pas de génération visuelle directe
- ❌ Image generation in-app (Stability/DALL-E branché mais pas UI)
- ❌ Variations automatiques (5 versions du même visuel)
- ❌ Brand kit visuel (auto-application du logo/couleurs sur templates)

### Versus ChatGPT/Gemini (ideation)
- ✅ Assistant chat existe
- ❌ Mémoire long-terme (Claude oublie d'un run à l'autre)
- ❌ Mode "research deep" pour analyses approfondies (multi-source)
- ❌ Génération vidéo (Runway/Pika/Veo)

---

## Bugs connus / dette technique

| Sévérité | Description | Statut |
|---|---|---|
| 🔴 RÉSOLU | `/api/brands/[id]` 404 sur multi-org users | ✅ fixé via `resolveBrandContext` |
| 🟡 | Worker BullMQ pas déployé en prod (Vercel serverless) | Plan : Render.com worker |
| 🟡 | Pas de tests automatisés | Plan : Vitest + Playwright |
| 🟡 | Pas de CI/CD (au-delà du build Vercel auto) | Plan : GitHub Actions |
| 🟢 | `posts/[id]/route.ts` utilise encore l'ancienne logique | À migrer vers `resolvePostContext` |
| 🟢 | Plusieurs endpoints ont `findMany` sans pagination | Ajouter cursor pagination |
| 🟢 | Pas de soft delete (delete = cascade complet) | Ajouter `deletedAt` aux modèles critiques |

---

## Recommandations sécurité immédiates

1. **Rotater `TOKEN_ENCRYPTION_KEY`** : actuellement la clé de dev est encore en place. Re-générer via `openssl rand -hex 32` et migrer les tokens existants.
2. **CSP headers** : ajouter dans `next.config.mjs` pour limiter XSS (déjà documenté dans `docs/SECURITY.md`).
3. **Rate limiting prod** : remplacer `src/lib/rate-limit.ts` (in-memory) par Upstash Ratelimit (multi-instance safe).
4. **Audit log retention** : actuellement aucune purge. Ajouter cron de purge > 365 jours.
5. **Webhook signing** : préparer les middlewares de validation de signatures (Stripe, Meta, etc.).

---

## Performance budget cible

| Page | Cible LCP | Actuel | Action |
|---|---|---|---|
| / (landing) | < 1s | ~600ms ✓ | OK |
| /dashboard | < 2s | ~1.5s ✓ | OK |
| /analytics | < 2.5s | ~2s ✓ | À mesurer sous charge |
| /admin/* | < 1.5s | ~1s ✓ | OK |
| API /api/agent/chat | < 5s p50, < 15s p99 | dépend Claude | OK |

---

## Take-aways

**Ce qui est exceptionnel pour un MVP de cette taille** :
- Architecture multi-tenant rigoureuse
- 21 tools agent + dev agent autonome (très rare)
- Super-admin dashboard complet
- Wizards par intégration (UX > Hootsuite/Sprout)
- TS strict + 0 erreur build

**Ce qui doit absolument être fait pour atteindre la parité concurrentielle** :
1. Tests automatisés (urgent)
2. Stripe billing fonctionnel
3. Storage upload UI
4. Worker prod (Render.com)
5. Inbox social unifié (différentiant)
6. Génération visuelle in-app (Stability/DALL-E UI)
7. Email marketing complet
8. Social listening Twitter/Instagram (au moins via partner API)

Voir [docs/ROADMAP.md](./ROADMAP.md) pour le plan détaillé.
