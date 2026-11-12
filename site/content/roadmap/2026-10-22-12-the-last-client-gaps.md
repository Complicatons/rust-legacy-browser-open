---
date: 2026-10-22
title: The last gaps in the game client
summary: We checked every open item left from three comparisons with the original game. Most were already done. The last three are now fixed: guns drift while you aim, bullets spark on metal, and the camera's near cut-off adapts like the original's.
stats: 3 | fixes from the original; 0.1 s | metal spark; 0.22–0.65 m | near cut-off; 64 | camera rays a frame
media: metal-spark.jpg | An M4 shot hits a metal foundation at night. The small orange glow at the hit lasts a tenth of a second, as in the original; near-plane-wall.jpg | Standing against a warehouse wall: the camera's near cut-off has moved in to 0.27 m, so the wall still draws
---

Three comparisons of the original 2014 game's code with the browser port left a list of open items. We checked each one against the port's code. Most had been finished in later work, so we fixed the three that were really left.

## Guns drift while you aim

In the original, a gun drifts slightly while you aim down its sights. The Bolt Action Rifle drifts the most, and crouching reduces it. The drift comes from Unity's built-in noise function, which isn't in the game's scripts, so the port couldn't copy it.

We read that function from the original game's program file, without running it. It is the standard "improved Perlin noise", adjusted slightly by Unity. The port now uses the same noise, so the drift matches the original.

## Sparks on metal

A bullet hitting metal in the original gives off a short orange flash of light, about a metre across, that fades within a tenth of a second. The port showed the sparks but not the light. It now has both, for bullet, melee and arrow hits.

## The camera's near cut-off

A game camera doesn't draw anything closer than a set distance, its "near plane". The original moves this distance between 0.22 and 0.65 metres each frame. It casts 64 short rays from the camera, pulls the near plane in when you stand close to a wall, and pushes it back out in the open. The port used a fixed 5 centimetres. It now does the same as the original, in about a tenth of a millisecond per frame.

## What's left

Four items still depend on things outside the client: testing against the real server, side-by-side screenshots from the original game, a laptop with built-in graphics, and some numbers in Unity's own navigation code.
