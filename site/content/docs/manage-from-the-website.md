---
title: Manage your server from the website
summary: The console, live logs, restarts and backups, from any browser
group: Running a server
order: 4
---

Once the host app has its key, open **Console** on [Your servers](/owner). It works from any browser, so you never need Remote Desktop.

## How it connects

Your host app calls out to this website every 2 seconds, sending its status and new log lines and picking up your commands. **You don't open any port for this.** The dashboard on your machine stays on `127.0.0.1` only.

Logs are kept in the website's memory only (the newest 2,000 lines), never in its database. Only you and the Rust Legacy team can see them.

## The console

| Section | What it shows |
| --- | --- |
| Health | Players in game, the game server's state, the watchdog, and when the last good save was made |
| Parts | Each part's state, uptime and restarts, with Start, Stop and Restart (or all at once) |
| Restarts | **Restart the game server in** a few minutes, with warnings in chat, or **Cancel restart**. Wipes can only be set up in the host app. See [Restarts and wipes](/docs/restarts-and-wipes). |
| Live log | Every line, newest at the bottom. Filter by part, search, or pause to read. |
| Backups | The host app's copies. Keep one now (with a label), or restore one. |
| Recent commands | What was asked, by whom, and whether it worked |

Commands wait for the host app's next report, so they start within about 2 seconds. A command the host app doesn't pick up within a minute is dropped and shows as *Not picked up*.

## Restoring a backup

Stop the game server first: a running server would overwrite the restored save at its next autosave. The current save is set aside, never deleted.

## Turning website control off

To keep the logs on the website but refuse its commands, set `"remote": {"control": false}` in the host app's `host.json`. To stop reporting entirely, set `"remote": {"enabled": false}`.

## Players and anti-cheat

Those live in **Server admin** (the Players & anti-cheat button). See [The Server admin panel](/docs/server-admin-panel).
