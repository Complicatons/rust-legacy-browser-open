# Port-coverage ledger: method

Goal: prove, class by class, that the browser port covers the original client. Static analysis only; no original code is run.

## Pipeline

1. `python tools/probe_script_usage.py <repo-with-analysis>` reads every client bundle and loose data file with UnityPy (data only) and counts MonoBehaviour/ScriptableObject instances per MonoScript, with the prefab or scene root each sits under, plus every asset-level ScriptableObject (items, traits, loot lists). Output: `analysis/port-coverage/script-usage.json`.
2. `python tools/probe_prefab_usage.py <repo-with-analysis>` lists every root GameObject in `gameobject.000/001` and decides which ones the game can reach: a PPtr from a scene, a ScriptableObject or another reached prefab; a serialized string naming it (bundle path, NGC handle); a string literal in the decompiled client/server C#; the NGC registry; or the server build's own scenes and datablocks (spawners, loot spawners). It also lists every AudioClip with the reachable objects that reference it. Output: `analysis/port-coverage/prefab-usage.json`.
3. `tools/port-coverage/census.mjs` enumerates every top-level type in `analysis/decompiled/client/*` (ILSpy output), marks a type *used* when shipped data instantiates it on a reachable object, when it is a ConsoleSystem (reached by reflection from console/config lines), or when a used type mentions it (identifier closure, so "used" is an upper bound), and records where the port cites it.
4. Judgments: `tools/port-coverage/judgments/*.txt` (one line per type: `Key|Status|What it does|Port pointer or reason`) and `data.txt` (prefabs, sounds, convars, UI windows the export evidence cannot decide). Status: P Ported (port files), N N/A (reason: `engine:`, `server:`, `editor:`, `debug:`, `empty:` or plain text), A Partial, M Missing, B Blocked.
5. `node tools/port-coverage/build-ledger.mjs` merges everything, checks it (`--check`: every type judged, no stale keys, every pointer file exists, reached types need an N/A reason), and writes `analysis/port-coverage/ledger.json`, `docs/port-coverage/ledger.json`, `docs/port-coverage/classes.md` and `PORT-COVERAGE.md`.

Shipped data that reaches the recovered exports (`browser/assets/recovered`, matched by name, bundle path, NGC handle, asset identity or `sound-<token>` file) counts as Ported automatically; unreached prefabs are N/A automatically.

## Keeping it current

When a gap is ported, change its line from A/M to P with the port file, rerun the build and commit `PORT-COVERAGE.md` and `docs/port-coverage/` with the change. When the decompiled code or the probes change, rerun steps 1–3 and `--check` lists every type that needs a new judgment.

REA's `build_reconstruction_obligation_ledger` / `evaluate_reconstruction_coverage` were considered; they need full evidence bundles with digests per observation, so the ledger is built with these scripts instead.
