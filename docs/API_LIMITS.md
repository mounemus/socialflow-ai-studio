# Limites API par plateforme

Toutes ces contraintes sont **documentées** et **non bloquantes** : le code fonctionne en mode mock par défaut.
Pour passer en production, valider chaque app auprès de chaque plateforme.

## Facebook + Instagram (Meta Graph API)

- **App review obligatoire** pour `pages_manage_posts`, `instagram_content_publish`, `pages_read_engagement`.
- Compte Instagram **doit être Business ou Creator** lié à une Facebook Page.
- Publication Instagram = 2 étapes (`media container` puis `publish`).
- Rate limit : 200 calls/h/utilisateur sur le Graph API, plus restrictif sur publication.
- Pas d'API publique pour Stories (uniquement via partenaires).

## LinkedIn

- Scopes critiques : `w_member_social` (perso) ou `w_organization_social` (page).
- App doit demander accès au **Marketing Developer Platform** pour publier sur des Company Pages.
- Pas d'API publique pour reach/impressions sans tier Marketing.
- Multi-image carousel via UGCPost.

## X (Twitter)

- Tier **Basic minimum** (~100 $/mois) pour publier via v2 API.
- Tier Free permet seulement lecture limitée.
- 280 caractères, threads via `reply_to`.
- Médias : upload via v1.1 endpoint, attach via v2 — pipeline cassé en pratique.

## TikTok

- **Content Posting API** réservée aux comptes Business approuvés par TikTok.
- Délai de revue : 4-8 semaines.
- Pas d'API stable pour les Stories ou Lives.
- Vidéo MP4 uniquement, taille max 4 GB.

## YouTube

- **Quota Data API v3** : 10 000 unités/jour par défaut. `videos.insert` consomme 1600 unités → ~6 uploads/jour.
- Upload via resumable protocol obligatoire (>5 Mo).
- Shorts détectés via durée < 60s + tag `#Shorts`.

## Pinterest

- API v5 actuelle.
- Scope `pins:write` + `boards:read`.
- Pas d'API publique pour les Idea Pins (vidéo).

## Canva (Connect API)

- **App review obligatoire**, processus partenaire.
- Scopes typiques : `design:meta:read`, `design:content:read`, `asset:read`.
- **Pas d'API publique** pour rendre un preview server-side instantanément — il faut un export job (async).
- Brand Kit / Brand Templates : nécessite Canva for Teams / Enterprise.
- **Fallback dans cette app** : lien Canva collé + brief IA généré côté serveur, ce qui couvre 80 % du besoin sans API.

## Fournisseurs IA

| Provider   | Modèle par défaut       | Variable env                |
| ---------- | ----------------------- | --------------------------- |
| OpenAI     | `gpt-4o-mini`           | `OPENAI_API_KEY`            |
| Anthropic  | `claude-sonnet-4-6`     | `ANTHROPIC_API_KEY`         |
| Gemini     | `gemini-2.0-flash`      | `GOOGLE_GEMINI_API_KEY`     |
| Replicate  | (par modèle)            | `REPLICATE_API_TOKEN`       |
| Stability  | SDXL Turbo              | `STABILITY_API_KEY`         |

Tous ont un mode fallback `mock` activé tant que `ENABLE_REAL_AI=false`.

## Veille

- **Google Trends** : RSS public (`https://trends.google.com/trending/rss?geo=FR`), non documenté, peut casser.
- **TikTok Creative Center** : partner-only.
- **Reddit** : OAuth public, gratuit, généreux.
- **Instagram hashtags** : Business API, max 30 hashtags / 7 jours / app.
