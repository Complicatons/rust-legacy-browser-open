---
date: 2026-10-23
title: Spike walls, fires and the repair bench
summary: Nine building and deployable rules from the original now work the same in our offline game, and the repair bench window shows what a repair costs.
stats: 9 | original rules matched; 5.5 m | small spike wall reach; 5 m | before a box closes on you; 0.25 s | until a fire with no fuel goes out
media: rpos-repair-bench.jpg | The repair bench with a damaged hatchet: its condition in yellow, one ingredient you have in green and one you lack in red, and the Repair button
---

We went through the original game's code for spike walls, boxes, fires, the repair bench, placing things, decay and doors. Nine places where our offline game did something different now match the original.

## What changed

- **Spike walls.** The small spike wall now hurts you along its whole length, not only near its middle. Hitting a spike wall with a melee weapon or an arrow from within 8 m now hurts you back, as it did in the original.
- **Walking away from a box.** If you walk more than 5 m from an open box, stash, camp fire, furnace or repair bench, its window closes. The game checks every 10 seconds, like the original.
- **Fires.** Take the last fuel out of a burning camp fire or furnace and it goes out a quarter of a second later.
- **The repair bench window.** It now lists what a repair costs, such as "3 Metal Fragments" and "6 Wood": green if you have enough, red if you don't. It shows the item's condition in green, in yellow below 60, or in red when broken. An item in full repair shows "Does not need repairs". The Repair button only shows when the item needs repairing, and pressing it without the materials gives the original "could not repair item". The text, the item slot and the button sit where the original window has them.
- **Placing things.** Clicking where something can't go no longer pops up "You can't place that here". The original only showed that when the server turned down a placement.
- **Decay under cover.** The check for a roof now sees everything above a box or a wall, as the original does. A wood shelter protects what is under it, and a door counts as a wall.
- **What keeps a base from decaying.** Placing a box on a foundation no longer resets the base's decay timer. In the original, only opening or closing a door did that.
- **Doors in saved games.** A door that was opened the other way comes back open the other way when you load your game.

## How it was checked

Unit tests cover each rule: spike wall reach and damage back, the 5 m check, the fire going out, the repair window's text and colours, placing, decay and door saves. A browser test placed a repair bench with a damaged hatchet, measured where each line and the button are drawn against the original window layout, and pressed Repair with and without the materials.
