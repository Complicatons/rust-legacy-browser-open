---
date: 2026-10-22
title: No kicks, joining in 3 seconds, and the website is live
summary: 22 minutes on the original server without a kick, original aiming and scrolling, 3-second joins and your-domain.example is live
image: /site/generated/media/roadmap/original-server-belt.jpg
---

## On the original server

- **No kicks: 4 test bots played on the original server for 22 minutes** without a single anti-cheat kick. Joining the cloud test server now takes 79 s instead of 581 s, and the starting-inventory check passes.
- **Resource nodes show up**: the browser now sees the original server's ore, stone and wood piles, and a browser player gathered from one. A one-letter naming rule had been hiding them.
- **The test server stopped freezing.** Its own console window was the cause, not the world save. It now saves cleanly every ten minutes.

## In the game

- **Aiming, draw sounds and explosion flashes now match the original code**: 18 items have their own draw sound, and the explosion flash lasts 0.25 s.
- **Guns drift while you aim, bullets spark on metal**, and the camera's near cut-off adapts as in the original.
- **Inventory lists scroll like the original**, with its scroll bar and button colours.
- **Joining takes about 3 seconds on a return visit** (was 4.2 s).

## For server owners

- **The first piece of a host app** that runs a Legacy server, our gateway and the website together. It restarts a frozen server by itself and keeps the last good save. Owners can use the app or the PowerShell scripts, or mix the two.
- **Desktop players are on the way**: a launcher you sign in from the website, so one account works in the browser and the original game.
- **Fair limits for every player**: sign-in and join limits now count each player separately behind Cloudflare.

## The website is live

**[your-domain.example](https://your-domain.example)** is live from our own server in London, with HTTPS on every page.
- The roadmap and homepage show the project's progress (83% today) from the public GitHub journal.
- The [calculator](/wiki/calculator) is easier to read.
- Point at the Wiki tab in the top bar for a quick link to the calculator.

Everything from this day, with pictures, is on the [roadmap](/roadmap#day-2026-10-22).
