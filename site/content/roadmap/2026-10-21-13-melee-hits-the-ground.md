---
date: 2026-10-21
title: Melee swings hit the ground
summary: Rocks, hatchets and pick axes now hit the ground (and only what the original's hit mask allows), with the original grass, dirt or sand impact and sound.
stats: 1.5 m | melee reach; 0.3 m | swing radius; 11 | layers a swing can hit; 1 | new console command
media: melee-ground.jpg | Test run: a crouched Rock swing at the meadow kicks up the original grass impact
---

A melee swing in the original game sweeps a 0.3 m ball out to the tool's reach and also checks the ground itself. The port only checked buildings, rocks, trees and objects, so a swing at the ground did nothing at all.

## What changed

- **The ground counts.** Crouched, or swinging at rising ground, the Rock, hatchets and pick axe now hit the terrain and play the original impact for the surface under you (grass, dirt, sand, rock). Standing on flat ground the ground stays out of reach, as in the original: every tool but the Uber Hatchet reaches 1.5 m and your eyes are 1.65 m up.
- **Only the original's hit layers.** Swings now use the game's own hit mask, so they pass through things the original never hit.
- **Player hit boxes online.** A swing at another player picks their head, chest or limb hit box the way the original does, and a swing that hits nothing while you stand right against another player still counts as a hit on them, as the original's fallback does.
- **gizmos.carrier** now works in the F1 console: it turns the explosive charge's target highlight on or off, as in the original.
