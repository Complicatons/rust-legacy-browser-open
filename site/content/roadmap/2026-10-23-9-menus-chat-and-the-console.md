---
date: 2026-10-23
title: Menus, chat and the console
summary: Chat and the F1 console now work with your inventory open, the console is there from the main menu, and Escape, the belt keys and item dragging behave as in the original.
stats: 10 | original rules matched; 1–6 | belt keys with the inventory open; 0 px | drag threshold; 255,235,4 | the original yellow
media: chat-over-rpos.jpg | Typing in chat with the inventory open, after taking out the rock with key 1
---

We went through the original game's code for the main menu, the inventory screen, chat, the F1 console and the item tooltip. Ten places where our game did something different now match the original.

## What changed

- **Chat and the console over the inventory.** With the inventory open you could not type in chat or in the F1 console. In the original you can, and now you can too.
- **The console from the start.** The F1 console now opens on the main menu and while the island loads, as in the original. It also lists each loading step ("LoadingScreen: loading trees" and so on), and you can join a server from it with `net.connect`.
- **Belt keys with the inventory open.** Keys 1 to 6 now take out your belt items while the inventory is open, as the original allows. They no longer work behind the Escape menu, in chat, in the console or while loading.
- **Items move by dragging only.** Clicking an item used to pick it up, and clicking a crate item took it. The original does neither: you drag. A drag now starts as soon as the mouse moves, as in the original.
- **Escape.** Escape now always opens or closes the menu once you are in game, as in the original. With the inventory open it closes the inventory and opens the menu; in chat it cancels the message and opens the menu. Only F1 closes the console.
- **The item tooltip.** It now appears with its corner right at the mouse and stays put, as in the original, instead of sitting a little off and following the mouse.
- **The console itself.** No more command history or local `clear`: the original had neither. What you type is run exactly as typed, and messages and warnings show in the original's grey and red.
- **The original yellow.** The health bar between 41 and 75, worn-out item icons and ammo counts now use the original's slightly orange yellow, not a pure one.

## How it was checked

Unit tests cover the tooltip position, the console colours and the yellow. The browser tests now open the console on the main menu, check the loading lines, take out a belt item and type in chat with the inventory open, and press Escape to close it and open the menu. The tests for the inventory, crafting, loot windows, chat, controls and our test server pass with the new behaviour. None of this has been tried on the original server yet.
