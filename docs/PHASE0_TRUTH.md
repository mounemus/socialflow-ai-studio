# Phase 0 — Vérité opérationnelle

Règle : **aucun mock ne peut être confondu avec une action réelle.**

## Statuts de publication (PostStatus)

| Statut | Signification |
|---|---|
| `PUBLISHED` | Publication **réelle** confirmée par la plateforme (identifiant externe réel présent). |
| `SIMULATED` | Le pipeline a tourné mais **rien n'a été envoyé** au réseau. Aucun identifiant externe, aucune URL. |
| `FAILED` | Échec technique (API, validation). |
| `ACTION_REQUIRED` | Une action utilisateur/admin est nécessaire : jeton absent/expiré, page non sélectionnée, plateforme non implémentée en mode réel. |

Invariants :
- `externalPostId` ne contient **jamais** un identifiant fabriqué (`mock_*` a été supprimé partout, y compris les réponses inbox).
- `publishedAt` n'est renseigné que pour une publication réelle.
- En mode réel (`ENABLE_REAL_PUBLISHING=true`), une plateforme sans implémentation échoue en `ACTION_REQUIRED` au lieu de simuler un succès.

## État des adaptateurs (mode réel)

| Plateforme | Implémentation réelle |
|---|---|
| Facebook Pages | ✅ Graph API v21 (`/feed`, `/photos`, échange page token) |
| Instagram Business | ✅ Content Publishing API (container → polling → publish → permalink) |
| LinkedIn | ✅ UGC Posts (`registerUpload` pour images, personne + organisation) |
| X / TikTok / YouTube / Pinterest | ❌ `NOT_IMPLEMENTED` → `ACTION_REQUIRED` |

Les tokens OAuth sont lus depuis `SocialToken` (chiffrés AES-256-GCM), résolus par
`SocialPublisherService.resolveAccessToken` — les adaptateurs ne touchent jamais la DB.

## Modes Canva (createDesignFromBrandTemplate)

| Mode | Signification |
|---|---|
| `CANVA_API` | Design réellement créé via Canva Connect (nécessite scopes enterprise + `brand_template_id` — pas encore atteignable, `CanvaTemplate` ne stocke qu'une URL). |
| `CANVA_HANDOFF` | On ouvre le modèle dans Canva, l'utilisateur ramène le résultat. |
| `MANUAL_FALLBACK` | Pas d'URL de modèle : brief manuel. |

## Registre des capacités

`GET /api/capabilities` (source : `src/services/capabilities/CapabilityService.ts`) retourne,
par organisation : `VERIFIED` / `CONNECTED_LIMITED` / `SIMULATED` / `ACTION_REQUIRED` / `NOT_CONFIGURED`
pour chaque plateforme sociale, Canva, les fournisseurs IA et l'infra. Affiché sur `/admin/connections`.

## Migration base de données

Les valeurs d'enum `SIMULATED` et `ACTION_REQUIRED` doivent exister en base.
Le build Vercel exécute désormais `prisma db push --skip-generate` (voir `vercel.json`),
donc le prochain déploiement applique le changement automatiquement.
En attendant, si la base n'est pas à jour, le service dégrade proprement en `FAILED`
avec un message `[SIMULATED] … (DB non migrée: exécutez prisma db push)` — jamais en faux `PUBLISHED`.
