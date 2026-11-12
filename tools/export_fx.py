"""Static export of the effect data the browser particle/light port needs beyond tools/export_deployables.py:

- LightStylist components on the exported deployable/held-light prefabs (lights, _mask, _lightStyle) and the LightStyle
  assets they reference. The only shipped style ("fire", resources.assets) is a LightStyleCurve: its serialized fields
  have no type tree in the bundle, so the MonoBehaviour body is parsed from the raw bytes (m_Name, AnimationCurve).
- Legacy particle components (EllipsoidParticleEmitter / ParticleAnimator / ParticleRenderer) on those prefabs: the
  first-person flare light (FlareLightLegacy1P) uses them instead of Shuriken.
- Meshes referenced by Shuriken renderers in Mesh render mode and by Mesh emission shapes (death-effect debris).
- ViewModel barrel-aiming fields tools/export_viewmodels.py does not keep (barrelAngleSmoothDamp, barrelAngleMaxSpeed,
  barrelLimitOffsetFactor, barrelLimitPivotFactor, aimMask) and the ViewModel transform's localScale.
- Evidence for FX/HeatDistort: every material using it and whether its renderer's GameObject is active.

Data bundles only; nothing is executed. Node indices follow export_deployables.py's depth-first transform walk.
"""
import json,struct,collections
from unity_common import ROOT,Bundles,Writer,identity

CLIENT=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data',ROOT/'analysis/world-source/bundles']
OUT=ROOT/'browser/assets/recovered/fx'
OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
b=Bundles(CLIENT,['gameobject.000.unity3d','gameobject.001.unity3d','scriptableobject.000.unity3d','sharedassets0.assets'])
writer=Writer(b,OUT);issues=collections.Counter()
deploy=json.loads((ROOT/'browser/assets/recovered/deployables/manifest.json').read_text())

def plain(d):return {k:v for k,v in d.items() if k not in ('m_Script','m_GameObject','m_Name')}

def parse_curve_style(obj):
    """LightStyleCurve body: MonoBehaviour header (PPtr m_GameObject, m_Enabled, PPtr m_Script, m_Name) then
    AnimationCurve curve (Keyframe time/value/inSlope/outSlope, m_PreInfinity, m_PostInfinity). Unity 4 PPtrs are 8 bytes."""
    raw=bytes(obj.get_raw_data());o=0
    def i32():
        nonlocal o;v=struct.unpack_from('<i',raw,o)[0];o+=4;return v
    def f32():
        nonlocal o;v=struct.unpack_from('<f',raw,o)[0];o+=4;return v
    i32();i32()            # m_GameObject
    i32()                  # m_Enabled (uint8 + align)
    i32();i32()            # m_Script
    n=i32();name=raw[o:o+n].decode('utf-8');o+=n;o=(o+3)&~3
    count=i32();keys=[{'time':f32(),'value':f32(),'inSlope':f32(),'outSlope':f32()} for _ in range(count)]
    pre=i32();post=i32()
    if o!=len(raw):raise ValueError(f'LightStyle {name}: consumed {o} of {len(raw)} bytes')
    return {'name':name,'class':'LightStyleCurve','curve':{'m_Curve':keys,'m_PreInfinity':pre,'m_PostInfinity':post},'rawBytes':len(raw)}

styles={}
def style(owner,ptr):
    if not ptr or not ptr.get('m_PathID'):return None
    obj=b.resolve(owner,ptr)
    if obj is None:issues['missing light style']+=1;return None
    key=identity(obj)
    if key not in styles:
        d=None
        try:d=obj.read_typetree()
        except Exception:pass
        cls=b.script(obj,d) if d else None
        if d and 'curve' in d:styles[key]={'name':d['m_Name'],'class':cls,'curve':d['curve']}
        else:
            styles[key]=parse_curve_style(obj)
            if cls and cls!='LightStyleCurve':issues['unexpected style class '+cls]+=1
    return key

mesh_cache={}
def mesh(owner,ptr):
    if not ptr or not ptr.get('m_PathID'):return None
    obj=b.resolve(owner,ptr)
    if obj is None:issues['missing mesh']+=1;return None
    return writer.mesh(obj)

prefabs={};heat=[]
for pkey,p in deploy['prefabs'].items():
    if not p or not p.get('source'):continue
    asset_name,path_id=p['source'].rsplit(':',1)
    a=b.asset(asset_name);root=a.objects[int(path_id)];owner=root.assets_file
    nodes=[];light_node={};entry=collections.defaultdict(list)
    def walk(t_obj,active):
        t=t_obj.read_typetree();g=b.resolve(owner,t['m_GameObject']).read_typetree();cs=b.components(owner,g)
        i=len(nodes);on=active and bool(g['m_IsActive']);nodes.append({'name':g['m_Name'],'active':on})
        for light in cs.get('Light',[]):light_node[light.path_id]=i
        for kind,objs in cs.items():
            for o in objs:
                if kind=='LightStylist':
                    d=o.read_typetree()
                    entry['stylists'].append({'node':i,'active':on,'enabled':bool(d['m_Enabled']),'mask':d['_mask'],'lightPathIDs':[l['m_PathID'] for l in d['lights']],'style':style(owner,d['_lightStyle'])})
                elif kind in ('EllipsoidParticleEmitter','ParticleAnimator'):
                    entry['legacy'].append({'node':i,'kind':kind,'active':on,'data':plain(o.read_typetree())})
                elif kind=='ParticleRenderer':
                    d=o.read_typetree()
                    entry['legacy'].append({'node':i,'kind':kind,'active':on,'materials':[writer.material(b.resolve(owner,m)) for m in d['m_Materials'] if m['m_PathID']],'data':plain({k:v for k,v in d.items() if k!='m_Materials'})})
                elif kind=='ParticleSystemRenderer':
                    d=o.read_typetree()
                    if d.get('m_RenderMode')==4:entry['renderMeshes'].append({'node':i,'meshes':[k for k in (mesh(owner,d.get(f)) for f in ('m_Mesh','m_Mesh1','m_Mesh2','m_Mesh3')) if k]})
                    for m in d['m_Materials']:
                        mo=b.resolve(owner,m) if m['m_PathID'] else None
                        if mo is not None and writer.shader_name(mo.assets_file,mo.read_typetree()['m_Shader'])=='FX/HeatDistort':
                            heat.append({'prefab':pkey,'name':p['name'],'node':i,'nodeName':g['m_Name'],'active':on,'material':mo.read_typetree()['m_Name']})
                elif kind=='ParticleSystem':
                    d=o.read_typetree();sh=d.get('ShapeModule',{})
                    if sh.get('enabled') and sh.get('type')==6:entry['shapeMeshes'].append({'node':i,'mesh':mesh(owner,sh.get('m_Mesh'))})
        for c in t['m_Children']:walk(b.resolve(owner,c),on)
    walk(b.components(owner,root.read_typetree())['Transform'][0],True)
    for s in entry.get('stylists',[]):
        s['lights']=[light_node.get(pid) for pid in s.pop('lightPathIDs') if pid]
        if any(n is None for n in s['lights']):issues['stylist light outside prefab']+=1
    if entry:prefabs[pkey]={'name':p['name'],'source':p['source'],**{k:v for k,v in entry.items()}}

# ViewModel barrel-aiming fields not in viewmodels/manifest.json settings.
BARREL=['barrelAngleSmoothDamp','barrelAngleMaxSpeed','barrelLimitOffsetFactor','barrelLimitPivotFactor','aimMask','noHitPlane']
def finite(v):
    if isinstance(v,float) and v!=v:return None
    if v==float('inf'):return 'Infinity'
    if v==float('-inf'):return '-Infinity'
    return v
viewmodels={}
for a in list(b.assets.values()):
    for o in a.objects.values():
        if o.type.name!='MonoBehaviour':continue
        try:d=o.read_typetree()
        except Exception:continue
        if '_viewModelPrefab' not in d or not d['_viewModelPrefab']['m_PathID']:continue
        vm=b.resolve(o.assets_file,d['_viewModelPrefab'])
        if vm is None or identity(vm) in viewmodels:continue
        vmd=vm.read_typetree();go=b.resolve(vm.assets_file,vmd['m_GameObject']).read_typetree()
        t=b.components(vm.assets_file,go)['Transform'][0].read_typetree()
        viewmodels[identity(vm)]={'name':go['m_Name'],'localScale':[t['m_LocalScale'][k] for k in 'xyz'],
            **{k:(vmd[k]['m_Bits'] if k=='aimMask' else finite(vmd[k])) for k in BARREL if k in vmd}}

# The world scene's WindZone (Shuriken External Forces scale its force). Scene bundle read statically.
import UnityPy
wind=None
for a in UnityPy.load(str(ROOT/'analysis/world-source/bundles/scenes.unity3d')).assets:
    for o in a.objects.values():
        if o.type.name!='WindZone':continue
        d=o.read_typetree();g=a.objects[d['m_GameObject']['m_PathID']].read_typetree()
        tr=next(a.objects[(c[1] if isinstance(c,(list,tuple)) else c['component'])['m_PathID']] for c in g['m_Component'] if a.objects[(c[1] if isinstance(c,(list,tuple)) else c['component'])['m_PathID']].type.name=='Transform').read_typetree()
        if tr['m_Father']['m_PathID']:issues['parented wind zone']+=1
        q=tr['m_LocalRotation'];x,y,z,w=q['x'],q['y'],q['z'],q['w']
        forward=[2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)]
        wind={'scene':a.name,'active':bool(g['m_IsActive']),'enabled':bool(d['m_Enabled']),'mode':d['m_Mode'],'radius':d['m_Radius'],'windMain':d['m_WindMain'],'windTurbulence':d['m_WindTurbulence'],
              'windPulseMagnitude':d['m_WindPulseMagnitude'],'windPulseFrequency':d['m_WindPulseFrequency'],'forward':forward}
writer.finish({'lightStyles':styles,'wind':wind,'prefabs':prefabs,'viewmodels':viewmodels,'heatDistort':heat,'summary':dict(issues),
    'notes':'Light/node indices follow export_deployables.py node order. LightStyle.time = NetCull.time online, Time.time offline. '
            'Meshes are browser space (Z reflected, winding reversed) like the deployables export.'})
print(json.dumps({'styles':{k:v['name'] for k,v in styles.items()},'prefabs':{k:{x:len(y) for x,y in v.items() if isinstance(y,list)} for k,v in prefabs.items()},'heat':heat,'viewmodels':len(viewmodels),'issues':dict(issues)},indent=1))
