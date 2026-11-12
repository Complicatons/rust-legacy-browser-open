---
date: 2026-10-23
title: Keys, menus and the mouse like the original
summary: Keys you hold keep working when a window closes, the mouse comes back to the game by itself, and the item menu, belt and death screen follow the original's rules.
stats: 13 | edge cases fixed; 0 | duplicate meals; 4 | windows that give the mouse back; 24 | popups at most on screen
media: death-reason-colours.jpg | The death screen showing a coloured death message, as the original did
---

We went through what happens around the game's windows: the inventory, chat, the F1 console, the code lock, the right-click item menu and the death screen. Thirteen small things behaved differently from the original. They now match it.

## What changed

- **Held keys keep working.** If you held W or Shift while opening the inventory, chat or the console, you had to let go and press again after closing it. In the original the key just keeps working, and now it does here too. While a window is open you still stand still.
- **The mouse comes back by itself.** Closing the inventory, the F1 console or the code lock, or pressing Respawn, now gives the mouse back to the game, as in the original. You no longer have to click first.
- **Switching windows is not Escape.** Alt-tabbing away no longer opens the Escape menu. Only the Escape key does, as in the original.
- **The item menu acts on its own item.** The right-click menu could eat an item twice: eat it with a belt key, then click Eat in the still-open menu. It now closes when the item changes, and a click only ever uses the item it was opened for. If that item is gone, nothing happens.
- **Belt keys online.** Pressing a belt key on an empty slot or a broken tool no longer sends anything to the server, as in the original. Clicking a belt slot on the screen follows the same rules as the keys, so it does nothing while you are dead or in chat.
- **Dragging items.** A drag no longer stops when the server updates your inventory mid-drag. The slot you are dragging from looks empty, as in the original.
- **Typing in other languages.** Pressing Enter or Escape to confirm a word in a Chinese, Japanese or Korean keyboard no longer sends or cancels your chat message.
- **Doors that are gone.** If a door is destroyed while its menu is open, choosing an option now does nothing, as on the original server, instead of opening the code entry for a door that is not there.
- **The death screen.** Colour codes in the death message now show as colours. The code entry stays open if you die while typing, as in the original.
- **Small safety limits.** The hold-E menu re-centres when the window changes size, and a server can no longer fill the screen with endless popups.

## How it was checked

New unit tests cover held keys, the item menu (including the double meal), online belt keys, belt slot clicks, dragging during an update, a destroyed door's menu and the popup limits. A new browser test holds W through the inventory, the console and chat, checks the mouse comes back each time, types an in-progress word in chat, drops the mouse without focus, and shows a coloured death message before respawning. The existing tests for controls, inventory, chat and the main menu pass. None of this has been tried on the original server yet.
