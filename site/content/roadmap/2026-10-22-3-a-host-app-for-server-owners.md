---
date: 2026-10-22
title: A host app for server owners
summary: The first piece of one app that runs a Legacy server, our gateway and the website together. It restarts a frozen server by itself and keeps the last good save.
stats: 3 | signs of life watched; 6 | good saves kept; 4 | parts started in order; 26 | automated checks for the host app
media: host-hang-recovered.jpg | The mock server froze mid-save. All three lanes went quiet, the host restarted it and put the last good save back; host-going-quiet.jpg | Seconds before: the watchdog turns amber as the lanes go silent; host-logs.jpg | Live logs from every part in one place
---

Running a server today means following a 16-step runbook over Remote Desktop and watching four console windows. This is the first slice of the app that replaces all of that: one program the owner installs on their own PC or VPS, with a dashboard in the browser.

## What works now

- **Start, stop and restart** for the game server, the website, the gateway and its helper, one at a time or all together in the right order.
- **Live logs** from every part in one view, with filters and search.
- **A watchdog for the freeze we hit today.** In a test on the original server, it stopped at its first autosave with no error. It used no CPU, wrote no log lines, answered nothing and left empty save files. The host now watches all three signs of life. When all three go quiet, it restarts the server and first puts back the last save that finished properly. A crash is handled the same way.

## How it was tested

Against our own stand-in server, which can freeze on command exactly the way the original did. The original server is never started by the host in testing. The host refuses to run it until the owner confirms, and only under the same lock-down checks as the test scripts.

## What's next

A setup wizard that turns the test scripts into steps with a pass or fail for each. Then player management, anti-cheat and remote access through the owner's own website, so a VPS never needs Remote Desktop. Then an installer.
