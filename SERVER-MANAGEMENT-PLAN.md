# Server management on the website

23 October 2026. The owner asked for: server owners managing their servers through your-domain.example (logs, start/stop,
admin tools, anti-cheat), a page to submit a server for the in-game server list, documentation for owners, server
teams and players, and (through the hosting session) a site-staff panel that oversees every server. Builds on
HOST-APP-PLAN.md (the host app) and ANTICHEAT-ADMIN-PLAN.md (the per-server admin panel, which already exists).

## Who is who (labels used everywhere)

| Name on the site | Who | Where it applies |
| --- | --- | --- |
| **Site staff** | `platform_staff` (the site owner and anyone he adds with `node tools/central.mjs staff`) | Every server and the whole website |
| **Server owner** | the account that registered the server | That server |
| **Server admin / moderator** | roles the owner gives (`server_roles`) | That server |

The per-server pages call these people the **server team**, never "staff". Site staff outranks every server role
(`roleOn` in central/admin.mjs already does this), so site staff can do everything an owner can on any server.

## 1. Remote control through the website (host relay)

The website cannot reach an owner's host app: it listens on 127.0.0.1 behind their firewall. So the host app calls
out. Once the owner has pasted the host app key (`rlbh_…`, made on /owner) into the host app, it reports to central
every 2 s:

```
host app ──POST /host-relay/report (Bearer rlbh_…)──▶ central
          {status, logs since last seq, backups}      ◀── {commands:[{id, op, target|name|label}], control}
          {results:[{id, ok, error}]} on the next report
```

- Central keeps the latest status, the last 2000 log lines and the command queue **in memory only** (nothing in the
  database: logs can hold player names and addresses). A restart of central empties it; the next report fills it.
- Commands: `start|stop|restart` a component or `all`, `backup-keep {label}`, `backup-restore {name}`. The host app
  runs them with the same `host.act` / `host.backups` calls its own dashboard uses, so the same rules hold (a
  restore needs the server stopped; the original server still needs the owner's confirmation in host.json).
  Commands not picked up in 60 s expire.
- The owner can switch website control off in host.json (`remote.control: false`): status and logs still reach the
  website, commands are refused. `remote.enabled: false` stops reporting altogether.
- Who sees it: the server owner and site staff (rank owner or above). Server admins and moderators keep the
  existing admin panel (players, anti-cheat, bans) but not power control or logs.
- Website: `GET /owner/servers/:id/console?since=` (status, new log lines, recent command results) and
  `POST /owner/servers/:id/console/command`. Every command is in the audit log. Page: `/console?server=<id>`.

## 2. Listing a server (submission and review)

- `server_listings` table (new, additive): description, tags, Discord invite, website, wipe schedule, language,
  state `pending|approved|rejected`, reviewer and note.
- `/list-your-server`: public page explaining what a listing needs and the steps, linking to /owner and the docs.
- /owner: a "Listing" form per server. Submitting puts it in the queue. With `listingReview` on (production), site
  staff approve or reject it on /staff. Approval lists the server, and after that the owner can hide and show it
  themself. With `listingReview` off (default, for test stacks), submitting approves straight away, and Publish works
  as before.
- Approved listing details show on the server's public page.

## 3. Site staff panel (`/staff`)

Only for `platform_staff` (every route checks `db.isStaff`; anyone else gets 403):
- **Servers:** every registered server with owner, online and last heartbeat, players, listed state, host app
  connected, anti-cheat flags (24 h), open reports, linked-account holds. Sortable. Each row opens the server's
  console and admin panel, where site staff has owner-level control.
- **Listing queue:** approve or reject with a note.
- **Suspend or restore a server** (`servers.status`): a suspended server leaves the list, and its gateway's join
  tickets stop.
- CLI: `node tools/central.mjs staff <config> <email> [--remove]`.

## 4. Documentation (`/docs`)

`site/content/docs/*.md` (front matter: title, summary, group, order), built into `site/generated/content/docs.json`
by `build-site content`. Pages are `/docs` and `/docs/<slug>`. Groups: Playing online, Running a server,
Server teams, Site staff.
