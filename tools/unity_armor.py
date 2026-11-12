"""Static ArmorModel/ActorMeshInfo recovery shared by remote-player skins and sleeper pose meshes."""
from unity_common import identity
from unity_skin import skin_mesh

SLOTS=['feet','legs','torso','head']
class ArmorExport:
    def __init__(self,b,writer,paths=None):
        self.b=b;self.writer=writer;self.paths=paths;self.models={};self.items={}
        so=b.asset('cab-scriptableobject.000')
        trait=next(o for o in so.objects.values() if o.type.name=='MonoBehaviour' and b.script(o,o.read_typetree())=='CharacterArmorTrait')
        group=b.resolve(so,trait.read_typetree()['_defaultGroup'])
        self.defaults={s:self.model(b.resolve(group.assets_file,p),s) for s,p in group.read_typetree()['collection'].items()}
        for a in list(b.assets.values()):
            for o in a.objects.values():
                if o.type.name!='MonoBehaviour':continue
                try:d=o.read_typetree()
                except Exception:continue
                if 'armorModel' not in d or not d['armorModel']['m_PathID']:continue
                model=b.resolve(a,d['armorModel']);kind=b.script(model,model.read_typetree())
                slot=next((s for s in SLOTS if kind=='ArmorModel'+s.title()),None)
                if slot is None:raise ValueError('Unknown armor slot '+str(kind))
                self.items[str(d['_uniqueID'])]={'name':d['m_Name'],'slot':slot,'model':self.model(model,slot)}
    def model(self,obj,slot):
        # ArmorModelRenderer.Censored defaults true in the supplied client, so defaults/items name the censoredModel; the
        # model itself is kept as its `uncensored` record for the censor.nudity runtime toggle (BindArmorModelCheckedNonNull).
        d=obj.read_typetree()
        if d.get('censored',{}).get('m_PathID'):
            uncensored=self.record(obj,slot);key=self.record(self.b.resolve(obj.assets_file,d['censored']),slot)
            self.models[key]['uncensored']=uncensored;return key
        return self.record(obj,slot)
    def record(self,obj,slot):
        d=obj.read_typetree()
        key=identity(obj)
        if key in self.models:return key
        info=self.b.resolve(obj.assets_file,d['_actorMeshInfo']);i=info.read_typetree();rig=self.b.resolve(info.assets_file,i['m_ActorRig']).read_typetree()
        materials=[self.writer.material(self.b.resolve(obj.assets_file,p)) for p in d['_materials']]
        mesh=self.b.resolve(info.assets_file,i['m_Mesh']);poseIndex=rig['m_PoseNames'].index('sleep')
        posed=self.b.resolve(info.assets_file,i['m_PosedMeshes'][poseIndex])
        record={'name':d['m_Name'],'slot':slot,'materials':materials,'sleepMesh':self.writer.mesh(posed)}
        if self.paths is not None:
            record['skin']=skin_mesh(self.writer,mesh,[self.paths[rig['m_BonePaths'][n]] for n in i['m_BoneIndices']],materials,identity(mesh))
        self.models[key]=record;return key
    def resolve(self,slot,uid=0):
        item=self.items.get(str(uid));key=item['model'] if item and item['slot']==slot else self.defaults[slot]
        return self.models[key]
    def manifest(self):return {'slots':SLOTS,'defaults':self.defaults,'items':self.items,'models':self.models,'censored':True}
