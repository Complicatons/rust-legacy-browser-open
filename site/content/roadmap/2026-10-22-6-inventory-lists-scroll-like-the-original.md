---
date: 2026-10-22
title: Inventory lists scroll like the original
summary: The crafting list and big loot boxes now scroll with the original's wheel feel and scroll bar, and the inventory buttons light up the way they did in the original.
stats: 2 | lists with the original scrolling; 15 | kinds of button and slot with original colours; 3 | close buttons, as in the original; 1 | bumper bar confirmed
media: rpos-scroll-craft.jpg | The crafting list scrolled with the wheel: the original scroll bar on the right, the row under the mouse lit; rpos-craft-hover.jpg | Pointing at Craft turns it the original's bright green; rpos-scroll-crate.jpg | A full box scrolled to the bottom, with the box's own close button lit red
---

Our crafting list and loot boxes used the browser's own scrolling, and the inventory buttons only had a hover colour we had picked ourselves. All of that now comes from the original game files.

## Scrolling

The original lists move only with the mouse wheel or their thin scroll bar. You cannot drag the list itself. One notch of the wheel pushes the list, and it eases to a stop. The list stops hard at either end, with no bounce. The scroll bar fades in when a list is too long to fit and fades out when it fits. Clicking the bar jumps there, and you can drag its handle.

Two quirks are kept too:

- The wheel only works with the mouse over a recipe or a slot. It does nothing over a category heading or the scroll bar.
- A box with only a few items can be scrolled down inside its window until the last row touches the bottom.

Loot slots also moved 2 pixels closer together, to match the original spacing.

## Buttons

Every inventory button now uses the original colours:

- **Recipes** light grey under the mouse.
- **Craft**, **−**, **+**, **Repair** and the **Inventory / Armor / Crafting** bar flash the original's bright green.
- **Close** turns red.

The camp fire, loot and repair windows get the original's small red close button, which grows a little under the mouse. The crafting and armour windows had theirs switched off in the original, so ours are gone too.

## The bar along the top

We had marked the Inventory / Armor / Crafting bar for checking, because the copy of its button saved in the scene is switched off. The game builds the bar from a separate saved button that is switched on, so the original showed the bar. Ours now matches its sizes and spacing. It also sits partly above the top edge of the screen, as the original's did.

## How it was checked

A browser test scrolls the crafting list and a full box with the wheel and the scroll bar. It checks where the lists stop and where the bar sits, and checks the hover colours and close buttons in the real inventory.
