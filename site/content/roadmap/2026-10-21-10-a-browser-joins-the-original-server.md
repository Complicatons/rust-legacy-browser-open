---
date: 2026-10-21
title: A browser joins the original server
summary: For the first time, a player in a web browser joined the original 2014 Rust Legacy server and spawned on the island.
stats: 1 | browser player on the original server; 3 | protocol fixes; 227 | network tests passing; 0 | changes to the server's game rules
media: site-servers.jpg | The server browser the original server is joined from
---

A player in a web browser joined the original Rust Legacy server for the first time. The server ran on the project's sealed-off test machine in Microsoft's cloud, the player signed in on the website, picked the server in the in-game server browser and spawned on the island, with the server's own wolves and bears loaded around them.

## What it took

The browser talks to the server through the project's gateway, which speaks the server's original network language. That language had been rebuilt by reading the original game files and had only ever been tested against the project's own stand-in server. Meeting the real one showed three places where the rebuild was slightly off:

- **Message numbering:** the original numbers each connection's messages starting from a random value agreed during the handshake, not from zero. The server was quietly throwing away the player's login as an old duplicate.
- **The welcome bundle:** when a player connects, the server sends everything that already exists in the world in one bundle. The gateway now unpacks it the way the original game does.
- **New objects:** extra details sent with each new object (such as the player's name) are laid out differently from what the rebuild expected, which hid the server's core management object and the player's own character.

All three are fixed and covered by tests, and the server itself is unchanged apart from the small add-on that lets website accounts in.

## What's next

Gameplay testing on the original server: moving, gathering, crafting, building, combat, chat, admin tools, and hours-long runs with several test players at once to catch disconnects and lag.
