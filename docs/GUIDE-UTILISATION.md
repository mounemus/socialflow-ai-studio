# SocialFlow AI Studio — Guide d'utilisation et architecture

> Mis à jour le 21/07/2026. Ce guide répond à trois questions : **à quel besoin
> l'application répond**, **comment elle est construite**, et **dans quel ordre
> l'utiliser** pour que chaque étape alimente la suivante.

---

## 1. Le besoin auquel l'application répond

Gérer la présence sociale d'une ou plusieurs marques exige normalement une
équipe : un stratège (quoi publier et pourquoi), un rédacteur (les textes), un
graphiste (les visuels), un community manager (publication, boîte de
réception), et un analyste (ce qui a marché). SocialFlow AI Studio compresse ce
travail en un seul outil piloté par IA, **sans jamais présenter une simulation
comme un résultat réel** : quand un fournisseur d'IA ou une plateforme sociale
est indisponible, l'application le dit, elle n'invente pas.

Concrètement, l'application répond à cinq besoins :

| Besoin | Ce que fait l'application |
|---|---|
| Définir l'identité d'une marque | Profil de marque enrichi par IA (ton, audience, couleurs, mots à éviter…) |
| Savoir quoi publier | Stratégie marketing générée (piliers, calendrier, items concrets) |
| Produire le contenu | Textes, visuels, carrousels, scripts vidéo et vidéos réelles, designs Canva |
| Publier et diffuser | Publication réelle (Meta/LinkedIn), passerelle Zernio/Late, partage manuel outillé |
| Apprendre et s'améliorer | Analytique, score qualité, recommandations, routage IA par fiabilité observée |

---

## 2. Architecture — les couches

```
┌──────────────────────────── UI (Next.js App Router) ────────────────────────────┐
│  5 espaces : Accueil · Planifier · Créer · Engager · Mesurer                    │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │  routes API (multi-tenant : requireTenant/RBAC)
┌──────────────────────────────────▼──────────────────────────────────────────────┐
│                              SERVICES MÉTIER                                    │
│  BrandPipelineService (onboarding 5 actes)   MarketingStrategyService           │
│  ConcretizationService (items → posts+visuels)  ContentProductionService        │
│  SocialGatewayService (native / Late / manuel)  InboxIngestionService           │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────────────────────┐
│                     COUCHE IA — AIRouterService (l'orchestrateur)                │
│  · table de routage par type de tâche (texte stratégique, image avec texte…)    │
│  · réordonnancement par fiabilité observée sur 7 jours (mode AUTO)              │
│  · préférences par organisation (Paramètres → Modèles IA : AUTO ou FORCÉ)       │
│  · chaîne de secours : un fournisseur en panne ne bloque jamais la production   │
│                                                                                  │
│  Texte : Claude · GPT · Gemini      Image : fal.ai · Replicate · Nano Banana ·  │
│  DALL-E · Stability · Canva         Vidéo : Replicate · fal.ai (Kling, Seedance)│
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────────────────────┐
│  DONNÉES : PostgreSQL/Supabase (Prisma) · Supabase Storage (visuels) ·          │
│  Redis/BullMQ (files d'attente) · Vercel (déploiement serverless)               │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Le principe central** : l'IA (Claude) est l'orchestrateur intelligent — elle
choisit les fournisseurs, propose, explique les erreurs — mais le moteur
transactionnel reste la base de données et les files d'attente. L'IA n'est
jamais la seule mémoire d'un workflow.

**Pourquoi fal.ai est prioritaire pour les images** : fal.ai renvoie une URL
déjà hébergée. Les autres fournisseurs renvoient l'image en base64, qui doit
être enregistrée dans Supabase Storage — un maillon de plus qui peut casser
(et qui casse actuellement : politique RLS, voir §5).

---

## 3. La démarche d'utilisation — l'ordre logique

Le fil conducteur est toujours : **la marque d'abord, tout le reste en découle.**

### Étape 0 — Configuration (une fois)
`Paramètres` : clés API des fournisseurs IA (assistant d'intégration),
comptes sociaux, équipe. `Paramètres → Modèles IA` : laisser AUTO
(recommandé) ou forcer un modèle par catégorie texte/image/vidéo.

### Étape 1 — Créer la marque : deux chemins

**Chemin A — le pipeline guidé (recommandé pour une nouvelle marque)**
`Stratégie & pipeline → Nouveau pipeline`. Cinq actes s'enchaînent sur une
seule page, avec validation humaine aux moments-clés :

1. **Acte 1 · Déclaration** — nom, secteur, description ;
2. **Acte 2 · Enrichissement IA** — l'IA propose le profil complet (ton,
   audience, couleurs…), champ par champ, tu approuves ou édites ;
3. **Acte 3 · Stratégie** — l'IA génère un plan d'action en items concrets
   (posts, reels, carrousels), tu approuves item par item ;
4. **Acte 4 · Concrétisation** — chaque item approuvé devient un vrai post :
   caption + visuel généré (provider au choix ou Auto) ;
5. **Acte 5 · Passage à l'action** — planification calendrier + diffusion.

**Chemin B — manuel** : `Marques → Nouvelle marque`, puis « Tout remplir avec
l'IA » sur la fiche, puis `Marques → [ta marque] → Stratégie` pour générer la
stratégie seule.

### Étape 2 — Produire du contenu : l'Atelier créatif

`Créer → Atelier créatif`. Les onglets forment un couloir de production, de
gauche à droite :

```
Brief → Texte → Visuel → Carrousel → Vidéo/Reel → Canva → Versions & A/B
                                          → Aperçu → Validation → Diffusion
```

- **Brief** : choisis la marque et la plateforme — ce contexte suit
  automatiquement dans tous les onglets suivants (le badge en haut à droite
  rappelle la marque active) ;
- **Texte / Visuel / Vidéo** : chaque onglet a un bouton **« Rédiger avec
  l'IA »** qui transforme trois mots en prompt professionnel nourri du profil
  de la marque (via GPT). Ce que tu génères dans un onglet **reste en place**
  quand tu navigues entre les onglets ;
- **Aperçu / Validation / Diffusion** : rendu par plateforme, circuit
  d'approbation, puis publication (réelle si les comptes sont connectés,
  sinon partage manuel outillé vers LinkedIn, X, WhatsApp, etc.).

### Étape 3 — Planifier et publier
`Calendrier` pour placer les posts ; la publication passe par la passerelle
sociale (native Meta/LinkedIn, Late/Zernio, ou manuelle). Chaque tentative est
tracée (PublishAttempt) — un échec est visible, jamais maquillé.

### Étape 4 — Engager et mesurer
`Boîte de réception` (commentaires/messages, réponse assistée), `Social
Listening` et `Veille`, puis `Analytique`, `Rapports` et `Recommandations IA`
qui bouclent vers la stratégie suivante.

---

## 4. Où va quoi — table d'orientation rapide

| Tu veux… | Va dans… |
|---|---|
| Créer une marque de zéro avec l'IA | Stratégie & pipeline → Nouveau pipeline |
| Modifier le profil d'une marque | Marques → [marque] |
| Générer un post ponctuel | Atelier créatif (Brief → Texte → Visuel) |
| Regénérer le visuel d'un item de stratégie | Pipeline, Acte 4 → sélecteur Provider → Régénérer |
| Choisir quels modèles IA sont utilisés | Paramètres → Modèles IA |
| Voir ce qui part et quand | Calendrier / Publications |
| Répondre aux commentaires | Boîte de réception |
| Savoir ce qui a marché | Analytique / Rapports |

---

## 5. État actuel — points de configuration restants

Deux blocages **externes au code**, visibles dans les logs :

1. **Supabase Storage refuse l'écriture** (`new row violates row-level
   security policy`) : la valeur de `SUPABASE_SERVICE_ROLE_KEY` sur Vercel
   n'est pas la vraie clé *service_role* (une service_role contourne RLS par
   conception). → Supabase → Settings → API → copier la clé **service_role**
   (marquée « secret »). Tant que ce n'est pas fait, les images Gemini/DALL-E
   basculent automatiquement sur fal.ai — mais Nano Banana forcé restera sans
   visuel.
2. **Crédits Replicate épuisés** (erreur 402) : recharger le compte, ou
   laisser fal.ai prendre le relais (déjà automatique).
