---
date: 2026-10-23
title: Gunfire, grenades and ragdolls like the original
summary: Twelve small combat differences from the original game, checked against its code. Eleven now match it; the twelfth turned out to match already.
stats: 11 | fixes from the original code; 75 m | tracer push range; 0.75 s | to ready a tool; 0.92–1.08 | gunshot pitch
media: gunfire.mp4 | Test run: M4 bursts with tracers, then an F1 grenade going off 15 m ahead; m4-burst.jpg | Test run: an M4 shot on the offline island, muzzle flash and smoke
---

We compared how fighting looks and feels in the original 2014 game with the browser port, one rule at a time.

## What changed

- **Metal bars windows.** They have an invisible box that only stops players. In the port it also stopped bullets, arrows, hits and grenades. Now you can shoot through the bars, as in the original.
- **Dying offline.** You now fall as a ragdoll and the camera stays at your head, as it already did online.
- **Tools.** A rock or hatchet takes 0.75 s to ready after you take it out, and right-click pauses your swing, as in the original.
- **Shotguns.** Pellet tracers start at your eyes, and a shotgun no longer scares nearby animals. Only single-bullet guns did that in the original.
- **Gunshots.** Your own shots now vary slightly in pitch each time.
- **Grenades.** The blast now pushes bodies lying nearby, and the explosion shows where the grenade lay, not 0.3 m above it.
- **Tracers.** A bullet only pushes a body when it lands within 75 m of you.
- **Bow.** Letting an arrow go no longer jolts the bow like a gunshot.
- **Other players.** Their shots, swings and falling bodies now play on the same short delay that their movement is shown with, so they line up with what you see. Your own damage effects wait for that delay too, as in the original.

## Already the same

Another player lighting a flare is silent, in the original too: its strike sound was never filled in.
