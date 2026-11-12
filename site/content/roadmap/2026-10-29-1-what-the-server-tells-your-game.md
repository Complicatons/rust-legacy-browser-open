---
date: 2026-10-29
title: Torches online, and spawning after the island loads
summary: We checked every message the original server sends to the game and every one the game sends back; five did not work like the original and are fixed.
stats: 5 | online messages fixed; 11 | checked and already right; 0 s | you stand in the world before your island has loaded
media: remote-torch-night.jpg | Another player's torch at night: it now lights up from the message the original server really sends
---

The game talks to the original server with a fixed set of messages. We listed every one the original game receives and every one it sends, and compared each with what our port does with it. Most already matched. Five did not, and they are fixed now.

## What changed

- **You spawn when your island has loaded.** The original game tells the server it is ready only after the map has loaded. Ours told it straight away, so your character could stand in the world, and be attacked, while your browser was still loading. Now it waits, like the original.
- **Other players' torches and flares light up.** The original server never sends the "torch is lit" message we were listening for. It passes on the other player's own "light it" and "put it out" actions instead. Other players' torches and flares now light up and go out from those, also for someone who was already holding a lit torch when you joined.
- **Thrown grenades, flares and dropped items move smoothly.** Their positions and bounces now follow the server's own timing, the same way players and animals already did, instead of the moment the message reached your browser.
- **Your inventory is asked for when you spawn.** Like the original, the game now asks the server for your full inventory every time your character appears.
- **A server correction also turns your view back.** When the server puts you back after a rejected move, it also restores where you were looking, as in the original.

## How it was checked

New tests cover each fix, one of them through our test gateway and test server. The full online browser test passes, now with the torch lit the way the original server lights it. None of this has been tried on the original server yet.
