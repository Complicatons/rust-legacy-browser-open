---
date: 2026-10-22
title: The test server froze on its console, not its save
summary: The original server on the cloud test machine froze twice today. The cause was its own console window, not the world save. It now starts with that window hidden and has saved cleanly every ten minutes since.
stats: 2 | freezes explained; 5 | clean autosaves since; 0 | bytes in an empty world save
media: original-server-belt.jpg | A test bot on the original server, which kept running through five autosaves after the fix
---

The original server on our cloud test machine froze twice today. Both times the last line in its log was a world save, so the save looked like the cause.

## What it really was

- The server writes every log line to its own console window, and it does that on the same thread that runs the game.
- In Windows, a click into a console window starts a text selection, and the window then stops accepting writes until the selection ends.
- Both freezes came right after a player joined or left. That writes a log line, and that write never finished.
- File permissions, the save settings, antivirus and disk space all checked out fine.

## The fix

The server now starts with its console window hidden. Its output still goes to its log file. Since the restart it has saved five times in a row, ten minutes apart, while bots played on it.

## Why the save files are empty

The world save only stores things players have built or placed. Nobody has built anything on the test server yet, so a save of the world is 0 bytes. That is correct, not lost data.
