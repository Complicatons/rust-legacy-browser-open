# Oxide plugins on our servers: plan

Owner direction (2026-10-24): operators add Oxide plugins to a server from the host app. Our site lists every plugin and the wiki explains each one. Oxide itself is built by us from source, not downloaded.

Owner decisions:
- **Oxide install:** built by us from the archived 2018 sources and pinned. We don't ship anyone's prebuilt Oxide zip.
- **Plugin files:** none of the plugin repos has a licence, so we don't host third-party plugin code. The site and catalogue link each plugin at a pinned commit, with its SHA-256. We host only what we wrote: patches, hook fixes and preset configs. The host app downloads the original file and applies our patch.
- **Wiki:** every plugin that loads (228 files in the full bundle, including the ported Casper and 5 renamed ones). The owner's test set (38) gets hand-written detail.
- **Host app Plugins section:** install from our catalogue, list/enable/disable/remove, edit configs and reload, and upload your own `.cs` (compile-checked before it goes live).

Findings and the compile check: OXIDE-PLUGINS.md and tools/oxide-plugin-check/.

## Parts

### 1. Oxide for Rust Legacy, built here (`tools/oxide-build/`)

A server needs four things to run plugins:
1. Oxide's patched `Assembly-CSharp.dll` and `uLink.dll`.
2. The Oxide DLLs.
3. Their dependencies.
4. A plugin compiler process.

| Piece | Source | Notes |
|---|---|---|
| Patcher CLI | OxidePatcher at `c055a59` (2018-01-06): `Hooks/Simple.cs`, `Modify.cs`, `InitOxide.cs`, `Fields`, `Modifiers` on Mono.Cecil | Command-line only (no WinForms). Applies `Oxide.RustLegacy/resources/RustLegacy.opj` to the stock `Assembly-CSharp.dll` (SHA-256 `CE0DD832…`, the vanilla patcher's allowlist) and to `uLink.dll`. `check / patch / verify / restore` with a backup, like `tools/vanilla-patcher`. Verified by decompiling the patched copy. |
| Oxide DLLs | Oxide.Core `601a58d`, CSharp `7b0d01c`, Unity, MySql, SQLite, RustLegacy `eff84ea` | Already built by `tools/oxide-plugin-check/run.sh`; moved into a shared build step. |
| Our fix to Oxide.RustLegacy | `IOnUserApprove` | Oxide kicks any live session with the same user ID before plugins run, which races our adapter (EXISTING-SERVER-INTEGRATION-PLAN "Oxide server"). Our build skips that kick for logins carrying an `RLBA`/`RLBD` envelope and leaves the decision to the adapter plugin. |
| Plugin compiler | Ours, speaking the 2018 `Oxide.CSharp` protocol (`PluginCompiler.cs` + `ObjectStream`) | Oxide's 2017 `CSharpCompiler` is a prebuilt `basic.exe` bundled with mkbundle, not source. Ours is a .NET Framework 4.x console app (Windows servers have 4.8). It compiles with Mono's `mcs` as a library, as Oxide did, so plugins behave as they did on Legacy servers. It is tested under Mono here. |
| Bundle | `oxide-rustlegacy-<version>.zip` + `manifest.json` (file → SHA-256) | Third-party dependency binaries (Newtonsoft.Json, protobuf-net, websocket-sharp, Mono.Cecil, MySql.Data, System.Data.SQLite + sqlite3) come from the Oxide repos at the pinned commits or NuGet, hash-pinned. |

On an Oxide server our adapter is the Oxide plugin (`adapter/RustLegacyBrowser.cs`), not the vanilla patch; the two never run together.

### 2. Catalogue and site (`tools/oxide-plugin-check/` → `site/`)

`report.py` also writes **`catalogue.json`**, the contract between the site, the wiki and the host app:

```json
{
  "version": 1,
  "generatedAt": "2026-10-24T00:00:00Z",
  "oxide": {"build": "2018.03-rlb1"},
  "plugins": [{
    "name": "SetHome",                      // class name = file stem Oxide loads
    "file": "SetHome.cs",                   // file name to install as
    "title": "SetHome", "author": "Reneb", "version": "1.0.0",
    "type": "rust-legacy",                  // or "universal"
    "status": "works",                      // works | loads-with-warnings (only these two are listed)
    "testSet": true, "category": "Gameplay", "why": "…",   // from shortlist.txt
    "description": "…",
    "source": {"repo": "Calytic/oxideplugins", "commit": "9da63df…", "path": "rust legacy/SetHome.cs",
               "url": "https://raw.githubusercontent.com/Calytic/oxideplugins/9da63df…/rust%20legacy/SetHome.cs",
               "page": "https://github.com/Calytic/oxideplugins/blob/9da63df…/rust%20legacy/SetHome.cs",
               "sha256": "…"},                // of the downloaded bytes
    "patch": "patches/SetHome.cs.diff",       // ours, or null; applied to the LF-normalised source
    "requires": ["Share"],                   // [PluginReference]s present in the catalogue
    "presets": {"config/SetHome.json": "presets/oxide/config/SetHome.json"},
    "commands": [{"chat": "home", "admin": false}], "consoleCommands": ["…"],
    "permissions": ["…"],
    "config": [{"key": "Sethome: Max Allowed Homes", "default": 3, "type": "int"}],
    "issues": ["…"], "browserPlayers": "…",
    "wiki": "/wiki/plugins/sethome"
  }]
}
```

- Every change to a plugin is a unified diff in `patches/`: ports (Casper) and the disconnect-hook fixes, which are generated, not hand-written. The host app and operators apply the same file.
- The site serves `/plugins/catalogue.json`, `/plugins/patches/*` and `/plugins/presets/*` from `site/generated/plugins/`, plus a `/plugins` page. The page lists every plugin with filters (test set, category, type, status) and has, for each one, a link to its wiki page, its source and our patch or presets.
- Commands, permissions and config keys are extracted from the source statically: `[ChatCommand]`, `cmd.AddChatCommand`, `[Command]`, `permission.RegisterPermission`, `CheckCfg` / `GetConfig` / `Config[...]` with their defaults. Descriptions and how-tos come from the plugin's `.md` page in the oxidemod mirror where one exists.

### 3. Wiki "Server plugins" section

- Generated `site/generated/wiki/plugins.json` from the catalogue becomes a new `plugins` entry in `SECTIONS` (`site/js/wiki-view.mjs`).
- Each plugin page shows: what it does; commands (chat, console, admin-only); permissions; config keys with defaults and our preset value; dependencies; issues (hooks that never fire, browser-player notes); source and our patch.
- The test set has hand-written "How it works" and "Configuring it" text in `site/content/plugins/<file stem>.md`, merged into the page.

### 4. Host app Plugins view (`host/plugins.mjs`, dashboard view "Plugins")

- **Oxide:** shows whether Oxide is installed, its build and whether the patched DLLs verify. Installing Oxide runs the setup step (part 1) with the server stopped: back up, patch, copy the bundle, switch the adapter from the vanilla patch to the Oxide plugin. Uninstalling restores.
- **Catalogue:** reads `catalogue.json` from the website (cached; the kit carries a copy). Installing a plugin also installs its `requires`. The host app downloads `source.url`, checks `sha256`, applies `patch`, writes `oxide/plugins/<file>` and copies `presets` only if the config doesn't exist yet. Every step is shown and logged.
- **Installed:** each `oxide/plugins/*.cs` with its catalogue match (or "custom") and its state from the Oxide log: loaded, failed to compile (with the error), or unloaded. Disable moves the file to `oxide/plugins/disabled/` (Oxide loads only the top level); enable moves it back; remove deletes it after a confirm (configs and data are kept).
- **Config editor:** `oxide/config/<Name>.json`, checked as JSON before saving (bad JSON is refused). Saving reloads the plugin with `oxide.reload <Name>` sent to the server console (supervisor stdin), and the result comes from the log.
- **Upload:** a `.cs` file is compile-checked with our compiler against the server's own Managed folder first. It is refused if it doesn't compile, if the class name doesn't match the file name, or if Oxide's sandbox would block it (the same rules as `tools/oxide-plugin-check`). Upload needs the owner role.
- Dashboard roles: owner and admin manage plugins; moderators can only see the list.

### 5. Docs

- `site/content/docs/server-plugins.md` (group "Running a server"): installing Oxide from the host app, adding plugins from the catalogue, configuring and reloading, uploading your own, permissions (`oxide.grant`), and what browser players change (Steam and IP plugins).
- `OXIDE-PLUGINS.md` stays the engineering record.

## Order and status

Parts 1, 2/3 and 4 are built in parallel against the catalogue contract above, then merged. Docs come last.

None of it has run on a real server yet. The first run goes on the VM test server (SERVER-TESTING-PLAN): install Oxide, install the test set, check each plugin loads and works for a desktop player and a browser player.
