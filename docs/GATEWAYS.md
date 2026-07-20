# Passerelles de publication (Phase 3)

L'UI et les services métier ne parlent jamais directement à un fournisseur :
tout passe par `SocialGatewayService` (`src/services/gateway/`).

## Routage (par compte, à chaque publication)

1. `SocialAccount.metadata.preferredGateway` (`native` | `late` | `manual`) si utilisable ;
2. **native** — API officielle (FB/IG/LinkedIn) si l'adaptateur la supporte ET qu'un token déchiffrable existe ;
3. **late** — agrégateur Late/Zernio si `LATE_API_KEY` est présent ET `SocialAccount.metadata.lateAccountId` renseigné ;
4. **manual** — échec honnête `MANUAL_SHARE_REQUIRED` (jamais de succès déguisé).

En simulation (`ENABLE_REAL_PUBLISHING` ≠ true), le routage est court-circuité : tout est `SIMULATED`.

## Vérification post-publication (native)

Après un succès natif, l'identifiant externe est **relu** (GET Graph API / socialActions).
- Relecture OK → `PUBLISHED` (avec `verified: true` dans `PublishAttempt.response`).
- Relecture KO → `ACTION_REQUIRED` avec message « vérifiez manuellement » — jamais un PUBLISHED non prouvé.

## Late / Zernio

- API : `POST {LATE_API_BASE|https://zernio.com/api/v1}/posts` (Bearer `LATE_API_KEY`),
  `GET /posts/{id}` pour le statut. Réponse asynchrone : `scheduled → publishing → published|failed`.
- Après ~20 s de polling sans état final : le schedule passe `PROCESSING` et le
  webhook (ou un polling ultérieur) conclut.
- Webhook : `POST /api/webhooks/late`, signature HMAC-SHA256 du corps brut avec
  `LATE_WEBHOOK_SECRET` (headers `x-late-signature` / `x-webhook-signature`).
  Sans secret configuré, le webhook refuse tout (503). Idempotent au rejeu.
- Mapping des comptes : connecter le compte côté Late, puis stocker son id dans
  `SocialAccount.metadata.lateAccountId`.

## Traçabilité

Chaque tentative est journalisée dans `PublishAttempt` avec `provider` =
`native` | `late` | `manual`, `mode` = `REAL` | `SIMULATED`, `gatewayRef`
(id Late), `verified`, idempotencyKey et requestId.
