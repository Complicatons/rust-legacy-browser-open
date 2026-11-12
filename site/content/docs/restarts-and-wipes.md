---
title: Restarts and wipes
summary: Daily restarts and wipe days with warnings in chat, and saving before every stop
group: Running a server
order: 5
---

The **Schedule** page in the host app restarts your server every day and wipes it on the days you choose. Players get warnings in chat first.

## Saving before a stop

Whenever the host app stops your server (Stop, Restart, a scheduled restart or a wipe), it first asks the server to **save**, waits until the save has finished, and then asks it to quit. Nothing played since the last autosave is lost.

This needs our server add-on to be running and in touch with the host app. If it isn't, the Stop dialog says so and the server is ended at once, as with a crash. The host app also ends it if the save hasn't finished within a minute.

## Daily restarts

Tick **Restart the game server every day** and enter one or more times, such as `06:00, 18:00`, in your time zone. A restart is skipped if you had stopped the server yourself.

## Wipes

Tick **Wipe on a schedule** and choose:

| Option | Choices |
| --- | --- |
| What | **Map only** (the world: buildings, items in the world) or **Map and characters** (also every player's inventory and blueprints) |
| Repeat | **Every month** (the first, second, third, fourth or last of a weekday, such as the first Thursday), or every few days or weeks from a date |
| At | The time of day |

Turning wipes on, or changing them, asks you to confirm.

**Nothing is deleted.** A wipe moves the old world (and, for a full wipe, the players' files) into **Backups**, in a folder named after the wipe. The host app also tells this website when your server last wiped.

## Warnings in chat

Players see *"Server restart in 10 minutes."* (or *"…and map wipe…"*) at the times you set. The default is 30, 15, 10, 5 and 1 minutes and 10 seconds before. Tick **No warnings when nobody is online** to keep the log quiet on an empty server.

## Restart now

Under **Restart now**, choose when (now, or up to 180 minutes away) and whether to wipe too, then press **Restart with warnings**. Players get the warnings that still fit. **Cancel** stops a countdown. Your server team can also start or cancel a restart from the [console on the website](/docs/manage-from-the-website), but never a wipe.

## History

Every restart and wipe is listed with who started it and how it went. If you've set up [Discord alerts](/docs/health-and-alerts), you get one when each finishes.
