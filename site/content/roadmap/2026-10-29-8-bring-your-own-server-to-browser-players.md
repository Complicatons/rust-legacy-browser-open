---
date: 2026-10-29
title: Bring your own server to browser players
summary: A new guide for operators already running their own Legacy community, explaining what it takes to let browser and launcher players join too, without changing anything else about how they run it.
stats: 1 | file to download; 3 | server frameworks covered; 1 | plugin file (Oxide) or a reversible patch (stock)
media: make-your-server-browser-ready.jpg | The new "Make your server browser ready" help page
---

If you already run your own Rust Legacy community — your own Oxide plugins, your own admins, your own players — you don't have to move anything to also let browser and launcher players in. A new help page spells out exactly what that takes.

## What changed

- **A new guide**, [Make your server browser ready](/docs/make-your-server-browser-ready), for an operator who isn't on this website yet. It explains what gets added for an Oxide server (one plugin file), a stock server (a small, reversible patch — the original file is always kept beside it), and that Fougerite isn't supported yet. Either way, your existing players keep joining exactly as before; there's a separate, off-by-default switch for admitting website players only.
- **No new download was needed.** The single download it points to is **Rust Legacy Host**, the same installer every server on this site already uses, through its existing "an existing server, as it is" path.
- **A small rendering bug fixed along the way**: every help page except one was showing a stray line reading "null" under its title. Gone now, across every page in **Help**.

## Next

[List your server](/docs/list-your-server) once you're connected, so players can actually find it.
