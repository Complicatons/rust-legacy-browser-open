"""Static export of the player's collision rules, door pushers and NavMeshObstacles (data files only; no target code runs).

- Physics layer collision matrix + layer names (client mainData PhysicsManager/TagManager). The player's totemic
  CharacterController figures are on layer 16 "Character Collision"; their collision row decides what blocks players.
- CCPusher (28, all on scene MovingDoors) with its Facepunch.Geometry ShapeDefinition box, push planes and speed.
  CCMotor.ApplyHorizontalPushVelocity applies them while grounded (OverlapSphere mask 1310720 = layers 18|20).
- PlayerPusher (10, BlueDoor_94): exported for the record only. In this build it can never act: it needs a layer-16
  GameObject carrying CCMotor (the motor lives on the layer-0 totem pole) and CCMotor.DoPush is empty.
- NavMeshObstacle components (Unity 4 avoidance cylinders): scene doors and prefab roots (structures, deployables,
  resource nodes). BasicDoor enables a door's obstacle when it is closed and disables it once opened.
All positions/matrices are browser space (Unity Z reflected), like the scene manifest.
"""
import json,hashlib
import numpy as np
from unity_common import ROOT,H,Bundles,trs
import UnityPy

SERVER=ROOT/'analysis/world-source/bundles'
MAIN=ROOT/'analysis/client-source/data/mainData'
OUT=ROOT/'browser/assets/recovered/physics.json'
SCENE_MANIFEST=ROOT/'browser/assets/recovered/scene/manifest.json'
F=np.array([1.,1.,-1.])
def bvec(v):return (np.array([v['x'],v['y'],v['z']])*F).tolist()

layers={};matrix=None
for obj in UnityPy.load(str(MAIN)).objects:
    if obj.type.name=='PhysicsManager':matrix=[int(v)&0xffffffff for v in obj.read_typetree()['m_LayerCollisionMatrix']]
    elif obj.type.name=='TagManager':
        d=obj.read_typetree()
        for k,v in d.items():
            if k.startswith('Builtin Layer ') or k.startswith('User Layer '):layers[int(k.rsplit(' ',1)[1])]=v
if matrix is None or len(matrix)!=32:raise SystemExit('PhysicsManager layer matrix not found')
# Unity mirrors the matrix; check before relying on rows.
for a in range(32):
    for b in range(32):
        if ((matrix[a]>>b)&1)!=((matrix[b]>>a)&1):raise SystemExit(f'Asymmetric layer matrix at {a},{b}')

server=Bundles(SERVER,['scenes.unity3d','gameobject.000.unity3d','gameobject.001.unity3d','scriptableobject.000.unity3d'])
class Scene:
    def __init__(self,a):
        self.a=a;self.gos={};self.transforms={};self.cache={}
        for o in a.objects.values():
            if o.type.name=='GameObject':self.gos[o.path_id]=o.read_typetree()
            elif o.type.name=='Transform':self.transforms[o.path_id]=o.read_typetree()
        self.go_transform={t['m_GameObject']['m_PathID']:pid for pid,t in self.transforms.items()}
    def world(self,pid):
        if not pid:return np.eye(4)
        if pid not in self.cache:self.cache[pid]=self.world(self.transforms[pid]['m_Father']['m_PathID'])@trs(self.transforms[pid])
        return self.cache[pid]
    def local_to_root(self,pid):
        m=np.eye(4);t=pid
        while self.transforms[t]['m_Father']['m_PathID']:m=trs(self.transforms[t])@m;t=self.transforms[t]['m_Father']['m_PathID']
        return m,t
    def root_name(self,pid):
        _,r=self.local_to_root(pid);return self.gos[self.transforms[r]['m_GameObject']['m_PathID']]['m_Name']
    def components(self,goid):
        out={}
        for c in self.gos[goid]['m_Component']:
            p=c[1] if isinstance(c,(list,tuple)) else c['component'];co=server.resolve(self.a,p)
            if co is None:continue
            d=co.read_typetree();n=co.type.name
            if n=='MonoBehaviour':n=server.script(co,d) or n
            out.setdefault(n,[]).append(d)
        return out

# Player controller layer (CCDesc figure prefab) and the totem pole carrying CCMotor.
player=json.loads((ROOT/'browser/assets/recovered/player.json').read_text())
go_asset=server.asset('cab-gameobject.000')
def go_layer(pid):return go_asset.objects[pid].read_typetree()['m_Layer']
figure_layer=go_layer(player['controller']['data']['m_GameObject']['m_PathID']);pole_layer=go_layer(player['totem']['data']['m_GameObject']['m_PathID'])

scene=Scene(server.asset('buildplayer-rust_island_2013'))
doors=json.loads(SCENE_MANIFEST.read_text())['doors']
door_of={d['gameObjectPathID']:i for i,d in enumerate(doors)}
def box_shape(s):
    if s['geo']!=240:raise SystemExit('Unsupported CCPusher shape geometry %s'%s['geo'])
    v=[s['m%X'%i] for i in range(15)]
    return {'center':(np.array(v[0:3])*F).tolist(),'size':v[3:6],'x':(np.array(v[6:9])*F).tolist(),'y':(np.array(v[9:12])*F).tolist(),'z':(np.array(v[12:15])*F).tolist()}
pushers=[];player_pushers=[];door_obstacles=[]
for o in scene.a.objects.values():
    if o.type.name not in ('MonoBehaviour','NavMeshObstacle'):continue
    d=o.read_typetree();goid=d['m_GameObject']['m_PathID'];tid=scene.go_transform[goid]
    name=o.type.name if o.type.name=='NavMeshObstacle' else server.script(o,d)
    if name not in ('CCPusher','PlayerPusher','NavMeshObstacle'):continue
    go=scene.gos[goid];comps=scene.components(goid);door=door_of.get(goid)
    if door is None:raise SystemExit(f'{name} on {go["m_Name"]} is not on an exported MovingDoor')
    box=(comps.get('BoxCollider') or [None])[0];body=(comps.get('Rigidbody') or [None])[0]
    entry={'name':go['m_Name'],'gameObjectPathID':goid,'door':door,'layer':go['m_Layer'],'enabled':bool(d['m_Enabled']),
        'collider':box and {'center':bvec(box['m_Center']),'size':[box['m_Size'][k] for k in 'xyz'],'trigger':bool(box['m_IsTrigger']),'enabled':bool(box['m_Enabled'])},
        'kinematic':body and bool(body['m_IsKinematic']),'lossyScale':np.linalg.norm(scene.world(tid)[:3,:3],axis=0).tolist()}
    if name=='CCPusher':entry.update(shape=box_shape(d['shape']),pushPoint0=bvec(d['pushPoint0']),pushDir0=bvec(d['pushDir0']),pushPoint1=bvec(d['pushPoint1']),pushDir1=bvec(d['pushDir1']),pushSpeed=d['pushSpeed']);pushers.append(entry)
    elif name=='PlayerPusher':player_pushers.append(entry)
    else:entry.update(radius=d['m_Radius'],height=d['m_Height'],carve=bool(d['m_Carve']));door_obstacles.append(entry)

# NavMeshObstacles on prefabs, keyed by the prefab root GameObject name (matches deployable/structure/resource names).
DOOR_SCRIPTS={'MovingDoor','BasicDoor','RotatingDoor'}
prefab_obstacles={}
for an in ('cab-gameobject.000','cab-gameobject.001'):
    a=server.asset(an);s=Scene(a)
    for o in a.objects.values():
        if o.type.name!='NavMeshObstacle':continue
        d=o.read_typetree();goid=d['m_GameObject']['m_PathID'];tid=s.go_transform[goid]
        local,root=s.local_to_root(tid);root_go=s.transforms[root]['m_GameObject']['m_PathID'];rname=s.gos[root_go]['m_Name']
        door=bool(set(s.components(goid))&DOOR_SCRIPTS)
        scale=np.linalg.norm(local[:3,:3],axis=0)
        prefab_obstacles.setdefault(rname,[]).append({'node':s.gos[goid]['m_Name'],'local':(H@local@H)[:3,3].tolist(),'scale':scale.tolist(),
            'radius':d['m_Radius'],'height':d['m_Height'],'enabled':bool(d['m_Enabled']),'carve':bool(d['m_Carve']),'door':door,'source':an+':'+str(o.path_id)})

out={'source':'client mainData (PhysicsManager, TagManager); server scenes.unity3d + gameobject.000/.001 (CCPusher, PlayerPusher, NavMeshObstacle)',
 'sourceSHA256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [MAIN,SERVER/'scenes.unity3d',SERVER/'gameobject.000.unity3d',SERVER/'gameobject.001.unity3d']},
 'layers':{str(k):v for k,v in sorted(layers.items())},'layerCollisionMatrix':matrix,
 'player':{'figureLayer':figure_layer,'totemPoleLayer':pole_layer,'collisionMask':matrix[figure_layer],
   'pushOverlapMask':1310720,'note':'CCMotor.ApplyHorizontalPushVelocity: OverlapSphere(worldCenter, effectiveSkinnedHeight, 1310720)'},
 'ccPushers':pushers,'playerPushers':player_pushers,'doorObstacles':door_obstacles,'prefabObstacles':prefab_obstacles}
OUT.write_text(json.dumps(out,separators=(',',':')))
print(json.dumps({'figureLayer':figure_layer,'poleLayer':pole_layer,'mask':matrix[figure_layer],'ccPushers':len(pushers),'playerPushers':len(player_pushers),'doorObstacles':len(door_obstacles),
 'prefabObstacles':{k:len(v) for k,v in prefab_obstacles.items()},'sha256':hashlib.sha256(OUT.read_bytes()).hexdigest()}))
