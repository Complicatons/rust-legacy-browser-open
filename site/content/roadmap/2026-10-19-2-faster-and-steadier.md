---
date: 2026-10-19
title: Faster and steadier
summary: A full review of the port: no more floating buildings, the island loads in less than half the time with a fifth of the memory, and a round of playtest fixes.
stats: 15.2 → ~6 s | load time; 1,554 → ~300 MB | memory; 376 → 226 MB | download
media: town-evening.jpg | Buildings sitting on the full-detail ground; forest-morning.jpg | The forest after the culling fixes
---

A review of everything built so far found problems worth fixing before adding anything new.

## Floating buildings

Buildings and roads seemed to float because the ground was simplified to one point every 31 m, for drawing and for walking alike. The ground is now drawn in chunks that keep full detail near you and simplify only in the distance, and walking, building and placing use every original height sample.

## Load time, memory and download

A collision structure was storing each of 124,000 triangles 68 times. Fixing it cut the island's load from **15.2 s to about 5 to 7 s** and memory from **1,554 MB to about 250 to 330 MB**, with the same results for every collision test. A 1.6 second freeze just after loading is gone, and large batches of rocks and trees are now split up so the ones behind you are skipped. The game files are now cached and compressed, so a visit downloads **226 MB instead of 376 MB**, and a repeat visit downloads almost nothing.

## Playtest fixes

A playtest found more: open stairs could not be climbed, there was no fall damage, melee had no hit sounds and the death screen was not the original. Movement now follows the original character controller, so stairs work at about 4 m/s up and down. Falls hurt with the original rules, including a broken leg that forces you to crouch. Melee swings and hits play their original sounds, the torch flame got its full original effect, and dying shows the original death screen and drops your inventory in a loot sack. Ctrl is the original crouch key, so Ctrl+W no longer closes the tab while you play.
