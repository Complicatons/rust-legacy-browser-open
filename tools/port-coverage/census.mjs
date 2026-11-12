// Mechanical half of the port-coverage ledger: every decompiled client type, whether shipped data reaches it,
// and where the port cites it. Judgments (status, one-liners) live in tools/port-coverage/judgments/*.json.
//
// Usage (analysis/ is private and git-ignored; worktrees find the main checkout's copy):
//   node tools/port-coverage/census.mjs digest <out.txt>   -- readable per-type digest for review
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enumerateTypes } from './enumerate-types.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function analysisDir() {
  for (const c of [process.env.RL_ANALYSIS, path.join(REPO, 'analysis'), path.resolve(REPO, '../../../analysis')])
    if (c && fs.existsSync(path.join(c, 'decompiled/client'))) return c;
  throw new Error('analysis/decompiled/client not found (set RL_ANALYSIS)');
}

const PORT_GLOBS = [['browser', /\.mjs$/], ['bridge', /\.mjs$/], ['bridge/ulink', /\.mjs$/], ['tools', /^export_.*\.py$|^recover_.*\.py$|^unity_.*\.py$/]];
function portFiles() {
  const out = [];
  for (const [dir, re] of PORT_GLOBS) {
    const d = path.join(REPO, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (re.test(f) && fs.statSync(path.join(d, f)).isFile()) out.push(`${dir}/${f}`);
  }
  return out;
}

// Name of the function/method enclosing line i (nearest preceding declaration), for file:function pointers.
function enclosing(lines, i) {
  for (let k = i; k >= 0 && k > i - 400; k--) {
    const m = lines[k].match(/^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/) ||
      lines[k].match(/^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/) ||
      lines[k].match(/^def\s+(\w+)/) ||
      lines[k].match(/^\s{2}(?:static\s+|async\s+|get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/);
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[1])) return m[1];
  }
  return null;
}

export function census() {
  const A = analysisDir();
  const types = enumerateTypes(path.join(A, 'decompiled/client'));
  const usage = JSON.parse(fs.readFileSync(path.join(A, 'port-coverage/script-usage.json'), 'utf8'));
  const asmOf = t => t.assembly + '.dll';
  // id: assembly/file (unique); generic twins in one file get #n
  const seen = {};
  for (const t of types) { const k = `${t.assembly}:${t.namespace}.${t.name}`; seen[k] = (seen[k] || 0) + 1; t.id = seen[k] > 1 ? `${k}#${seen[k]}` : k; }
  // shipped-data instances; a prefab-bundle instance is live only when its prefab is reachable (probe_prefab_usage.py)
  const prefabs = JSON.parse(fs.readFileSync(path.join(A, 'port-coverage/prefab-usage.json'), 'utf8')).prefabs;
  const livePrefab = new Set(prefabs.filter(p => p.reached).map(p => p.name));
  for (const t of types) {
    const u = usage.uses[`${asmOf(t)}|${t.namespace}|${t.name}`];
    t.shipped = u ? { instances: u.instances, enabled: u.enabled, files: Object.keys(u.files), roots: Object.keys(u.roots || {}),
      live: Object.keys(u.files).some(f => !f.startsWith('gameobject')) || Object.keys(u.roots || {}).some(r => r.startsWith('<asset>') || livePrefab.has(r)) } : null;
    t.monoScript = usage.monoScripts.includes(`${asmOf(t)}|${t.namespace}|${t.name}`);
  }
  // identifier reference graph (by simple name; over-approximates, which only widens "used")
  const byName = new Map();
  for (const t of types) { if (!byName.has(t.name)) byName.set(t.name, []); byName.get(t.name).push(t); }
  for (const t of types) {
    const ids = new Set(t.text.replace(/"(?:[^"\\]|\\.)*"/g, '').match(/[A-Za-z_]\w*/g) || []);
    t.refs = [...ids].filter(n => n !== t.name && byName.has(n));
  }
  // roots: shipped scripts, console systems (reached by reflection on convar/command lines),
  // RPC/NGC receivers live inside shipped scripts already.
  const isConsole = t => t.bases.includes('ConsoleSystem');
  const used = new Map();
  const queue = [];
  const mark = (t, why) => { if (!used.has(t.id)) { used.set(t.id, why); queue.push(t); } };
  for (const t of types) if (t.shipped?.live) mark(t, 'shipped data');
  for (const t of types) if (isConsole(t)) mark(t, 'console system (reflection)');
  while (queue.length) {
    const t = queue.shift();
    for (const n of t.refs) for (const r of byName.get(n)) mark(r, `referenced by ${t.name}`);
    // base types of a used type are used
    for (const b of t.bases) for (const r of byName.get(b) || []) mark(r, `base of ${t.name}`);
  }
  for (const t of types) t.reach = used.get(t.id) || null;
  // port citations
  const pf = portFiles();
  const texts = pf.map(f => [f, fs.readFileSync(path.join(REPO, f), 'utf8').split(/\r?\n/)]);
  for (const t of types) {
    const re = new RegExp(`(?<![\\w$])${t.name}(?![\\w$])`);
    t.hits = [];
    if (t.name.length < 4) continue;
    for (const [f, lines] of texts) {
      const i = lines.findIndex(l => re.test(l));
      if (i >= 0) t.hits.push(`${f}:${i + 1}${enclosing(lines, i) ? ' ' + enclosing(lines, i) : ''}`);
    }
  }
  // member digest
  for (const t of types) {
    const methods = [...t.text.matchAll(/^\t(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|new|extern|unsafe)\s+)+[\w<>\[\],. ]+?\s+([A-Za-z_]\w*)\s*\(/gm)].map(m => m[1]);
    const fields = [...t.text.matchAll(/^\t(?:(?:public|private|protected|internal|static|readonly|const)\s+)+[\w<>\[\],. ]+?\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;/gm)].map(m => m[1]);
    t.methods = [...new Set(methods)];
    t.fields = fields;
  }
  return types;
}

if (process.argv[1] && process.argv[1].endsWith('census.mjs') && process.argv[2] === 'digest') {
  const types = census();
  const lines = types.map(t => !t.reach ? `- ${t.id} [${t.kind}${t.bases.length ? ':' + t.bases.join(',') : ''}] ${t.lines}L m:${t.methods.slice(0, 6).join(',') || t.fields.slice(0, 6).join(',')}` : [
    `## ${t.id}  [${t.kind}${t.bases.length ? ' : ' + t.bases.join(',') : ''}] ${t.lines}L ${t.file}`,
    `   use: ${t.shipped ? `${t.shipped.live ? 'SHIPPED' : 'DEAD-PREFAB-ONLY'} ${t.shipped.instances}/${t.shipped.enabled} ${t.shipped.files.join(',')} roots:${t.shipped.roots.slice(0, 5).join(',')}` : ''}${t.reach && !t.shipped?.live ? ' reach: ' + t.reach : ''}${!t.reach ? ' UNREACHED' : ''}${t.nested.length ? '  nested: ' + t.nested.slice(0, 8).join(',') : ''}`,
    `   m: ${t.methods.slice(0, 14).join(',')}${t.fields.length ? '  f: ' + t.fields.slice(0, 10).join(',') : ''}`,
    `   port: ${t.hits.slice(0, 4).join(' | ') || '-'}`,
  ].join('\n'));
  fs.writeFileSync(process.argv[3], lines.join('\n'));
  const reached = types.filter(t => t.reach).length;
  console.log(types.length, 'types;', types.filter(t => t.shipped).length, 'shipped;', reached, 'reached;', types.filter(t => t.hits.length).length, 'cited in port');
}
