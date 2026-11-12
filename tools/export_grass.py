"""Static export of the client's FPGrass system (grass.on): settings, patch grid, atlas, probabilities and textures.

Data bundles only, read with UnityPy; no target assembly or executable is loaded. Sources:
  client scenes.unity3d (BuildPlayer-rust_island_2013): FPGrass 38423, its two FPGrassLevel children, 32 FPGrassPatch
      objects and their transforms, FPGrassLayer on the main camera (parentCamera).
  client material.000: GrassMaterial + GrassMaterial(Level00/01) (Custom/FPGrassShader), the two
      FPGrassProbabilityGenerator RenderSplatMaterials (Custom/RenderSplatProbability).
  client gameobject.000: FPGrassProbabilities (16x2 detail id/probability pixels), FPGrassAtlas + 16 FPGrassProperty,
      FPGrassProbabilityGenerator00/01.
  client mesh.000: the 32 patch meshes (verified against the closed-form layout below, not shipped).
  client texture.00x: Atlas, noise2, noise, Normals, Height, Splat.
  client mainData: QualitySettings (softVegetation gates the shader's REQUIREOPTIONS=SoftVegetation passes).
Runtime rules: decompiled FPGrass*.cs / grass.cs; shader programs: analysis/grass-source/shaders (tools/_grass-shaders.py).

Textures are written with rows in Unity order (texture v=0 first), to be uploaded without flipping:
  Atlas -> RGBA PNG (alpha is the cutout), noise2 -> RGBA PNG (all four channels are read), noise -> L PNG (Alpha8),
  Normals (DXT5nm, the program reads .wy) -> RGB PNG with R=w, G=y.
Height and Splat are not written: Height decodes (RGBA . (1,1/255,1/65025,1/16581375) * 1500) to the terrain heightmap
within the validation tolerance recorded below, and Splat is byte-identical to the world export's terrain alphamap PNG
(the FPGrass program samples it at v = 1 - z/size), so the browser reuses both.
"""
import json,hashlib,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from unity_common import ROOT,Bundles,trs
from UnityPy.helpers.MeshHelper import MeshHandler
import UnityPy
import numpy as np
from PIL import Image

OUT=ROOT/'browser/assets/recovered/grass';OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
CLIENT=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data']
b=Bundles(CLIENT,['scenes.unity3d']);scene=b.asset('buildplayer-rust_island_2013')
STRIP=('m_GameObject','m_Script','m_PrefabParentObject','m_PrefabInternal','m_ObjectHideFlags','m_EditorHideFlags','m_EditorClassIdentifier')

def script_objects(name):
    out=[]
    for o in scene.objects.values():
        if o.type.name=='MonoBehaviour':
            d=o.read_typetree()
            if b.script(o,d)==name:out.append((o,d))
    return out
grasses=script_objects('FPGrass');assert len(grasses)==1,'expected one FPGrass';fp_obj,fp=grasses[0]
layers=script_objects('FPGrassLayer');assert len(layers)==1

def transform_of(go_ptr,owner=scene):
    go=b.resolve(owner,go_ptr).read_typetree()
    t=[b.resolve(owner,c[1] if isinstance(c,(list,tuple)) else c['component']) for c in go['m_Component']]
    return go,[x for x in t if x.type.name=='Transform'][0].read_typetree()
def chain(go_ptr):
    go,t=transform_of(go_ptr);out=[(go['m_Name'],t['m_LocalPosition'],t['m_LocalRotation'],t['m_LocalScale'])]
    while t['m_Father']['m_PathID']:
        t=b.resolve(scene,t['m_Father']).read_typetree();g=b.resolve(scene,t['m_GameObject']).read_typetree()
        out.append((g['m_Name'],t['m_LocalPosition'],t['m_LocalRotation'],t['m_LocalScale']))
    return out

def tex_settings(o):
    d=o.read_typetree();s=d.get('m_TextureSettings',{})
    return {'name':d['m_Name'],'width':d['m_Width'],'height':d['m_Height'],'format':d['m_TextureFormat'],'mipmap':bool(d.get('m_MipMap')),
            'filter':['point','bilinear','trilinear'][s.get('m_FilterMode',1)],'wrap':['repeat','clamp'][s.get('m_WrapMode',0)],'aniso':s.get('m_Aniso'),'source':o.assets_file.name.lower()+':'+str(o.path_id)}
def unity_rows(o):return np.ascontiguousarray(np.asarray(o.read().image.convert('RGBA'))[::-1])
textures={}
def write_texture(o,channels):
    key=o.assets_file.name.lower()+':'+str(o.path_id)
    if key in textures:return textures[key]['file']
    img=unity_rows(o)
    if channels=='rgba':out,mode=img,'RGBA'
    elif channels=='a':out,mode=img[:,:,3],'L'
    elif channels=='wy':out,mode=np.stack([img[:,:,3],img[:,:,1],np.zeros_like(img[:,:,0])],-1),'RGB'
    else:raise ValueError(channels)
    info=tex_settings(o);name=f"{info['name']}-{channels}-{hashlib.sha256(key.encode()).hexdigest()[:10]}.png"
    Image.fromarray(np.ascontiguousarray(out),mode).save(OUT/name,optimize=True)
    textures[key]={**info,'file':name,'channels':channels,'rows':'unity'};return name

def material(ptr,owner=scene):
    m=b.resolve(owner,ptr);d=m.read_typetree();p=d['m_SavedProperties']
    sh=b.resolve(m.assets_file,d['m_Shader']);script=sh.read_typetree().get('m_Script') or '';script=script if isinstance(script,str) else bytes(script).decode('latin1')
    tex={}
    for k,v in p['m_TexEnvs']:
        t=b.resolve(m.assets_file,v['m_Texture']) if v['m_Texture']['m_PathID'] else None
        tex[k['name']]=None if t is None else {**tex_settings(t),'scale':v['m_Scale'],'offset':v['m_Offset'],'obj':t}
    return {'name':d['m_Name'],'shader':script.split('"')[1],'floats':{k['name']:v for k,v in p['m_Floats']},'colors':{k['name']:v for k,v in p['m_Colors']},'textures':tex,'source':m.assets_file.name.lower()+':'+str(m.path_id)}
def public(mat):
    out=dict(mat);out['textures']={k:(None if v is None else {kk:vv for kk,vv in v.items() if kk!='obj'}|({'file':textures[v['source']]['file']} if v['source'] in textures else {})) for k,v in mat['textures'].items()}
    return out

base_mat=material(fp['material'])
atlas_tex=base_mat['textures']['_MainTex']['obj'];noise2=base_mat['textures']['_NoiseTex']['obj']
height_tex=base_mat['textures']['_HeightMap']['obj'];normal_tex=base_mat['textures']['_NormalMap']['obj']
write_texture(atlas_tex,'rgba');write_texture(noise2,'rgba');write_texture(normal_tex,'wy')

# FPGrassLevel / FPGrassPatch: patch meshes are checked against the closed-form layout the browser rebuilds.
levels=[];mesh_checks=[];fp_name=b.resolve(scene,fp['m_GameObject']).read_typetree()['m_Name'];fp_chain=chain(fp['m_GameObject'])
for lv in fp['children']:
    L=b.resolve(scene,lv).read_typetree();lmat=material(L['levelMaterial'])
    pg=b.resolve(scene,L['probabilityGenerator']);pgd=pg.read_typetree();pmat=material(pgd['material'],pg.assets_file)
    noise=pmat['textures']['_Noise']['obj'];write_texture(noise,'a')
    gs=L['gridSpacingAtLevel'];n=L['gridSize'];patches=[]
    for c in L['children']:
        P=b.resolve(scene,c).read_typetree();ch=chain(P['m_GameObject'])
        # FPGrass.UpdateLevels forces the FPGrass position to the origin at runtime. The scene gives FPGrass a rotation and
        # each level its inverse, so a patch's world transform is a pure translation (FPGrassPatch draws with
        # renderPosition = level centre + transform.position and an identity rotation anyway).
        names=[q[0] for q in ch];fp_index=next(i for i,q in enumerate(ch) if q[0]==fp_name)
        world=np.eye(4)
        for q in reversed(ch[:fp_index+1]):
            m=trs({'m_LocalPosition':q[1] if q[0]!=fp_name else {'x':0.0,'y':0.0,'z':0.0},'m_LocalRotation':q[2],'m_LocalScale':q[3]});world=world@m
        assert np.abs(world[:3,:3]-np.eye(3)).max()<1e-5,'patch world transform must be translation only'
        pos=np.round(world[:3,3],4)+0.0  # float32 composition noise (~1e-8) removed
        me=b.resolve(scene,P['mesh']);md=me.read();h=MeshHandler(md);h.process()
        v=np.asarray(h.m_Vertices,dtype=np.float64);t=np.asarray(h.m_Tangents,dtype=np.float64);tri=np.asarray(h.get_triangles()[0]).reshape(-1,3)
        k=np.arange(len(v));blade=k//4;corner=k%4;bx=blade//n;bz=blade%n;half=P['patchSize']/2
        cell=(int(t[0,2]),int(t[0,3]))
        err=max(np.abs(v[:,0]-(-half+bx*gs)).max(),np.abs(v[:,2]-(-half+bz*gs)).max(),np.abs(v[:,1]).max(),
                np.abs(t[:,0]-np.array([-.5,.5,-.5,.5])[corner]).max(),np.abs(t[:,1]-np.array([0,0,1,1])[corner]).max(),
                np.abs(t[:,2]-(cell[0]+bx)).max(),np.abs(t[:,3]-(cell[1]+bz)).max())
        qb=np.arange(len(tri))//2;expect=np.where((np.arange(len(tri))%2==0)[:,None],np.stack([qb*4,qb*4+2,qb*4+3],-1),np.stack([qb*4,qb*4+3,qb*4+1],-1))
        assert len(v)==4*n*n and np.array_equal(tri,expect) and err<1e-5,f'patch mesh {md.m_Name} differs from the closed-form layout ({err})'
        mesh_checks.append({'mesh':md.m_Name,'source':me.assets_file.name.lower()+':'+str(me.path_id),'vertices':len(v),'maxError':float(err)})
        patches.append({'name':names[0],'pathID':c['m_PathID'],'position':[float(x) for x in pos],'patchSize':P['patchSize'],'cell':list(cell),'mesh':md.m_Name})
    levels.append({'levelNumber':L['levelNumber'],'pathID':lv['m_PathID'],'levelSize':L['levelSize'],'gridSize':n,'gridSpacingAtLevel':gs,'gridSizeAtLevel':L['gridSizeAtLevel'],
        'material':public(lmat),'probabilityGenerator':{'name':pgd['m_Name'],'gridScale':pgd['gridScale'],'gridSize':pgd['gridSize'],'material':public(pmat)},'patches':patches})
levels.sort(key=lambda l:l['levelNumber'])

probs=b.resolve(scene,fp['grassProbabilities']).read_typetree()['pixels'];assert len(probs)==32
atlas=b.resolve(scene,fp['grassAtlas']);ad=atlas.read_typetree()
properties=[]
for p in ad['properties']:
    d=b.resolve(atlas.assets_file,p).read_typetree();properties.append({k:d[k] for k in ('m_Name','color1','color2','minWidth','maxWidth','minHeight','maxHeight')})
atlas_textures=[None if not p['m_PathID'] else b.resolve(atlas.assets_file,p).read().m_Name for p in ad['textures']]

# Validation: Height == terrain heightmap, Splat == world alphamap PNG (both reused by the browser).
world=json.loads((ROOT/'browser/assets/recovered/manifest.json').read_text(encoding='utf-8'))
H=unity_rows(height_tex).astype(np.float64)/255;hm=(H@np.array([1,0.00392157,1.53787e-05,6.03086e-08]))*base_mat['colors']['_TerrainScale']['g']
terrain=np.fromfile(ROOT/'browser/assets/recovered'/world['heightFile'],'<f4').reshape(world['size'],world['size'])
hd=np.abs(hm-terrain[:hm.shape[0],:hm.shape[1]]);assert hd.max()<0.1,'Height texture no longer matches the terrain heightmap'
splat_obj=levels[0]['probabilityGenerator']['material']['textures']['_Splat1']['source']
splat=unity_rows(b.resolve(scene,fp['splatMap']));world_alpha=np.asarray(Image.open(ROOT/'browser/assets/recovered'/world['alpha']['file']).convert('RGBA'))
assert np.array_equal(splat,world_alpha),'Splat texture no longer matches the world alphamap PNG'
assert b.resolve(scene,fp['splatMap']).path_id==int(splat_obj.split(':')[1])
# A few splat texels whose alpha is 0 but RGB is not: the browser check confirms it decodes them without premultiplication.
ys,xs=np.nonzero((splat[:,:,3]==0)&(splat[:,:,:3].sum(-1)>200));pick=np.linspace(0,len(ys)-1,12).astype(int)
splat_samples=[{'x':int(xs[i]),'row':int(ys[i]),'rgba':splat[ys[i],xs[i]].tolist()} for i in pick]

# QualitySettings: the program's passes carry REQUIREOPTIONS=SoftVegetation.
md_env=UnityPy.load(str(ROOT/'analysis/client-source/data/mainData'))
quality=[{'name':q['name'],'softVegetation':bool(q['softVegetation'])} for o in md_env.objects if o.type.name=='QualitySettings' for q in o.read_typetree()['m_QualitySettings']]
cam=b.resolve(scene,fp['parentCamera']).read_typetree();cam_go=b.resolve(scene,cam['m_GameObject']).read_typetree()
layer_go=b.resolve(scene,layers[0][1]['m_GameObject']).read_typetree()

manifest={'source':{'scene':'BuildPlayer-rust_island_2013','fpGrassHierarchy':[[q[0],q[1]] for q in fp_chain],'fpGrass':fp_obj.path_id,'fpGrassLayer':layers[0][0].path_id,'fpGrassLayerGameObject':layer_go['m_Name'],'parentCamera':cam_go['m_Name']},
 'conversion':'Unity coordinates (the browser converts to X,Y,-Z in its shader); texture rows in Unity order (v=0 first)',
 'settings':{k:fp[k] for k in ('numberOfLevels','baseLevelSize','gridSizePerLevel','gridSizeAtFinestLevel','scatterAmount','normalBias','windSpeed','windSize','windBending','windTint','followSceneCamera')},
 'castShadows':False,'receiveShadows':True,
 'convars':{'grass.on':True,'grass.forceredraw':False,'grass.displacement':True,'grass.disp_trail_seconds':10.0,'grass.shadowcast':False,'grass.shadowreceive':True},
 'displacement':{'cameraOrthographicSize':50.0,'renderTextureSize':512,'recentreDistance':5.0,'cameraHeight':50.0,'layer':'GrassDisplacement (14)',
     'shippedDisplacers':0,'note':'No FPGrassDisplacementRadius/Trail component exists in the client scenes, gameobject bundles, resources.assets or sharedassets0.assets, so the displacement texture stays clear.'},
 'quality':quality,'baseMaterial':public(base_mat),'levels':levels,
 'patchLayout':'blade b of a patch: x = -patchSize/2 + floor(b/gridSize)*spacing, z = -patchSize/2 + (b%gridSize)*spacing; corners (tangent.xy) (-.5,0),(.5,0),(-.5,1),(.5,1); tangent.zw = patch cell + (floor(b/gridSize), b%gridSize); triangles (0,2,3),(0,3,1)',
 'meshChecks':mesh_checks,
 'probabilities':{'pixels':[[p['r'],p['g'],p['b'],p['a']] for p in probs],'layout':'16x2 Alpha8: row 0 = detail id/256 at 4*splatChannel+slot, row 1 = probability'},
 'atlas':{'properties':properties,'textures':atlas_textures,'texture':textures[atlas_tex.assets_file.name.lower()+':'+str(atlas_tex.path_id)]['file'],'cells':4},
 'height':{'reuse':'world heightFile','texture':tex_settings(height_tex),'maxDifferenceMetres':float(hd.max()),'meanDifferenceMetres':float(hd.mean())},
 'splat':{'reuse':'world alpha','file':world['alpha']['file'],'texture':tex_settings(b.resolve(scene,fp['splatMap'])),'identical':True,'samples':splat_samples},
 'textures':textures,'sourceSHA256':b.sources}
manifest['outputSHA256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.iterdir()) if p.is_file() and p.name!='manifest.json'}
(OUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'),default=str),encoding='utf-8')
print('levels',[(l['levelNumber'],len(l['patches'])) for l in levels],'textures',[t['file'] for t in textures.values()],'height max diff',float(hd.max()))
for p in sorted(OUT.iterdir()):print(p.name,p.stat().st_size)
