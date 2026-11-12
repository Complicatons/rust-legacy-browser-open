"""Static export of the original first-person viewmodels (HeldItemDataBlock._viewModelPrefab): skeleton, skinned
arms/item meshes, legacy animation clips, the ViewModel component settings and its camera-space sockets.
Client data bundles only; nothing is executed.

Like the animals, skinned geometry, bindposes, bone locals and clip curves stay in Unity space; the browser places
the viewmodel root under a Z-reflected camera-space parent. Triangle winding is reversed for that reflection.
"""
import json,collections,os
from pathlib import Path
from unity_common import ROOT,Bundles,Writer,identity,token
import numpy as np
from UnityPy.helpers.MeshHelper import MeshHandler

CLIENT=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data',ROOT/'analysis/world-source/bundles']
# RLB_EXPORT_OUT: write somewhere else first (e.g. to compare with the shared private copy before replacing it).
OUT=Path(os.environ['RLB_EXPORT_OUT']) if os.environ.get('RLB_EXPORT_OUT') else ROOT/'browser/assets/recovered/viewmodels'
OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
b=Bundles(CLIENT,['gameobject.000.unity3d','gameobject.001.unity3d','scriptableobject.000.unity3d','sharedassets0.assets'])
# The Uber Hatchet / Uber Hunting Bow datablocks live in cab-datablock.000 (items manifest keys 'cab-datablock.000:...'),
# not scriptableobject.000; their _viewModelPrefab are VM-Hatchet / VM-HuntingBow. Same bundle export_deployables loads.
b.load(b.find('datablock.000.unity3d'))
writer=Writer(b,OUT);issues=collections.Counter()
items=json.loads((ROOT/'browser/assets/recovered/items/manifest.json').read_text())['items']
item_by_uid={i['data']['_uniqueID']:k for k,i in items.items()}

def tr_data(t):return {'position':[t['m_LocalPosition'][k] for k in 'xyz'],'rotation':[t['m_LocalRotation'][k] for k in 'xyzw'],'scale':[t['m_LocalScale'][k] for k in 'xyz']}
def skinned(owner,smr,bone_index,key):
    d=smr.read_typetree();mobj=b.resolve(owner,d['m_Mesh']);m=mobj.read();h=MeshHandler(m);h.process();md=mobj.read_typetree()
    prefix='skin-'+token(key)
    v=np.array(h.m_Vertices,dtype='<f4')[:,:3];n=np.array(h.m_Normals,dtype='<f4')[:,:3];uv=np.array(h.m_UV0,dtype='<f4')[:,:2]
    tris=[np.asarray(t,dtype='<u4').reshape(-1,3)[:,[0,2,1]] for t in h.get_triangles()]
    bones=[];
    for p in d['m_Bones']:
        bt=b.resolve(owner,p)
        if bt is None or bt.path_id not in bone_index:issues['unbound bone']+=1;bones.append(0)
        else:bones.append(bone_index[bt.path_id])
    binds=[[bp[f'e{r}{c}'] for c in range(4) for r in range(4)] for bp in md['m_BindPose']]
    return {'name':m.m_Name,'position':writer.binary(prefix+'-position.bin',v,'<f4'),'normal':writer.binary(prefix+'-normal.bin',n,'<f4'),'uv':writer.binary(prefix+'-uv.bin',uv,'<f4'),
        'skinIndex':writer.binary(prefix+'-skinindex.bin',np.array(h.m_BoneIndices,dtype='<u2'),'<u2'),'skinWeight':writer.binary(prefix+'-skinweight.bin',np.array(h.m_BoneWeights,dtype='<f4'),'<f4'),
        'parts':[writer.binary(prefix+f'-indices-{i}.bin',t,'<u4') for i,t in enumerate(tris)],'bones':bones,'bindposes':binds,
        'materials':[writer.material(b.resolve(owner,p)) for p in d['m_Materials']]}
def clip(obj,paths):
    """Legacy AnimationClip curves as per-bone time/value arrays (paths are relative to the Animation's GameObject)."""
    d=obj.read_typetree()
    if d['m_Compressed']:issues['compressed clip '+d['m_Name']]+=1;return None
    tracks=collections.defaultdict(dict);length=0
    for kind,field,comps in [('rotation','m_RotationCurves','xyzw'),('position','m_PositionCurves','xyz'),('scale','m_ScaleCurves','xyz')]:
        for c in d[field]:
            if c['path'] not in paths:issues['unbound curve path']+=1;continue
            keys=c['curve']['m_Curve'];times=[k['time'] for k in keys];length=max(length,times[-1] if times else 0)
            tracks[paths[c['path']]][kind]={'times':times,'values':[k['value'][x] for k in keys for x in comps]}
    return {'name':d['m_Name'],'length':length,'wrapMode':d['m_WrapMode'],'tracks':[{'bone':i,**t} for i,t in sorted(tracks.items())]}

# ViewModel.idleMixer (AnimationBlender): residual idleFrame plus the channels in ChannelConfig index order.
IDLE_CHANNELS=['idleChannel','movementIdleChannel','crouchChannel','crouchMovementChannel','bowChannel','bowMovementChannel','fallChannel','slipChannel','zoomChannel']
IDLE_NAMES=['idle','move','dcki','dckm','bowi','bowm','fall','slip','zoom']
def idle_mixer(vmd):
    fields=[vmd.get('idleFrame')]+[vmd.get(c) for c in IDLE_CHANNELS]
    if not any(f and f.get('clipName') for f in fields):return None
    return {'residual':vmd['idleFrame'],'channels':[dict(vmd[c],name=n) for c,n in zip(IDLE_CHANNELS,IDLE_NAMES)]}
VM_FIELDS=['caps','perspectiveNearOverride','perspectiveFarOverride','perspectiveFOVOverride','perspectiveAspectOverride','lazyAngle','zoomFieldOfView','zoomCurve','zoomOffset','zoomRotate','offset','rotate',
 'zoomInDuration','zoomOutDuration','showCrosshairZoom','showCrosshairNotZoomed','headBobOffsetScale','headBobRotationScale','barrelAiming','barrelWhileZoom','barrelWhileBowing','barrelPivot','barrelRotation','barrelLimit',
 'noHitPlane','bowAllowed','bowOffsetPoint','bowOffsetAngles','bowCurve','bowCurveIs01Fraction','bowEnterDuration','bowExitDuration','zoomPunch','punchScalar','fireAnimName','deployAnimName','reloadAnimName','fireAnimScaleSpeed']
SOCKETS=['pivot','pivot2','muzzle','sight','optics','bowPivot']
viewmodels={};clips={};used={}
for a in list(b.assets.values()):
    for o in a.objects.values():
        if o.type.name!='MonoBehaviour':continue
        try:d=o.read_typetree()
        except Exception:continue
        if '_viewModelPrefab' not in d or not d['_viewModelPrefab']['m_PathID']:continue
        vm=b.resolve(o.assets_file,d['_viewModelPrefab'])
        if vm is None:issues['missing viewmodel '+d['m_Name']]+=1;continue
        key=identity(vm);item=item_by_uid.get(d.get('_uniqueID'))
        used.setdefault(key,[]).append({'item':item,'name':d['m_Name']})
        if key in viewmodels:continue
        owner=vm.assets_file;vmd=vm.read_typetree();go=b.resolve(owner,vmd['m_GameObject']).read_typetree()
        skeleton=[];bone_index={};paths={}
        def walk(t_obj,parent,path):
            t=t_obj.read_typetree();g=b.resolve(owner,t['m_GameObject']).read_typetree()
            i=len(skeleton);bone_index[t_obj.path_id]=i;paths[path]=i
            skeleton.append({'name':g['m_Name'],'parent':parent,'path':path,'active':bool(g['m_IsActive']),**tr_data(t)})
            for c in t['m_Children']:
                ct=b.resolve(owner,c);walk(ct,i,(path+'/' if path else '')+b.resolve(owner,ct.read_typetree()['m_GameObject']).read_typetree()['m_Name'])
        walk(b.components(owner,go)['Transform'][0],-1,'')
        root=b.resolve(owner,vmd['root']);root_i=bone_index[root.path_id]
        skins=[]
        for t_id,i in bone_index.items():
            t=owner.objects[t_id].read_typetree();g=b.resolve(owner,t['m_GameObject']).read_typetree()
            if not g['m_IsActive']:continue
            for smr in b.components(owner,g).get('SkinnedMeshRenderer',[]):
                if smr.read_typetree()['m_Enabled']:skins.append({**skinned(owner,smr,bone_index,key+':'+str(smr.path_id)),'transform':i})
        # Animation on the viewmodel root: curve paths are relative to that GameObject.
        rg=b.resolve(owner,root.read_typetree()['m_GameObject']).read_typetree();an=b.components(owner,rg)['Animation'][0].read_typetree()
        root_path=skeleton[root_i]['path'];rel={(p[len(root_path)+1:] if root_path else p) if p!=root_path else '':i for p,i in paths.items() if p==root_path or p.startswith(root_path+'/') or not root_path}
        names=[]
        for p in an['m_Animations']+[an['m_Animation']]:
            c=b.resolve(owner,p) if p['m_PathID'] else None
            if c is None:continue
            cd=clip(c,rel)
            if cd and cd['name'] not in names:clips[key+':'+cd['name']]=cd;names.append(cd['name'])
        default=b.resolve(owner,an['m_Animation']) if an['m_Animation']['m_PathID'] else None
        sockets={}
        for s in SOCKETS:
            sd=vmd.get(s)
            if not sd:continue
            pt=b.resolve(owner,sd['parent']) if sd['parent']['m_PathID'] else None
            sockets[s]={'bone':bone_index.get(pt.path_id) if pt else None,'offset':[sd['offset'][k] for k in 'xyz'],'eulerRotate':[sd['eulerRotate'][k] for k in 'xyz'],'proxy':bool(sd.get('proxy',0))}
        viewmodels[key]={'name':go['m_Name'],'root':root_i,'skeleton':skeleton,'skins':skins,'clips':names,'defaultClip':default.read().m_Name if default else None,
            'playAutomatically':bool(an.get('m_PlayAutomatically',1)),'settings':{k:vmd[k] for k in VM_FIELDS if k in vmd},'sockets':sockets}
        if idle_mixer(vmd):viewmodels[key]['idleMixer']=idle_mixer(vmd)
for key,v in viewmodels.items():v['usedBy']=used[key]
items_to_vm={u['item']:k for k,lst in used.items() for u in lst if u['item']}
clip_file='clips.json';(OUT/clip_file).write_text(json.dumps(clips,separators=(',',':')),encoding='utf-8')
writer.finish({'viewmodels':viewmodels,'items':items_to_vm,'clipsFile':clip_file,'summary':dict(issues),
    'conversion':'Skeleton locals, skinned vertices, bindposes (column-major) and clip curves are Unity space; the browser parents the root under a camera-space node with H=diag(1,1,-1). Triangle winding reversed.'})
print(json.dumps({v['name']:{'items':[u['name'] for u in v['usedBy']],'bones':len(v['skeleton']),'skins':[s['name'] for s in v['skins']],'clips':v['clips'],'default':v['defaultClip'],'fov':v['settings'].get('perspectiveFOVOverride')} for v in viewmodels.values()},indent=1))
print('issues',dict(issues))
