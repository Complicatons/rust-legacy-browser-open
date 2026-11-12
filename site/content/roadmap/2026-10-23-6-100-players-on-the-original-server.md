---
date: 2026-10-23
title: 100 players on the original server
summary: We filled the original Rust Legacy server on our cloud test machine with 100 browser players, ran it for over three hours, stopped it mid-game and started it again, and played over a bad connection. It held up, and we fixed the bugs it showed in our bridge.
stats: 100 | players at once; 101 ms | ping at 100 players; 3 h 17 min | soak without a drop; 0 | kicks at +500 ms lag
media: bad-network-500ms.jpg | A test player on the original server with half a second of added lag and 5 % packet loss, chatting with another test player
---

Every browser player reaches the original Rust Legacy server through our gateway. This time we checked that this works with many players at once, for hours, through a restart and over a poor connection.

## A full server

We added test players in steps, from 10 up to 100, which is as many as the server allows. Ping stayed around 100 ms the whole way. At 100 players the server used about 14 % of the test machine's processor and our gateway 23 %. Most test players were light ones that join through the website without drawing the game; four played the full game in a browser.

## Three hours, and a restart

Test players walked, gathered, chatted and reconnected every few minutes for over three hours without a single drop. Then we stopped the server in the middle of a game and started it again. Players came back exactly where they had been with everything they had gathered, even one that was still connected when the server stopped.

## A bad connection

Two players walked, gathered and chatted with up to half a second of added lag, uneven timing and 5 % packet loss. The server's anti-cheat never kicked them, they were never pulled back, and their inventory was the same after reconnecting.

## Bugs fixed

- After a restart, a player who had been connected was told they were "already connected" and could not get back in. Our bridge now frees their place once the server no longer lists them.
- Some messages a player gets on joining could not be read, and one unreadable message threw away the rest. Each is now read on its own, and the unreadable kind is understood.
- Joining a stopped server now says so after a few seconds instead of loading forever, and a server that dies is noticed within a minute, as in the original game.
