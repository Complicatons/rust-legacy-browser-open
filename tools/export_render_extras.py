"""Static export of render data the sky/tree ports need beyond export_world.py / export_sky.py.

Data bundles only, read with UnityPy; no target assembly or executable is loaded. Output:
browser/assets/recovered/render-extras.json
  windZone   the scene's only WindZone (BuildPlayer-rust_island_2013): mode, main, turbulence, pulse magnitude/frequency,
             world forward (Unity space). Unity 4 terrain trees take _Wind from WindZones (Tree Creator AnimateVertex).
  treeWind   per terrain tree prototype (same order and vertex order as tree-N.json): the Tree Creator wind channels
             AnimateVertex reads, float4(color.xy, texcoord1.xy) = (branch phase, edge flutter, primary, secondary);
             colour bytes are kept as 0..255 integers. tangent.w is checked to be +-1 (no ExpandBillboard leaves).
  moon       RustSky/Moon serialized local rotation/position: TOD_Sky.SetupSunAndMoon calls
             MoonTransform.LookAt(dome, MoonTransform.up), so the moon's roll starts from this rotation.
"""
import json,hashlib,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/python'))
import UnityPy
import numpy as np
from UnityPy.helpers.MeshHelper import MeshHandler

SOURCE=ROOT/'analysis/world-source/bundles'
OUT=ROOT/'browser/assets/recovered/render-extras.json'
sources={}
def load(name):
    p=SOURCE/name;sources[name]=hashlib.sha256(p.read_bytes()).hexdigest();return UnityPy.load(str(p))

env=load('scenes.unity3d')
scene=next(a for a in env.assets if a.name=='BuildPlayer-rust_island_2013')
gos={};trs={}
for o in scene.objects.values():
    if o.type.name=='GameObject':gos[o.path_id]=o.read_typetree()
    elif o.type.name=='Transform':trs[o.path_id]=o.read_typetree()
go_tr={t['m_GameObject']['m_PathID']:pid for pid,t in trs.items()}
def path(tid):
    out=[]
    while tid:t=trs[tid];out.append(gos[t['m_GameObject']['m_PathID']]['m_Name']);tid=t['m_Father']['m_PathID']
    return '/'.join(reversed(out))
def world_rotation(tid):
    q=np.array([0.,0.,0.,1.])
    while tid:
        r=trs[tid]['m_LocalRotation'];q=qmul(np.array([r['x'],r['y'],r['z'],r['w']]),q);tid=trs[tid]['m_Father']['m_PathID']
    return q
def qmul(a,b):
    ax,ay,az,aw=a;bx,by,bz,bw=b
    return np.array([aw*bx+ax*bw+ay*bz-az*by,aw*by-ax*bz+ay*bw+az*bx,aw*bz+ax*by-ay*bx+az*bw,aw*bw-ax*bx-ay*by-az*bz])
def rotate(q,v):
    u=q[:3];w=q[3];v=np.asarray(v,float);return v+2*np.cross(u,np.cross(u,v)+w*v)

zones=[]
for o in scene.objects.values():
    if o.type.name!='WindZone':continue
    d=o.read_typetree();gid=d['m_GameObject']['m_PathID'];tid=go_tr[gid]
    zones.append({'path':path(tid),'pathID':o.path_id,'enabled':bool(d['m_Enabled']),'active':bool(gos[gid]['m_IsActive']),'mode':d['m_Mode'],'radius':d['m_Radius'],
        'windMain':d['m_WindMain'],'windTurbulence':d['m_WindTurbulence'],'windPulseMagnitude':d['m_WindPulseMagnitude'],'windPulseFrequency':d['m_WindPulseFrequency'],
        'forward':[float(x) for x in rotate(world_rotation(tid),[0,0,1])]})
assert len(zones)==1,zones

moon=None
for tid,t in trs.items():
    if path(tid)=='RustSky/Moon':moon={'path':'RustSky/Moon','pathID':tid,'localRotation':t['m_LocalRotation'],'localPosition':t['m_LocalPosition'],'localScale':t['m_LocalScale'],
        'up':[float(x) for x in rotate(world_rotation(tid),[0,1,0])]}
assert moon and path(trs[moon['pathID']]['m_Father']['m_PathID'])=='RustSky'
assert trs[trs[moon['pathID']]['m_Father']['m_PathID']]['m_LocalRotation']=={'x':0.,'y':0.,'z':0.,'w':1.}
del scene,env

objects={o.path_id:o for o in load('terraindata.000.unity3d').objects}
tree_wind=[]
for pid in [-1354702245,2125166147,993014012,-294295854]: # terrain tree prototypes, export_world.py order
    go=objects[pid].read_typetree();comps={kind:objects[ptr['m_PathID']].read_typetree() for kind,ptr in go['m_Component']}
    mesh_id=comps[33]['m_Mesh']['m_PathID'];h=MeshHandler(objects[mesh_id].read());h.process()
    colors=np.asarray(h.m_Colors,dtype=np.float64);uv1=np.asarray(h.m_UV1,dtype=np.float64)[:,:2];tan=np.asarray(h.m_Tangents,dtype=np.float64)
    assert len(colors)==len(uv1)==len(tan)==len(h.m_Vertices)
    assert np.all(np.abs(np.abs(tan[:,3])-1)<1e-6),'billboard leaves (tangent.w 0) would need ExpandBillboard'
    tree_wind.append({'name':go['m_Name'],'prefabPathID':pid,'meshPathID':mesh_id,'vertices':len(colors),
        'branchPhase':colors[:,0].astype(int).tolist(),'edgeFlutter':colors[:,1].astype(int).tolist(),
        'primary':np.round(uv1[:,0],6).tolist(),'secondary':np.round(uv1[:,1],6).tolist()})

out={'source':'world-source scenes.unity3d (WindZone, RustSky/Moon), terraindata.000 (tree prototype meshes)','sourceSHA256':sources,
     'windZone':zones[0],'treeWind':tree_wind,'moon':moon}
OUT.write_text(json.dumps(out,separators=(',',':')),encoding='utf-8')
print(json.dumps({'windZone':zones[0],'moon':moon,'trees':[(t['name'],t['vertices']) for t in tree_wind],'bytes':OUT.stat().st_size}))
