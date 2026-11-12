"""Static export of the original sky (TOD_Sky + TOD_Resources) and sea (FX/Water4 RustWater) settings.

Data bundles only, read with UnityPy; no target assembly or executable is loaded. Sources:
  client scenes.unity3d  RustSky (TOD_Sky, TOD_Animation, TOD_Resources, TOD_Components, Light),
                          RustWater (WaterBase, PlanarReflection, WaterColor, SpecularLighting, Tile, WaterLine),
                          the matWriteZ Plane, RenderSettings (fog).
  client gameobject      the in-game 'Scene Camera' prefab (TOD_Camera, far clip, TOD_SunShafts).
  client mainData        PlayerSettings colour space (gamma), TagManager layer names.
Runtime rules are in the decompiled TOD_Sky / TOD_Animation / TOD_Camera / WaterColor / WaterSettings /
WaterBase / PlanarReflection classes; the shader programs (analysis/sky-source/shaders) define how values are used.

Textures are written as opaque PNGs holding only the channels the original programs read, so browsers cannot lose
colour under zero alpha: DXT5nm normal maps (.wy) -> R=x(w) G=y(g); alpha-only noise/sun masks (.w) -> R.
Meshes are written in Unity object space (no Z reflection): the browser shaders convert directions themselves.
"""
import json,hashlib,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from unity_common import ROOT,Bundles,trs
from UnityPy.helpers.MeshHelper import MeshHandler
import UnityPy
import numpy as np
from PIL import Image

OUT=ROOT/'browser/assets/recovered/sky';OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
CLIENT=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data']
b=Bundles(CLIENT,['scenes.unity3d']);scene=b.asset('buildplayer-rust_island_2013')
STRIP=('m_GameObject','m_Script','m_PrefabParentObject','m_PrefabInternal','m_ObjectHideFlags','m_EditorHideFlags','m_Name','m_EditorClassIdentifier','m_Enabled')

gos={};trs_={}
for o in scene.objects.values():
    if o.type.name=='GameObject':gos[o.path_id]=o.read_typetree()
    elif o.type.name=='Transform':trs_[o.path_id]=o.read_typetree()
go_tr={t['m_GameObject']['m_PathID']:pid for pid,t in trs_.items()}
def path(tid):
    out=[]
    while tid:t=trs_[tid];out.append(gos[t['m_GameObject']['m_PathID']]['m_Name']);tid=t['m_Father']['m_PathID']
    return '/'.join(reversed(out))
def clean(d):return {k:v for k,v in d.items() if k not in STRIP}
def world(tid):
    if not tid:return np.eye(4)
    return world(trs_[tid]['m_Father']['m_PathID'])@trs(trs_[tid])

behaviours={};render_settings=None;lights=[]
for o in scene.objects.values():
    if o.type.name=='RenderSettings':render_settings=o.read_typetree()
    elif o.type.name=='Light':d=o.read_typetree();lights.append({'path':path(go_tr[d['m_GameObject']['m_PathID']]),**clean(d)})
    elif o.type.name=='MonoBehaviour':
        d=o.read_typetree();k=b.script(o,d)
        if k in ('TOD_Sky','TOD_Animation','TOD_Resources','TOD_Weather','WaterBase','PlanarReflection','WaterColor','SpecularLighting','WaterTile'):
            gid=d['m_GameObject']['m_PathID'];t=trs_[go_tr[gid]]
            behaviours[k]={'path':path(go_tr[gid]),'enabled':bool(d['m_Enabled']),'active':bool(gos[gid]['m_IsActive']),'layer':gos[gid]['m_Layer'],
                'localPosition':t['m_LocalPosition'],'localScale':t['m_LocalScale'],'pathID':o.path_id,'data':clean(d),'obj':o}
sky=behaviours['TOD_Sky'];res=behaviours['TOD_Resources']['data'];res_obj=behaviours['TOD_Resources']['obj']

def save_png(name,array,mode):
    Image.fromarray(np.ascontiguousarray(array),mode).save(OUT/name);return name
textures={}
def texture(ptr,channels,owner=None):
    """Export one texture with only the channels its original program samples ('rgb', 'a', or 'wy')."""
    t=b.resolve(owner or res_obj.assets_file,ptr)
    key=t.assets_file.name.lower()+':'+str(t.path_id)+':'+channels
    if key in textures:return textures[key]['file']
    tex=t.read();img=np.asarray(tex.image.convert('RGBA'))
    if channels=='rgb':out=img[:,:,:3];mode='RGB'
    elif channels=='a':out=img[:,:,3];mode='L'
    elif channels=='wy':out=np.stack([img[:,:,3],img[:,:,1],np.zeros_like(img[:,:,0])],-1);mode='RGB'
    else:raise ValueError(channels)
    name=f"{tex.m_Name.replace(' ','_')}-{channels}-{hashlib.sha256(key.encode()).hexdigest()[:10]}.png"
    save_png(name,out,mode)
    textures[key]={'file':name,'name':tex.m_Name,'width':tex.m_Width,'height':tex.m_Height,'channels':channels,'wrap':getattr(tex.m_TextureSettings,'m_WrapMode',None),'source':key}
    return name

def material(ptr,channels,owner=None):
    m=b.resolve(owner or res_obj.assets_file,ptr);d=m.read_typetree();p=d['m_SavedProperties']
    envs={e[0]['name']:e[1] for e in p['m_TexEnvs']};floats={e[0]['name']:e[1] for e in p['m_Floats']};colors={e[0]['name']:e[1] for e in p['m_Colors']}
    shader=b.resolve(m.assets_file,d['m_Shader']);script=shader.read_typetree().get('m_Script') or '';script=script if isinstance(script,str) else bytes(script).decode('latin1')
    out={'name':d['m_Name'],'shader':script.split('"')[1],'floats':floats,'colors':colors,'textures':{}}
    for name,env in envs.items():
        if env['m_Texture']['m_PathID'] and name in channels:
            out['textures'][name]={'file':texture(env['m_Texture'],channels[name],m.assets_file),'scale':env['m_Scale'],'offset':env['m_Offset']}
    return out

def mesh(ptr):
    o=b.resolve(res_obj.assets_file,ptr);h=MeshHandler(o.read());h.process()
    v=np.array(h.m_Vertices,'<f4')[:,:3];n=np.array(h.m_Normals,'<f4')[:,:3];t=np.array(h.m_Tangents,'<f4')[:,:4]
    idx=np.concatenate([np.asarray(x,'<u4').reshape(-1) for x in h.get_triangles()])
    name=o.read().m_Name;files={}
    for k,a in (('position',v),('normal',n),('tangent',t),('index',idx)):
        f=f'mesh-{name}-{k}.bin';a.tofile(OUT/f);files[k]={'file':f,'count':int(a.size)}
    return {'name':name,**files}

# The in-game camera prefab: TOD_Camera (dome follows it, scale = factor * far clip) and its far clip plane.
go_bundles=Bundles(CLIENT,['gameobject.000.unity3d']);camera=None
for an,a in list(go_bundles.assets.items()):
    for o in list(a.objects.values()):
        if o.type.name!='Camera':continue
        d=o.read_typetree();go=go_bundles.resolve(a,d['m_GameObject']).read_typetree()
        if go['m_Name']!='Scene Camera':continue
        comps=go_bundles.components(a,go)
        tc=clean(comps['TOD_Camera'][0].read_typetree());ss=clean(comps['TOD_SunShafts'][0].read_typetree())
        camera={'prefab':'Scene Camera','near':d['near clip plane'],'far':d['far clip plane'],'fov':d['field of view'],'hdr':bool(d['m_HDR']),'renderingPath':d['m_RenderingPath'],'clearFlags':d['m_ClearFlags'],
            'todCamera':tc,'sunShafts':{k:v for k,v in ss.items() if not isinstance(v,dict)}}
assert camera,'Scene Camera prefab not found'

main=UnityPy.load(str(ROOT/'analysis/client-source/data/mainData'));color_space=None;layers={}
for o in main.objects:
    if o.type.name=='PlayerSettings':color_space=o.read_typetree()['m_ActiveColorSpace']
    elif o.type.name=='TagManager':
        d=o.read_typetree();layers={int(k.split()[-1]):v for k,v in d.items() if k.startswith(('Builtin Layer','User Layer')) and v}

# Water: WaterBase material (FX/Water4) and the Tile mesh grid, the matWriteZ plane.
wb=behaviours['WaterBase'];water_mat=material(wb['data']['sharedMaterial'],{'_BumpMap':'wy','_ShoreTex':'rgb'},wb['obj'].assets_file)
tile=None;write_z=None
renderers={d['m_GameObject']['m_PathID']:d for d in (o.read_typetree() for o in scene.objects.values() if o.type.name=='MeshRenderer')}
for o in scene.objects.values():
    if o.type.name!='MeshFilter':continue
    d=o.read_typetree();gid=d['m_GameObject']['m_PathID'];tid=go_tr[gid];p=path(tid)
    if p in ('RustWater/Tile','Plane') or gos[gid]['m_Name']=='Plane':
        m=b.resolve(scene,d['m_Mesh']);h=MeshHandler(m.read());h.process();v=np.array(h.m_Vertices)[:,:3]
        xs=np.unique(np.round(v[:,0],4));zs=np.unique(np.round(v[:,2],4))
        info={'path':p,'mesh':m.read().m_Name,'vertices':len(v),'gridX':len(xs),'gridZ':len(zs),'min':v.min(0).tolist(),'max':v.max(0).tolist()}
        if p=='RustWater/Tile':w=world(tid);tile=info;info.update(worldY=float(w[1,3]),worldScale=[float(np.linalg.norm(w[:3,i])) for i in range(3)])
        else:
            mats=[b.resolve(scene,p_).read_typetree()['m_Name'] for p_ in renderers[gid]['m_Materials']]
            if 'matWriteZ' not in mats:continue
            w=world(tid);info.update(worldY=float(w[1,3]),worldScale=[float(np.linalg.norm(w[:3,i])) for i in range(3)],materials=mats)
            write_z=info

tod=sky['data']
manifest={
 'source':'client scenes.unity3d RustSky/RustWater, gameobject Scene Camera prefab, mainData PlayerSettings/TagManager',
 'colorSpace':'gamma' if color_space==0 else 'linear','gamma':2.2 if color_space==0 else 1.0,
 'tod':{k:tod[k] for k in ('UnityColorSpace','CloudQuality','MeshQuality','Cycle','Atmosphere','Day','Night','Light','Stars','Clouds','World')},
 'domeTransform':{'position':sky['localPosition'],'scale':sky['localScale'],'layer':sky['layer']},
 'animation':behaviours['TOD_Animation']['data'],
 'weather':{**behaviours['TOD_Weather']['data'],'enabled':behaviours['TOD_Weather']['enabled']},
 'camera':camera,
 'renderSettings':{'fog':bool(render_settings['m_Fog']),'fogMode':render_settings['m_FogMode'],'fogColor':render_settings['m_FogColor'],'fogDensity':render_settings['m_FogDensity'],
   'linearFogStart':render_settings['m_LinearFogStart'],'linearFogEnd':render_settings['m_LinearFogEnd'],'ambientLight':render_settings['m_AmbientLight']},
 'light':lights[0] if lights else None,
 'materials':{
   'space':material(res['SpaceMaterial'],{'_MainTex':'rgb'}),
   'moon':material(res['MoonMaterial'],{'_MainTex':'rgb'}),
   'sun':material(res['SunMaterial'],{'_MainTex':'a'}),
   'clouds':material(res['CloudMaterialBumped'],{'_NoiseTexture1':'a','_NoiseTexture2':'a','_NoiseNormals1':'wy','_NoiseNormals2':'wy'}),
   'atmosphere':material(res['AtmosphereMaterial'],{}),
 },
 'meshes':{'halfIcosphere':mesh(res['HalfIcosphereHigh']),'icosphere':mesh(res['IcosphereHigh'])},
 'water':{
   'material':water_mat,
   'waterBase':{'waterQuality':wb['data']['waterQuality'],'edgeBlend':bool(wb['data']['edgeBlend']),'position':wb['localPosition'],'scale':wb['localScale'],'layer':wb['layer']},
   'planarReflection':{k:v for k,v in behaviours['PlanarReflection']['data'].items()},
   'waterColor':behaviours['WaterColor']['data'],
   'specularLight':behaviours['SpecularLighting']['data'].get('specularLight'),
   # WaterSettings.RefreshSettings: PlanarReflection.reflectionMask = 13111296 with water.reflection, else 8388608.
   'reflectionMask':{'on':13111296,'off':8388608},
   'tile':tile,'writeZPlane':write_z,
 },
 'layers':layers,'textures':list(textures.values()),
}
manifest['outputSHA256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.iterdir()) if p.is_file()}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=1,default=str),encoding='utf-8')
print(json.dumps({'textures':[t['file'] for t in textures.values()],'camera':{k:camera[k] for k in ('far','near')},'fog':manifest['renderSettings'],'tile':tile,'writeZ':write_z,'colorSpace':manifest['colorSpace']},indent=1,default=str))
