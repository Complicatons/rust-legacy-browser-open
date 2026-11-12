"""Static export of the original render-quality data: QualitySettings levels, the sun Light's shadow settings, the in-game
Scene Camera's image-effect components (order, serialized enabled flags, parameters), the NoiseAndGrain noise texture and
the scene renderers' cast/receive shadow flags.

Data bundles only, read with UnityPy; no target assembly or executable is loaded. Sources:
  client mainData          QualitySettings (six levels, m_CurrentQuality), PlayerSettings (rendering path, colour space).
  client scenes.unity3d    BuildPlayer-rust_island_2013: 'Scene Camera' (Camera + MonoBehaviours in component order),
                           RustSky/Light (sun/moon Light, shadow settings), TOD_Sky Day/Night ShadowStrength, every
                           MeshRenderer/SkinnedMeshRenderer m_CastShadows/m_ReceiveShadows, TerrainControl castShadows.
  client gameobject.000    the 'Scene Camera' prefab (cross-checked against the scene copy).
  client texture bundles   NoiseAndGrain (the grain noise texture the camera's NoiseAndGrain references).
Runtime rules are in the decompiled render.cs (render.level, update switch), gfx.cs, ImageEffectManager.cs, TOD_Sky.cs
(SetupSunAndMoon shadow strength/type), WaterSettings.cs, LocalRadiationEffect.cs and the image-effect classes in
Assembly-UnityScript-firstpass; browser/quality.mjs, browser/sun-shadows.mjs and browser/post-chain.mjs use them.
"""
import json,hashlib,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from unity_common import ROOT,Bundles
import UnityPy
import numpy as np
from PIL import Image

OUT=ROOT/'browser/assets/recovered/quality';OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
CLIENT=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data']
STRIP=('m_GameObject','m_Script','m_PrefabParentObject','m_PrefabInternal','m_ObjectHideFlags','m_EditorHideFlags','m_EditorClassIdentifier','m_Name')

# --- mainData: QualitySettings + PlayerSettings ---------------------------------------------------------------------
md=UnityPy.load(str(ROOT/'analysis/client-source/data/mainData'));quality=None;player=None
for o in md.objects:
    if o.type.name=='QualitySettings':quality=o.read_typetree()
    elif o.type.name=='PlayerSettings':player=o.read_typetree()
assert quality and len(quality['m_QualitySettings'])==6,'expected the six shipped QualitySettings levels'
levels=[{k:v for k,v in q.items()} for q in quality['m_QualitySettings']]

# --- scene: Scene Camera, sun Light, TOD_Sky, renderer shadow flags, TerrainControl -------------------------------------
b=Bundles(CLIENT,['scenes.unity3d']);scene=b.asset('buildplayer-rust_island_2013')
gos={};trs={}
for o in scene.objects.values():
    if o.type.name=='GameObject':gos[o.path_id]=o.read_typetree()
    elif o.type.name=='Transform':trs[o.path_id]=o.read_typetree()
go_tr={t['m_GameObject']['m_PathID']:pid for pid,t in trs.items()}
def path(gid):
    out=[];tid=go_tr.get(gid)
    while tid:t=trs[tid];out.append(gos[t['m_GameObject']['m_PathID']]['m_Name']);tid=t['m_Father']['m_PathID']
    return '/'.join(reversed(out))
def clean(d):return {k:v for k,v in d.items() if k not in STRIP}
def ref(owner,ptr):
    if not isinstance(ptr,dict) or not ptr.get('m_PathID'):return None
    r=b.resolve(owner,ptr);d=r.read_typetree()
    return {'type':r.type.name,'name':d.get('m_Name') or (d.get('m_ParsedForm') or {}).get('m_Name'),'pathID':r.path_id}

def camera_components(bundles,asset,go):
    out=[]
    for c in go['m_Component']:
        p=c[1] if isinstance(c,(tuple,list)) else c['component'];co=bundles.resolve(asset,p)
        if co is None:continue
        d=co.read_typetree();name=co.type.name
        if name=='MonoBehaviour':name=bundles.script(co,d)
        rec={'type':name,'pathID':co.path_id,'monoBehaviour':co.type.name=='MonoBehaviour'}
        if 'm_Enabled' in d:rec['enabled']=bool(d['m_Enabled'])
        params={}
        for k,v in clean(d).items():
            if k=='m_Enabled':continue
            if isinstance(v,dict) and 'm_PathID' in v:
                if v['m_PathID']:params[k]={'ref':{'type':bundles.resolve(asset,v).type.name,'pathID':v['m_PathID'],'fileID':v['m_FileID']}}
                continue
            params[k]=v
        rec['params']=params;out.append(rec)
    return out

cams=[(oid,o) for oid,o in scene.objects.items() if o.type.name=='Camera']
scene_cam=None
for oid,o in cams:
    d=o.read_typetree();gid=d['m_GameObject']['m_PathID']
    if gos[gid]['m_Name']=='Scene Camera':scene_cam=(gid,d)
assert scene_cam,'Scene Camera not found in rust_island scene'
cam_go=gos[scene_cam[0]];components=camera_components(b,scene,cam_go)

# Cross-check the gameobject-bundle prefab: same component order, enabled flags and parameters.
gb=Bundles(CLIENT,['gameobject.000.unity3d']);prefab=None
for an,a in list(gb.assets.items()):
    for o in list(a.objects.values()):
        if o.type.name!='Camera':continue
        d=o.read_typetree();go=gb.resolve(a,d['m_GameObject']).read_typetree()
        if go['m_Name']=='Scene Camera':prefab=camera_components(gb,a,go)
assert prefab,'Scene Camera prefab not found'
def comparable(cs):return [(c['type'],c.get('enabled'),json.dumps({k:v for k,v in c['params'].items() if not (isinstance(v,dict) and 'ref' in v) and k not in ('sky','camera')},sort_keys=True)) for c in cs if c['monoBehaviour']]
same=comparable(prefab)==comparable(components)
mono=[c['type'] for c in components if c['monoBehaviour']]

sun=None;tod=None;terrain_control=None;flags={};flag_counts={}
for o in scene.objects.values():
    t=o.type.name
    if t=='Light':
        d=o.read_typetree()
        if path(d['m_GameObject']['m_PathID'])=='RustSky/Light':sun=clean(d)
    elif t in ('MeshRenderer','SkinnedMeshRenderer'):
        d=o.read_typetree();key=(int(d.get('m_CastShadows',1)),int(d.get('m_ReceiveShadows',1)))
        flag_counts[str(key)]=flag_counts.get(str(key),0)+1
        if key!=(1,1) and d.get('m_Enabled',1):flags[str(d['m_GameObject']['m_PathID'])]={'cast':bool(key[0]),'receive':bool(key[1]),'name':gos[d['m_GameObject']['m_PathID']]['m_Name'],'renderer':t}
    elif t=='MonoBehaviour':
        d=o.read_typetree();k=b.script(o,d)
        if k=='TOD_Sky':tod=d
        elif k=='TerrainControl':terrain_control=d
assert sun and tod and terrain_control
mask=sun['m_CullingMask']['m_Bits']

# --- NoiseAndGrain noise texture ------------------------------------------------------------------------------------
grain=next(c for c in components if c['type']=='NoiseAndGrain')
grain_obj=None
for c in cam_go['m_Component']:
    p=c[1] if isinstance(c,(tuple,list)) else c['component'];co=b.resolve(scene,p)
    if co is not None and co.type.name=='MonoBehaviour' and b.script(co,co.read_typetree())=='NoiseAndGrain':
        grain_obj=b.resolve(scene,co.read_typetree()['noiseTexture'])
noise=grain_obj.read();td=grain_obj.read_typetree()
img=np.ascontiguousarray(np.asarray(noise.image.convert('RGBA'))[::-1]) # Unity row order (v = 0 first)
Image.fromarray(img,'RGBA').save(OUT/'noise-and-grain.png')
noise_info={'file':'noise-and-grain.png','name':td['m_Name'],'width':td['m_Width'],'height':td['m_Height'],'format':td['m_TextureFormat'],
    'mipmaps':td.get('m_MipCount',1)>1,'wrapMode':td['m_TextureSettings']['m_WrapMode'],'filterMode':td['m_TextureSettings']['m_FilterMode'],
    'rows':'Unity order (v = 0 first), upload without flipping','sha256':hashlib.sha256(img.tobytes()).hexdigest()}

# --- Texture anisotropy levels (QualitySettings.anisotropicTextures Enable uses each texture's own anisoLevel) ---------
aniso={};aniso_counts={}
for f in ['texture.000.unity3d','texture.001.unity3d','texture.002.unity3d','texture.003.unity3d','texture.004.unity3d','terraindata.000.unity3d']:
    tb=Bundles(CLIENT,[f])
    for an,a in list(tb.assets.items()):
        for o in list(a.objects.values()):
            if o.type.name!='Texture2D':continue
            lvl=int(o.read_typetree()['m_TextureSettings']['m_Aniso']);aniso_counts[str(lvl)]=aniso_counts.get(str(lvl),0)+1
            if lvl>1:aniso[str(o.path_id)]=lvl

control=clean(terrain_control)
manifest={
 'source':{'mainData':'QualitySettings, PlayerSettings','scene':'BuildPlayer-rust_island_2013 Scene Camera '+str(scene_cam[0])+', RustSky/Light, TOD_Sky, renderers, TerrainControl',
   'prefab':'gameobject.000 Scene Camera','prefabMatchesScene':same},
 'defaultQuality':quality['m_CurrentQuality'],
 'defaultQualityNote':'m_CurrentQuality as written into the standalone build: the level a fresh install starts at (the launcher dialog preselects it).',
 'qualityNames':[q['name'] for q in levels],'qualitySettings':levels,
 'player':{'renderingPath':player['m_RenderingPath'],'activeColorSpace':player['m_ActiveColorSpace']},
 'camera':{'hdr':bool(scene_cam[1]['m_HDR']),'renderingPath':scene_cam[1]['m_RenderingPath'],'near':scene_cam[1]['near clip plane'],'far':scene_cam[1]['far clip plane'],
   'cullingMask':scene_cam[1]['m_CullingMask']['m_Bits'],'components':components,'monoBehaviourOrder':mono},
 'sunLight':{'path':'RustSky/Light','type':sun['m_Type'],'shadows':sun['m_Shadows'],'cullingMask':mask,'excludedLayers':[i for i in range(32) if not mask>>i&1]},
 'todShadowStrength':{'day':tod['Day']['ShadowStrength'],'night':tod['Night']['ShadowStrength'],'clouds':tod['Clouds']['ShadowStrength']},
 'noiseTexture':noise_info,
 'textureAniso':{'levels':aniso,'counts':aniso_counts,'note':'Texture2D path ID -> m_TextureSettings.m_Aniso for every client texture above 1 (exported files are named texture-<pathID>.png).'},
 'shadowFlags':{'scene':flags,'sceneCounts':flag_counts,'terrainCastShadows':bool(control.get('castShadows',0)),
   'note':'Renderer m_CastShadows/m_ReceiveShadows that differ from (1,1), keyed by GameObject path ID (scene export instance.gameObjectPathID).'},
}
data=json.dumps(manifest,indent=1,default=str);(OUT/'manifest.json').write_text(data)
print(json.dumps({'defaultQuality':manifest['defaultQuality'],'levels':[q['name'] for q in levels],'components':[(c['type'],c.get('enabled')) for c in components],
 'prefabMatchesScene':same,'shadowFlagExceptions':len(flags),'counts':flag_counts,'noise':noise_info,'sunShadows':sun['m_Shadows'],'terrainCast':manifest['shadowFlags']['terrainCastShadows']},indent=1,default=str))
