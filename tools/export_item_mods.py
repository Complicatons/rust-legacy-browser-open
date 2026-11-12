"""Static weapon-mod export: original skinned attachments, socket overrides, light/laser data and sounds.
Only serialized client data is read; no original code is loaded or executed.
"""
import json
import numpy as np
from unity_common import ROOT, Bundles, Writer, identity, token
from UnityPy.helpers.MeshHelper import MeshHandler

OUT = ROOT / 'browser/assets/recovered/item-mods'
OUT.mkdir(parents=True, exist_ok=True)
b = Bundles([ROOT/'analysis/client-source/bundles', ROOT/'analysis/client-source/data'],
            ['gameobject.000.unity3d', 'gameobject.001.unity3d', 'scriptableobject.000.unity3d', 'sharedassets0.assets'])
w = Writer(b, OUT)
prefabs = {}
laser_textures = {}

def laser_texture(mat):
    # LaserGraphics draws with Unity's own sampling: keep each texture's sampler settings, and Alpha8 mip chains raw
    # (rows bottom-up, as uploaded) so the beam/dot minify through the shipped levels.
    for k, env in mat.read_typetree()['m_SavedProperties']['m_TexEnvs']:
        if not env['m_Texture']['m_PathID']: continue
        t = b.resolve(mat.assets_file, env['m_Texture']); file = w.texture(t)
        if file in laser_textures: continue
        td = t.read_typetree(); s = td['m_TextureSettings']
        entry = {'format':td['m_TextureFormat'], 'filter':s['m_FilterMode'], 'wrap':s['m_WrapMode'], 'aniso':s['m_Aniso'], 'mipBias':s['m_MipBias'], 'mipmaps':bool(td['m_MipMap'])}
        if td['m_TextureFormat'] == 1:
            data = bytes(td['image data']); wd, ht = td['m_Width'], td['m_Height']; off = 0; levels = []
            while True:
                levels.append([wd, ht, off]); off += wd*ht
                if not entry['mipmaps'] or (wd == 1 and ht == 1): break
                wd, ht = max(1, wd//2), max(1, ht//2)
            assert off == len(data), file
            entry['alpha'] = w.binary('alpha-'+token(identity(t))+'.bin', np.frombuffer(data, np.uint8), '<u1')['file']; entry['levels'] = levels
        laser_textures[file] = entry

def audio(owner, ptr):
    if not ptr.get('m_PathID'): return None
    o = b.resolve(owner, ptr); clip = o.read(); (name, data), = clip.samples.items()
    filename = 'sound-'+token(identity(o))+'.'+name.rsplit('.', 1)[-1]
    (OUT/filename).write_bytes(data)
    return filename

def prefab(owner, ptr):
    if not ptr.get('m_PathID'): return None
    obj = b.resolve(owner, ptr); key = identity(obj)
    if key in prefabs: return key
    owner = obj.assets_file; skeleton = []; transforms = []; index = {}; skins = []; lights = []; lasers = []; override = None
    def walk(t_obj, parent):
        d = t_obj.read_typetree(); go = b.resolve(owner, d['m_GameObject']).read_typetree(); i = len(skeleton)
        index[t_obj.path_id] = i; transforms.append((t_obj, go))
        skeleton.append({'name':go['m_Name'], 'parent':parent, 'active':bool(go['m_IsActive']),
                         'position':[d['m_LocalPosition'][k] for k in 'xyz'],
                         'rotation':[d['m_LocalRotation'][k] for k in 'xyzw'], 'scale':[d['m_LocalScale'][k] for k in 'xyz']})
        for p in d['m_Children']: walk(b.resolve(owner, p), i)
    walk(b.components(owner, obj.read_typetree())['Transform'][0], -1)
    for i, (t, go) in enumerate(transforms):
        cs = b.components(owner, go)
        for smr in cs.get('SkinnedMeshRenderer', []):
            sd = smr.read_typetree()
            if not sd['m_Enabled']: continue
            mesh = b.resolve(owner, sd['m_Mesh']); md = mesh.read_typetree(); h = MeshHandler(mesh.read()); h.process()
            prefix = 'skin-'+token(identity(smr))
            def binary(label, values, dtype): return w.binary(prefix+'-'+label+'.bin', np.asarray(values, dtype=dtype), dtype)
            skins.append({'name':mesh.read().m_Name, 'node':i,
                'position':binary('position',np.asarray(h.m_Vertices)[:,:3],'<f4'),
                'normal':binary('normal',np.asarray(h.m_Normals)[:,:3],'<f4'),
                'uv':binary('uv',np.asarray(h.m_UV0)[:,:2],'<f4'),
                'skinIndex':binary('skinindex',h.m_BoneIndices,'<u2'), 'skinWeight':binary('skinweight',h.m_BoneWeights,'<f4'),
                'parts':[binary('indices-'+str(j),np.asarray(part).reshape(-1,3)[:,[0,2,1]],'<u4') for j,part in enumerate(h.get_triangles())],
                'bones':[index[b.resolve(owner,p).path_id] for p in sd['m_Bones']],
                'bindposes':[[bp[f'e{r}{c}'] for c in range(4) for r in range(4)] for bp in md['m_BindPose']],
                'materials':[w.material(b.resolve(owner,p)) for p in sd['m_Materials']]})
        for light in cs.get('Light', []):
            d = light.read_typetree(); cookie = b.resolve(owner,d['m_Cookie']) if d['m_Cookie']['m_PathID'] else None
            lights.append({'node':i, 'data':{k:d[k] for k in ['m_Type','m_Color','m_Intensity','m_Range','m_SpotAngle','m_CullingMask']},
                           'cookie':w.texture(cookie) if cookie else None})
        for laser in cs.get('LaserBeam', []):
            d=laser.read_typetree(); data={k:v for k,v in d.items() if k not in ['m_GameObject','m_Script','m_Name','m_Enabled','beamMaterial','dotMaterial']}
            lasers.append({'node':i, 'data':data, **{k:w.material(b.resolve(owner,d[k])) for k in ['beamMaterial','dotMaterial']}})
            for k in ['beamMaterial','dotMaterial']: laser_texture(b.resolve(owner,d[k]))
        for component in cs.get('VMAttachmentSocketOverride', []):
            d=component.read_typetree()['socketOverride']; parent=b.resolve(owner,d['parent'])
            override={'bone':index[parent.path_id], 'offset':[d['offset'][k] for k in 'xyz'], 'eulerRotate':[d['eulerRotate'][k] for k in 'xyz'], 'proxy':bool(d['proxy'])}
        # These shipped mod prefabs have no animation clips; fail rather than silently discard any future variant.
        for animation in cs.get('Animation', []):
            d=animation.read_typetree(); assert not d['m_Animations'] and not d['m_Animation']['m_PathID'], key
    prefabs[key]={'name':obj.read_typetree()['m_Name'],'skeleton':skeleton,'skins':skins,'lights':lights,'lasers':lasers,'socketOverride':override}
    return key

mods={}
for a in list(b.assets.values()):
    for obj in a.objects.values():
        if obj.type.name != 'MonoBehaviour': continue
        try: d=obj.read_typetree()
        except Exception: continue
        if 'attachObjectVM' not in d: continue
        mods[str(d['_uniqueID'])]={'name':d['m_Name'],'uid':d['_uniqueID'],
            **{k:d[k] for k in ['modFlag','isMesh','attachSocketName','socketOverrideName','punchScalar','zoomOffsetZ','modifyZoomOffset']},
            'vm':prefab(obj.assets_file,d['attachObjectVM']), 'rep':prefab(obj.assets_file,d['attachObjectRep']),
            'sounds':{k:audio(obj.assets_file,d[k]) for k in ['onSound','offSound']}}
assert len(mods)==4
w.finish({'mods':mods,'prefabs':prefabs,'laserTextures':laser_textures,'conversion':'Unity skeleton/vertices/bindposes; mirrored winding. Parent under the viewmodel Unity-space socket. No original code executed.'})
print(json.dumps({m['name']:{'vm':m['vm'],'rep':m['rep']} for m in mods.values()},indent=1))
