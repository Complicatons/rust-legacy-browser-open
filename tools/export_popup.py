"""Static PopupUI (notice.inventory / notice.popup) prefab export. No original executable or managed code is loaded."""
import json
from unity_common import ROOT,Bundles,Writer,identity
b=Bundles([ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data'],['gameobject.000.unity3d'])
out=ROOT/'browser/assets/recovered/popup';w=Writer(b,out)
ui=None
for asset in list(b.assets.values()):
    for obj in list(asset.objects.values()):
        if obj.type.name!='MonoBehaviour':continue
        try:d=obj.read_typetree()
        except Exception:continue
        if b.script(obj,d)=='PopupUI':ui=(obj,d)
if ui is None:raise ValueError('PopupUI component not found')
ui_obj,ui_data=ui
def go_of(obj):return obj if obj.type.name=='GameObject' else b.resolve(obj.assets_file,obj.read_typetree()['m_GameObject'])
def ref(owner,ptr):
    o=b.resolve(owner,ptr) if ptr and ptr.get('m_PathID') else None
    return identity(o) if o is not None else None
KEEP={'dfPanel','dfSprite','dfSlicedSprite','dfRichTextLabel','dfTweenVector3','PopupInventory','PopupNotice'}
def prefab(ptr):
    root=go_of(b.resolve(ui_obj.assets_file,ptr));nodes=[]
    def walk(go,parent=-1):
        gd=go.read_typetree();cs=b.components(go.assets_file,gd);t=cs['Transform'][0].read_typetree();i=len(nodes);components={}
        for kind,objects in cs.items():
            if kind not in KEEP:continue
            values=[]
            for o in objects:
                d={k:v for k,v in o.read_typetree().items() if k not in ['m_Script','m_GameObject']};d['id']=identity(o)
                # Resolve serialized object references to source identities (fonts/atlases resolve against the frontend export).
                for k in ['font','atlas','labelText','labelIcon','tweenOut']:
                    if isinstance(d.get(k),dict) and 'm_PathID' in d[k]:d[k+'Key']=ref(o.assets_file,d[k])
                if 'target' in d:d['target']={'component':ref(o.assets_file,d['target']['Component']),'member':d['target']['MemberName']}
                values.append(d)
            components[kind]=values
        nodes.append({'name':gd['m_Name'],'parent':parent,'active':gd['m_IsActive'],'components':components})
        for p in t['m_Children']:
            c=b.resolve(go.assets_file,p);walk(go_of(c),i)
    walk(root);return {'source':identity(root),'nodes':nodes}
manifest={'source':identity(ui_obj),'panel':go_of(ui_obj).read_typetree()['m_Name'],'inventory':prefab(ui_data['prefabInventory']),'notice':prefab(ui_data['prefabNotice']),
 'conversion':'Original dfControl sizes/margins/colours (packed Color32 rgba), dfTweenVector3 curves and PopupUI prefab references; fonts and atlas sprites resolve against the frontend export.'}
w.finish(manifest)
print(json.dumps({'inventory':[n['name'] for n in manifest['inventory']['nodes']],'notice':[n['name'] for n in manifest['notice']['nodes']]}))
