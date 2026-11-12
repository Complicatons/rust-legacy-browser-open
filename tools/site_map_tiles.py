"""Base raster tiles for the Island page's modern map.

The modern map is drawn top-down from the original data, in a clean map style: the terrain's own colour and normal maps
(TerrainControl _ControlColor / _ControlNormal) with the splat layers' detail and the rock layer's normal map on cliffs,
hillshade, the scene's real meshes (rock formations, buildings, props, the road) and the terrain trees rasterized from
above with their textures, cast shadows, ink outlines, shallow water over the sea bed, shoreline foam and contours.

Reads browser/assets/recovered (heights, terrain textures, scene manifest + meshes, trees) and the window in
site/generated/map/modern.json (tools/site-map.mjs). Writes site/generated/map/modern/{z}/{x}_{y}.jpg + manifest.json.
Static data only. Run with the project's Python tools:
  python tools/site_map_tiles.py                      modern pyramid
  python tools/site_map_tiles.py aerial               aerial pyramid from tools/capture-aerial.mjs renders
  python tools/site_map_tiles.py preview X Z METRES OUT.png    one north-up crop centred on scene (X, Z)
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, '.tools', 'python'))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

R = os.path.join(ROOT, 'browser', 'assets', 'recovered')
S = os.path.join(R, 'scene')
OUT = os.path.join(ROOT, 'site', 'generated', 'map')
CELL = 16000 / 2048
MPP = 0.5  # metres per pixel at the most detailed level
TILE = 256
BLOCK, MARGIN = 1024, 64  # rendered in blocks; the margin covers shadows and outlines across block edges

# Light from the north-west (top-left of the north-up map), 45 degrees up. Image axes: col = +x, row = +z (scene z).
LIGHT = np.array([-1.0, math.sqrt(2), -1.0]) / 2
RELIEF, DETAIL = 2.2, .55  # hillshade exaggeration; how much of the splat textures' own variation is kept
SHADOW_TAN = 1.4  # tan(altitude) for cast shadows: a high sun keeps them short
SUN, SKY = np.array([1.06, 1.0, .9]), np.array([.9, .95, 1.08])
SEA_DEEP, SEA_SHALLOW, FOAM = np.array([14, 32, 42.]), np.array([66, 132, 136.]), np.array([214, 228, 222.])
SKIP = {'road', 'Clouds', 'Atmosphere', 'Sun', 'Plane', 'sprite', 'ContextHint', 'Tile'}
SKIP_SHADERS = ('Context/Sprite', 'FX/Water4', 'Time of Day', 'Utility/WriteZ')
ROCK, OBJECT, ROAD, TREE = 1, 2, 3, 4


def resample(a, box, size, method=Image.BICUBIC):
    """a (2-D float) sampled over box (left, top, right, bottom in a's pixel units) into size = (w, h)."""
    im = Image.fromarray(np.ascontiguousarray(a, dtype=np.float32), mode='F')
    return np.asarray(im.transform(size, Image.EXTENT, box, method), dtype=np.float32)


def smooth(a, k):
    for axis in (0, 1):
        p = np.pad(a, [(k, k) if i == axis else (0, 0) for i in (0, 1)], mode='edge')
        c = np.cumsum(p, axis=axis, dtype=np.float64)
        c = np.insert(c, 0, 0, axis=axis)
        n = a.shape[axis]
        a = ((np.take(c, range(2 * k + 1, 2 * k + 1 + n), axis=axis) - np.take(c, range(0, n), axis=axis)) / (2 * k + 1)).astype(np.float32)
    return a


def edges(b):
    return (np.diff(b, axis=0, prepend=b[:1]) != 0) | (np.diff(b, axis=1, prepend=b[:, :1]) != 0)


def shift(a, dy, dx, fill):
    """a moved so that out[r, c] = a[r + dy, c + dx]."""
    out = np.full_like(a, fill)
    h, w = a.shape[:2]
    out[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)] = a[max(0, dy):h - max(0, -dy), max(0, dx):w - max(0, -dx)]
    return out


def shore_distance(land, steps):
    """Pixels from the nearest land (octagonal steps, at most `steps`), by repeated one-pixel growth."""
    dist = np.where(land, 0, steps).astype(np.float32)
    grown = land.copy()
    for k in range(1, steps):
        nxt = grown | shift(grown, 1, 0, False) | shift(grown, -1, 0, False) | shift(grown, 0, 1, False) | shift(grown, 0, -1, False)
        if k % 2 == 0:  # alternate with diagonal growth for rounder distances
            nxt |= shift(grown, 1, 1, False) | shift(grown, -1, -1, False) | shift(grown, 1, -1, False) | shift(grown, -1, 1, False)
        dist[nxt & ~grown] = k
        grown = nxt
    return dist


def normalize(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-6)


# ---- textures -----------------------------------------------------------------------------------------------------
_tex = {}


def texture(path, size=None, contrast=1):
    """RGBA float (h, w, 4) in 0..1, optionally box-filtered to size x size (prefiltering for the map's 0.5 m pixels)
    and with its variation around the mean colour scaled by `contrast` (calmer repeats at low zoom)."""
    key = (path, size, contrast)
    if key not in _tex:
        im = Image.open(path).convert('RGBA')
        if size and (im.width > size or im.height > size):
            im = im.resize((size, size), Image.BOX)
        a = np.asarray(im, np.float32) / 255
        if contrast != 1:
            mean = a.reshape(-1, 4).mean(0)
            a = mean + (a - mean) * contrast
        _tex[key] = a
    return _tex[key]


def sample(t, u, v):
    """Nearest texel, repeat wrap; v = 0 is the bottom row (Unity UV)."""
    h, w = t.shape[:2]
    return t[((1 - np.mod(v, 1)) * h).astype(np.int64) % h, (np.mod(u, 1) * w).astype(np.int64) % w]


def tiled(t, metres, x, z, contrast=1):
    """A terrain detail texture repeating every `metres` world metres, prefiltered so one texel is about one pixel."""
    n = max(4, int(round(metres / MPP)))
    t = texture(t, n, contrast)
    return sample(t, (x + 8000) / metres, (8000 - z) / metres)


# ---- scene geometry -----------------------------------------------------------------------------------------------
class Scene:
    """Everything drawn from above: scene instances (rocks, buildings, props, the road) and the terrain trees."""

    def __init__(self, window, pad=80):
        m = json.load(open(os.path.join(S, 'manifest.json')))
        self.m, self.mesh_cache, self.materials, self.mat_index = m, {}, [], {}
        inside = lambda lo, hi: hi[0] > window['x0'] - pad and lo[0] < window['x1'] + pad and hi[2] > window['z0'] - pad and lo[2] < window['z1'] + pad
        self.items = []  # (x0, z0, x1, z1, kind, payload)
        for inst in m['instances']:
            if not inst.get('mesh') or not inst.get('worldBounds') or inst['name'] in SKIP and inst['name'] != 'road':
                continue
            lo, hi = inst['worldBounds']
            if not inside(lo, hi):
                continue
            mats = inst.get('materials') or []
            if any(m['materials'].get(k, {}).get('shader', '').startswith(SKIP_SHADERS) for k in mats):
                continue
            kind = ROCK if inst['name'].isdigit() else ROAD if inst['name'] == 'road' else OBJECT
            self.items.append((lo[0], lo[2], hi[0], hi[2], kind, inst))
        self.trees = []
        models = json.load(open(os.path.join(R, 'manifest.json')))['models']
        self.tree_models = [self.tree_model(json.load(open(os.path.join(R, md['file'])))) for md in models]
        for t in json.load(open(os.path.join(R, 'trees.json'))):
            x, y, z, kind, ws, hs = t[:6]
            ext = self.tree_models[kind]['extent'] * ws
            if window['x0'] - pad < x < window['x1'] + pad and window['z0'] - pad < z < window['z1'] + pad:
                self.items.append((x - ext, z - ext, x + ext, z + ext, TREE, (x, y, z, kind, ws, hs)))
        b = np.array([it[:4] for it in self.items])
        self.bx0, self.bz0, self.bx1, self.bz1 = b.T

    def material(self, key, tex_file, scale=(1, 1), offset=(0, 0), color=(1, 1, 1), cutoff=None, leaf=False, under=None):
        """under: (file, scale, offset, opacity) of an Enviro overlay material's _MainTex2, which _MainTex is blended over."""
        if key not in self.mat_index:
            def load(f, size):
                try:
                    return texture(f, size) if f else None
                except OSError:  # missing or unreadable texture
                    return None
            t = load(tex_file, 256)
            if t is None:
                t = np.full((1, 1, 4), [0.7, 0.68, 0.64, 1], np.float32)
            u = under and load(under[0], 1024)
            mat = {'tex': t, 'scale': np.array(scale, np.float32), 'offset': np.array(offset, np.float32),
                   'color': np.array(color, np.float32), 'cutoff': cutoff, 'leaf': leaf, 'under': None}
            if u is not None:
                mat.update(under=u, under_scale=np.array(under[1], np.float32), under_offset=np.array(under[2], np.float32), opacity=under[3])
            self.mat_index[key] = len(self.materials)
            self.materials.append(mat)
        return self.mat_index[key]

    def colour(self, mid, uv):
        """Texture colour (n, 3) and alpha (n,) of material `mid` at uvs (n, 2)."""
        mat = self.materials[mid]
        tx = sample(mat['tex'], uv[:, 0] * mat['scale'][0] + mat['offset'][0], uv[:, 1] * mat['scale'][1] + mat['offset'][1])
        rgb = tx[:, :3]
        if mat['under'] is not None:  # Enviro overlay: screen above 0.5 of the under colour, multiply below
            un = sample(mat['under'], uv[:, 0] * mat['under_scale'][0] + mat['under_offset'][0], uv[:, 1] * mat['under_scale'][1] + mat['under_offset'][1])[:, :3]
            over = np.where(un > .5, 1 - 2 * (1 - rgb) * (1 - un), 2 * rgb * un)
            k = tx[:, 3:] * mat['opacity']
            rgb = un + (over - un) * k
        return rgb * mat['color'], tx[:, 3]

    def scene_material(self, key):
        mat = self.m['materials'].get(key) or {}
        main = (mat.get('textures') or {}).get('_MainTex') or {}
        f = main.get('file') or mat.get('texture')
        c = mat.get('color') or {'r': 1, 'g': 1, 'b': 1}
        s, o = main.get('scale') or mat.get('scale') or {'x': 1, 'y': 1}, main.get('offset') or mat.get('offset') or {'x': 0, 'y': 0}
        u = (mat.get('textures') or {}).get('_MainTex2')
        under = u and (os.path.join(S, u['file']), (u['scale']['x'], u['scale']['y']), (u['offset']['x'], u['offset']['y']), (mat.get('floats') or {}).get('_Opacity', 1))
        return self.material(key, f and os.path.join(S, f), (s['x'], s['y']), (o['x'], o['y']), (c['r'], c['g'], c['b']), mat.get('cutoff'), under=under)

    def mesh(self, key):
        if key not in self.mesh_cache:
            mesh = self.m['meshes'].get(key)
            if not mesh:
                self.mesh_cache[key] = None
                return None
            rd = lambda e, dt: np.fromfile(os.path.join(S, e['file']), dtype=dt)
            pos = rd(mesh['position'], '<f4').reshape(-1, 3)
            nrm = rd(mesh['normal'], '<f4').reshape(-1, 3) if mesh.get('normal') else None
            uv = rd(mesh['uv'], '<f4').reshape(-1, 2) if mesh.get('uv') else None
            parts = [rd(p, '<u4').reshape(-1, 3) for p in mesh['parts']]
            self.mesh_cache[key] = (pos, nrm if nrm is not None and len(nrm) == len(pos) else None, uv if uv is not None and len(uv) == len(pos) else None, parts)
        return self.mesh_cache[key]

    def tree_model(self, d):
        pos = np.array(d['positions'], np.float32).reshape(-1, 3)
        nrm = np.array(d['normals'], np.float32).reshape(-1, 3)
        uv = np.array(d['uv'], np.float32).reshape(-1, 2)
        c, e = d['bounds']['center'], d['bounds']['extent']
        # Leaves are shaded as one round crown (normals from the crown's centre); bark keeps its own normals.
        crown = normalize((pos - [c[0], c[1] + e[1] * 0.25, c[2]]) * [1, 1.6, 1])
        parts = []
        for p in d['parts']:
            leaf = 'Leaf' in p['name']
            idx = np.array(p['indices'], np.int64).reshape(-1, 3)
            key = ('tree', p['texture'], leaf)
            mid = self.material(key, os.path.join(R, p['texture']), cutoff=p.get('cutoff'), leaf=leaf)
            parts.append((idx, mid, crown if leaf else nrm))
        return {'pos': pos, 'uv': uv, 'parts': parts, 'extent': max(e[0], e[2]) + abs(c[0]) + abs(c[2])}

    def triangles(self, x0, z0, x1, z1):
        """World triangles touching the area: positions (T,3,3), normals (T,3,3), uvs (T,3,2), material (T,), kind (T,)."""
        hit = np.nonzero((self.bx1 > x0) & (self.bx0 < x1) & (self.bz1 > z0) & (self.bz0 < z1))[0]
        P, N, U, M, K = [], [], [], [], []
        for i in hit:
            kind, payload = self.items[i][4], self.items[i][5]
            if kind == TREE:
                x, y, z, k, ws, hs = payload
                mdl = self.tree_models[k]
                pos = mdl['pos'] * [ws, hs, ws] + [x, y, z]
                for idx, mid, nrm in mdl['parts']:
                    P.append(pos[idx]); N.append(nrm[idx]); U.append(mdl['uv'][idx])
                    M.append(np.full(len(idx), mid, np.int32)); K.append(np.full(len(idx), TREE, np.uint8))
                continue
            inst = payload
            mesh = self.mesh(inst['mesh'])
            if mesh is None:
                continue
            pos, nrm, uv, parts = mesh
            mt = np.array(inst['matrix'], np.float64).reshape(4, 4).T  # column-major
            wp = pos @ mt[:3, :3].T + mt[:3, 3]
            wn = normalize(nrm @ mt[:3, :3].T) if nrm is not None else None
            subsets, mats = inst.get('subsets') or [0], inst.get('materials') or []
            for si, s in enumerate(subsets):
                if s >= len(parts):
                    continue
                idx = parts[s]
                if not len(idx):
                    continue
                mid = self.scene_material(mats[min(si, len(mats) - 1)]) if mats else self.material(None, None)
                tri = wp[idx]
                P.append(tri)
                if wn is not None:
                    N.append(wn[idx])
                else:
                    fn = normalize(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]))
                    fn *= np.where(fn[:, 1:2] < 0, -1, 1)
                    N.append(np.repeat(fn[:, None], 3, 1))
                U.append(uv[idx] if uv is not None else np.zeros((len(idx), 3, 2), np.float32))
                M.append(np.full(len(idx), mid, np.int32)); K.append(np.full(len(idx), kind, np.uint8))
        if not P:
            return None
        return (np.concatenate(P).astype(np.float32), np.concatenate(N).astype(np.float32), np.concatenate(U).astype(np.float32),
                np.concatenate(M), np.concatenate(K))


def rasterize(cols, rows, w, h, budget=6_000_000):
    """Triangles in pixel space (pixel centres on integers): yields (triangle index, pixel index, barycentrics (F,3))."""
    c0 = np.clip(np.ceil(cols.min(1)), 0, w).astype(np.int64)
    c1 = np.clip(np.floor(cols.max(1)), -1, w - 1).astype(np.int64)
    r0 = np.clip(np.ceil(rows.min(1)), 0, h).astype(np.int64)
    r1 = np.clip(np.floor(rows.max(1)), -1, h - 1).astype(np.int64)
    x0, x1, x2 = cols.T
    y0, y1, y2 = rows.T
    area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    size = np.maximum(c1 - c0 + 1, r1 - r0 + 1)
    ok = (c1 >= c0) & (r1 >= r0) & (np.abs(area) > 1e-7)
    lo = 0
    for k in [1 << i for i in range(13)]:
        sel = np.nonzero(ok & (size > lo) & (size <= k))[0]
        lo = k
        if not len(sel):
            continue
        oy, ox = (a.ravel() for a in np.mgrid[0:k, 0:k])
        step = max(1, budget // (k * k))
        for s in range(0, len(sel), step):
            t = sel[s:s + step]
            px = c0[t, None] + ox
            py = r0[t, None] + oy
            a = area[t, None]
            l1 = ((px - x0[t, None]) * (y2[t, None] - y0[t, None]) - (x2[t, None] - x0[t, None]) * (py - y0[t, None])) / a
            l2 = ((x1[t, None] - x0[t, None]) * (py - y0[t, None]) - (px - x0[t, None]) * (y1[t, None] - y0[t, None])) / a
            l0 = 1 - l1 - l2
            m = (px <= c1[t, None]) & (py <= r1[t, None]) & (l0 >= -1e-5) & (l1 >= -1e-5) & (l2 >= -1e-5)
            ti, fi = np.nonzero(m)
            yield t[ti], py[ti, fi] * w + px[ti, fi], np.stack([l0[ti, fi], l1[ti, fi], l2[ti, fi]], 1).astype(np.float32)


# ---- the map --------------------------------------------------------------------------------------------------------
class Terrain:
    def __init__(self):
        self.H = np.fromfile(os.path.join(R, 'heights.f32'), dtype='<f4').reshape(2049, 2049).astype(np.float32)
        terrain = json.load(open(os.path.join(R, 'world-materials.json')))['terrain']
        flip = lambda f: np.asarray(Image.open(os.path.join(R, f)).convert('RGBA'), np.float32)[::-1] / 255
        self.ctrl = flip('texture--1065133729.png')
        self.color = flip(terrain['controlColor']['file'])
        normal = flip(terrain['controlNormal']['file'])
        self.normal = (normal[..., 3] * 2 - 1, normal[..., 1] * 2 - 1)  # DXT5nm: x in alpha, y (Unity z) in green
        self.colTex = np.array([[c['r'], c['g'], c['b']] for c in terrain['colTex']], np.float32)
        layers = json.load(open(os.path.join(R, 'manifest.json')))['layers']
        self.layers = [(os.path.join(R, l['file']), s['tileSize']['x']) for l, s in zip(layers, terrain['splats'])]
        self.rock_normal = os.path.join(R, terrain['normal0']['file'])

    def grid(self, x0, z0, w, h, a=None, n=None):
        """Sample a heightmap-aligned array over the pixel block whose top-left pixel centre is (x0, z0)."""
        a = self.H if a is None else a
        n = n or a.shape[0]
        k = n / 2049 if n != 2049 else 1  # texture texels per heightmap cell (the existing splat convention)
        col = lambda x: (x + 8000) / CELL * k
        row = lambda z: (8000 - z) / CELL * k
        # EXTENT maps pixel edges; heightmap samples sit on texel centres, hence the half-texel offset.
        box = (col(x0 - MPP / 2) + .5 * (n == 2049), row(z0 - MPP / 2) + .5 * (n == 2049),
               col(x0 + (w - .5) * MPP) + .5 * (n == 2049), row(z0 + (h - .5) * MPP) + .5 * (n == 2049))
        return resample(a, box, (w, h), Image.BILINEAR if a is not self.H else Image.BICUBIC)


def render(terrain, scene, water, x0, z0, w, h):
    """RGB (h, w, 3) uint8 of the map with its top-left pixel centred on scene (x0 + MPP/2, z0 + MPP/2)."""
    m = MARGIN
    W, Hh = w + 2 * m, h + 2 * m
    ox, oz = x0 - m * MPP + MPP / 2, z0 - m * MPP + MPP / 2  # centre of the padded block's top-left pixel
    X = ox + np.arange(W, dtype=np.float64) * MPP
    Z = oz + np.arange(Hh, dtype=np.float64) * MPP
    XX, ZZ = np.meshgrid(X, Z)

    # Terrain height (bicubic over the 7.8 m grid) and the terrain textures at this block.
    ht = terrain.grid(ox, oz, W, Hh)
    ctrl = np.stack([terrain.grid(ox, oz, W, Hh, terrain.ctrl[..., i]) for i in range(4)], -1)
    ctrl /= np.maximum(ctrl.sum(-1, keepdims=True), 1e-3)
    ccol = np.stack([terrain.grid(ox, oz, W, Hh, terrain.color[..., i]) for i in range(3)], -1)
    cnx, cnz = (terrain.grid(ox, oz, W, Hh, c) for c in terrain.normal)

    # Ground albedo as the terrain shader's near formula: splat detail times _ControlColor / sum(ctrl * _ColTex).
    s0 = tiled(terrain.layers[0][0], terrain.layers[0][1], XX, ZZ, DETAIL)[..., :3] * .65 + tiled(terrain.layers[0][0], terrain.layers[0][1] * 2, -XX - 16000, -ZZ + 16000, DETAIL)[..., :3] * .35
    detail = s0 * ctrl[..., :1]
    for i in (1, 2, 3):
        detail = detail + tiled(terrain.layers[i][0], terrain.layers[i][1], XX, ZZ, DETAIL)[..., :3] * ctrl[..., i:i + 1]
    ground = detail * ccol / np.maximum(ctrl @ terrain.colTex, 1e-3)

    # Ground normal: _ControlNormal (3.9 m, Unity x / z) with the rock layer's normal map on rock (layer 0).
    ny = np.sqrt(np.clip(1 - cnx ** 2 - cnz ** 2, 0, 1))
    gN = normalize(np.stack([cnx * RELIEF, ny, cnz * RELIEF], -1))  # Unity space, relief exaggerated for the hillshade
    rn = tiled(terrain.rock_normal, terrain.layers[0][1], XX, ZZ)
    dxy = np.stack([rn[..., 3] * 2 - 1, rn[..., 1] * 2 - 1], -1) * .6  # softened: the map shows rock texture, not glare
    dn = np.concatenate([dxy, np.sqrt(np.clip(1 - (dxy ** 2).sum(-1, keepdims=True), 0, 1))], -1)
    T = normalize(np.stack([gN[..., 1], -gN[..., 0], np.zeros_like(cnx)], -1))
    B = -np.cross(gN, T)
    r = ctrl[..., :1]
    nearT = normalize(r * dn + np.concatenate([np.zeros_like(dxy), 1 - r], -1))
    nU = normalize(T * nearT[..., :1] + B * nearT[..., 1:2] + gN * nearT[..., 2:])
    nG = nU * [1, 1, -1]  # to scene axes
    del T, B, nearT, dn, dxy, rn, s0, detail

    # Objects from above: z-buffer of the scene meshes and trees (fragments must clear the ground they stand on).
    zb = np.full(W * Hh, -np.inf, np.float32)
    col = np.zeros((W * Hh, 3), np.float32)
    nrm = np.zeros((W * Hh, 3), np.float32)
    cls = np.zeros(W * Hh, np.uint8)
    tri = scene.triangles(ox - MPP, oz - MPP, ox + W * MPP, oz + Hh * MPP)
    htf = ht.ravel()
    if tri is not None:
        P, N, U, M, K = tri
        tol = np.array([0, 0.05, -0.05, -1.5, -0.3], np.float32)
        cols = (P[..., 0] - ox) / MPP
        rows = (P[..., 2] - oz) / MPP
        for t, pix, bc in rasterize(cols, rows, W, Hh):
            y = (P[t, :, 1] * bc).sum(1)
            vis = y > htf[pix] + tol[K[t]]
            t, pix, bc, y = t[vis], pix[vis], bc[vis], y[vis]
            if not len(t):
                continue
            uv = (U[t] * bc[..., None]).sum(1)
            mids = M[t]
            rgb = np.empty((len(t), 3), np.float32)
            keep = np.ones(len(t), bool)
            for mid in np.unique(mids):
                sel = mids == mid
                rgb[sel], alpha = scene.colour(mid, uv[sel])
                if scene.materials[mid]['cutoff'] is not None:
                    keep[sel] = alpha >= scene.materials[mid]['cutoff']
            t, pix, y, rgb, bc = t[keep], pix[keep], y[keep], rgb[keep], bc[keep]
            if not len(t):
                continue
            o = np.lexsort((y, pix))
            last = np.ones(len(o), bool)
            last[:-1] = pix[o][1:] != pix[o][:-1]
            o = o[last]
            t, pix, y, rgb, bc = t[o], pix[o], y[o], rgb[o], bc[o]
            win = y > zb[pix]
            t, pix, y, rgb, bc = t[win], pix[win], y[win], rgb[win], bc[win]
            zb[pix] = y
            col[pix] = rgb
            nrm[pix] = normalize((N[t] * bc[..., None]).sum(1))
            cls[pix] = K[t]
    zb, col, nrm, cls = zb.reshape(Hh, W), col.reshape(Hh, W, 3), nrm.reshape(Hh, W, 3), cls.reshape(Hh, W)
    obj = cls > 0
    hb = np.where(obj, zb, ht)

    # Lighting: Lambert from the north-west, normalised so flat ground is 1.
    nO = nrm * np.where(nrm[..., 1:2] < 0, -1, 1)  # double-sided: faces seen from above
    nAll = normalize(np.where(obj[..., None], nO, nG))
    rel = np.clip(nAll @ LIGHT, 0, None) / LIGHT[1]

    # Cast shadows: march toward the light over the height buffer. Tree crowns are open, so they cast at half height.
    sh = np.zeros((Hh, W), np.float32)
    step = MPP * math.sqrt(2) * SHADOW_TAN
    caster = np.where(cls == TREE, ht + (zb - ht) * .45, hb)
    for k in range(1, 2 * MARGIN // 3):
        sh = np.maximum(sh, np.clip((shift(caster, -k, -k, -np.inf) - hb - k * step) / 1.2, 0, 1))
    sh = (sh + shift(sh, 1, 0, 0) + shift(sh, 0, 1, 0) + shift(sh, -1, 0, 0) + shift(sh, 0, -1, 0)) / 5

    # Warm sun and cool sky: ambient + direct light (dimmed in shadow), flat open ground about neutral.
    amb, sun = np.where(obj, .5, .42)[..., None], np.where(obj, .62, .66)[..., None]
    light = amb * SKY + sun * (rel * (1 - .55 * sh))[..., None] * SUN

    # Contact shade: the ground darkens a little around anything standing on it.
    lift = np.where(obj & (cls != ROAD), np.clip((zb - ht) / 3, 0, 1), 0).astype(np.float32)
    ao = smooth(lift, 3)
    light = np.where(obj[..., None], light, light * (1 - .3 * ao)[..., None])

    # Map palette: the game's own colours at about their lit brightness, a little calmer; trees a touch brighter.
    g = ground * np.array([2.3, 2.1, 1.75], np.float32)
    lum = g.mean(-1, keepdims=True)
    g = lum + (g - lum) * .92
    gain = np.array([[1, 1, 1], [1.05, 1.05, 1.05], [1.22, 1.2, 1.16], [1.6, 1.55, 1.45], [1.5, 1.7, 1.3]], np.float32)[cls]
    base = np.where(obj[..., None], col * gain + .02, g)
    img = base * light * 255

    # Elevation tint and contour lines (10 m, 50 m) on open ground.
    hs = smooth(ht, 6)
    elev = np.clip((hs - water) / 400, 0, 1)[..., None]
    img = img * (1 - .1 * elev) + np.array([215, 210, 200]) * .1 * elev
    gy, gx = np.gradient(hs, MPP)
    flat = (np.hypot(gx, gy) < .9) & ~obj & (ht > water)
    m10 = edges(np.floor((hs - water) / 10)) & flat
    m50 = edges(np.floor((hs - water) / 50)) & flat
    img[m10] *= .93
    img[m50] *= .8

    # Ink outlines where an object stands clear of what is next to it.
    drop = np.zeros((Hh, W), np.float32)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        drop = np.maximum(drop, hb - shift(hb, dy, dx, np.inf))
    ink = obj & (drop > .8)
    img[ink & (cls == TREE)] *= .72
    img[ink & (cls != TREE) & (cls != ROAD)] *= .55
    road = cls == ROAD
    road_edge = road & ~(shift(road, 1, 0, True) & shift(road, -1, 0, True) & shift(road, 0, 1, True) & shift(road, 0, -1, True))
    img[road_edge] = img[road_edge] * .7 + np.array([60, 48, 34]) * .3

    # Sea: the sea bed seen through the water, shallow to deep, with foam along the shore.
    depth = water - hb
    wet = depth > 0
    if wet.any():
        d = np.clip(depth, 0, None)[..., None]
        clear = np.exp(-d / 3)
        sea = SEA_SHALLOW * np.exp(-d / 22) + SEA_DEEP * (1 - np.exp(-d / 22))
        under = img * clear + sea * (1 - clear)
        dist = shore_distance(~wet, 24) * MPP
        foam = np.clip(np.exp(-dist / 1.4) * .75 + .22 * np.exp(-((dist - 6) / 1.6) ** 2), 0, 1)[..., None]
        img = np.where(wet[..., None], under * (1 - foam) + FOAM * foam, img)

    return np.clip(img[m:m + h, m:m + w], 0, 255).astype(np.uint8)


def write_pyramid(base, tiles_dir, window, size, background=(14, 32, 42), quality=84):
    """Level 0 fits in one tile; the last level is the image's own resolution."""
    levels = max(0, math.ceil(math.log2(size / TILE)))
    for z in range(levels + 1):
        scale = 2 ** (z - levels)
        level = base.resize((max(1, round(base.width * scale)),) * 2, Image.LANCZOS) if z < levels else base
        n = math.ceil(level.width / TILE)
        os.makedirs(os.path.join(tiles_dir, str(z)), exist_ok=True)
        for ty in range(n):
            for tx in range(n):
                tile = Image.new('RGB', (TILE, TILE), background)
                tile.paste(level.crop((tx * TILE, ty * TILE, min(level.width, (tx + 1) * TILE), min(level.height, (ty + 1) * TILE))), (0, 0))
                tile.save(os.path.join(tiles_dir, str(z), f'{tx}_{ty}.jpg'), quality=quality, optimize=True)
    json.dump({'window': window, 'size': base.width, 'mpp': (window['x1'] - window['x0']) / base.width, 'tile': TILE, 'levels': levels, 'northUp': True},
              open(os.path.join(tiles_dir, 'manifest.json'), 'w'))
    return levels


def aerial():
    """Stitch tools/capture-aerial.mjs renders (aerial-raw/{i}_{j}.png, north-up) into the aerial pyramid."""
    raw = os.path.join(OUT, 'aerial-raw')
    meta = json.load(open(os.path.join(raw, 'raw.json')))
    w, px = meta['window'], meta['tilePx']
    size = int(round((w['x1'] - w['x0']) / meta['mpp']))
    full = Image.new('RGB', (meta['nx'] * px, meta['nz'] * px))
    for j in range(meta['nz']):
        for i in range(meta['nx']):
            full.paste(Image.open(os.path.join(raw, f'{i}_{j}.png')).convert('RGB'), (i * px, j * px))
    full = full.crop((0, 0, size, size))
    levels = write_pyramid(full, os.path.join(OUT, 'aerial'), w, size, (20, 20, 20))
    print(f'aerial tiles: {size}px, levels 0..{levels}')


def modern_window():
    modern = json.load(open(os.path.join(OUT, 'modern.json')))
    return modern['window'], modern['waterLine']


def main():
    w, water = modern_window()
    size = int(round((w['x1'] - w['x0']) / MPP))
    terrain, scene = Terrain(), Scene(w)
    full = np.zeros((size, size, 3), np.uint8)
    blocks = [(bx, bz) for bz in range(0, size, BLOCK) for bx in range(0, size, BLOCK)]
    for n, (bx, bz) in enumerate(blocks):
        bw, bh = min(BLOCK, size - bx), min(BLOCK, size - bz)
        full[bz:bz + bh, bx:bx + bw] = render(terrain, scene, water, w['x0'] + bx * MPP, w['z0'] + bz * MPP, bw, bh)
        print(f'  block {n + 1}/{len(blocks)}', flush=True)
    levels = write_pyramid(Image.fromarray(full), os.path.join(OUT, 'modern'), w, size, quality=80)
    print(f'modern tiles: {size}px at {MPP} m/px, levels 0..{levels}')


def preview(x, z, metres, out):
    w, water = modern_window()
    n = int(round(metres / MPP))
    img = render(Terrain(), Scene(w), water, x - metres / 2, z - metres / 2, n, n)
    Image.fromarray(img).save(out)


if __name__ == '__main__':
    if sys.argv[1:2] == ['aerial']:
        aerial()
    elif sys.argv[1:2] == ['preview']:
        preview(float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), sys.argv[5])
    else:
        main()
