// Builds the class-by-class port-coverage ledger and PORT-COVERAGE.md.
//
//   node tools/port-coverage/build-ledger.mjs          write analysis/port-coverage/ledger.json, docs/port-coverage/*, PORT-COVERAGE.md
//   node tools/port-coverage/build-ledger.mjs --check  only report problems (missing/stale judgments, bad pointers); exit 1 if any
//
// Inputs: the census (census.mjs: every decompiled client type, shipped-data use, reachability, port citations),
// the probes' outputs in analysis/port-coverage/ (script-usage.json, prefab-usage.json; data-only UnityPy reads),
// the judgments in tools/port-coverage/judgments/*.txt (classes) and data.txt (prefabs, items, convars, UI, sounds, effects),
// and the recovered exports in browser/assets/recovered/ (evidence that shipped data reaches the port).
import fs from 'node:fs';
import path from 'node:path';
import { census, analysisDir, REPO } from './census.mjs';

const CHECK = process.argv.includes('--check');
const A = analysisDir();
const RECOVERED = [path.join(REPO, 'browser/assets/recovered'), path.resolve(REPO, '../../../browser/assets/recovered')].find(p => fs.existsSync(p));
const JUDGE_DIR = path.join(REPO, 'tools/port-coverage/judgments');
const problems = [];
// Open gaps by priority: 1 game-breaking, 2 big systems, 3 visible effects, 4 small polish.
const GAP_PRIORITY = { INTERP: 2, 'ORE-FX': 3, DRAGICON: 4, VMIDLE: 4 };
const STATUS = { P: 'Ported', N: 'N/A', A: 'Partial', M: 'Missing', B: 'Blocked' };

// ---------- judgments ----------
function parseJudgments(files) {
  const out = new Map();
  for (const f of files) {
    let section = null;
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (!line.trim() || line.startsWith('#')) return;
      if (line.startsWith('@')) { section = line.slice(1).trim(); return; }
      const [key, status, does, ...rest] = line.split('|');
      const detail = rest.join('|');
      if (!STATUS[status]) problems.push(`${path.basename(f)}:${i + 1} bad status "${status}"`);
      const id = `${section}:${key}`;
      if (out.has(id)) problems.push(`${path.basename(f)}:${i + 1} duplicate judgment ${id}`);
      out.set(id, { status, does, detail: detail.trim(), at: `${path.basename(f)}:${i + 1}` });
    });
  }
  return out;
}
const judgments = parseJudgments(fs.readdirSync(JUDGE_DIR).filter(f => f.endsWith('.txt')).sort().map(f => path.join(JUDGE_DIR, f)));

// A pointer is "file[:function]" items separated by ", " after an optional "with: " / "engine: " prefix.
function pointerFiles(detail) {
  const body = detail.replace(/^(with|engine):\s*/, '');
  return [...body.matchAll(/((?:browser|bridge|tools|central|host|adapter)\/[\w./-]+\.(?:mjs|json|py|cs|js)\b)(?::([\w$]+))?/g)].map(m => ({ file: m[1], fn: m[2] || null }));
}
function checkPointers(where, detail) {
  for (const { file, fn } of pointerFiles(detail)) {
    const p = path.join(REPO, file);
    if (!fs.existsSync(p)) { problems.push(`${where}: pointer ${file} does not exist`); continue; }
    if (fn && !new RegExp(`\\b${fn.replace(/\$/g, '\\$')}\\b`).test(fs.readFileSync(p, 'utf8'))) problems.push(`${where}: ${file} has no ${fn}`);
  }
}

// ---------- areas ----------
const AREAS = [
  ['Editor, debug and samples', /^(Author|Editor|Gizmo|.*Test$|.*Tester$|Test|Debug|NGUIDebug|uLink(Chat|Client|Console|Statistics|Simple|Smooth|Strict|Instantiate|Object|Observed|Override|P2P|Register|ServerAuth|EnterLicense|Internal|NetworkP2P)|Camera_FollowTarget|ThirdPerson|CharacterMotor|FPSInput|PlatformInput|MouseLook|HelloScript|IslandHello|Orbit|PivotTest|MegaTerrain|TerrainToolkit|ShaderMod|ReverseSurface|MarkerScript|RoadObjectScript|sideObjectScript|SurfaceScript|EasyRoads|FolderHelper|DummyHelper|RockDecorAreaHelper|Facepunch\.Attributes|Facepunch\.Build\.|.*Attribute$)/],
  ['Network and protocol', /^(Net|NGC|uLink|Network|RPCMode|Facepunch\.(NetworkView|NetBehaviour|NetworkUtility|ID\.|MonoBehaviour)|ID(Base|Main|Local|Remote|Relative|Flags|Kind)|IIdentifiable|CustomInstantiation|IPrefabCustom|Interp|Interpolat|.*Interpolator|IStateInterpolator|StateInterpolator|BaseStateInterpolator|TimeStamped|PosRot|Angle2|uLinkAngle2|Controllable|Controller|PlayerClient|RustPlayerClient|ServerManagement|RustServerManagement|ClientConnect|ConnectionAcceptor|DestroysOnDisconnect|Rust\.Defines|Facepunch\.Clocks|POSIX|CullGrid|CullCell|Disposal|DisposeCallback|EmptyArray|RustProto|Server|SaveStringPool|AvatarSave)/],
  ['Menus and dfGUI', /^(df|Main Menu|MainMenu|Options|ServerBrowser|ServerCategory|ServerItem|ServerList|Pagination|LoadingScreen|DeathScreen|deathscreen|ConsoleWindow|LockEntry|lockentry|PopupUI|PopupNotice|PopupInventory|ChatUI|ChatLine|GameUI|gameui|GUIHide|BrandingVersion|ConvarBinding|RunConsoleCommand|DigitEntryRestrictions|DisableOnConnectedState|GameTooltipManager|GameTip|gametip|VoiceChatIcon|BlurEffect|GameConfig|FavouriteList|Rust\.Steam|SteamClient|Facepunch\.Cursor|ChildControlEventHandler|ControlMultiTouch|DragEventHandler|FocusEventHandler|KeyPressHandler|MouseEventHandler|PropertyChangedEventHandler|TweenNotification|IDataBinding|IObservableValue|IDFMultiRender|IInputAdapter|AnchorStyleExtensions|Triangles$)/],
  ['RPOS and NGUI (inventory UI)', /^(RPOS|UI|NGUI|BM(Font|Glyph|Symbol)|Tween(Color|Position|Rotation|Scale|Transform|Volume)|ActiveAnimation|AnimationOrTween|IgnoreTimeScale|Spring(Panel|Position)|GUIHeldItem|ItemToolTip|DropNotification|DragEventKind|ByteReader|Localization|LanguageSelection|TextureMaterial)/],
  ['Items, combat and crafting', /(DataBlock|Datablock|Item$|ItemRep|ItemMod|^I[A-Z]\w*Item$|Weapon|Bullet|Bow|Arrow|Melee|Grenade|Throwable|Torch|Flare|Blueprint|Crafting|Ingredient|Inventory|Loadout|Loot|Tracer|MuzzleFlash|Recoil|HitBox|HitShape|BodyPart|Physics2|Intersect|Ray[23]D|Line[23]D|RaycastHit2|Damage|TakeDamage|Repair|Research|Lockpick|Magazine|Gunpowder|Ammo|Consumable|BloodDraw|HealthKit|Bandage|Strike|Shotgun|ViewModel|VM|Socket|ModViewModel|Laser|Quads|WeightSelection|ResourceGive|Pickup|EquipmentWearer|Armor|Actor|BoneStructure|DeathTransfer|Ragdoll|QueuedShot|Explosive|Explosion|Hand|Combine|Quick)/],
  ['Building and deployables', /(Structure|Deploy|Hardpoint|TransCarrier|Carriable|Spike|Door|Lock|Bed|Sleeping|Campfire|Furnace|FireBarrel|Fit|Placement|NoPlacement|MeshBatch|Gizmo|Bounce|Prefab Renderer|PrefabRenderer|Decay|WorkZone|WorkBench|HeatZone|Activat|Context|Useable|IUse|Use[A-Z]|HealthDimmer|HealthTextureDimmer|SaveableInventory|WoodBlocker|KillZone|Supply|Airdrop|airdrop|SignalGrenade|RigidObj|ICarriable|IDeployed|IServerSave)/],
  ['Player, camera and movement', /(Character|Human|Player|Motor|CC[A-Z]|Crouch|HeadBob|Bob|LazyCam|Camera|Mount|Metabolism|Radiation|FallDamage|falldamage|Vitals|Controller|Control|Trait|Movement|Facepunch\.Movement|Sampler|Footstep|footstep|ApplyCrouch|Precision|Facepunch\.Geometry|Solve|DebugInput|GameInput|input$|KindOfCamera|TransitionFunction|AdaptiveNearPlane|MatrixHelper|PerspectiveMatrix|LocalDamage|LocalRadiation|ClientVitals|HUD|ContextProbe)/],
  ['Wildlife and AI', /(AI$|AI[A-Z]|Wildlife|NavMesh|NavAgent|Vis[A-Z]|^Vis$|ODB|HSet|RecycleList|Facepunch\.Procedural|ResourceTarget|ResourceObject|GenericSpawner|Spawn)/],
  ['World, sky, water and terrain', /(TOD_|Sky|Water|Terrain|Tree|Grass|FPGrass|SlowSpawn|ThrottledTask|Rock|SurfaceInfo|Surface|Environment|env$|LightSty|EnvDecay|PathSlop|SceneChild|CustomMesh|Planar|Specular|Displace|Gerstner|MeshContainer|Wind|water|grass|terrain)/],
  ['Audio and voice', /(Audio|Sound|Music|USpeak|Voice|voice|Speaker|BandMode|SendBehavior|ThreeDMode|SpeakerMode|Geiger|Doppler|EffectSoundPlayer|MoPhoGames)/],
  ['Rendering and post effects', /(Effect|Bloom|Tonemap|Noise|Grain|Antialias|AAMode|SSAO|Blur|Fullscreen|OpaqueCapture|ImageEffect|PostEffects|Sun ?Shafts|Shafts|LaserFilter|ClearFirstFrame|CameraEvent|CameraLayer|CameraFX|CameraSettings|GameEvent|BoundHack|render$|gfx$|Lens|DepthOfField|Dof|Vignet|Crease|Fisheye|GlobalFog|Contrast|ColorCorrection|Edge|Tilt|Twirl|Vortex|Sepia|Grayscale|Glow|Motion|AmbientObscurance|ScreenOverlay|TweakMode|Bokeh|HDR|Quality|AABBox|BBox)/],
  ['Console and config', /^(ConsoleSystem|ConsoleNetworker|ConVar|config|global|net|chat|censor|actor|conditionloss|dmg|inv|objects|player|server|teleport|interp|sound|gizmos|gui|notice|serverfavourite|gunshots|airdrop|Facepunch\.Utility\.(String|CommandLine)|Facepunch\.Util|Rust\.(Notice|Globals)|RustLevel|ClientInit|HudEnabled)$/],
];
function areaOf(t) {
  const name = (t.namespace ? t.namespace + '.' : '') + t.name;
  for (const [area, re] of AREAS) if (re.test(name) || re.test(t.name)) return area;
  if (/^Facepunch\.(Load|Hash|Collections|Progress|Traits|Abstract)|^JSON|^Facepunch\.Bundling|^Resources$|^TypeUtility|^Temp|^Locked|^Counted|^Grab|^Multi|^Dictionary|^Reference|^Reflection|^StringEx|^Vector|^Rect|^Assert|^CRC|^Seeded|^Time|^Enumerable|^Event|^Cache|^FindChild|^Transform|^FLOAT|^Matrix|^JPG|^Update|^Find|^Facepunch\.Utility|^IJSON|^Rust|^Lib|^EndAll|^Device|^Destroy|^Level|^Cluster|^Blank|^RCon|^Bake|^Drop|^Env|^Generic|^Mega|^Model|^Wild|^Zombie|^Security|^Surveil|^Engine|^Near|^Perspective|^Text|^Geometry|^Csv|^Managed|^Shader/.test(name)) return 'Engine and utility code';
  return 'Other game code';
}

// ---------- classes ----------
const types = census();
const used = new Set();
const classes = [];
const seen = new Set();
for (const t of types) {
  const key = `${t.assembly}:${t.id.slice(t.assembly.length + 1).replace(/^\./, '')}`;
  seen.add(key);
  const j = judgments.get(key);
  const entry = {
    id: t.id, assembly: t.assembly, namespace: t.namespace, name: t.name, kind: t.kind, file: t.file, lines: t.lines,
    area: areaOf(t),
    used: Boolean(t.reach),
    usedBy: t.shipped?.live ? `shipped data: ${t.shipped.instances} instance(s) in ${t.shipped.files.join(', ')}` : t.reach || (t.shipped ? `only on never-spawned prefabs (${t.shipped.roots.slice(0, 3).join(', ')})` : null),
    does: j?.does ?? null,
    status: j ? STATUS[j.status] : 'Unjudged',
    port: j && (j.status === 'P' || j.status === 'A') ? j.detail : null,
    reason: j && j.status !== 'P' ? (j.detail || (!t.reach ? 'Not referenced by shipped content or by code reachable from it' : '')) : null,
    citedIn: t.hits.slice(0, 4),
  };
  if (!j) problems.push(`no judgment for ${key}`);
  else {
    if (j.status === 'N' && !j.detail && t.reach) problems.push(`${j.at}: ${key} is reached (${t.reach}) but its N/A has no reason`);
    if (j.status === 'P' && !pointerFiles(j.detail).length) problems.push(`${j.at}: ${key} is Ported without a port file`);
    checkPointers(j.at, j.detail);
  }
  classes.push(entry);
}
for (const [key, j] of judgments) if (!seen.has(key) && /^(Assembly|Facepunch)/.test(key)) problems.push(`${j.at}: judgment for unknown type ${key}`);

// ---------- shipped data ----------
const usage = JSON.parse(fs.readFileSync(path.join(A, 'port-coverage/script-usage.json'), 'utf8'));
const prefabUsage = JSON.parse(fs.readFileSync(path.join(A, 'port-coverage/prefab-usage.json'), 'utf8'));
const data = parseJudgments([path.join(REPO, 'tools/port-coverage/data.txt')]);
function readJsonStrings(dir) {
  const strings = new Set(), files = new Set();
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { files.add(e.name.replace(/\.[^.]+$/, '')); if (e.name.endsWith('.json') && fs.statSync(p).size < 64e6) { const text = fs.readFileSync(p, 'utf8'); for (const m of text.matchAll(/"((?:[^"\\]|\\.){1,200})"/g)) strings.add(m[1].toLowerCase()); } } } };
  if (dir) walk(dir);
  return { strings, files };
}
const recovered = readJsonStrings(RECOVERED);
const codeText = ['browser', 'tools', 'bridge'].flatMap(d => fs.readdirSync(path.join(REPO, d)).filter(f => /\.(mjs|py)$/.test(f)).map(f => fs.readFileSync(path.join(REPO, d, f), 'utf8'))).join('\n').toLowerCase();

function judgeData(kind, key, auto) {
  const j = data.get(`${kind}:${key}`);
  if (j) { checkPointers(j.at, j.detail); return { status: STATUS[j.status], does: j.does, port: j.status === 'P' || j.status === 'A' ? j.detail : null, reason: j.status !== 'P' ? j.detail : null, evidence: auto?.evidence ?? null }; }
  if (auto?.status) return auto;
  problems.push(`no data judgment for ${kind}:${key}`);
  return { status: 'Unjudged', does: auto?.does ?? null, port: null, reason: null };
}

// prefabs: every root in the client prefab bundles
const prefabs = prefabUsage.prefabs.map(p => {
  const key = p.paths[0] || p.name;
  const names = [p.name.toLowerCase(), ...p.paths, ...p.paths.map(x => x.split('/').pop()), p.ngc ? p.ngc.toLowerCase() : null].filter(Boolean);
  const ident = `${p.file}:${p.pathID}`;
  const hit = names.find(n => recovered.strings.has(n)) || (recovered.strings.has(ident) || recovered.strings.has('obj:' + ident) ? ident : null);
  let auto;
  if (!p.reached) auto = { status: 'N/A', reason: Object.keys(p.scripts).length ? 'Never instantiated: an editor/scene source copy or a test/sample prefab (no scene, data, NGC registry or C# reference reaches it)' : 'Model or animation import root; its meshes/clips are used through other prefabs, the root object itself is never instantiated' };
  else if (hit) auto = { status: 'Ported', port: 'browser/assets/recovered (exported)', evidence: `exported: "${hit}"` };
  return { name: p.name, path: key, reachedBy: p.reached, scripts: Object.keys(p.scripts), ...judgeData('prefab', key, auto) };
});

// items: every ItemDataBlock-family asset
const itemFamily = new Set();
const byName = new Map(types.map(t => [t.name, t]));
for (const t of types) { let c = t, guard = 0; while (c && guard++ < 12) { if (c.name === 'ItemDataBlock') { itemFamily.add(t.name); break; } c = byName.get(c.bases[0]); } }
const itemsManifest = (() => { try { return JSON.parse(fs.readFileSync(path.join(RECOVERED, 'items/manifest.json'), 'utf8')).items; } catch { return {}; } })();
const exportedItemIds = new Set(Object.keys(itemsManifest).map(k => k.split(':').pop()));
const items = usage.assets.filter(a => itemFamily.has(a.class)).map(a => {
  const hit = exportedItemIds.has(String(a.pathID));
  return { name: a.name, class: a.class, ...judgeData('item', a.name, hit ? { status: 'Ported', port: 'tools/export_items.py -> items/manifest.json', evidence: `exported ${a.class}` } : null) };
});

// convars: every line of the shipped client.cfg
const cfg = fs.readFileSync(path.join(A, 'client-audit/cfg/client.cfg'), 'utf8').split(/\r?\n/).filter(Boolean);
const convars = cfg.map(line => {
  const [name, ...args] = line.split(' ');
  const key = name === 'input.bind' ? `${name} ${args[0]}` : name;
  return { line, ...judgeData('convar', key, null) };
});

// sounds: every AudioClip the reachable data references
const sounds = prefabUsage.audioClips.filter(c => c.usedBy.length).map(c => {
  const exported = recovered.files.has('sound-' + c.token) || recovered.strings.has(c.name.toLowerCase());
  return { name: c.name, usedBy: c.usedBy, ...judgeData('sound', c.name, exported ? { status: 'Ported', port: 'browser/assets/recovered (exported clip)', evidence: 'sound-' + c.token } : null) };
});

// UI windows and effects are listed in data.txt directly
const listed = kind => [...data].filter(([k]) => k.startsWith(kind + ':')).map(([k, j]) => { checkPointers(j.at, j.detail); return { name: k.slice(kind.length + 1), status: STATUS[j.status], does: j.does, port: j.status === 'P' || j.status === 'A' ? j.detail : null, reason: j.status !== 'P' ? j.detail : null }; });
const windows = listed('ui');
const effectPrefabs = prefabs.filter(p => p.reachedBy && /(\/effect|effects\/|particles|_death|debris|impact|flash|smoke|explosion|fire|light|decal)/i.test(p.path + ' ' + p.name));
const effects = effectPrefabs.map(p => ({ name: p.name, path: p.path, status: p.status, port: p.port, reason: p.reason, does: p.does }));

// ---------- summaries ----------
const count = (list, pred = () => true) => { const c = { total: 0 }; for (const e of list.filter(pred)) { c.total++; c[e.status] = (c[e.status] || 0) + 1; } return c; };
const done = c => (c.Ported || 0) + (c['N/A'] || 0);
const pct = c => c.total ? Math.floor(1000 * done(c) / c.total) / 10 : 100;
const summary = {
  classes: count(classes), usedClasses: count(classes, c => c.used),
  prefabs: count(prefabs), reachedPrefabs: count(prefabs, p => p.reachedBy), items: count(items), convars: count(convars),
  windows: count(windows), sounds: count(sounds), effects: count(effects),
};
const open = [...classes.map(c => ({ ...c, kind: 'class', label: c.id })), ...prefabs.map(p => ({ ...p, label: 'prefab ' + p.path })), ...items.map(i => ({ ...i, label: 'item ' + i.name })),
  ...convars.map(c => ({ ...c, label: 'convar ' + c.line })), ...windows.map(w => ({ ...w, label: 'UI ' + w.name })), ...sounds.map(s => ({ ...s, label: 'sound ' + s.name }))]
  .filter(e => !['Ported', 'N/A'].includes(e.status))
  // Priority (game-breaking, then big systems, then polish): the GAP tag in the reason, ranked here.
  .map(e => ({ ...e, priority: GAP_PRIORITY[((e.reason || e.port || '').match(/GAP ([A-Z-]+)/) || [])[1]] ?? 9 }))
  .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));

if (problems.length) { console.error(problems.slice(0, 400).join('\n')); console.error(`${problems.length} problem(s)`); }
if (CHECK) process.exit(problems.length ? 1 : 0);

const ledger = { generated: new Date().toISOString().slice(0, 10), method: 'tools/port-coverage/README.md', summary, classes, prefabs, items, convars, windows, sounds, effects, open: open.map(o => ({ label: o.label, status: o.status, port: o.port, reason: o.reason })) };
fs.mkdirSync(path.join(A, 'port-coverage'), { recursive: true });
fs.writeFileSync(path.join(A, 'port-coverage/ledger.json'), JSON.stringify(ledger, null, 1));
fs.mkdirSync(path.join(REPO, 'docs/port-coverage'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'docs/port-coverage/ledger.json'), JSON.stringify(ledger, null, 1));

// ---------- markdown ----------
const esc = s => String(s ?? '').replace(/\|/g, '\\|');
const row = (...cells) => `| ${cells.map(esc).join(' | ')} |`;
const statusCells = c => [c.Ported || 0, c['N/A'] || 0, c.Partial || 0, c.Missing || 0, c.Blocked || 0, c.Unjudged || 0];
const areaNames = [...new Set(classes.map(c => c.area))].sort();
const areaTable = areaNames.map(a => { const c = count(classes, x => x.area === a); const u = count(classes, x => x.area === a && x.used); return row(a, c.total, u.total, ...statusCells(c), pct(c) + ' %'); });
const big = (n, label) => `**${n}** ${label}`;
const md = [
  '# Port coverage',
  '',
  'Every type in the original client\'s decompiled code and every piece of shipped data the port must consume, each with a status. Generated by `node tools/port-coverage/build-ledger.mjs` from the judgments in `tools/port-coverage/` (method: `tools/port-coverage/README.md`). Full ledger: `docs/port-coverage/ledger.json`; per-class table: `docs/port-coverage/classes.md`.',
  '',
  `${big(pct(summary.usedClasses) + ' %', 'used classes done')} · ${big(pct(summary.classes) + ' %', 'all classes done')} · ${big(summary.classes.total, 'classes')} · ${big(summary.usedClasses.total, 'used')} · ${big(summary.classes.Ported || 0, 'ported')} · ${big(summary.classes['N/A'] || 0, 'N/A')} · ${big((summary.classes.Partial || 0) + (summary.classes.Missing || 0), 'open')} · ${big(summary.classes.Blocked || 0, 'blocked')}`,
  '',
  `${big(pct(summary.reachedPrefabs) + ' %', 'used prefabs')} · ${big(pct(summary.items) + ' %', 'items')} · ${big(pct(summary.convars) + ' %', 'client.cfg convars')} · ${big(pct(summary.windows) + ' %', 'UI windows')} · ${big(pct(summary.sounds) + ' %', 'used sounds')} · ${big(pct(summary.effects) + ' %', 'effects')}`,
  '',
  '"Done" = Ported or N/A with a reason. Partial, Missing and Blocked are open.',
  '',
  '## Classes by area',
  '',
  row('Area', 'Types', 'Used', 'Ported', 'N/A', 'Partial', 'Missing', 'Blocked', 'Unjudged', 'Done').replace(/\\/g, ''),
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...areaTable,
  row('**All**', summary.classes.total, summary.usedClasses.total, ...statusCells(summary.classes), pct(summary.classes) + ' %'),
  '',
  '## Classes by assembly',
  '',
  '| Assembly | Types | Used | Ported | N/A | Partial | Missing | Blocked | Unjudged | Done |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...[...new Set(classes.map(c => c.assembly))].map(a => { const c = count(classes, x => x.assembly === a); const u = count(classes, x => x.assembly === a && x.used); return row(a, c.total, u.total, ...statusCells(c), pct(c) + ' %'); }),
  '',
  'Assemblies the client ships but the port does not decompile: `uLink.dll` (network library; the gateway in `bridge/ulink/` implements the wire protocol), `RustProtect.dll` (anti-cheat/protection, not gameplay), `dfScriptLite.dll`, `EasyRoads3D.dll` (editor road tool), `LitJSON`, `Google.ProtocolBuffers*`, `Boo.Lang`, `UnityScript.Lang`, `Mono.*`, `System.*`, `mscorlib`, `UnityEngine.dll` (engine: replaced by three.js, Rapier, Web Audio and the DOM).',
  '',
  '## Shipped data',
  '',
  '| Data | Count | Ported | N/A | Partial | Missing | Blocked | Unjudged | Done |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  row('Prefabs (all roots in gameobject.000/001)', summary.prefabs.total, ...statusCells(summary.prefabs), pct(summary.prefabs) + ' %'),
  row('Prefabs the game can reach', summary.reachedPrefabs.total, ...statusCells(summary.reachedPrefabs), pct(summary.reachedPrefabs) + ' %'),
  row('Item datablocks', summary.items.total, ...statusCells(summary.items), pct(summary.items) + ' %'),
  row('client.cfg convars', summary.convars.total, ...statusCells(summary.convars), pct(summary.convars) + ' %'),
  row('UI windows', summary.windows.total, ...statusCells(summary.windows), pct(summary.windows) + ' %'),
  row('Sounds referenced by reachable data', summary.sounds.total, ...statusCells(summary.sounds), pct(summary.sounds) + ' %'),
  row('Effect prefabs', summary.effects.total, ...statusCells(summary.effects), pct(summary.effects) + ' %'),
  '',
  '### UI windows',
  '',
  '| Window | Status | Port / reason |',
  '|---|---|---|',
  ...windows.map(w => row(w.name, w.status, w.port || w.reason)),
  '',
  '### client.cfg',
  '',
  '| Line | Status | Port / reason |',
  '|---|---|---|',
  ...convars.map(c => row('`' + c.line + '`', c.status, c.port || c.reason)),
  '',
  '## Open items (not Ported or N/A), in priority order',
  '',
  open.length ? '| # | Item | Status | What is missing / blocked on |\n|---:|---|---|---|\n' + open.map((o, i) => row(i + 1, o.label, o.status, o.reason || o.port)).join('\n') : 'None.',
  '',
].join('\n');
fs.writeFileSync(path.join(REPO, 'PORT-COVERAGE.md'), md);

const classMd = ['# Port coverage: every client class', '', 'Generated by `tools/port-coverage/build-ledger.mjs`. Status: Ported (port file), N/A (reason), Partial/Missing (what is missing), Blocked (on what).', '',
  ...areaNames.flatMap(a => ['## ' + a, '', '| Type | Used | Status | What it does | Port / reason |', '|---|---|---|---|---|',
    ...classes.filter(c => c.area === a).map(c => row('`' + c.id + '`', c.used ? 'yes' : 'no', c.status, c.does, c.port || c.reason)), ''])].join('\n');
fs.writeFileSync(path.join(REPO, 'docs/port-coverage/classes.md'), classMd);
console.log(JSON.stringify(summary));
