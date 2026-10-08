"""Original wooden cart from the user's three-view reference; metres, +Z runtime front.

Blender --background --python assets-source/zombie-wood-cart/build.py
"""
import bpy
import bmesh
import math
import json
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).resolve().parent
OUT = ROOT / 'output/zombie-wood-cart'
GLB = ROOT / 'assets-source/zombie-wood-cart/zombie-wood-cart.glb'
for folder in (SOURCE, OUT, GLB.parent):
    folder.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'


def wood_image(name, radial=False):
    n = 512
    v, u = np.mgrid[0:n, 0:n].astype(float) / n
    rng = np.random.default_rng(260103 + int(radial))
    warp = u + .008 * np.sin(v * 19) + .005 * np.sin(v * 43 + u * 9)
    if radial:
        r = np.sqrt((u - .5)**2 + (v - .5)**2)
        grain = np.sin(r * 230 + .8 * np.sin(np.arctan2(v - .5, u - .5) * 4))
        fine = np.sin(r * 540)
    else:
        for cx, cy in ((.22, .31), (.74, .73)):
            warp += .016 * np.exp(-((u-cx)/.11)**2-((v-cy)/.09)**2)
        grain = np.sin(warp * 215 + .5 * np.sin(v * 11))
        fine = np.sin(warp * 740 + np.sin(v * 83))
    shade = .035 * grain + .011 * fine + rng.normal(0, .007, (n, n))
    base = np.array([.65, .445, .397])
    rgb = np.clip(base[None, None, :] + shade[:, :, None], 0, 1)
    rgba = np.ones((n, n, 4), dtype=np.float32)
    rgba[:, :, :3] = rgb
    image = bpy.data.images.new(name, width=n, height=n)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(SOURCE / (name + '.png'))
    image.file_format = 'PNG'
    image.save()
    image.pack()
    return image


def material(name, color, image=None, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = .82
    p.inputs['Metallic'].default_value = metallic
    if image:
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        mat.node_tree.links.new(tex.outputs['Color'], p.inputs['Base Color'])
    return mat


wood = material('Warm dusty rose timber', (.65, .445, .397), wood_image('wood-grain'))
endgrain = material('Solid wooden wheel growth rings', (.65, .445, .397), wood_image('wheel-rings', True))
iron = material('Small aged iron hinges and latches', (.105, .092, .075), metallic=.55)
peg = material('Recessed wooden pegs', (.38, .235, .19))


def empty(name, runtime_position=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    x, y, z = runtime_position
    obj.location = (x, -z, y)
    obj.parent = parent
    return obj


root = empty('wood_cart')
root['bedWidth'] = 1.55
root['bedLength'] = 2.5
root['deckHeight'] = .55
root['wheelRadius'] = .34
body = empty('cart_body', parent=root)


def box(name, size, position, parent=body, mat=wood, bevel=.015):
    # Positions and dimensions in runtime XYZ, mapped to Blender X,-Y,Z.
    x, y, z = position
    sx, sy, sz = size
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (sx, sz, sy)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Grain runs along the plank's longest axis; end caps receive end-grain-like UV.
    dims = (sx, sz, sy)
    long_axis = max(range(3), key=lambda i: dims[i])
    for face in obj.data.polygons:
        normal_axis = max(range(3), key=lambda i: abs(face.normal[i]))
        axes = [i for i in range(3) if i != normal_axis]
        if long_axis in axes:
            axes = [i for i in axes if i != long_axis] + [long_axis]
        for li in face.loop_indices:
            co = obj.data.vertices[obj.data.loops[li].vertex_index].co
            obj.data.uv_layers.active.data[li].uv = (
                co[axes[0]] / dims[axes[0]] + .5,
                co[axes[1]] / dims[axes[1]] + .5,
            )
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('Softly worn timber corners', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = obj.modifiers.new('Broad flat plank normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world
    return obj


def cylinder(name, radius, depth, position, parent, mat=wood):
    x, y, z = position
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=radius, depth=depth,
                                      location=(x, -z, y), rotation=(0, math.pi/2, 0))
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(mat)
    obj.data.materials.append(endgrain if mat == wood else mat)
    for face in obj.data.polygons:
        if abs(face.normal.x) > .9:
            face.material_index = 1
            for li in face.loop_indices:
                co = obj.data.vertices[obj.data.loops[li].vertex_index].co
                obj.data.uv_layers.active.data[li].uv = (.5+co.y/(2*radius), .5+co.z/(2*radius))
        else:
            face.use_smooth = True
    mod = obj.modifiers.new('Rounded solid wheel rim', 'BEVEL')
    mod.width = min(.012, depth / 4)
    mod.segments = 3
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = obj.modifiers.new('Wheel face normals', 'WEIGHTED_NORMAL')
    bpy.ops.object.modifier_apply(modifier=mod.name)
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world
    return obj


# Rear bed internal X +- .775, Z -1.8 .. .7; all decks share top Y=.55.
for i in range(7):
    box('rear_floor_plank_%02d' % i, (1.55/7-.006, .085, 2.5),
        (-.775+(i+.5)*1.55/7, .5075, -.55))
for side in (-1, 1):
    box('side_panel_%d' % side, (.085, .50, 2.62), (side*.8175, .865, -.55))
    box('side_top_rail_%d' % side, (.14, .105, 2.70), (side*.8175, 1.1475, -.55))
    box('side_bottom_rail_%d' % side, (.115, .09, 2.7), (side*.8175, .595, -.55))
    for z in (-1.84, .74):
        box('corner_post_%d_%s' % (side, z), (.13, .66, .13), (side*.8175, .88, z))
    box('chassis_beam_%d' % side, (.16, .14, 3.74), (side*.45, .41, 0))
box('cargo_front_partition', (1.55, .56, .085), (0, .87, .7425))
box('partition_top_cap', (1.70, .11, .13), (0, 1.145, .7425))

# Reference's two forward beams form a shallow driver pocket with footboard and seat.
box('driver_floor', (1.12, .085, .96), (0, .5075, 1.31))
for side in (-1, 1):
    box('front_long_timber_%d' % side, (.10, .18, 1.05), (side*.60, .635, 1.31))
box('driver_front_lip', (1.30, .15, .11), (0, .615, 1.845))
box('driver_seat', (1.10, .12, .28), (0, .81, 1.025))
for side in (-1, 1):
    box('driver_control_post_%d' % side, (.06, .45, .07), (side*.48, .855, 1.44))
box('driver_control_bar', (1.05, .065, .085), (0, 1.08, 1.44))
empty('driver_socket', (0, .87, 1.025), root)
empty('cargo_socket', (0, .55, -.55), root)

# Rear board closes the entire width. Pivot at its lower hinge: local X rotation opens.
gate = empty('rear_gate_hinge', (0, .55, -1.86), root)
gate['closedAngle'] = 0.0
gate['openAngle'] = -math.pi/2
box('rear_gate_panel', (1.55, .52, .08), (0, .87, -1.86), gate)
box('rear_gate_top_rail', (1.67, .10, .13), (0, 1.15, -1.86), gate)
box('rear_gate_bottom_rail', (1.67, .085, .14), (0, .5925, -1.86), gate)
for side in (-1, 1):
    box('gate_stile_%d' % side, (.12, .66, .12), (side*.73, .88, -1.86), gate)
    box('hinge_strap_%d' % side, (.10, .16, .025), (side*.53, .63, -1.932), gate, iron, .005)
    cylinder('hinge_pin_%d' % side, .023, .14, (side*.53, .565, -1.91), body, iron)
    box('closed_gate_latch_%d' % side, (.15, .045, .04), (side*.79, 1.09, -1.94), gate, iron, .004)

for front, z in ((True, 1.24), (False, -1.17)):
    cylinder('axle_%s' % front, .045, 1.94, (0, .34, z), body, iron)
    for left, x in ((True, .94), (False, -.94)):
        wheel = empty('wheel_%s%s' % ('F' if front else 'B', 'L' if left else 'R'), (x, .34, z), root)
        wheel['radius'] = .34
        cylinder('solid_wheel_%s%s' % (front, left), .34, .19, (x, .34, z), wheel)
        cylinder('wheel_hub_%s%s' % (front, left), .105, .045,
                 (x+math.copysign(.117, x), .34, z), wheel)
        cylinder('axle_wood_peg_%s%s' % (front, left), .036, .01,
                 (x+math.copysign(.144, x), .34, z), wheel, peg)

bpy.context.view_layer.update()
asset_objects = list(bpy.context.scene.objects)
for obj in asset_objects:
    if obj.type != 'MESH':
        continue
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=1e-6)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_area() < 1e-10], context='FACES')
    bm.normal_update()
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    # BMesh edits invalidate previous split normals; rebuild them on final topology.
    obj.data.normals_split_custom_set([(0, 0, 0)] * len(obj.data.loops))
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('Final cleaned normals', 'WEIGHTED_NORMAL')
    bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'zombie-wood-cart.blend'))
bpy.ops.object.select_all(action='DESELECT')
for obj in asset_objects:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True,
                          export_extras=True, export_yup=True, export_animations=False)

# Validate the shipped asset after a real round trip before rendering it.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(GLB))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
size = [max(p[i] for p in points)-min(p[i] for p in points) for i in range(3)]
report = {'glb': str(GLB.relative_to(ROOT)), 'bytes': GLB.stat().st_size,
          'meshCount': len(meshes), 'triangles': sum(len(p.vertices)-2 for o in meshes for p in o.data.polygons),
          'runtimeSizeXYZ': [size[0], size[2], size[1]],
          'bedInternalWidth': 1.55, 'bedInternalLength': 2.5, 'deckHeight': .55,
          'wheelRadius': .34, 'reimported': True}
for name in ('rear_gate_hinge', 'driver_socket', 'cargo_socket', 'wheel_FL', 'wheel_FR', 'wheel_BL', 'wheel_BR'):
    assert bpy.data.objects.get(name), name
for o in meshes:
    o.data.update()
    assert all(math.isfinite(v) for p in o.data.vertices for v in p.co)
    assert all(p.area > 1e-12 for p in o.data.polygons), (o.name, min(p.area for p in o.data.polygons))
(OUT / 'model-validation.json').write_text(json.dumps(report, indent=2))

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 20
scene.cycles.use_denoising = True
scene.render.resolution_x = 1050
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.world.color = (.5, .5, .5)
scene.view_settings.view_transform = 'AgX'
bpy.ops.mesh.primitive_plane_add(size=200)
bpy.context.object.data.materials.append(material('Preview sand', (.71, .68, .61)))
bpy.context.object.location.z = -.012
for location, energy, size in (((-3, -4, 7), 950, 5), ((4, 3, 5), 650, 4)):
    bpy.ops.object.light_add(type='AREA', location=location)
    bpy.context.object.data.energy = energy
    bpy.context.object.data.shape = 'DISK'
    bpy.context.object.data.size = size
    bpy.context.object.rotation_euler = (Vector((0, 0, .5))-bpy.context.object.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.camera_add()
camera = bpy.context.object
scene.camera = camera
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 5.4
for name, location in (('front-quarter', (4.4, -5.8, 3.4)), ('rear-gate', (4.4, 5.8, 3.4)), ('top', (0, 0, 8))):
    camera.location = location
    camera.rotation_euler = (Vector((0, 0, .52))-camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(OUT / (name + '.png'))
    bpy.ops.render.render(write_still=True)
print('CART_VALIDATION', json.dumps(report))
