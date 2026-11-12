---
date: 2026-10-21
title: Grenades bounce and roll
summary: Thrown grenades, supply signals and flares are now real physics objects with the original weights and materials, so they bounce, roll and come to rest the way the original's did.
stats: 3 | thrown objects; 1 kg | each; 0.25 | grenade bounciness; 3 s | grenade fuse
media: grenade-roll.jpg | Test run: an F1 grenade dropped on the meadow bounces and comes to rest on its side
---

In the original game the server simulates every thrown grenade, supply signal and flare as a physics object. The port used a simple stand-in: the grenade slid to a stop as soon as it touched the ground and never turned.

## What changed

- **Real rigid bodies.** Each thrown object is now a physics body built from the original prefab: its weight, air drag, spin drag, its round (grenade, supply signal) or stick-shaped (flare) collider, and its bounciness and grip on the ground.
- **Rolling.** A grenade that lands keeps rolling, and one dropped on a slope rolls down it. A grenade thrown along flat ground now rolls on to about 17 m before its 3 second fuse runs out, where the stand-in stopped at about 11 m.
- **Flares** tumble and lie on their side instead of sliding flat.
- **Bounce sounds** follow the original rule: only for a hit faster than 0.15 m/s, and at most one every quarter of a second.

The port's physics engine isn't the one the original used, so small details of each bounce can still differ.
