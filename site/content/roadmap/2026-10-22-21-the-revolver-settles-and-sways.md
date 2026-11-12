---
date: 2026-10-22
title: The revolver settles and sways
summary: The revolver in your hands now moves like the original between shots. It settles into a still pose, sways gently after a while, swings as you walk, and holds steady when you aim or crouch. With this, every part of the original game we listed is done or has a written reason.
stats: 8 s | standing still before the sway starts; 20 % | sway strength when standing; 2.5x | sway speed while walking; 0 | open items left
media: revolver-idle-walk.jpg | Walking with the revolver: the original idle sway at full strength; revolver-idle-frame.jpg | Right after drawing it: the still pose the original settles into
---

The original game gives the revolver its own idle motion. Until now our revolver froze on the last frame of whatever it did last.

## What changed

- **A still pose first.** After drawing, firing or reloading, the revolver settles into the original's still pose.
- **A gentle sway when you stand.** Stand still for 8 seconds and a slow sway fades in, at a fifth of its full strength.
- **Movement.** Walking swings it at full strength and faster. Falling, crouch-walking and sprinting each use their own speed and strength.
- **Steady when it matters.** Aiming, crouching still, or turning your view quickly brings it back to the still pose.

This uses the same mixing rules as the original, ported line by line, with the revolver's own timings.

## The list is done

Every class in the original game's code, and every prefab, item, setting, window and sound we checked, is now either in the port or has a written reason why it is not needed in a browser.

## How it was checked

Unit tests replay the original's blending frame by frame with the revolver's settings. A browser test draws the revolver, checks the still pose, then walks and checks the sway.
