---
date: 2026-10-16
title: The original island
summary: Day one. The real Rust Legacy map, rebuilt in a browser tab from the game's own files.
stats: 8,739 | world objects; 29,050 | trees and plants; 80 | loot crate spawns
media: rocks-16oct.jpg | 16 Oct: the first look at the coast, straight from the original terrain data; rocks-close-16oct.jpg | 16 Oct: rocks and cliffs placed where the original map puts them; aerial.mp4 | The same island today, flown over in the browser; town-aerial.jpg | A town from above; door-garage.jpg | Test run: an original garage door, opened with E; loot-window.jpg | Test run: searching a crate in the original Loot window
---

The project started with one rule: this is **Rust Legacy**, not a new survival game. Everything on the island has to come from the original game files, read as data. The original client and server programs are never run, so all of this is rebuilt by reading the files rather than by watching the game play.

## The terrain

The first build read the island's height map, its ground textures and every original tree and bush placement out of the game's data. The heights were checked against 1,002 original tree positions: the median difference is about 1.3 cm. The textures blend the same way the original ground does: grass, dirt, sand and rock in the places you remember.

## Every rock, road and building

The first import used the server's copy of the map, which turned out to be missing most of the scenery. The client's copy has **9,292 objects** against 1,167 in the server's. Re-importing from the client brought back about 7,500 overlay rocks and cliffs, the warehouses, hangars, bunkers, apartments, walls, fences, pipes and roads. Nothing was placed by hand: every object sits where the original map puts it. The sea was also moved to the original water level, 252.4 m.

## Doors and loot

The same day the original doors started working: garage doors and hinged doors, opened by tapping E, with their original sounds and moving collision. Loot came next: the 80 crate spawns on the map, the 4 crate types and the 31 original loot tables, searched in the original Loot window.

The [island map](/island) shows the same data from above: buildings, roads, crate spawns and radiation zones.
