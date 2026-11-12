---
date: 2026-10-23
title: A launcher for the desktop game
summary: A small app where you sign in with your website account, pick a server and press Launch. The window and the account sign-in are built and tested. How it hands your identity to the original game is being reworked, so that part is on hold.
stats: 3 | steps: account, server, game; 1 | account for web and desktop; 0 | game files changed
media: launcher-servers.jpg | The launcher window, signed in, choosing a server (demo data); launcher-playing.jpg | While you play, the launcher keeps your session from the tray (demo data)
---

The browser game is one way to play. The other is the original Rust Legacy on your own PC. For that we are building a launcher: one app, one account, the same as the website.

## How it works

You open the launcher and sign in with your website account. You pick a server and press Connect, then Launch game. While you play, the launcher sits in the tray and checks in with the website every 15 seconds; close it and the server lets you go within a minute.

The window, the sign-in and the server list are built and checked. In the pictures above the launcher is talking to a stand-in website so we could try the whole flow.

## Your game stays as it is

The launcher never changes your game folder. It works from a small folder of its own that points at your files, and settings you change in game are still saved to your own files.

## On hold

The piece that tells a server "this player is signed in" is being reworked, so the launcher is not finished and has not been tried with the real game yet. The direction is that this always goes through the server: a server owner chooses to welcome website players, and nothing on your PC pretends to be anything it is not. We will post again when that part is settled.
