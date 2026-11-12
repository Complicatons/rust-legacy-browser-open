"""Static export of the original deployable and structure prefabs (NGC ";" registry) with their placement rules,
plus the weapon assets the combat port needs (sounds, arrow/grenade/tracer/explosion prefabs).

Visual meshes come from the client bundles; the NGC registry from the server's ngcconfiguration bundle.
Per prefab: renderers and solid/trigger colliders relative to the root (Unity space, H applied in the browser),
plus the serialized data of gameplay components (DeployableObject, TakeDamage, FireBarrel/Furnace, LootableObject,
SleepingBag, WorkZone/HeatZone, MovingDoor, StructureComponent...). Data bundles only.
"""
import json,collections
from pathlib import Path
import numpy as np
from unity_common import ROOT,H,Bundles,Writer,identity,trs,token
from unity_armor import ArmorExport

CLIENT=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data',ROOT/'analysis/world-source/bundles']
import os
# RLB_EXPORT_OUT: write somewhere else first (e.g. to compare with the shared private copy before replacing it).
OUT=Path(os.environ['RLB_EXPORT_OUT']) if os.environ.get('RLB_EXPORT_OUT') else ROOT/'browser/assets/recovered/deployables'
OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
b=Bundles(CLIENT,['gameobject.000.unity3d','gameobject.001.unity3d','scriptableobject.000.unity3d','sharedassets0.assets','ngcconfiguration.000.unity3d'])
writer=Writer(b,OUT);issues=collections.Counter();armor=ArmorExport(b,writer)
items=json.loads((ROOT/'browser/assets/recovered/items/manifest.json').read_text())['items']
ngc_asset=next(a for a in b.assets.values() if a.name.lower().startswith('cab-ngcconfiguration'))
registry={e['name']:e for o in ngc_asset.objects.values() if o.type.name=='MonoBehaviour' for d in [o.read_typetree()] if 'entries' in d for e in d['entries']}
go_bundle=b.asset('cab-gameobject.000');ab=next(o.read_typetree() for o in go_bundle.objects.values() if o.type.name=='AssetBundle')
container=collections.defaultdict(list)
for k,v in ab['m_Container']:container[k.lower()].append(v)

def root_of(path):
    """AssetBundle containers list several objects per path; the prefab is the GameObject whose transform has no parent."""
    for v in container.get(path.lower(),[]):
        o=b.resolve(go_bundle,v['asset'])
        if o is None or o.type.name!='GameObject':continue
        t=b.components(o.assets_file,o.read_typetree()).get('Transform',[None])[0]
        if t is not None and not t.read_typetree()['m_Father']['m_PathID']:return o
    return None

KEEP={'DeployableObject','DeployedRespawn','SleepingBag','Bed','TakeDamage','ProtectionTakeDamage','StructureComponentTakeDamage','FireBarrel','Furnace','LootableObject','CampfireInventory','SaveableInventory',
      'WorkZone','HeatZone','MovingDoor','BasicDoor','RepairBench','WorkBench','StructureComponent','StructureMaster','Hardpoint','HardpointMaster','ArrowMovement','TimedGrenade','SignalGrenade','FlareObj','Tracer','SurfaceInfo','Rigidbody','RigidbodyInterpolator','SpikeWall','TimedExplosive','PasswordLockableObject','EnvDecay','TransCarrier','SleepingAvatar','ItemRepresentation','MuzzleFlash','ItemPickup','DeployableCorpse','RepairReceiver'}
def finite(v):
    """JSON has no Infinity/NaN (e.g. DeployedRespawn.lastSpawnTime = -Infinity); write them as null."""
    if isinstance(v,float) and not np.isfinite(v):return None
    if isinstance(v,dict):return {k:finite(x) for k,x in v.items()}
    if isinstance(v,list):return [finite(x) for x in v]
    return v
def plain(d):
    """Serialized fields minus Unity plumbing; object pointers are kept as {m_FileID, m_PathID}."""
    return finite({k:v for k,v in d.items() if k not in ('m_Script','m_GameObject','m_Enabled','m_Name')})

sounds={}
def sound(owner,ptr):
    """AudioClip referenced by a component field (MovingDoor open/close sounds, fire AudioSource loop)."""
    if not ptr or not ptr.get('m_PathID'):return None
    obj=b.resolve(owner,ptr)
    if obj is None:issues['missing audio clip']+=1;return None
    key=identity(obj)
    if key not in sounds:
        clip=obj.read();(name,data),=clip.samples.items()
        filename='sound-'+token(key)+'.'+name.rsplit('.',1)[-1];(OUT/filename).write_bytes(data);sounds[key]={'file':filename,'name':clip.m_Name}
    return sounds[key]['file']

prefabs={};surfaces={}
def surface(owner,ptr):
    obj=b.resolve(owner,ptr) if ptr and ptr.get('m_PathID') else None
    if obj is None:return None
    key=identity(obj)
    if key not in surfaces:
        d=obj.read_typetree();surfaces[key]={'name':d.get('m_Name'),'bulletEffects':[],'meleeEffects':[]}
        for field in ('bulletEffects','meleeEffects'):
            surfaces[key][field]=[prefab_ptr(obj.assets_file,p) for p in d.get(field,[])]
    return key
def prefab(name):
    if name in prefabs:return name
    entry=registry.get(name.lstrip(';'))
    if not entry:issues['unregistered '+name]+=1;return None
    root=root_of(entry['path'])
    if root is None:issues['no root '+name]+=1;return None
    return prefab_root(name,root,entry['path'])
def prefab_ptr(owner,ptr):
    """A prefab referenced directly by a GameObject pointer (arrows, thrown grenades, tracers, explosion effects)."""
    if not ptr or not ptr.get('m_PathID'):return None
    go=b.resolve(owner,ptr)
    if go is None or go.type.name!='GameObject':issues['missing prefab pointer']+=1;return None
    key='obj:'+identity(go)
    return key if key in prefabs else prefab_root(key,go,None)
def prefab_root(name,root,path):
    prefabs[name]=None
    owner=root.assets_file;nodes=[];renderers=[];colliders=[];components=collections.defaultdict(list)
    root_cs=b.components(owner,root.read_typetree());sleep_filters={}
    if 'SleepingAvatar' in root_cs:
        sd=root_cs['SleepingAvatar'][0].read_typetree()
        sleep_filters={sd[field]['m_PathID']:slot for field,slot in [('footMeshFilter','feet'),('legMeshFilter','legs'),('torsoMeshFilter','torso'),('headMeshFilter','head')]}
    def walk(t_obj,parent,rel,active):
        t=t_obj.read_typetree();g=b.resolve(owner,t['m_GameObject']).read_typetree();cs=b.components(owner,g)
        i=len(nodes);on=active and bool(g['m_IsActive'])
        nodes.append({'name':g['m_Name'],'parent':parent,'layer':g['m_Layer'],'tag':g['m_Tag'],'active':on,'position':[t['m_LocalPosition'][k] for k in 'xyz'],'rotation':[t['m_LocalRotation'][k] for k in 'xyzw'],'scale':[t['m_LocalScale'][k] for k in 'xyz'],'matrix':(H@rel@H).T.ravel().tolist()})
        for kind,objs in cs.items():
            for o in objs:
                d=o.read_typetree()
                if kind=='MeshFilter':
                    r=next(iter(cs.get('MeshRenderer',[])),None)
                    if r is None or not on:continue
                    rd=r.read_typetree();slot=sleep_filters.get(o.path_id)
                    if not rd['m_Enabled']:continue
                    if slot:
                        model=armor.resolve(slot);mesh=model['sleepMesh'];materials=model['materials']
                    else:
                        m=b.resolve(owner,d['m_Mesh'])
                        if m is None:continue
                        mesh=writer.mesh(m);materials=[writer.material(b.resolve(owner,p)) for p in rd['m_Materials']]
                    renderers.append({'node':i,'name':g['m_Name'],'layer':g['m_Layer'],'mesh':mesh,'materials':materials,'armorSlot':slot,'matrix':(H@rel@H).T.ravel().tolist()})
                elif kind in ('BoxCollider','SphereCollider','CapsuleCollider','MeshCollider'):
                    if not d['m_Enabled'] or not on:continue
                    c={'node':i,'type':kind,'name':g['m_Name'],'layer':g['m_Layer'],'trigger':bool(d['m_IsTrigger']),'matrix':(H@rel@H).T.ravel().tolist()}
                    if 'm_Center' in d:c['center']=[d['m_Center']['x'],d['m_Center']['y'],-d['m_Center']['z']]
                    if kind=='BoxCollider':c['size']=[d['m_Size'][k] for k in 'xyz']
                    if kind in ('SphereCollider','CapsuleCollider'):c['radius']=d['m_Radius']
                    if kind=='CapsuleCollider':c.update(height=d['m_Height'],direction=d['m_Direction'])
                    pm=b.resolve(owner,d['m_Material']) if d.get('m_Material',{}).get('m_PathID') else None
                    if pm is not None:
                        md=pm.read_typetree();c['physicMaterial']={k:md.get(k) for k in ('dynamicFriction','staticFriction','bounciness','frictionCombine','bounceCombine')}
                    if kind=='MeshCollider':
                        m=b.resolve(owner,d['m_Mesh'])
                        if m is None:issues['null collider mesh']+=1;continue
                        c['mesh']=writer.mesh(m)
                    colliders.append(c)
                elif kind in KEEP:
                    entry={'node':i,'data':plain(d)}
                    if kind=='MovingDoor':entry['sounds']={k:sound(owner,d[k+'Sound']) for k in ('open','opened','close','closed')}
                    # Explosives: their explosion effect prefab and tick/bounce sounds.
                    if kind in ('TimedExplosive','TimedGrenade','SignalGrenade'):
                        entry['explosion']=prefab_ptr(owner,d.get('explosionEffect'))
                        entry['sounds']={k:sound(owner,d[k]) for k in ('tickSound','bounceSound') if k in d}
                    # DeployableObject.Client_OnKilled instantiates clientDeathEffect for 5 s.
                    # DeployableObject.OnKilled (handleDeathHere) also instantiates corpseObject (a DeployableCorpse, 300 s).
                    if kind in ('DeployableObject','DeployedRespawn','SleepingBag','Bed'):entry['deathEffect']=prefab_ptr(owner,d.get('clientDeathEffect'));entry['corpse']=prefab_ptr(owner,d.get('corpseObject'))
                    # StructureComponent.ClientKilled instantiates deathEffect for 5 s.
                    if kind=='StructureComponent':entry['deathEffect']=prefab_ptr(owner,d.get('deathEffect'))
                    if kind=='FlareObj':entry['light']=prefab_ptr(owner,d.get('lightPrefab'))
                    if kind=='Tracer':
                        entry['effects']={k:prefab_ptr(owner,d.get(k)) for k in ('impactPrefab','fleshImpactPrefab','decalPrefab','bloodDecalPrefab')}
                        entry['sounds']={k:[sound(owner,p) for p in d.get(k,[])] for k in ('impactSounds','bodyImpactSounds')}
                    if kind=='SurfaceInfo':entry['surface']=surface(owner,d.get('surface'))
                    # ResourceTypeItemDataBlock.UseItem repairs with RepairReceiver.repairAmmo (an item datablock key).
                    if kind=='RepairReceiver':r=b.resolve(owner,d['repairAmmo']) if d.get('repairAmmo',{}).get('m_PathID') else None;entry['repairAmmo']=identity(r) if r is not None else None
                    components[kind].append(entry)
                # SurfaceInfoObject impact effects play one random clip of their AudioClipArray on Start (EffectSoundPlayer).
                elif kind=='EffectSoundPlayer':
                    arr=b.resolve(owner,d['sounds']) if d.get('sounds',{}).get('m_PathID') else None
                    components[kind].append({'node':i,'enabled':bool(d.get('m_Enabled',1)),'sounds':[sound(arr.assets_file,c) for c in arr.read_typetree()['_array']] if arr else []})
                elif kind=='AudioSource':components[kind].append({'node':i,'enabled':bool(d['m_Enabled']),'clip':sound(owner,d['m_audioClip']),'data':{k:d[k] for k in ('m_Volume','m_Pitch','Loop','m_PlayOnAwake','MinDistance','MaxDistance','rolloffMode') if k in d}})
                # FireBarrel.fireLight and its legacy particle emitters (flames, smoke, sparks), toggled with the fire.
                # ParticleSystem path ids let the browser resolve SubModule sub-emitter pointers (same serialized file).
                elif kind in ('Light','ParticleSystem','ContextSprite'):components[kind].append({'node':i,'enabled':bool(d.get('m_Enabled',1)),'data':plain(d),**({'id':o.path_id} if kind=='ParticleSystem' else {})})
                elif kind=='ParticleSystemRenderer':
                    mats=[writer.material(b.resolve(owner,p)) for p in d['m_Materials'] if p['m_PathID']]
                    components[kind].append({'node':i,'enabled':bool(d['m_Enabled']),'materials':mats,'data':plain({k:v for k,v in d.items() if k!='m_Materials'})})
        for c in t['m_Children']:
            ct=b.resolve(owner,c);walk(ct,i,rel@trs(ct.read_typetree()),on)
    walk(b.components(owner,root.read_typetree())['Transform'][0],-1,np.eye(4),True)
    root_t=b.components(owner,root.read_typetree())['Transform'][0].read_typetree()
    prefabs[name]={'name':nodes[0]['name'],'ngcName':name,'path':path,'source':identity(root),'rootScale':root_t['m_LocalScale'],'rootLocalRotation':root_t['m_LocalRotation'],'rootLocalPosition':root_t['m_LocalPosition'],
        'nodes':nodes,'renderers':renderers,'colliders':colliders,'components':dict(components)}
    return name

def fit_requirements(owner,ptr):
    obj=b.resolve(owner,ptr) if ptr and ptr['m_PathID'] else None
    if obj is None:return None
    d=obj.read_typetree()
    # Condition colours carry vectors: flt0 = center/capStart (+a distance), flt1 = direction (+a radius), flt2 = capEnd.
    return {'name':d['m_Name'],'conditions':[{'instruction':c['instruction'],'flt0':c['flt0'],'flt1':c['flt1'],'flt2':c['flt2'],'mask':c['mask']['m_Bits'],'passOnFail':bool(c.get('failPass',0))} for c in d['Conditions']]}

PLACE_FIELDS=['uprightOnly','orientationMode','CanStackOnDeployables','minCastRadius','StructureOnly','TerrainOnly','spacingRadius','placeRange','requireHardpoint','hardpointType','checkPlacementZones','forcePlaceable','neverGrabCarrier','carrierSphereCastMode','fitTestForcedUp']
deployables={};structures={}
objects={}
for a in list(b.assets.values()):
    for o in a.objects.values():
        if o.type.name!='MonoBehaviour':continue
        try:d=o.read_typetree()
        except Exception:continue
        if '_uniqueID' in d and ('DeployableObjectPrefabName' in d or 'structureToPlaceName' in d):objects[d['m_Name']]=(o,d)
for key,item in items.items():
    d=item['data'];name=d['m_Name']
    if item['class'] in ('DeployableItemDataBlock','DeployableInventoryDataBlock'):
        o,sd=objects.get(name,(None,d))
        deployables[key]={'item':name,'class':item['class'],'prefab':prefab(d['DeployableObjectPrefabName']),'placement':{k:d.get(k) for k in PLACE_FIELDS},
            'fitRequirements':fit_requirements(o.assets_file,sd.get('fitRequirements')) if o else None}
    elif item['class']=='StructureComponentDataBlock':
        structures[key]={'item':name,'prefab':prefab(d['structureToPlaceName'])}
# Weapons: sounds and projectile/effect prefabs referenced by the item datablocks.
WEAPON_SOUNDS=['fireSound','fireSound_Far','reloadSound','headshotSound','fireSound_Silenced','fireSound_SilencedFar','dryFireSound','drawArrowSound','fireArrowSound','cancelArrowSound','pullPinSound','swingSound','impactSoundWood','StrikeSound']
# MeleeWeaponDataBlock.DoMeleeEffects instantiates impactEffectWood (WoodImpact) on a "Tree Collider" hit.
WEAPON_PREFABS=['tracerPrefab','arrowPrefab','throwObjectPrefab','FirstPersonLightPrefab','ThirdPersonLightPrefab','muzzleflashVM','muzzleFlashWorld','impactEffectWood']
# The Uber Hatchet / Uber Hunting Bow datablocks live in cab-datablock.000 (items manifest keys 'cab-datablock.000:...'):
# load it after the deployable scan so their weapon assets and _itemRepPrefab held representations are exported too.
b.load(b.find('datablock.000.unity3d'))
by_uid={}
for a in list(b.assets.values()):
    for o in a.objects.values():
        if o.type.name!='MonoBehaviour':continue
        try:d=o.read_typetree()
        except Exception:continue
        if '_uniqueID' in d:by_uid[d['_uniqueID']]=(o,d)
weapons={}
for key,item in items.items():
    if not any(t in item['class'] for t in ('BulletWeapon','Shotgun','StrikeGun','Bow','HandGrenade','MeleeWeapon','Torch')):continue
    o,d=by_uid.get(item['data']['_uniqueID'],(None,None))
    if o is None:issues['weapon datablock not found '+item['data']['m_Name']]+=1;continue
    weapons[key]={'item':item['data']['m_Name'],'class':item['class'],'sounds':{k:sound(o.assets_file,d[k]) for k in WEAPON_SOUNDS if k in d},'prefabs':{k:prefab_ptr(o.assets_file,d[k]) for k in WEAPON_PREFABS if k in d}}
    # StrikeGunDataBlock (HandCannon): one clip per strike count (Local_BeginStrikes plays strikeSounds[n-1]).
    if 'strikeSounds' in d:weapons[key]['strikeSounds']=[sound(o.assets_file,p) for p in d['strikeSounds']]
# ItemDataBlock.OnItemEvent (Inventory.CLEV): equipped/unequipped/combined/used clips of every item that has one.
ITEM_EVENT_SOUNDS=['equippedSound','unEquippedSound','combinedSound','UsedSound']
item_sounds={}
for key,item in items.items():
    o,d=by_uid.get(item['data']['_uniqueID'],(None,None))
    if o is None:continue
    clips={k:sound(o.assets_file,d.get(k)) for k in ITEM_EVENT_SOUNDS}
    if any(clips.values()):item_sounds[key]=clips
for extra in [';drop_lootsack',';drop_lootsack_zombie',';sleeper_male']:prefab(extra)
# ResourceObject.modelindex instantiates clientMeshChangeEffect (Ore_Death / WoodPile_Death) at the node for 5 s.
resource_effects={}
for handle in [';res_woodpile',';res_ore_1',';res_ore_2',';res_ore_3']:
    entry=registry.get(handle.lstrip(';'));root=root_of(entry['path']) if entry else None
    ro=b.components(root.assets_file,root.read_typetree()).get('ResourceObject') if root is not None else None
    if not ro:issues['no ResourceObject '+handle]+=1;continue
    resource_effects[handle]=prefab_ptr(root.assets_file,ro[0].read_typetree().get('clientMeshChangeEffect'))
# HeldItemDataBlock._itemRepPrefab points to a component, not a GameObject. Export all representations,
# with the native hand socket measured relative to their root (ItemRepresentation.CheckParent).
def socket_matrix(socket,owner,root_t):
    x,y,z=np.radians([socket['eulerRotate'][k] for k in 'xyz']);cx,sx=np.cos(x),np.sin(x);cy,sy=np.cos(y),np.sin(y);cz,sz=np.cos(z),np.sin(z)
    hm=np.eye(4);hm[:3,:3]=np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]])@np.array([[1,0,0],[0,cx,-sx],[0,sx,cx]])@np.array([[cz,-sz,0],[sz,cz,0],[0,0,1]]);hm[:3,3]=[socket['offset'][k] for k in 'xyz']
    parent=b.resolve(owner,socket['parent'])
    if parent is not None and parent.path_id!=root_t.path_id:
        hm=trs(parent.read_typetree());t=parent.read_typetree()
        while t['m_Father']['m_PathID'] and t['m_Father']['m_PathID']!=root_t.path_id:
            parent=b.resolve(parent.assets_file,t['m_Father']);t=parent.read_typetree();hm=trs(t)@hm
    return hm.T.ravel().tolist()
held={}
for key,item in items.items():
    o,d=by_uid.get(item['data']['_uniqueID'],(None,None))
    if o is None or not d.get('_itemRepPrefab',{}).get('m_PathID'):continue
    rep=b.resolve(o.assets_file,d['_itemRepPrefab']);rd=rep.read_typetree();root=b.resolve(rep.assets_file,rd['m_GameObject']);root_t=b.components(root.assets_file,root.read_typetree())['Transform'][0]
    pk='obj:'+identity(root)
    if pk not in prefabs:prefab_root(pk,root,None)
    held[key]={'item':item['data']['m_Name'],'uid':item['data']['_uniqueID'],'prefab':pk,'netName':root.read_typetree()['m_Name'],'handMatrix':socket_matrix(rd['hand'],rep.assets_file,root_t),'muzzleMatrix':socket_matrix(rd['muzzle'],rep.assets_file,root_t),'animationGroup':d.get('animationGroupName')}
default_surface=None
for asset in list(b.assets.values()):
    for entry in list(asset.objects.values()):
        if entry.type.name!='AssetBundle':continue
        for path,value in entry.read_typetree()['m_Container']:
            if path.lower()!='rust/effects/impact/default':continue
            obj=b.resolve(asset,value['asset'])
            if obj is not None and obj.type.name=='MonoBehaviour' and 'bulletEffects' in obj.read_typetree():
                default_surface=surface(asset,value['asset'])
if default_surface is None:issues['default SurfaceInfoObject not found']+=1
# SurfaceInfo.GetSurfaceInfoFor: explicit component on the collider GO or its IDMain,
# otherwise native default. The client island scene has only SurfaceInfoTerrain.
b.load(b.find('scenes.unity3d'))
surface_routes={'actors':{},'scene':{},'terrain':None}
for asset in list(b.assets.values()):
    for obj in list(asset.objects.values()):
        if obj.type.name!='MonoBehaviour':continue
        try:d=obj.read_typetree()
        except ValueError:
            header=obj.read_typetree(check_read=False)
            if b.script(obj,header) in ('SurfaceInfo','SurfaceInfoTerrain'):raise
            continue # Unrelated scene scripts may carry only the engine header typetree.
        kind=b.script(obj,d)
        if kind not in ('SurfaceInfo','SurfaceInfoTerrain'):continue
        go=b.resolve(asset,d['m_GameObject']);gd=go.read_typetree()
        if kind=='SurfaceInfo':
            sid=surface(asset,d.get('surface'))
            if asset.name.lower().startswith('buildplayer-'):surface_routes['scene'][str(go.path_id)]=sid
            else:
                old=surface_routes['actors'].get(gd['m_Name'])
                if old is not None and old!=sid:raise ValueError('Ambiguous surface name '+gd['m_Name'])
                surface_routes['actors'][gd['m_Name']]=sid
        else:
            cs=b.components(asset,gd);td=b.resolve(asset,cs['Terrain'][0].read_typetree()['m_TerrainData']);terrain=td.read_typetree()
            alpha=terrain['m_SplatDatabase']['m_AlphaTextures']
            if len(alpha)!=1:raise ValueError('Terrain surface export expects the shipped four-channel splat map')
            texture=b.resolve(td.assets_file,alpha[0]);image=texture.read().image.convert('RGBA')
            # Unity texture UV(0,0) is the bottom row of UnityPy's saved PNG.
            rgba=np.asarray(image)[::-1]
            dominant=np.argmax(rgba,axis=2).astype('u1') # OLD_GetMainTexture uses strict >: first channel wins ties.
            filename='terrain-surfaces.u8';(OUT/filename).write_bytes(dominant.tobytes())
            transform=cs['Transform'][0];world=trs(transform.read_typetree());parent=transform.read_typetree()['m_Father']
            while parent['m_PathID']:
                transform=b.resolve(transform.assets_file,parent);tr=transform.read_typetree();world=trs(tr)@world;parent=tr['m_Father']
            if not np.allclose(world[:3,:3],np.eye(3)):raise ValueError('Rotated/scaled terrain requires a transformed surface lookup')
            heightmap=terrain['m_Heightmap'];extent=[heightmap['m_Scale']['x']*(heightmap['m_Width']-1),heightmap['m_Scale']['z']*(heightmap['m_Height']-1)]
            surface_routes['terrain']={'width':image.width,'height':image.height,'file':filename,'surfaces':[surface(asset,p) for p in d['surfaces']],
                'origin':world[:3,3].tolist(),'extent':extent,'terrainSource':identity(td),'alphaSource':identity(texture),'encoding':'Unity +Z rows / +X columns; dominant RGBA, first maximum wins'}
so=b.asset('cab-scriptableobject.000')
drop_trait=next(o for o in so.objects.values() if o.type.name=='MonoBehaviour' and b.script(o,o.read_typetree())=='CharacterItemDropPrefabTrait')
pickup_ptr=drop_trait.read_typetree()['_prefab'];pickup=prefab_ptr(so,pickup_ptr);pickup_go=b.resolve(so,pickup_ptr);pickup_cs=b.components(pickup_go.assets_file,pickup_go.read_typetree())
if len(pickup_cs.get('Rigidbody',[]))!=1:raise ValueError('Unexpected native pickup rigid bodies')
pickup_physics={'body':plain(pickup_cs['Rigidbody'][0].read_typetree()),'colliders':[]}
for kind in ('BoxCollider','SphereCollider','CapsuleCollider'):
    for obj in pickup_cs.get(kind,[]):
        d=obj.read_typetree();material=b.resolve(obj.assets_file,d['m_Material'])
        pickup_physics['colliders'].append({'type':kind,'data':{k:v for k,v in d.items() if k not in ('m_GameObject','m_Material')},'material':material.read_typetree() if material else None})
writer.finish({'resourceEffects':resource_effects,'pickup':pickup,'pickupPhysics':pickup_physics,'sounds':sounds,'surfaces':surfaces,'defaultSurface':default_surface,'surfaceRoutes':surface_routes,'deployables':deployables,'structures':structures,'weapons':weapons,'itemSounds':item_sounds,'held':held,'prefabs':prefabs,'armor':armor.manifest(),'summary':dict(issues),
    'conversion':'Node/renderer/collider matrices are H*relative*H to the prefab root (root TRS excluded except rootScale); node position/rotation/scale are raw Unity locals.'})
print(json.dumps({'deployables':{v['item']:{'prefab':v['prefab'],'components':sorted(prefabs[v['prefab']]['components']) if v['prefab'] else None,'fit':bool(v['fitRequirements'])} for v in deployables.values()},
 'structures':{v['item']:v['prefab'] for v in structures.values()},'weapons':{v['item']:{'sounds':sorted(k for k,x in v['sounds'].items() if x),'prefabs':v['prefabs']} for v in weapons.values()},'issues':dict(issues)},indent=1))
