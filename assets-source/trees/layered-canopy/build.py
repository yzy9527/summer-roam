"""Deterministic layered broadleaf trees, Blender source and GLB. Z up, metres.
Leaf sprays are real crossed/oriented textured geometry, never camera billboards.
Run: Blender --background --python assets-source/trees/layered-canopy/build.py
"""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector

SRC = Path(__file__).resolve().parent
ROOT = SRC.parents[2]
OUT = ROOT / 'src/assets/trees/layered-canopy'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'

def linear(v): return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4

def material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value = .96
    col = m.node_tree.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'Pigment'
    m.node_tree.links.new(col.outputs['Color'], p.inputs['Base Color'])
    return m

wood_mat = material('Warm olive bark')
leaf_mat = material('Yellow green to jade leaf sprays')
# A hand-built spray silhouette: dozens of tapered leaves and fine stems.
# White RGB keeps all pigment in geometry, shared by every tree and LOD.
size = 256
alpha = [0.] * (size * size)
def ellipse(cx, cy, length, width, angle):
    ca, sa = math.cos(angle), math.sin(angle)
    reach = int(length + width + 2)
    for y in range(max(0, int(cy)-reach), min(size, int(cy)+reach+1)):
        for x in range(max(0, int(cx)-reach), min(size, int(cx)+reach+1)):
            dx, dy = x-cx, y-cy
            u, v = (dx*ca+dy*sa)/length, (-dx*sa+dy*ca)/width
            # Pointed tips instead of oval bubbles.
            coverage = min(1., max(0., (1.-abs(u)**1.35-v*v)*5.))
            alpha[y*size+x] = max(alpha[y*size+x], coverage)
rng = random.Random(4207)
for j in range(11):
    a = j*2.39996
    r = 16 + math.sqrt(j/10)*66
    cx, cy = 128+math.cos(a)*r, 128+math.sin(a)*r
    ellipse((128+cx)/2, (128+cy)/2, r/2+2, .85, a)
    for k in range(4):
        side = -1 if k%2 else 1
        t = .38 + .17*k
        x, y = 128+(cx-128)*t, 128+(cy-128)*t
        tilt = a + side*.9
        length = rng.uniform(10, 17)
        ellipse(x+math.cos(tilt)*length*.65, y+math.sin(tilt)*length*.65,
                length, length*rng.uniform(.32,.46), tilt)
    ellipse(cx+math.cos(a)*8, cy+math.sin(a)*8, 16, 5.3, a)
image = bpy.data.images.new('Fine leaf spray alpha', width=size, height=size, alpha=True)
image.pixels.foreach_set([v for a in alpha for v in (1.,1.,1.,a)])
image.filepath_raw = str(SRC/'leaf-spray.png')
image.file_format = 'PNG'
image.save()
image.pack()
tex = leaf_mat.node_tree.nodes.new('ShaderNodeTexImage')
tex.image = image
leaf_mat.node_tree.links.new(tex.outputs['Alpha'], leaf_mat.node_tree.nodes.get('Principled BSDF').inputs['Alpha'])
leaf_mat.surface_render_method = 'DITHERED'
leaf_mat.use_backface_culling = False

def mesh(name, verts, faces, colors, mat, parent, uv=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.parent = parent
    data.materials.append(mat)
    attr = data.color_attributes.new(name='Pigment', type='FLOAT_COLOR', domain='POINT')
    for c, rgb in zip(attr.data, colors): c.color = (*map(linear, rgb), 1)
    if uv:
        layer = data.uv_layers.new(name='Spray')
        for loop in data.loops: layer.data[loop.index].uv = uv[loop.vertex_index]
    else:
        for p in data.polygons: p.use_smooth = True
    return ob

# Deliberately unequal branch pads: low lateral fans, open middle, narrow high tip.
base_lobes = [
    (-2.05,.05,3.55,1.40,1.02,.68), (1.75,.18,3.85,1.48,1.10,.78),
    (-.60,-.90,4.20,1.22,.94,.65), (.30,1.25,4.55,1.35,1.05,.73),
    (-1.55,.10,5.35,1.55,1.05,.78), (1.65,-.10,5.55,1.48,1.04,.82),
    (-.25,-1.0,5.80,1.28,.96,.76), (.12,1.1,6.22,1.22,.92,.74),
    (-1.05,.10,6.92,1.25,1.0,.82), (1.15,.08,7.0,1.12,.90,.83),
    (.05,-.35,7.85,1.03,.90,.77), (-.30,.3,8.35,.77,.70,.70),
]
stats = []
for variant, (name, height, spread) in enumerate([('Tall',1.,1.), ('Broad',.84,1.16), ('Young',.67,.86)]):
    tree = bpy.data.objects.new('Layered_'+name, None)
    bpy.context.collection.objects.link(tree)
    tree['variant'] = variant
    lobes = []
    for j, values in enumerate(base_lobes):
        x,y,z,rx,ry,rz = values
        # Broader young trees carry fewer, joined upper pads; adult crowns have
        # unequal lateral gaps instead of being scaled copies of one silhouette.
        if variant == 2 and j in (3,7,9): continue
        if variant == 1:
            x += .32*math.sin(j*2.1)
            z += .26*math.cos(j*1.8)
            rx *= 1+.13*math.sin(j*1.9)
        if variant == 2:
            rx *= 1.12
            rz *= 1.14
        angle = variant*.55
        lobes.append(((x*math.cos(angle)-y*math.sin(angle))*spread,
                      (x*math.sin(angle)+y*math.cos(angle))*spread,
                      z*height,rx*spread,ry*spread,rz*height))
    for level, density in [('near',230), ('mid',100), ('far',48)]:
        group = bpy.data.objects.new(level, None)
        bpy.context.collection.objects.link(group)
        group.parent = tree
        group['level'] = level
        WV, WF, WC = [], [], []
        def tube(points, radii, sides=7):
            off = len(WV)
            points = list(map(Vector,points))
            for i,p in enumerate(points):
                tangent = (points[min(i+1,len(points)-1)]-points[max(0,i-1)]).normalized()
                u = tangent.cross(Vector((0,1,0))).normalized()
                v = tangent.cross(u).normalized()
                for k in range(sides):
                    a = k*math.tau/sides
                    WV.append(tuple(p+radii[i]*(u*math.cos(a)+v*math.sin(a))))
                    tone = .028*math.sin(k*3.1+i*.5)
                    WC.append((.37+tone,.32+tone,.20+tone*.7))
            for i in range(len(points)-1):
                for k in range(sides):
                    a=off+i*sides+k; b=off+i*sides+(k+1)%sides
                    WF.append((a,b,b+sides,a+sides))
            WF.append(tuple(off+k for k in reversed(range(sides))))
            WF.append(tuple(off+(len(points)-1)*sides+k for k in range(sides)))
        tube([(0,0,0),(.06,.04,.4),(.10,.04,2.3*height),(-.10,.10,4.2*height),
              (-.22,.16,6.4*height),(-.24,.2,8.2*height)],
             [.27*height,.22*height,.17*height,.13*height,.075*height,.014],10)
        for j,(x,y,z,rx,ry,rz) in enumerate(lobes):
            anchor = Vector((-.04,.08,max(1.8*height,z-2.25*height)))
            end = Vector((x,y,z-.12))
            elbow = anchor.lerp(end,.52)+Vector((0,0,-.18*height))
            rising = anchor.lerp(elbow,.40)+Vector((-.08*height,.06*height,-.18*height))
            tube([anchor,rising,elbow,end],[.11*height,.093*height,.062*height,.015*height],7 if level=='near' else 5)
            if level != 'far':
                for side in [-1,1]:
                    fork = end+Vector((side*rx*.6,side*ry*.26,rz*.28))
                    tube([elbow,end.lerp(fork,.6),fork],[.035*height,.016*height,.003],5)
        for j in range(5):
            a=j*math.tau/5+.4
            tube([(0,0,.19),(.32*height*math.cos(a),.32*height*math.sin(a),.04),
                  (.70*height*math.cos(a),.70*height*math.sin(a),0)], [.115*height,.065*height,.008],5)
        mesh(f'{name}_{level}_wood',WV,WF,WC,wood_mat,group)
        LV, LF, LC, UV = [], [], [], []
        rng = random.Random(5169+variant*101)
        for j,(x,y,z,rx,ry,rz) in enumerate(lobes):
            center = Vector((x,y,z))
            for k in range(density):
                # Fibonacci distribution with jitter gives even coverage at every LOD.
                nz = 1-2*(k+.5)/density
                a=k*2.39996+rng.uniform(-.2,.2)
                radial=math.sqrt(1-nz*nz)
                n=Vector((radial*math.cos(a),radial*math.sin(a),nz))
                edge=1+.13*math.sin(a*3+j+nz*3)+.085*math.sin(a*7+nz*8)
                p=center+Vector((n.x*rx,n.y*ry,n.z*rz))*edge*rng.uniform(.83,1.0)
                p.x += rx*.18*math.sin(nz*2.8+j)
                p.z += rz*.10*math.sin(a*2+j)
                # Tangential sprays create a fluffy silhouette; no visible crown shells.
                normal=Vector((n.x/rx,n.y/ry,n.z/rz)).normalized()
                u=normal.cross(Vector((0,0,1)))
                if u.length<.01: u=Vector((1,0,0))
                u.normalize(); v=normal.cross(u).normalized()
                spin=rng.random()*math.tau
                u,v=u*math.cos(spin)+v*math.sin(spin),-u*math.sin(spin)+v*math.cos(spin)
                width = {'near':.66,'mid':.92,'far':1.36}[level]*spread*rng.uniform(.80,1.16)
                top=max(0,min(1,(nz+.60)/1.6))
                shade=rng.uniform(-.025,.025)+.018*math.sin(j*1.7)
                low,high=(.12,.43,.35),(.64,.82,.29)
                color=tuple(low[i]*(1-top)+high[i]*top+shade for i in range(3))
                off=len(LV)
                for a,b in [(-1,-1),(1,-1),(1,1),(-1,1)]:
                    LV.append(tuple(p+u*a*width*.5+v*b*width*.5)); LC.append(color)
                    UV.append(((a+1)/2,(b+1)/2))
                LF.extend([(off,off+1,off+2),(off,off+2,off+3)])
        leaf=mesh(f'{name}_{level}_leaf',LV,LF,LC,leaf_mat,group,UV)
        # Runtime uses the same actual lobe centres to form coherent canopy normals.
        leaf['canopyLobes'] = [v for lobe in lobes for v in lobe]
        stats.append({'variant':name,'lod':level,'sprays':len(LV)//4,
                      'triangles':len(LF)+sum(len(f)-2 for f in WF)})

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(SRC/'layered-canopy.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'layered-canopy.glb'), export_format='GLB',
                         export_yup=True, export_extras=True)
(SRC/'stats.json').write_text(json.dumps(stats,indent=2))
print(json.dumps(stats))
