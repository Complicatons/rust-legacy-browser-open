"""Static voice-chat export (USpeak in Rust Legacy). No original executable or managed code is loaded.

* MalePlayer (content/character/male/maleplayer) USpeaker serialized values: band, codec index, send rate, sending mode,
  VAD, 3D mode (browser/uspeak.mjs MALE_PLAYER_USPEAKER mirrors them; tests/uspeak.test.mjs compares when this exists).
* Resources/CodecManager (USpeakCodecManager in resources.assets): CodecNames / FriendlyNames in index order. The player
  build has no type tree for it, so the MonoBehaviour is read raw (Unity 4 layout: PPtr = int32 fileID + int32 pathID,
  strings = int32 length + bytes aligned to 4, arrays = int32 count + items).
* HUD pnlVoiceIcon subtree of rust/ui/game/HUD (dfPanel + dfLabel "\\uf130" with the VoiceChatIcon script), same node
  format as tools/export_chat.py; fonts resolve against the frontend export.
Writes browser/assets/recovered/voice/manifest.json."""
import json,struct
from unity_common import ROOT,Bundles,Writer,identity
import UnityPy
b=Bundles([ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data'],['gameobject.000.unity3d'])
out=ROOT/'browser/assets/recovered/voice';w=Writer(b,out)
frontend=json.loads((ROOT/'browser/assets/recovered/frontend/manifest.json').read_text(encoding='utf-8'))
a=b.asset('cab-gameobject.000')
ab=next(o.read_typetree() for o in a.objects.values() if o.type.name=='AssetBundle')
def container(name):
    objs=[b.resolve(a,v['asset']) for k,v in ab['m_Container'] if k.lower()==name]
    return next(o for o in objs if o.type.name=='GameObject')
def go_of(obj):return obj if obj.type.name=='GameObject' else b.resolve(obj.assets_file,obj.read_typetree()['m_GameObject'])

# ---- MalePlayer USpeaker ----
player=container('content/character/male/maleplayer')
cs=b.components(a,player.read_typetree())
assert 'USpeaker' in cs and 'VoiceCom' in cs,'MalePlayer must carry USpeaker + VoiceCom'
sp=cs['USpeaker'][0];uspeaker={k:v for k,v in sp.read_typetree().items() if k not in ('m_Script','m_GameObject','m_Name','m_Enabled')}
audio_sources=len(cs.get('AudioSource',[])) # USpeaker.Awake adds a default AudioSource when there is none

# ---- Resources/CodecManager ----
res=ROOT/'analysis/client-source/data/resources.assets'
codec=None
for asset in UnityPy.load(str(res)).assets:
    for o in asset.objects.values():
        if o.type.name!='MonoBehaviour':continue
        raw=o.get_raw_data()
        if b'CodecManager' not in raw or b'MuLawCodec' not in raw:continue
        p=0
        def i32():
            global p;v=struct.unpack_from('<i',raw,p)[0];p+=4;return v
        def string():
            global p;n=i32();s=raw[p:p+n].decode('utf-8');p+=n;p=(p+3)&~3;return s
        i32();i32()          # m_GameObject
        p+=4                 # m_Enabled (bool, aligned)
        i32();i32()          # m_Script
        name=string()
        names=[string() for _ in range(i32())]
        friendly=[string() for _ in range(i32())]
        assert p==len(raw),'CodecManager layout not fully consumed'
        codec={'name':name,'pathID':o.path_id,'codecNames':[n.split(',')[0] for n in names],'assemblyQualified':names,'friendlyNames':friendly}
assert codec,'Resources/CodecManager not found'

# ---- HUD pnlVoiceIcon ----
hud=container('rust/ui/game/hud')
KEEP={'dfPanel','dfLabel','VoiceChatIcon'}
def key(owner,ptr,table):
    if not ptr.get('m_PathID'):return None
    k=identity(b.resolve(owner,ptr))
    if k not in frontend[table]:raise ValueError(f'{table} {k} is not in the frontend export; run tools/export_frontend.py')
    return k
def tree(go):
    nodes=[]
    def walk(go,parent=-1):
        gd=go.read_typetree();comps=b.components(go.assets_file,gd);t=comps['Transform'][0].read_typetree();i=len(nodes);components={}
        for kind,objects in comps.items():
            if kind not in KEEP:continue
            values=[]
            for o in objects:
                d={k:v for k,v in o.read_typetree().items() if k not in ['m_Script','m_GameObject']};d['pathID']=o.path_id
                if d.get('atlas',{}).get('m_PathID'):d['atlasKey']=key(o.assets_file,d['atlas'],'atlases')
                if d.get('font',{}).get('m_PathID'):d['fontKey']=key(o.assets_file,d['font'],'fonts')
                values.append(d)
            components[kind]=values
        nodes.append({'name':gd['m_Name'],'parent':parent,'position':t['m_LocalPosition'],'active':gd['m_IsActive'],'components':components})
        for c in t['m_Children']:walk(go_of(b.resolve(go.assets_file,c)),i)
    walk(go);return nodes
hud_nodes=tree(hud)
icon=next(i for i,n in enumerate(hud_nodes) if 'VoiceChatIcon' in n['components'])
panel=hud_nodes[icon]['parent']
keep=sorted({0,panel,icon}|{j for j,n in enumerate(hud_nodes) if n['parent'] in (panel,icon)})
remap={old:new for new,old in enumerate(keep)}
nodes=[{**hud_nodes[i],'parent':remap.get(hud_nodes[i]['parent'],-1)} for i in keep]
manifest={'source':identity(player),'uspeaker':uspeaker,'uspeakerPathID':sp.path_id,'playerAudioSources':audio_sources,
 'codecManager':codec,'codecNames':codec['codecNames'],
 'hud':{'source':identity(hud),'nodes':nodes,'icon':remap[icon],'panel':remap[panel]},
 'conversion':'Serialized USpeaker fields as stored; CodecNames are type names without the assembly suffix. HUD nodes keep dfControl sizes/margins/anchors/colours (packed Color32, r in the low byte); VoiceChatIcon drives dfLabel.Opacity at runtime.'}
w.finish(manifest)
print(json.dumps({'uspeaker':uspeaker,'codecs':codec['codecNames'],'hud':[n['name'] for n in nodes]}))
