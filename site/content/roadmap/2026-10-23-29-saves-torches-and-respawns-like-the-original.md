---
date: 2026-10-23
title: Saves, torches and respawns like the original
summary: Single-player bases now decay across visits, torches burn out, and you respawn facing the way the original faced you.
stats: 8 | survival and world rules fixed; 16 | systems checked and already right; 250 s | a torch's burn time in your hands; 2 s | between food and radiation updates on the screen
media: torch-burning.jpg | A torch held at night on the island: it now burns down one use a second, as in the original
---

We went through the parts of the game the earlier checks had looked at least: food, cold and radiation, bleeding and falls, cooking, the research kit, sleeping bags and beds, loot crates, ore and wood respawns, airdrops, day and night, sleepers and death bags. We compared each with the original game's code. Sixteen of them already worked like the original. Eight did not, and they are fixed now.

## What changed

- **Bases decay across visits.** In single player, reloading the page used to give every base a fresh two-day grace period, and boxes and other placed items stopped decaying for as long as you had played before. Now a reload works like a server restart in the original: the grace period you had left is kept and decay carries on.
- **Fires and sleeping bags after a reload.** A burning fire starts its next log fresh, and sleeping bag and bed waiting times start again, as they did after a server restart.
- **Torches burn out.** A torch in your hands now uses one of its 250 uses every second, plus one each time you take it out, and is gone when it runs out. Before, a torch lasted for ever.
- **You respawn facing the right way.** After dying you now look straight ahead in the direction of your spawn point, bag or bed, as in the original. Before, you kept looking wherever you had been looking when you died. This also applies online.
- **Hunger, bleeding and drowning ignore armour.** These never took armour into account in the original. They did here with the admin-only invisible armour.
- **Food and radiation numbers update every 2 seconds.** The original only refreshes them when the server sends an update, so eating shows up a moment later. The cold, warm, hungry, poisoned and radiation signs follow the same rule.
- **Missed swings cost no food.** Swinging at something more than 6 m away no longer uses up calories, because the original server ignores that swing.

## How it was checked

New unit tests cover each fix. A new browser test spawns a fresh character and checks it looks straight ahead along a spawn point. It also holds a torch at night for 5 seconds, checks about six uses burned, and checks the food number only changes on the next update. None of this has been tried on the original server yet.
