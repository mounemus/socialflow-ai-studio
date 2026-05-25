# Déploiement — Vercel + Supabase + Upstash

## Pré-requis

- Compte [Vercel](https://vercel.com) (CLI `vercel` installé)
- Compte [Supabase](https://supabase.com) (Postgres + Storage)
- Compte [Upstash](https://upstash.com) (Redis) — optionnel pour MVP

## 1. Base de données Supabase

1. Créer un projet sur supabase.com
2. Récupérer `DATABASE_URL` (connection pooling, port 6543) et `DIRECT_URL` (direct, port 5432)
3. Exécuter localement :
   ```
   npm run db:push     # créé le schéma
   npm run db:seed     # données démo
   ```

## 2. Storage Supabase

1. Créer un bucket `socialflow-media` (public)
2. Récupérer `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

## 3. Redis Upstash (optionnel)

1. Créer une DB Redis
2. Récupérer la connection string `rediss://...`
3. Mettre dans `REDIS_URL`

> Sans Redis, les publications s'exécutent en synchrone (OK pour MVP, pas pour prod).

## 4. Vercel

```bash
# Depuis le dossier projet
vercel login
vercel link
vercel env add DATABASE_URL
vercel env add AUTH_SECRET
vercel env add TOKEN_ENCRYPTION_KEY
# ... toutes les vars de .env.example

vercel --prod
```

Ou via le dashboard Vercel : Import GitHub repo → configurer envs.

## 5. Workers (publication asynchrone)

Vercel ne supporte pas les processus long-running. Options :

**Option A — Render.com (recommandé)**

```yaml
# render.yaml
services:
  - type: worker
    name: socialflow-worker
    env: node
    buildCommand: npm install && npx prisma generate
    startCommand: npm run worker
    envVars:
      - key: DATABASE_URL
        sync: false
      - key: REDIS_URL
        sync: false
      - key: TOKEN_ENCRYPTION_KEY
        sync: false
```

**Option B — Vercel Cron + serverless invocations** (latence + cost moins prévisibles)

## 6. Domaine personnalisé

Dans Vercel → Settings → Domains → Add `socialflow-ai.com` (ou autre).

## Vérification post-deploy

```
curl https://YOUR_DOMAIN/api/health
```

Doit renvoyer :
```json
{ "ok": true, "service": "socialflow-ai-studio", ... }
```

## Rollback

Vercel → Deployments → cliquer un ancien deployment → "Promote to Production".

Migrations Prisma : utiliser `prisma migrate resolve` pour marquer manuellement (jamais `migrate reset` en prod).
