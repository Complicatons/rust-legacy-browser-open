"""Recover data only. Never imports or executes supplied game code."""
from pathlib import Path
import sys, os, json, hashlib
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import UnityPy
import numpy as np
from UnityPy.helpers.MeshHelper import MeshHandler

SOURCE = ROOT / 'analysis/world-source/bundles'
# The shared recovered folder is used by every session: export into RLB_EXPORT_OUT and copy only what changed.
OUT = Path(os.environ['RLB_EXPORT_OUT']) if os.environ.get('RLB_EXPORT_OUT') else ROOT / 'browser/assets/recovered'
OUT.mkdir(parents=True, exist_ok=True)
sources = {}
def bundle(name):
    path = SOURCE / (name + '.unity3d')
    sources[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {o.path_id:o for o in UnityPy.load(str(path)).objects}
def save(name, value):
    (OUT / name).write_text(json.dumps(value, separators=(',', ':')), encoding='utf-8')
def texture(objects, pid):
    name = f'texture-{pid}.png'
    image = objects[pid].read().image
    image.save(OUT / name)
    return {'file': name, 'width':image.width, 'height':image.height, 'pathID':pid}

# Resolve the terrain's scene hierarchy rather than mistaking local position for world position.
scene_path=SOURCE / 'scenes.unity3d'
sources[scene_path.name]=hashlib.sha256(scene_path.read_bytes()).hexdigest()
scene_env=UnityPy.load(str(scene_path))
scene=next(a for a in scene_env.assets if a.name=='BuildPlayer-rust_island_2013')
collider=scene.objects[5250].read_typetree()
assert collider['m_TerrainData']['m_PathID']==1737373048
origin=np.zeros(3)
hierarchy=[]
transform_id=1579
while transform_id:
    tr=scene.objects[transform_id].read_typetree()
    assert tr['m_LocalRotation']=={'x':0.,'y':0.,'z':0.,'w':1.}
    assert tr['m_LocalScale']=={'x':1.,'y':1.,'z':1.}
    origin += [tr['m_LocalPosition'][axis] for axis in ('x','y','z')]
    hierarchy.append({'pathID':transform_id,'position':tr['m_LocalPosition']})
    transform_id=tr['m_Father']['m_PathID']
assert np.allclose(origin,[-7999.99951171875,0,-8000],atol=1e-6)
# Terrain tree/detail rendering settings. The scene's Terrain (MonoBehaviour 5405, built-in Terrain script) holds the
# serialized values; TerrainControl (5393) re-assigns the bundle TerrainData reassignTerrainDataInterval seconds after
# OnEnable and then RestoreTerrainSettings() copies its own `settings` onto the terrain (TerrainControl.ReassignTerrainData,
# unless the `terrain.manual` convar is set), so its values are what the running client used. TerrainQualitySettings
# (per-QualityLevel overrides) exists in Assembly-CSharp but is not attached to anything in this scene.
def script_name(o):
    return o.read().m_Script.read().m_ClassName
terrain_mb=scene.objects[5405]; control_mb=scene.objects[5393]
assert script_name(terrain_mb)=='Terrain' and script_name(control_mb)=='TerrainControl'
terrain_tt=terrain_mb.read_typetree(); control_tt=control_mb.read_typetree()
assert terrain_tt['m_TerrainData']['m_PathID']==1737373048 and control_tt['_terrain']['m_PathID']==5405
serialized={k[2].lower()+k[3:]:terrain_tt[k] for k in ('m_TreeDistance','m_TreeBillboardDistance','m_TreeCrossFadeLength','m_TreeMaximumFullLODCount','m_DetailObjectDistance','m_DetailObjectDensity','m_HeightmapPixelError','m_SplatMapDistance','m_HeightmapMaximumLOD','m_CastShadows','m_DrawTreesAndFoliage')}
control={k:v for k,v in control_tt['settings'].items() if k!='materialTemplate'}
tree_rendering={
    'source':{'scene':'BuildPlayer-rust_island_2013','terrainGameObject':412,'terrainComponent':5405,'terrainControl':5393,'terrainControlGameObject':control_tt['m_GameObject']['m_PathID']},
    'serializedTerrain':serialized,
    'terrainControl':{'settings':control,'customBasemapDistance':control_tt['_customBasemapDistance'],'forceCustomBasemapDistance':bool(control_tt['forceCustomBasemapDistance']),'reassignTerrainDataInterval':control_tt['reassignTerrainDataInterval'],'bundlePathToTerrainData':control_tt['bundlePathToTerrainData']},
    # Effective client values: TerrainControl.settings after RestoreTerrainSettings (basemap forced to customBasemapDistance).
    'effective':{'treeDistance':control['treeDistance'],'treeBillboardDistance':control['treeBillboardDistance'],'treeCrossFadeLength':control['treeCrossFadeLength'],'treeMaximumFullLODCount':control['treeMaximumFullLODCount'],'detailObjectDistance':control['detailObjectDistance'],'detailObjectDensity':control['detailObjectDensity'],'heightmapPixelError':control['heightmapPixelError'],'basemapDistance':control_tt['_customBasemapDistance'],'castShadows':bool(control['castShadows'])},
    'notes':['terrain.idleinterval convar (default 3.2 s) forces TerrainHack.RefreshTreeTextures (billboard re-render) when the camera has not moved/turned (>0.0075 m or >0.5 deg)',
             'FPGrass.OnEnable sets detailObjectDistance/Density to 0 (custom FPGrass replaces terrain details while grass.on); OnDisable restores 134.6/1',
             'TerrainQualitySettings (per QualityLevel tree distances) is not attached in this scene'],
}
del scene,scene_env

objects = bundle('terraindata.000')
data = objects[1737373048].read_typetree()
size = data['m_Heightmap']['m_Width']
# Unity's Heightmap normalises the int16 samples by kMaxHeight = 32766 (not 32767): TerrainData heights are
# sample / 32766 * size.y. With 32767 every height came out 1/32766 low (1.3 cm at 430 m), the median error the tree
# validation below used to report.
heights = (np.asarray(data['m_Heightmap']['m_Heights'], dtype=np.float64).reshape(size,size).T * (1500/32766)).astype(np.float32)
heights.astype('<f4').tofile(OUT / 'heights.f32')
instances = data['m_DetailDatabase']['m_TreeInstances']
print('Tree sample:', instances[0], flush=True)
placements = []
errors = []
for i, t in enumerate(instances):
    p = t['position']
    x,z = p['x']*(size-1),p['z']*(size-1)
    a,b = min(int(x),size-2),min(int(z),size-2)
    u,v=x-a,z-b
    # Unity's terrain surface (Heightmap::GetInterpolatedHeight, the PhysX TerrainCollider, the terrain mesh) splits
    # each cell along the (x,z)-(x+1,z+1) diagonal; the editor snaps TreeInstance y to it, so trees sit on it exactly.
    h00,h10,h01,h11=heights[b,a],heights[b,a+1],heights[b+1,a],heights[b+1,a+1]
    h=h00+(h10-h00)*u+(h11-h10)*v if u>=v else h00+(h01-h00)*v+(h11-h01)*u
    if i%29==0: errors.append(abs(float(h)-p['y']*1500))
    # TreeInstance.color (ColorRGBA32 r|g<<8|b<<16|a<<24): per-tree tint the terrain passes to tree shaders as _Color.
    placements.append([p['x']*16000-7999.99951171875,p['y']*1500,8000-p['z']*16000,t['index'],t['widthScale'],t['heightScale'],t['color']['rgba']])
save('trees.json', placements)
detail=data['m_DetailDatabase']
tree_rendering['treePrototypes']=[{'prefabPathID':tp['prefab']['m_PathID'],'bendFactor':tp['bendFactor']} for tp in detail['m_TreePrototypes']]
tree_rendering['detail']={
    'prototypes':[{'prototypePathID':dp['prototype']['m_PathID'],'name':objects[dp['prototype']['m_PathID']].read_typetree()['m_Name'],**{k:dp[k] for k in ('minWidth','maxWidth','minHeight','maxHeight','noiseSpread','bendFactor','healthyColor','dryColor','renderMode','usePrototypeMesh')}} for dp in detail['m_DetailPrototypes']],
    'patchCount':detail['m_PatchCount'],'patchSamples':detail['m_PatchSamples'],
    'nonEmptyPatches':sum(1 for pa in detail['m_Patches'] if any(pa['numberOfObjects'])),
    'wavingGrass':{'strength':detail['m_WavingGrassStrength'],'amount':detail['m_WavingGrassAmount'],'speed':detail['m_WavingGrassSpeed'],'tint':detail['WavingGrassTint']},
    'atlasTextures':[a['m_PathID'] for a in detail['m_PreloadTextureAtlasData']],
}
models=[]
assert [tp['prefabPathID'] for tp in tree_rendering['treePrototypes']]==[-1354702245,2125166147,993014012,-294295854]
for pid in [-1354702245,2125166147,993014012,-294295854]:
    go=objects[pid].read_typetree()
    components={kind:objects[ptr['m_PathID']].read_typetree() for kind,ptr in go['m_Component']}
    transform=components[4]
    assert transform['m_LocalPosition']=={'x':0.,'y':0.,'z':0.}
    assert transform['m_LocalScale']=={'x':1.,'y':1.,'z':1.}
    assert transform['m_LocalRotation']=={'x':0.,'y':0.,'z':0.,'w':1.}
    meshID=components[33]['m_Mesh']['m_PathID']
    handler=MeshHandler(objects[meshID].read()); handler.process()
    positions=np.asarray(handler.m_Vertices)[:,:3]; positions[:,2]*=-1
    normals=np.asarray(handler.m_Normals)[:,:3]; normals[:,2]*=-1
    parts=[]
    for triangles,matptr in zip(handler.get_triangles(),components[23]['m_Materials']):
        mat=objects[matptr['m_PathID']].read_typetree()
        props=mat['m_SavedProperties']
        envs={k['name']:v for k,v in props['m_TexEnvs']}
        floats={k['name']:v for k,v in props['m_Floats']}
        tex=texture(objects,envs['_MainTex']['m_Texture']['m_PathID'])
        parts.append({'indices':np.asarray(triangles)[:,[0,2,1]].ravel().tolist(),'texture':tex['file'],'cutoff':floats.get('_Cutoff',0.35),'name':mat['m_Name']})
    name=f'tree-{len(models)}.json'
    # Tree Creator vertex colour alpha is baked ambient occlusion (shaders multiply albedo by it); RGB hold wind data.
    ao=(np.asarray(handler.m_Colors,dtype=np.float64)[:,3]/255).round(4)
    aabb=objects[meshID].read_typetree()['m_LocalAABB']
    bounds={'center':[aabb['m_Center']['x'],aabb['m_Center']['y'],-aabb['m_Center']['z']],'extent':[aabb['m_Extent'][a] for a in 'xyz']}
    save(name,{'positions':positions.ravel().tolist(),'normals':normals.ravel().tolist(),'uv':np.asarray(handler.m_UV0)[:,:2].ravel().tolist(),'ao':ao.tolist(),'bounds':bounds,'parts':parts})
    models.append({'name':go['m_Name'],'file':name,'meshPathID':meshID,'prefabPathID':pid,'bounds':bounds,'bendFactor':tree_rendering['treePrototypes'][len(models)]['bendFactor']})
layers=[]
for b, entries in [('texture.002',[(1755570237,60),(428779442,20)]),('texture.000',[(1908380835,10),(1496681545,4)])]:
    texs=bundle(b)
    for pid,tile in entries: layers.append({**texture(texs,pid),'tile':tile})
    del texs
alpha=texture(bundle('texture.005'),-1065133729)
assert max(errors)<0.005, 'Height validation failed'
manifest={'terrain':'rust_island_2013-2','terrainPathID':1737373048,'size':size,'extent':16000,'origin':[-7999.99951171875,0,-8000], 'conversion':'Unity X,Y,-Z; reversed triangle winding; PNG uses UnityPy image orientation', 'heightFile':'heights.f32','heightEncoding':'little-endian float32, Z rows / X columns, metres (sample / 32766 * 1500)','heightInterpolation':'Unity terrain triangles: each cell split along (x,z)-(x+1,z+1) (browser/terrain.mjs sampleTriangle)','layers':layers,'alpha':alpha,'models':models,'treeCount':len(placements),'treeRendering':tree_rendering,'heightValidation':{'samples':len(errors),'medianMetres':float(np.median(errors)),'maxMetres':max(errors)},'sourceSHA256':sources}
manifest['outputSHA256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.iterdir()) if p.is_file() and p.name!='manifest.json'}
manifest['sceneHierarchy']=hierarchy
manifest['origin']=origin.tolist()
save('manifest.json',manifest)
print(json.dumps(manifest,indent=2))
