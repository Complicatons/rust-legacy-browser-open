"""Shared static Unity export helpers (data bundles only; no target code is loaded)."""
from pathlib import Path
import sys,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/python'))
import UnityPy
import numpy as np
from UnityPy.helpers.MeshHelper import MeshHandler
H=np.diag([1.,1.,-1.,1.])

def trs(t):
    q=t['m_LocalRotation'];x,y,z,w=[q[k] for k in 'xyzw']
    r=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])
    m=np.eye(4);m[:3,:3]=r@np.diag([t['m_LocalScale'][k] for k in 'xyz']);m[:3,3]=[t['m_LocalPosition'][k] for k in 'xyz'];return m

class Bundles:
    """A set of Unity serialized files that resolve external pointers lazily from one directory."""
    def __init__(self,source,files):
        # `source` may be one directory or a list searched in order (e.g. bundles, then loose data files).
        self.dirs=[Path(p) for p in (source if isinstance(source,(list,tuple)) else [source])];self.source=self.dirs[0]
        self.assets={};self.sources={};self.scripts={}
        for f in files:self.load(self.find(f))
    def find(self,name):
        for d in self.dirs:
            if (d/name).exists():return d/name
        raise ValueError('Missing dependency: '+name)
    def load(self,path):
        self.sources[path.name]=hashlib.sha256(path.read_bytes()).hexdigest()
        for a in UnityPy.load(str(path)).assets:self.assets[a.name.lower()]=a
    def asset(self,name):return self.assets[name.lower()]
    def resolve(self,owner,ptr):
        if not ptr['m_PathID']:return None
        if not ptr['m_FileID']:a=owner
        else:
            key=owner.externals[ptr['m_FileID']-1].path.lower().split('/')[-1]
            if key not in self.assets:self.load(self.find(key.removeprefix('cab-')+'.unity3d' if key.startswith('cab-') else key))
            a=self.assets[key]
        return a.objects[ptr['m_PathID']]
    def script(self,obj,d):
        k=obj.assets_file.name+json.dumps(d['m_Script'],sort_keys=True)
        if k not in self.scripts:
            try:self.scripts[k]=self.resolve(obj.assets_file,d['m_Script']).read_typetree()['m_ClassName']
            except Exception:self.scripts[k]=None
        return self.scripts[k]
    def components(self,owner,go):
        out={}
        for c in go['m_Component']:
            p=c[1] if isinstance(c,(tuple,list)) else c['component'];co=self.resolve(owner,p)
            if co is None:continue
            name=co.type.name
            if name=='MonoBehaviour':name=self.script(co,co.read_typetree()) or 'MonoBehaviour'
            out.setdefault(name,[]).append(co)
        return out

def identity(obj):return obj.assets_file.name.lower()+':'+str(obj.path_id)
def token(text):return hashlib.sha256(text.encode()).hexdigest()[:20]

class Writer:
    """Writes meshes/materials/textures in the browser manifest format (Unity Z reflected, winding reversed)."""
    def __init__(self,bundles,out,namespace=''):
        # `namespace` keeps keys apart when two builds share bundle names (client vs server mesh.000).
        self.ns=namespace;self.b=bundles;self.out=Path(out);self.out.mkdir(parents=True,exist_ok=True);self.meshes={};self.materials={};self.textures={}
    def binary(self,name,values,dtype):
        a=np.asarray(values,dtype=dtype);a.tofile(self.out/name);return {'file':name,'count':int(a.size)}
    def texture(self,obj):
        key=self.ns+identity(obj)
        if key not in self.textures:
            image=obj.read().image;filename='texture-'+token(key)+'.png';image.save(self.out/filename)
            self.textures[key]={'file':filename,'width':image.width,'height':image.height,'source':key}
        return self.textures[key]['file']
    def material(self,obj):
        key=self.ns+identity(obj)
        if key not in self.materials:
            d=obj.read_typetree();props=d['m_SavedProperties']
            envs={k['name']:v for k,v in props['m_TexEnvs']};floats={k['name']:v for k,v in props['m_Floats']};colors={k['name']:v for k,v in props['m_Colors']}
            main=envs.get('_MainTex');tex=self.b.resolve(obj.assets_file,main['m_Texture']) if main else None
            # Every texture slot with its tiling, so special shaders (e.g. the overlay rocks) can be reproduced.
            slots={}
            for name,env in envs.items():
                t=self.b.resolve(obj.assets_file,env['m_Texture']) if env['m_Texture']['m_PathID'] else None
                if t is not None and t.type.name=='Texture2D':slots[name]={'file':self.texture(t),'scale':env['m_Scale'],'offset':env['m_Offset']}
            self.materials[key]={'name':d['m_Name'],'shader':self.shader_name(obj.assets_file,d['m_Shader']),'texture':self.texture(tex) if tex else None,'color':colors.get('_Color',{'r':1,'g':1,'b':1,'a':1}),'cutoff':floats.get('_Cutoff'),'offset':main.get('m_Offset') if main else None,'scale':main.get('m_Scale') if main else None,
                'textures':slots,'floats':floats,'colors':colors,'source':key}
        return key
    shader_names={}
    def shader_name(self,owner,ptr):
        """ShaderLab name from the compiled shader source's first line (e.g. Enviro/BumpedDiffuseOverlaySM3)."""
        try:
            s=self.b.resolve(owner,ptr)
            if s is None:return None
            k=identity(s)
            if k not in self.shader_names:
                script=s.read_typetree().get('m_Script') or ''
                script=script if isinstance(script,str) else bytes(script).decode('latin1')
                line=script.split('\n',1)[0]
                self.shader_names[k]=line.split('"')[1] if line.startswith('Shader "') else s.read_typetree().get('m_Name')
            return self.shader_names[k]
        except Exception:return None
    def raw_mesh(self,obj):
        h=MeshHandler(obj.read());h.process()
        v=np.array(h.m_Vertices,dtype='<f4')[:,:3].copy();v[:,2]*=-1
        n=np.array(h.m_Normals,dtype='<f4')[:,:3].copy() if h.m_Normals else np.zeros((0,3),'<f4')
        if len(n):n[:,2]*=-1
        u=np.array(h.m_UV0,dtype='<f4')[:,:2] if h.m_UV0 else np.zeros((0,2),'<f4')
        parts=[np.asarray(t,dtype='<u4').reshape(-1,3)[:,[0,2,1]] for t in h.get_triangles()]
        return v,n,u,parts
    def mesh(self,obj):
        key=self.ns+identity(obj)
        if key not in self.meshes:
            v,n,u,parts=self.raw_mesh(obj);prefix='mesh-'+token(key)
            self.meshes[key]={'name':obj.read().m_Name,'position':self.binary(prefix+'-position.bin',v,'<f4'),'normal':self.binary(prefix+'-normal.bin',n,'<f4') if len(n) else None,'uv':self.binary(prefix+'-uv.bin',u,'<f4') if len(u) else None,
                'parts':[self.binary(prefix+f'-indices-{i}.bin',p,'<u4') for i,p in enumerate(parts)],'bounds':[v.min(axis=0).tolist(),v.max(axis=0).tolist()],'source':key}
        return key
    def finish(self,manifest,name='manifest.json'):
        manifest.update(meshes=self.meshes,materials=self.materials,textures=self.textures,sourceSHA256=self.b.sources)
        manifest['outputSHA256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(self.out.iterdir()) if p.is_file() and p.name!=name}
        (self.out/name).write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
