"""Static export of the original airdrop prefabs and server data (data bundles only; no target code is loaded).

Classic NetAuto prefabs "C130" (SupplyDropPlane) and "SupplyCrate" (with its SupplyParachute child and landedEffect
SupplyImpactSmoke) from the client gameobject bundle, in the deployables prefab format (nodes, renderers, colliders,
component data), plus the server scene's SupplyDropZone transforms/radii and SupplyDropTimer presence.
Runtime rules come from decompiled SupplyDropZone/SupplyDropPlane/SupplyCrate/SupplyParachute/SupplyDropTimer/
NetDoppler/KillZone/SignalGrenade/airdrop (client and server Assembly-CSharp).
Output: browser/assets/recovered/airdrop/ (ignored; private overlay).
"""
import json,collections
import numpy as np
from unity_common import ROOT,H,Bundles,Writer,identity,trs,token

CLIENT=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data',ROOT/'analysis/world-source/bundles']
SERVER=[ROOT/'analysis/world-source/bundles']
OUT=ROOT/'browser/assets/recovered/airdrop'
OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
b=Bundles(CLIENT,['gameobject.000.unity3d','gameobject.001.unity3d'])
writer=Writer(b,OUT);issues=collections.Counter()
go=b.asset('cab-gameobject.000')

def finite(v):
    if isinstance(v,float) and not np.isfinite(v):return None
    if isinstance(v,dict):return {k:finite(x) for k,x in v.items()}
    if isinstance(v,list):return [finite(x) for x in v]
    return v
def plain(d):return finite({k:v for k,v in d.items() if k not in ('m_Script','m_GameObject','m_Enabled','m_Name')})

def net_auto(name):
    """NetCull.LoadPrefab(name): RustLoader registers every bundled uLinkNetworkView root under its GameObject name."""
    found=[]
    for o in go.objects.values():
        if o.type.name!='GameObject':continue
        d=o.read_typetree()
        if d['m_Name']!=name:continue
        cs=b.components(go,d)
        if 'uLinkNetworkView' in cs and not cs['Transform'][0].read_typetree()['m_Father']['m_PathID']:found.append(o)
    if len(found)!=1:raise ValueError(f'Expected one NetAuto prefab {name}, found {len(found)}')
    return found[0]

sounds={}
def sound(owner,ptr):
    if not ptr or not ptr.get('m_PathID'):return None
    obj=b.resolve(owner,ptr)
    if obj is None:issues['missing audio clip']+=1;return None
    key=identity(obj)
    if key not in sounds:
        clip=obj.read();(name,data),=clip.samples.items()
        filename='sound-'+token(key)+'.'+name.rsplit('.',1)[-1];(OUT/filename).write_bytes(data);sounds[key]={'file':filename,'name':clip.m_Name}
    return sounds[key]['file']

prefabs={}
def prefab(root):
    """Prefab hierarchy relative to its root (H*relative*H), with the gameplay/presentation component data."""
    key='obj:'+identity(root)
    if key in prefabs:return key
    prefabs[key]=None
    owner=root.assets_file;nodes=[];renderers=[];colliders=[];components=collections.defaultdict(list);by_go={};by_transform={}
    def walk(t_obj,parent,rel,active):
        t=t_obj.read_typetree();gobj=b.resolve(owner,t['m_GameObject']);g=gobj.read_typetree();cs=b.components(owner,g)
        i=len(nodes);on=active and bool(g['m_IsActive']);by_go[gobj.path_id]=i;by_transform[t_obj.path_id]=i
        nodes.append({'name':g['m_Name'],'parent':parent,'layer':g['m_Layer'],'tag':g['m_Tag'],'active':on,'position':[t['m_LocalPosition'][k] for k in 'xyz'],'rotation':[t['m_LocalRotation'][k] for k in 'xyzw'],'scale':[t['m_LocalScale'][k] for k in 'xyz'],'matrix':(H@rel@H).T.ravel().tolist()})
        for kind,objs in cs.items():
            for o in objs:
                d=o.read_typetree()
                if kind=='MeshFilter':
                    r=next(iter(cs.get('MeshRenderer',[])),None)
                    if r is None or not on:continue
                    rd=r.read_typetree()
                    if not rd['m_Enabled']:continue
                    m=b.resolve(owner,d['m_Mesh'])
                    if m is None:issues['null mesh']+=1;continue
                    renderers.append({'node':i,'name':g['m_Name'],'layer':g['m_Layer'],'mesh':writer.mesh(m),'materials':[writer.material(b.resolve(owner,p)) for p in rd['m_Materials'] if p['m_PathID']],'matrix':(H@rel@H).T.ravel().tolist()})
                elif kind in ('BoxCollider','SphereCollider','CapsuleCollider','MeshCollider'):
                    if not d['m_Enabled'] or not on:continue
                    c={'node':i,'type':kind,'name':g['m_Name'],'layer':g['m_Layer'],'trigger':bool(d['m_IsTrigger']),'matrix':(H@rel@H).T.ravel().tolist()}
                    if 'm_Center' in d:c['center']=[d['m_Center']['x'],d['m_Center']['y'],-d['m_Center']['z']];c['unityCenter']=[d['m_Center'][k] for k in 'xyz']
                    if kind=='BoxCollider':c['size']=[d['m_Size'][k] for k in 'xyz']
                    if kind in ('SphereCollider','CapsuleCollider'):c['radius']=d['m_Radius']
                    if kind=='CapsuleCollider':c.update(height=d['m_Height'],direction=d['m_Direction'])
                    pm=b.resolve(owner,d['m_Material']) if d.get('m_Material',{}).get('m_PathID') else None
                    if pm is not None:
                        md=pm.read_typetree();c['physicMaterial']={k:md.get(k) for k in ('m_Name','dynamicFriction','staticFriction','bounciness','frictionCombine','bounceCombine')}
                    if kind=='MeshCollider':c['mesh']=writer.mesh(b.resolve(owner,d['m_Mesh']))
                    colliders.append(c)
                elif kind=='AudioSource':
                    # Custom rolloff (rolloffMode 2) keeps its curve: volume = curve(distance / MaxDistance).
                    components[kind].append({'node':i,'enabled':bool(d['m_Enabled']),'clip':sound(owner,d['m_audioClip']),'data':{k:d[k] for k in ('m_Volume','m_Pitch','Loop','m_PlayOnAwake','MinDistance','MaxDistance','rolloffMode','DopplerLevel','Priority') if k in d},
                        'rolloffCustomCurve':d.get('rolloffCustomCurve'),'panLevelCustomCurve':d.get('panLevelCustomCurve'),'spreadCustomCurve':d.get('spreadCustomCurve')})
                elif kind in ('ParticleSystem','Light'):components[kind].append({'node':i,'enabled':bool(d.get('m_Enabled',1)),'data':plain(d),**({'id':o.path_id} if kind=='ParticleSystem' else {})})
                elif kind=='ParticleSystemRenderer':
                    components[kind].append({'node':i,'enabled':bool(d['m_Enabled']),'materials':[writer.material(b.resolve(owner,p)) for p in d['m_Materials'] if p['m_PathID']],'data':plain({k:v for k,v in d.items() if k!='m_Materials'})})
                elif kind in ('SupplyDropPlane','SupplyCrate','SupplyParachute','NetDoppler','TransformInterpolator','RigidbodyInterpolator','Rigidbody','LootableObject','KillZone','uLinkNetworkView','Animation','ContextSprite','Useable','Contextual'):
                    components[kind].append({'node':i,'enabled':bool(d.get('m_Enabled',1)),'data':plain(d),'id':o.path_id})
        for c in t['m_Children']:
            ct=b.resolve(owner,c);walk(ct,i,rel@trs(ct.read_typetree()),on)
    root_t=b.components(owner,root.read_typetree())['Transform'][0]
    walk(root_t,-1,np.eye(4),True)
    # Resolve the object pointers the runtime uses into node indices / prefab keys.
    for e in components.get('SupplyDropPlane',[]):
        e['propellerNodes']=[by_go[p['m_PathID']] for p in e['data']['propellers']]
    for e in components.get('SupplyCrate',[]):
        d=e['data'];chute=next(c for c in components['SupplyParachute'] if c['id']==d['chute']['m_PathID'])
        e['chuteNode']=chute['node'];e['bubbleWrapNode']=by_go[d['bubbleWrap']['m_PathID']]
        fx=b.resolve(owner,d['landedEffect']);e['landedEffect']=prefab(fx) if fx is not None else None
    for kind in ('TransformInterpolator','RigidbodyInterpolator'):
        for e in components.get(kind,[]):
            target=e['data']['target']['m_PathID'];e['targetIsRoot']=target==root_t.path_id or target in [c.path_id for cl in b.components(owner,root.read_typetree()).values() for c in cl]
    rt=root_t.read_typetree()
    prefabs[key]={'name':nodes[0]['name'],'source':identity(root),'rootScale':rt['m_LocalScale'],'rootLocalRotation':rt['m_LocalRotation'],'rootLocalPosition':rt['m_LocalPosition'],
        'nodes':nodes,'renderers':renderers,'colliders':colliders,'components':dict(components)}
    return key

plane=prefab(net_auto('C130'));crate=prefab(net_auto('SupplyCrate'))
p=prefabs[plane];c=prefabs[crate]
if len(p['components'].get('SupplyDropPlane',[]))!=1 or len(c['components'].get('SupplyCrate',[]))!=1:raise ValueError('Unexpected airdrop prefab components')

# Server scene: SupplyDropZone instances (world position, radius) and the SupplyDropTimer (protected fields are not serialized).
sb=Bundles(SERVER,['scenes.unity3d','sharedassets0.assets'])
scene=sb.asset('buildplayer-rust_island_2013');zones=[];timers=0
for o in scene.objects.values():
    if o.type.name!='MonoBehaviour':continue
    try:d=o.read_typetree()
    except Exception:continue
    kind=sb.script(o,d)
    if kind=='SupplyDropTimer':timers+=1
    if kind!='SupplyDropZone':continue
    g=sb.resolve(scene,d['m_GameObject']);gd=g.read_typetree();t=sb.components(scene,gd)['Transform'][0];world=trs(t.read_typetree());tt=t.read_typetree()
    while tt['m_Father']['m_PathID']:
        t=sb.resolve(scene,tt['m_Father']);tt=t.read_typetree();world=trs(tt)@world
    zones.append({'name':gd['m_Name'],'gameObject':g.path_id,'active':bool(gd['m_IsActive']) and bool(d['m_Enabled']),'position':world[:3,3].tolist(),'radius':d['radius']})
zones.sort(key=lambda z:z['gameObject']) # _dropZones order follows Awake order; scene file order is used (unverified at runtime)
loot=json.loads((ROOT/'browser/assets/recovered/loot/manifest.json').read_text())
spawn_list=c['components']['LootableObject'][0]['data']['_lootSpawnListName']['name']
if spawn_list not in loot['lists']:issues['loot list missing from loot manifest '+spawn_list]+=1
writer.finish({'plane':plane,'crate':crate,'prefabs':prefabs,'sounds':sounds,
    'server':{'dropZones':zones,'dropTimers':timers,'timer':{'dropTimeDayMin':10.0,'dropTimeDayMax':14.0,'source':'SupplyDropTimer field initialisers (protected, not serialized)'},
              'airdrop':{'min_players':50,'source':'airdrop.cs [Admin] static default'},'crateSpawnList':spawn_list},
    'summary':dict(issues),
    'conversion':'Node/renderer/collider matrices are H*relative*H to the prefab root; node position/rotation/scale are raw Unity locals; server positions are Unity space.'})
print(json.dumps({'plane':p['name'],'crate':c['name'],'nodes':[len(p['nodes']),len(c['nodes'])],'renderers':[len(p['renderers']),len(c['renderers'])],
    'components':[sorted(p['components']),sorted(c['components'])],'zones':zones,'timers':timers,'sounds':sounds,'issues':dict(issues)},indent=1))
