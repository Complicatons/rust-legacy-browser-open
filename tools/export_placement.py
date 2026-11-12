"""Static export of the original placement preview (data bundles only; no target code is loaded).

Client StructureComponentItem.RenderPlacementHelpers and DeployableItem.RenderDeployPreview draw the item's prefab
through PrefabRenderer.RenderOneMaterial with the datablock's `overrideMat`, and deployables add their `aimGizmo`
(GameGizmo / GameGizmoWaveAnimation / GameGizmoWaveAnimationCarrier ScriptableObjects). This writes, to
browser/assets/recovered/placement/:
  items     item key -> {item, kind, prefab (NGC name), overrideMat, aimGizmo}
  prefabs   NGC name -> parts [{mesh, submesh, renderer, layer}] in PrefabRenderer.Refresh order: every enabled MeshRenderer /
            SkinnedMeshRenderer under the root (inactive objects included), names ending "-lod" / "_LOD_LOWEST" skipped,
            materials whose shader carries "IgnorePrefabRenderer" skipped; submesh = the running index of the drawn
            materials, as RenderOneMaterial counts it. Every part is drawn at the root matrix (child transforms unused).
  gizmos    serialized GameGizmo fields, mesh and materials
  materials / meshes / textures in the usual manifest format (unity_common.Writer).
Usage: python tools/export_placement.py
"""
import json,collections
from unity_common import ROOT,Bundles,Writer,identity

CLIENT=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data']
OUT=ROOT/'browser/assets/recovered/placement'
OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
b=Bundles(CLIENT,['gameobject.000.unity3d','gameobject.001.unity3d','scriptableobject.000.unity3d','sharedassets0.assets'])
writer=Writer(b,OUT);issues=collections.Counter()
items=json.loads((ROOT/'browser/assets/recovered/items/manifest.json').read_text(encoding='utf-8'))['items']
deploy=json.loads((ROOT/'browser/assets/recovered/deployables/manifest.json').read_text(encoding='utf-8'))

def asset_of(source):
    name,pid=source.rsplit(':',1)
    return b.asset(name).objects[int(pid)]

shader_tags={}
def ignores_prefab_renderer(material):
    """Material.GetTag("IgnorePrefabRenderer") == "True". Only Context/Sprite sets it (as "true" in the compiled text;
    its CenteredContextMesh is 96 units wide, so the original evidently skipped it)."""
    if material is None:return False
    d=material.read_typetree();s=b.resolve(material.assets_file,d['m_Shader'])
    if s is None:return False
    k=identity(s)
    if k not in shader_tags:
        script=s.read_typetree().get('m_Script') or ''
        script=script if isinstance(script,str) else bytes(script).decode('latin1')
        shader_tags[k]='"ignoreprefabrenderer"="true"' in script.lower()
    return shader_tags[k]

prefabs={}
def preview_parts(name,source):
    if name in prefabs:return name
    root=asset_of(source);owner=root.assets_file;parts=[]
    def walk(go_obj):
        g=go_obj.read_typetree();cs=b.components(owner,g)
        renderer=next(iter(cs.get('MeshRenderer',[])+cs.get('SkinnedMeshRenderer',[])),None)
        lname=g['m_Name'].lower()
        if renderer is not None:
            rd=renderer.read_typetree()
            if rd['m_Enabled'] and not lname.endswith('-lod') and not lname.endswith('_lod_lowest'):
                if renderer.type.name=='MeshRenderer':
                    mf=next(iter(cs.get('MeshFilter',[])),None);mesh_ptr=mf.read_typetree()['m_Mesh'] if mf else None
                else:mesh_ptr=rd['m_Mesh']
                mesh=b.resolve(owner,mesh_ptr) if mesh_ptr else None
                if mesh is None:issues['renderer without mesh']+=1
                else:
                    key=writer.mesh(mesh);n=0
                    for p in rd['m_Materials']:
                        if ignores_prefab_renderer(b.resolve(owner,p)):continue
                        parts.append({'mesh':key,'submesh':n,'renderer':g['m_Name'],'layer':g['m_Layer']});n+=1
        t=cs['Transform'][0].read_typetree()
        for c in t['m_Children']:walk(b.resolve(owner,b.resolve(owner,c).read_typetree()['m_GameObject']))
    walk(root)
    prefabs[name]={'name':root.read_typetree()['m_Name'],'source':source,'parts':parts}
    return name

GIZMO_FIELDS=['_castShadows','_receiveShadows','_layer','_good','_bad','_minAlpha','_maxAlpha','alternateArrowDirection','frequency','amplitudePositive','amplitudeNegative','phase','axis','hideArrowWhenCarrierExists']
gizmos={}
def gizmo(owner,ptr):
    obj=b.resolve(owner,ptr) if ptr and ptr.get('m_PathID') else None
    if obj is None:return None
    key=identity(obj)
    if key not in gizmos:
        d=obj.read_typetree();mesh=b.resolve(obj.assets_file,d['_mesh'])
        gizmos[key]={'name':d['m_Name'],'class':b.script(obj,d),'mesh':writer.mesh(mesh) if mesh else None,
            'materials':[writer.material(b.resolve(obj.assets_file,p)) for p in d['_materials'] if p['m_PathID']],
            'carrierMaterials':[writer.material(b.resolve(obj.assets_file,p)) for p in d.get('carrierMaterials',[]) if p['m_PathID']],
            **{k.lstrip('_'):d[k] for k in GIZMO_FIELDS if k in d}}
    return key

so=b.asset('cab-scriptableobject.000');out_items={}
for key,item in items.items():
    if item['class'] not in ('StructureComponentDataBlock','DeployableItemDataBlock','DeployableInventoryDataBlock'):continue
    entry=deploy['structures'].get(key) or deploy['deployables'].get(key)
    if not entry or not entry.get('prefab'):issues['no prefab '+item['data']['m_Name']]+=1;continue
    obj=asset_of(item['source']);d=obj.read_typetree();owner=obj.assets_file
    mat=b.resolve(owner,d['overrideMat']) if d.get('overrideMat',{}).get('m_PathID') else None
    prefab=deploy['prefabs'][entry['prefab']]
    out_items[key]={'item':d['m_Name'],'kind':'structure' if item['class']=='StructureComponentDataBlock' else 'deployable','prefab':preview_parts(entry['prefab'],prefab['source']),
        'overrideMat':writer.material(mat) if mat else None,'aimGizmo':gizmo(owner,d.get('aimGizmo'))}

manifest={'source':'client StructureComponentItem/DeployableItem placement preview, PrefabRenderer, GameGizmo*','items':out_items,'prefabs':prefabs,'gizmos':gizmos,
    'shaders':sorted({m['shader'] for m in writer.materials.values()}),'issues':dict(issues)}
writer.finish(manifest)
print('items',len(out_items),'prefabs',len(prefabs),'gizmos',len(gizmos),'materials',[(m['name'],m['shader']) for m in writer.materials.values()],'meshes',len(writer.meshes),'issues',dict(issues))
