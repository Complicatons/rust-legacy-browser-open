---
date: 2026-10-21
title: The original server runs, sealed off
summary: For the first time, the original 2014 Rust Legacy server started on the cloud test machine, loaded the island and stayed completely contained.
stats: 1 | original server running; 299,686 | actions recorded; 0 | network connections let out; 2 | blocked attempts to phone home
media: site-servers.jpg | The server browser this server will appear in next
---

The original Rust Legacy server program, from 2014, started for the first time on the project's locked-down test machine in Microsoft's cloud. It loaded the island, opened its game port and reported "Server Initialized".

## What it did

Every action it took was recorded, nearly 300,000 in total, and checked afterwards:

- **Files:** it wrote only inside its own folder and its own restricted account: its logs and the offline Steam emulator's settings.
- **Settings:** the only settings it changed were Windows' own audio codec list for its account.
- **Internet:** it tried twice to reach the internet over plain web connections, one to Google and one to a content network. Both were stopped by the firewall. These look like the old networking library's usage statistics and the engine's own reporting, both expected.
- **Nothing else:** it started no other programs and loaded nothing from outside its own folder and Windows.

## One missing piece

On the first try, the server's game library would not load. The offline Steam emulator it uses needs an old Microsoft runtime (Visual C++ 2013), which modern Windows Server doesn't include. Installing Microsoft's official runtime fixed it, and the test kit now checks for it.

## What's next

The next step is connecting the browser port to this server: the website, the gateway and then the first player joining the original server from a browser.
