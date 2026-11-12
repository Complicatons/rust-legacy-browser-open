---
title: Anti-cheat alerts and evidence
summary: What the anti-cheat checks, and how to read a flag
group: Server teams
order: 2
---

Browser players reach your server through the gateway, and the gateway checks every move and action before the game server sees it. The limits come from the original game's own values, never from the player's browser.

## What it checks

| Kind | Examples |
| --- | --- |
| Movement | Speed beyond what running allows, teleports, flying, going under the terrain |
| Shooting | Fire rate, no reload, shots through walls, headshot ratio, sudden aim snaps |
| Melee and bows | Hits from too far away, arrows that couldn't fly that path |
| Actions | Using or looting through walls, taking everything instantly, command floods |

Impossible commands are dropped outright. Suspicious ones add to the player's **score** and record a **flag** with the evidence: the positions, angles and timings around it.

## Reading a flag

- Open a player in **Evidence** to see each flag with its details. Movement and shots have a plot of the moments around them.
- One flag can be lag. A pattern across minutes is what matters.
- Serious flags (severity 40 and up, by default) can take a **screenshot** automatically. Change that under Join policy.

Desktop players don't pass through the gateway. The server plugin watches their movement from the server side, so their scores cover movement only.

## Then what

Kick, ban, or keep watching. Whatever you choose goes in the audit log. For cheaters who move from server to server, tell the Rust Legacy team: we can ban them across the network.
