---
date: 2026-10-29
title: Thrown items no longer jump the gun
summary: A thrown grenade, flare or dropped item used to appear the instant its message arrived, about one interpolation delay before the original game would have shown it. It now waits.
stats: 1 | more online message checked against the original game's own rule; 0.1 s | roughly how early it used to show up
media: online-flare-glow.jpg | A thrown flare, now held back until the server's own spawn time catches up with it
---

Following on from this morning's full pass over every message the original game sends and receives, one more rule turned up: the original game does not show a thrown grenade, flare or dropped item the instant its "it exists now" message arrives. It waits until its own clock catches up with the moment the server actually created it, then shows it all at once.

## What changed

- **Thrown objects wait their turn.** The original game reads a timestamp off the object's own creation message and keeps it hidden until its interpolation clock reaches that moment — about a tenth of a second, in practice. Our port never looked at that timestamp, so grenades, flares and dropped items used to appear slightly early.
- **The timestamp now reaches the game.** The part of our code that turns the original game's network messages into something the browser understands was reading this timestamp for ordinary messages already, but not for "this now exists" ones. It does both the same way now.

## How it was checked

A new test drives the fix with a stamped creation message and checks the object stays hidden until the right moment, then appears once. The full online browser test still passes. None of this has been tried on the original server yet.
