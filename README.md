# Animotion

Logiciel d'animation image par image pour Windows (.exe), en **noir et bleu**, avec deux modes :

- **Dessin** : animation vectorielle avec des traits lisses qu'on peut modifier après coup (on déplace leurs points).
- **Pixel art** : une vraie grille de pixels, à la taille de ton choix.

## Télécharger le .exe

Liens fixes, toujours vers la dernière version (recompilée automatiquement à chaque push sur `main`) :

- **[Animotion.exe](https://github.com/evan684900-star/animotion/releases/latest/download/Animotion.exe)** : se lance directement, sans installation
- **[Animotion-installateur.exe](https://github.com/evan684900-star/animotion/releases/latest/download/Animotion-installateur.exe)** : installeur avec raccourci

> Il faut WebView2, déjà présent sur Windows 10 et 11.

**Mises à jour automatiques** : au démarrage, Animotion regarde s'il existe une version plus récente sur GitHub et propose de l'installer en un clic (téléchargement, remplacement de l'exe, redémarrage). Tu peux aussi vérifier à la main dans Aide › Mises à jour.

## Interface redimensionnable

- Glisse les bords de la barre d'outils, du panneau de droite, de la timeline et de la colonne des calques (double-clic pour revenir à la taille par défaut).
- Change la largeur des frames de la timeline avec le curseur ou avec Ctrl+molette.
- Change la taille de toute l'interface avec Affichage › Plus petit / Plus grand (Ctrl+Maj+ / Ctrl+Maj−).
- Replie le ruban avec Ctrl+F1, et masque le panneau ou la timeline depuis l'onglet Affichage.

## Claude pilote Animotion (MCP)

Avec **Claude Desktop**, Claude peut piloter Animotion en direct : créer un projet, dessiner, ajouter des frames, regarder le résultat et exporter.

1. Dans Animotion : **Aide › Connecter Claude Desktop › Connecter automatiquement** (ou `Animotion.exe --mcp-install`).
2. Quitte complètement Claude Desktop, puis relance-le.
3. Demande par exemple : *« crée un slime de 16×16 qui saute en 6 frames et exporte un GIF »*.

Comment ça marche : Claude Desktop lance `Animotion.exe --mcp`, un pont sans fenêtre qui parle le protocole MCP. Ce pont transmet chaque action à la fenêtre Animotion ouverte (et l'ouvre si besoin) par une connexion locale (127.0.0.1) protégée par un jeton secret. Tout ce que fait Claude s'annule avec Ctrl+Z, et il ne peut pas écraser un projet non enregistré sans ton accord. Les exports vont dans `Documents\Animotion`.

Avec Claude Code : `claude mcp add animotion -- "C:\chemin\Animotion.exe" --mcp`.

## Importer des sprites depuis un script .js

Fichier › Importer › **Script .js** (ou glisse le fichier sur la fenêtre, ou « Depuis un script .js… » sur l'accueil) :

```js
const sprite = [
  "..########..",
  "..#.####.#..",
  "############",
];
// facultatif : couleurs par caractère (sinon tu les choisis dans la fenêtre d'import)
const palette = { "#": "#2f8cff" };
// plusieurs frames = une animation
const marche = [["..##..", "######"], [".####.", "#....#"]];
// tableaux de nombres + palette indexée
const coeur = [[0, 1, 0, 1, 0], [1, 2, 1, 2, 1]];
const couleurs = ["transparent", "#ff004d", "#ff77a8"];
```

Pour faire créer une animation complète par Claude, vois [docs/FORMAT-ANIMO.md](docs/FORMAT-ANIMO.md) (ou Aide › Demander à Claude dans l’appli).

Les caractères `.`, espace, `_`, `-` et `0` sont transparents par défaut. Le script s'exécute dans un bac à sable isolé : il n'a accès ni à l'appli ni à tes fichiers.

## Fonctionnalités

| Onglet | Contenu |
|---|---|
| **Fichier** | Nouveau, Ouvrir, Enregistrer (.animo), Récents, Importer une image ou une spritesheet, Exporter |
| **Accueil** | Crayon/Pinceau, Gomme, Remplissage, Pipette, Ligne, Rectangle, Ellipse, Sélection · Couleurs · Annuler/Rétablir, Copier/Couper/Coller · Miroirs et rotations · Taille du pinceau |
| **Calques** | Nouveau, Dupliquer, Supprimer, Fusionner, Ordre, Renommer, Visibilité, Verrou, Opacité |
| **Animation** | Ajouter/Dupliquer/Supprimer/Déplacer des frames, Lecture (boucle, ping-pong, une fois), FPS, Durée par frame, Pelure d'oignon |
| **Rendu** | GIF animé, Vidéo WebM/MP4, Séquence PNG (.zip), Spritesheet, Frame PNG · Échelle, fond transparent ou coloré |
| **Presets** | Tailles de canevas, Palettes (PICO-8, Game Boy, Sweetie 16…), Pinceaux enregistrés |
| **Affichage** | Zoom, Grille, Règles, Plein écran, Couleur d'accent |
| **Aide** | Raccourcis clavier (F1), Tutoriel, À propos |

## Développement

```bash
npm install
npm run serve        # tester l'interface dans le navigateur : http://localhost:8765
npm run dev          # lancer l'appli Tauri (Rust requis)
npm run build        # compiler le .exe
```

Structure :

- `src/` : l'interface (HTML, CSS et JavaScript, sans framework)
  - `js/doc.js` : le modèle du document (calques, frames, cels)
  - `js/tools.js` : les outils de dessin pixel et vectoriel
  - `js/render.js` et `js/view.js` : le rendu et la vue (zoom, grille, règles, pelure d'oignon)
  - `js/ribbon.js` : le ruban à onglets
  - `js/gif.js` et `js/zip.js` : les encodeurs GIF et ZIP faits maison
- `src-tauri/` : l'enveloppe native Windows (Rust/Tauri 2)
- `.github/workflows/build-windows.yml` : la compilation automatique du .exe
