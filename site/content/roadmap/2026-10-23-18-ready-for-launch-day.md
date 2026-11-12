---
date: 2026-10-23
title: Ready for launch day
summary: We checked the game and the website for the things that go wrong with a lot of new players at once: slow pages, browsers that cannot run 3D graphics, search engines and security. The website got lighter and steadier, and the game now explains what to do when a browser cannot start it.
stats: 2.8 s | to rejoin the island; 0.9 MB | updates page (was 2.6 MB); 0 | layout jumps on the server list; 10 min | soak with flat memory
media: release-no-webgl.jpg | When a browser cannot start 3D graphics, the game now says so and what to change, instead of a black screen; release-gpu-reset.jpg | If the graphics device stops and does not come back, a reload button appears. When the browser brings it back, play goes on as before; release-site-phone.jpg | The website's home page on a phone, with the lighter title picture
---

Before the servers open we went through the game and the website as a new player would, on a fast PC, a slow phone and a browser that cannot run the game.

## The game

- **No 3D graphics.** If hardware acceleration is off or the browser is too old, the game used to show a black menu, then "Could not load island" after you picked a server. It now says straight away that the browser could not start 3D graphics, and lists what to change.
- **Graphics reset.** A driver update or waking from sleep can reset the graphics. The game picks up again by itself. If the browser never gives the graphics back, you get a reload button after 10 seconds instead of a frozen picture.
- **Joining.** On a normal home connection the first join takes about 20 seconds and downloads 166 MB once. After that it takes under 3 seconds and downloads nothing.
- **Long sessions.** Ten minutes of walking, gathering, fighting and building used the same memory at the end as after the first minute.
- **Smoothness.** We timed every graphics setting from Fastest to Fantastic in a town, a forest and a high view. None had a frame over 50 ms.

## The website

- **Lighter pictures.** The big pictures now load in a smaller format, and phones get a smaller copy. The updates page went from 2.6 MB to 0.9 MB.
- **No jumping.** The updates page and the server list on phones used to jump as they loaded. They now stay still.
- **Easier to read.** The orange buttons are a little darker so their white text is clear, and some grey text is lighter.
- **Search and safety.** Search engines now get a list of every public page, and private pages such as your account are kept out of search results. The site also tells browsers to always use a secure connection and never show it inside another site. Errors now show a proper page instead of computer text.

The game looks and plays exactly as before. These changes only show when something goes wrong, or on the website.
