"""Builds the Rust Legacy RPC catalogue from the ILSpy output under analysis/decompiled/ (static text only).

For every [RPC] method: declaring side (client/server build), assembly, owning type (ILSpy writes one file per
top-level type), name, parameter types (uLink.NetworkMessageInfo is implicit and excluded from the wire list) and
whether the body is empty. Each build keeps empty bodies for RPCs it never receives, so the build with the
non-empty body is the receiver: server → client-to-server RPC, client → server-to-client RPC. For every literal RPC name used in a
call (NetCull.RPC / networkView.RPC / *.RPC(...)), the calling side, file and the RPCMode or target text.
Usage: python -I tools/rpc-catalogue.py <analysis/decompiled> <output.json> [bridge/ulink/rpc-schema.json]
"""
import json, re, sys
from collections import defaultdict
from pathlib import Path

root, out = Path(sys.argv[1]), Path(sys.argv[2])
decl = re.compile(r'\[RPC\][^\n]*\n\s*(?:\[[^\]]*\]\s*)*(?:(?:public|private|protected|internal|static|virtual|override|new)\s+)*[\w.<>\[\]]+\s+(\w+)\s*\(([^)]*)\)')
call = re.compile(r'\bRPC(?:<[^>]*>)?\(\s*(?:[\w.]+\s*,\s*)?"(\w+)"\s*,\s*([^,)]+)')
rpcs, calls = defaultdict(list), defaultdict(list)
for side in ('client', 'server'):
    for asm in sorted(p for p in (root / side).iterdir() if p.is_dir()):
        for f in sorted(asm.rglob('*.cs')):
            text = f.read_text(encoding='utf-8', errors='replace')
            if '[RPC]' in text:
                for m in decl.finditer(text):
                    open_at = text.index('{', m.end())
                    depth, i = 0, open_at
                    while True:
                        depth += {'{': 1, '}': -1}.get(text[i], 0)
                        if depth == 0: break
                        i += 1
                    empty = not text[open_at + 1:i].strip()
                    params = [p.strip() for p in m.group(2).split(',') if p.strip()]
                    wire = [re.sub(r'\s+\w+$', '', p) for p in params if 'NetworkMessageInfo' not in p]
                    rpcs[m.group(1)].append({'side': side, 'assembly': asm.name, 'class': f.stem, 'params': wire, 'empty': empty, 'file': str(f.relative_to(root))})
            for m in call.finditer(text):
                calls[m.group(1)].append({'side': side, 'file': str(f.relative_to(root)), 'mode': m.group(2).strip()[:60]})
catalogue = []
for name in sorted(set(rpcs) | set(calls)):
    entries = []
    for cls in sorted({d['class'] for d in rpcs.get(name, [])}):
        decls = [d for d in rpcs[name] if d['class'] == cls]
        receivers = sorted({d['side'] for d in decls if not d['empty']})
        direction = {('server',): 'to-server', ('client',): 'to-client', ('client', 'server'): 'both'}.get(tuple(receivers), 'unknown')
        entries.append({'class': cls, 'params': decls[0]['params'], 'direction': direction, 'files': sorted({d['file'] for d in decls})})
    catalogue.append({'name': name, 'handlers': entries, 'calls': calls.get(name, [])[:12], 'callCount': len(calls.get(name, []))})
out.write_text(json.dumps({'generatedFrom': 'analysis/decompiled (ILSpy, static)', 'rpcs': catalogue}, indent=1), encoding='utf-8')
from collections import Counter
print(len(catalogue), 'RPC names;', sum(len(c['handlers']) for c in catalogue), 'handlers;', dict(Counter(h['direction'] for c in catalogue for h in c['handlers'])))

# Compact schema for the gateway (committed): name → handlers with owning type, wire parameter types and direction.
if len(sys.argv) > 3:
    schema = {c['name']: [{'class': h['class'], 'params': h['params'], 'direction': h['direction']} for h in c['handlers']] for c in catalogue if c['handlers']}
    Path(sys.argv[3]).write_text(json.dumps(schema, indent=0, sort_keys=True), encoding='utf-8')
    print('schema:', len(schema), 'RPC names ->', sys.argv[3])
