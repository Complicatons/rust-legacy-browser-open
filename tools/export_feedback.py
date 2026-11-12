"""Static export of the original client's combat feedback presentation (data bundles only; no target code is loaded or run).

- content/hud/HUDHitIndicator (WeaponDataBlock.PlayHitNotification): UITexture size/pivot/colour, HitNotification texture,
  the HUDHitIndicator alpha AnimationCurve, the Custom/HitIndicator material (_AlphaValue).
- content/hud/DirectionalDamage (ClientVitalsSync.ClientHealthChange -> HUDDirectionalDamage.CreateIndicator): UITexture
  transform (local position/scale, pivot, _mirrorY), colour, DamageIndicatorFaded material (_MainTex "DamageHalve",
  default _MinChannels/_MaxChannels).
- CharacterOverlayTrait "Overlay" (LocalDamageDisplay): damage_overlay_large / damage_overlay_2 for GameFullscreen pass 3,
  whose luminance weights are read from the compiled Custom/GameFullscreen shader text.
- content/shared/sfx/hitnotification clip (Bundling.Load path used by WeaponDataBlock/BowWeaponDataBlock).
- TakeDamage.playsHitNotification per prefab root name (TakeDamage.ShouldPlayHitNotification), and Character eye offsets
  (_eyesTransform local position) used by ClientHealthChange's eyesOrigin difference.
"""
import json,re,collections,hashlib
from unity_common import ROOT,Bundles,Writer,identity,token

DIRS=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data',ROOT/'analysis/world-source/bundles']
OUT=ROOT/'browser/assets/recovered/feedback'
b=Bundles(DIRS,['gameobject.000.unity3d','gameobject.001.unity3d','scriptableobject.000.unity3d','audioclip.000.unity3d','material.000.unity3d','shader.000.unity3d','texture.000.unity3d'])
w=Writer(b,OUT);issues=collections.Counter()

def container(asset_name):
    a=b.asset(asset_name);ab=next(o.read_typetree() for o in a.objects.values() if o.type.name=='AssetBundle')
    out=collections.defaultdict(list)
    for k,v in ab['m_Container']:out[k.lower()].append(v['asset'])
    return a,out
def go_of(obj):return obj if obj.type.name=='GameObject' else b.resolve(obj.assets_file,obj.read_typetree()['m_GameObject'])
def bundle_root(asset_name,path):
    a,c=container(asset_name)
    for ptr in c[path]:
        o=b.resolve(a,ptr)
        if o is not None and o.type.name=='GameObject':return o
    raise ValueError('Missing prefab '+path)
def components(go):return b.components(go.assets_file,go.read_typetree())
def transform(go):return components(go)['Transform'][0].read_typetree()
def child(go,name):
    for p in transform(go)['m_Children']:
        c=go_of(b.resolve(go.assets_file,p))
        if c.read_typetree()['m_Name']==name:return c
    raise ValueError('Missing child '+name)
def shader_text(s):
    script=s.read_typetree().get('m_Script') or '';return script if isinstance(script,str) else bytes(script).decode('latin1')
def material(owner,ptr):
    m=b.resolve(owner,ptr);d=m.read_typetree();props=d['m_SavedProperties']
    tex={k['name']:v for k,v in props['m_TexEnvs']};main=b.resolve(m.assets_file,tex['_MainTex']['m_Texture'])
    s=b.resolve(m.assets_file,d['m_Shader']);text=shader_text(s)
    return {'name':d['m_Name'],'source':identity(m),'shader':text.split('"')[1],'shaderSource':identity(s),'shaderSHA256':hashlib.sha256(text.encode('latin1')).hexdigest(),
        'texture':w.texture(main),'textureName':main.read().m_Name,'floats':{k['name']:v for k,v in props['m_Floats']},'colors':{k['name']:v for k,v in props['m_Colors']}}
def widget(go):
    t=transform(go);u=components(go)['UITexture'][0].read_typetree()
    # NGUI pivots: 0 TopLeft,1 Top,2 TopRight,3 Left,4 Center,5 Right,6 BottomLeft,7 Bottom,8 BottomRight.
    return {'name':go.read_typetree()['m_Name'],'position':t['m_LocalPosition'],'scale':t['m_LocalScale'],'pivot':u['mPivot'],'color':u['mColor'],
        'depth':u['mDepth'],'mirrorX':bool(u['_mirrorX']),'mirrorY':bool(u['_mirrorY']),'material':material(go.assets_file,u['mMat'])}
def mono(go,script):
    for kind,ls in components(go).items():
        if kind==script:return ls[0].read_typetree()
    raise ValueError('Missing '+script)

# HUDHitIndicator prefab (layer 9 NGUILayer2D) and its curve.
hit=bundle_root('cab-gameobject.000','content/hud/hudhitindicator');hd=mono(hit,'HUDHitIndicator')
hit_indicator={'source':identity(hit),'root':'CenteredAuto','widget':widget(child(hit,'Texture')),
    'curve':{'keys':[{k:key[k] for k in ('time','value','inSlope','outSlope')} for key in hd['curve']['m_Curve']],'preInfinity':hd['curve']['m_PreInfinity'],'postInfinity':hd['curve']['m_PostInfinity']},
    'alphaClamp':[1/255,254/255]}
# DirectionalDamage prefab: root rotates about Z; the child UITexture is the arc.
dd=bundle_root('cab-gameobject.000','content/hud/directionaldamage');ddd=mono(dd,'HUDDirectionalDamage')
skeleton=material(dd.assets_file,ddd['skeletonMaterial'])
directional={'source':identity(dd),'root':'CenteredFixed3000Tall','manualHeight':3000,'widget':widget(child(dd,'Texture')),'skeletonMaterial':skeleton}

# CharacterOverlayTrait (LocalDamageDisplay.OnAddonAwake) in the scriptable objects.
so=b.asset('cab-scriptableobject.000');overlay=None
for o in so.objects.values():
    if o.type.name!='MonoBehaviour':continue
    try:d=o.read_typetree()
    except Exception:continue
    if b.script(o,d)!='CharacterOverlayTrait':continue
    tex={}
    for k in ('_damageOverlay','_damageOverlay2'):
        t=b.resolve(o.assets_file,d[k]);tex[k[1:]]={'file':w.texture(t),'name':t.read().m_Name,'source':identity(t)}
    def name_of(ptr):
        x=b.resolve(o.assets_file,ptr) if ptr['m_PathID'] else None
        return x.read_typetree().get('m_Name') if x is not None else None
    overlay={'trait':d['m_Name'],'source':identity(o),'component':d['_overlayComponentName'],**tex,'takeDamageBob':name_of(d['_takeDamageBob']),'meleeBob':name_of(d['_meleeBob'])}
if overlay is None:raise ValueError('CharacterOverlayTrait not found')
# GameFullscreen (Custom/GameFullscreen): pass 3 is the luminance-tinted overlay LocalDamageDisplay selects.
sa,sc=container('cab-shader.000');gf=b.resolve(sa,sc['rust/shader/image effects/gamefullscreen'][0]);gtext=shader_text(gf)
passes=gtext.split('\n Pass {')[1:]
if len(passes)!=4:raise ValueError('GameFullscreen pass count')
m=re.search(r'"!!ARBfp1\.0\s+PARAM c\[2\] = \{ program\.local\[0\],\s+\{ ([0-9.]+), ([0-9.]+), ([0-9.]+), 1 \} \};',passes[3])
if not m:raise ValueError('GameFullscreen pass 3 constants')
overlay['gameFullscreen']={'shader':gtext.split('"')[1],'source':identity(gf),'shaderSHA256':hashlib.sha256(gtext.encode('latin1')).hexdigest(),'pass':3,
    'luminance':[float(x) for x in m.groups()],'blend':'src + _Blend * overlay.a * (overlay.rgb * dot(src, luminance) - src)'}

# Bundling.Load("content/shared/sfx/hitnotification").
aa,ac=container('cab-audioclip.000');clips={}
def clip(owner,ptr):
    obj=b.resolve(owner,ptr);key=identity(obj)
    if key not in clips:
        c=obj.read();d=obj.read_typetree();(name,data),=c.samples.items()
        filename='sound-'+token(key)+'.'+name.rsplit('.',1)[-1];(OUT/filename).write_bytes(data)
        clips[key]={'file':filename,'name':c.m_Name,'is3D':bool(d.get('m_3D')),'source':key}
    return clips[key]['file']
sounds={'hitnotification':clip(aa,ac['content/shared/sfx/hitnotification'][0])}

# TakeDamage.playsHitNotification per prefab root and Character eye offsets (eyesOrigin = _eyesTransform.position).
hit_flags={};eyes={}
for an in ('cab-gameobject.000','cab-gameobject.001'):
    a=b.asset(an)
    for o in a.objects.values():
        if o.type.name!='MonoBehaviour':continue
        try:d=o.read_typetree();s=b.script(o,d)
        except Exception:continue
        if not s:continue
        if s.endswith('TakeDamage'):
            name=b.resolve(o.assets_file,d['m_GameObject']).read_typetree()['m_Name'];flag=bool(d.get('playsHitNotification'))
            if name in hit_flags and hit_flags[name]['plays']!=flag:issues['conflicting playsHitNotification '+name]+=1
            hit_flags[name]={'class':s,'plays':flag}
        elif s=='Character' and d.get('_eyesTransform',{}).get('m_PathID'):
            g=b.resolve(o.assets_file,d['m_GameObject']);name=g.read_typetree()['m_Name'];t=b.resolve(o.assets_file,d['_eyesTransform']).read_typetree()
            # Eyes may be nested: accumulate local positions (no rotations/scales on these chains are asserted below).
            p=[t['m_LocalPosition'][k] for k in 'xyz'];chain=t
            while chain['m_Father']['m_PathID']:
                chain=b.resolve(o.assets_file,chain['m_Father']).read_typetree()
                if chain['m_GameObject']['m_PathID']==d['m_GameObject']['m_PathID']:break
                q=chain['m_LocalRotation']
                if abs(q['w'])<0.9999 or any(abs(chain['m_LocalScale'][k]-1)>1e-6 for k in 'xyz'):issues['rotated eyes parent '+name]+=1
                p=[p[i]+chain['m_LocalPosition'][k] for i,k in enumerate('xyz')]
            eyes[name]={'local':p}
manifest={'hitIndicator':hit_indicator,'directionalDamage':directional,'overlay':overlay,'sounds':sounds,'clips':clips,'playsHitNotification':hit_flags,'eyes':eyes,
    'summary':dict(issues),'conversion':'Unity UI units (Y up); NGUI widget geometry before the pivot offset spans x 0..1, y -1..0. Textures are raw original RGBA (gamma-space values).'}
w.finish(manifest)
print(json.dumps({'hitTexture':hit_indicator['widget']['material']['textureName'],'arc':directional['widget']['material']['textureName'],'overlay':[overlay['damageOverlay']['name'],overlay['damageOverlay2']['name']],
    'luminance':overlay['gameFullscreen']['luminance'],'sound':sounds,'plays':sorted(k for k,v in hit_flags.items() if v['plays']),'eyes':eyes,'issues':dict(issues)}))
