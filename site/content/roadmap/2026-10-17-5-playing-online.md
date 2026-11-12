---
date: 2026-10-17
end: 2026-10-18
title: Playing online
summary: Join a server from the game page and the server runs everything: other players, animals, buildings, inventory, health and every weapon.
stats: 23 | hit regions per player; 20 | armour models; 12 | held item types checked
media: multiplayer.mp4 | Two players through the gateway (against our own test server); remote-armor.jpg | Another player in armour; remote-firing.jpg | Another player firing; online-bow.jpg | Test run: drawing a bow online; online-sleeper.jpg | Test run: a sleeping player and a loot sack; online-fire.jpg | Test run: a server campfire with its original flames
---

Over the evening of 17 October and into the 18th, the game page learned to play online. You join a server from the server list, the page connects through the gateway, and from then on **the server decides what happens**. The browser only shows it and sends what you do.

## What you see

The world the server sends is drawn with the original assets: buildings, deployables, resource nodes as they are used up, doors opening and fires burning. Other players appear with the original player model and animations, wearing their original armour (20 armour models), holding their items, and lying asleep with their clothes on when they log off. Animals are the server's animals, moving and dying as the server says. Dropped loot sacks are there too.

## What you do

Every action became a request to the server instead of a local result. Moving items, looting, crafting, building and placing all send the same requests the original client sends, and nothing changes in your inventory until the server confirms it. Health and metabolism come from the server, death happens once, and respawning waits for the server.

Combat is the biggest part. Each player has the original **23 hit regions** that follow their animated body, so headshots land where they should. Guns, melee, bows and grenades follow the original timing on your side and report hits to the server the way the original client does: the server decides the damage. Torches light up, arrows stick in the player they hit, and explosions show only when the server says something exploded.

All of this is checked against our own test server, not yet against an original one.
