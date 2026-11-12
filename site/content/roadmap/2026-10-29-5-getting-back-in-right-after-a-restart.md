---
date: 2026-10-29
title: Getting back in right after a restart
summary: When the real server restarted, a player's spot at the table could be held for minutes after they were gone, so trying to get back in said they were already connected. We found why, fixed it, and tested the fix on a real restart.
stats: 3 min 40 s+ | the old wait, found in testing; 0 | already-connected refusals on the fixed test restart; 0 | players affected by a normal disconnect
media: gateway-kick-text.jpg | The game's own on-screen text for a session that has ended, as the original client shows it
---

A server restart should be a brief, invisible thing for players who weren't even connected at the time. For the few who were, getting back in should be just as quick.

## What we found

If the server was stopped and started again while someone was connected through the browser, trying to get back in straight after could say "already connected" — for minutes, not seconds. A normal disconnect never had this problem; it only showed up across a real restart.

## Why

Our bridge holds a short-lived claim on a player's spot while they're connected, so the same account can't be used twice at once. Normally, the part of our bridge that lives inside the game server tells us the moment someone disconnects, and we let the spot go right away. But a restart kills that part along with everything else in the old server process, so that message never arrives — and we were left waiting for the new server to start up and report back who's online, which could take a good deal longer.

## The fix

The part of our bridge that talks to the browser already knows the moment a connection dies, often in well under a second. It just wasn't passing that on. Now it does, so a player can get straight back in after a restart instead of waiting out the old delay.

## Tested on a real restart

We joined a test player, stopped and started the real server underneath them, and tried getting back in. It worked on the very first try, with no "already connected" refusal at all — just the ordinary time it takes to join.
