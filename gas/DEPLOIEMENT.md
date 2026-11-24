# Déploiement Google Apps Script (backend du formulaire d'inscription)

## Prérequis
- Un compte Google
- Une Google Sheets vierge (pour stocker les candidatures)

## Étape 1 — Créer la Google Sheets
1. Ouvrez [sheets.google.com](https://sheets.google.com) et créez une nouvelle feuille.
2. Donnez-lui un nom (ex: "Candidatures Concours").
3. Copiez l'**ID de la feuille** dans l'URL : `https://docs.google.com/spreadsheets/d/<ID_ICI>/edit`

## Étape 2 — Créer le projet Apps Script
1. Ouvrez [script.google.com](https://script.google.com)
2. Cliquez sur "Nouveau projet"
3. Copiez-collez le contenu de `gas/Code.gs` dans l'éditeur
4. **IMPORTANT** : remplacez `SHEET_ID` par l'ID de votre Google Sheets (ligne 4)

## Étape 3 — Déployer comme application web
1. Cliquez sur "Déployer" → "Nouveau déploiement"
2. Sélectionnez le type "Application web"
3. Configurez :
   - **Exécuter en tant que** : Moi
   - **Qui a accès** : Toute personne disposant du lien
4. Cliquez sur "Déployer"
5. Copiez l'URL de déploiement (ex: `https://script.google.com/macros/s/ABC123/exec`)

## Étape 4 — Lier l'URL au formulaire
1. Ouvrez `formulaire-inscription/index.html`
2. Remplacez `REMPLIR_AVEC_VOTRE_URL_DEPLOIEMENT` (variable `GAS_URL`, vers le début du fichier) par l'URL copiée à l'étape 3.

## Fonctionnement du backend
- **doGet** : retourne le statut ouvert/fermé du concours (dates en dur dans Code.gs)
- **doPost** : reçoit le formulaire, vérifie le honeypot, le rate-limit par IP, le doublon téléphone, puis écrit dans la Google Sheets
- **Réponse** : JSON `{ status: 'ok', reference: 'ENT-YYYY-XXXX' }` ou une erreur

## Limites connues (mode statique sans build)
- Le frontend utilise `fetch` en `mode: 'no-cors'` (contrainte navigateur pour les requêtes cross-origin vers GAS sans proxy CORS). La réponse du serveur ne peut pas être lue côté client : l'affichage de confirmation suppose l'envoi réussi. Le GAS gère les refus côté serveur (doublon, hors période, rate-limit) et renvoie une erreur HTTP si besoin.
