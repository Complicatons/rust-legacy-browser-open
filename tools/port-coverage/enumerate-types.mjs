// Static census of every type the decompiled client assemblies declare (ILSpy output under analysis/decompiled/client).
// Reads text only. enumerateTypes(clientDir) -> [{assembly, file, namespace, name, kind, bases, nested, lines, text}].
import fs from 'node:fs';
import path from 'node:path';

const DECL = /^(\t*)((?:public|internal|private|protected|sealed|abstract|static|partial|unsafe|readonly|new|ref)\s+)*(class|struct|enum|interface|delegate)\s+(?:[\w.<>\[\], ]+?\s+)??([A-Za-z_]\w*)(<[^>{(]*>)?\s*(?:\(|:|$|where|\{)/;
const slash = p => p.split(path.sep).join('/');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'Properties') walk(p, out); } else if (e.name.endsWith('.cs')) out.push(p);
  }
  return out;
}

export function enumerateTypes(clientDir) {
  const types = [];
  for (const assembly of fs.readdirSync(clientDir)) {
    const root = path.join(clientDir, assembly);
    if (!fs.statSync(root).isDirectory()) continue;
    for (const file of walk(root)) {
      const text = fs.readFileSync(file, 'utf8');
      const lines = text.split(/\r?\n/);
      const nsm = text.match(/^namespace\s+([\w.]+)\s*(;?)/m);
      const ns = nsm ? nsm[1] : '';
      // ILSpy writes file-scoped namespaces (`namespace X;`), whose types sit at column 0
      const top = nsm && !nsm[2] ? 1 : 0;
      const rel = slash(path.relative(clientDir, file));
      const own = [];
      let cur = null;
      for (let i = 0; i < lines.length; i++) {
        const m = DECL.exec(lines[i]);
        if (!m) continue;
        let name = m[4];
        const kind = m[3];
        // delegates: the declared name is the identifier right before the parameter list
        if (kind === 'delegate') name = (lines[i].match(/([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/) || [])[1] || name;
        const depth = m[1].length;
        const bases = (lines[i].match(/:\s*([^{]+?)\s*(?:where|$)/) || [])[1];
        if (depth === top) {
          cur = { assembly, file: rel, namespace: ns, name, kind,
            bases: bases && kind !== 'enum' && kind !== 'delegate' ? bases.split(',').map(s => s.trim().replace(/<.*$/, '').split('.').pop()) : [],
            nested: [], startLine: i, lines: 0, text: '' };
          types.push(cur); own.push(cur);
        } else if (cur && depth > top) cur.nested.push(name);
      }
      own.forEach((t, k) => {
        const end = k + 1 < own.length ? own[k + 1].startLine : lines.length;
        t.text = lines.slice(t.startLine, end).join('\n');
        t.lines = end - t.startLine;
      });
    }
  }
  return types;
}

if (process.argv[1] && process.argv[1].endsWith('enumerate-types.mjs')) {
  const t = enumerateTypes(process.argv[2]);
  const by = {}, kinds = {};
  for (const x of t) { by[x.assembly] = (by[x.assembly] || 0) + 1; kinds[x.kind] = (kinds[x.kind] || 0) + 1; }
  console.log(t.length, by, kinds, 'nested', t.reduce((a, x) => a + x.nested.length, 0));
}
