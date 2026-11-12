---
date: 2026-10-23
title: The original laser sight
summary: The laser sight now draws its beam and dot exactly the way the original game did, and soft smoke and flames fade against the same things they did in the original.
stats: 2 | quads in the dot; 12× | dot brightness range; 7 | mip levels per laser texture; 0 | GL errors
media: laser-night.jpg | The laser sight at night: the thin red beam with its shimmer, ending in the dot on the ground
---

Until now our laser was a stand-in: a glowing strip and a round sprite where it hit. It now uses the original game's own rules for drawing it, read from its code and its shaders.

## What changed

- **The beam.** Its width grows from the muzzle to where it lands, and it is turned to face you at each end separately, as in the original. It shimmers with the original noise texture, and it brightens the picture instead of adding light, so it shows clearly at night and fades into bright daylight, like the original.
- **The dot.** Two small squares: one facing you and one lying on the surface, nudged just off it. It only shows when the surface faces you and nothing is in the way.
- **Your own laser** is drawn with the gun's own field of view, on top of the world and under the gun, so it lines up with the barrel even when you zoom.
- **Textures.** The beam and dot use the game's own smaller copies of their textures, so a beam far away stays a thin line.
- **Flashlight.** Its soft round glow now lights the gun in your hands too, as in the original; another player's flashlight beam lights it as well.
- **Soft particles.** On the higher quality levels, smoke and flames fade where they touch the world. Tree leaves and distant tree cards were never part of that in the original, and now they aren't in ours either.

## Still to compare

Light brightness, and a few particle rules that live in the game engine itself rather than in its scripts, can only be matched exactly once we can compare frames from the original game.
