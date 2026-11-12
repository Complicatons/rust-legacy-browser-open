---
date: 2026-10-29
title: Still smooth on a bad connection
summary: We re-ran our worst-case network test on the latest build, with the same half-second of lag and packet loss as before. No drops, no kicks, and every reconnect found its way back in on its own.
stats: 3 | lag levels tested, up to +500 ms; 0 | drops or kicks at any level; 6 | reconnects that got back in on their own
media: bad-network-500ms.jpg | A test player on the original server with half a second of added lag and 5 % packet loss, chatting with another test player
---

A player on a bad connection should see things get a little laggy, not get kicked or desynced. We checked that's still true on the build with today's other fixes.

## The test

Two test players walked, gathered and chatted for eight minutes at each of three lag levels: +100 ms, +250 ms and +500 ms round-trip, each with matching packet loss. Partway through each run we dropped their connection on purpose and let them try to get back in by themselves.

## What happened

Nothing broke. No drops, no anti-cheat kicks at any level, and every reconnect succeeded without us touching anything — it just took a little longer to get back in as the connection got worse, which is exactly what you'd expect. A player's gear was still exactly where they left it after reconnecting.

This matches what we found testing the same thing a week ago, now confirmed on the build with today's restart and lease fixes included.
