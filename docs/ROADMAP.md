# Roadmap SocialFlow AI Studio — vers la parité concurrentielle

_Cible_ : devenir une alternative crédible à **HubSpot AI + Sprout Social + Canva Magic Studio + ChatGPT** sur un seul produit, avec un positionnement "agency-first + AI-native + open architecture".

---

## Positionnement concurrentiel

| Outil | Force | Faiblesse | Notre avantage |
|---|---|---|---|
| **HubSpot AI** | CRM + Breeze agent + analytics | Cher, courbe d'apprentissage, peu agency-friendly | Multi-marques natif, prix accessible, agent IA plus avancé |
| **Brevo** | PME multi-canal, prix | UX vieillissante, pas multi-marque | UX moderne, mode agence, IA générative supérieure |
| **Sprout Social** | Listening + reporting | Pas de génération de contenu, cher (>$300/mois) | Génération + planification + listening intégrés |
| **Metricool** | Planning multi-plateforme | Pas d'agent IA autonome | Agent opérateur autonome, dev agent |
| **Hootsuite** | Historique, intégrations | UX datée, pas vraiment "AI native" | AI-first, architecture moderne |
| **Canva** | Création visuelle | Pas de planification, pas de CRM | Génération + Canva intégré + planification |
| **ChatGPT** | Conversation, brainstorming | Pas d'intégration sociale ni planification | Tools spécifiques marketing/social + persistance |

---

## Plan par horizons

### 🚀 H1 (4 semaines) — Fondations production

Tout ce qui empêche de vendre dès maintenant.

#### 1. Tests automatisés (priorité absolue)
- **Vitest** pour services + lib (target: 60% coverage)
- **Playwright** pour parcours critiques (login, créer brand, générer post, planifier)
- **GitHub Actions** : run tests + typecheck sur chaque PR

#### 2. Stripe billing fonctionnel
- Webhooks Stripe (`/api/billing/webhook`) avec validation signature
- Subscription lifecycle (created/updated/canceled/past_due)
- Plan gating : limite `posts/mois`, `aiRequests/mois`, `socialAccounts`, `brands` par plan
- Customer portal Stripe (self-service cancel/upgrade)
- Page `/billing` interactive avec upgrade in-app

#### 3. Storage upload UI fonctionnel
- Composant `<MediaUploader/>` (drag-drop, multi-file, progress)
- Connexion Supabase Storage (signed URLs)
- Compression/resize via Sharp côté serveur
- Médiathèque navigable + recherche

#### 4. Worker production (Render.com)
- `render.yaml` clé en main
- Worker BullMQ déployé séparément
- Vercel Cron supprimé (devient secondaire)

#### 5. Migrations Prisma versionnées
- Passer de `db push` à `prisma migrate dev/deploy`
- Premier baseline migration
- Workflow safe pour prod (no data loss)

---

### 🎯 H2 (8 semaines) — Parité concurrentielle de base

#### 6. Inbox social unifié (différenciant fort vs Hootsuite/Sprout)
- Webhooks Meta + LinkedIn (DMs + comments)
- Mailbox-style UI: toutes les conversations en un endroit
- Réponse IA suggérée par message
- Assignation à un membre de l'équipe
- Tags + filtres + recherche

#### 7. Génération visuelle in-app
- Branchement réel Stability AI + DALL-E
- UI dans `/ai-studio` : prompt → 4 variantes
- Variations automatiques d'un visuel existant
- Storage direct vers médiathèque
- Coût tracking par image générée

#### 8. Email marketing
- Builder drag-and-drop (composants Card, Hero, Button, Image, Footer)
- Templates pré-faits par industrie
- Envoi via Resend / SendGrid
- Tracking opens + clicks
- A/B testing subject lines

#### 9. Social listening basique
- Twitter/X mentions API (tier Basic+)
- Instagram hashtag monitoring (Business API)
- Reddit OAuth (gratuit)
- Sentiment analysis via Claude
- Alertes "brand mention" temps réel

#### 10. Calendrier éditorial avancé
- Vue mois / semaine / jour / liste
- Drag-and-drop entre jours
- Filtre multi-critères (marque, plateforme, campagne, statut)
- Recommandation IA : meilleur horaire par audience
- Export ICS / Google Calendar sync

---

### 🌟 H3 (12 semaines) — Différenciation AI

#### 11. Mémoire long-terme agent
- Embeddings (pgvector ou Pinecone)
- L'agent se souvient des décisions, préférences, contenus passés
- "Tu m'avais dit la dernière fois que..." capabilities

#### 12. Smart Properties IA
- Auto-enrichissement des contacts/leads/concurrents
- "Trouve-moi l'email du décideur marketing chez [company]"
- Web research agent (browse + extract)

#### 13. Génération vidéo
- Runway Gen-3 / Pika / Veo intégration
- Templates Reels / TikTok avec script + voix + image
- Subtitle generation auto

#### 14. Multi-channel orchestration
- Une campagne = N variantes auto-générées pour N plateformes
- Storyboard cross-platform (post IG + Reel + Story + Tweet + LinkedIn)
- Tracking unifié de l'engagement par variante

#### 15. Predictive analytics
- "Ce post performera X% mieux si publié à Y heure"
- Forecasting des KPIs (followers, reach, engagement)
- Anomaly detection (chute soudaine d'engagement)

---

### 🏆 H4 (16+ semaines) — Mode agence / enterprise

#### 16. White-label complet
- Domaine custom par client agence (cname.socialflow.io)
- Logo + couleurs + email sender configurables
- Page de validation client white-labeled (sans branding SocialFlow)

#### 17. Workflow visuel drag-and-drop
- Constructeur de workflows à la Zapier/Make
- N8N-style canvas: triggers + actions + conditions
- Templates de workflows par cas d'usage

#### 18. CRM léger intégré
- Contact / Lead / Opportunity
- Pipeline visuel
- Email tracking par contact
- Score IA

#### 19. SSO + SCIM + audit avancé
- SAML (Okta, Azure AD)
- SCIM provisioning
- Compliance reports (GDPR, SOC2-ready)

#### 20. Marketplace de plugins
- API publique versionnée
- Documenté avec OpenAPI
- Plugins tiers (Zapier, Make)
- App Store interne pour agents IA custom

---

## Métriques de succès par horizon

| Horizon | Métrique | Cible |
|---|---|---|
| H1 | Tests coverage | 60% |
| H1 | Stripe revenue | $0 → premiers $$ |
| H1 | Build time | < 90s |
| H2 | Inbox messages traités | 1k/jour démo |
| H2 | Images générées IA | 1k/mois démo |
| H2 | Email open rate | > 25% |
| H3 | Tools agent | 21 → 50+ |
| H3 | Workflows actifs | 100+ par org |
| H4 | Revenue MRR | $10k+ |
| H4 | NPS clients agences | > 50 |

---

## Stack à ajouter

| Tech | Pour quoi | Priorité |
|---|---|---|
| **Vitest + Playwright** | Tests | H1 |
| **Sentry** | Error tracking | H1 |
| **Resend** | Transactional emails + email marketing | H2 |
| **Sharp** | Image processing | H1 |
| **pgvector** | Embeddings | H3 |
| **Inngest** | Workflow runtime | H4 (ou Render workers) |
| **Posthog** | Product analytics | H2 |
| **Trigger.dev** | Background jobs alternatifs à BullMQ | H2 |
| **Runway/Pika API** | Génération vidéo | H3 |

---

## Risques

1. **Coût IA** : si beaucoup d'utilisateurs activent l'IA réelle, la facture Anthropic/OpenAI peut exploser. → Quota par plan + rate limiting + caching des prompts identiques.
2. **API sociales review** : Meta/X/TikTok requièrent des reviews longs. → Démarrer le process d'app review **maintenant** en parallèle des features.
3. **GDPR** : stocker des contenus user generated = exposition GDPR. → DPA Supabase, droit à l'oubli, exports.
4. **Concurrence** : HubSpot et Sprout ont des budgets sales énormes. → Stratégie d'acquisition orientée agences (cibler les agences sous-équipées, white-label).

---

## Décision technique majeure à prendre (H1)

**Mono-repo vs split du worker** :
- Option A : tout dans le même repo, worker déployé sur Render
- Option B : split en 2 repos (web sur Vercel, worker sur Render)

**Recommandation** : Option A. Plus simple à itérer, partage du Prisma schema.

---

## Next 3 actions concrètes (cette semaine)

1. **Setup Vitest** + écrire 20 tests sur les services principaux (`AIProviderService`, `CanvaConnectService`, `SocialPublisherService`, `OperatorAgent`)
2. **Brancher Stripe webhooks** + page billing interactive
3. **Implémenter upload Supabase Storage** + composant `<MediaUploader/>` réutilisable
