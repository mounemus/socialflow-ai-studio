# SocialFlow AI Studio

Plateforme SaaS multi-tenant, multi-marques, multi-comptes pour gérer le marketing social, la création de contenu IA, la veille concurrentielle, l'intégration Canva et la publication automatisée.

## Stack

- **Frontend** : Next.js 15 (App Router), React 19, TypeScript, Tailwind, shadcn-style UI, next-intl (FR/EN), Recharts
- **Backend** : Next.js API routes + NestJS-like services, Prisma 6, PostgreSQL (Supabase)
- **Auth** : NextAuth (Credentials + Google + GitHub), JWT sessions, RBAC à 8 rôles
- **Jobs** : BullMQ + Redis (Upstash compatible)
- **IA** : adaptateurs OpenAI, Anthropic, Gemini, fallback Mock
- **Canva** : OAuth Connect API si disponible, fallback manuel (lien + brief IA)
- **Stockage** : Supabase Storage / S3 compatible
- **Déploiement** : Vercel (web) + Render/Railway (workers)

## Architecture en couches

```
UI (App Router pages)
      ↓ fetch
API routes (validation Zod + RBAC + tenant guard)
      ↓
Services (AIProviderService, CanvaService, SocialPublisherService, MarketingWatchService, …)
      ↓                            ↓
Adapters (mock | real)        Prisma (PostgreSQL)
      ↓                            ↓
External APIs                  Queue (BullMQ → workers)
```

**Rien ne mélange UI, logique métier et stockage.** Les adaptateurs mock/réels sont isolés.

## Démarrage rapide (local)

```bash
# 1. Cloner
git clone https://github.com/mounemus/socialflow-ai-studio.git
cd socialflow-ai-studio

# 2. Installer
npm install

# 3. Configurer
cp .env.example .env
# Édite .env :
#   - DATABASE_URL (Supabase ou Postgres local)
#   - AUTH_SECRET (openssl rand -base64 32)
#   - TOKEN_ENCRYPTION_KEY (openssl rand -hex 32)

# 4. Initialiser la base
npm run db:push
npm run db:seed   # crée demo@socialflow.ai / demo1234

# 5. Lancer
npm run dev
# → http://localhost:3000

# 6. (Optionnel) Worker pour publications/automatisations
npm run worker
```

## Mode MVP vs Production

| Fonction               | MVP (par défaut)                  | Production (activer)                     |
| ---------------------- | --------------------------------- | ---------------------------------------- |
| IA texte               | Mock déterministe                 | `ENABLE_REAL_AI=true` + clé API          |
| Génération image       | Picsum placeholders               | Stability / Replicate                    |
| Publication sociale    | Mock externe IDs                  | `ENABLE_REAL_PUBLISHING=true` + OAuth    |
| Canva                  | Lien manuel + brief IA            | `ENABLE_CANVA_API=true` + app validée    |
| Queue                  | Synchrone si pas de Redis         | Upstash Redis                            |
| Storage                | URL distantes                     | Supabase / R2 / S3                       |

Voir [docs/API_LIMITS.md](./docs/API_LIMITS.md) pour les contraintes par plateforme.

## Données, export et sauvegarde

- **Où vivent les données** : PostgreSQL (Supabase en prod, `DATABASE_URL` dans `.env`) ; les
  médias uploadés dans Supabase Storage (bucket `media`) ; les vidéos IA restent en URL
  externe (fal.ai / Replicate) tant qu'elles ne sont pas ré-hébergées.
- **Export en un clic** : Contenus → File de production → « Exporter en CSV »
  (`GET /api/posts/export`) — une ligne par publication : statut, plateforme, créneau,
  date de publication, identifiant externe, lien publié, texte. Ouvrable dans Excel/Sheets.
- **Sauvegarde complète** : `pg_dump "$DATABASE_URL" > backup.sql` (schéma + données) ;
  les secrets ne sont jamais en base (`.env` uniquement, `.env.example` fourni, rien de
  commité).
- **Identifiants de publication** : chaque envoi conserve `externalPostId` + URL publiée
  (`PublishAttempt`) ; le statut est rafraîchi par l'API/webhook Zernio — jamais de scraping.

## Garde-fous avant publication

Toute publication passe par `/api/posts/[id]/publish` ou `/schedule` :
porte de validation optionnelle (`requireApproval`), anti double-clic, résolution du
compte réel (`resolvePublishTarget`), **pré-vol** (`src/lib/publish-preflight.ts`) —
limite de caractères par plateforme, média requis, vidéo pour les formats vidéo, taille
de fichier — affiché dans l'UI avant d'agir et opposable côté API. Les images Instagram
hors ratio [0.75 ; 1.91] sont recadrées automatiquement (`/api/media/[id]/raw/instagram.jpg`).

## Scripts

```
npm run dev          # Dev server
npm run build        # Build prod (génère Prisma + Next)
npm run start        # Start prod
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run db:push      # Sync schema → DB (dev)
npm run db:migrate   # Create migration
npm run db:studio    # Prisma Studio
npm run db:seed      # Seed démo
npm run worker       # Worker queues (publication, automatisations, veille)
```

## Documentation

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — architecture détaillée, choix techniques
- [docs/API_LIMITS.md](./docs/API_LIMITS.md) — contraintes par plateforme sociale
- [docs/SECURITY.md](./docs/SECURITY.md) — chiffrement tokens, RBAC, audit
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) — Vercel + Supabase + Upstash

## Statut

✅ MVP scaffold complet — déployable sur Vercel
⚠️ Intégrations sociales réelles : interfaces prêtes, OAuth à activer par plateforme
🚧 Stripe billing : modèle prêt, webhooks à implémenter

## Licence

Propriétaire. Tous droits réservés.
