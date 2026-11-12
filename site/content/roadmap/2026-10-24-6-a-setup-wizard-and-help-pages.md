---
date: 2026-10-24
title: A setup wizard and help pages
summary: Setting up a server is now a guided list of steps in the host app instead of sixteen scripts, and the website has new help pages for owners and players.
stats: 14 | setup steps; 1 | line to paste for admin steps; 9 | new help pages
media: host-setup.jpg | The setup wizard: each step's plan, its live output and its result (practice scripts); host-setup-paste.jpg | Steps that need an administrator give the owner one line to paste
---

## The setup wizard

The host app's **Setup** page walks an owner through everything a server needs, on their own PC for testing or on a VPS for a public server: a locked-down account for the game server, its folders, the firewall, an isolation check, certificates, our server add-on, the link to the website and the first start. Each step shows what it will change first, then its output live, then **Passed**, **Passed, with warnings** or **Failed** with the reason. Steps that need an administrator hand the owner one line to paste into PowerShell, and the wizard reads the result back on its own.

The wizard runs the same setup scripts as before, so nothing about how a server is locked down has changed. It's tested with practice scripts here; the first run with the real scripts is next.

## Help pages

New pages under [Help](/docs) explain how the website, the browser game, the launcher and the host app fit together, and walk owners through setup, restarts and wipes, backups, health and alerts, settings and plugins, updates and troubleshooting. Players get a guide to the launcher.
