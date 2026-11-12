---
date: 2026-10-22
title: Other players move like the original
summary: Other players and animals online now follow the original's timing exactly, from the same delay to the same way it smooths over gaps in the server's updates.
stats: 0.32 s | behind the server, as the original at its default send rate; 0.3 s | longest smoothing between two updates; 32 | updates kept per player; 7 | ledger items closed
media: online-remote-smooth.jpg | Another player, drawn from the server's movement updates with the original's timing; online-wolf-smooth.jpg | A wolf from the server, smoothed the same way the original smoothed animals
---

The server sends where every player and animal is a few times a second. The game draws them a little in the past and slides them smoothly between those updates. Ours used delays we had picked ourselves. They now come from the original.

## The delay

The original works out its delay from how often the server sends updates: one and a half update gaps plus 20 milliseconds. At the usual rate of 5 updates a second that is 0.32 seconds. Players, animals, the supply plane and timed effects like animal attacks all use this delay now, and it follows the rate each server announces when you join.

We also place each update at the time the server sent it, not when it reached your browser, so a slow connection no longer makes others stutter.

## Gaps

When a player stands still, the server stops sending. The original then holds them in place and, when they move again, slides them over at most 0.3 seconds. Ours now does the same. Before, they slid slowly across the whole gap.

The original never guesses ahead past the last update, and neither do we. A player's crouch, sprint and movement state blends between two updates the original's way too.

## How it was checked

Unit tests cover the delay, the gap limit, the update order and the state blending. The online browser test moves a server player and a wolf through the real gateway and checks they are drawn where the server says.
