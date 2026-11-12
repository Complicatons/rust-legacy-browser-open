---
date: 2026-10-22
title: Wood piles and ore burst as they shrink
summary: When a wood pile or ore rock you are gathering gets smaller, it now throws up the original dust burst and sound, and the smaller model appears a moment later, as in the original.
stats: 2 | original effects added; 0.15 s | delay before the smaller model; 20 m | night range limit, as the original; 4 | open items left
media: resource-stage-dust.jpg | A wood pile shrinks: the original dust burst rises around it
---

Wood piles and ore rocks get smaller in steps as you gather from them. Until now the port swapped to the smaller model with nothing else happening.

## What changed

- **The original burst.** Each step plays the effect the original game ties to that node: a dust and wood burst for wood piles, a rock burst with the rock-breaking sound for ore. It lasts five seconds, like the original.
- **The original timing.** The burst starts first and the smaller model appears 0.15 seconds later, so the burst hides the swap.
- **The original limits.** No burst when a node first appears, and at night none for nodes more than 20 m from you.
- **Online too.** Nodes on a real server do the same when the server says they shrank.

## How it was checked

A browser test gathers from a wood pile, takes it down a step and checks the burst, where it plays and that the model swaps after 0.15 seconds.
