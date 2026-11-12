---
date: 2026-10-21
title: A smaller download
summary: Joining the island now downloads 177 MB instead of 210 MB, with exactly the same picture.
stats: 210 → 177 MB | download per load; 33 MB | saved; 0 | pixels changed
media: island-view.jpg | The island from above, with the terrain and rock maps loaded from the new smaller files
---

The game loads everything it needs before you spawn, so the download size decides how long you wait on the loading screen. We measured what the page fetches and found two easy wins.

## Three big maps

Most of the island's textures already use a compressed format that graphics cards read directly. Three didn't: the terrain's normal map and the two large maps that colour and shade the rocks. They are too big for that format's encoder, so they were still sent as PNG files, 65 MB together, almost a third of the whole download.

They are now sent as lossless WebP files instead: 46 MB for the same three images. Lossless means every pixel is identical. We checked it by loading both versions on the graphics card and comparing them pixel by pixel.

## Grass only when you want it

Grass is off by default. Its textures (8.6 MB) were still downloaded on every load. Now they are only fetched when you switch grass on in the options.

## The result

210 MB became 177 MB, 16% less, with the same picture and the same frame rate. On a 50 Mbit/s connection that is about 5 seconds less on the loading screen.
