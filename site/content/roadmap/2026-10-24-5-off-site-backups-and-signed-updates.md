---
date: 2026-10-24
title: Off-site backups and signed updates
summary: The host app can copy each server's world, player files and account links to another place on a schedule, encrypted if the owner likes, and can fetch updates that are signed by us.
stats: 2 | kinds of off-site storage; 3 | files in every backup set; 1 | signature checked on every update
media: host-offsite.jpg | Off-site backups to a folder, with an encrypted set restored (demo server); host-update-feed.jpg | An update fetched from the feed, signature checked and ready to install
---

## Off-site backups

A copy on the same disk doesn't help if the machine is lost. Owners can now send backups to a network or synced folder, or to cloud storage such as Amazon S3, Backblaze B2 or Cloudflare R2, every few hours and once a day. Each set holds the world, the players' files and the list of which account owns which character, because a world can't be given back to the right players without that list. Sets can be encrypted with a passphrase, and every file is checked before a restore changes anything.

## Signed updates

The host app can check an update feed, download the newest version and install it with one click (or on its own while the server is empty). Every update is signed by the project, and anything that doesn't match is refused. The feed itself goes live once we publish our first release.
