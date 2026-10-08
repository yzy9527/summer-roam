"""Editable stylized single-share paddy plough; no animal/actor asset is touched.

Design coordinates are Three.js metres (X right, Y up, Z forward).
Blender receives (X, -Z, Y); the GLB exporter returns the original axes.
"""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[1]
OUT = ROOT / 'output/paddy-ploughing/rebuild'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0


def xyz(p):
    return Vector((p[0], -p[2], p[1]))


def material(name, rgb, roughness=.92, metal=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metal
    return mat


wood = material('Muted warm worn timber', (.255, .145, .073))
wood_light = material('Slightly worn timber edges', (.30, .183, .099))
wood_dark = material('End grain and old joinery', (.187, .108, .059))
iron = material('Dull rough forged iron', (.085, .095, .087), .94, .12)
rope = material('Coarse flax bindings', (.49, .37, .23))


def empty(name, parent=None, point=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = xyz(point)
    obj.empty_display_size = .06
    return obj


def mesh(name, vertices, faces, parent, mats, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(p) for p in vertices], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    for mat in mats:
        data.materials.append(mat)
    for face in data.polygons:
        # Broad, restrained colour patches, not dense photographic grain.
        face.material_index = 1 if len(mats) > 1 and face.index % 29 == 8 else 0
        face.use_smooth = True
    if bevel:
        mod = obj.modifiers.new('Hand softened edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
    return obj


def timber(name, points, widths, depths, parent, mats=None, steps=5, sides=8):
    pts = [Vector(p) for p in points]
    samples = []
    for j in range(len(pts) - 1):
        a, b, c, d = pts[max(0, j-1)], pts[j], pts[j+1], pts[min(len(pts)-1, j+2)]
        for k in range(steps):
            t = k / steps
            p = .5 * (2*b + (-a+c)*t + (2*a-5*b+4*c-d)*t*t + (-a+3*b-3*c+d)*t**3)
            samples.append((p, widths[j]*(1-t)+widths[j+1]*t, depths[j]*(1-t)+depths[j+1]*t))
    samples.append((pts[-1], widths[-1], depths[-1]))
    vertices, faces = [], []
    for i, (p, width, depth) in enumerate(samples):
        tangent = (samples[min(i+1, len(samples)-1)][0] - samples[max(i-1, 0)][0]).normalized()
        side = tangent.cross(Vector((0, 1, 0)))
        if side.length < .01:
            side = tangent.cross(Vector((1, 0, 0)))
        side.normalize()
        normal = tangent.cross(side).normalized()
        for j in range(sides):
            angle = math.tau*j/sides + math.pi/8
            # An irregular octagonal section, gently varying along the grain.
            irregular = 1 + .035*math.sin(i*.53+j*1.7)
            vertices.append(tuple(p + side*math.cos(angle)*width*irregular + normal*math.sin(angle)*depth*irregular))
    for i in range(len(samples)-1):
        for j in range(sides):
            a = i*sides+j
            b = i*sides+(j+1)%sides
            faces.append((a, b, b+sides, a+sides))
    faces += [tuple(reversed(range(sides))), tuple((len(samples)-1)*sides+j for j in range(sides))]
    return mesh(name, vertices, faces, parent, mats or [wood, wood_light], .005)


def cord(name, points, parent, radius=.014):
    return timber(name, points, [radius]*len(points), [radius]*len(points), parent, [rope], 4, 6)


def binding(name, point, axis, parent, radius=.068, count=3):
    # Each loop is a distinct coarse cord; no mechanical clamp appearance.
    for i in range(count):
        points = []
        for j in range(17):
            angle = math.tau*j/16
            p = Vector(point)
            if axis == 'x':
                p += Vector(((i-(count-1)/2)*.028, math.cos(angle)*radius, math.sin(angle)*radius))
            else:
                p += Vector((math.cos(angle)*radius, math.sin(angle)*radius, (i-(count-1)/2)*.028))
            points.append(tuple(p))
        cord(name + '_' + str(i), points, parent, .010)


assembly = empty('paddy_plough_asset')
assembly['design'] = 'single-share-curved-timber-soft-harness'
yoke = empty('shoulder_yoke', assembly)
# The underside at the centre is Y=0. Runtime fits the span and the lower
# contact contour to actual skinned shoulder cross-section anchors.
timber('curved_shoulder_timber', [(-.5, -.18, 0), (-.34, -.055, -.009), (0, .055, 0), (.34, -.055, .009), (.5, -.18, 0)], [.039,.051,.059,.052,.04], [.041,.044,.052,.046,.04], yoke)
for side in [-1, 1]:
    binding('yoke_lashing_' + str(side), (side*.43, -.12, 0), 'x', yoke, .052)
empty('yoke_pull', yoke, (.49, -.16, -.02))

plough = empty('plough_body', assembly)
beam = empty('draft_beam', plough)
# Offset the forward end to the visible outer flank. The single wooden
# beam starts behind the animal; a soft trace bridges the shoulder gap.
timber('one_curved_draft_beam', [(0,.39,-.12), (.025,.50,.08), (.19,.58,.48), (.41,.63,.81), (.51,.67,1.12)], [.075,.073,.066,.054,.045], [.069,.066,.057,.049,.041], beam)
binding('beam_front_binding', (.51,.67,1.07), 'z', beam, .052)
empty('beam_hitch', beam, (.51,.67,1.12))
timber('curved_plough_post', [(0,.105,-.16), (-.015,.22,-.12), (-.016,.37,-.10), (0,.48,-.035)], [.075,.073,.061,.051], [.066,.073,.062,.05], plough)
timber('plough_sole', [(0,.09,.28), (0,.115,.08), (.005,.12,-.18), (.01,.16,-.30)], [.045,.073,.076,.044], [.042,.054,.054,.039], plough)
timber('curved_control_handle', [(0,.18,-.23), (.015,.45,-.30), (.075,.79,-.35), (.18,1.08,-.42)], [.062,.051,.046,.038], [.055,.045,.041,.035], plough)
timber('hand_grip', [(-.065,1.08,-.42), (.18,1.08,-.42), (.425,1.08,-.42)], [.032,.034,.029], [.029,.030,.027], plough)
empty('handle_grip', plough, (.18,1.08,-.42))
binding('post_join_binding', (0,.41,-.09), 'z', plough, .081, 2)
timber('wooden_join_pin', [(-.095,.36,-.10), (.10,.36,-.10)], [.017,.017], [.017,.017], plough, [wood_dark], 2)

# Forged sheet: tapered forward point, wider heel, shallow concave crown.
# Lower and upper skins are connected at the edges, not a cone or a plane.
stations = [( .43,-.075,.018), (.31,-.035,.067), (.15,.027,.143), (-.04,.094,.155), (-.17,.12,.11)]
vertices = []
for layer in [0, 1]:
    for z, y, width in stations:
        for across in [-1, -.5, 0, .5, 1]:
            vertices.append((across*width, y + .018*(1-across*across) - layer*.015, z))
faces = []
for layer in [0, 1]:
    for i in range(4):
        for j in range(4):
            a = layer*25+i*5+j
            f = (a,a+1,a+6,a+5)
            faces.append(f if layer == 0 else tuple(reversed(f)))
for i in range(4):
    for j in [0, 4]:
        a = i*5+j
        faces.append((a,a+5,a+30,a+25))
for i in [0, 4]:
    for j in range(4):
        a = i*5+j
        faces.append((a,a+25,a+26,a+1))
share = mesh('forged_iron_share', vertices, faces, plough, [iron], .003)
share['workBurialFraction'] = .40
empty('share_tip', plough, (0,-.075,.43))
empty('share_heel', plough, (0,.12,-.17))
# Compact curved turning cheek above the share, kept below the timber frame.
mesh('small_turning_cheek', [( .02,.09,-.11),(.15,.11,-.10),(.17,.23,-.14),(.12,.30,-.22),(.04,.25,-.24),(0,.14,-.20)], [(0,1,2,3,4,5)], plough, [iron], .004)
cheek = bpy.data.objects['small_turning_cheek']
solid = cheek.modifiers.new('Forged plate thickness', 'SOLIDIFY')
solid.thickness = .014

bpy.context.view_layer.update()
SOURCE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'paddy-plough.blend'))
destination = ROOT / 'src/assets/models/paddy-plough.glb'
bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB', export_yup=True,
                          export_extras=True, export_animations=False, export_apply=True)
(OUT / 'asset.json').write_text(json.dumps({
    'source': 'assets-source/paddy-ploughing/paddy-plough.blend',
    'asset': 'src/assets/models/paddy-plough.glb',
    'bytes': destination.stat().st_size,
    'objects': len(bpy.context.scene.objects),
    'animalAssetsModified': False,
    'shareTip': [0,-.075,.43], 'shareHeel': [0,.12,-.17],
}, indent=2))
