# Sécurité — SocialFlow AI Studio

## Modèle de menace

- Multi-tenant strict : aucune fuite cross-organisation possible
- Tokens OAuth chiffrés au repos
- Pas de clé API exposée côté client
- Audit log immuable sur actions sensibles

## Chiffrement des tokens sociaux

`SocialToken.accessTokenEnc` / `refreshTokenEnc` sont **chiffrés AES-256-GCM** (voir `src/lib/encryption.ts`) avant insertion en DB.

Clé : `TOKEN_ENCRYPTION_KEY` (32 bytes hex). Génération :
```
openssl rand -hex 32
```

**Rotation** : créer une nouvelle clé, déchiffrer tous les tokens avec l'ancienne, re-chiffrer avec la nouvelle. Job de rotation non encore implémenté (TODO).

## RBAC

8 rôles, 18 permissions. Voir `src/lib/rbac.ts`.

```
SUPER_ADMIN (100) > OWNER (90) > ADMIN (80) > STRATEGIST (60)
  > DESIGNER (50) > EDITOR (40) > CLIENT (20) > VIEWER (10)
```

Chaque API route appelle `requirePermission(ctx.role, '...')` avant toute action mutating.

## Tenant isolation

`requireTenant()` (src/lib/tenant.ts) :
1. Lit la session NextAuth
2. Trouve la `TeamMember` de l'utilisateur
3. Retourne `{ userId, organizationId, role }`

Toutes les queries Prisma filtrent sur `organizationId`. Pas d'exception.

## Validation des entrées

Tous les bodies POST/PATCH passent par un schéma **Zod** (`z.object(...).parse(await req.json())`). Échec → 422 + détails.

## Rate limiting

`src/lib/rate-limit.ts` : token bucket in-memory. Pour la production, remplacer par **Upstash Ratelimit** (édition Redis).

## CSRF

NextAuth v5 gère le CSRF nativement pour les routes `/api/auth/*`. Les autres routes POST sont protégées par :
- Cookie session HTTP-only
- Origin check (ajouter dans middleware si besoin)

## Audit log

`AuditLog` est créé sur :
- Login / Logout
- Création/suppression brand, post, automation
- Publication réelle
- Accès aux tokens chiffrés

(actuellement en MVP partiellement câblé ; à enrichir route par route)

## Politique de conservation

- `ApiLog`, `ErrorLog` : purge automatique 90 jours (à ajouter via cron)
- `AIRequest` (avec response complète) : 365 jours
- `Notification` lue : 30 jours
- Tokens sociaux d'orgs supprimées : `onDelete: Cascade`

## Variables sensibles

JAMAIS exposer côté client :
- `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`
- Toutes les `*_SECRET`, `*_CLIENT_SECRET`
- `*_SERVICE_ROLE_KEY`

Toutes les variables `NEXT_PUBLIC_*` sont volontairement publiques (bundlées dans le client). N'y mettre que `APP_URL`, `STRIPE_PUBLISHABLE_KEY`.

## Headers de sécurité

À ajouter en prod via `next.config.mjs` :
```js
headers: async () => [
  {
    source: '/(.*)',
    headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ],
  },
]
```
