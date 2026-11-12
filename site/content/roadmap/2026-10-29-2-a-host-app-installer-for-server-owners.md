---
date: 2026-10-29
title: A host app installer for server owners
summary: Server owners can download one installer, point it at the Legacy server they already run, and finish on the dashboard without any scripts.
stats: 1 | file to download; 4 | installer pages; 5 | steps for an existing server; 1 | code to link it to the website (was 2); 9 | new tests
media: host-installer-server.jpg | The installer checking a server folder: its SHA-256, the kind of server, and whether it can be made browser ready; host-attach.jpg | The Setup page's new choice, "An existing server, as it is", after its first two steps
---

Rust Legacy Host is the program a server owner installs next to their Legacy server. It runs the server with our gateway, which lets browser players in, and watches it. Until now it came as a folder of files with a PowerShell script to run as an administrator. Now it is one download.

## What changed

- **One installer.** `RustLegacyHostSetup.exe` has four pages: welcome, your server, options, install. On the server page you choose the folder with `rust_server.exe` (or the original server zip), and the installer checks its SHA-256 against the verified build. It also says what kind of server it is: stock, Oxide, Fougerite or a modified build. Running a newer installer updates the app and keeps your settings and backups. It removes itself cleanly from Windows' list of installed apps.
- **An existing server, as it is.** The Setup page had two choices, both building a fresh, locked-down copy of the server. There is now a third for servers that already run, with their own plugins and saves. It has five steps: your server, browser ready, connect to the website, public address, and your OK to run it.
- **Browser ready, done by the app.** On a stock server the app adds our adapter to your own copy and keeps the original file beside it. On an Oxide server it adds one plugin file and leaves your other plugins alone. **Undo** puts every file back. Fougerite servers are recognised but not supported yet.
- **One code instead of two.** The enrolment code from Your servers now links the gateway and the website console in one step.
- **Downloads on the website.** The host app's help page gets a download box with the version, size and SHA-256. The file describing the release is signed with the same project key as the app's updates.
- **Its own Windows account.** An existing server runs under the app's own Windows account, which has no password and no administrator rights, and only after you agree on the Setup page.

## Not yet

The installer is **not code-signed** yet, so Windows warns about it; the help page explains how to check the file first. It has not been run on a clean Windows machine yet. That dry run, on our test server, is next.

## How it was checked

9 new tests cover checking server folders of every kind, making a server browser ready and undoing it exactly, the one-code link against a local copy of the website, the signed release file, and the download links. The installer itself was built and run in a mode that shows its pages without installing anything, against a stand-in server folder. The pictures above come from that run and from the dashboard on the same folder. The original server was not used.
