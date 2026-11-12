---
date: 2026-10-18
title: Inventory, crafting and animation
summary: The original inventory grid and armour panel, batch crafting with the original blueprint list, and player animation layered the way the original does it.
stats: 6×5 | inventory grid; 12 | blueprint categories; 32,767 | max batch
media: craft.mp4 | Crafting from the original blueprint list; inventory-crafting.jpg | The inventory with the crafting window; rpos-tooltip.jpg | Test run: an item tooltip; animation-walk.jpg | Test scene: the original walk animation on the player model
---

## Inventory

The inventory was rebuilt from the original window layouts: the 6 by 5 grid of 64 px cells with 10 px gaps, the original cell art and shadows, stack counts in the original bitmap font, condition tints, mod indicators and the armour panel with its protection totals. Moving items still only sends a request; the server decides.

## Crafting

Crafting now works in batches as in the original. The blueprint list is grouped into the original 12 categories in the order you learned them. Pick an amount with the + and − buttons (Shift for 10, Ctrl for the maximum), and a batch takes the recipe time multiplied by the amount. Ingredients are only taken when the batch finishes, and cancelling costs nothing.

## Animation

Other players move the way they did in Legacy. Walking, running, crouching and jumping blend with the original transition timings, the legs follow one shared gait clock, and the upper body aims up and down while the legs keep walking. The animation layers are combined per bone with the original rules, including the original turn limits and a few quirks of the shipped game that were kept on purpose.
