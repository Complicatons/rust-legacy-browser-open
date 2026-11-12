---
title: Make your server browser ready
summary: Keep running your own community server and let browser and launcher players join it too
group: Running a server
order: 0.5
---

Already running a Rust Legacy server of your own, with your own plugins, admins and players? You don't have to move anything or give that up to let browser and launcher players join too. This adds a path in; it doesn't replace what you already have.

## What it takes

Our browser client can't join a server directly (no Steam ticket in a browser), so a small piece — **the adapter** — has to sit on your server and tell it to accept those connections. Which kind you need depends on your server framework:

| Your server | What's added | What happens to the rest |
| --- | --- | --- |
| **Oxide (Legacy)** | One plugin file, with its own config | Your other plugins are untouched |
| **Stock / vanilla** | A small, reversible patch to `Assembly-CSharp.dll` (the original file is kept beside it) | Nothing else changes; **Undo** puts the original back exactly |
| **Fougerite** | Not supported yet — we're working on it | — |

Either way, your existing players keep joining exactly as before. There's a separate switch, off by default, for only admitting players who signed in on this website — leave it off and nothing changes for anyone.

## The one download

Everything above is handled by **Rust Legacy Host**, the same installer every server on this site uses. On its **Your server** page, point it at your existing install (the Legacy server folder, or the original zip); it detects your framework and offers to attach to it **as it is**, instead of building a fresh copy. See [the host app](/docs/install-the-host-app) for every step, including what the install adds, what it never touches, and how to undo it.

Prefer not to run our host app at all? The adapter, gateway and sidecar can be run on their own — ask in our [Discord](https://discord.gg/your-invite) or on [Contact](/contact).

## Once you're connected

[List your server](/docs/list-your-server) so players can actually find it — a server can run our gateway without being listed, but nobody will see it on the server list or in the launcher until you do.
