# SoloApp

Devis et factures. Application web installable, fonctionnement entièrement local.

## Mise en ligne

1. Créer un dépôt GitHub public nommé `soloapp`.
2. Y déposer tout le contenu de ce dossier **sauf** `activation/`, `node_modules/`,
   `test/` et `tools/` — le `.gitignore` s'en charge.
3. Réglages du dépôt → *Pages* → publier depuis la branche `main`, dossier racine.
4. L'adresse `https://<pseudo>.github.io/soloapp/` répond en HTTPS après deux minutes.

## Codes d'activation

Le dossier `activation/` ne quitte jamais votre machine.

```
node activation/generer.js 500
```

Produit :
- `activation/codes-disponibles.txt` — les codes à distribuer
- `activation/codes-attribues.txt` — à remplir à la main
- `activation/sel.txt` — le sel, à sauvegarder ailleurs
- `core/codes.js` — les empreintes embarquées dans l'application

Pour ajouter des codes, relancer le script puis republier `core/codes.js`.
Le sel doit rester identique, sinon les codes déjà distribués cessent de fonctionner.

## Installation côté utilisateur

Android : ouvrir le lien dans Chrome → *Installer l'application*.
iPhone : ouvrir dans Safari → *Partager* → *Sur l'écran d'accueil*.

## Développement

```
npm install
node --test test/core.test.js test/db.test.js
node tools/woff2ttf.js     # régénère les TTF embarqués dans les PDF
```

## Structure

```
core/     moteur : montants, totaux, numérotation, états, base, PDF
ui/       écrans
css/      feuille de style unique
vendor/   pdf-lib et fontkit, figés localement pour le hors-ligne
assets/   icônes et polices
```
