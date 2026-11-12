"""Static ViewModel crosshair export: crosshairTexture, dotTexture, crosshairColor, crosshairOutline, showCrosshairZoom and
showCrosshairNotZoomed of every ViewModel component in the client gameobject bundles (ViewModel.OnGUI draw inputs).
Keys are the ViewModel component identities used by browser/assets/recovered/viewmodels/manifest.json. Data only."""
import json
from unity_common import ROOT,Bundles,Writer,identity
b=Bundles([ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data'],['gameobject.000.unity3d','gameobject.001.unity3d'])
out=ROOT/'browser/assets/recovered/crosshair';w=Writer(b,out)
def tex(owner,ptr):
    t=b.resolve(owner,ptr) if ptr['m_PathID'] else None
    if t is None:return None
    td=t.read_typetree();return {'file':w.texture(t),'name':td['m_Name'],'width':td['m_Width'],'height':td['m_Height'],'filterMode':td['m_TextureSettings']['m_FilterMode'],'source':identity(t)}
viewmodels={}
for asset in list(b.assets.values()):
    for obj in list(asset.objects.values()):
        if obj.type.name!='MonoBehaviour':continue
        try:d=obj.read_typetree()
        except Exception:continue
        if b.script(obj,d)!='ViewModel':continue
        go=b.resolve(obj.assets_file,d['m_GameObject']).read_typetree()
        viewmodels[identity(obj)]={'name':go['m_Name'],'showCrosshairZoom':bool(d['showCrosshairZoom']),'showCrosshairNotZoomed':bool(d['showCrosshairNotZoomed']),
            'crosshairColor':d['crosshairColor'],'crosshairOutline':d['crosshairOutline'],'crosshairTexture':tex(obj.assets_file,d['crosshairTexture']),'dotTexture':tex(obj.assets_file,d['dotTexture']),'noHitPlane':d.get('noHitPlane')}
w.finish({'viewmodels':viewmodels,'conversion':'ViewModel serialized crosshair fields (colours 0..1); textures as PNG (top row first). drawCrosshair = showCrosshairZoom || showCrosshairNotZoomed.'})
print(json.dumps({v['name']:[v['showCrosshairZoom'],v['showCrosshairNotZoomed'],bool(v['crosshairTexture']),bool(v['dotTexture'])] for v in viewmodels.values()}))
