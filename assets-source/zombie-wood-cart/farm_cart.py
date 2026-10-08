"""Open farm truck detailing. Runtime XYZ metres; Blender X,-Z,Y.

Loaded by build-crew.py after it derives the original timber platform. Keep
the boarding bays, sockets, gate and giant/calf deck unchanged. No preview
objects are saved or exported with the editable/shipped vehicle.
"""
import bpy
import bmesh
import json
import math
import numpy as np
from mathutils import Vector


def point(p):
    return Vector((p[0], -p[2], p[1]))


def attach(obj, parent, mat):
    matrix = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = matrix
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def material(name, color, metallic=0, roughness=.7):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    return mat


def bevel(obj, width=.02, segments=3):
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('Soft manufactured edges', 'BEVEL')
    mod.width = width
    mod.segments = segments
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def box(name, size, pos, mat, parent, rounding=.015):
    bpy.ops.mesh.primitive_cube_add(size=1, location=point(pos))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rounding:
        bevel(obj, rounding)
    return attach(obj, parent, mat)


def mesh(name, vertices, faces, mat, parent):
    data = bpy.data.meshes.new(name)
    data.from_pydata([point(p) for p in vertices], [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return attach(obj, parent, mat)


def cylinder(name, radius, depth, pos, mat, parent, axis='X', vertices=24):
    rotation = (0, math.pi/2, 0) if axis == 'X' else ((math.pi/2, 0, 0) if axis == 'Z' else (0, 0, 0))
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
                                      location=point(pos), rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bevel(obj, min(.008, depth/5), 2)
    return attach(obj, parent, mat)


def rod(name, a, b, radius, mat, parent):
    a, b = point(a), point(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=(b-a).length,
                                      location=(a+b)/2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return attach(obj, parent, mat)


def ring(name, pos, radius, tube, mat, parent, axis='X', tilt=0):
    rotation = (0, math.pi/2, 0) if axis == 'X' else (math.pi/2 + tilt, 0, 0)
    bpy.ops.mesh.primitive_torus_add(major_segments=40, minor_segments=8,
                                   major_radius=radius, minor_radius=tube,
                                   location=point(pos), rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return attach(obj, parent, mat)


def fender(name, x, z, width, radius, mat, parent, rear_angle=194):
    # A solid curved strip with closed thickness, open beneath the tyre.
    segments = 22
    vertices = []
    for i in range(segments+1):
        theta = math.radians(-14 + (rear_angle+14)*i/segments)
        for px, r in ((x-width/2, radius), (x+width/2, radius),
                      (x+width/2, radius-.035), (x-width/2, radius-.035)):
            vertices.append((px, .46 + r*math.sin(theta), z+r*math.cos(theta)))
    faces = [(3, 2, 1, 0)]
    for i in range(segments):
        for j in range(4):
            faces.append((4*i+j, 4*i+(j+1)%4, 4*(i+1)+(j+1)%4, 4*(i+1)+j))
    faces.append(tuple(4*segments+j for j in range(4)))
    obj = mesh(name, vertices, faces, mat, parent)
    bevel(obj, .008, 2)
    return obj


def tyre(name, x, z, mat, parent):
    profile = [(-.125, .255), (-.15, .34), (-.125, .425), (-.10, .444),
               (.10, .444), (.125, .425), (.15, .34), (.125, .255)]
    segments = 48
    vertices = [(x+dx, .46+r*math.sin(i*2*math.pi/segments),
                 z+r*math.cos(i*2*math.pi/segments))
                for i in range(segments) for dx, r in profile]
    faces = []
    for i in range(segments):
        for j in range(len(profile)):
            faces.append((i*8+j, i*8+(j+1)%8, ((i+1)%segments)*8+(j+1)%8,
                          ((i+1)%segments)*8+j))
    obj = mesh(name, vertices, faces, mat, parent)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    # Joined, shallow chevron blocks: geometry remains visible without huge textures.
    blocks = []
    for i in range(28):
        theta = i*2*math.pi/28
        for row in (-1, 1):
            block = box(name+'_tread', (.13, .027, .070),
                        (x+row*.065, .446*math.cos(theta)+.46,
                         z+.446*math.sin(theta)), mat, parent, 0)
            bevel(block, .003, 1)
            block.rotation_euler.x = -theta
            block.rotation_euler.z = row*.18
            blocks.append(block)
    bpy.ops.object.select_all(action='DESELECT')
    for block in blocks:
        block.select_set(True)
    bpy.context.view_layer.objects.active = blocks[0]
    bpy.ops.object.join()
    blocks[0].name = name+'_tread_blocks'


def timber_material(source):
    n = 512
    v, u = np.mgrid[0:n, 0:n].astype(float)/n
    rng = np.random.default_rng(260105)
    warp = u + .009*np.sin(v*21) + .006*np.sin(v*45+u*8)
    for cx, cy in ((.22, .31), (.74, .73)):
        warp += .022*np.exp(-((u-cx)/.10)**2-((v-cy)/.08)**2)
    shade = .055*np.sin(warp*215+.5*np.sin(v*11)) + .021*np.sin(warp*740+np.sin(v*83))
    shade += rng.normal(0, .006, (n, n))
    rgba = np.ones((n, n, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(np.array([.56, .355, .185])+shade[:, :, None], 0, 1)
    image = bpy.data.images.new('Farm truck warm oak grain', width=n, height=n)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(source/'farm-wood-grain.png')
    image.file_format = 'PNG'
    image.save()
    image.pack()
    mat = material('Farm truck weathered warm oak', (.56, .355, .185))
    shader = mat.node_tree.nodes.get('Principled BSDF')
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = image
    mat.node_tree.links.new(tex.outputs['Color'], shader.inputs['Base Color'])
    return mat


def upgrade_farm_cart(root, body, source):
    oak = timber_material(source)
    olive = material('Muted olive painted steel', (.255, .29, .145), .25, .57)
    light_olive = material('Olive raised panel edges', (.34, .365, .205), .2, .55)
    iron = material('Dark chassis and grille', (.065, .07, .06), .6, .66)
    rust = material('Weathered brown bumper', (.245, .115, .055), .5, .75)
    rubber = material('Charcoal rubber tyre', (.035, .039, .032), 0, .88)
    seat = material('Worn saddle brown cushions', (.22, .105, .045), 0, .83)
    brass = material('Warm aged fasteners', (.43, .32, .13), .65, .48)
    glass = material('Warm ivory headlamp lens', (.95, .82, .49), .05, .28)
    shader = glass.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Emission Color'].default_value = (.8, .57, .23, 1)
    shader.inputs['Emission Strength'].default_value = .18
    red = material('Rear red lamp lenses', (.43, .055, .025), .1, .35)
    for obj in list(bpy.context.scene.objects):
        if obj.type == 'MESH':
            for slot in obj.material_slots:
                if slot.material and ('timber' in slot.material.name or 'growth rings' in slot.material.name):
                    slot.material = oak
        if obj.name.startswith(('solid_wheel', 'wheel_hub', 'axle_wood_peg',
                                'driver_control_post', 'driver_control_bar', 'driver_front_lip',
                                'front_long_timber', 'driver_seat')):
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.objects['driver_floor'].dimensions.x = 2.14
    root['design'] = 'open-cockpit-farm-cart'
    root['wheelRadius'] = .46
    root['navigationHalfWidth'] = 2.08
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH' and obj.name.startswith(('chassis_beam', 'axle_')):
            obj.data.materials.clear()
            obj.data.materials.append(iron)
    # A real short bonnet rather than a thin front plate. The seated feet tuck
    # behind it, and the forward axle leaves a doorway behind its rear fender.
    vertices = []
    cross = [(-1, .77), (-1, .96), (-.86, 1.065), (-.50, 1.115),
             (0, 1.135), (.50, 1.115), (.86, 1.065), (1, .96), (1, .77)]
    for z, width, drop in ((2.72, .90, 0), (3.43, .87, .045)):
        vertices.extend((x*width, y-drop, z) for x, y in cross)
    count = len(cross)
    faces = [tuple(reversed(range(count))), tuple(count+i for i in range(count))]
    faces.extend((i, (i+1)%count, (i+1)%count+count, i+count) for i in range(count))
    bonnet = mesh('farm_low_bonnet', vertices, faces, olive, body)
    bevel(bonnet, .035, 4)
    box('bonnet_center_seam', (.018, .012, .62), (0, 1.122, 3.065), light_olive, body, .005)
    box('radiator_surround', (1.07, .58, .09), (0, .79, 3.425), olive, body, .085)
    box('radiator_dark_recess', (.78, .425, .045), (0, .79, 3.479), iron, body, .055)
    for i in range(7):
        box('radiator_vertical_slat_%d'%i, (.035, .375, .035),
            ((i-3)*.105, .79, 3.503), light_olive, body, .009)
    for side in (-1, 1):
        box('headlamp_mount_%d'%side, (.34, .10, .17),
            (side*1.04, .82, 3.29), olive, body, .025)
        cylinder('headlamp_housing_%d'%side, .22, .15, (side*1.04, .99, 3.35), iron, body, 'Z', 40)
        cylinder('headlamp_bezel_%d'%side, .21, .052, (side*1.04, .99, 3.43), brass, body, 'Z', 40)
        cylinder('headlamp_lens_%d'%side, .181, .025, (side*1.04, .99, 3.464), glass, body, 'Z', 40)
        for offset in (-.06, 0, .06):
            box('headlamp_lens_flute', (.008, .30, .005),
                (side*1.04+offset, .99, 3.479), glass, body, .002)
        box('bonnet_catch_%d'%side, (.035, .10, .07), (side*.898, .9, 2.91), brass, body, .006)
    box('front_low_bumper', (2.70, .17, .105), (0, .465, 3.49), rust, body, .035)
    for side in (-1, 1):
        for x in (.35, 1.09):
            cylinder('bumper_rivet', .027, .018, (side*x, .465, 3.553), brass, body, 'Z', 12)
    ring('bumper_tow_loop', (0, .405, 3.535), .09, .019, iron, body, 'Z')
    # The old wooden-bar targets exceeded the real driver's arm length. Put the
    # steering rim within reach and match the runtime hand IK to its lower sides.
    center = (0, 1.39, 2.303)
    tilt = -.50
    ring('driver_steering_wheel', center, .26, .026, rubber, body, 'Z', tilt)
    cylinder('steering_center_hub', .065, .07, center, brass, body, 'Z')
    for theta in (math.pi/2, math.pi*7/6, math.pi*11/6):
        radial = .23*math.sin(theta)
        rod('steering_spoke', center, (.23*math.cos(theta), 1.39+radial*math.cos(tilt),
                                      2.303+radial*math.sin(tilt)), .015, iron, body)
    rod('steering_column', (0, 1.39, 2.33), (0, .66, 2.64), .043, iron, body)
    box('low_dashboard', (1.14, .16, .105), (0, .92, 2.67), olive, body, .035)
    for x, radius in ((-.17, .062), (.03, .042)):
        cylinder('dashboard_gauge_bezel', radius, .016, (x, .94, 2.608), brass, body, 'Z')
        cylinder('dashboard_gauge_face', radius*.81, .02, (x, .94, 2.596), iron, body, 'Z')
        rod('dashboard_gauge_needle', (x, .94, 2.581), (x+.02, .969, 2.581), .005, glass, body)
    rod('gear_lever', (.48, .55, 2.27), (.48, .86, 2.20), .017, iron, body)
    cylinder('gear_knob', .038, .045, (.48, .87, 2.20), seat, body, 'Y', 16)
    box('driver_seat_cushion', (1.08, .10, .53), (0, .883, 1.82), seat, body, .045)
    box('driver_seat_backrest', (.93, .46, .12), (0, 1.105, 1.585), seat, body, .055)
    box('driver_seat_base', (1.08, .12, .53), (0, .773, 1.82), oak, body)
    for x in (-.40, .40):
        box('driver_seat_leg', (.10, .162, .38), (x, .632, 1.82), iron, body)
    for side in (-1, 1):
        box('driver_entry_sill_%d'%side, (.10, .11, .76),
            (side*1.07, .48, 2.09), olive, body, .015)
        box('driver_fixed_step_upper_%d'%side, (.55, .09, .64),
            (side*1.28, .34, 2.09), iron, body, .015)
        box('driver_fixed_step_lower_%d'%side, (.42, .08, .62),
            (side*1.52, .20, 2.09), rust, body, .015)
        rod('driver_step_bracket_%d'%side, (side*1.01, .42, 2.09),
            (side*1.60, .15, 2.09), .028, iron, body)
    # Real rubber tyres at existing X/Z pivots; larger radius does not raise deck.
    for wheel_id in ('FL', 'FR', 'BL', 'BR'):
        wheel = bpy.data.objects['wheel_'+wheel_id]
        wheel.location.z = .46
        if wheel_id.startswith('F'):
            wheel.location.y = -3.025
        wheel['radius'] = .46
        bpy.context.view_layer.update()
        x, z = wheel.location.x, -wheel.location.y
        side = 1 if x > 0 else -1
        tyre('rubber_tyre_'+wheel_id, x, z, rubber, wheel)
        cylinder('wheel_rim_'+wheel_id, .264, .26, (x, .46, z), olive, wheel, vertices=40)
        ring('wheel_rim_lip_'+wheel_id, (x+side*.144, .46, z), .237, .014, brass, wheel)
        cylinder('wheel_hub_'+wheel_id, .095, .075, (x+side*.167, .46, z), rust, wheel)
        for i in range(6):
            theta = i*math.pi/3
            cylinder('wheel_lug_'+wheel_id, .020, .015,
                     (x+side*.173, .46+.147*math.sin(theta), z+.147*math.cos(theta)), brass, wheel, vertices=10)
        fender('farm_fender_'+wheel_id, x, z, .52 if wheel_id[0]=='F' else .35,
               .54 if wheel_id[0]=='F' else .57, olive, body)
        rod('fender_support_'+wheel_id, (x-side*.30, .55, z), (x, .87, z), .025, iron, body)
    # Low exterior iron reinforcement follows the original boards, including the
    # exact movable right rear meshes used by runtime tailgate splitting.
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH' or not obj.name.startswith(('side_panel_', 'rear_gate_panel', 'cargo_front_partition')):
            continue
        obj.data.materials[0] = oak
        # Keep one material on each named mesh: GLTFLoader must return a Mesh,
        # not a multi-primitive Group, for the existing loading-side clipping.
    # Timber boards retain their names and complete box geometry for runtime
    # clipping. Narrow inset strips form readable plank divisions at a distance.
    for side in (-1, 1):
        ranges = [(-3.38, -1.36), (.82, 1.36)] if side == -1 else [(-3.38, 1.36)]
        for lo, hi in ranges:
            # Strips belong to their timber mesh, so the rear flap carries them.
            name = ('side_panel_-1_bay_0' if hi < 0 else 'side_panel_-1_bay_1') if side == -1 else 'side_panel_1'
            panel = bpy.data.objects[name]
            details = []
            for y in (.76, .925):
                details.append(box('plank_reveal', (.006, .011, hi-lo),
                                   (side*1.47, y, (lo+hi)/2), iron, body, 0))
            for z in (lo+.12, hi-.12):
                details.append(box('bed_iron_strap', (.025, .475, .065),
                                   (side*1.479, .866, z), iron, body, .008))
                for y in (.685, 1.045):
                    details.append(cylinder('bed_strap_rivet', .019, .022,
                                            (side*1.501, y, z), brass, body, vertices=12))
            # Parent fittings to the single-material panel. Runtime clips the
            # full subtree, including straps/rivets on the folding rear section.
            for detail in details:
                matrix = detail.matrix_world.copy()
                detail.parent = panel
                detail.matrix_world = matrix
    gate = bpy.data.objects['rear_gate_hinge']
    for side in (-1, 1):
        box('tail_lamp_mount_%d'%side, (.16, .16, .045), (side*1.18, .81, -3.477), iron, gate, .025)
        box('tail_lamp_%d'%side, (.105, .095, .025), (side*1.18, .81, -3.509), red, gate, .016)
    # Rear fittings live on the hinge, not on the static platform.
    box('tailgate_iron_bottom', (2.53, .065, .02), (0, .63, -3.486), iron, gate, .008)
    for side in (-1, 1):
        box('tailgate_iron_strap', (.065, .46, .022), (side*1.03, .86, -3.492), iron, gate, .008)
    # Shift axle tubes to the true wheel center, with a shallow suspension.
    for obj in bpy.context.scene.objects:
        if obj.name.startswith('axle_') and obj.type == 'MESH':
            obj.location.z = .46
            if obj.name.startswith('axle_F'):
                obj.location.y = -3.025
    for z in (3.025, -2.1528):
        for side in (-1, 1):
            box('suspension_leaf', (.105, .045, .75), (side*1.24, .35, z), iron, body, .012)
    # The boarding opening is a gate, not a permanent hole in the calf bed.
    # Hinge at the forward jamb: swung outward it stays ahead of the giant's
    # steps, while the closed panel restores both continuous timber rails.
    hinge = bpy.data.objects.new('giant_boarding_gate_hinge', None)
    bpy.context.collection.objects.link(hinge)
    hinge.parent = root
    hinge.location = point((-1.397925, .551, .82))
    for name, size, pos in (
        ('side_panel_-1_boarding_gate', (.14535, .50, 2.18), (-1.397925, .865, -.27)),
        ('side_top_rail_-1_boarding_gate', (.2394, .105, 2.18), (-1.397925, 1.1475, -.27)),
        ('side_bottom_rail_-1_boarding_gate', (.19665, .09, 2.18), (-1.397925, .595, -.27)),
    ):
        box(name, size, pos, oak, hinge, .012)
    for z in (-1.23, .69):
        box('boarding_gate_iron_strap', (.025, .48, .065), (-1.479, .866, z), iron, hinge, .008)
        for y in (.685, 1.045):
            cylinder('boarding_gate_rivet', .019, .022, (-1.501, y, z), brass, hinge, vertices=12)
    for y in (.76, .925):
        box('boarding_gate_plank_reveal', (.006, .011, 2.18),
            (-1.474, y, -.27), iron, hinge, 0)
    for y in (.70, 1.025):
        cylinder('boarding_gate_hinge_barrel', .034, .13, (-1.49, y, .82), iron, body, 'Y')
    box('boarding_gate_latch', (.045, .055, .17), (-1.52, .98, -1.255), brass, hinge)
    bpy.context.view_layer.update()


def validate_and_render(path, out):
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    for obj in meshes:
        # Reimported geometry must have finite vertices and real surface area.
        assert all(math.isfinite(value) for vertex in obj.data.vertices for value in vertex.co), obj.name
        obj.data.update()
        assert all(face.area > 1e-12 for face in obj.data.polygons), obj.name
    for name in ('rear_gate_hinge', 'giant_bench', 'driver_socket', 'giant_socket',
                 'cargo_socket', 'wheel_FL', 'wheel_FR', 'wheel_BL', 'wheel_BR',
                 'farm_low_bonnet', 'driver_steering_wheel'):
        assert bpy.data.objects.get(name), name
    points = [obj.matrix_world @ Vector(c) for obj in meshes for c in obj.bound_box]
    lo = [min(p[i] for p in points) for i in range(3)]
    hi = [max(p[i] for p in points) for i in range(3)]
    assert max(abs(lo[0]), abs(hi[0])) < 2.08
    assert max(abs(lo[1]), abs(hi[1])) < 3.61
    report = {'design': 'open-cockpit-farm-cart', 'reimported': True,
              'bytes': path.stat().st_size, 'meshCount': len(meshes),
              'triangles': sum(len(p.vertices)-2 for obj in meshes for p in obj.data.polygons),
              'runtimeMinXYZ': [lo[0], lo[2], -hi[1]],
              'runtimeMaxXYZ': [hi[0], hi[2], -lo[1]],
              'wheelRadius': .46, 'bedWidth': 2.6505, 'bedLength': 4.6,
              'hoodMaxHeight': 1.135, 'originalSourcesPreserved': True}
    (out/'model-validation.json').write_text(json.dumps(report, indent=2))
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.world.color = (.5, .5, .5)
    scene.view_settings.view_transform = 'AgX'
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.035))
    attach(bpy.context.object, None, material('Preview sand', (.69, .66, .60)))
    for location, energy, size in (((-4, -6, 7), 1500, 6), ((5, 3, 6), 1000, 5)):
        bpy.ops.object.light_add(type='AREA', location=location)
        lamp = bpy.context.object
        lamp.data.energy = energy
        lamp.data.shape = 'DISK'
        lamp.data.size = size
        lamp.rotation_euler = (Vector((0, 0, .6))-lamp.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    scene.camera = camera
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 9.3
    for name, location in (('front-quarter', (-6.5, -8.5, 5)), ('side', (-10, 0, 2.8)),
                           ('rear-quarter', (6.5, 8.5, 5))):
        camera.location = location
        camera.rotation_euler = (Vector((0, 0, .7))-camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(out/(name+'.png'))
        bpy.ops.render.render(write_still=True)
    print('FARM_CART_VALIDATION', json.dumps(report))
