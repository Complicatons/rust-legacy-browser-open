---
date: 2026-10-19
title: Chat, grass and world shaders
summary: The original chat and F1 console on servers, the full item menu, the original grass and the lighting of the original renderer.
stats: 128 | chars per chat line; 16 s | lines stay up; 6 | item menu actions
media: chat.jpg | The original chat; grass-meadow.jpg | A meadow on the hills; in-game-fantastic.jpg | Grass and lighting at the Fantastic quality level
---

This round worked through the top of a gap audit: a list of everything the original client does that the port did not do yet. The [update from 19 October](/updates/2026-10-19-chat-console-and-shaders) has a short version.

## Chat and console

Press Return or T to chat. The chat box is the original layout, lines stay up for 16 seconds, and the original limits apply: 128 characters a line and one message a second. On a server, F1 console commands the client does not handle itself are sent to the server and its replies are shown, so admin and plugin commands work.

## Items

The right-click item menu has every original action: split, study, unload, eat or drink, use, and blood draw. Dragging follows the original rules: Shift combines stacks, an empty cell moves the item, and items never swap. Blueprints can be studied and the Research Kit works, as in the original.

## Online fixes

Fall damage and broken legs now reach the server, the time of day follows the server's clock, the hand cannon fires, kicks show the original reason, and the stuck-player, explosive-charge and repair-bench messages are handled.

## The original look

The original grass system came across with its shader and density rules. It is **off by default**, as decided by the project owner, and can be turned on in Options. Only the Good quality level and above draw it, as in the original. The world now uses the maths of the original renderer for its lighting, so rocks, bark, leaves and terrain are lit as in Legacy. That also means **nights are nearly black**, because that is what the original data gives.
