# Le format .animo

Un projet Animotion est un fichier **JSON**. Les projets enregistrés par l'appli stockent les images en PNG, mais Animotion accepte aussi une écriture **à la main** : les pixels en texte et des formes simples. C'est ce qui permet de faire créer une animation par Claude ou par une autre IA.

## Créer une animation avec Claude

Dans Animotion, va dans **Aide › Demander à Claude** (ou **Fichier › Depuis Claude**) :

1. **Copie le message** et colle-le dans Claude en décrivant ton animation.
2. **Colle la réponse de Claude** dans la case du bas, puis clique sur « Ouvrir l'animation ».

Les blocs ```json, les commentaires `//` et les virgules en trop sont acceptés.

## Le message pour Claude (la spécification)

```text
Crée-moi une animation pour le logiciel Animotion, sous forme d'un fichier .animo (du JSON).

MON ANIMATION : [décris ici ton animation : sujet, nombre de frames, taille, couleurs, pixel art ou dessin…]

FORMAT DU FICHIER .animo (JSON) :
{
  "app": "animotion",            // obligatoire
  "version": 1,
  "mode": "pixel",               // "pixel" (pixel art) ou "vector" (dessin vectoriel)
  "width": 16, "height": 16,     // taille du canevas en pixels
  "fps": 8,                      // images par seconde
  "palette": { "#": "#2f8cff", "o": "#ffec27", "x": "#ff004d" },   // couleurs des caractères (mode pixel)
  "layers": [ { "id": "fond", "name": "Fond" }, { "id": "perso", "name": "Perso" } ],   // du bas vers le haut
  "frames": [ { "id": "f1" }, { "id": "f2", "duration": 200 } ],   // duration en ms (facultatif)
  "cels": {                      // une entrée par case "idCalque:idFrame" (on peut aussi écrire "0:0", "1:0"… avec les numéros)
    "perso:f1": { "rows": ["....##....", "...####...", "..######.."] },
    "perso:f2": { "rows": ["....##....", "..######..", "...####..."], "x": 0, "y": 1 }
  }
}

RÈGLES MODE PIXEL :
- "rows" = lignes de texte, un caractère = un pixel. "." ou espace = transparent.
- Chaque caractère utilisé doit avoir sa couleur dans "palette" (globale) ou dans une "palette" propre à la cel.
- "x" et "y" (facultatifs) décalent le dessin dans le canevas.
- Les lignes doivent tenir dans width × height.

RÈGLES MODE DESSIN ("mode": "vector") — une cel = une liste de formes :
"cels": { "0:0": [
  { "type": "rect", "x": 10, "y": 10, "w": 100, "h": 60, "fill": "#2f8cff", "stroke": "#000000", "strokeWidth": 3 },
  { "type": "circle", "cx": 200, "cy": 80, "r": 40, "fill": "#ffec27" },
  { "type": "ellipse", "cx": 300, "cy": 80, "rx": 50, "ry": 30, "stroke": "#ff004d", "strokeWidth": 4 },
  { "type": "line", "x1": 0, "y1": 200, "x2": 400, "y2": 200, "stroke": "#ffffff", "strokeWidth": 2 },
  { "type": "path", "pts": [[50,250],[100,220],[150,260]], "stroke": "#000000", "strokeWidth": 5, "smooth": true }
] }

CONSEILS :
- Pour animer, fais varier légèrement le dessin d'une frame à l'autre (position, forme, couleur).
- Mets le décor fixe sur un calque à part, répété sur chaque frame.
- Réponds uniquement avec le JSON complet et valide (sans commentaires //), que j'enregistrerai dans un fichier mon-animation.animo puis ouvrirai dans Animotion.
```

## Valeurs par défaut

| Champ | Par défaut |
|---|---|
| `mode` | `pixel` |
| `width` × `height` | 32 × 32 (pixel) ou 800 × 600 (dessin) |
| `fps` | 12 |
| `layers` | un calque |
| `frames` | une frame (on peut aussi écrire `"frames": 8`) |
| couleur d'un caractère absent de la palette | magenta `#ff00ff` (pour le repérer) |
| `.`, espace, `_`, `-`, `0` | transparent |
| `stroke` / `strokeWidth` d'une forme | noir / 3 (pas de contour si seulement `fill`) |
