---
date: 2026-10-23
title: Terrain detail like the original
summary: The island's ground now picks its level of detail the way the original game did, by how big the difference would look on your screen, not by fixed distances.
stats: 30 px | allowed ground error; 3.7× | fewer ground triangles, high view; 5 | detail levels; 83 ms | one-time setup
media: terrain-lod-before.jpg | Before: fixed distance rings drew far hills in more detail than the original; terrain-lod-after.jpg | After: the original 30-pixel rule, so far hills are smoother, as in the original
---

Until now the ground got simpler in fixed steps as it got farther away, whatever your screen size or zoom. The original game used Unity's terrain rule with its own setting: draw each patch of ground as simply as possible, as long as the shape stays within 30 pixels of the real heights on your screen.

## What changed

- **Same rule as the original.** For every piece of the island and every detail level, the largest height difference from the full-detail ground is worked out once while loading. Each frame, each piece uses the simplest level that stays within 30 pixels.
- **Screen and zoom count.** A taller window or zooming in shows more detail. Flat ground stays simple even right under your feet, and rough ground nearby keeps every original height.
- **No seams.** Pieces at different levels still join without cracks.

## Still to compare

The original draws ground in smaller pieces than ours, so ours is sometimes a little more detailed, never less. We will check it against frames from the original game.
