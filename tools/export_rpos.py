"""Static RPOS windows/cell configuration. Does not load any original executable code."""
import json
from unity_common import ROOT, Bundles, identity
b=Bundles([ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data'],
          ['gameobject.000.unity3d','sharedassets0.assets','scenes.unity3d'])
a=b.asset('buildplayer-rpos')
kinds=['UISprite','UISlicedSprite','UILabel','UITexture','UIPanel','RPOSInvCellManager','RPOSInventoryCell']
def tree(go):
    nodes=[]
    def walk(go,parent=-1):
        cs=b.components(go.assets_file,go.read_typetree());t=cs['Transform'][0].read_typetree();i=len(nodes)
        nodes.append({'source':identity(go),'name':go.read_typetree()['m_Name'],'parent':parent,'active':bool(go.read_typetree()['m_IsActive']),
                      'position':t['m_LocalPosition'],'scale':t['m_LocalScale'],
                      'components':{k:[o.read_typetree() for o in cs[k]] for k in kinds if k in cs}})
        for ptr in t['m_Children']:
            child=b.resolve(go.assets_file,ptr);walk(b.resolve(child.assets_file,child.read_typetree()['m_GameObject']),i)
    walk(go);return nodes
windows={};containers={};tooltip={}
for obj in a.objects.values():
    if obj.type.name!='MonoBehaviour':continue
    d=obj.read_typetree()
    if b.script(obj,d)=='ItemToolTip':
        tooltip={'source':identity(obj),'nodes':tree(b.resolve(a,d['m_GameObject'])),'templates':{}}
        for field in ('itemTitlePrefab','sectionTitlePrefab','itemDescriptionPrefab','basicLabelPrefab','progressStatPrefab'):
            target=b.resolve(a,d[field]);tooltip['templates'][field]=tree(target)
    if 'TitleText' not in d:continue
    go=b.resolve(a,d['m_GameObject'])
    windows[go.read_typetree()['m_Name']]={'source':identity(obj),'title':d['TitleText'],'kind':b.script(obj,d),'nodes':tree(go)}
    name=go.read_typetree()['m_Name']
    if name in ('RPOSFireContentsWindow','RPOSRepairBenchWindow'):
        managers=b.components(a,go.read_typetree()).get('RPOSInvCellManager',[])
        if managers:
            cells=[]
            for index,ptr in enumerate(managers[0].read_typetree()['_inventoryCells']):
                cell=b.resolve(a,ptr);cellgo=b.resolve(cell.assets_file,cell.read_typetree()['m_GameObject']);t=b.components(cellgo.assets_file,cellgo.read_typetree())['Transform'][0].read_typetree()
                cells.append({'slot':index,'name':cellgo.read_typetree()['m_Name'],'x':t['m_LocalPosition']['x'],'y':-t['m_LocalPosition']['y']})
            containers[name]={'cells':cells,'cellSize':64}
out=ROOT/'browser/assets/recovered/rpos';out.mkdir(exist_ok=True)
data={'windows':windows,'containers':containers,'tooltip':tooltip,'source':'buildplayer-rpos','note':'Original locals and serialized defaults; runtime slot starts come from inventory ranges, not stale prefab indices.'}
(out/'layout.json').write_text(json.dumps(data,separators=(',',':')),encoding='utf-8')
print([(name,w['title'],len(w['nodes'])) for name,w in windows.items()])

# RPOS sounds: NGUI UIButtonSound components (scene buttons/cells and the cell prefabs RPOSInvCellManager instantiates)
# and RPOSCraftWindow.craftSound. NGUITools.PlaySound(clip, volume, pitch) = listener AudioSource.PlayOneShot(clip,
# volume * soundVolume) with that pitch; craftSound.Play() is SoundPool's 2D Play (volume 1).
import collections
from unity_common import token
clips={}
def clip(owner,ptr):
    if not ptr or not ptr.get('m_PathID'):return None
    obj=b.resolve(owner,ptr);key=identity(obj)
    if key not in clips:
        c=obj.read();d=obj.read_typetree();(name,data),=c.samples.items();filename='sound-'+token(key)+'.'+name.rsplit('.',1)[-1];(out/filename).write_bytes(data)
        clips[key]={'file':filename,'name':c.m_Name,'is3D':bool(d.get('m_3D')),'source':key}
    return clips[key]['file']
tf={o.path_id:o.read_typetree() for o in a.objects.values() if o.type.name=='Transform'}
go_tf={t['m_GameObject']['m_PathID']:pid for pid,t in tf.items()}
def scene_path(gid):
    # Windows (UI Root (2D)/RPOSCamera/<anchor>/<window>) are shown at run time, so `active` covers the node and its
    # ancestors below the window only.
    chain=[];t=tf.get(go_tf.get(gid))
    while t:
        g=a.objects[t['m_GameObject']['m_PathID']].read_typetree();chain.append(g);p=t['m_Father']['m_PathID'];t=tf.get(p) if p else None
    chain.reverse();return '/'.join(g['m_Name'] for g in chain),all(g['m_IsActive'] for g in chain[4:])
TRIGGERS=['OnClick','OnMouseOver','OnMouseOut','OnPress','OnRelease']
def tween(kind,obj,d):
    v=lambda x:[x['x'],x['y'],x['z']]
    return {'kind':kind,'enabled':bool(d['m_Enabled']),'hover':v(d['hover']),'pressed':v(d['pressed']),'duration':d['duration'],'ownTarget':not d['tweenTarget']['m_PathID'] or b.resolve(obj.assets_file,d['tweenTarget']).read_typetree()['m_GameObject']['m_PathID']==d['m_GameObject']['m_PathID']}
def prefab_tweens(go):
    out=[]
    def walk(go):
        cs=b.components(go.assets_file,go.read_typetree())
        for kind in ('UIButtonScale','UIButtonOffset'):
            for t in cs.get(kind,[]):out.append({'name':go.read_typetree()['m_Name'],**tween(kind,t,t.read_typetree())})
        for ptr in cs['Transform'][0].read_typetree()['m_Children']:
            ch=b.resolve(go.assets_file,ptr);walk(b.resolve(ch.assets_file,ch.read_typetree()['m_GameObject']))
    walk(go);return out
# NGUI UIButton / UIButtonColor: OnHover/OnPress run TweenColor.Begin(tweenTarget, duration, hover|pressed|default) on the
# target's UIWidget colour (Linear, the added TweenColor's default method); `default` is that widget's serialized colour
# (UIButtonColor.Init: mColor = widget.color). UIButton adds disabledColor.
WIDGETS=('UISlicedSprite','UISprite','UIFilledSprite','UITiledSprite','UILabel','UITexture')
def rgba(c):return [c['r'],c['g'],c['b'],c['a']]
def button_color(kind,obj,d):
    go=b.resolve(obj.assets_file,d['m_GameObject']);target=b.resolve(obj.assets_file,d['tweenTarget']) if d['tweenTarget']['m_PathID'] else go
    cs=b.components(target.assets_file,target.read_typetree());w=next(((k,cs[k][0].read_typetree()) for k in WIDGETS if k in cs),(None,None))
    out={'kind':kind,'enabled':bool(d['m_Enabled']),'hover':rgba(d['hover']),'pressed':rgba(d['pressed']),'duration':d['duration'],
         'target':target.read_typetree()['m_Name'],'widget':w[0],'sprite':w[1].get('mSpriteName') if w[1] else None,'default':rgba(w[1]['mColor']) if w[1] else None}
    if 'disabledColor' in d:out['disabled']=rgba(d['disabledColor'])
    return out
def prefab_colors(go):
    out=[]
    def walk(go):
        cs=b.components(go.assets_file,go.read_typetree())
        for kind in ('UIButton','UIButtonColor'):
            for c in cs.get(kind,[]):out.append({'name':go.read_typetree()['m_Name'],**button_color(kind,c,c.read_typetree())})
        for ptr in cs['Transform'][0].read_typetree()['m_Children']:
            ch=b.resolve(go.assets_file,ptr);walk(b.resolve(ch.assets_file,ch.read_typetree()['m_GameObject']))
    walk(go);return out
def prefab_sounds(go):
    found=[]
    def walk(go):
        cs=b.components(go.assets_file,go.read_typetree())
        for s in cs.get('UIButtonSound',[]):
            sd=s.read_typetree();found.append({'name':go.read_typetree()['m_Name'],'enabled':bool(sd['m_Enabled']),'trigger':TRIGGERS[sd['trigger']],'volume':sd['volume'],'pitch':sd['pitch'],'clip':clip(s.assets_file,sd['audioClip'])})
        for ptr in cs['Transform'][0].read_typetree()['m_Children']:
            ch=b.resolve(go.assets_file,ptr);walk(b.resolve(ch.assets_file,ch.read_typetree()['m_GameObject']))
    walk(go);return found
buttons=[];craft=None;cell_prefabs={};tweens=[];colors=[];scrolling={};bumper=None;ui={}
for obj in a.objects.values():
    if obj.type.name!='MonoBehaviour':continue
    d=obj.read_typetree();kind=b.script(obj,d)
    if kind=='UIButtonSound':
        path,active=scene_path(d['m_GameObject']['m_PathID'])
        buttons.append({'path':path,'name':path.rsplit('/',1)[-1],'active':active,'enabled':bool(d['m_Enabled']),'trigger':TRIGGERS[d['trigger']],'volume':d['volume'],'pitch':d['pitch'],'clip':clip(obj.assets_file,d['audioClip'])})
    elif kind in ('UIButtonScale','UIButtonOffset'):
        path,active=scene_path(d['m_GameObject']['m_PathID']);tweens.append({'path':path,'active':active,**tween(kind,obj,d)})
    elif kind in ('UIButton','UIButtonColor'):
        path,active=scene_path(d['m_GameObject']['m_PathID']);colors.append({'path':path,'active':active,**button_color(kind,obj,d)})
    elif kind=='UIDraggablePanel':
        # Scroll wheel: UICamera (scrollWheelMode UseEvents) sends the event's delta.y as OnHoverScroll to the UIPanel above
        # the hovered hot spot; UIDraggablePanel.Scroll adds delta * scrollWheelFactor and LateUpdate turns it into momentum.
        path,active=scene_path(d['m_GameObject']['m_PathID']);go=b.resolve(obj.assets_file,d['m_GameObject']);cs=b.components(go.assets_file,go.read_typetree())
        p=cs['UIPanel'][0].read_typetree();CLIP=['None','HardClip','AlphaClip','SoftClip'];DRAG=['None','Momentum','MomentumAndSpring'];SHOW=['Always','OnlyIfNeeded','WhenDragging']
        def sprite(ptr):
            s=b.resolve(obj.assets_file,ptr);sd=s.read_typetree();sg=b.resolve(s.assets_file,sd['m_GameObject']);sgd=sg.read_typetree();scs=b.components(sg.assets_file,sgd);st=scs['Transform'][0].read_typetree()
            return {'name':sgd['m_Name'],'active':bool(sgd['m_IsActive']),'sprite':sd['mSpriteName'],'color':rgba(sd['mColor']),'pivot':sd['mPivot'],'depth':sd['mDepth'],
                    'position':st['m_LocalPosition'],'scale':st['m_LocalScale'],'hotSpot':any(k.endswith('HotSpot') for k in scs)}
        def bar(ptr):
            if not ptr['m_PathID']:return None
            sb=b.resolve(obj.assets_file,ptr);sd=sb.read_typetree();bpath,bactive=scene_path(sd['m_GameObject']['m_PathID'])
            bt=b.components(sb.assets_file,b.resolve(sb.assets_file,sd['m_GameObject']).read_typetree())['Transform'][0].read_typetree()
            return {'path':bpath,'active':bactive,'enabled':bool(sd['m_Enabled']),'direction':['Horizontal','Vertical'][sd['mDir']],'inverted':bool(sd['mInverted']),'scrollValue':sd['mScroll'],'barSize':sd['mSize'],
                    'position':bt['m_LocalPosition'],'background':sprite(sd['mBG']),'foreground':sprite(sd['mFG'])}
        scrolling[path]={'active':active,'enabled':bool(d['m_Enabled']),'restrictWithinPanel':bool(d['restrictWithinPanel']),'restrictWithinPanelWithScroll':bool(d['restrictWithinPanelWithScroll']),
            'disableDragIfFits':bool(d['disableDragIfFits']),'dragEffect':DRAG[d['dragEffect']],'scale':d['scale'],'scrollWheelFactor':d['scrollWheelFactor'],'momentumAmount':d['momentumAmount'],
            'relativePositionOnReset':d['relativePositionOnReset'],'showScrollBars':SHOW[d['showScrollBars']],'respondHoverScroll':bool(d['respondHoverScroll']),
            'panel':{'clipping':CLIP[p['mClipping']],'clipRange':p['mClipRange'],'clipSoftness':p['mClipSoftness']},
            'horizontalScrollBar':bar(d['horizontalScrollBar']),'verticalScrollBar':bar(d['verticalScrollBar'])}
    elif kind=='UIRoot':ui['root']={'automatic':bool(d['automatic']),'manualHeight':d['manualHeight']}
    elif kind=='UICamera':
        MODES=['None','UseInput','UseEvents','UseInputAndEvents']
        ui['camera']={'mouseMode':MODES[d['mouseMode']],'scrollWheelMode':MODES[d['scrollWheelMode']],'scrollAxisName':d['scrollAxisName'],'mouseClickThreshold':d['mouseClickThreshold']}
    elif kind=='RPOS':
        # RPOS.Awake -> RPOSBumper.Populate: one NGUITools.AddChild clone of buttonPrefab per titled windowList entry. buttonPrefab
        # is the project prefab asset (gameobject.000), not the inactive RPOSBumperButtonPrefab copy in the scene, so the
        # clones keep the asset's active state. Buttons are 75 * prefab scale.x wide, 5 apart, centred on the bumper.
        bp=b.resolve(obj.assets_file,d['_bumper']);bd=bp.read_typetree();btn=b.resolve(bp.assets_file,bd['buttonPrefab']);pg=b.resolve(btn.assets_file,btn.read_typetree()['m_GameObject']);pgd=pg.read_typetree()
        pt=b.components(pg.assets_file,pgd)['Transform'][0].read_typetree();titles=[]
        for ptr in d['windowList']:
            if not ptr['m_PathID']:continue
            w=b.resolve(obj.assets_file,ptr);wd=w.read_typetree()
            if wd.get('TitleText'):titles.append({'title':wd['TitleText'],'window':b.resolve(w.assets_file,wd['m_GameObject']).read_typetree()['m_Name']})
        bgw=b.resolve(bp.assets_file,bd['background']);bg=bgw.read_typetree();bpath,bactive=scene_path(bd['m_GameObject']['m_PathID'])
        bgt=b.components(bgw.assets_file,b.resolve(bgw.assets_file,bg['m_GameObject']).read_typetree())['Transform'][0].read_typetree()
        bt=b.components(bp.assets_file,b.resolve(bp.assets_file,bd['m_GameObject']).read_typetree())['Transform'][0].read_typetree()
        bumper={'path':bpath,'active':bactive,'position':bt['m_LocalPosition'],'windows':titles,'prefab':{'source':identity(pg),'name':pgd['m_Name'],'active':bool(pgd['m_IsActive']),'scale':pt['m_LocalScale'],
            'nodes':tree(pg),'buttonSounds':prefab_sounds(pg),'buttonTweens':prefab_tweens(pg),'buttonColors':prefab_colors(pg)},'buttonWidth':75*pt['m_LocalScale']['x'],'spacing':5,
            'background':{'sprite':bg['mSpriteName'],'color':rgba(bg['mColor']),'pivot':bg['mPivot'],'scale':bgt['m_LocalScale']}}
    elif kind=='RPOSCraftWindow':craft={'clip':clip(obj.assets_file,d['craftSound']),'source':'RPOSCraftWindow.craftSound'}
    elif kind=='RPOSInvCellManager' and d.get('CellPrefab',{}).get('m_PathID'):
        path,_=scene_path(d['m_GameObject']['m_PathID']);prefab=b.resolve(obj.assets_file,d['CellPrefab'])
        cell_prefabs[path]={'prefab':prefab.read_typetree()['m_Name'],'buttonSounds':prefab_sounds(prefab),'buttonTweens':prefab_tweens(prefab),'buttonColors':prefab_colors(prefab)}
    elif kind=='RPOS_Craft_BlueprintList':
        # Blueprint list rows are instantiated from ItemPlaquePrefab (category headers have no sound).
        path,_=scene_path(d['m_GameObject']['m_PathID'])
        for field in ('ItemPlaquePrefab','CategoryHeaderPrefab'):
            prefab=b.resolve(obj.assets_file,d[field]);prefab=prefab if prefab.type.name=='GameObject' else b.resolve(prefab.assets_file,prefab.read_typetree()['m_GameObject'])
            cell_prefabs[path+'#'+field]={'prefab':prefab.read_typetree()['m_Name'],'buttonSounds':prefab_sounds(prefab),'buttonTweens':prefab_tweens(prefab),'buttonColors':prefab_colors(prefab),'nodes':tree(prefab)}
data['sounds']={'buttons':sorted(buttons,key=lambda x:x['path']),'tweens':sorted(tweens,key=lambda x:(x['path'],x['kind'])),'colors':sorted(colors,key=lambda x:(x['path'],x['kind'])),'cellPrefabs':cell_prefabs,'craft':craft,'clips':clips,
 'note':'UIButtonSound: NGUITools.PlaySound = PlayOneShot on the listener, volume*soundVolume (skipped at <= 0.01), pitch; craftSound plays when crafting starts.'}
data['scrolling']=scrolling;data['bumper']=bumper;data['ui']=ui
(out/'layout.json').write_text(json.dumps(data,separators=(',',':')),encoding='utf-8')
print(json.dumps({'buttons':len(buttons),'active':sum(x['active'] and x['enabled'] for x in buttons),'cellPrefabs':{k:len(v['buttonSounds']) for k,v in cell_prefabs.items()},'craft':craft,'clips':[c['name'] for c in clips.values()]},indent=1))
