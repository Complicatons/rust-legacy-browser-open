"""Statically find original player configuration data; never loads target assemblies."""
from pathlib import Path
import sys,json,collections
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/python'))
import UnityPy
out=ROOT/'analysis/player-inspection';out.mkdir(exist_ok=True)
for name in sys.argv[1:] or ['gameobject.000.unity3d','gameobject.001.unity3d','scriptableobject.000.unity3d']:
    env=UnityPy.load(str(ROOT/'analysis/world-source/bundles'/name))
    results=[]
    print('BUNDLE',name,collections.Counter(o.type.name for o in env.objects))
    for a in env.assets:
        print('ASSET',a.name,'external',[(i+1,e.path) for i,e in enumerate(a.externals)])
        for o in a.objects.values():
            if o.type.name not in ['GameObject','MonoBehaviour','CharacterController','CapsuleCollider','MonoScript']:continue
            try:d=o.read_typetree()
            except Exception as e:print('ERROR',o.path_id,str(e));continue
            text=json.dumps(d)
            if any(k in text.lower() for k in ['human','player','ccmotor','maxforwardspeed','sprintaddspeed','m_slope','standingheight','crouchheight']) or o.type.name in ['CharacterController']:
                results.append({'file':a.name,'pathID':o.path_id,'type':o.type.name,'data':d})
    (out/(name+'.json')).write_text(json.dumps(results,indent=2),encoding='utf-8')
    print('Retained',len(results),'records in',out/(name+'.json'))
