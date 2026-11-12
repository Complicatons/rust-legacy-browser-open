---
date: 2026-10-21
title: Rocks and cliffs are solid
summary: The island's 8,344 rocks and cliffs now block players, bullets and building, as they did in the original game.
stats: 8,344 | solid rocks and cliffs; 7 | rock shapes; 0 ms | extra frame time
media: rock-top.jpg | Standing on top of a rock, 39 m above the ground below; rock-face.jpg | Test run: walking into a cliff face stops at the rock
---

Until now you could walk straight through every rock and cliff on the island. They were drawn, but nothing stopped you, your bullets or a wall you were placing.

## What the original did

The original game doesn't store these rocks as normal scene objects. One object on the island holds a list of 8,344 placements of 7 rock and cliff shapes. When the map loads, the game turns each placement into a solid rock, on both the server and your client. Our port read the island's other colliders but never this list, so the rocks had no collision.

## What changed

- The list is now read straight from the original island data, so every rock and cliff is solid in the same place as the one you see.
- You can climb onto rocks and stand on them, and cliffs block you.
- Bullets and arrows stop at rocks, and you can't place things inside them.
- The server-side anti-cheat now counts rocks too, so a shot through a cliff no longer looks like a clear line.
- The 7 shapes are stored once and shared by all 8,344 placements, so collision stays cheap: frame times didn't change.
