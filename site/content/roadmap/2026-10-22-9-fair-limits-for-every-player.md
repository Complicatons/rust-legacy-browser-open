---
date: 2026-10-22
title: Fair limits for every player
summary: Sign-in and join limits now count each player separately once the website runs behind Cloudflare, instead of lumping everyone together.
stats: 2 | services fixed; 22 | Cloudflare ranges trusted; 6 | new tests
media: signin-limited.jpg | Test run: the sign-in form after more than 30 tries in a minute from one address on our test site
---

The website and the game servers limit how often one address can try to sign in, sign up or join, so nobody can hammer them. Those limits counted the address of whatever connected to them directly.

On the public servers, the website sits behind Cloudflare and a web server on the same machine, and the game gateway sits behind Cloudflare. To the website, every visitor would have looked like the same address, so a handful of players signing in together could have locked everyone else out for a minute.

## What changed

- **The real address, from trusted hops only.** The website and the gateway now read the player's address from the headers Cloudflare and the local web server add, but only when the request really came through them. Anyone else who sends those headers is still counted by their own address, so faking them gains nothing.
- **Off unless switched on.** A server that isn't behind a proxy keeps working exactly as before.

## Getting ready for public servers

The your-domain.example domain now runs through Cloudflare, with HTTPS forced on every page. Two servers in the UK are ordered: one for the website and accounts, and a Windows one for the original game server and our bridge beside it. Setting them up comes next.
