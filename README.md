# Animotion

Logiciel d'animation image par image pour Windows (.exe), en **noir et bleu**, avec deux modes :

- **Dessin** : animation vectorielle avec des traits lisses qu'on peut modifier après coup (on déplace leurs points).
- **Pixel art** : une vraie grille de pixels, à la taille de ton choix.

## Télécharger le .exe

Chaque push sur `main` compile automatiquement l'appli sur GitHub (onglet **Actions**, puis **Releases**) :

- `Animotion-portable.exe` : se lance directement, sans rien installer (environ 10 Mo)
- `Animotion_x.y.z_x64-setup.exe` : installeur classique

> Il faut WebView2, déjà présent sur Windows 10 et 11.

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
