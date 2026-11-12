"""Static legacy skeleton/skin/clip export. Unity coordinates; consumers reflect Z and winding."""
import collections
from unity_common import token
import numpy as np
from UnityPy.helpers.MeshHelper import MeshHandler

def skeleton(b,root):
    nodes=[];indices={};paths={};owner=root.assets_file
    def walk(o,parent,path):
        t=o.read_typetree();g=b.resolve(owner,t['m_GameObject']).read_typetree()
        i=len(nodes);indices[o.path_id]=i;paths[path]=i
        nodes.append({'name':g['m_Name'],'parent':parent,'path':path,'active':bool(g['m_IsActive']),
            'position':[t['m_LocalPosition'][k] for k in 'xyz'],
            'rotation':[t['m_LocalRotation'][k] for k in 'xyzw'],
            'scale':[t['m_LocalScale'][k] for k in 'xyz']})
        for p in t['m_Children']:
            c=b.resolve(owner,p);name=b.resolve(owner,c.read_typetree()['m_GameObject']).read_typetree()['m_Name']
            walk(c,i,(path+'/' if path else '')+name)
    walk(root,-1,'')
    return nodes,indices,paths

def skin(b,writer,smr,indices,key):
    owner=smr.assets_file;d=smr.read_typetree()
    return skin_mesh(writer,b.resolve(owner,d['m_Mesh']),[indices[b.resolve(owner,p).path_id] for p in d['m_Bones']],
        [writer.material(b.resolve(owner,p)) for p in d['m_Materials']],key)

def skin_mesh(writer,mobj,bones,materials,key):
    h=MeshHandler(mobj.read());h.process();md=mobj.read_typetree();p='skin-'+token(key)
    def binary(suffix,a,dtype):return writer.binary(p+'-'+suffix+'.bin',a,dtype)
    return {'name':md['m_Name'],
        'position':binary('position',np.array(h.m_Vertices)[:,:3],'<f4'),
        'normal':binary('normal',np.array(h.m_Normals)[:,:3],'<f4'),
        'uv':binary('uv',np.array(h.m_UV0)[:,:2],'<f4'),
        'skinIndex':binary('skinindex',h.m_BoneIndices,'<u2'),'skinWeight':binary('skinweight',h.m_BoneWeights,'<f4'),
        'parts':[binary('indices-'+str(i),np.asarray(t).reshape(-1,3)[:,[0,2,1]],'<u4') for i,t in enumerate(h.get_triangles())],
        'bones':bones,
        'bindposes':[[bp[f'e{r}{c}'] for c in range(4) for r in range(4)] for bp in md['m_BindPose']],
        'materials':materials}

def clip(obj,paths,issues=None):
    d=obj.read_typetree()
    if d['m_Compressed']:raise ValueError('Compressed clip: '+d['m_Name'])
    tracks=collections.defaultdict(dict);length=0
    for kind,field,comps in [('rotation','m_RotationCurves','xyzw'),('position','m_PositionCurves','xyz'),('scale','m_ScaleCurves','xyz')]:
        for c in d[field]:
            if c['path'] not in paths:
                if issues is None:raise ValueError('Unbound curve: '+c['path'])
                issues.add(d['m_Name']+':'+c['path']);continue
            keys=c['curve']['m_Curve'];times=[k['time'] for k in keys];length=max(length,times[-1] if times else 0)
            tracks[paths[c['path']]][kind]={'times':times,'values':[k['value'][x] for k in keys for x in comps]}
    return {'name':d['m_Name'],'length':length,'wrapMode':d['m_WrapMode'],'tracks':[{'bone':i,**t} for i,t in sorted(tracks.items())]}
