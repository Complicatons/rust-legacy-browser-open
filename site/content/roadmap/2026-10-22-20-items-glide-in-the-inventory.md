---
date: 2026-10-22
title: Items glide in the inventory
summary: Picking up an item in the inventory now lifts its icon off the slot and glides it to your pointer, and putting it down eases it into the new slot as it fades, as in the original.
stats: 0.06 s | glide from the slot to the pointer; 0.1 s | ease into the new slot; 600 px/s | top glide speed, as the original; 2 | open items left
media: drag-icon.mp4 | Wood picked up, carried across the inventory and put down, then the rifle dragged to a new slot
---

Moving items around the inventory used to snap the icon to the pointer and make it vanish when you let go.

## What changed

- **Picking up.** The icon starts where the item sat and glides to the pointer, quickly but not instantly.
- **Putting down.** Drop an item on a slot and its icon eases into that slot while it fades. Let go somewhere that is not a slot and it eases back to where it came from.
- **Throwing away.** Dropping an item outside the inventory windows still throws it out at once, as the original did.

The timings and speeds are the original game's own numbers.

## How it was checked

Unit tests follow the icon frame by frame through the glide and the fade. A browser test picks up and drops items and checks where the icon is and how see-through it is along the way.
