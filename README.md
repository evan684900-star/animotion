# Animotion

Logiciel d'animation image par image pour Windows (.exe), en **noir et bleu**, avec trois modes :

- **Dessin** : animation vectorielle avec des traits lisses qu'on peut modifier après coup (on déplace leurs points).
- **Pixel art** : une vraie grille de pixels, à la taille de ton choix.
- **Montage** : un vrai logiciel de montage vidéo multipiste (voir plus bas).

## Télécharger le .exe

Liens fixes, toujours vers la dernière version (recompilée automatiquement à chaque push sur `main`) :

- **[Animotion.exe](https://github.com/evan684900-star/animotion/releases/latest/download/Animotion.exe)** : se lance directement, sans installation
- **[Animotion-installateur.exe](https://github.com/evan684900-star/animotion/releases/latest/download/Animotion-installateur.exe)** : installeur avec raccourci

> Il faut WebView2, déjà présent sur Windows 10 et 11.

**Mises à jour automatiques** : au démarrage, Animotion regarde s'il existe une version plus récente sur GitHub et propose de l'installer en un clic (téléchargement, remplacement de l'exe, redémarrage). Tu peux aussi vérifier à la main dans Aide › Mises à jour.

## Mode portable (clé USB, disque externe) 🔌

Lance `Animotion.exe` depuis une clé USB ou un disque externe : l'appli s'en rend compte toute seule (elle n'est pas sur le disque de Windows) et crée un dossier **Animotion** à côté de l'exe, où tout est rangé :

- `Projets` : tes projets .animo · `Exports` : vidéos, GIF et images exportés · `Médias du montage` : les copies des fichiers glissés dans un montage
- `Secours` : la copie de secours automatique · `Réglages` : les préférences de l'appli

Sur un autre PC, la clé peut changer de lettre (`E:` → `F:`) : les montages retrouvent quand même leurs vidéos. Pour forcer ce mode ailleurs, il suffit de créer un dossier `Animotion` à côté de l'exe.

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

Pendant qu'il travaille, une **souris fantôme « Claude »** clique sur les vrais boutons et dessine sous tes yeux (réglable dans Aide › Claude : actions visibles ou non, vitesse rapide, normale ou lente). Claude dispose de 39 actions : dessin (pixels, formes, lignes, rectangles, ellipses, pot de peinture, gomme), animation (frames, interpolation entre deux poses, déplacement, miroir, rotation, copie de cels), calques, couleurs et palettes, grille, pelure d'oignon, taille du canevas, retouche d'image, export…

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

## Mode Montage 🎬

Choisis **Montage** sur l'écran d'accueil (formats 16:9, 9:16 TikTok/Reels, 1:1, 4:5, 4:3, 21:9), ou clique sur **Fichier › Envoyer au montage** depuis une animation. Tu peux aussi glisser directement une vidéo ou une musique sur la fenêtre.

- **Médias** : vidéos (MP4, WebM, MOV…), images, GIF animés, musiques et sons, voix off enregistrée au micro, tes animations Animotion (.animo ou celle en cours)
- **🌐 Médias en ligne** : recherche d'images, de GIF animés, de musiques et de bruitages libres de droits (Creative Commons, via [Openverse](https://openverse.org)), écoute avant d'ajouter, filtre par licence (modifiable, usage commercial, domaine public) · le bouton **Crédits** prépare le texte à mettre dans la description de la vidéo, ou ajoute un générique de fin
- **Timeline en lignes universelles** : 3 lignes au départ, vidéo, son, texte ou effet sur n’importe laquelle (la Ligne 1 est en bas, les lignes du haut passent devant), une nouvelle ligne apparaît toute seule quand toutes sont occupées, ou avec « + Ligne » · couper (S), rogner par les bords, déplacer d'une piste à l'autre, dupliquer, copier/coller, supprimer et resserrer · aimantation · marqueurs · zoom · pistes muettes, masquées ou verrouillées
- **Aperçu interactif** : déplace, agrandis et tourne les clips directement sur l'image, avec des guides magnétiques · grille des tiers et zones de sécurité · plein écran
- **Par clip** : vitesse ×0,1 à ×10, volume jusqu'à 300 %, fondus du son, extraire l'audio, figer l'image, position/taille/rotation/opacité/miroir, recadrage, ajustement (contenir, remplir, étirer), 12 animations d'entrée et de sortie, mouvement de caméra (effet Ken Burns), 16 modes de fusion, incrustation fond vert avec pipette
- **Texte** : 10 styles prêts (titre, sous-titre, néon, gaming, BD, machine à écrire…), polices, contour, ombre, lueur, fond, effet machine à écrire · plus de 100 stickers emoji · 7 formes · fonds de couleur
- **90 transitions** en 6 catégories : fondus (encre, brûlure de pellicule, fuite de lumière, dissolution…), glissements (pousser, recouvrir, découvrir, rebond, élastique, panoramique rapide…), volets (stores, damier, horloge, radar, zigzag, vague, grille, bulles…), formes (iris, étoile, cœur, losange…), zoom et mouvement (cube, retourner la carte, tourbillon, chute, balancier…), stylisées (glitch, VHS, éclair, mosaïque, éclats, pellicule…) · une transition sur toutes les coupures en un clic, ou au hasard 🎲
- **100 effets** en 8 catégories : mouvement de caméra (séisme, caméra à la main, travelling, battement de cœur…), lumière (stroboscope, reflet d'objectif, rayons de soleil, projecteur, disco…), rétro et glitch (film ancien, écran cathodique, caméscope, 8 bits, points BD…), couleurs (caméra thermique, vision nocturne, pop art, duotone, rouge seul…), déformation (kaléidoscope, loupe, effet maquette, vagues…), cadres (polaroïd, bordure néon, viseur, jumelles…), particules et météo (pluie, orage, feux d'artifice, pétales, billets, ballons…), fondus · aperçu animé au survol et recherche
- **15 filtres** (vif, vintage, noir et blanc, ciné, néon, rêve…) + luminosité, contraste, saturation, teinte, flou, sépia… · **Mes filtres** : n'importe quelle image posée sur un clip, avec opacité et mélange réglables, mémorisée pour tous tes montages
- **Fond flou** automatique derrière une vidéo (pratique en format vertical)
- **Export rapide** : vidéo **MP4** (H.264) ou **WebM avec le son**, calculée par la carte graphique bien plus vite que la durée de la vidéo (résolution, images/s, qualité, passage choisi, bouton Annuler), **GIF** animé, **image PNG** de l'instant affiché · le son accéléré ou ralenti garde sa hauteur normale
- Annuler/rétablir illimité, copie de secours automatique, raccourcis clavier (F1 dans le montage)

## Fonctionnalités

| Onglet | Contenu |
|---|---|
| **Fichier** | Nouveau, Ouvrir, Enregistrer (.animo), Récents, Importer une image ou une spritesheet, Exporter, Envoyer au montage |
| **Accueil** | Crayon/Pinceau, Gomme, Remplissage, Pipette, Ligne, Rectangle, Ellipse, Sélection · Couleurs · Annuler/Rétablir, Copier/Couper/Coller · Miroirs et rotations · Taille du pinceau |
| **Calques** | Nouveau, Dupliquer, Supprimer, Fusionner, Ordre, Renommer, Visibilité, Verrou, Opacité |
| **Animation** | Ajouter/Dupliquer/Supprimer/Déplacer des frames, Lecture (boucle, ping-pong, une fois), FPS, Durée par frame, Pelure d'oignon |
| **Rendu** | GIF animé, Vidéo WebM/MP4, Séquence PNG (.zip), Spritesheet, Frame PNG · Échelle, fond transparent ou coloré |
| **Presets** | Tailles de canevas, Palettes (PICO-8, Game Boy, Sweetie 16…), Pinceaux enregistrés |
| **Affichage** | Zoom, Grille, Règles, Plein écran, Couleur d'accent |
| **Aide** | Raccourcis clavier (F1), Tutoriel, À propos |

## Développement

Bibliothèque incluse : [Mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2.0) pour décoder et encoder les vidéos du montage, voir `src/js/vendor/`.


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
