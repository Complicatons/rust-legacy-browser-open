"""Static ChatUI (pnlChat in the rust/ui/game/HUD prefab) + ChatLine prefab export. No original executable or managed code is loaded.

ChatUI.textInput (dfTextbox + TextQuotes icon), chatContainer (stacked by ChatUI.ReLayout on ControlAdded/ControlRemoved),
chatLine (pnlChatLine: ChatLine lblName/lblText, TimedObjectDestructor timeOut), dfControlKeyBinding (Escape -> CancelChatting,
Return -> SendChat) and dfEventBinding (LostFocus -> CancelChatting) are kept with their serialized values. Node format matches
tools/export_frontend.py (components keyed by script, `pathID`, `fontKey`/`atlasKey` resolved against the frontend export)."""
import json
from unity_common import ROOT,Bundles,Writer,identity
b=Bundles([ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data'],['gameobject.000.unity3d'])
out=ROOT/'browser/assets/recovered/chat';w=Writer(b,out)
frontend=json.loads((ROOT/'browser/assets/recovered/frontend/manifest.json').read_text(encoding='utf-8'))
a=b.asset('cab-gameobject.000')
# The HUD prefab is the bundle container entry rust/ui/game/HUD; ChatUI sits on its pnlChat child.
ab=next(o.read_typetree() for o in a.objects.values() if o.type.name=='AssetBundle')
hud=[b.resolve(a,v['asset']) for k,v in ab['m_Container'] if k.lower()=='rust/ui/game/hud']
hud=next(o for o in hud if o.type.name=='GameObject')
KEEP={'dfPanel','dfLabel','dfTextbox','dfRichTextLabel','ChatUI','ChatLine','TimedObjectDestructor','dfControlKeyBinding','dfEventBinding'}
def go_of(obj):return obj if obj.type.name=='GameObject' else b.resolve(obj.assets_file,obj.read_typetree()['m_GameObject'])
def key(owner,ptr,table):
    if not ptr.get('m_PathID'):return None
    k=identity(b.resolve(owner,ptr))
    if k not in frontend[table]:raise ValueError(f'{table} {k} is not in the frontend export; run tools/export_frontend.py')
    return k
def tree(go):
    nodes=[]
    def walk(go,parent=-1):
        gd=go.read_typetree();cs=b.components(go.assets_file,gd);t=cs['Transform'][0].read_typetree();i=len(nodes);components={}
        for kind,objects in cs.items():
            if kind not in KEEP:continue
            values=[]
            for o in objects:
                d={k:v for k,v in o.read_typetree().items() if k not in ['m_Script','m_GameObject']};d['pathID']=o.path_id
                if d.get('atlas',{}).get('m_PathID'):d['atlasKey']=key(o.assets_file,d['atlas'],'atlases')
                if d.get('font',{}).get('m_PathID'):d['fontKey']=key(o.assets_file,d['font'],'fonts')
                values.append(d)
            components[kind]=values
        nodes.append({'name':gd['m_Name'],'parent':parent,'position':t['m_LocalPosition'],'active':gd['m_IsActive'],'components':components})
        for p in t['m_Children']:walk(go_of(b.resolve(go.assets_file,p)),i)
    walk(go);return nodes
hud_nodes=tree(hud)
chat_index=next(i for i,n in enumerate(hud_nodes) if 'ChatUI' in n['components'])
ui=hud_nodes[chat_index]['components']['ChatUI'][0]
# Only the HUD root and the pnlChat subtree (pnlPopup/pnlVoiceIcon belong to other exports).
keep=[0];stack=[chat_index]
while stack:
    i=stack.pop();keep.append(i);stack.extend(j for j,n in enumerate(hud_nodes) if n['parent']==i)
keep=sorted(set(keep));remap={old:new for new,old in enumerate(keep)}
nodes=[{**hud_nodes[i],'parent':remap.get(hud_nodes[i]['parent'],-1)} for i in keep]
line=b.resolve(a,{'m_FileID':0,'m_PathID':ui['chatLine']['m_PathID']})
manifest={'source':identity(hud),'chatUI':ui['pathID'],'textInput':ui['textInput']['m_PathID'],'chatContainer':ui['chatContainer']['m_PathID'],
 'hud':{'nodes':nodes},'chatLine':{'source':identity(go_of(line)),'nodes':tree(go_of(line))},
 'conversion':'Original dfControl sizes/margins/anchors/colours (packed Color32 rgba, r in the low byte); component pathIDs link ChatUI/ChatLine/key and event bindings; fonts and atlas resolve against the frontend export.'}
w.finish(manifest)
print(json.dumps({'hud':[n['name'] for n in nodes],'chatLine':[n['name'] for n in manifest['chatLine']['nodes']]}))
