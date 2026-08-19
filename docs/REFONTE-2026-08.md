# Refonte générale — diagnostic, système cible, plan (17/08/2026)

> Objectif : un produit **fiable, cohérent, intelligent et simple** — un seul flux visible
> de bout en bout : *Marque → Plan → Contenus → Publication → Retours*, avec la
> publication possible **directement depuis le pipeline**.

## 1. Diagnostic (faits vérifiés, code + prod)

### 1.1 Surface : trop de destinations pour un seul flux
- Navigation : **18 entrées** en 4 groupes + 7 secondaires + admin (`navItems.ts`).
- Le cycle de vie d'un contenu est **étalé sur 6 surfaces** : `/create` → `/studio` (ou
  `/create/post`) → Pipeline Actes 3-5 → `/production` (kanban) → `/approvals` → `/calendar`
  (+ `/posts` legacy). Aucun « vous êtes ici » ne les relie.
- Doublons vivants hors nav : `/canva-studio` (copie de l'onglet Canva du Studio), `/inbox`,
  `/listening` (moitiés de `/conversations`), `/posts` (liste = kanban), `/assistant`
  (= panneau flottant), redirections `/ai-studio`, `/design-studio`, `/posts/[id]/edit`.
- Stratégie vs Pipeline vs Campagnes : la génération de stratégie existe en **deux endroits**
  (`/brands/[id]/strategy` + Acte 3 du pipeline) ; `/campaigns` montre « 0 post » alors que
  la stratégie liste ces campagnes EXECUTED.

### 1.2 Cohérence : quatre vocabulaires de statut pour un même contenu
| Surface | Vocabulaire |
|---|---|
| Production (kanban) | Idées / Brouillons / En validation / Validés / Programmés / Publiés |
| Stratégie (plan d'action) | proposé / approuvé / exécuté / rejeté |
| Validations | En attente / Approuvées / Rejetées |
| Pipeline (Actes 4-5) | DONE / APPROVED / EXECUTED / À VALIDER / SIMULATION / À PUBLIER |

Bugs de synchronisation constatés en prod :
- Post **« Publié »** dans Production, encore **« En attente »** dans Validations (rien ne
  ferme l'`ApprovalRequest` à la publication — `api/approvals/[id]/approve` seul le fait).
- Acte 5 affiche **SIMULATION** sur tous les items alors que `ENABLE_REAL_PUBLISHING=true`
  et que les comptes Zernio sont marqués « Publication auto ».
- Tableau de bord « 4 pipelines actifs » vs `/pipelines` = 1 (liste filtrée sur la marque
  active, le tableau de bord non — le contexte marque n'est pas appliqué partout pareil).
- Studio : « Aucune marque sélectionnée » alors que la marque active est UbSkilled ;
  panneau « Fournisseurs IA » bloqué sur « Chargement du registre… ».
- Conversations : la boîte Gmail complète (spam commercial, alertes Google, courrier
  administratif) est mélangée aux DM/commentaires sous « Tout ce que le public dit ».

### 1.3 Fiabilité technique
- Aucun cache client partagé (pas de SWR/React Query) : chaque page refait ses fetch,
  certaines ne se rafraîchissent qu'au rechargement complet.
- Kit UI maison minimal (`components/ui`: button, card, badge, input, empty-state…) —
  **pas de Dialog/Table/Tabs/Select partagés** : 4 modales réimplémentées.
- Deux façades IA en parallèle (`AIProviderService` legacy ×18 usages, `AIRouterService`
  ×22) — 3 fichiers importent les deux (migration inachevée).
- Modèles Prisma morts (0 usage) : `PlatformPermission`, `CalendarEvent`, `AIProvider`,
  `KeywordWatch`, `HashtagWatch`, `CompetitorSocialAccount`, `AnalyticsSnapshot`,
  `CampaignAnalytics`. `IntegrationProvider` liste 6 fournisseurs sans implémentation.
- 63 variables d'env ; capacités réelles centralisées dans `CapabilityService`
  (`/api/capabilities`) mais **pas affichées là où l'on publie**.
- Modules vides à parité visuelle avec les modules mûrs : Automatisations (0), Analytique
  (0 métriques), Calendrier (0 programmation), Campagnes (coquilles).

### 1.4 Ce qui marche bien (à préserver)
`/create` (entrée claire), Prospection, Veille marketing, Rapports, Bibliothèque, la
« vérité opérationnelle » (`PHASE0_TRUTH.md`), les contrats Zod partagés
(`src/lib/contracts`), `post-status.ts` / `pipeline-status.ts`, l'ingestion inbox
Zernio+Gmail (auditée le 17/08), la couche gateway (native / Zernio / manuel).

## 2. Système cible

### 2.1 Trois principes
1. **La marque est le contexte** (déjà en cookie) — *toutes* les listes s'y plient, y compris
   le tableau de bord ; « Toutes les marques » est un choix explicite du sélecteur.
2. **Un seul objet, un seul cycle** : le **Post**. Statuts uniques partout, tirés de
   `post-status.ts` : *Idée → Brouillon → Prêt → (Validé) → Programmé → Publié → Mesuré*.
   L'item de stratégie **dérive** son statut du post lié ; le pipeline **dérive** son
   avancement des posts. Validation = **porte optionnelle** (réglage d'organisation
   `requireApproval`, off par défaut pour un utilisateur seul).
3. **Publier là où l'on produit** : l'Acte 4 devient « Produire & publier » — chaque carte
   montre l'aperçu, la **destination réelle** (compte connecté / partage manuel / non
   configuré, via `CapabilityService`) et les actions *Programmer* / *Publier*. L'Acte 5
   devient le **suivi** (liens publiés, métriques, prochaine action). Plus d'étape
   intermédiaire « Marquer prêt » obligatoire.

### 2.2 Navigation cible : 6 espaces + Réglages (URLs conservées, redirections)
| Espace | Contient (fusion) | Question |
|---|---|---|
| **Accueil** | cockpit : à publier / à valider / messages / recommandations, parcours | Qu'est-ce qui demande mon attention ? |
| **Plan** | Stratégie + Pipeline (5 actes) + Campagnes | Quel est le plan de cette marque ? |
| **Contenus** | Créer (composer / atelier), File de production (kanban), Calendrier, Bibliothèque | Que produit-on, quand part-il ? |
| **Conversations** | Réseaux (DM/commentaires/mentions) · Emails · Écoute (listening) | Que dit-on de nous ? |
| **Croissance** | Prospection · Campagnes d'outreach · Automatisations | Comment trouver des clients ? |
| **Mesure** | Analytique · Rapports · Veille · Recommandations IA | Qu'est-ce qui a marché ? |
| *Réglages* | Marques, Comptes, Équipe, Modèles IA, Facturation, Admin | — |

Règles : ≤ 6 entrées de niveau 1, sous-onglets internes, une action principale par écran,
badge de capacité réelle partout où une action externe est proposée.

### 2.3 Fiabilité
- Contrats Zod partagés étendus aux routes publish/schedule par item de pipeline.
- Publication idempotente (clé sur post+compte, `PublishAttempt`), fermeture automatique
  des `ApprovalRequest` à la publication, `PostSchedule` unique par post/compte.
- Statut item ⇐ statut post (write-through déjà amorcé par `markLinkedItemReadyFromPost`,
  à généraliser dans un `PostLifecycleService` unique).
- Registre de capacités affiché sur chaque carte publiable (plus de « SIMULATION » faux).
- Tests : contrats + machine à états (vitest), parcours Playwright *marque → pipeline →
  publier* en mode simulation.

## 3. Plan par phases (état au 17/08/2026, soir)
| Phase | Contenu | Statut |
|---|---|---|
| **P1 — Publier depuis le pipeline + vérité des statuts** | Acte 4 « Produire & publier » (destination réelle + Programmer/Publier par carte et en lot), Acte 5 = suivi dérivé des posts, plus de redirection auto, badge SIMULATION vrai, porte de validation optionnelle (`requireApproval`), approbations fermées à la publication, garde anti double-publication, `resolvePublishTarget` partagé, « Publier » aussi dans la file de production | **livré, déployé** |
| **P1b — Cohérence** | Studio ⇐ marque active (listes progressives), registre IA avec erreur/réessai, Conversations Réseaux \| Emails, cockpit et /pipelines même périmètre de marque, libellés pipeline alignés | **livré, déployé** |
| **P2 — Navigation 6 espaces** | Accueil · Plan · Contenus · Conversations · Croissance · Mesure (+ Réglages), groupes repliables, Validations retiré de la nav, titre Recommandations IA aligné, réglage « Exiger une validation » | **livré, déployé** |
| **P3 — Assainissement** | code mort (dispatchItemAction, routes item action/ready sans appelant, renderReportPdf en double, /canva-studio → redirection) | en cours |
| **P4a — livré** | `/api/posts` : select léger + `stripDataUrls` (8,7 s → ~1 s attendu) ; compteur Acte 3 aligné sur l'Acte 4 (contenus validés = approuvés + produits) | **livré, déployé** |
| **Décision IA** | Migration `AIProviderService` → `AIRouterService` **NON faite volontairement** : analyse (23 appels) montre que le routeur dégrade *silencieusement* en contenu MOCK quand tous les fournisseurs échouent (contraire à la vérité opérationnelle) et 5 méthodes n'ont pas d'équivalent ; la façade legacy est ré-exportée par le routeur (coexistence assumée). À reprendre seulement après avoir retiré la dégradation mock du routeur. | décidé |
| **P4 — À faire (proposé)** | suppression des 8 modèles Prisma morts (destructif : accord requis), Dialog/Tabs partagés, cache client (SWR), Playwright *marque → pipeline → publier* en simulation, ~~Studio onglet Validation/Diffusion à réaligner sur le cycle unique~~ (fait le 19/08, §3bis), dashboard « Parcours » 7 étapes à recaler sur les 5 actes | à planifier |

## 3bis. Passe fiabilité du 19/08/2026 — Studio, vidéo, publication

### Symptômes rapportés (prod)
- Atelier → Aperçu d'un Reel Instagram : mockup noir, pas de vidéo ; onglet Vidéo/Reel : « Aucune vidéo
  attachée » alors qu'une vidéo venait d'être générée.
- Atelier : impossible de publier sans passer par Validation → Production.
- Logo de marque incrusté avec fond blanc ; réglages du logo sans aperçu.
- Late API 400 « Aspect ratio 0.56:1 outside Instagram's allowed range » malgré la route de recadrage.

### Causes racines trouvées (code) et correctifs
| # | Cause | Correctif |
|---|---|---|
| 1 | Le Studio et la vue publication lisaient `media.type` ; le champ Prisma est `kind` → une vidéo n'était **jamais** reconnue (aperçu vide, éditeur vidéo absent, vidéo prise pour une image dans le carrousel) | `src/lib/media-kind.ts` (`isVideoMedia`, `isVideoFormat`) partagé client/serveur ; Studio, PostDetail, CarouselEditor, post-media, Late, Instagram natif l'utilisent |
| 2 | `publishableMediaUrls` : pour un Reel, la couverture image (`coverMediaId`) gagnait sur la vidéo → un Reel publiait une **image** | format vidéo ⇒ la dernière vidéo attachée part, quelle que soit la couverture ; PostDetail et Aperçu appliquent la même règle |
| 3 | Onglets Validation + Diffusion du Studio : seule la programmation par compte, demande de validation systématique | Onglet unique **Publier** = `components/publish/PublishActions` (même composant que `/posts/[id]`) : destination réelle affichée avant d'agir, Publier maintenant / Programmer / Partager manuellement / Republier, validation proposée **seulement** si `requireApproval` ; `GET /api/posts/[id]` renvoie `destination` + `requireApproval` |
| 4 | Logo à fond blanc opaque collé tel quel | `lib/logo-knockout.ts` (détourage par remplissage depuis les bords, blancs intérieurs conservés) ; `GET /api/posts/[id]/brand-logo` sert le logo détouré pour l'aperçu CSS temps réel |
| 5 | `publishableMediaUrls` : `coverUrl` introuvable en base ⇒ URL brute envoyée sans passer par `/raw/instagram.jpg` | si gabarit exigé et média introuvable, repli sur le dernier média (recadré) — plus jamais l'URL brute |
| 6 | `manual-share` : pas de `closePendingApprovals`, pas de porte de validation, permission `post.edit` | aligné sur `/publish` (`social.publish`, `assertPublishable`, fermeture des demandes) |
| 7 | `generate-video` : échec d'enregistrement avalé (`.catch(() => null)`) → toast « ajoutée à la médiathèque » mensonger ; deux polls pouvaient créer deux médias | `persistVideo` idempotent (par URL), erreur remontée et affichée |
| 8 | Détection vidéo Late = `.endsWith('.mp4')`, Instagram natif = `.includes('video')` (image envoyée en REELS) | `isVideoMedia` partout |
| 9 | `MarketingStrategyService.executeItem` (Acte 4 / stratégie) : résolution de compte locale (compte déconnecté possible), programmation sans porte de validation | `resolvePublishTarget` + porte `requireApproval` (post laissé « En validation » au lieu d'être programmé) |
| 10 | Agent IA `schedule_post` et Automatisations `SCHEDULE_POST`/`PUBLISH_POST`/`REQUEST_APPROVAL` : compte non borné à l'org, pas de garde-fous, `mediaUrls: []`, « En validation » sans demande | mêmes garde-fous que `/schedule` ; `buildPublishInputFromSchedule` ; demande réelle ou APPROVED direct selon le réglage |

Tests : `tests/media-kind.test.ts`, `tests/logo-knockout.test.ts` ajoutés ; suite complète verte (202).

### Reste à faire (connu, non bloquant)
- Vidéos IA stockées en URL externe (fal.media / replicate) : pas de ré-hébergement Supabase → risque d'expiration
  pour un post programmé loin ; `VideoEditor` : « Enregistrer les repères/sous-titres » n'affecte pas la vidéo
  publiée (seul « Découper » crée un clip), et la découpe fetch l'URL externe côté navigateur (CORS).
- Production : bouton « En validation » visible même quand la porte est désactivée ; « Approuver » retombe sur un
  PATCH générique sans `ApprovalRequest`.
- `PublishInput.mediaUrls` reste `string[]` : la détection vidéo côté passerelles est par URL (extension).
- Le Studio garde 9 onglets ; « Versions & A/B » et « Canva » pourraient passer en sous-sections.

## 4. Règles pour la suite (à respecter par tout nouveau code)
- Un statut de post s'affiche **uniquement** via `post-status.ts` ; un statut de pipeline via `pipeline-status.ts`.
- Toute publication passe par `/api/posts/[id]/publish` ou `/schedule` (`resolvePublishTarget` + `assertPublishable` + `assertNotInFlight`) — jamais un autre chemin.
- Le pipeline ne stocke pas d'état de publication : il **dérive** tout du Post (`buildPublicationMap`).
- La marque active (cookie) borne toutes les listes ; « Toutes les marques » est un choix explicite.
- Une action externe (publier, envoyer, connecter) affiche sa capacité réelle avant d'être proposée.
