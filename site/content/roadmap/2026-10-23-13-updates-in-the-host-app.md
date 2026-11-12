---
date: 2026-10-23
title: Updates in the host app
summary: Server owners can install a new gateway or set of game files from the host app, see what it changes first, and undo it with one click.
stats: 1 | click to roll back; 0 | website files replaced without the owner's say-so; 2 | ways to install the same update; 17 | dashboard checks passing
media: host-updates.jpg | An update waiting in the host app: its fingerprint, how many files it has, and which parts of the server it touches
---

Fixes to the gateway and the game files land often, and every server needs them. Until now, an update meant a script run on the server by hand.

## What the owner does

1. Add the update file in the host app.
2. Check what it does before anything changes: its fingerprint (to compare with the one published beside it), how many files it has, and which parts of the server it touches.
3. Click Install. Every file it replaces is copied aside first. Only the affected parts restart, and the game server keeps running.
4. If something is wrong, click Roll back. The old files come back, and anything the update added goes away.

An update that would also replace the website's own files says so, and installs only when the owner allows it.

## The same update, two ways

The host app follows exactly the rules of the install script the test server already uses. A test checks the two rules against each other, so an update file installs the same way through either.

## What's next

An installer, so a server owner can set all of this up from one download.
