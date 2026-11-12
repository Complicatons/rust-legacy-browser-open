---
date: 2026-10-17
title: Locks, decay, saves and the navmesh
summary: Code locks, decay, the repair bench and spike walls; your single-player world now saves; wolves and bears find their way around.
stats: 4 | digit codes; 203,174 | navmesh polygons; 60 s | autosave
media: door-code-lock.jpg | Setting a code on a door lock; repair-bench.jpg | The repair bench; wolf.jpg | A wolf on the original navmesh
---

The same day filled in the rules that make a base worth defending, plus a few things single player needed.

## Bases

**Code locks** work as in the original: a 4-digit code, the owner and the players they let in, a 5 second back-off after a wrong code, and the original menu wording. **Decay** follows both of the original decay systems, with the original delays per material, roofs sheltering what is under them, and foundations, pillars and ceilings spared. The **repair bench** charges the original cost and lowers an item's maximum condition a little each time. **Spike walls** hurt anything that touches them once a second and reflect melee hits.

## Saves

The offline island now saves itself: buildings and their health, deployables and what is inside them, fires, locks, doors, decay timers, sleeping bag cooldowns, and your own inventory, vitals and position. It saves every 60 seconds and when you leave the page, and picks up where you left off next time. On a server, the server keeps the world, as in the original.

## The navmesh

Wolves and bears now walk on the original navigation mesh, read from the server's data: 119 tiles and 203,174 polygons covering the whole island. Predators follow paths around rocks and buildings instead of running into them, and an animal that spawns off the mesh is removed, as in the original. The item tooltips also arrived on this day, with every line the original shows.
