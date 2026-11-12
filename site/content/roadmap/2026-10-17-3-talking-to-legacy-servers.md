---
date: 2026-10-17
title: Talking to Legacy servers
summary: The plan for browser players on original servers, the network protocol rebuilt from the code, a gateway, accounts and Steam or Discord sign-in.
stats: 119 | server calls mapped; 42 | network prefabs; 237 | network messages; 0 | installs for players
media: mock-player.jpg | Test run: a second player joining through the gateway, against our own test server; online-gun.jpg | Test run: aiming at that player online
---

Single player was never the goal. Rust Legacy is a multiplayer game, and the plan is for browser players to join **original Legacy servers**, with the original server staying in charge of the game. 17 October was the day that plan was decided and the groundwork laid, all from reading the code.

## The plan

A browser cannot speak the game's network protocol directly, so each server gets a small **gateway** that sits next to it. Your browser talks to the gateway over a WebSocket, and the gateway talks to the server in the game's own protocol. Players install nothing. Only server owners add the gateway and a small plugin. A desktop player can link their old character to a website account, which is optional.

## The protocol, rebuilt from the code

Rust Legacy uses a networking library called uLink on top of Lidgren. Its connection steps, packet framing, acknowledgements, resends, splitting of large messages and clock sync were mapped from the decompiled code. The servers turned out to run without encryption, which keeps the gateway simple. From there the work mapped the game's own traffic: joining and spawning, movement, inventory, doors, looting, building, combat, death and respawn. That came to **119 server calls**, **42 network prefabs** and **237 network messages**, with tests built from the byte layouts in the code.

The gateway and a project-owned test server were built on the same day. Every online check so far runs against that test server, never the original one. Proving the gateway against a real Legacy server is still ahead (see What's coming).

## Accounts

A central account service now lists servers, signs players in, hands out one-use join tickets and lets owners register and publish their servers. Sign-in with **Steam** and **Discord** was added, and the first version of this website went up with a server list and owner tools. The admission plugin for Oxide servers and a patcher for servers without Oxide were written too; neither has run on a real server yet.
