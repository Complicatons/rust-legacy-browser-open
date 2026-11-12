---
date: 2026-10-19
title: Ragdolls and the desktop layout
summary: Bodies fall as original ragdolls, impacts pick the right surface, dropped items land on the ground, and the inventory goes back to the original desktop windows.
stats: 23 | ragdoll bodies; 22 | joints; 60–120 | field of view
media: ragdoll.jpg | Test scene: a body settled with the original ragdoll; surface-wood.jpg | Test scene: a bullet hitting wood; dropped-item.jpg | A dropped item lying in the world; options-fov.jpg | Field of view and FPS counter in Options
---

## Surfaces and ragdolls

Every hit now finds the surface it struck, the way the original decides it: the terrain by its ground texture, buildings by their material, players and animals as flesh. Each surface plays its own impact effect and sound.

When a player dies, the body falls as the original ragdoll: 23 bodies joined by 22 joints with the original limits. Your own camera follows your body's head down. Bodies stay for the original 80 seconds.

## Dropping things

Drag an item out of the inventory and it is tossed into the world as the original half-size loot bag, rolls to a stop and can be picked up again with E. Online, the server decides where it lands.

## Desktop first

This was also the day the project committed to the desktop. Rust Legacy needs a keyboard and mouse, so the inventory went back to the original separate windows for armour, inventory and crafting, anchored and sized as in the original, instead of a layout squeezed for phones. Options gained a field of view slider from 60 to 120, the same setting as `render.fov` in the F1 console. Clicking the game captures the mouse; Escape or a key you choose releases it. Alt+Enter toggles fullscreen.

The original title-screen scene was also recovered from the game files that day: the burning barrel and the bear, ready for the front end.
