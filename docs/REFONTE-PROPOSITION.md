# Refonte SocialFlow — proposition d'architecture, de démarche et d'ergonomie

> Proposition du 21/07/2026, fondée sur l'inventaire réel des fonctionnalités
> existantes (24 destinations de navigation) et les règles d'architecture
> d'information (navigation primaire ≤ 5 espaces, hiérarchie à deux niveaux,
> préservation d'état, une action principale par écran).

---

## 1. Diagnostic — pourquoi ça semble éparpillé

L'application a grandi par phases, et chaque phase a ajouté sa page. Résultat
mesurable :

- **24 destinations** dans la navigation (18 principales + 6 secondaires) —
  la norme ergonomique est de 4-5 espaces de premier niveau ;
- **4 surfaces différentes produisent du contenu** sans partager leur état :
  Pipeline (Acte 4), Atelier créatif, Design Studio, Publications ;
- **La marque n'est pas un contexte global** : on la choisit dans chaque
  outil séparément, et les listes (Campagnes, Publications…) mélangent
  toutes les marques de l'organisation ;
- **L'IA est une destination** (page Assistant, page Recommandations, page
  Production Intelligence) alors qu'elle devrait être **ambiante** — présente
  là où l'on travaille ;
- **Validations est une page à part** alors que valider est une étape du
  cycle de vie d'un post, pas un lieu.

## 2. Les trois principes de la refonte

### P1 — La marque est le contexte, pas une page
Un **sélecteur de marque global** dans la barre du haut (à côté du sélecteur
d'organisation), persistant (cookie + contexte React). Toutes les listes,
calendriers et statistiques se filtrent dessus. Un mode « Toutes les marques »
sert la vue agence. Fil d'Ariane : *Marque › Espace › Objet*.

### P2 — Un seul objet central : le Post, un seul cycle de vie
Tout converge déjà techniquement vers le modèle `Post` (l'Acte 4 crée des
posts via `ensurePostForItem`, l'Atelier enregistre des brouillons). La
refonte rend ce fait visible :

```
Idée → Brouillon → Prêt → Validé → Programmé → Publié → Mesuré
```

Une **File de production** (kanban par étape) devient la vue pivot du Studio.
Elle remplace les pages Publications + Validations : valider est une colonne,
pas une page. Le score qualité (aujourd'hui caché dans « Production
Intelligence ») devient un badge sur chaque carte et un garde-fou au passage
en « Validé ».

### P3 — L'IA est ambiante, pas une destination
- L'Assistant IA devient un **panneau latéral contextuel** (et ⌘K/Ctrl+K),
  qui voit la page courante — plus une page isolée ;
- « Rédiger avec l'IA » est déjà présent dans Texte/Visuel : on le généralise
  (carrousel, vidéo, Canva, réponses inbox) ;
- Les Recommandations IA deviennent des **widgets dans le Cockpit et la
  Mesure**, à côté des chiffres qu'elles commentent ;
- La « prochaine meilleure action » (déjà sur le dashboard) ouvre chaque
  espace.

## 3. La nouvelle navigation — 4 espaces + Réglages

| Espace | Contenu (fusion des pages actuelles) | Question à laquelle il répond |
|---|---|---|
| **Cockpit** | Tableau de bord + Recommandations + prochaine action + santé fournisseurs | « Qu'est-ce qui demande mon attention maintenant ? » |
| **Marque** | Marques + Stratégie & pipeline (5 actes) + Concurrents + Veille | « Qui est cette marque et quel est son plan ? » |
| **Studio** | Atelier créatif + File de production (ex-Publications+Validations) + Calendrier + Campagnes + Médiathèque + Design Studio (onglet Canva) | « Que produit-on et quand part-il ? » |
| **Radar** | Conversations (Boîte de réception + Social Listening fusionnés) + Analytique + Rapports | « Que se passe-t-il et qu'est-ce qui a marché ? » |
| *Réglages* | Comptes sociaux, Modèles IA, intégrations, Clients, Équipe, Facturation | hors navigation principale |

Navigation à deux niveaux : les 4 espaces en niveau 1, des onglets internes en
niveau 2. 24 destinations → 4 espaces, ~13 sous-vues. Toutes les URLs
actuelles sont conservées (redirections) — c'est un regroupement, pas une
réécriture.

## 4. La démarche utilisateur type (après refonte)

1. **J'arrive** → Cockpit : 3 posts à valider, 2 publications aujourd'hui,
   5 messages non lus, 1 recommandation. Chaque carte est une action.
2. **Nouvelle marque** → Marque → Nouveau pipeline (les 5 actes, inchangés).
   À la fin, les posts créés apparaissent dans la File de production.
3. **Production quotidienne** → Studio → Créer (l'atelier actuel, contexte
   marque automatique) → chaque création rejoint la File.
4. **Validation** → Studio → File de production, colonne « Prêt » : aperçu
   par plateforme, score qualité, approuver = glisser en « Validé ».
5. **Publication** → colonne « Programmé » alimentée par le Calendrier ;
   publication réelle ou partage manuel outillé, chaque tentative tracée.
6. **Boucle** → Radar : conversations, chiffres, recommandations — qui
   renvoient vers la stratégie (Marque) ou la production (Studio).

## 5. Plan de migration en 3 phases (sans casse)

| Phase | Contenu | Effort | Risque |
|---|---|---|---|
| **A** | Sélecteur de marque global + filtrage de toutes les listes + regroupement de la navigation en 4 espaces (URLs conservées) | ~1 jour | Faible — regroupement visuel |
| **B** | File de production (kanban Posts) fusionnant Publications+Validations ; score qualité en badge ; Assistant en panneau latéral | 2-3 jours | Moyen — nouvelle vue pivot |
| **C** | Conversations (Inbox+Listening) ; Recommandations en widgets ; dépréciation des pages redondantes (/ai-studio autonome, page Production Intelligence) | 2 jours | Faible — fusions de lecture |

Chaque phase est livrable et utile seule. La Phase A répond déjà à 80 % du
ressenti « éparpillé ».

## 6. Ce que la refonte ne touche pas

Les services métier (pipeline, concrétisation, passerelle sociale, routage
IA), le modèle de données, et le principe de vérité opérationnelle. C'est une
refonte de **l'organisation et de la circulation**, pas des fondations.
