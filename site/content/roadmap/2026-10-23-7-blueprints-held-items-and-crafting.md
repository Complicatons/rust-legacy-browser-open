---
date: 2026-10-23
title: Blueprints, held items and crafting
summary: Seven item and crafting rules now match the original, and you keep the blueprints you learned when you die.
stats: 7 | original rules matched; 0 | blueprints lost on death; 1 s | workbench grace for research; 9 | furnace slots in the standard window
media: crafting-window.jpg | Test run: the crafting window with a recipe picked and the Craft button never greyed out, as in the original
---

We went through the original game's code for blueprints, the item in your hands, loot windows, reloading, repairing and the crafting window. Seven places where our game did something different now match the original.

## What changed

- **Blueprints survive death.** In our offline game, dying wiped every blueprint you had learned, so you were back to the starting ones. In the original you keep them: only your items drop. Now you keep them too, and the starting blueprints and items come back as before.
- **The item in your hands.** Drag your held hatchet or gun into your bag, throw it on the ground, or use up the last of it, and you now put it away, as in the original. When a held item breaks you put it away too, with the original "Active item has broken! - Repair it" message.
- **No Take all button.** The original's loot window has a Take all button that is switched off and does nothing on the server. Ours showed it online, so it's gone: you drag items out, as in the original.
- **The furnace window.** Online, the furnace now opens in the normal loot window with its 9 slots, as in the original. Only the camp fire uses the fire window.
- **Reloading and repairing.** Reloading a gun, firing an arrow and repairing at the bench now take from your biggest stack first, as the original does, not from the first stack in your bag.
- **Research kits near a workbench.** Using a research kit now works for one second after you step away from a workbench, the same as crafting.
- **The crafting window.** We had added a line like "1 × Wood Planks · 4 seconds" and greyed out the Craft button when you couldn't craft. The original has neither. Now Craft is never greyed out, and pressing it when you can't craft does nothing, as in the original.

## How it was checked

Unit tests cover each rule: blueprints after a death and in a saved game, putting the held item away, the biggest-stack order for reloads, arrows and repairs, the research kit's one second, and which window each container opens online. The browser tests for crafting, the inventory, the loot windows and our test server pass with the new behaviour. None of this has been tried on the original server yet. That comes with the next test run.
