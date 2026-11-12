---
date: 2026-10-22
title: Resource nodes from the original server
summary: The browser now sees the original server's ore, stone and wood piles, and a browser player gathered from one on the real server. A one-letter naming rule had been hiding them, and the server's buildings, deployables and sleepers too.
stats: 0 | resource nodes seen before; 5 | resources from 6 swings; 1 | character the original client reads; 917 | automated tests passing
media: native-gather.jpg | Test run on the original server: swinging the Rock at a sulfur ore node; guide-gather-ore.jpg | An ore node in the browser port
---

In the first test run against the original server, the gathering check found no resource nodes at all, even though the server spawns ore, stone and wood piles all over the island.

## Why

The server sends static objects such as resource nodes, buildings, deployables and sleepers through Rust's own object layer. Each new object gets a message with its own name: the letter A followed by the object's number, like "A1f". The original client looks only at the first letter. Our gateway expected the name to be exactly "A", so it ignored every one of them without any error.

## The fix

The gateway now reads these names the way the original client does: by the first letter. Our own test server now uses the original server's names too, so every existing test checks the new rule. A new test replays what a joining player receives: a group of objects bundled together, then a change to one, then its removal.

## On the real server

After the gateway on the cloud test machine was updated, the automated check joined the original server from a browser. It found a sulfur ore node 50 m away, walked up to it and swung the Rock six times. The server answered with its own gather messages: 2 Stones and 3 Sulfur Ore went into the inventory.

## What's next

Buildings and deployables come through the same path, so the building checks against the original server can now be tried too.
