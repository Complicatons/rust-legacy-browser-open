"""Recover the original MenuBackground scene as data. Never runs target code."""
import json
import numpy as np
from unity_common import ROOT,H,Bundles,Writer,identity,trs
from unity_skin import skeleton,skin,clip

b=Bundles([ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data'],['scenes.unity3d'])
a=b.asset('buildplayer-menubackground');out=ROOT/'browser/assets/recovered/menu-background';out.mkdir(exist_ok=True)
writer=Writer(b,out);gos={};transforms={};components={};worlds={}
for obj in a.objects.values():
    if obj.type.name=='GameObject':gos[obj.path_id]=obj.read_typetree()
    elif obj.type.name=='Transform':transforms[obj.path_id]=obj.read_typetree()
    else:
        d=obj.read_typetree()
        if 'm_GameObject' in d:components.setdefault(d['m_GameObject']['m_PathID'],{}).setdefault(obj.type.name,[]).append(obj)
go_transform={t['m_GameObject']['m_PathID']:pid for pid,t in transforms.items()}
def world(tid):
    if not tid:return np.eye(4)
    if tid not in worlds:worlds[tid]=world(transforms[tid]['m_Father']['m_PathID'])@trs(transforms[tid])
    return worlds[tid]
def active(tid):
    return not tid or (bool(gos[transforms[tid]['m_GameObject']['m_PathID']]['m_IsActive']) and active(transforms[tid]['m_Father']['m_PathID']))
def matrix(tid):return (H@world(tid)@H).T.ravel().tolist()
instances=[];lights=[];particles=[];camera=None;bear=None;render_settings=None
for goid,cs in components.items():
    tid=go_transform[goid]
    if not active(tid):continue
    name=gos[goid]['m_Name']
    for obj in cs.get('MeshRenderer',[]):
        d=obj.read_typetree()
        if not d['m_Enabled']:continue
        mf=cs['MeshFilter'][0].read_typetree();key=writer.mesh(b.resolve(a,mf['m_Mesh']));mats=[writer.material(b.resolve(a,p)) for p in d['m_Materials']]
        subsets=d['m_SubsetIndices'] or list(range(len(writer.meshes[key]['parts'])))
        assert len(subsets)==len(mats),'Original menu submesh/material mismatch'
        root=d['m_StaticBatchRoot']['m_PathID'] if d['m_SubsetIndices'] else tid
        instances.append({'name':name,'source':identity(obj),'mesh':key,'materials':mats,'subsets':subsets,'matrix':matrix(root)})
    for obj in cs.get('Camera',[]):camera={'name':name,'matrix':matrix(tid),'data':obj.read_typetree()}
    for obj in cs.get('Light',[]):
        d=obj.read_typetree()
        if d['m_Enabled']:lights.append({'name':name,'matrix':matrix(tid),'data':d})
    for obj in cs.get('ParticleSystem',[]):
        rd=cs['ParticleSystemRenderer'][0].read_typetree();mat=writer.material(b.resolve(a,rd['m_Materials'][0]));particles.append({'name':name,'matrix':matrix(tid),'data':obj.read_typetree(),'renderer':{'data':rd,'material':mat}})
    for obj in cs.get('Animation',[]):
        d=obj.read_typetree()
        if name!='Bear':continue
        root=a.objects[tid];nodes,indices,paths=skeleton(b,root);skins=[]
        for bone_id,index in indices.items():
            bone_go=transforms[bone_id]['m_GameObject']['m_PathID']
            for smr in components.get(bone_go,{}).get('SkinnedMeshRenderer',[]):
                if smr.read_typetree()['m_Enabled']:skins.append(skin(b,writer,smr,indices,identity(smr)))
        clips={}
        for p in d['m_Animations']+[d['m_Animation']]:
            c=b.resolve(a,p)
            if c is not None:
                value=clip(c,paths);clips[value['name']]=value
        default=b.resolve(a,d['m_Animation'])
        bear={'name':name,'matrix':(H@world(tid)).T.ravel().tolist(),'skeleton':nodes,'skins':skins,'clips':clips,'defaultClip':default.read_typetree()['m_Name'] if default else None,'playAutomatically':d['m_PlayAutomatically']}
for obj in a.objects.values():
    if obj.type.name=='RenderSettings':render_settings=obj.read_typetree()
assert camera is not None and bear is not None and len(instances)==7 and len(bear['skins'])==1
writer.finish({'source':'BuildPlayer-MenuBackground','camera':camera,'renderSettings':render_settings,'instances':instances,'lights':lights,'particles':particles,'bear':bear,'limits':['Original shaders, light styling and audio require dedicated runtime integration.']})
print(json.dumps({'instances':len(instances),'lights':len(lights),'particles':len(particles),'bearSkins':len(bear['skins']),'defaultClip':bear['defaultClip'],'clips':list(bear['clips'])}))
