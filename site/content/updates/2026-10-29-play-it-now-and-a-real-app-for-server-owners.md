---
date: 2026-10-29
title: Play it now, and a real app for server owners
summary: The island is live at /play with no download, Rust Legacy Host became an installable Windows app that ran a real server for five days, and desktop players can sign up from the launcher
image: /site/generated/media/roadmap/host-boot.jpg
---

## Play it right now

**[/play](/play)** is live: the recovered island, open in your browser, no account or download needed to look around. This is the single-player explorer the whole port has been checked against. Joining a real community server still needs the first public game server, which is prepared and waiting to switch on.

## A real app for server owners

**Rust Legacy Host** stopped being a folder of scripts and became an actual Windows program: its own window, a tray icon, a boot screen that checks and starts each part in order, and a terminal docked at the side for quick commands.

- **One download to install**, and an owner with a server already running can point the installer at it and **attach it as it is** — no reinstall, one code to link it to the website.
- A **setup wizard** instead of sixteen separate scripts, each step showing its own plan and live output.
- **Health graphs and Discord alerts**, a **player history** page, **scheduled restarts and wipes** with countdown warnings in chat, a **settings and plugin editor**, a one-button **health check**, **off-site backups**, and **signed updates** the app checks before installing.

We installed it on a real Windows test server for the first time. It ran the original Rust Legacy server there: saving and quitting cleanly, restarting on schedule, wiping the map, and greeting players — then kept running **unattended for five days**, which is how we found and fixed a crashed game server that was never being started again.

## Desktop players

Players who want the original desktop game as well as the browser can now make their website account **inside the launcher itself**, with ticks to remember their name and stay signed in. One account works in both.

## Closer to the original, again

We checked every message the original server sends the game and every one the game sends back; five did not work like the original and are fixed, including another player's torch now lighting up correctly at night. Movement, menus, chat, item handling, sounds and online timing were checked against the original's code again, on top of the fixes already covered in earlier updates.

## On the website

A forum, leaderboards, a staff review panel for new server listings, a rewritten privacy notice, and tests that now run automatically on every change.

Everything from these six days, with pictures, is on the [roadmap](/roadmap#day-2026-10-29).
