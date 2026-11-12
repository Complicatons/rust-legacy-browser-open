"""Static scene import: data bundles only, no target assembly loading.

Visible geometry comes from the CLIENT copy of the island scene (9,292 objects; the server build strips
client-only content such as the overlay rock formations). Solid colliders, doors and their sounds come
from the authoritative SERVER scene. The two builds do not share object path IDs, so doors are linked to
their client meshes by object name and world position.
"""
import json,collections,os
from pathlib import Path
from unity_common import ROOT,H,Bundles,Writer,identity,trs
import numpy as np

SERVER=ROOT/'analysis/world-source/bundles'
CLIENT=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data']
# The shared recovered folder is used by every session: export into RLB_EXPORT_OUT and copy only what changed.
OUT=Path(os.environ['RLB_EXPORT_OUT']) if os.environ.get('RLB_EXPORT_OUT') else ROOT/'browser/assets/recovered/scene'
OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
client=Bundles(CLIENT,['scenes.unity3d']);server=Bundles(SERVER,['scenes.unity3d'])
writer=Writer(client,OUT);server_writer=Writer(server,OUT,namespace='server:');issues=collections.Counter()

class Scene:
    def __init__(self,bundles):
        self.b=bundles;self.a=bundles.asset('buildplayer-rust_island_2013');self.gos={};self.transforms={};self.filters={};self.renderers={};self.cache={};self.active_cache={}
        for obj in self.a.objects.values():
            kind=obj.type.name
            if kind not in ['GameObject','Transform','MeshFilter','MeshRenderer']:continue
            d=obj.read_typetree()
            if kind=='GameObject':self.gos[obj.path_id]=d
            elif kind=='Transform':self.transforms[obj.path_id]=d
            elif kind=='MeshFilter':self.filters[d['m_GameObject']['m_PathID']]=d
            else:self.renderers[d['m_GameObject']['m_PathID']]=d
        self.go_transform={t['m_GameObject']['m_PathID']:pid for pid,t in self.transforms.items()}
    def world(self,pid):
        if not pid:return np.eye(4)
        if pid not in self.cache:self.cache[pid]=self.world(self.transforms[pid]['m_Father']['m_PathID'])@trs(self.transforms[pid])
        return self.cache[pid]
    def active(self,pid):
        if not pid:return True
        if pid not in self.active_cache:t=self.transforms[pid];self.active_cache[pid]=self.gos[t['m_GameObject']['m_PathID']]['m_IsActive'] and self.active(t['m_Father']['m_PathID'])
        return self.active_cache[pid]
cs=Scene(client);ss=Scene(server)

# Visible instances from the client scene.
instances=[];skipped=[];inactive=[]
for goid,f in cs.filters.items():
    go=cs.gos[goid];tid=cs.go_transform[goid];renderer=cs.renderers.get(goid)
    if not cs.active(tid) or not renderer or not renderer['m_Enabled']:
        issues['inactive or disabled']+=1;inactive.append({'name':go['m_Name'],'gameObjectPathID':goid,'activeHierarchy':bool(cs.active(tid)),'rendererEnabled':bool(renderer and renderer['m_Enabled'])});continue
    try:
        obj=client.resolve(cs.a,f['m_Mesh'])
        if obj is None:raise ValueError('Null mesh')
        mesh_key=writer.mesh(obj)
        mats=[writer.material(client.resolve(cs.a,p)) for p in renderer['m_Materials']]
        subsets=renderer['m_SubsetIndices'] or list(range(len(writer.meshes[mesh_key]['parts'])))
        if len(mats)!=len(subsets):raise ValueError('Submesh/material count mismatch')
        # Unity static batching bakes vertices into the batch root space (world if no root).
        batch=bool(renderer['m_SubsetIndices'])
        matrix=H@cs.world(renderer['m_StaticBatchRoot']['m_PathID'] if batch else tid)@H
        md=writer.meshes[mesh_key]
        if any(i<0 or i>=len(md['parts']) for i in subsets):raise ValueError('Unsupported static batch subsets')
        vertices=np.fromfile(OUT/md['position']['file'],dtype='<f4').reshape(-1,3)
        ids=np.concatenate([np.fromfile(OUT/md['parts'][i]['file'],dtype='<u4') for i in subsets])
        used=vertices[np.unique(ids)]@matrix[:3,:3].T+matrix[:3,3]
        instances.append({'name':go['m_Name'],'gameObjectPathID':goid,'transformPathID':tid,'layer':go['m_Layer'],'mesh':mesh_key,'materials':mats,'subsets':subsets,'matrix':matrix.T.ravel().tolist(),
            'worldBounds':[used.min(axis=0).tolist(),used.max(axis=0).tolist()],'sourceWorldPosition':(H@cs.world(tid))[:3,3].tolist(),'staticBatch':batch})
    except Exception as exc:
        issues[str(exc)]+=1;skipped.append({'name':go['m_Name'],'gameObjectPathID':goid,'reason':str(exc)})

# Solid colliders from the server scene (authoritative physics).
colliders=[];collision_omissions=[]
for obj in ss.a.objects.values():
    kind=obj.type.name
    if kind not in ['MeshCollider','BoxCollider','SphereCollider','CapsuleCollider']:continue
    d=obj.read_typetree();goid=d['m_GameObject']['m_PathID'];tid=ss.go_transform[goid]
    if not ss.active(tid) or not d['m_Enabled'] or d['m_IsTrigger']:continue
    entry={'type':kind,'name':ss.gos[goid]['m_Name'],'pathID':obj.path_id,'gameObjectPathID':goid,'layer':ss.gos[goid]['m_Layer'],'matrix':(H@ss.world(tid)@H).T.ravel().tolist()}
    try:
        if kind=='MeshCollider':
            target=server.resolve(ss.a,d['m_Mesh'])
            if target is None:raise ValueError('Null original collision mesh; no visual-mesh substitution')
            entry.update(mesh=server_writer.mesh(target),convex=d['m_Convex'])
        else:
            entry['center']=[d['m_Center']['x'],d['m_Center']['y'],-d['m_Center']['z']]
            if kind=='BoxCollider':entry['size']=[d['m_Size'][k] for k in 'xyz']
            else:entry['radius']=d['m_Radius']
            if kind=='CapsuleCollider':entry.update(height=d['m_Height'],direction=d['m_Direction'])
        colliders.append(entry)
    except Exception as exc:collision_omissions.append({**entry,'reason':str(exc)})

# Original MovingDoor components (decompiled BasicDoor/MovingDoor define their runtime use of these fields).
sounds={}
def subtree(scene,tid):
    out=[scene.transforms[tid]['m_GameObject']['m_PathID']]
    for c in scene.transforms[tid]['m_Children']:out+=subtree(scene,c['m_PathID'])
    return out
def sound(ptr):
    obj=server.resolve(ss.a,ptr)
    if obj is None:return None
    key=identity(obj)
    if key not in sounds:
        clip=obj.read();(name,data),=clip.samples.items()
        filename='sound-'+key.replace(':','_').replace('-','m')+'.'+name.rsplit('.',1)[-1];(OUT/filename).write_bytes(data)
        sounds[key]={'file':filename,'name':clip.m_Name,'source':key}
    return sounds[key]['file']
DOOR_FIELDS=['startConfig','durationOpen','durationClose','textOpen','textClose','pointTextPointOpened','pointTextPointClosed','minimumTimeBetweenOpenClose','closedPositionPivot','openMovement','rotationAxis','rotationCross','degrees','rotationFirst','smooth','movementABS','rotationABS','slerpMovementByDegrees']
doors=[];door_omissions=[];manual_views={}
for obj in ss.a.objects.values():
    if obj.type.name!='MonoBehaviour':continue
    d=obj.read_typetree();script=server.script(obj,d)
    # BasicDoor.Awake: a door whose own networkView has a manual view ID is a static door; the server sends its DOc/DOo
    # on that view (uLink.NetworkView._manualViewID), which is how the gateway follows it (bridge/line-of-sight.mjs).
    if script=='uLinkNetworkView' and isinstance(d.get('_manualViewID'),int) and d['_manualViewID']>0:manual_views[d['m_GameObject']['m_PathID']]=d['_manualViewID']
    if script!='MovingDoor':continue
    goid=d['m_GameObject']['m_PathID'];tid=ss.go_transform[goid];t=ss.transforms[tid]
    if not ss.active(tid) or not d['m_Enabled']:door_omissions.append({'name':ss.gos[goid]['m_Name'],'gameObjectPathID':goid,'reason':'inactive or disabled'});continue
    try:door_sounds={k:sound(d[k+'Sound']) for k in ['open','opened','close','closed']}
    except Exception as exc:door_sounds={};issues['door sound: '+str(exc)]+=1
    doors.append({'name':ss.gos[goid]['m_Name'],'pathID':obj.path_id,'gameObjectPathID':goid,'transformPathID':tid,'subtree':subtree(ss,tid),
        'worldPosition':(H@ss.world(tid))[:3,3].tolist(),
        # Parent world matrix in browser space; local TRS stays in Unity space for the original door maths.
        'parentMatrix':(H@ss.world(t['m_Father']['m_PathID'])@H).T.ravel().tolist(),
        'localPosition':t['m_LocalPosition'],'localRotation':t['m_LocalRotation'],'localScale':t['m_LocalScale'],
        'settings':{k:d[k] for k in DOOR_FIELDS},'sounds':door_sounds})
for door in doors:
    if door['gameObjectPathID'] in manual_views:door['viewID']=manual_views[door['gameObjectPathID']]
    else:issues['door without a manual view ID']+=1
# Server colliders link by path ID; client visuals link by name and world position (builds differ in IDs).
door_of={g:i for i,door in enumerate(doors) for g in door['subtree']}
for c in colliders:
    if c['gameObjectPathID'] in door_of:c['door']=door_of[c['gameObjectPathID']]
for i,door in enumerate(doors):
    matches=[x for x in instances if not x['staticBatch'] and x['name']==door['name'] and np.linalg.norm(np.subtract(x['sourceWorldPosition'],door['worldPosition']))<0.05]
    if len(matches)!=1:issues[f'door visual matches {len(matches)}']+=1;continue
    tid=matches[0]['transformPathID'];door['clientGameObjectPathID']=matches[0]['gameObjectPathID']
    for x in instances:
        if x['transformPathID'] in [cs.go_transform[g] for g in subtree(cs,tid)]:x['door']=i

# WaterLine.Height (animals below it are killed) and SpawnManager child transforms (player spawns), server scene.
world_info={'waterLine':None,'spawnPoints':[],'noPlacementZones':[],'radiationZones':[],'tod':None}
for obj in ss.a.objects.values():
    if obj.type.name!='MonoBehaviour':continue
    d=obj.read_typetree();kind=server.script(obj,d)
    if kind not in ('WaterLine','SpawnManager','NoPlacementZone','RadiationZone','TOD_Sky'):continue
    tid=ss.go_transform[d['m_GameObject']['m_PathID']]
    if kind=='WaterLine':world_info['waterLine']=float(ss.world(tid)[1,3])
    # RadiationZone: exposurePerMin (scaled down to 0 at radius when strongerAtCenter) for characters inside its trigger sphere.
    elif kind=='RadiationZone':
        if ss.active(tid) and d['m_Enabled']:world_info['radiationZones'].append({'position':(H@ss.world(tid))[:3,3].tolist(),'radius':d['radius'],'exposurePerMin':d['exposurePerMin'],'strongerAtCenter':bool(d['strongerAtCenter'])})
    # TOD_Sky (server copy decides IsNight): cycle, day/night/light/atmosphere parameters and the dome's world rotation.
    elif kind=='TOD_Sky':
        w=ss.world(tid);world_info['tod']={k:d[k] for k in ('Cycle','Day','Night','Light','Atmosphere','World','Clouds') if k in d}
        rotation=w[:3,:3]/np.linalg.norm(w[:3,:3],axis=0)
        world_info['tod']['domeRotation']=rotation.T.ravel().tolist();world_info['tod']['active']=bool(ss.active(tid) and d['m_Enabled'])
    # NoPlacementZone.ValidPos: deployables may not be placed within transform.localScale.x of the zone origin.
    elif kind=='NoPlacementZone':
        if ss.active(tid) and d['m_Enabled']:world_info['noPlacementZones'].append({'position':(H@ss.world(tid))[:3,3].tolist(),'radius':ss.transforms[tid]['m_LocalScale']['x']})
    else:
        for c in ss.transforms[tid]['m_Children']:
            m=H@ss.world(c['m_PathID'])@H;world_info['spawnPoints'].append({'position':(H@ss.world(c['m_PathID']))[:3,3].tolist(),'matrix':m.T.ravel().tolist()})
manifest={'world':world_info,'instances':instances,'sounds':sounds,'doors':doors,'doorOmissions':door_omissions,'skipped':skipped,'inactive':inactive,'colliders':colliders,'collisionOmissions':collision_omissions,'summary':dict(issues),
 'visualSource':'client scenes.unity3d','colliderSource':'server scenes.unity3d',
 'conversion':'Local vertices and normals reflect Z; reverse triangle winding; world matrix H * UnityWorld * H, H=diag(1,1,-1,1). Full parent TRS composed; static batches use batch root, or world space if null. Collider meshes use object world transform, not visual static-batch transform.'}
client.sources.update({'server:'+k:v for k,v in server.sources.items()});writer.meshes.update(server_writer.meshes)
writer.finish(manifest)
print(json.dumps({'instances':len(instances),'doors':len(doors),'doorParts':sum('door' in i for i in instances),'doorColliders':sum('door' in c for c in colliders),'meshes':len(writer.meshes),'materials':len(writer.materials),'textures':len(writer.textures),
 'shaders':collections.Counter(m['shader'] for m in writer.materials.values()).most_common(),'colliders':dict(collections.Counter(c['type'] for c in colliders)),'collisionOmissions':dict(collections.Counter(c['reason'] for c in collision_omissions)),'issues':dict(issues),'skipped':skipped[:5]},indent=1))
