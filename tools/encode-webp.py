"""Lossless WebP copies of the recovered PNG textures that tools/encode-ktx2.mjs leaves as PNG (not power of two, or
over the Basis encoder's 12,582,912-texel limit, such as the three 4096x4096 maps), plus the menu background's PNGs
(loaded before the KTX2 transcoder exists). The pixels are identical (checked
after encoding; RGB under zero alpha is kept with exact=True); WebP lossless is only a smaller container than PNG.
The browser loads the .webp instead of the PNG when browser/assets/recovered/webp.json lists it (browser/texture-source.mjs).
A copy is kept only when it is at least 5% smaller. Incremental by PNG SHA-256. Pillow from .tools/python, no new packages.
Usage: python tools/encode-webp.py [--force] [--min-kb 256]
"""
import sys,json,hashlib,os
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/python'))
from PIL import Image
REC=ROOT/'browser/assets/recovered'
# The menu background loads before the game's renderer (and so its KTX2 transcoder) exists: it reads PNG or WebP even
# where a KTX2 version exists (browser/texture-source.mjs loadRecovered).
BEFORE_RENDERER=('menu-background/',)

def encode(job):
    rel,sha=job;png=REC/rel;out=png.with_suffix('.webp')
    im=Image.open(png);im.load();mode='RGBA' if im.mode in('RGBA','LA','P') else 'RGB';src=im.convert(mode)
    src.save(out,'WEBP',lossless=True,quality=100,method=6,exact=True)
    back=Image.open(out).convert(mode)
    if back.tobytes()!=src.tobytes():out.unlink();return rel,{'sha':sha,'skip':'decoded pixels differ'}
    size=out.stat().st_size,png.stat().st_size
    if size[0]>size[1]*0.95:out.unlink();return rel,{'sha':sha,'skip':f'not smaller ({size[0]} vs {size[1]} bytes)'}
    return rel,{'sha':sha,'webp':out.relative_to(REC).as_posix(),'width':src.width,'height':src.height,'pngBytes':size[1],'webpBytes':size[0]}

def main():
    force='--force' in sys.argv;min_kb=int(sys.argv[sys.argv.index('--min-kb')+1]) if '--min-kb' in sys.argv else 256
    ktx2=json.loads((REC/'ktx2.json').read_text(encoding='utf-8')).get('files',{}) if (REC/'ktx2.json').exists() else {}
    index_file=REC/'webp.json';index=json.loads(index_file.read_text(encoding='utf-8')) if index_file.exists() and not force else {'files':{}}
    jobs=[];files={}
    for png in sorted(REC.rglob('*.png')):
        rel=png.relative_to(REC).as_posix()
        if (ktx2.get(rel,{}).get('ktx2') and not rel.startswith(BEFORE_RENDERER)) or png.stat().st_size<min_kb*1024:continue
        sha=hashlib.sha256(png.read_bytes()).hexdigest();old=index['files'].get(rel)
        if old and old['sha']==sha and (not old.get('webp') or (REC/old['webp']).exists()):files[rel]=old;continue
        jobs.append((rel,sha))
    with ProcessPoolExecutor(max_workers=max(1,(os.cpu_count() or 2)//2)) as pool:
        for rel,entry in pool.map(encode,jobs):files[rel]=entry;print(rel,entry.get('skip') or f"{entry['pngBytes']//1024} -> {entry['webpBytes']//1024} KB",flush=True)
    index={'note':'Lossless WebP copies of PNGs without a KTX2 version, and of the menu background (tools/encode-webp.py); pixels identical to the PNG.','files':dict(sorted(files.items()))}
    index_file.write_text(json.dumps(index,indent=1),encoding='utf-8')
    kept=[e for e in files.values() if e.get('webp')]
    print(f"{len(kept)} WebP: {sum(e['pngBytes'] for e in kept)/1048576:.1f} MB PNG -> {sum(e['webpBytes'] for e in kept)/1048576:.1f} MB")

if __name__=='__main__':main()
