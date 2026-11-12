---
date: 2026-10-23
title: Other players move and die like the original
summary: Other players now walk at a steady speed even when your connection stutters, and their deaths, weapon swaps and corpses play out the way the original game showed them.
stats: 4.8-5.2 m/s | drawn walk speed (was 1.8-8.6); 7 | timing gaps fixed; 0 ms | hit time left on a dying player; 9 | new tests
media: online-remote-gunfire.jpg | Another player firing a held M4 in our port: the shot comes from that gun's own muzzle
---

Other players in our port sometimes walked in bursts, slid to a stop and then hurried on, or flickered between walking and sprinting. The cause was timing, not their movement.

## What it was

The original game gives every update from the server the server's own time, and draws other players a fixed moment behind that clock. Our port worked out each update's time from when the browser happened to read it. When a few updates arrived together, after a network hiccup or a busy moment in the page, they all got almost the same time, so the player in between jumped.

## What changed

- **One clock.** The browser now keeps a single, steady copy of the server's clock and places every update on it, like the original. Players, held weapons, animals, airdrops and your own health changes all use it.
- **Dying players.** A player who has just been killed can no longer be hit while the death plays out, keeps the weapon in their hands until the body falls, and any shot they fired in that moment still shows.
- **Fast weapon swaps.** When someone switches weapons quickly, the old one stays in their hands for the same brief moment as in the original, and its last shot or swing still plays from that weapon.
- **Your own death.** Your body now falls from the pose you were standing in, not from a stiff default pose.
- **Censor setting.** Turning the nudity censor on or off now updates bodies on the ground too.
- **Joining near a player.** Their first position update now places them where they are instead of starting a slide.
