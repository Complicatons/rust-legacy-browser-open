---
date: 2026-10-23
title: A steadier connection to the server
summary: One player's broken connection can no longer drop everyone else, slow or vanished browsers are let go in time, and kicks now show the original game's message.
stats: 8 | connection gaps fixed; 1 | player affected by a bad message (was everyone); 60 s | until a silent page says it was disconnected; 19 | new tests
media: gateway-kick-text.jpg | Our port after an admin kick, showing the original game's "Disconnected (Kicked by admin)" message
---

Your browser does not talk to the original server directly. A small program in between, the gateway, passes messages both ways. We tested what happens when things go wrong on that path: a broken message, a browser that stops reading, a tab that vanishes, or someone flooding it. Eight things needed fixing.

## What changed

- **One bad message no longer drops everyone.** A single malformed message from one browser could stop the gateway, which cut every player off and left them unable to rejoin for a while. Now only that one connection ends, as in the original, where one client's bad packet never affected anyone else.
- **Slow browsers.** If a page stops keeping up, the gateway now merges the other players' movement updates so only the latest one waits, much like the original's network layer did. A page that falls far behind is let go instead of filling the server's memory.
- **Vanished tabs.** The gateway now checks every 15 seconds that your page is still there and frees your place if it is gone. Your page does the same the other way: after 60 seconds with nothing from the server it shows "Disconnected from server.", the same wait and text as the original.
- **Walls behind you.** When you walk away from an area or another player leaves, their buildings are now forgotten by the anti-cheat's line-of-sight check too, so it no longer thinks a wall is there that your game no longer has.
- **Odd timestamps.** A movement message stamped far in the future could stall all your later moves. Those times are now kept within sensible limits.
- **Limits before you join.** Before you are signed in to a server, each address can only open a few connections and ask for a few join tickets, messages are kept small, and a full server now says so with the original's "too many connected players" message.
- **Kick messages.** When the gateway removed you, for the anti-cheat, an admin kick, a ban or signing in from another tab, the page showed nothing. It now shows the original's text, for example "Disconnected (Kicked by admin)".
- **Messages for things you cannot see.** Messages about objects your game never received are now dropped, as the original client does, instead of being kept in the page.

## How it was checked

19 new tests drive the gateway with broken messages, stalled and vanished browsers, floods of connections and join tickets, far-future timestamps and kicks. The full online browser test on our test server passes, ending with the kick message shown above. None of this has been tried against the original server yet.
