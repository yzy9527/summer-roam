"""Small painted goldfish, with an independent aquatic skeleton. Blender background entry."""
from pathlib import Path
import math
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
parts = []

def mesh(name, vertices, faces, color, bone='Body'):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    colors = data.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
    for face in data.polygons:
        face.use_smooth = True
        for loop in face.loop_indices:
            p = data.vertices[data.loops[loop].vertex_index].co
            c = color(p) if callable(color) else color
            colors.data[loop].color = (*c, 1)
    if bone:
        group = obj.vertex_groups.new(name=bone)
        group.add(list(range(len(vertices))), 1, 'REPLACE')
    parts.append(obj)
    return obj

def sphere(name, center, scale, color, bone='Body'):
    vertices, faces = [], []
    for j in range(11):
        theta = math.pi*j/10
        for i in range(20):
            phi = math.tau*i/20
            vertices.append((center[0]+scale[0]*math.sin(theta)*math.cos(phi),
                             center[1]+scale[1]*math.sin(theta)*math.sin(phi),
                             center[2]+scale[2]*math.cos(theta)))
    for j in range(10):
        for i in range(20):
            a = j*20+i
            faces.append((a, j*20+(i+1)%20, (j+1)*20+(i+1)%20, a+20))
    return mesh(name, vertices, faces, color, bone)

def paint(p):
    # Warm cream belly, rich orange back, with large pigment patches rather than scale noise.
    t = max(0, min(1, (p.z+.016)/.041))
    gold = Vector((1.0, .47, .055)).lerp(Vector((.78, .115, .012)), t)
    if p.z < -.005:
        gold = gold.lerp(Vector((1., .77, .36)), min(.65, (-p.z-.005)*38))
    return tuple(gold)

vertices, faces = [], []
for j in range(19):
    y = -.061 + j*.108/18
    profile = math.sin(math.pi*j/18)**.65
    for i in range(24):
        a = math.tau*i/24
        vertices.append((.021*profile*math.cos(a), y, .027*profile*math.sin(a)))
for j in range(18):
    for i in range(24):
        a=j*24+i
        faces.append((a,j*24+(i+1)%24,(j+1)*24+(i+1)%24,a+24))
mesh('Rounded painted body', vertices, faces, paint)

# A thin, forked flowing tail. Folds give the membrane a readable silhouette from above.
vertices, faces = [], []
for j in range(9):
    t=j/8
    for i in range(9):
        u=i/8*2-1
        vertices.append((u*(.003+.035*t), .038+.075*t-.018*t**3*(1-abs(u)),
                         .006*math.sin(u*math.pi*2)*t+.004*math.sin(t*math.pi)))
for j in range(8):
    for i in range(8):
        a=j*9+i
        faces.append((a,a+1,a+10,a+9))
tail=mesh('Silken forked tail',vertices,faces,(1.,.40,.055),None)
for name in ['Tail','Tail_Mid','Tail_Tip']:
    tail.vertex_groups.new(name=name)
for v in tail.data.vertices:
    t=max(0,min(2,(v.co.y-.038)/.065*2))
    lo=min(1,int(t)); blend=t-lo
    tail.vertex_groups[lo].add([v.index],1-blend,'REPLACE')
    tail.vertex_groups[lo+1].add([v.index],blend,'REPLACE')

for side, suffix in [(-1,'L'),(1,'R')]:
    mesh('Pectoral_'+suffix,
             [(side*.016,-.016,-.003),(side*.022,-.013,.0),(side*.041,.015,-.003),
              (side*.035,.024,-.009),(side*.020,.007,-.010)],
             [(0,1,2),(0,2,3),(0,3,4)],(1.,.57,.16),'Fin_'+suffix)
    sphere('Eye cream '+suffix,(side*.018,-.037,.011),(.005,.007,.0055),(1.,.84,.48))
    sphere('Eye ink '+suffix,(side*.022,-.038,.012),(.002,.0045,.004),(.012,.014,.013))
    sphere('Eye glint '+suffix,(side*.0234,-.039,.0135),(.0009,.0015,.0012),(1.,1.,.9))
    # Short painted gill arc, attached to the body.
    mesh('Gill '+suffix,[(side*.020,-.021,.013),(side*.021,-.018,.002),
                         (side*.018,-.020,-.010),(side*.019,-.019,-.010),
                         (side*.022,-.017,.002),(side*.021,-.020,.013)],
         [(0,1,4,5),(1,2,3,4)],(.62,.09,.014))
mesh('Soft dorsal fin',[(0,-.009,.024),(.002,.007,.046),(0,.026,.031),
                        (0,.039,.011),(0,.019,.020)],[(0,1,2),(0,2,4),(2,3,4)],
     (1.,.36,.035),'Dorsal')
sphere('Tiny mouth', (0,-.061,0),(.0032,.0012,.002),(.40,.09,.025))

bpy.ops.object.select_all(action='DESELECT')
for obj in parts: obj.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.join()
fish=bpy.context.object
fish.name='Canal_goldfish_skin'
mat=bpy.data.materials.new('Hand painted goldfish')
mat.use_nodes=True
nodes=mat.node_tree.nodes
shader=nodes.get('Principled BSDF')
shader.inputs['Roughness'].default_value=.68
shader.inputs['Specular IOR Level'].default_value=.25
color=nodes.new('ShaderNodeVertexColor'); color.layer_name='Paint'
mat.node_tree.links.new(color.outputs['Color'],shader.inputs['Base Color'])
fish.data.materials.clear(); fish.data.materials.append(mat)
for face in fish.data.polygons: face.material_index=0
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'canal-goldfish.blend'))

arm=bpy.data.armatures.new('Aquatic goldfish skeleton')
rig=bpy.data.objects.new('Goldfish_rig',arm)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='EDIT')
spec=[('Root',(0,0,0),(0,-.015,0),None),
      ('Body',(0,0,0),(0,-.03,0),'Root'),
      ('Tail',(0,.038,0),(0,.062,0),'Body'),
      ('Tail_Mid',(0,.062,0),(0,.084,0),'Tail'),
      ('Tail_Tip',(0,.084,0),(0,.110,0),'Tail_Mid'),
      ('Fin_L',(-.016,-.016,-.003),(-.035,.012,-.007),'Body'),
      ('Fin_R',(.016,-.016,-.003),(.035,.012,-.007),'Body'),
      ('Dorsal',(0,.006,.022),(0,.007,.040),'Body')]
for name,head,tip,parent in spec:
    bone=arm.edit_bones.new(name); bone.head=head; bone.tail=tip
    if parent: bone.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
modifier=fish.modifiers.new('Smooth aquatic skin','ARMATURE'); modifier.object=rig
fish.parent=rig
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'canal-goldfish-rigged.blend'))
destination=ROOT/'src/assets/models/canal-goldfish/canal-goldfish-rigged.glb'
destination.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(destination),export_format='GLB',export_yup=True,
                          export_animations=False,export_all_vertex_colors=True)
