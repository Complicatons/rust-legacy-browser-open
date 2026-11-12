---
date: 2026-10-23
title: A full playtest after a night of fixes
summary: We played the whole game again, offline and online, after the night's movement, combat, building and wildlife changes. Two bugs came out of it and both are fixed.
stats: 2 | bugs fixed; 47 of 48 | online test rows passed; 6.3 s | to join the test server; 1,116 | automated tests
media: dead-save-before.jpg | Before: the offline game reopened after closing it on the death screen. The player is dead but walking, with an empty belt and no way to respawn; dead-save-after.jpg | After: the same save now starts a fresh character with the rock, bandage and torch
---

Several big changes landed overnight: how the player walks, sprints and jumps, how guns, grenades and ragdolls work, nine building rules and how animals move online. We played the whole game again from a fresh start to check that nothing broke.

## What we played

- **Offline:** gathering wood, stone and ore, hunting a boar, crafting, a camp fire for cooking and eating, falling and bandaging, a base with walls, a door, a ceiling, a box and a sleeping bag, respawning at the bag, raiding the door with an explosive charge, repairing the door frame, and bow, pistol, shotgun, grenade and hatchet fights. We also tested walking into spike walls, walking away from an open box, taking the wood out of a burning fire, the door's code lock, and saving and loading the game.
- **Online:** joining a test server, gathering, crafting, placing a camp fire, walking and jumping, the console, dying and respawning, and reconnecting. The automated online tests ran too: 47 of 48 test rows passed. The one that failed, hunting a chicken, passed when we ran it again; the bot had walked into a wall.

## What we fixed

- **Closing the game while dead.** If you closed the offline game on the death screen, or it saved while you were dead, it loaded back with you dead but walking around. You had no belt and no way to respawn. The original server clears a dead player's save to their inventory and blueprints, so the next time you join you start fresh. Ours now does the same, and saves made before this fix load as a fresh start too.
- **Animals and bodies.** In the original, animals ignore players' hit areas and corpses when they look for the ground under them. Ours could stand an animal on them. It now uses the same list of things to ignore as the original.

## Checked and working as in the original

Holding jump jumps once, not again on landing. A hatchet takes about a second to come out before you can swing or switch away. Spike walls hurt 20 every second you touch them, and hitting one hurts you back a little. A fall from 12 m does about 45 damage and breaks your leg. Walking speeds were the same online and offline: 4 m/s walking, 8 m/s sprinting and 2 m/s while crafting.
