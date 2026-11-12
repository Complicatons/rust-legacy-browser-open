---
title: Backups
summary: Copies of your world on the server, your own copies, and copies kept somewhere else
group: Running a server
order: 6
---

The **Backups** page keeps your world safe in three ways.

## Copies the host app keeps for you

After every completed save, the host app keeps a copy. It holds the newest 6. If the server ever freezes or crashes mid-save, the host app puts the last good copy back before it starts the server again.

## Your own copies

Press **Keep a copy now** and give it a label, such as *before the event*. Your own copies are never removed automatically. You can delete them yourself.

## Restoring a copy

Stop the game server first: a running server would overwrite the restored world at its next autosave. Press **Restore** on a copy. The world it replaces is set aside, never deleted.

## Off-site copies

A copy on the same disk doesn't help if the disk or the whole machine is lost. **Off-site** sends a full set somewhere else on a schedule. A set is:

- the world save;
- the players' files (inventories and blueprints);
- the list of which website account owns which character.

These three go together because a world without the account list can't be given back to the right players.

### Where to

| Target | How to set it up |
| --- | --- |
| **A folder** (a network share, or a folder OneDrive or Dropbox keeps in sync) | Add the folder to the host app's `host.json` as `"offsite": {"folder": "…"}` and restart the host app. Then choose **A folder** on the Backups page. For safety, folders can't be picked from the browser. |
| **S3-compatible storage** (Amazon S3, Backblaze B2, Cloudflare R2, Wasabi) | Choose **S3-compatible storage** and fill in the endpoint, region, bucket, a folder inside it, and an access key. Tick **Path style** for B2 and R2. |

### How often, and how many

By default every 6 hours plus once a day at 04:00. It keeps the newest 8 sets, plus one a day for 14 days. **Back up now** sends one straight away.

### Encryption

Tick **Encrypt** and choose a passphrase. It's on by default for cloud storage. **Keep the passphrase somewhere safe**: an encrypted set can't be restored without it, not even by us.

### Restoring an off-site set

Stop the game server and the sidecar, then press **Restore** on a set. Every file is checked before anything on disk changes. On a new machine, type the passphrase when asked.
