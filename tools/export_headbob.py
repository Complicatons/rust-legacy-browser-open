"""Read shipped HeadBob/CameraFX data only. Never executes original game code."""
import json
from unity_common import Bundles, ROOT, identity

b = Bundles([ROOT/'analysis/client-source/bundles', ROOT/'analysis/client-source/data'],
            ['gameobject.000.unity3d', 'gameobject.001.unity3d', 'sharedassets0.assets', 'scriptableobject.000.unity3d', 'resources.assets'])
found = []
effects = {}
shot_effects = {}
bindings = {}
def effect(owner, ptr):
    if not ptr['m_PathID']: return None
    obj = b.resolve(owner, ptr); d = obj.read_typetree()
    assert b.script(obj, d) == 'BobPunchEffect'
    effects[identity(obj)] = {k:v for k,v in d.items() if not k.startswith('m_')}
    return identity(obj)
for a in list(b.assets.values()):
    for o in a.objects.values():
        if o.type.name != 'MonoBehaviour': continue
        try: d = o.read_typetree()
        except Exception: continue
        if 'shotBob' in d: shot_effects[str(d['_uniqueID'])] = effect(o.assets_file, d['shotBob'])
        for field in ['fallbob', '_takeDamageBob', '_meleeBob']:
            if field in d: bindings[field.lstrip('_')] = effect(o.assets_file, d[field])
        if b.script(o, d) != 'HeadBob': continue
        cfg = b.resolve(o.assets_file, d['cfg'])
        go = b.resolve(o.assets_file, d['m_GameObject'])
        camera_fx = b.components(o.assets_file, go.read_typetree())['CameraFX'][0]
        order = [b.script(p, p.read_typetree()) for ptr in camera_fx.read_typetree()['_effects']
                 if (p := b.resolve(camera_fx.assets_file, ptr))]
        found.append({'source': identity(o), 'configSource': identity(cfg), 'effectOrder': order,
                      'component': {k:v for k,v in d.items() if not k.startswith('m_') and k not in ['cfg','_motor','_mount']},
                      'config': {k:v for k,v in cfg.read_typetree().items() if not k.startswith('m_')}})
assert len(found) == 1
assert found[0]['component']['simStep'] == 0 and found[0]['config']['intermitRate'] == 0
found[0].update(effects=effects, shotEffects=shot_effects, bindings=bindings)
(ROOT/'browser/assets/recovered/headbob.json').write_text(json.dumps(found[0], separators=(',', ':')))
print('Exported', found[0]['source'], found[0]['effectOrder'], len(found[0]['config']['additionalCurves']), 'curves')
