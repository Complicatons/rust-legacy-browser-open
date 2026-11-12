---
date: 2026-10-21
title: Ctrl+W no longer closes the game
summary: Crouch is Ctrl, so crouch-walking with Ctrl+W could close the browser tab mid-game. The game now plays in fullscreen and keeps the keyboard, and asks before the tab closes.
stats: 0 | tabs closed by crouch-walking; 1 | click into fullscreen play; 5 | tab shortcuts only fullscreen can stop
media: fullscreen-play.jpg | Crouch-walking with Ctrl+W held, in fullscreen
---

In Rust Legacy, Ctrl is crouch. In a browser, Ctrl+W closes the tab. Crouch-walking forward is Ctrl+W, so in Edge and Chrome you could lose the game while sneaking up on someone.

## What changed

- **Fullscreen by default.** Clicking into the game now also switches to fullscreen. In fullscreen the game keeps the whole keyboard, so Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Q and Ctrl+Tab go to the game instead of the browser.
- **Escape works as before.** A short press releases the mouse and opens the menu. Holding Escape leaves fullscreen.
- **Windowed play asks first.** If you play in a window, closing the tab or reloading shows the browser's "Leave site?" question during a game. On the main menu it doesn't ask.
- **Other shortcuts do nothing in game.** Reload (Ctrl+R, F5), save, print, find, bookmark, zoom and back/forward are ignored while you play.
- **Chat and console still work.** Typing, select all, copy, paste and undo work as normal in the chat box and the F1 console.

## Your choice is remembered

Turn fullscreen off with Alt+Enter, the Fullscreen option, or by holding Escape. The game then stays windowed until you turn it back on.
