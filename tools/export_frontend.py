"""Static original menu/server-browser/loading/console/death-screen layouts and atlas. Never executes target code."""
import json,struct,collections
from unity_common import ROOT,Bundles,Writer,identity,token
b=Bundles([ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data'],['scenes.unity3d'])
a=b.asset('buildplayer-gameui');out=ROOT/'browser/assets/recovered/frontend';out.mkdir(exist_ok=True);writer=Writer(b,out)
class Cursor:
    def __init__(self,data,offset=0):self.data=data;self.p=offset
    def read(self,fmt):v=struct.unpack_from('<'+fmt,self.data,self.p);self.p+=struct.calcsize('<'+fmt);return v[0] if len(v)==1 else v
    def align(self):self.p=(self.p+3)//4*4
    def string(self):n=self.read('i');assert 0<=n<=len(self.data)-self.p;v=self.data[self.p:self.p+n].decode('utf-8');self.p+=n;self.align();return v
    def pointer(self):f,p=self.read('ii');return {'m_FileID':f,'m_PathID':p}
def atlas_data(obj):
    try:return obj.read_typetree()
    except ValueError:
        # Supplied dfAtlas has only a MonoBehaviour header type tree. Fields are statically verified in dfAtlas.cs.
        raw=obj.get_raw_data();c=Cursor(raw);c.pointer();c.read('B');c.align();c.pointer();c.string();material=c.pointer();count=c.read('i');assert 0<=count<4096;items=[]
        for _ in range(count):
            name=c.string();region=dict(zip(['x','y','width','height'],c.read('4f')));border=dict(zip(['left','right','top','bottom'],c.read('4i')));rotated=bool(c.read('B'));c.align();size=dict(zip('xy',c.read('2f')));guid=c.string();deleted=bool(c.read('B'));c.align();texture=c.pointer();items.append({'name':name,'region':region,'border':border,'rotated':rotated,'sizeInPixels':size,'textureGUID':guid,'deleted':deleted,'texture':texture})
        if c.p!=len(raw):raise ValueError('Unconsumed dfAtlas bytes '+str((c.p,len(raw))))
        return {'material':material,'items':items}
atlases={}
def export_atlas(owner,ptr):
    if not ptr.get('m_PathID'):return None
    obj=b.resolve(owner,ptr);key=identity(obj)
    if key in atlases:return key
    d=atlas_data(obj);mat=writer.material(b.resolve(obj.assets_file,d['material']));from PIL import Image
    image=Image.open(out/writer.materials[mat]['texture']);sprites={};atlases[key]={'sprites':sprites,'material':mat,'width':image.width,'height':image.height}
    for s in d['items']:
        if s['deleted']:continue
        r=s['region'];x=round(r['x']*image.width);y=round((1-r['y']-r['height'])*image.height);w=round(r['width']*image.width);h=round(r['height']*image.height)
        cropped=image.crop((x,y,x+w,y+h))
        if s['rotated']:raise ValueError('Rotated original menu sprite '+s['name'])
        filename='sprite-'+token(key+':'+s['name'])+'.png';cropped.save(out/filename);sprites[s['name']]={'file':filename,'width':w,'height':h,'border':s['border'],'region':r}
    return key
fonts={}
def export_font(owner,ptr):
    if not ptr.get('m_PathID'):return None
    obj=b.resolve(owner,ptr);key=identity(obj)
    if key in fonts:return key
    header=obj.read_typetree(check_read=False);kind=b.script(obj,header)
    if kind=='dfDynamicFont':
        d=obj.read_typetree();native=b.resolve(obj.assets_file,d['baseFont']);fd=native.read_typetree();raw=fd['m_FontData'];raw=raw.encode('latin1') if isinstance(raw,str) else bytes(raw);extension='.otf' if raw[:4]==b'OTTO' else '.ttf';filename='font-'+token(identity(native))+extension
        if not raw:raise ValueError('Empty original dynamic font '+fd['m_Name'])
        (out/filename).write_bytes(raw);fonts[key]={'kind':'dynamic','file':filename,'name':fd['m_Name'],'size':d['baseFontSize'],'baseline':d['baseline'],'lineHeight':d['lineHeight'],'source':identity(native)}
    elif kind=='dfFont':
        raw=obj.get_raw_data();c=Cursor(raw);c.pointer();c.read('B');c.align();c.pointer();c.string();atlas=c.pointer();sprite=c.string();face=c.string();size=c.read('i');bold=bool(c.read('B'));c.align();italic=bool(c.read('B'));c.align();charset=c.string();stretch=c.read('i');smooth=bool(c.read('B'));c.align();aa=c.read('i')
        padding=[c.read('i') for _ in range(c.read('i'))];spacing=[c.read('i') for _ in range(c.read('i'))];outline=c.read('i');line_height=c.read('i');glyphs=[]
        for _ in range(c.read('i')):
            glyph=dict(zip(['id','x','y','width','height','xoffset','yoffset','xadvance'],c.read('8i')));glyph['rotated']=bool(c.read('B'));c.align();glyphs.append(glyph)
        kerning=[dict(zip(['first','second','amount'],c.read('3i'))) for _ in range(c.read('i'))]
        if c.p!=len(raw):raise ValueError('Unconsumed dfFont bytes '+str((c.p,len(raw))))
        atlas_key=export_atlas(obj.assets_file,atlas);fonts[key]={'kind':'bitmap','atlas':atlas_key,'sprite':sprite,'name':face,'size':size,'lineHeight':line_height,'glyphs':glyphs,'kerning':kerning,'padding':padding,'spacing':spacing}
    else:raise ValueError('Unsupported source UI font '+str(kind))
    return key
# Script components the menu flow reads: ConvarBinding (options rows -> console variables), OptionsWindow (Apply),
# RunConsoleCommand (btnDisconnect -> net.disconnect), DisableOnConnectedState, BlurEffect, OptionsInput/OptionsKeyBinding.
# GUIHide (gui.hide/gui.show) and BrandingVersion (the Overlay/BrandingPanel watermark, gui.hide_branding/show_branding).
# LockEntry (code lock entry panel: passwordInput/entryLabel fields) and DigitEntryRestrictions (its textbox's digit filter).
SCRIPTS=['MainMenu','LoadingScreen','ServerBrowser','ServerCategory','ServerItem','ConsoleWindow','Pagination','DeathScreen','ConvarBinding','OptionsWindow','RunConsoleCommand','DisableOnConnectedState','BlurEffect','OptionsInput','OptionsKeyBinding','GUIHide','BrandingVersion','LockEntry','DigitEntryRestrictions']
# BrandingVersion.RetrieveLinkerTimestamp reads Assembly-CSharp.dll's PE header: e_lfanew at 60, TimeDateStamp at +8. Read
# statically from the analysed client copy (the file is only opened as bytes, never loaded).
CLIENT_ASSEMBLY=ROOT/'analysis/client-audit/rust_Data/Managed/Assembly-CSharp.dll'
def linker_timestamp(path):
    head=path.read_bytes()[:2048];pe=struct.unpack_from('<i',head,60)[0]
    if head[pe:pe+4]!=b'PE\0\0':raise ValueError('Not a PE file: '+str(path))
    return struct.unpack_from('<i',head,pe+8)[0]
def tree(go):
    nodes=[]
    def walk(go,parent=-1):
        cs=b.components(go.assets_file,go.read_typetree());t=cs['Transform'][0].read_typetree();i=len(nodes);components={}
        for kind,objects in cs.items():
            if not kind.startswith('df') and kind not in SCRIPTS and kind!='Camera':continue
            values=[]
            for obj in objects:
                d=obj.read_typetree();d={k:v for k,v in d.items() if k not in ['m_Script','m_GameObject']}
                # Camera: only what the menu blur needs (BlurCamera: Don't Clear, empty culling mask, drawn after the world).
                if kind=='Camera':d={k:d[k] for k in ['m_Enabled','m_ClearFlags','m_CullingMask','m_Depth','orthographic']}
                # Component path ID: dfEventBinding / dfTweenEventBinding / ServerBrowser fields reference components by it.
                d['pathID']=obj.path_id
                if d.get('atlas',{}).get('m_PathID'):d['atlasKey']=export_atlas(obj.assets_file,d['atlas'])
                if d.get('font',{}).get('m_PathID'):d['fontKey']=export_font(obj.assets_file,d['font'])
                if d.get('texture',{}).get('m_PathID'):
                    texture=b.resolve(obj.assets_file,d['texture'])
                    if texture.type.name=='Texture2D':d['textureFile']=writer.texture(texture)
                values.append(d)
            components[kind]=values
        nodes.append({'name':go.read_typetree()['m_Name'],'parent':parent,'position':t['m_LocalPosition'],'scale':t['m_LocalScale'],'active':go.read_typetree()['m_IsActive'],'components':components})
        for ptr in t['m_Children']:
            child=b.resolve(go.assets_file,ptr);walk(b.resolve(child.assets_file,child.read_typetree()['m_GameObject']),i)
    walk(go);return nodes
screens={}
for obj in a.objects.values():
    if obj.type.name!='MonoBehaviour':continue
    d=obj.read_typetree();kind=b.script(obj,d)
    # DeathScreen (deathscreen.reason label, RequestRespawn / RequestRespawn_InCamp dfEventBindings, FadeIn/FadeOut tweens).
    # LockEntry (lockentry.show/hide): panel, Okay/Cancel dfEventBindings, Return dfControlKeyBinding, digit-only textbox.
    if kind in ['MainMenu','LoadingScreen','ConsoleWindow','DeathScreen','LockEntry']:
        go=b.resolve(a,d['m_GameObject']);screens[kind]={'source':identity(obj),'nodes':tree(go)}
    # GameUI Root/Overlay (GUIHide): BrandingPanel (BrandingVersion) and GameTooltips. The scene's only GUIHide object.
    if kind=='GUIHide':
        go=b.resolve(a,d['m_GameObject']);nodes=tree(go);screens['Overlay']={'source':identity(obj),'nodes':nodes}
        import hashlib
        for n in nodes:
            for v in n['components'].get('BrandingVersion',[]):v.update(linkerTimestamp=linker_timestamp(CLIENT_ASSEMBLY),assemblySHA256=hashlib.sha256(CLIENT_ASSEMBLY.read_bytes()).hexdigest())
# Prefabs instantiated at runtime by the menu: ServerBrowser.serverItem rows, Pagination.clickableButton/spacerLabel and
# OptionsInput.lineObject key-binding rows. Exported as separate hierarchies with the same component format.
prefabs={}
for obj in a.objects.values():
    if obj.type.name!='MonoBehaviour':continue
    d=obj.read_typetree();kind=b.script(obj,d)
    for field,name in {'ServerBrowser':[('serverItem','ServerItem')],'Pagination':[('clickableButton','PaginationButton'),('spacerLabel','PaginationSpacer')],'OptionsInput':[('lineObject','OptionsKeyBinding')]}.get(kind,[]):
        go=b.resolve(a,d[field])
        if go is not None:prefabs[name]={'source':identity(go),'nodes':tree(go)}
import math
def finite(v):
    # AnimationCurve keys may store infinite tangents (stepped keys); JSON has no Infinity, so they become null.
    if isinstance(v,float) and not math.isfinite(v):return None
    if isinstance(v,dict):return {k:finite(x) for k,x in v.items()}
    if isinstance(v,list):return [finite(x) for x in v]
    return v
screens=finite(screens);prefabs=finite(prefabs)
writer.finish({'screens':screens,'prefabs':prefabs,'fonts':fonts,'atlases':atlases,'source':'BuildPlayer-GameUI','conversion':'Original dfControl sizes, anchors and native atlas sprites; local UI transform values retained.'})
print(json.dumps({'screens':{k:len(v['nodes']) for k,v in screens.items()},'prefabs':{k:len(v['nodes']) for k,v in prefabs.items()},'atlases':{k:list(v['sprites']) for k,v in atlases.items()}}))
