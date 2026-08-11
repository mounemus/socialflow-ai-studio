# Connecter Google (Gmail + Agenda)

SocialFlow utilise TON compte Google via OAuth 2.0 pour :
- **envoyer** les campagnes email (Diffusion) — `gmail.send` ;
- **recevoir** les emails entrants dans Conversations — `gmail.readonly` ;
- **synchroniser** les publications programmées vers Google Agenda — `calendar.events`.

Point d'entrée : **Connexions (Comptes sociaux) → carte « Google — Gmail & Agenda »**.

## 1. Créer un projet Google Cloud

1. Va sur <https://console.cloud.google.com/>.
2. Sélecteur de projet → **Nouveau projet** → nom : `socialflow`. Crée, puis bascule dessus.

## 2. Activer l'API

**Bibliothèque API** → active **Gmail API** ET **Google Calendar API**.

## 3. Écran de consentement OAuth

**APIs et services → Écran de consentement OAuth** :

1. *Type d'utilisateur* : **Externe** → *Créer*.
2. Nom : `SocialFlow`, emails d'assistance/développeur : ton email. *Enregistrer*.
3. **Étendues** : ajoute `https://www.googleapis.com/auth/gmail.send`,
   `https://www.googleapis.com/auth/gmail.readonly`,
   `https://www.googleapis.com/auth/calendar.events`, `openid`, `email`.
4. **Utilisateurs de test** : ajoute ton adresse Google. En mode "Test", seuls
   ces comptes peuvent se connecter — parfait pour un usage interne, pas de
   vérification Google nécessaire.

## 4. Créer un client OAuth

**Identifiants → Créer des identifiants → ID client OAuth** :

1. Type : **Application Web**, nom : `SocialFlow Web Client`.
2. **URI de redirection autorisée** :
   `https://socialflow-ai-studio.vercel.app/api/integrations/google/callback`
   (+ `http://localhost:3000/api/integrations/google/callback` pour le dev local).
3. *Créer* → copie **Client ID** et **Client secret**.

## 5. Variables d'environnement Vercel

```
GOOGLE_CLIENT_ID     = <Client ID>
GOOGLE_CLIENT_SECRET = <Client secret>
```

(`GOOGLE_REDIRECT_URI` optionnelle si le domaine diffère de `NEXT_PUBLIC_APP_URL`.)
Puis **redéploie** — les env vars ne se rechargent pas à chaud.

## 6. Connecter le compte

`/campaigns/outreach` → bannière bleue → **Connecter Gmail (Google)** → choisis
ton compte, accepte. Retour sur la page avec la bannière verte « Gmail connecté ».
Les campagnes email partent désormais de cette adresse ; sans connexion Gmail,
l'envoi retombe sur Resend (`RESEND_API_KEY`) s'il est configuré.

## 7. Sécurité

| Scope | Ce que SocialFlow peut faire |
|---|---|
| `gmail.send` | **Envoyer** des emails depuis ton compte. Ne peut PAS les lire ni les supprimer. |
| `openid email` | Identifier l'adresse connectée (affichée dans la bannière). |

Tokens chiffrés AES-256-GCM en base (`UserIntegration`, provider `GMAIL`),
refresh transparent. Pour révoquer : <https://myaccount.google.com/permissions>.

## 8. Rotation des secrets

Fuite du `GOOGLE_CLIENT_SECRET` → Console Google → Identifiants → *Réinitialiser
le secret* → mets à jour Vercel → redéploie. Les connexions existantes restent
valides.
