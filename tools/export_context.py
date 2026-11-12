"""Static ContextUI (hold-E context menu) export: the CONTEXT GameObject's ContextUI GUISkin custom styles "ctxbox" and
"ctxbutton" (backgrounds, borders, margins, padding, overflow, font, size, alignment, text colours) from
BuildPlayer-LevelShared and the client guiskin.000 bundle. Data files only; nothing is executed.

Needs analysis/client-source/bundles/guiskin.000.unity3d (a data bundle from the client archive
analysis/installer-payload/Setup.bin: 7z e Setup.bin bundles/guiskin.000.unity3d)."""
import json
from unity_common import ROOT,Bundles,Writer,identity,token
b=Bundles([ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data'],['scenes.unity3d'])
out=ROOT/'browser/assets/recovered/context';w=Writer(b,out)
ui=None
for asset in list(b.assets.values()):
    for obj in list(asset.objects.values()):
        if obj.type.name!='MonoBehaviour':continue
        try:d=obj.read_typetree()
        except Exception:continue
        if b.script(obj,d)=='ContextUI':ui=(obj,d)
if ui is None:raise ValueError('ContextUI component not found')
obj,d=ui
go=b.resolve(obj.assets_file,d['m_GameObject']).read_typetree()
skin=b.resolve(obj.assets_file,d['skin']);s=skin.read_typetree()
fonts={}
def font(ptr):
    f=b.resolve(skin.assets_file,ptr) if ptr['m_PathID'] else None
    if f is None:return None
    key=identity(f)
    if key not in fonts:
        fd=f.read_typetree();raw=fd['m_FontData'];raw=raw.encode('latin1') if isinstance(raw,str) else bytes(raw)
        if not raw:raise ValueError('Font has no data '+fd['m_Name'])
        name='font-'+token(key)+('.otf' if raw[:4]==b'OTTO' else '.ttf');(out/name).write_bytes(raw)
        fonts[key]={'file':name,'name':fd['m_Name'],'fontSize':fd['m_FontSize'],'lineSpacing':fd['m_LineSpacing'],'ascent':fd['m_Ascent'],'characterSpacing':fd['m_CharacterSpacing'],'renderingMode':fd.get('m_FontRenderingMode'),'source':key}
    return key
def state(st):
    p=st['m_Background'];t=b.resolve(skin.assets_file,p) if p['m_PathID'] else None
    out_={'textColor':st['m_TextColor']}
    if t is not None:
        td=t.read_typetree();out_['background']={'file':w.texture(t),'name':td['m_Name'],'width':td['m_Width'],'height':td['m_Height'],'filterMode':td['m_TextureSettings']['m_FilterMode']}
    return out_
def offset(r):return {k[2:].lower():r[k] for k in ['m_Left','m_Right','m_Top','m_Bottom']}
STATES=['m_Normal','m_Hover','m_Active','m_Focused','m_OnNormal','m_OnHover','m_OnActive','m_OnFocused']
styles={}
for st in s['m_CustomStyles']:
    if st['m_Name'] not in ('ctxbox','ctxbutton'):continue
    styles[st['m_Name']]={'states':{k[2].lower()+k[3:]:state(st[k]) for k in STATES},'border':offset(st['m_Border']),'margin':offset(st['m_Margin']),'padding':offset(st['m_Padding']),'overflow':offset(st['m_Overflow']),
        'font':font(st['m_Font']),'fontSize':st['m_FontSize'],'fontStyle':st['m_FontStyle'],'alignment':st['m_Alignment'],'wordWrap':bool(st['m_WordWrap']),'richText':bool(st['m_RichText']),'clipping':st['m_TextClipping'],
        'imagePosition':st['m_ImagePosition'],'contentOffset':st['m_ContentOffset'],'fixedWidth':st['m_FixedWidth'],'fixedHeight':st['m_FixedHeight'],'stretchWidth':bool(st['m_StretchWidth']),'stretchHeight':bool(st['m_StretchHeight'])}
if set(styles)!={'ctxbox','ctxbutton'}:raise ValueError('ContextUI skin styles missing '+str(styles.keys()))
w.finish({'source':identity(obj),'gameObject':go['m_Name'],'enabled':bool(d['m_Enabled']),'skin':{'name':s['m_Name'],'source':identity(skin)},'styles':styles,'fonts':fonts,
 'conversion':'GUIStyle fields as serialized (RectOffsets in pixels, colours 0..1, TextAnchor alignment); backgrounds as PNG (top row first); the font file is the embedded dynamic Font data.'})
print(json.dumps({k:{'font':v['font'],'size':v['fontSize'],'states':{n:x.get('background',{}).get('name') for n,x in v['states'].items() if 'background' in x}} for k,v in styles.items()},indent=1))
