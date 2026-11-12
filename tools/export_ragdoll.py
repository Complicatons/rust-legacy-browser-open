"""Read original ragdoll bodies/joints/poses as static Unity data; never load target code.

Also kept for the physics port: each body's GameObject layer (27 "Ragdoll"), the root IgnoreColliders pairs
(IgnoreColliders.Awake -> Physics.IgnoreCollision(a[i], b[i])) as body index pairs, and the client PhysicsManager /
TimeManager settings (gravity, solver iterations, sleep thresholds, max angular velocity, layer collision matrix,
fixed and maximum allowed timestep) from mainData. The default PhysicMaterial (m_DefaultMaterial) lives in Unity's
built-in resources, which are not in the game data; null collider materials use Unity's built-in default.
"""
import json,math
import UnityPy
from unity_common import ROOT,Bundles,identity
from unity_skin import skeleton,clip
b=Bundles([ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data'],['gameobject.000.unity3d','scriptableobject.000.unity3d','sharedassets0.assets'])
owner=b.asset('cab-gameobject.000')
root=next(o for o in owner.objects.values() if o.type.name=='GameObject' and o.read_typetree()['m_Name']=='MaleRagdoll')
cs=b.components(owner,root.read_typetree());nodes,indices,paths=skeleton(b,cs['Transform'][0]);bodies=[];joints=[];body_ids={};collider_body={}
for tid,index in indices.items():
    transform=owner.objects[tid].read_typetree();go=b.resolve(owner,transform['m_GameObject']);components=b.components(owner,go.read_typetree())
    for rb in components.get('Rigidbody',[]):
        body_ids[rb.path_id]=len(bodies)
        colliders=[]
        for kind in ('CapsuleCollider','BoxCollider','SphereCollider'):
            for c in components.get(kind,[]):
                collider_body[c.path_id]=len(bodies);d=c.read_typetree();material=b.resolve(c.assets_file,d['m_Material']) if d.get('m_Material',{}).get('m_PathID') else None
                colliders.append({'type':kind,'data':{k:v for k,v in d.items() if k not in ('m_GameObject','m_Material')},'material':material.read_typetree() if material else None})
        bodies.append({'bone':index,'name':nodes[index]['name'],'layer':go.read_typetree()['m_Layer'],'source':identity(rb),'data':{k:v for k,v in rb.read_typetree().items() if k!='m_GameObject'},'colliders':colliders})
    for kind in ('CharacterJoint','FixedJoint','HingeJoint','ConfigurableJoint'):
        for joint in components.get(kind,[]):joints.append({'bone':index,'type':kind,'data':{k:v for k,v in joint.read_typetree().items() if k!='m_GameObject'}})
for j in joints:
    connected=j['data'].get('m_ConnectedBody',j['data'].get('m_ConnectedRigidBody'))
    if not connected:raise ValueError('Missing joint connected body')
    j['connectedBody']=body_ids[connected['m_PathID']]
ignore=[]
for ic in cs.get('IgnoreColliders',[]):
    d=ic.read_typetree()
    for a,c in zip(d['a'],d['b']):
        pair=sorted([collider_body[a['m_PathID']],collider_body[c['m_PathID']]])
        if pair[0]!=pair[1] and pair not in ignore:ignore.append(pair)
physics={}
for obj in UnityPy.load(str(ROOT/'analysis/client-source/data/mainData')).objects:
    if obj.type.name=='PhysicsManager':
        d=obj.read_typetree()
        physics.update(gravity=d['m_Gravity'],bounceThreshold=d['m_BounceThreshold'],sleepVelocity=d['m_SleepVelocity'],sleepAngularVelocity=d['m_SleepAngularVelocity'],
            maxAngularVelocity=d['m_MaxAngularVelocity'],minPenetrationForPenalty=d['m_MinPenetrationForPenalty'],solverIterationCount=d['m_SolverIterationCount'],
            raycastsHitTriggers=bool(d['m_RaycastsHitTriggers']),layerCollisionMatrix=[int(v)&0xffffffff for v in d['m_LayerCollisionMatrix']])
    elif obj.type.name=='TimeManager':
        d=obj.read_typetree();physics.update(fixedTimestep=d['Fixed Timestep'],maximumAllowedTimestep=d['Maximum Allowed Timestep'])
if len(physics.get('layerCollisionMatrix',[]))!=32 or 'fixedTimestep' not in physics:raise SystemExit('PhysicsManager/TimeManager not found')
animations={}
poses={}
renderer=cs['ArmorModelRenderer'][0]
rd=renderer.read_typetree()
structure=b.resolve(renderer.assets_file,rd['boneStructure'])
rig_obj=b.resolve(structure.assets_file,structure.read_typetree()['A']);rig=rig_obj.read_typetree()
for name,ptr,time in zip(rig['m_PoseNames'],rig['m_PoseClips'],rig['m_PoseTimes']):
    obj=b.resolve(rig_obj.assets_file,ptr)
    if obj is not None:
        c=clip(obj,paths,set());animations[c['name']]=c;poses[name]={'clip':c['name'],'time':time}
for an in cs.get('Animation',[]):
    for ptr in an.read_typetree()['m_Animations']:
        obj=b.resolve(owner,ptr)
        if obj is not None:animations[obj.read().m_Name]=clip(obj,paths,set())
def finite(value):
    if isinstance(value,float) and not math.isfinite(value):return None
    if isinstance(value,dict):return {k:finite(v) for k,v in value.items()}
    if isinstance(value,list):return [finite(v) for v in value]
    return value
out=ROOT/'browser/assets/recovered/players/ragdoll.json';out.write_text(json.dumps(finite({'source':identity(root),'name':'MaleRagdoll','nodes':nodes,'bodies':bodies,'joints':joints,'ignore':ignore,'physics':physics,'animations':animations,'poses':poses,'sourceSHA256':b.sources}),separators=(',',':'),allow_nan=False),encoding='utf-8')
print(json.dumps({'bones':len(nodes),'bodies':len(bodies),'joints':len(joints),'ignore':len(ignore),'physics':{k:v for k,v in physics.items() if k!='layerCollisionMatrix'},'animations':list(animations),'sampleBody':bodies[0] if bodies else None,'sampleJoint':joints[0] if joints else None}))
