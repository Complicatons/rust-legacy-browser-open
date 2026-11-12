---
date: 2026-10-22
title: Aiming, draw sounds and explosion flashes like the original
summary: A third check of the original game's code against the port found guns that aimed wrongly, held items that drew in silence, and explosion flashes that were too bright for too long. All three now match the original.
stats: 3 | fixes from the original code; 18 | items with their own draw sound; 0.4 | look speed while aiming a gun; 0.25 s | explosion flash
media: m4-aim-sights.jpg | Aiming down the M4's sights: the look speed drops to 0.4, as in the original; explosion-flash.jpg | An F1 grenade at night: the flash lights the ground and is gone a quarter of a second later
---

We compared the original 2014 game's code with the browser port again, this time looking at item behaviours, sounds, other players, wildlife and world effects. Most of it already matched. These three things didn't.

## Aiming a gun

In the original, holding the right mouse button with a gun slows your look speed to 0.4, so small corrections are easier. The port only did this for the bow. Aiming now also follows the original's rules: you can't aim while reloading or right after a Bolt Action shot, and the HandCannon never aims, even though the port used to zoom it.

## Draw sounds

Every gun, tool, torch, flare and grenade in the original plays a sound when you take it out: the M4 and MP5 have their own, the Revolver cocks, the Bolt Action Rifle has its own draw, and tools rustle. 18 items have one. The port never played them; now it does.

## Explosion flashes

The flash from an F1 grenade or an Explosive Charge used made-up brightness and timing. It now uses the original's: it starts at its full strength, is gone after a quarter of a second, and the explosion sound's pitch varies slightly each time.

## What's next

Smaller differences from the same check are listed for later, such as the brief spark of light from bullets hitting metal and the slight drift of a gun while aiming.
