# 森林战场派生资源 · 提示词记录

日期：2026-11-11。使用内置 imagegen，未使用 CLI/API 脚本。四次均以 `/Users/zj/Downloads/game/梦幻森林树桩防线地图.png` 为编辑/提取参考，原图未覆盖。

项目输出目录：`/Users/zj/cocos/NewProject/assets/resources/art/environment/`。这些是基于原图的分层重制，并非逐像素无损抠图。道路直接复用原图中的路面纹理，由游戏按真实道路几何绘制。

## forest_floor.png

透明背景：false。提示词：

```text
Edit target: the attached existing 941x1672 portrait forest tower-defense map. Produce ONE clean background plate for this same game scene, portrait 9:16. Preserve the reference image's warm hand-painted 2D art style, soft yellow-green grass, lighting, brush texture, trees/rocks/flowers around the outside borders, and approximate palette. Remove ALL sixteen tree stumps, ALL vines/berries covering those stumps, ALL beige roads throughout the image, the large guardian tree in the lower right, and the cave entrance at the upper left. Replace those removed objects with naturally continuous calm grassy clearing. The center 85 percent should be spacious, playable, softly textured open grass with very low contrast. Edge vegetation should be restrained and stay at the outside borders. No new objects in the clearing. No stumps, no dirt paths, no guardian tree, no cave, no purple crystals in the center, no characters, no symbols, no UI, no text. This is a background-extraction/object-removal edit, NOT a new map layout or a UI mockup. The actual roads, stumps, vines, and guardian tree will be separate interactive layers in Cocos. Keep similar framing and a clean finished game-art quality.
```

## stump_open.png

透明背景：true。提示词：

```text
Extract one clean OPEN tree stump from the supplied map (the uncovered light-wood stump in the first row). Create a faithful isolated game sprite of that same design, preserving its rounded shallow stump, creamy oval cut top with a few growth rings, warm golden bark, exposed little roots and tiny moss leaves at its base. Slight overhead orthographic view exactly as in the reference. Single stump centered on a SQUARE transparent canvas, full object visible, no vines or purple berries, no grass tile, no scene or dirt platform, no shadow rectangle. Use actual transparent alpha outside its silhouette, not a checkerboard. No text, numbers or UI. This is a game asset extraction from the reference, not a character redesign.
```

## stump_locked.png

透明背景：true。提示词：

```text
Extract one VINE-COVERED tree stump from the supplied map (first row second stump). Create a faithful isolated game sprite of that same design: the same shallow warm golden wooden stump with creamy oval cut surface, wrapped in tangled rounded green vines and leaves, with a small bunch of purple berries. Preserve the reference's overhead orthographic perspective, hand-painted brush texture, yellow-green lighting and outline. Single full object centered on a SQUARE transparent canvas. Actual transparent alpha around the entire silhouette. No surrounding grass tile, no ground platform, no rectangle shadow, no extra objects, no text, numbers or UI. This is a game asset extraction from the reference, not a new illustration.
```

## cradle_tree.png

透明背景：true。提示词：

```text
Extract the single guardian/cradle tree at the lower right of the supplied forest map as a faithful isolated game sprite. Preserve its exact visual idea: rounded yellow-green leafy canopy, small white blossoms, warm golden-brown intertwined trunk with two roots like embracing arms, a hollow holding a glowing golden leaf-shaped life seed, and small exposed roots and moss around the base. Same soft hand-painted 2D style, slight overhead orthographic perspective and left-top lighting. Full tree centered with a little padding on a SQUARE transparent canvas, canopy and roots completely visible. Actual transparent alpha outside the silhouette. Remove the surrounding forest, path, grass tile and rocks. No pedestal, no background scenery, no text, numbers, symbols or UI.
```

运行时透明裁边、九宫格/纹理采样与摆放参数见 [ART_ASSETS.md](ART_ASSETS.md)，验证结果见 [MVP_ACCEPTANCE.md](MVP_ACCEPTANCE.md)。本文件记录已实际使用的提示词，不表示未来扩展资源已生成。
