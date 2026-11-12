"""Recover data only. Never imports or executes supplied game code.

Exports the material data the original world shaders need beyond tools/export_world.py, without touching its files:
  - the terrain's Facepunch Terrain material (TerrainControl._terrainMaterialTemplate -> material.000 -706246983):
    _ControlColor (rust_island_2013_color), _ControlNormal (rust_island_2013_normal_4096), _ColTex0..3, and the
    splat prototypes' tile sizes / normal maps (TerrainData m_SplatDatabase; the shader samples _Normal0 only);
  - each terrain tree prototype's Tree Creator materials (shader name, every texture slot, floats, colours), so the
    bark (_BumpSpecMap, _TranslucencyMap) and leaf (_TranslucencyColor, view dependency) terms can be reproduced.
Writes browser/assets/recovered/world-materials.json and new texture-*.png files (existing files are not rewritten).
"""
from pathlib import Path
import sys, json, hashlib
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import UnityPy

SOURCE = ROOT / 'analysis/world-source/bundles'
OUT = ROOT / 'browser/assets/recovered'
sources = {}
def bundle(name):
    path = SOURCE / (name + '.unity3d')
    sources[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {o.path_id: o for o in UnityPy.load(str(path)).objects}
written = []
def texture(objects, pid):
    name = f'texture-{pid}.png'
    t = objects[pid].read()
    if not (OUT / name).exists():
        t.image.save(OUT / name); written.append(name)
    return {'file': name, 'width': t.m_Width, 'height': t.m_Height, 'pathID': pid, 'name': t.m_Name, 'format': int(t.m_TextureFormat)}
def find_texture(pid):
    for b in ['texture.000', 'texture.001', 'texture.002', 'texture.003', 'texture.004', 'texture.005']:
        objs = bundle(b)
        if pid in objs and objs[pid].type.name == 'Texture2D':
            return texture(objs, pid)
    raise KeyError(pid)

# Terrain material template (client and server material.000 carry the same object).
mats = bundle('material.000')
tm = mats[-706246983].read_typetree()
assert tm['m_Name'] == 'terrain-rust_island_2013' and tm['m_Shader']['m_PathID'] == 37636092  # Nature/Terrain/Facepunch Terrain
props = tm['m_SavedProperties']
envs = {k['name']: v for k, v in props['m_TexEnvs']}
colors = {k['name']: v for k, v in props['m_Colors']}
terrain = {'material': tm['m_Name'], 'materialPathID': -706246983, 'shader': 'Nature/Terrain/Facepunch Terrain',
           'controlColor': find_texture(envs['_ControlColor']['m_Texture']['m_PathID']),
           'controlNormal': find_texture(envs['_ControlNormal']['m_Texture']['m_PathID']),
           'colTex': [colors[f'_ColTex{i}'] for i in range(4)],
           'floats': {k['name']: v for k, v in props['m_Floats']}}
td = bundle('terraindata.000')
data = td[1737373048].read_typetree()
splats = data['m_SplatDatabase']['m_Splats']
terrain['splats'] = [{'texturePathID': s['texture']['m_PathID'], 'normalPathID': s['normalMap']['m_PathID'], 'tileSize': s['tileSize'], 'tileOffset': s['tileOffset']} for s in splats]
# Facepunch Terrain only samples _Normal0 (PrePassBase); export that one.
terrain['normal0'] = find_texture(splats[0]['normalMap']['m_PathID'])
terrain['size'] = {'x': data['m_Heightmap']['m_Scale']['x'] * (data['m_Heightmap']['m_Width'] - 1), 'z': data['m_Heightmap']['m_Scale']['z'] * (data['m_Heightmap']['m_Height'] - 1)}

# Tree prototype materials (same prototype order as tools/export_world.py).
shader_names = {10604: 'Hidden/Nature/Tree Creator Bark Optimized', 10605: 'Hidden/Nature/Tree Creator Leaves Optimized', -878336841: 'Hidden/Nature/Tree Creator Leaves Fast Optimized'}
trees = []
for pid in [-1354702245, 2125166147, 993014012, -294295854]:
    go = td[pid].read_typetree()
    comps = {k: td[p['m_PathID']].read_typetree() for k, p in go['m_Component']}
    parts = []
    for mp in comps[23]['m_Materials']:
        m = td[mp['m_PathID']].read_typetree(); p = m['m_SavedProperties']
        slots = {}
        for k, v in p['m_TexEnvs']:
            tid = v['m_Texture']['m_PathID']
            if tid and tid in td and td[tid].type.name == 'Texture2D':
                slots[k['name']] = {**texture(td, tid), 'scale': v['m_Scale'], 'offset': v['m_Offset']}
        parts.append({'name': m['m_Name'], 'shader': shader_names[m['m_Shader']['m_PathID']], 'textures': slots,
                      'floats': {k['name']: v for k, v in p['m_Floats']}, 'colors': {k['name']: v for k, v in p['m_Colors']}})
    trees.append({'name': go['m_Name'], 'prefabPathID': pid, 'parts': parts})

manifest = {'source': 'tools/export_world_materials.py', 'terrain': terrain, 'trees': trees, 'sourceSHA256': sources,
            'outputSHA256': {n: hashlib.sha256((OUT / n).read_bytes()).hexdigest() for n in sorted({t['file'] for t in [terrain['controlColor'], terrain['controlNormal'], terrain['normal0']]} | {s['file'] for tr in trees for pa in tr['parts'] for s in pa['textures'].values()})}}
(OUT / 'world-materials.json').write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf-8')
print(json.dumps({'written': written, 'terrain': {k: v for k, v in terrain.items() if k != 'splats'}, 'trees': [[(p['name'], p['shader'], list(p['textures'])) for p in t['parts']] for t in trees]}, indent=1))
