---
title: Health and alerts
summary: Graphs of the last day and week, the health check, and Discord alerts
group: Running a server
order: 7
---

## The health check

On the **Overview**, press **Run checks**. The host app checks the things that most often go wrong and marks each one **Pass**, **Warning** or **Fail**, with what to do about it:

- the game server answers, and the gateway is listening;
- the firewall rules are in place;
- your server copy is the right build, and our server add-on is on it and up to date;
- **website players only** is on (a public server should only let in players signed in through this website or the game loader);
- the host app key works and the website is reachable, and the machine's clock is right;
- the gateway's certificate isn't about to expire;
- there's enough disk space, and backups are recent.

## The Health page

Graphs of the last **24 hours** or **7 days**:

- players in game and browser sessions;
- the game server's CPU and memory;
- how quickly the game server and gateway answer;
- error lines in the logs.

Freezes and restarts are marked on every graph. Point at a graph (or use the arrow keys) to read the values at that moment. **Show as a table** gives the same numbers as a table. At the top: peak players, uptime, freezes, restarts and error lines.

The host app records a reading every minute and keeps 8 days.

## Discord alerts

Get a message in your Discord when something needs you.

1. In Discord, open your server's settings → **Integrations** → **Webhooks** → **New Webhook**, pick a channel and press **Copy Webhook URL**.
2. In the host app, open **Settings** → **Discord alerts**, paste it and press **Save**.
3. Press **Send test alert** to check it arrives.

Choose what you're told about:

| Alert | When |
| --- | --- |
| Game server crashed or failed | It exits without being asked, or keeps crashing |
| Freeze | A freeze was caught, and again when the server is back |
| A part stopped | The gateway, sidecar or website part stopped unexpectedly |
| Back online | The game server is running again |
| Anti-cheat flags | A flag at or above the severity you choose |
| Player reports | A player reported someone |
| Restarts and wipes | A scheduled or manual restart or wipe has finished |
| Low disk space | Less than 2 GB or 5% left on the data drive |

Alerts that happen together arrive as one message. Only Discord webhook addresses are accepted, and the address is never shown in full again after you save it.
