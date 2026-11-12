# Oxide plugin checker for Rust Legacy

Fetches the Oxide plugin collections listed in `run.sh`, builds the final Oxide for Rust Legacy (March 2018) from its own source, and compiles each plugin the way that Oxide does. Findings are in [OXIDE-PLUGINS.md](../../OXIDE-PLUGINS.md).

```sh
apt-get install dotnet-sdk-8.0 mono-mcs mono-devel     # once (cloud); Windows: .NET 8 SDK + Mono, run from Git Bash/WSL
MANAGED=analysis/server-audit/rust_server_Data/Managed tools/oxide-plugin-check/run.sh
```

Without `MANAGED`, the main game DLLs come from Oxide's archived copy, which has the same `Assembly-CSharp.dll` as our server (the script warns if the hash differs). The runtime comes from the .NET 3.5 reference assemblies. In that case, `EXTRA_MANAGED=<a Legacy Managed folder>` supplies the other stock DLLs that plugins name in `// Reference:`.

Output in `analysis/oxide-plugin-check/` (ignored by Git):

- `plugins.md`, `plugins.csv`: the best copy of each plugin, with status, problems, browser-player notes and a pinned source link. Copy them to `docs/oxide-plugins/` after a run.
- `all-files.csv`: every unique file and where each copy came from.
- `bundle/oxide/plugins/`: every plugin that loads, ready to copy to a server's `oxide/plugins` folder. Read each one first.
- `shortlist.md`, `bundle-shortlist/oxide/`: the plugins picked in `shortlist.txt` plus the plugins they reference, with `presets/oxide/` (config files) copied over. Bundle copies have misspelled disconnect hooks renamed to `OnPlayerDisconnected`, and `patches/<file>.diff` applied (our ports, made against the LF source).

Nothing from the game or the plugins is run. The game DLLs are compile references only. `opjpatch/` edits field visibility in a copy of `Assembly-CSharp.dll`, as Oxide's patcher does. `inspect/` reads each compiled plugin with Mono.Cecil, without loading it.

| File | Step |
|---|---|
| `run.sh` | Fetch pinned commits, stage references, build Oxide, run the steps below |
| `hooks.py` | Hook names our Oxide calls (`RustLegacy.opj` + Oxide source) |
| `corpus.py` | Find `RustLegacyPlugin` and universal plugins, merge identical files |
| `compile.py` | Compile each plugin with Oxide's references and `#define RUSTLEGACY`, then inspect it |
| `classify.py` | Status per file: sandbox, load rules, hooks that never fire, failure reason |
| `report.py` | Best copy per plugin, CSV/Markdown, bundles, shortlist |
| `shortlist.txt` | The plugins we'd run, by category, with a reason each |
| `patches/`, `presets/` | Our ports of plugins (Casper) and preset configs (SetHome 4 homes, AntiCheat report-only, EasyChat colours) |
| `check_bundle.py` | Compile a bundle together, then the sandbox and hook checks per plugin |
