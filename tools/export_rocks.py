"""Static export of the island's runtime rock colliders (data bundles only, no target code is loaded).

The scene object "RockSpawn" (layer 10) carries a SlowSpawn component: 8,344 serialized instances (position + uniform
"scale" in ps[i], rotation r[i], mesh meshes[meshIndex[i]]) of the seven decor rock/cliff meshes. With runtimeLoad =
Collider (1), SlowSpawn.Start spawns one MeshCollider per instance at run time on both the client and the server;
the visible rocks are the scene's separate overlay-rock renderers (same meshes at the same poses). InstanceParameters.Spawn
sets only position and rotation (the w "scale" is never applied), so each collider is its mesh at scale 1.

Colliders come from the SERVER scene, as the other solid colliders in export_scene.py (authoritative physics). The
client scene holds the same SlowSpawn data and byte-identical meshes; the export fails if the two builds ever differ.
Output: browser/assets/recovered/rockspawn/ (manifest.json, mesh-*.bin, slowspawn-N-matrix.bin, slowspawn-N-mesh.bin).
"""
import json,collections
from unity_common import ROOT,H,Bundles,Writer
import numpy as np

SERVER=ROOT/'analysis/world-source/bundles'
CLIENT=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data']
OUT=ROOT/'browser/assets/recovered/rockspawn'
OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
client=Bundles(CLIENT,['scenes.unity3d']);server=Bundles(SERVER,['scenes.unity3d'])
writer=Writer(server,OUT,namespace='server:')

def rigid(p,q):
    """Unity world matrix of a spawned GameObject: position + rotation, scale 1 (SlowSpawn.InstanceParameters.Spawn)."""
    x,y,z,w=q
    r=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])
    m=np.eye(4);m[:3,:3]=r;m[:3,3]=p;return m

def slowspawns(b):
    scene=b.asset('buildplayer-rust_island_2013');gos={o.path_id:o for o in scene.objects.values() if o.type.name=='GameObject'};out=[]
    for obj in list(scene.objects.values()):
        if obj.type.name!='MonoBehaviour':continue
        d=obj.read_typetree()
        if b.script(obj,d)!='SlowSpawn':continue
        go=gos[d['m_GameObject']['m_PathID']].read_typetree()
        if go['m_IsActive'] and d['m_Enabled'] and d['runtimeLoad']&1:out.append((obj,go,d))  # only the Collider flag spawns colliders
    return out
client_spawns={go['m_Name']:(obj,d) for obj,go,d in slowspawns(client)}
spawns=[]
for obj,go,d in slowspawns(server):
    cobj,cd=client_spawns[go['m_Name']]
    if [cd[k] for k in ('ps','r','meshIndex')]!=[d[k] for k in ('ps','r','meshIndex')]:raise SystemExit('Client and server SlowSpawn instances differ: '+go['m_Name'])
    meshes=[writer.mesh(server.resolve(obj.assets_file,m)) for m in d['meshes']]
    for sm,cm in zip(d['meshes'],cd['meshes']):
        a=writer.raw_mesh(server.resolve(obj.assets_file,sm));b=writer.raw_mesh(client.resolve(cobj.assets_file,cm))
        if not(np.array_equal(a[0],b[0]) and all(np.array_equal(x,y) for x,y in zip(a[3],b[3]))):raise SystemExit('Client and server rock meshes differ')
    matrices=np.array([(H@rigid([p['x'],p['y'],p['z']],[q['x'],q['y'],q['z'],q['w']])@H).T.ravel() for p,q in zip(d['ps'],d['r'])],dtype='<f4')
    index=np.asarray(d['meshIndex'],dtype='<u1')
    name=f'slowspawn-{len(spawns)}'
    spawns.append({'name':go['m_Name'],'layer':go['m_Layer'],'findSequence':d['findSequence'],'runtimeLoad':d['runtimeLoad'],'pathID':obj.path_id,
        'meshes':meshes,'count':len(matrices),'perMesh':dict(collections.Counter(int(i) for i in index)),
        'matrices':writer.binary(name+'-matrix.bin',matrices,'<f4'),'meshIndex':writer.binary(name+'-mesh.bin',index,'<u1')})
if not spawns:raise SystemExit('No active SlowSpawn with runtime colliders found')
writer.finish({'spawns':spawns,'source':'server scenes.unity3d buildplayer-rust_island_2013 SlowSpawn (client scene checked identical)',
 'conversion':'Mesh vertices reflect Z with reversed winding (Writer.raw_mesh); instance matrices are H * T(position) R(rotation) * H, column-major, scale 1 as SlowSpawn spawns them.'})
print(json.dumps([{k:s[k] for k in ('name','layer','count','perMesh')} for s in spawns],indent=1))
