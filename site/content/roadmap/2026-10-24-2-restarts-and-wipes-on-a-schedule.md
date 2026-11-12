---
date: 2026-10-24
title: Restarts and wipes on a schedule
summary: Server owners can restart and wipe on a schedule, with countdown warnings in chat. The server now saves before every stop, so nobody loses progress.
stats: 6 | warnings before a restart; 0 | wipes deleted (all archived); 1 | save before every stop
media: host-schedule.jpg | A restart counting down in the host app, with the players already warned (demo server)
---

Legacy servers live by their wipe days. The host app now handles them.

## Saving first

Stopping or restarting the server used to end it on the spot, losing anything since the last autosave. Now the host app asks the server to **save**, waits for the save to finish, and only then asks it to quit. If it can't reach the server's add-on, it says so before you press Stop.

## The Schedule page

- **Daily restarts** at the times the owner picks, in their own time zone.
- **Wipes** on rules like *the first Thursday of each month* or *every two weeks*, either the map only or the map and characters.
- **Warnings in chat** at 30, 15, 10, 5 and 1 minutes and 10 seconds before.
- **Nothing is deleted.** A wipe moves the old world into the backups.
- **Restart now** with warnings, and **Cancel**. The owner's team can also start a restart from the website console, but never a wipe.

All of this is tested on our stand-in server. It hasn't run against the original server yet.
