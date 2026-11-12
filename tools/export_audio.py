"""Static export of the original client's player/world audio (data bundles only; no target code is loaded or run).

- FootstepEmitter + CharacterFootstepTrait per character prefab (trait resolved through Character._traitMapName and the
  CharacterTraitMap K/B inheritance chain), SurfaceInfoObject bipedFootsteps/animalFootsteps per surface (keys equal the
  deployables manifest surface identities).
- CharacterSoundsTrait death arrays (DeathTransfer.Client_OnKilledShared), FallDamage.legBreakSound.
- Bundling.Load paths the client loads by name: content/shared/sfx/vomit (Metabolism.Vomit), content/item/sfx/geiger_*
  (LocalRadiationEffect).
- BuildPlayer-rust_island_2013: AmbientAudioPlayer emitters (world position + both AudioSources) and the MusicPlayer.
- BuildPlayer-MenuBackground: MusicPlayer and looping AudioSources (for the menu scene, wired by its own module).
Every clip records its import flags (m_3D: Unity 4 plays a 2D clip without positional attenuation).
"""
import json,collections
import numpy as np
from unity_common import ROOT,Bundles,identity,token,trs

DIRS=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data',ROOT/'analysis/world-source/bundles']
OUT=ROOT/'browser/assets/recovered/audio'
OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
b=Bundles(DIRS,['gameobject.000.unity3d','gameobject.001.unity3d','scriptableobject.000.unity3d','audioclip.000.unity3d','sharedassets0.assets','scenes.unity3d'])
issues=collections.Counter();clips={}

def clip(owner,ptr):
    """One AudioClip, written once as sound-<token(identity)>.<ext>; returns the file name (None for a null reference)."""
    if not ptr or not ptr.get('m_PathID'):return None
    obj=b.resolve(owner,ptr)
    if obj is None:issues['missing audio clip']+=1;return None
    key=identity(obj)
    if key not in clips:
        c=obj.read();d=obj.read_typetree();(name,data),=c.samples.items()
        filename='sound-'+token(key)+'.'+name.rsplit('.',1)[-1];(OUT/filename).write_bytes(data)
        clips[key]={'file':filename,'name':c.m_Name,'is3D':bool(d.get('m_3D')),'stream':int(d.get('m_Stream') or 0),'source':key}
    return clips[key]['file']
def clip_array(owner,ptr):
    """AudioClipArray (ScriptableObjectArrayBase<AudioClip>) -> list of files; null entries stay null like the source."""
    if not ptr or not ptr.get('m_PathID'):return None
    obj=b.resolve(owner,ptr)
    if obj is None:issues['missing clip array']+=1;return None
    d=obj.read_typetree();return {'name':d.get('m_Name'),'clips':[clip(obj.assets_file,c) for c in d['_array']]}

def behaviours(asset):
    for o in asset.objects.values():
        if o.type.name!='MonoBehaviour':continue
        try:d=o.read_typetree();s=b.script(o,d)
        except Exception:continue
        yield o,d,s

so=b.asset('cab-scriptableobject.000');go=b.asset('cab-gameobject.000')
# SurfaceInfoObject footstep arrays (SurfaceInfoObject.GetFootstepBiped / GetFootstepAnimal).
surfaces={}
for a in (so,go):
    for o,d,s in behaviours(a):
        if s!='SurfaceInfoObject':continue
        biped=clip_array(o.assets_file,d.get('bipedFootsteps'));animal=clip_array(o.assets_file,d.get('animalFootsteps'))
        surfaces[identity(o)]={'name':d.get('m_Name'),'biped':biped['clips'] if biped else [],'animal':animal['clips'] if animal else [],
            'bipedArray':biped and biped['name'],'animalArray':animal and animal['name']}
default_surface=next(k for k,v in surfaces.items() if v['name']=='default' and k.startswith('cab-scriptableobject'))

# CharacterTraitMap chain: own K overrides the base map's (TraitMap.map MergeUpon), looked up by trait type.
maps={};traits={}
for o,d,s in behaviours(so):
    if s=='CharacterTraitMap':maps[d['m_Name'].lower()]=(o,d)
def trait_chain(name):
    out={};entry=maps.get((name or 'Default').lower())
    seen=[]
    while entry:
        o,d=entry;seen.append(d['m_Name'])
        for p in d['K']:
            t=b.resolve(o.assets_file,p) if p['m_PathID'] else None
            if t is None:continue
            td=t.read_typetree();kind=b.script(t,td)
            if kind not in out:out[kind]=(t,td)
        base=d['B'];entry=None
        if base['m_PathID']:
            bo=b.resolve(o.assets_file,base);entry=(bo,bo.read_typetree())
    return out,seen
def footstep_trait(t,td):
    key=identity(t)
    if key not in traits:
        arr=clip_array(t.assets_file,td['_defaultFootsteps'])
        traits[key]={'name':td['m_Name'],'defaultFootsteps':arr['clips'] if arr else [],'strideDist':td['_strideDist'],'minAudioDist':td['_minAudioDist'],
            'maxAudioDist':td['_maxAudioDist'],'animal':bool(td['_animal']),'maxPerSecond':td['_maxPerSecond']}
    return key

characters={}
for o,d,s in behaviours(go):
    if s!='Character':continue
    g=b.resolve(go,d['m_GameObject']).read_typetree();cs=b.components(go,g)
    chain,seen=trait_chain(d.get('_traitMapName'))
    entry={'traitMap':d.get('_traitMapName') or 'Default','traitChain':seen,'footstepEmitter':'FootstepEmitter' in cs}
    if 'CharacterFootstepTrait' in chain:entry['footsteps']=footstep_trait(*chain['CharacterFootstepTrait'])
    if 'CharacterSoundsTrait' in chain:
        t,td=chain['CharacterSoundsTrait'];entry['sounds']={k[1:]:(clip_array(t.assets_file,td[k]) or {}).get('clips') for k in ('_attack','_alert','_idle','_persuit','_impact','_death')}
    if 'FallDamage' in cs:
        fd=cs['FallDamage'][0].read_typetree();entry['legBreakSound']=clip(go,fd['legBreakSound'])
    if g['m_Name'] in characters and characters[g['m_Name']]!=entry:issues['duplicate character name '+g['m_Name']]+=1
    characters.setdefault(g['m_Name'],entry)

# Bundling.Load(path) clips used by player presentation code.
ab_audio=b.asset('cab-audioclip.000');ab=next(o.read_typetree() for o in ab_audio.objects.values() if o.type.name=='AssetBundle')
container={k.lower():v['asset'] for k,v in ab['m_Container']}
named={}
for path in ('content/shared/sfx/vomit','content/shared/sfx/bone_break','content/item/sfx/geiger_low','content/item/sfx/geiger_medium','content/item/sfx/geiger_high','content/item/sfx/geiger_ultra'):
    ptr=container.get(path)
    if ptr is None:issues['missing bundle path '+path]+=1;continue
    named[path]=clip(ab_audio,ptr)

def scene_world(a,t_obj):
    m=np.eye(4);t=t_obj.read_typetree()
    while True:
        m=trs(t)@m
        if not t['m_Father']['m_PathID']:break
        t=b.resolve(a,t['m_Father']).read_typetree()
    return m
def source(a,ptr):
    """AudioSource serialized settings (rolloffMode 0 Logarithmic, 1 Linear, 2 Custom)."""
    d=b.resolve(a,ptr).read_typetree() if 'm_PathID' in ptr else ptr
    return {'clip':clip(a,d['m_audioClip']),'enabled':bool(d['m_Enabled']),'volume':d['m_Volume'],'pitch':d['m_Pitch'],'loop':bool(d['Loop']),'playOnAwake':bool(d['m_PlayOnAwake']),
        'mute':bool(d['Mute']),'priority':d['Priority'],'dopplerLevel':d['DopplerLevel'],'minDistance':d['MinDistance'],'maxDistance':d['MaxDistance'],'pan2D':d['Pan2D'],'rolloffMode':d['rolloffMode']}
def node_path(a,g):
    names=[g['m_Name']];t=b.components(a,g)['Transform'][0].read_typetree()
    while t['m_Father']['m_PathID']:
        t=b.resolve(a,t['m_Father']).read_typetree();names.append(b.resolve(a,t['m_GameObject']).read_typetree()['m_Name'])
    return '/'.join(reversed(names))
def scene_audio(name):
    a=b.asset(name);ambient=[];music=[];loops=[]
    for o,d,s in behaviours(a):
        g=b.resolve(a,d['m_GameObject']).read_typetree() if d.get('m_GameObject',{}).get('m_PathID') else None
        if s=='AmbientAudioPlayer':
            m=scene_world(a,b.components(a,g)['Transform'][0])
            ambient.append({'path':node_path(a,g),'position':[float(m[0,3]),float(m[1,3]),float(-m[2,3])],'daySound':clip(a,d['daySound']),'nightSound':clip(a,d['nightSound']),
                'daySource':source(a,d['daySource']),'nightSource':source(a,d['nightSource'])})
        elif s=='MusicPlayer':
            music.append({'path':node_path(a,g),'timeBetweenTracks':d['timeBetweenTracks'],'targetVolume':d['targetVolume'],'startDelay':d['startDelay'],
                'tracks':[clip(a,p) for p in d['tracks']],'source':source(a,b.components(a,g)['AudioSource'][0].read_typetree())})
    for o in a.objects.values():
        if o.type.name!='AudioSource':continue
        d=o.read_typetree();g=b.resolve(a,d['m_GameObject']).read_typetree();cs=b.components(a,g)
        if 'AmbientAudioPlayer' in cs or 'MusicPlayer' in cs or not d['m_audioClip']['m_PathID']:continue
        m=scene_world(a,cs['Transform'][0]);loops.append({'path':node_path(a,g),'active':bool(g['m_IsActive']),'position':[float(m[0,3]),float(m[1,3]),float(-m[2,3])],**source(a,d)})
    ambient.sort(key=lambda e:e['position']);return ambient,music,loops
island_ambient,island_music,island_loops=scene_audio('buildplayer-rust_island_2013')
menu_ambient,menu_music,menu_loops=scene_audio('buildplayer-menubackground')

manifest={'surfaces':surfaces,'defaultSurface':default_surface,'footstepTraits':traits,'characters':characters,'named':named,
    'island':{'ambient':island_ambient,'music':island_music,'loops':island_loops},'menu':{'ambient':menu_ambient,'music':menu_music,'loops':menu_loops},
    'clips':clips,'summary':dict(issues),'sourceSHA256':b.sources,
    'conversion':'Positions are browser space (Unity Z negated). Clips are the bundles\' original Ogg/WAV payloads.'}
manifest['outputSHA256']={p.name:__import__('hashlib').sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.iterdir()) if p.is_file()}
(OUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'),allow_nan=False),encoding='utf-8')
print(json.dumps({'clips':len(clips),'surfaces':{v['name']:len(v['biped']) for v in surfaces.values()},'traits':{v['name']:v['strideDist'] for v in traits.values()},
    'characters':{k:v.get('footsteps') and traits[v['footsteps']]['name'] for k,v in characters.items() if v['footstepEmitter']},'ambient':len(island_ambient),'music':[len(m['tracks']) for m in island_music],
    'menuLoops':[l['path'] for l in menu_loops],'issues':dict(issues)}))
