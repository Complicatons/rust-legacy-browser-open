"""Static export of the original server's island navmesh (bundles/navmesh.000.unity3d, NavMeshObsolete m_MeshData).

The data is Unity 4's Detour tile set: 'MSET' v1 header + dtNavMeshParams, then per tile {tileRef u32, dataSize u32,
tile}. Tiles are Detour 'DNAV' version 13 with Unity's layout (fitted exactly across all 119 tiles):
  header 104 B (dtMeshHeader + one extra u32 before walkableHeight), verts 12 B,
  dtPoly 36 B {firstLink u32, verts u16[6], neis u16[6], flags u32, vertCount u8, area u8, pad u16},
  dtLink 12 B {ref u32, next u32, edge u8, side u8, bmin u8, bmax u8} (unused slots form a free list),
  dtPolyDetail 12 B, detail verts 12 B, detail tris 8 B (u16[4]), BV nodes 16 B, off-mesh connections (none).
Poly refs are salt<<22 | tile<<12 | poly, tile = position in the file. Output is Unity space.
"""
from pathlib import Path
import sys,json,struct,hashlib
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/python'))
import UnityPy
import numpy as np
SOURCE=ROOT/'analysis/world-source/bundles/navmesh.000.unity3d'
OUT=ROOT/'browser/assets/recovered/navmesh'
OUT.mkdir(parents=True,exist_ok=True)
EXT=0x8000;NULL_LINK=0xffffffff

data=None
for o in UnityPy.load(str(SOURCE)).objects:
    if o.class_id==194:data=bytes(o.read_typetree()['m_MeshData'])
if data is None:raise SystemExit('NavMesh object not found')
magic,version,ntiles=struct.unpack_from('<4sII',data,0)
if magic!=b'TESM' or version!=1:raise SystemExit('Unexpected navmesh set header')
orig=struct.unpack_from('<3f',data,12);tile_w,tile_h,max_tiles,max_polys=struct.unpack_from('<ffII',data,24)
tile_bits=(max_tiles-1).bit_length();poly_bits=(max_polys-1).bit_length()

tiles=[];off=40
for t in range(ntiles):
    ref,size=struct.unpack_from('<II',data,off);off+=8;tile=data[off:off+size];off+=size
    h=struct.unpack_from('<4s15I3f6ff',tile,0)
    if h[0]!=b'VAND' or h[1]!=13:raise SystemExit('Unexpected tile header')
    if (ref>>poly_bits)&((1<<tile_bits)-1)!=t:raise SystemExit('Tile ref does not match file order')
    npoly,nvert,nlink,ndetail,ndv,ndt,nbv,noff=h[6:14]
    expected=104+12*nvert+36*npoly+12*nlink+12*ndetail+12*ndv+8*ndt+16*nbv
    if noff or expected!=size:raise SystemExit(f'Tile {t} layout mismatch')
    p=104;verts=np.frombuffer(tile,'<f4',nvert*3,p).reshape(-1,3);p+=12*nvert
    polys=[struct.unpack_from('<I6H6HIBB',tile,p+36*k) for k in range(npoly)];p+=36*npoly
    links=[struct.unpack_from('<II4B',tile,p+12*k) for k in range(nlink)]
    tiles.append(dict(x=h[2],y=h[3],verts=verts,polys=polys,links=links,walk=h[16:19]))
if off!=len(data):raise SystemExit('Trailing navmesh data')

base=[];n=0
for t in tiles:base.append(n);n+=len(t['polys'])
vbase=[];nv=0
for t in tiles:vbase.append(nv);nv+=len(t['verts'])
vert_start=[0];vert_idx=[];link_start=[0];link_to=[];link_edge=[];link_lo=[];link_hi=[];flags=[];areas=[]
for ti,t in enumerate(tiles):
    for pi,(first,*rest) in enumerate(t['polys']):
        vs=rest[0:6];neis=rest[6:12];fl,vc,area=rest[12],rest[13],rest[14]
        vert_idx.extend(vbase[ti]+v for v in vs[:vc]);vert_start.append(len(vert_idx));flags.append(fl);areas.append(area&0x3f)
        out=[]
        for e in range(vc):
            if neis[e] and not neis[e]&EXT:out.append((base[ti]+neis[e]-1,e,0,255))
        l=first;guard=0
        while l!=NULL_LINK:
            ref,nxt,edge,side,lo,hi=t['links'][l]
            if side!=0xff and edge<vc and neis[edge]&EXT:
                nt=(ref>>poly_bits)&((1<<tile_bits)-1);np_=ref&((1<<poly_bits)-1)
                out.append((base[nt]+np_,edge,lo,hi))
            l=nxt;guard+=1
            if guard>64:raise SystemExit('Link loop')
        for to,e,lo,hi in out:link_to.append(to);link_edge.append(e);link_lo.append(lo);link_hi.append(hi)
        link_start.append(len(link_to))

pairs=set(zip(np.repeat(np.arange(n),np.diff(link_start)),link_to))
asym=sum(1 for a,b in pairs if (b,a) not in pairs)
files={
 'verts.f32':np.concatenate([t['verts'] for t in tiles]).astype('<f4'),
 'poly-verts.u32':np.array(vert_start,'<u4'),'poly-index.u32':np.array(vert_idx,'<u4'),
 'link-start.u32':np.array(link_start,'<u4'),'link-to.u32':np.array(link_to,'<u4'),
 'link-edge.u8':np.array(link_edge,'u1'),'link-range.u8':np.array(list(zip(link_lo,link_hi)),'u1').reshape(-1),
}
out_hash={}
for name,arr in files.items():
    b=arr.tobytes();(OUT/name).write_bytes(b);out_hash[name]=hashlib.sha256(b).hexdigest()
manifest={'source':'server bundles/navmesh.000.unity3d','sourceSHA256':{SOURCE.name:hashlib.sha256(SOURCE.read_bytes()).hexdigest()},
 'space':'unity','origin':orig,'tileWidth':tile_w,'tileHeight':tile_h,'tiles':ntiles,'polys':n,'verts':nv,'links':len(link_to),
 'asymmetricLinks':asym,'areas':sorted(set(areas)),'flags':sorted(set(flags)),
 'agent':{'walkableHeight':tiles[0]['walk'][0],'walkableRadius':tiles[0]['walk'][1],'walkableClimb':tiles[0]['walk'][2]},
 'outputSHA256':out_hash}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=1))
print(json.dumps({k:v for k,v in manifest.items() if k!='outputSHA256'}))
