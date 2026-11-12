"""Rewrites ILSpy output of an obfuscated assembly with short, globally consistent identifiers.

Static text transform only (no assembly is loaded). Each obfuscated name `_0023_003Dq...` becomes O<n>, the same
everywhere, and the mapping is written beside the output so findings can cite the original names.
Usage: python -I tools/shorten-obfuscated.py <decompiled dir> <output dir>
"""
import json, re, sys
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
pattern = re.compile(r'_0023_003Dq[A-Za-z0-9_]+')
files = sorted(src.rglob('*.cs'))
names = {}
for f in files:
    for m in pattern.findall(f.read_text(encoding='utf-8')):
        names.setdefault(m, 'O%d' % len(names))
for f in files:
    text = pattern.sub(lambda m: names[m.group(0)], f.read_text(encoding='utf-8'))
    first = re.search(r'\b(?:class|struct|enum|interface)\s+(\w+)', text)
    rel = f.relative_to(src)
    target = out / rel.parent / ((first.group(1) if first and f.name.startswith('--q') else f.stem) + '.cs')
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target = target.with_name(target.stem + '_' + str(len(list(target.parent.glob(target.stem + '*')))) + '.cs')
    target.write_text(text, encoding='utf-8')
(out / 'name-map.json').write_text(json.dumps({v: k for k, v in names.items()}, indent=0), encoding='utf-8')
print(len(files), 'files,', len(names), 'obfuscated identifiers')
