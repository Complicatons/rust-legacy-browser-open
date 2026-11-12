---
date: 2026-10-21
title: Loading in parallel
summary: Items, animals and resource nodes now load together instead of one file at a time, cutting another 1.5 seconds from joining.
stats: 8.8 → 7.2 s | join, next visits; 3.6 → 1.8 s | items and animals; 6 | files at once; 0 | pixels changed
media: load-parallel-in-world.jpg | In the world after the join
---

After the last update, one part of the loading screen still stood out: setting up crates, resource nodes, wildlife, deployable items and the airdrop. The game built each model only after its own file had arrived and its texture had been unpacked, then asked for the next one, so most of that time was spent waiting.

## What changed

- **Files are asked for ahead of time.** When the game starts on a group of models, it queues every file and texture they need. It still builds them one at a time in the original order, so everything comes out the same and draws in the same order. Checked object by object, material by material and texture by texture.
- **Six at a time, in order.** Asking for everything at once was slower on a real connection: the game's other requests got stuck behind hundreds of downloads. Six at a time, in the order they are needed, is faster both on our PC and over a link like the one to our test server.

## The result

Measured on our test PC with no network delay:

| | Before | Now |
|---|---|---|
| Join, next visit | 8.8 s | 7.2 s |
| Setting up items and animals | 3.6 s | 1.8 s |

Over a 30 ms, 100 Mbit/s link the first join is limited by the download itself (164 MB), so it stays about the same, at around 21 seconds.
