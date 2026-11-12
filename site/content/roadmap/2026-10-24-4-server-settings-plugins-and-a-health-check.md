---
date: 2026-10-24
title: Server settings, plugins and a health check
summary: Owners can change their server's settings and manage Oxide plugins from the host app, and one button checks the twelve things that most often go wrong.
stats: 22 | settings explained; 12 | health checks; 0 | files deleted (plugins are archived)
media: host-settings.jpg | Server settings in the host app, each with a short explanation (demo server); host-plugins.jpg | The Plugins page (demo plugins); host-health-check.jpg | The health check, with a fix for each warning
---

## Settings

The host app now edits the server's settings file for you: the server name, PvP, sleepers, airdrops, crafting speed, decay, day and night length and more, each with a one-line explanation and sensible limits. Every save keeps a copy of the old file. The admin password can be set but is never shown back.

Two settings belong to our own server add-on: **website players only**, for public servers, and a new **message of the day** that every player sees after joining.

## Plugins

A **Plugins** page lists the server's Oxide plugins with their version and author. Owners can add, turn off and remove them; removed plugins are archived, not deleted.

## Health check

**Run checks** on the Overview looks at the ports, firewall, server files, our add-on and its version, the website link, the clock, the certificate, disk space and backups. Each warning comes with what to do about it.
