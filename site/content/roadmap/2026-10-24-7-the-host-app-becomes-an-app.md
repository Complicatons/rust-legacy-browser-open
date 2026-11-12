---
date: 2026-10-24
title: The host app becomes an app
summary: Rust Legacy Host now opens as its own Windows program, starting with a terminal that shows the server coming up step by step, and keeps a terminal docked at the side for PowerShell, CMD and quick server commands.
stats: 1 | window, no sign-in link to paste; 3 | terminal tabs; 0 | ways to reach a shell from the website
media: host-boot.jpg | Starting up: each part of the server checked and started in order (demo server); host-terminal.jpg | The dashboard with the terminal docked at the side, restarting the gateway (demo server)
---

Server owners asked for something that feels like real software rather than a web page. The host app now has its own window, Start menu shortcut and tray icon.

## Starting up

Opening it starts in a terminal. Each step types itself out as it really happens: the service answering, the settings read, then the website part, sidecar, game server and gateway in order, then every line of the health check, each marked **OK**, **WARN** or **FAIL** with what to do about it. Then the terminal slides aside and the dashboard opens. Esc skips it.

## The terminal panel

A terminal stays docked at the side (Ctrl+` hides it), with three tabs:

- **Host**: quick commands such as `status`, `restart gateway`, `logs server --follow`, `backup now` and `restart-in 10`, with tab completion.
- **PowerShell** and **CMD**: real Windows shells on the server machine.

The shells only exist inside the app on the machine itself. Nothing on the website, and no other computer, can open one.

## The tray

The tray icon shows the server's state at a glance, warns about crashes and freezes, and has Start, Stop and Restart. Closing the window leaves the server running, as before.

The app is built and checked in a browser here; it gets its first Windows build next, then its first run with the original server.
