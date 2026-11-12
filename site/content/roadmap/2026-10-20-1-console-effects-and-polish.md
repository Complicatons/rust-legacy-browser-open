---
date: 2026-10-20
title: Console, effects and polish
summary: The original F1 console and hold-E menu, more original effects, smarter animals, lighter textures and a polish round.
stats: 420 → 157 MB | textures; 6.05 → 2.90 ms | forest frame time; 90 s | flare burn
media: f1-console.jpg | The original F1 console; context-menu.jpg | The original hold-E menu; campfire-soft.jpg | Soft particles on a campfire; ktx2-world.jpg | Test run: the compound with compressed textures
---

## Round 5 (20 Oct)

Six pieces of work ran side by side to close more of the gap audit.

- **UI.** The F1 console is now the original console window, with its colours and quick buttons. Holding E opens the original context menu. Notices use the original popups and icons. A bug where doors opened towards the player was fixed along the way.
- **Console commands.** Hiding the UI, the version watermark, config load and save, server favourites, connect, disconnect and reconnect, and more of the original commands.
- **Items.** Item condition, breakage and armour wear follow the original. When crafting overflows a full inventory, the extra is lost, exactly as the original does it.
- **Movement and animals.** The original player capsule and crouch, the original collision layers, and offline wolves and bears that steer around obstacles and each other.
- **Effects.** Torches and fires flicker with the original light curves, and arrows leave the original trails.
- **Rendering.** Objects are hidden by distance per layer, as in the original: a forest view at Fastest dropped from 6.05 ms to 2.90 ms a frame. The sea now refracts what is under it.

## Polish

Ragdolls stay inside their joint limits, the code lock uses the original panel, a flare lights after 0.8 s, can be thrown and burns for 90 s, and smoke and flames fade softly where they meet the ground at the higher quality levels.

## Lighter textures

The game's textures are now also stored in a compressed GPU format, which cut them from **420 MB to 157 MB** and the measured load from 343 MB to 168 MB. If compression is not available, the original images are used instead.

A bug that stopped held items from showing at the default quality level was found and fixed the same day.
