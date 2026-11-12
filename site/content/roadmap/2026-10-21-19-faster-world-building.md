---
date: 2026-10-21
title: Faster world building
summary: After the download, building the island on your computer is 3 seconds quicker, with the same collision and the same pixels.
stats: 11.1 → 8.4 s | join, next visits; 7.4 → 4.2 s | computer busy building; 2.7 → 0.6 s | collision; 0 | pixels changed
media: load-build-in-world.jpg | In the world after the join, terrain maps decoded the new way
---

The last loading update made downloads fast. What was left was the time your computer spends building the world after the files arrive: about 7 seconds of work before you could move.

## What changed

- **Collision builds about four times faster.** Before you can walk, the game sorts the island's 124,000 collision triangles into a search tree, testing each triangle against boxes millions of times. The test is now written out by hand with exactly the same arithmetic, and boxes a triangle clearly misses are skipped. The tree that comes out is identical, checked value by value, and thousands of test movements and shots give the same results.
- **The three biggest textures decode in the background.** The terrain and island maps are 4096 × 4096 pictures. The browser used to unpack them on the game's main thread while drawing the first frames. They are now unpacked on another thread while loading continues. Read back from the graphics card, every texel is the same.
- **Shaders were already prepared in parallel.** Most of the old "Preparing shaders" wait was really those big textures being unpacked.

## The result

Measured on our test PC with no network delay:

| | Before | Now |
|---|---|---|
| Join, next visit | 11.1 s | 8.4 s |
| Computer busy building | 7.4 s | 4.2 s |
| Collision | 2.7 s | 0.6 s |
| First frames | 1.9 s | 0.7 s |

The next step is the part of loading that still waits on one file at a time while setting up items and animals.
