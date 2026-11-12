---
date: 2026-10-22
title: Closing a box works like the original
summary: The small close button on a box, camp fire or repair bench now ends the looting and leaves your inventory open, as it did in the original.
stats: 3 | windows with the original close; 1 | way out of looting for every close
media: rpos-loot-closed.jpg | After closing a box with its own button: the inventory and armour stay open, the crafting window stays shut until you press Crafting
---

The small red X on a box, a camp fire or a repair bench only hid the window. You were still looting the box, so nobody else could open it until you closed the whole inventory.

## What the original does

We read the original's inventory code and the settings saved with each window:

- The X on a box, camp fire or repair bench closes that window for good and tells the server you stopped looting. Your inventory stays open.
- When the server ends your looting (the box is destroyed, for example), only the box window closes. Before, our whole inventory closed.
- Opening a box hides the crafting window. It stays hidden after the box closes, even when you open the inventory again, until you press **Crafting** on the bar at the top.

All three now work that way.

## How it was checked

A browser test opens a box in the real inventory and presses its X. It checks that the looting ended once, the inventory stayed open and crafting stayed hidden until its button was pressed. It then closes the inventory with a box open and checks the looting ended there too.
