# Browser server support: first-release decision

17 October 2026. Proposed first-release design selected for implementation planning. No native integration has been demonstrated.

## Decision

The supported first release will require an operator-installed **gateway and server identity adapter**. Players install nothing. The existing Legacy server continues to run the world and keep saves; normal desktop players retain their native connection path.

Gateway-only access to unchanged servers is a later compatibility experiment, not a prerequisite or a promised feature. This supersedes the earlier recommendation to investigate unchanged-server access first. We will first prove one integrated server build, then package the result for other operators.

This is a design decision, not evidence that the required server hooks already work. Adapter may mean an ordinary plugin, a framework extension or a narrowly versioned server patch. Select the smallest integration that can safely participate before authentication and player creation. Do not advertise it as a universal drop-in plugin.

The public [player and server-owner guide](https://github.com/OWNER/rust-legacy-browser/blob/main/docs/PLAYERS-AND-SERVER-OWNERS.md) explains this decision without protocol terminology. Keep it labelled as planned until the native acceptance gates pass. Public wording must make bridge installation, one-time existing-character linking and per-server saves clear before a player chooses Join.

## Player experience

**Existing desktop character:** sign into the website; select a browser-ready server; join that server using the desktop character once; run the adapter's proposed `/browserlink` command; redeem its private, short-lived code on the website; then join from the browser. The proposed command does not exist yet.

**New player:** sign into the website, choose a browser-ready server and join. The server allocates and persists a supported backend identity. An existing Steam-style ID must never be guessed, supplied by the browser or overwritten.

**Returning player:** website login resolves the same account and server-specific mapping; the server loads the existing character according to its own save/wipe rules. Display-name or IP changes do not create a new identity.

**Unsupported server:** show “Browser support not installed” or exclude it from the playable list. Never offer a Join button that implies an untested gateway can authenticate to it. Explain that its operator must install a supported integration. Do not disguise a new character as migration of an existing one.

## Components and hosting

| Component | Who runs it | Responsibility |
| --- | --- | --- |
| Website/browser client | Project | Load the client, sign in, show servers and start a join |
| Accounts and directory | Project | Stable platform identity, server ownership, admission tickets and listing health |
| Gateway service | Initially beside the game server | Secure browser connection and one native game session per player; transport/protocol translation |
| Identity adapter | Participating game server | Verify browser admission before spawn; bind to the correct backend identity; expose verified linking and lifecycle hooks |
| Original Legacy process and saves | Server operator | Authoritative gameplay, inventory, world and ownership |

Colocation is the first supported arrangement: the native gateway connection and adapter control channel stay on the same host, and the control interface is not exposed publicly. Desktop players may keep using the native game endpoint. Remote gateways require a later, separately tested encrypted/private backend arrangement.

## Establishing identity on every join

1. Website authenticates the account and requests admission for a specific registered server.
2. Account service issues a short-lived, one-use signed admission containing an opaque account subject, server audience, expiry, unique join identifier and compatible client profile. It grants no admin role or inventory.
3. Browser opens that server's secure gateway connection and submits the admission in an initial protocol message, not a URL. Gateway verifies/redeems admission through the account service.
4. Gateway creates a separate native session with an unpredictable binding secret. Through its authenticated local control channel it requests a pending admission from the adapter, tied to the verified account, server, join identifier and that one session.
5. The native approval path must prove possession of the pending admission and bind it to the exact backend connection before authentication completes. The adapter resolves the authoritative identity mapping, checks bans/capacity/duplicates and approves the browser-specific branch. Normal native clients continue through normal native authentication.
6. Only after a real server approval/spawn does the browser enter the world. All later game messages use that established session; reconnect requires an explicitly verified resume or a new admission.

The actual browser-admission envelope and its location in the native handshake are **not yet selected**. A candidate is a distinctly typed adapter-only envelope in an existing length-bounded login field, intercepted before the native ticket verifier. It must never be presented as a legitimate Steam ticket. Its feasibility depends on exact field limits, hook order and connection lifecycle. If ordinary hooks cannot implement this branch, build a version-specific extension; do not just return “allow” from a late login hook.

Connection binding must be proved using a one-use secret/proof and server-side connection context, with replay/race tests. IP address, gateway source port and claimed numeric ID alone are insufficient. Until the insertion point and proof are demonstrated against the original server, this is a contract for implementation, not a completed protocol specification.

## Linking a desktop character

The adapter issues a link challenge only to an already authenticated native character. The challenge is delivered privately, expires promptly and is bound to the server UUID and that character's backend identity. The website requires the player to sign in before redemption.

Final linking must atomically check both sides: central account subject and native character mapping. Use a reservation/confirmation transaction with idempotent retries; do not report success while only one service has committed. Permit one active website owner per server character and reject conflicts rather than merge saves automatically.

The server remains authoritative for its identity map and stores a durable mapping from issuer/account subject to native identity. Central services may keep a link reference for UI and recovery, but cannot override it merely because a user types an ID. Never auto-link by nickname, email or IP. A weakly authenticated community desktop identity gives correspondingly weak ownership proof; such profiles need an operator-reviewed linking policy rather than claims of strong ownership verification.

Existing backend identity remains unchanged after linking so saves, doors, building ownership, bans and permissions retain their existing keys. Linking grants no new permissions and does not lift bans. Require recent account authentication for changes. Audit reassignment/recovery; rate-limit challenges and never publish them in chat or logs.

Steam account linking can be offered separately, but neither a Steam display name nor a website OpenID login supplies the original game-session ticket. A Steam link must not automatically claim a community-generated numeric identity.

## New browser characters

The adapter must first establish whether the supported server and its plugins safely accept a distinct backend ID namespace. Allocate collision-checked IDs transactionally and persist the mapping before character creation. Do not merely hash/truncate the website UUID or claim generated IDs are Valve-issued Steam identities.

If no safe namespace can be supported, limit the first pilot to explicitly linked existing identities while investigating a proper server profile. No arbitrary-ID fallback is acceptable. Specify whether that identity can later be used on desktop before promising desktop/browser interchangeability for newly created browser characters.

## Simultaneous sessions, failure and persistence

- Maintain a per-server identity lease. Default policy: reject a second live session and explain how to disconnect the first. Do not let an unverified connection kick an existing desktop player.
- A validated reconnect may replace a stale session after a bounded grace period. Reattach the existing identity instead of creating a new loadout.
- Refuse new browser admissions if central verification or adapter trust fails. Existing authenticated gameplay may continue under an explicit operator policy. Native users retain the native path.
- Back up identity mappings with consistent world/player saves and server identity. Validate restore before pilot publication.
- Browser clients receive authoritative state. Client-provided saves, item quantities and ownership claims cannot override the server.

## Exact first engineering milestone

Deliver a **single-build admission proof**, before the full website or community installer:

1. Record server/framework build hashes and trace the native approval/authentication/player-creation sequence using existing static evidence.
2. Identify and document an early integration point and a bounded, authenticated pending-session binding mechanism.
3. Write the adapter/gateway admission slice and tests using project-owned code. Mock tests can run on this PC but do not prove native compatibility.
4. In a permitted test environment, have one real browser join the original server through the gateway, authenticate as a mapped identity and spawn.
5. Reject a replay, wrong-server admission, wrong connection binding and an attempt to claim another backend ID. Verify ordinary desktop joins still work.
6. Prove one desktop character link, browser reconnect with the same inventory and ownership, and persistence after server restart.

The next milestone is two browser players plus one native player sharing the same world, with visible movement and a server-authoritative interaction. Then expand original gameplay-message coverage, backups, diagnostics, performance tests and a second operator install.

No isolated native test host is currently available. Supplied original binaries remain prohibited on this PC under the existing instruction. That limits the live proof; it does not prevent implementing and testing project-owned admission components. This decision does not authorise purchases, contacting operators or running the supplied software.

## Limits and later work

This adapter solves identity admission, not all networking. Native uLink replication, message serialization, game state, prediction and browser timing still need implementation and testing. Native anti-cheat assumptions also require explicit operator support; no claim of equivalent browser protection is made.

After one integrated profile works, investigate gateway-only access for specifically compatible unchanged servers. If their existing legitimate authentication cannot be satisfied without an installed helper or server integration, mark them unsupported. Do not block the supported adapter release on that research.

See [the detailed investigation](EXISTING-SERVER-INTEGRATION-PLAN.md) for evidence, sources, transport choices and acceptance scenarios, and [the accounts/hosting plan](HOSTING-ACCOUNTS-BRIDGE-PLAN.md) for the wider platform.
