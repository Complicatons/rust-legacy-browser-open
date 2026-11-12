"""Static RPOS atlas/font/layout export. No original executable or managed code is loaded."""
import json
from unity_common import ROOT,Bundles,Writer,identity,token
OUT=ROOT/'browser/assets/recovered/hud';OUT.mkdir(parents=True,exist_ok=True)
b=Bundles([ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data',ROOT/'analysis/world-source/bundles'],['gameobject.000.unity3d','sharedassets0.assets','scenes.unity3d'])
w=Writer(b,OUT);a=b.asset('buildplayer-rpos');rpos=next(o for o in a.objects.values() if o.type.name=='MonoBehaviour' and b.script(o,o.read_typetree())=='RPOS');rd=rpos.read_typetree()
atlas=b.resolve(a,b.resolve(a,rd['_healthProgress']).read_typetree()['foreground']);atlas_data=next(x.read_typetree() for x in b.components(atlas.assets_file,b.resolve(atlas.assets_file,atlas.read_typetree()['m_GameObject']).read_typetree())['UIFilledSprite']);atlas=b.resolve(atlas.assets_file,atlas_data['mAtlas']);ad=atlas.read_typetree()
material=w.material(b.resolve(atlas.assets_file,ad['material']));texture=w.materials[material]['texture']
from PIL import Image
image=Image.open(OUT/texture);sprites={}
if ad['mCoordinates']!=0:raise ValueError('Expected original pixel atlas coordinates')
for s in ad['sprites']:
 r=s['outer'];x,y,width,height=[round(r[k]) for k in ['x','y','width','height']];file='sprite-'+token(s['name'])+'.png';image.crop((x,y,x+width,y+height)).save(OUT/file);sprites[s['name']]={'file':file,'width':width,'height':height,'outer':r,'inner':s['inner']}
font=b.resolve(a,b.resolve(a,rd['healthLabel']).read_typetree()['mFont']);fd=font.read_typetree();fm=w.material(b.resolve(font.assets_file,fd['mMat']));font_data={'texture':w.materials[fm]['texture'],'source':identity(font),'size':fd['mFont']['mSize'],'base':fd['mFont']['mBase'],'spacingX':fd['mSpacingX'],'spacingY':fd['mSpacingY'],'glyphs':fd['mFont']['mSaved']}
def go_of(obj):return obj if obj.type.name=='GameObject' else b.resolve(obj.assets_file,obj.read_typetree()['m_GameObject'])
def widgets(go):
 result=[]
 def walk(go,parent=-1):
  gd=go.read_typetree();cs=b.components(go.assets_file,gd);t=cs['Transform'][0].read_typetree();i=len(result)
  result.append({'name':gd['m_Name'],'parent':parent,'source':identity(go),'position':t['m_LocalPosition'],'scale':t['m_LocalScale'],'active':gd['m_IsActive'],'widgets':{kind:[x.read_typetree() for x in ls] for kind,ls in cs.items() if kind in ['UISprite','UIFilledSprite','UISlicedSprite','UILabel']}})
  for ptr in t['m_Children']:walk(go_of(b.resolve(go.assets_file,ptr)),i)
 walk(go);return result
plaque_root=go_of(b.resolve(a,rd['_plaqueManager']));pt=b.components(plaque_root.assets_file,plaque_root.read_typetree())['Transform'][0].read_typetree();plaques={}
for ptr in pt['m_Children']:
 go=go_of(b.resolve(plaque_root.assets_file,ptr));plaques[go.read_typetree()['m_Name']]=widgets(go)
health=go_of(b.resolve(a,rd['_healthProgress']));ht=b.components(health.assets_file,health.read_typetree())['Transform'][0].read_typetree();status=go_of(b.resolve(health.assets_file,ht['m_Father']))
belt=go_of(b.resolve(a,rd['_belt']));belt_config=b.components(belt.assets_file,belt.read_typetree())['RPOSInvCellManager'][0].read_typetree();cell=go_of(b.resolve(belt.assets_file,belt_config['CellPrefab']))
# RPOSInventoryCell _stackLabel/_usesLabel/_numberLabel use the plain (non-outlined) ProFont, not the HUD's ProFont_outlined.
cell_label=b.resolve(cell.assets_file,b.components(cell.assets_file,cell.read_typetree())['RPOSInventoryCell'][0].read_typetree()['_stackLabel']).read_typetree()
cf=b.resolve(cell.assets_file,cell_label['mFont']);cfd=cf.read_typetree();cfm=w.material(b.resolve(cf.assets_file,cfd['mMat']));cell_font={'texture':w.materials[cfm]['texture'],'source':identity(cf),'size':cfd['mFont']['mSize'],'base':cfd['mFont']['mBase'],'spacingX':cfd['mSpacingX'],'spacingY':cfd['mSpacingY'],'glyphs':cfd['mFont']['mSaved']}
# RPOS use-hover text (RPOS._useHoverPanel / _useHoverLabel): the panel's local offset under its UIAnchor (UI pixels under
# UIRoot automatic) and the label widget (scale = pixel size, pivot, colour, effect). The label font is the plain ProFont (cellFont).
hp=b.resolve(a,rd['_useHoverPanel']);hgo=go_of(hp);ht_=b.components(hgo.assets_file,hgo.read_typetree())['Transform'][0].read_typetree()
hanchor=go_of(b.resolve(hgo.assets_file,ht_['m_Father']));hanchor_data=b.components(hanchor.assets_file,hanchor.read_typetree())['UIAnchor'][0].read_typetree()
hl=b.resolve(a,rd['_useHoverLabel']);hld=hl.read_typetree();hlgo=go_of(hl);hlt=b.components(hlgo.assets_file,hlgo.read_typetree())['Transform'][0].read_typetree()
use_hover={'source':identity(hp),'anchor':{'name':hanchor.read_typetree()['m_Name'],'side':hanchor_data['side'],'relativeOffset':hanchor_data['relativeOffset']},
 'panel':{'x':ht_['m_LocalPosition']['x'],'y':ht_['m_LocalPosition']['y']},
 'label':{'source':identity(hl),'x':hlt['m_LocalPosition']['x'],'y':hlt['m_LocalPosition']['y'],'scale':hlt['m_LocalScale']['y'],'pivot':hld['mPivot'],'color':hld['mColor'],
  'effectStyle':hld['mEffectStyle'],'effectColor':hld['mEffectColor'],'font':identity(b.resolve(hl.assets_file,hld['mFont']))}}
w.finish({'useHover':use_hover,'sprites':sprites,'font':font_data,'cellFont':cell_font,'status':widgets(status),'plaques':plaques,'belt':widgets(belt),'cell':widgets(cell),'source':identity(rpos),'conversion':'Original Unity UI locals; X right, Y up; atlas rectangles and bitmap glyphs use top-left pixels.'})
print(json.dumps({'sprites':len(sprites),'glyphs':len(font_data['glyphs']),'plaques':list(plaques),'statusNodes':len(widgets(status))}))
