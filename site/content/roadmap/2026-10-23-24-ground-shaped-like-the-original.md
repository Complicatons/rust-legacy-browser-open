---
date: 2026-10-23
title: Ground shaped like the original
summary: The island's ground now has exactly the original's shape, so walking up a steep slope no longer gets you pulled back by the original server.
stats: 31 / 31 | server pull-backs explained; 0 | false pull-backs in 5,406 moves; 1.35 m | ground error at the gully; 1 in 8 | grid squares off by over 0.5 m; 29,050 | trees exactly on the ground
media: terrain-gully-6390.jpg | The rocky gully where the original server pulled our test player back 8 times. It walks straight up now; terrain-slope-5002.jpg | The slope where it was pulled back 8 times
---

On the original server, our test player kept getting pulled back on two steep slopes. Nothing blocked the way in our copy of the world, so the server had to be seeing something different.

## What it was

The island's ground is built from a grid of height points 7.8 m apart. Each grid square is drawn as two triangles, and the square can be cut corner to corner either way. We cut it the other way from the original. On a bend in a steep slope, that put our ground more than a metre lower than the original's in places, and higher in others.

The original server checks every step you take, about half a metre above your feet. Where our ground was lower, that check went into the original's ground, so the server pulled the player back.

## What changed

- **Same cut as the original.** Every grid square is now split the same way the original splits it, for walking, for the server checks and for drawing the ground.
- **Exact heights.** Heights now use the original's own scale, which also fixes a 1.3 cm offset across the whole island.
- **Proof.** All 29,050 trees on the island now sit exactly on the ground, and the original server's 31 pull-backs from three test runs all match.
