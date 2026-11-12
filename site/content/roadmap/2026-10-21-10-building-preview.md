---
date: 2026-10-21
title: The original building preview
summary: Holding a building piece or a deployable now shows the original see-through preview, pulsing green or red, with the bouncing arrow on deployables and the explosive charge's highlight on its target.
stats: 35 | items with the original preview; 2 | preview materials; 3 | aim arrows; 0.5–0.75 | pulse strength
media: placement-wall.jpg | A wall between two pillars: the original preview pulses green where it fits; placement-invalid.jpg | A foundation that doesn't fit turns red; placement-box.jpg | A storage box with its bouncing aim arrow; placement-foundation.jpg | A new foundation on open ground; placement-c4.jpg | An explosive charge aimed at a wall: the wall itself lights up
---

Until now, holding a wall or a camp fire showed a flat green or red copy of it. That was a stand-in. The original game draws its own preview, and the port now draws it the same way, from the game's own files.

## What changed

- **Building pieces** (foundations, pillars, walls, doorways, windows, ceilings, stairs, ramps) show the original see-through shell with its scrolling pattern. It pulses green where the piece fits and red where it doesn't.
- **Deployables** (camp fires, furnaces, boxes, beds, sleeping bags, doors, gates, spike walls and the rest) show the softer preview the original uses for them, with a small arrow that bobs up and down where the item will land.
- **Doors, gates and storage boxes** use the harder outline and their own arrow, as in the original.
- Edges glow brighter than faces you look at straight on, the way the original shader does it.
- **The Explosive Charge** lights up the door, wall or other piece it will stick to, with the original ring that spreads out from the charge, and hides its arrow while it does.
