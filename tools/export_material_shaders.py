"""Recover data only. Never imports or executes supplied game code.

Older exports (loot, resources) were written from the server bundles, whose materials cannot resolve their ShaderLab
shaders (the server build ships no shader bundle) and which only recorded _MainTex. The client material.000 holds the
same material objects (same path IDs), so this completes each such material in place with the shader name, every
texture slot (e.g. _BumpMap), floats and colours, as unity_common.Writer.material does for newer exports.
Existing texture files are left untouched; only missing slot textures are written. Usage: python tools/export_material_shaders.py
"""
import json
from unity_common import ROOT,Bundles,Writer

CLIENT=ROOT/'analysis/client-source/bundles'
client=Bundles([CLIENT,ROOT/'analysis/client-source/data'],['material.000.unity3d'])
mat_asset=next(a for a in client.assets.values() if a.name.lower().startswith('cab-material.000'))

class KeepingWriter(Writer):
    def texture(self,obj):
        from unity_common import identity,token
        key=self.ns+identity(obj);filename='texture-'+token(key)+'.png'
        if key not in self.textures and (self.out/filename).exists():
            t=obj.read();self.textures[key]={'file':filename,'width':t.m_Width,'height':t.m_Height,'source':key}
        return super().texture(obj)

for name in ['loot','resources']:
    out=ROOT/'browser/assets/recovered'/name;path=out/'manifest.json'
    manifest=json.loads(path.read_text(encoding='utf-8'));writer=KeepingWriter(client,out);before={p.name for p in out.iterdir()}
    changed=0
    for key,m in manifest['materials'].items():
        if m.get('shader'):continue
        pid=int(key.rsplit(':',1)[1]);obj=mat_asset.objects.get(pid)
        if obj is None or obj.type.name!='Material':print('unresolved',name,key);continue
        k=writer.material(obj);d=writer.materials[k]
        assert d['name']==m['name'],(d['name'],m['name'])
        if d['texture']!=m.get('texture') and m.get('texture'):
            # Same texture object in a differently named bundle (client texture.002 vs server texture.003): keep the
            # existing file when the pixels match and drop the duplicate.
            import numpy as np;from PIL import Image
            if (np.asarray(Image.open(out/d['texture']))==np.asarray(Image.open(out/m['texture']))).all():
                for s in d['textures'].values():
                    if s['file']==d['texture']:s['file']=m['texture']
                if d['texture'] not in before:(out/d['texture']).unlink()
                writer.textures={k:v for k,v in writer.textures.items() if v['file']!=d['texture']}
            else:print('main texture differs',name,key,d['texture'],m.get('texture'))
        m.update(shader=d['shader'],textures=d['textures'],floats=d['floats'],colors=d['colors']);changed+=1
    for t in writer.textures.values():manifest['textures'].setdefault(t['source'],t)
    new=sorted({p.name for p in out.iterdir()}-before)
    path.write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
    print(name,'materials completed',changed,'new files',new,[(m['name'],m.get('shader')) for m in manifest['materials'].values()])
