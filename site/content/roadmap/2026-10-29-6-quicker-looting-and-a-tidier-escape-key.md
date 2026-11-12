---
date: 2026-10-29
title: Quicker looting, a tidier Escape key, and a heads-up about Ctrl+W
summary: Three things the owner's own playtesting turned up. Shift-click now quick-moves an item between a loot window and your inventory, Escape while either is open just closes it, and a one-time tip on join explains how to stop browser shortcuts from interrupting your game.
stats: 3 | playtest reports fixed, 0 | still open
media: inventory-shift-quickmove.jpg | The loot window open alongside the player's own inventory, ready for a shift-click quick-move; join-controls-tip.jpg | The one-time tip shown on join, dismissible with the x
---

The owner played the current build and found three rough edges. All three are fixed.

## What changed

- **Shift-click quick-move.** Looting a box, bag or crate opens its contents alongside your own inventory so you can drag items across. Holding Shift and clicking an item now moves it straight to the other window in one click — loot to yours, or yours to loot — the same convention most inventory UIs use. It lands in a slot already holding the same item if there's room, otherwise the first empty one, exactly where a manual drag to that slot would put it.
- **Escape closes just the window you're in.** Pressing Escape with the inventory, a loot window, chat or a lock entry open used to also pop the settings/pause menu open underneath it, so getting back into the game took two presses of Escape instead of one. Escape now only closes whichever of those is open; the settings menu only opens when nothing else is.
- **A heads-up about Ctrl+W.** No website can stop a browser from closing its own tab on Ctrl+W (or Ctrl+T, Ctrl+N) outside fullscreen — that's a deliberate browser security limit, not something we can code around. Rather than leave players to discover that the hard way, a one-time, dismissible tip now shows when you join: play fullscreen to protect the whole session, or rebind Crouch (bound to Ctrl by default, same as the original) from Options if you'd rather stay windowed.

## How it was checked

A new automated test for each fix, plus driving all three by hand in the browser: shift-clicking a loot item into an empty inventory slot and back, confirming Escape closes the inventory without the settings menu appearing, and confirming the join tip shows once, dismisses, and that Crouch really is rebindable from Options. The full test suite stays green.
