---
date: 2026-10-24
title: The host app runs the original server
summary: Rust Legacy Host was installed on a real Windows server for the first time and ran the original game server there: saving and quitting cleanly, restarting on a schedule with warnings in chat, wiping the map and greeting players.
stats: 36 | host checks passed; 1.6 s | save before a stop; 10 s | back after a restart; 0 | characters lost in a wipe
media: vm-host-overview.jpg | Rust Legacy Host on the test server, running the original game server (Azure test machine)
---

Until now the host app had only been tried against a stand-in server. This round it was installed on a Windows Server test machine and pointed at the original game server, with two test players online.

## What works

- **Installing:** the installer sets up the service, the app and its shortcuts. Three permission problems turned up on the way and are fixed.
- **Stopping safely:** Stop saves the world first, waits for the save to finish, then asks the server to quit.
- **Scheduled restarts:** players are warned in chat at 2 minutes, 1 minute and 9 seconds, and both test players came back where they stood.
- **Map wipes:** the old world is archived in the backups folder and every character is kept.
- **Message of the day:** players see it a few seconds after joining.

## Next

Backups and restores on the real server, the website's console, then the desktop game joining through the game loader alongside browser players.
