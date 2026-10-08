"""Directional summer tree for the 10–30m environment sample. Metres, Z up.
Leaves follow long branch sweeps rather than stacked spherical crowns.
Run Blender --background --python assets-source/trees/sample-tree-02/build.py.
The previous V1 assets are never read or overwritten.
"""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
SRC = Path(__file__).resolve().parent
OUT = ROOT / 'src/assets/trees/sample-tree-02'
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(10216)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'
def linear(x): return x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4
def material(name, color, vertex=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*[linear(x) for x in color], 1)
    p.inputs['Roughness'].default_value = .94
    if vertex:
        n = m.node_tree.nodes.new('ShaderNodeVertexColor'); n.layer_name = 'Pigment'
        m.node_tree.links.new(n.outputs['Color'], p.inputs['Base Color'])
    return m
bark = material('Sample warm grey bark', (.43,.37,.27))
leaves = material('Sample summer leaf pigment', (.47,.64,.30), True)
V=[]; F=[]; UV=[]
def tube(points, radii, sides=9):
    path=[Vector(p) for p in points]; pts=[]; rs=[]
    for j in range(len(path)-1):
        a=path[max(0,j-1)]; b=path[j]; c=path[j+1]; d=path[min(len(path)-1,j+2)]
        for k in range(4):
            t=k/4
            pts.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
            rs.append(radii[j]*(1-t)+radii[j+1]*t)
    pts.append(path[-1]); rs.append(radii[-1]); off=len(V)
    for j,p in enumerate(pts):
        tangent=(pts[min(j+1,len(pts)-1)]-pts[max(0,j-1)]).normalized()
        axis=tangent.cross(Vector((0,1,0))).normalized(); other=tangent.cross(axis).normalized()
        for k in range(sides):
            angle=k*math.tau/sides
            radius=rs[j]*(1+.06*math.sin(angle*3+j*.5))
            V.append(tuple(p+radius*(math.cos(angle)*axis+math.sin(angle)*other)))
            UV.append((k/sides,p.z/2.5))
    for j in range(len(pts)-1):
        for k in range(sides):
            F.append((off+j*sides+k,off+j*sides+(k+1)%sides,off+(j+1)*sides+(k+1)%sides,off+(j+1)*sides+k))
    F.append(tuple(off+k for k in reversed(range(sides))))
    F.append(tuple(off+(len(pts)-1)*sides+k for k in range(sides)))
def mesh(name, vertices, faces, mat, colors=None):
    def reshape(p):
        x,y,z=p
        t=max(0,min(1,(z-2.4)/2.0));t=t*t*(3-2*t)
        h=max(0,min(1,(z-3.0)/5.1));h=h*h*(3-2*h)
        return (x*(1+.38*t),y*(1+.26*t),z+1.9*h)
    vertices=[reshape(p) for p in vertices]
    data=bpy.data.meshes.new(name); data.from_pydata(vertices,[],faces); data.update()
    ob=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(ob); data.materials.append(mat)
    if colors:
        attr=data.color_attributes.new(name='Pigment',type='FLOAT_COLOR',domain='POINT')
        for a,c in zip(attr.data,colors): a.color=(*[linear(x) for x in c],1)
    for p in data.polygons: p.use_smooth=True
    return ob

trunk=[(0,0,-.08),(.04,.03,.25),(.12,.05,1.25),(.20,.05,2.55),(.05,.14,3.6),(-.28,.18,4.65),(-.48,.15,5.9),(-.70,.05,7.05)]
tube(trunk,[.44,.35,.27,.23,.19,.14,.085,.012],14)
for angle,reach in [(.2,.86),(1.3,.66),(2.4,1.02),(3.7,.72),(5.1,.81)]:
    direction=Vector((math.cos(angle),math.sin(angle),0))
    tube([(.02,.02,.35),tuple(direction*.32+Vector((0,0,.11))),tuple(direction*reach+Vector((0,0,-.035)))],[.17,.105,.008],8)

# Major limbs split at different heights and have unequal lengths/directions.
limbs=[
 ([(.18,.05,2.65),(.85,-.15,3.45),(1.85,-.25,4.05),(2.85,-.40,4.18)],[.19,.13,.07,.012]),
 ([(.10,.13,3.4),(-.7,.38,4.2),(-1.7,.62,5.05),(-2.8,.72,5.28)],[.17,.11,.055,.009]),
 ([(-.15,.18,4.15),(.25,1.0,4.9),(.65,1.75,5.65),(1.2,2.35,5.80)],[.13,.095,.045,.008]),
 ([(-.27,.16,4.65),(.35,-.72,5.2),(1.15,-1.55,5.75),(1.9,-2.15,5.95)],[.14,.09,.048,.008]),
 ([(-.38,.16,5.3),(-1.15,-.5,6.0),(-2.05,-1.05,6.58),(-2.75,-1.15,6.62)],[.12,.08,.039,.007]),
 ([(-.48,.12,5.85),(-.2,.15,6.85),(.15,.34,7.55),(.75,.52,7.94)],[.11,.07,.035,.006])]
for points,radii in limbs: tube(points,radii,10)

# Broad, overlapping directional foliage sweeps. Lower ends droop; top grows sideways.
sweeps=[
 [(1.25,-.25,4.65),(2.25,-.55,4.95),(3.10,-.80,4.42),(.95,.55,.62)],
 [(1.50,.20,5.0),(2.20,.35,5.43),(2.95,.55,5.1),(.88,.69,.70)],
 [(-1.0,.52,5.45),(-2.10,.78,5.96),(-3.0,.88,5.48),(.96,.66,.67)],
 [(-.6,.70,6.0),(-1.3,1.30,6.55),(-2.25,1.5,6.25),(.94,.71,.64)],
 [(.35,1.05,5.35),(.85,1.75,6.25),(1.4,2.5,5.85),(.81,.68,.74)],
 [(.60,-.8,5.65),(1.45,-1.65,6.48),(2.25,-2.05,6.0),(.86,.68,.74)],
 [(-.95,-.65,6.12),(-1.9,-1.12,6.98),(-2.9,-1.1,6.55),(.86,.66,.72)],
 [(-.55,.08,6.6),(-.15,.12,7.7),(.85,.30,8.05),(1.0,.90,.69)],
 [(-.25,-.35,6.85),(.75,-.65,7.65),(1.85,-.82,7.42),(.90,.74,.63)],
 [(-.7,.3,6.98),(-1.3,.62,7.75),(-2.15,.72,7.43),(.90,.77,.64)],
 [(.12,.85,6.65),(.35,1.45,7.20),(1.2,1.78,6.92),(.78,.64,.66)],
 [(1.3,-.35,5.7),(1.75,-.5,6.38),(2.8,-.65,6.17),(.75,.62,.61)]]
LV=[]; LF=[]; LC=[]; count=0
for j,(a,b,c,radii) in enumerate(sweeps):
    a,b,c=map(Vector,(a,b,c)); radii=Vector(radii)
    tube([tuple(a-Vector((0,0,.45))),tuple(b-Vector((0,0,.35))),tuple(c-Vector((0,0,.18)))],[.034,.022,.004],6)
    for k in range(2050):
        t=rng.random(); center=(1-t)**2*a+2*(1-t)*t*b+t*t*c
        z=rng.uniform(-1,1); angle=rng.random()*math.tau; radial=math.sqrt(1-z*z)
        direction=Vector((radial*math.cos(angle),radial*math.sin(angle),z))
        # Filled outer band and a minority of interior leaves; irregular coherent rim.
        radius=rng.uniform(.48,1.0)**.5
        shape=.86+.11*math.sin(angle*3+t*8+j)+.07*math.sin(angle*7-t*5)
        p=center+Vector(tuple(direction[i]*radii[i] for i in range(3)))*radius*shape
        # A couple of branch-side windows remain real holes in the canopy.
        if j in [1,3,11] and .28<t<.56 and direction.y<-.45 and direction.z<.2: continue
        n=(direction*.7+Vector((.1,0,.55))).normalized()
        u=n.cross(Vector((0,0,1)))
        if u.length<.05:u=Vector((1,0,0))
        u.normalize(); v=n.cross(u).normalized()
        angle2=rng.random()*math.tau; u,v=u*math.cos(angle2)+v*math.sin(angle2),-u*math.sin(angle2)+v*math.cos(angle2)
        length=rng.uniform(.17,.27); width=length*rng.uniform(.50,.72)
        tone=.045*math.sin(j*.9+t*2)+rng.uniform(-.009,.009)
        color=(.40+tone+.05*radius,.59+tone*.7+.02*radius,.28+tone*.35)
        # Folded six-triangle leaf. No alpha cards or rendered crown shells.
        off=len(LV)
        for x,y in [(1,0),(.45,.8),(-.50,.72),(-1,0),(-.45,-.8),(.5,-.72)]:
            LV.append(tuple(p+u*x*length*.5+v*y*width*.5)); LC.append(color)
        LV.append(tuple(p+n*length*.11)); LC.append(color)
        for q in range(6):LF.append((off+q,off+(q+1)%6,off+6))
        count+=1
wood=mesh('Sample connected trunk and directional branches',V,F,bark)
bpy.context.view_layer.objects.active=wood; wood.select_set(True)
rem=wood.modifiers.new('Joined branch collars','REMESH'); rem.mode='VOXEL';rem.voxel_size=.035;rem.use_smooth_shade=True
bpy.ops.object.modifier_apply(modifier=rem.name)
sm=wood.modifiers.new('Organic collar softening','SMOOTH');sm.factor=.9;sm.iterations=3;bpy.ops.object.modifier_apply(modifier=sm.name)
dec=wood.modifiers.new('Wood budget','DECIMATE');dec.ratio=.27;bpy.ops.object.modifier_apply(modifier=dec.name)
wood.data.validate(verbose=True)
wood.data.update()
uv=wood.data.uv_layers.new(name='Bark')
for poly in wood.data.polygons:
    for li in poly.loop_indices:
        p=wood.data.vertices[wood.data.loops[li].vertex_index].co
        uv.data[li].uv=((math.atan2(p.y,p.x)/math.tau)%1,p.z/2.5)
tex=bark.node_tree.nodes.new('ShaderNodeTexImage')
image=bpy.data.images.new('Sample broad bark pigment',width=256,height=512)
pixels=[]
for yy in range(512):
    for xx in range(256):
        u=xx/256;v=yy/512
        patch=.036*math.sin(u*math.tau*6+.7*math.sin(v*8))+.020*math.sin(u*math.tau*11+v*4)
        seam=max(0,math.cos(u*math.tau*9+math.sin(v*6))-.90)*.15
        pixels.extend([.45+patch-seam,.385+patch*.82-seam,.28+patch*.5-seam,1])
image.pixels.foreach_set(pixels);image.filepath_raw=str(SRC/'bark-colour-planes.png');image.file_format='PNG';image.save();image.pack();tex.image=image
bark.node_tree.links.new(tex.outputs['Color'],bark.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
mesh('Sample continuous branch leaf sweeps',LV,LF,leaves,LC)
bpy.ops.wm.save_as_mainfile(filepath=str(SRC/'sample-tree-02.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'sample-tree-02.glb'),export_format='GLB',export_yup=True)
stats={'leafCount':count,'triangles':sum(len(p.vertices)-2 for ob in bpy.context.scene.objects if ob.type=='MESH' for p in ob.data.polygons),'sweeps':12,'units':'metres','geometry':'directional branch sweeps; folded polygon leaves; joined wood; no billboards'}
(SRC/'stats.json').write_text(json.dumps(stats,indent=2))
print(json.dumps(stats))
