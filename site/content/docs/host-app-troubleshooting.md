---
title: Host app troubleshooting
summary: What to do when the server won't start, players can't join, or the dashboard looks wrong
group: Running a server
order: 10
---

Start with **Run checks** on the Overview: most problems show up there with their fix. Then look under **Logs**, filtered to the part that's misbehaving.

| What you see | What to do |
| --- | --- |
| A part shows **Failed** | It crashed 5 times in 10 minutes, so the host app stopped trying. Read its log, fix the cause, then press **Start**. |
| The game server shows **started outside the host** | It was started with a setup script, not the dashboard. It's watched as normal, but if it stops by itself the host does not start it again. If it says **not verified**, stop it the way it was started. |
| **The game server froze** in the log | The watchdog caught a freeze and restarted it with the last good save. If it happens often, look at the Health page around those times and ask us in Discord. |
| **Stop ends the server at once** instead of saving | The host app can't reach our server add-on. Check **Our adapter on the server** in the health check. On some servers the add-on only wakes up after the first player joins. |
| Players can't join | Check the health check's ports and firewall rows, that the gateway is running, and that your server is listed on [Your servers](/owner). |
| Players are told **Authorization failed** | **Website players only** is on and they tried to join without signing in. They should join from the website or the game loader. |
| The website console says the host app is offline | Check the **host app key** on the Accounts page, and that the machine can reach this website. |
| Discord alerts don't arrive | Press **Send test alert**. If Discord refuses it, make a new webhook and paste it again. |
| An off-site backup failed | The Backups page shows the reason. A folder that's disconnected is never replaced by a local one; reconnect it and press **Back up now**. |
| A setup step failed with **Access denied** | It needs an administrator. Use the line the wizard gives you to paste into PowerShell as administrator. |

## Lost your sign-in link

The owner token is in `owner.token` in the host app's data folder (only administrators can read it). Open `http://127.0.0.1:28100/#token=` followed by the token.

## Still stuck

Ask in our [Discord](https://discord.gg/your-invite) with a copy of the relevant log lines. Remove any passwords or keys first.
