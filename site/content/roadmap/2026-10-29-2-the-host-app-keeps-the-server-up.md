---
date: 2026-10-29
title: The host app keeps the server up
summary: Running the host app on a real test server for five days found that a crashed game server was never started again. That is fixed, along with a noisy server log and a few readings the app could not take.
stats: 3 days | down before the fix; 22 s | back after an update; 2 | log lines in 3 min, was 36; 110 | host checks passed
media: vm-host-watchdog.jpg | The test server's vital signs after the update: log lines and CPU live, the network check only when it is needed (Azure test machine)
---

The host app has been running the original game server on a Windows Server test machine since 24 October. Looking at it again five days later turned up problems that only show over time.

## A crash now gets a restart

On 26 October the game server stopped by itself, and the host app left it stopped for three days. The app starts the original server through a Windows task, and it treated a server started that way as someone else's, which it never restarts. It is the app's own server now, so a crash is restarted like any other, also after the app itself has been restarted.

## Quieter, and seeing more

- **Server log:** the app's network check made the server log a line every 5 seconds. It now checks only when the server has gone quiet.
- **CPU:** the app could not read the server's CPU time, so one of its three signs of life never moved. It reads it another way now.
- **Players:** the player count was blank on this machine. It shows now.
- **Empty worlds:** a world with nothing built yet is no longer set aside as damaged at every restart.
- **The sign-in token** no longer appears in the service's log.

## Next

Backups and restores once the world has something in it, then desktop and browser players together.
