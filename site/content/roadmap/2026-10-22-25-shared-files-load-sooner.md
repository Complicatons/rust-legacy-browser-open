---
date: 2026-10-22
title: Crates, animals and buildables load sooner
summary: The files for loot crates, resource nodes, wildlife and buildable items now download while the trees and collision are being built, cutting the join's longest step from about 1.5 to 0.4 seconds.
stats: 4.9 → 3.1 s | join, next visits; 7.6 → 3.8 s | join, first visit; 1.5 → 0.4 s | longest step; 135/135 | textures identical
media: load-shared-in-world.jpg | In the world after the join
---

After the last round, the longest step of a join was "loading shared": the loot crates, resource nodes, wildlife, buildable items and the airdrop plane. Each group's files were only asked for once the group before it had been built, so most of that step was spent waiting.

## What changed

- **Their files are asked for earlier.** As soon as the island's buildings are in, the game queues every file those groups need, in the order it builds them. They download and unpack while the trees and collision are being set up.
- **A few other files start then too.** The animal animations, the animals' walking map and the physics engine start loading at the same point instead of one after another.
- **Everything is still built in the original order.** Only the downloads moved. The game builds each crate, node, animal and item exactly as before, so the world comes out the same.

## The result

Measured on our test PC with no network delay, old and new taking turns, three times each (the PC was busy with other tests, so single runs vary):

| | Before | Now |
|---|---|---|
| Join, next visit | 4.0 to 5.6 s | 3.0 to 4.4 s |
| Join, first visit | 7.2 to 8.1 s | 3.7 to 5.6 s |
| "Loading shared" step | 1.3 to 1.7 s | 0.35 to 0.43 s |

Every object, material and texture the join builds was checked against the old version, including all 135 textures as stored on the graphics card. Over a 30 ms, 100 Mbit/s link the first join is still limited by the download, so it stays at about 19 seconds.
