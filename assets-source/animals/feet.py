"""Species-specific feet, applied in memory to preserved static Blender sources.

All coordinates are unscaled Blender Z-up / forward -Y. The rig entrypoints call
this before skinning, so rebuilding a rig never overwrites the approved source.
"""
import math
import bpy
from mathutils import Vector


def smooth(a, b, value):
    t = max(0, min(1, (value - a) / (b - a)))
    return t * t * (3 - 2 * t)


def foot_y(profile, name, y):
    return (.96 if name.startswith('H') else -.83) if profile['species'] != 'cow' else y - .025


def leg_bones(bone, profile, name, x, y):
    fy = foot_y(profile, name, y)
    carnivore = profile['species'] != 'cow'
    if carnivore and name.startswith('H'):
        # The stifle is forward of the hip; the elevated hock is behind it.
        if profile['species'] == 'leopard':
            knee, hock = (x, .88, .74), (x, 1.015, .44)
        else:
            # A relaxed wolf stands over a longer, nearly upright metatarsal.
            knee, hock = (x, .87, .75), (x, 1.015, .47)
        bone(name + '_Upper', (x, y, 1.12), knee, 'Body')
        bone(name + '_Lower', knee, hock, name + '_Upper')
        bone(name + '_Hock', hock, (x, fy, .12), name + '_Lower')
        parent = name + '_Hock'
    else:
        knee = (x, y + (.10 if name.startswith('H') else -.10), .61)
        bone(name + '_Upper', (x, y, 1.12), knee, 'Body')
        bone(name + '_Lower', knee, (x, fy, .12 if carnivore else .135), name + '_Upper')
        parent = name + '_Lower'
    z = .12 if carnivore else .135
    bone(name + '_Hoof', (x, fy, z), (x, fy - .20, z), parent)
    if carnivore:
        bone(name + '_Toes', (x, fy - .085, .095), (x, fy - .25, .095), name + '_Hoof')


def distal_weights(p, profile, legs):
    """Return the distal skin blend, or None above the modified limb region."""
    if profile['species'] == 'cow':
        if p.z >= .42:
            return None
        name = min(legs, key=lambda l: (p.x-l[1])**2 + (p.y-l[2])**2)[0]
        foot = 1 - smooth(.24, .42, p.z)
        return {name + '_Hoof': foot, name + '_Lower': 1-foot}
    if p.z >= .84:
        return None
    name = min(legs, key=lambda l: (p.x-l[1])**2 + (p.y-foot_y(profile, l[0], l[2]))**2)[0]
    # Avoid taking over belly vertices while blending the limb into the hip.
    if p.z > .50 and (abs(p.x) < .24 or (name.startswith('F') and p.y > -.37)
                      or (name.startswith('H') and p.y < .48)):
        return None
    if name.startswith('H'):
        feline = profile['species'] == 'leopard'
        upper = smooth(.63 if feline else .64, .83 if feline else .86, p.z)
        hock = 1 - smooth(.36 if feline else .39, .52 if feline else .55, p.z)
        foot = 1 - smooth(.20, .32, p.z)
        return {name+'_Upper': upper, name+'_Lower': (1-upper)*(1-hock),
                name+'_Hock': (1-upper)*hock*(1-foot), name+'_Hoof': (1-upper)*hock*foot}
    foot = 1 - smooth(.20, .32, p.z)
    upper = smooth(.40, .72, p.z)
    return {name+'_Upper': upper, name+'_Lower': (1-upper)*(1-foot), name+'_Hoof': (1-upper)*foot}


def mesh_weights(o, p, profile):
    name = o.get('foot_leg')
    if not name:
        return None
    role = o['foot_role']
    if role == 'toes':
        return {name+'_Toes': 1}
    if role == 'dewclaws':
        if profile['species'] == 'cow':
            # Match the nearby coat blend so the small horn stays seated while
            # the pastern bends, rather than sliding across the leg surface.
            foot = 1 - smooth(.24, .42, p.z)
            return {name+'_Hoof': foot, name+'_Lower': 1-foot}
        return {name+'_Lower': 1}
    return {name+'_Hoof': 1}


def material(name, color, roughness=.75):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    return m


def ellipsoid(name, center, radii, mat, unit, flat=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, location=Vector(center)*unit)
    o = bpy.context.object
    o.name = name
    o.scale = Vector(radii)*unit
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if flat is not None:
        # Flatten the sole without leaving an open bottom or a floating pad.
        for v in o.data.vertices:
            v.co.z = max(v.co.z, flat*unit-o.location.z)
    o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def join(parts, name, leg, role, digits=0):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    o = parts[0]
    o.name = name
    o['foot_leg'], o['foot_role'], o['digits'] = leg, role, digits
    return o


def hoof_half(name, x, y, side, width, mat, unit):
    # Stacked rounded outlines: broad heel, tapered toe, flat bearing surface.
    outlines = [(.014, 1.00), (.037, 1.03), (.15, .95), (.22, .79), (.24, .61)]
    verts, faces = [], []
    count = 24
    for z, size in outlines:
        for k in range(count):
            a = math.tau*k/count
            longitudinal = math.sin(a)
            # Narrow at the toe, full heel bulb; the inner walls retain a clear cleft.
            half_width = width*(.86 if longitudinal < 0 else 1.0)*size
            xx = x + side*(width+.011) + math.cos(a)*half_width
            yy = y + longitudinal*(.197 if longitudinal < 0 else .15)*size
            verts.append((xx*unit, yy*unit, z*unit))
    for j in range(len(outlines)-1):
        for k in range(count):
            faces.append((j*count+k, j*count+(k+1)%count,
                          (j+1)*count+(k+1)%count, (j+1)*count+k))
    faces += [tuple(reversed(range(count))), tuple((len(outlines)-1)*count+k for k in range(count))]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.materials.append(mat)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    for p in me.polygons:
        p.use_smooth = len(p.vertices) == 4
    bpy.context.view_layer.objects.active = o
    bevel = o.modifiers.new('Rounded keratin rim', 'BEVEL')
    bevel.width, bevel.segments = .009*unit, 3
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return o


def bovine_dewclaw(body, x, y, side, mat, unit):
    """Small flattened horn pointing down behind the pastern, seated in coat."""
    # Each cross-section follows the actual rear skin, including calf geometry.
    # Narrow roots and a downward taper avoid the former spherical bead shape.
    sections = [(.330, .016, .010, -.004), (.319, .025, .014, .004),
                (.298, .023, .013, .015), (.274, .010, .006, .024),
                (.268, .003, .003, .025)]
    inv = body.matrix_world.inverted()
    direction = (inv.to_3x3()@Vector((0, -1, 0))).normalized()
    verts, faces, count = [], [], 16
    for z, width, depth, projection in sections:
        xx = x+side*.071
        origin = inv@(Vector((xx, y+1, z))*unit)
        hit, local, _, _ = body.ray_cast(origin, direction)
        rear = (body.matrix_world@local).y/unit if hit else y+.16
        for k in range(count):
            a = math.tau*k/count
            verts.append(((xx+math.cos(a)*width)*unit,
                          (rear+projection+math.sin(a)*depth)*unit, z*unit))
    for j in range(len(sections)-1):
        for k in range(count):
            faces.append((j*count+k, (j+1)*count+k,
                          (j+1)*count+(k+1)%count, j*count+(k+1)%count))
    faces += [tuple(range(count)), tuple(reversed(range((len(sections)-1)*count, len(sections)*count)))]
    mesh = bpy.data.meshes.new('Tapered bovine dewclaw')
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(mat)
    mesh.update()
    o = bpy.data.objects.new('Small rear dewclaw', mesh)
    bpy.context.collection.objects.link(o)
    for p in mesh.polygons:
        p.use_smooth = len(p.vertices) == 4
    return o


def bake_paw_coat(o, coat):
    """Bake the native spatial rosettes to a fresh, non-overlapping paw atlas."""
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=.025)
    bpy.ops.object.mode_set(mode='OBJECT')
    nt = coat.node_tree
    output = nt.nodes.get('Material Output')
    shader = nt.nodes.get('Principled BSDF')
    emission = next(n for n in nt.nodes if n.type == 'EMISSION')
    nt.links.new(emission.outputs[0], output.inputs['Surface'])
    image = bpy.data.images.new('Embedded natural paw coat '+o.name, width=512, height=512)
    targets = []
    for mat in o.data.materials:
        node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = image
        mat.node_tree.nodes.active = node
        targets.append((mat, node))
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 1
    scene.render.bake.margin = 8
    bpy.ops.object.bake(type='EMIT')
    image.pack()
    for mat, node in targets:
        if mat == coat:
            nt.links.new(node.outputs['Color'], shader.inputs['Base Color'])
        else:
            mat.node_tree.nodes.remove(node)
    nt.links.new(shader.outputs[0], output.inputs['Surface'])


def enhance_feet(profile):
    unit, species = profile['unit'], profile['species']
    carnivore = species != 'cow'
    body = next(o for o in bpy.context.scene.objects
                if o.type == 'MESH' and ('body and four legs' in o.name or 'horizontal wolf body' in o.name))
    coat = body.data.materials[0]
    original = list(bpy.context.scene.objects)
    # Remove the old separate cubes/toes from this working copy only.
    for o in original:
        if o.type == 'MESH' and ('hoof' in o.name.lower() or 'paw toe' in o.name.lower()):
            bpy.data.objects.remove(o, do_unlink=True)
    # Keep the continuous mesh and its UVs. Sculpt the old oval toe area into a
    # shorter metacarpal/palm, leaving room for four distinct bearing digits.
    def sculpt(p):
        if carnivore and p.z < .28:
            fy = -.83 if p.y < 0 else .96
            lx = (.41 if p.y < 0 else .44) * (-1 if p.x < 0 else 1)
            t = 1-smooth(.18, .28, p.z)
            p.x = lx+(p.x-lx)*(1-.13*t)
            p.y = fy+(p.y-fy)*(1-.48*t)+.025*t
        elif not carnivore and p.z < .48:
            lx = profile['legX']*(-1 if p.x < 0 else 1)
            ly = profile['frontY'] if p.y < 0 else profile['backY']
            t = 1-smooth(.25, .48, p.z)
            p.x = lx+(p.x-lx)*(1-.20*t)
            p.y = ly+(p.y-ly)*(1-.12*t)
        if carnivore and p.y > .48 and abs(p.x) > .24 and .28 < p.z < .95:
            # Move the apparent backward knee forward; separate the raised hock.
            z = p.z
            if species == 'leopard':
                shift = -.19*math.exp(-((z-.69)/.17)**2)+.065*math.exp(-((z-.39)/.10)**2)
                p.z += (.04*math.exp(-((z-.40)/.16)**2)
                        +.03*math.exp(-((z-.71)/.12)**2))*smooth(.20, .28, z)*(1-smooth(.84, .95, z))
            else:
                shift = -.23*math.exp(-((z-.71)/.17)**2)+.08*math.exp(-((z-.40)/.11)**2)
                p.z += (.07*math.exp(-((z-.40)/.16)**2)
                        +.035*math.exp(-((z-.71)/.12)**2))*smooth(.20, .28, z)*(1-smooth(.84, .95, z))
            p.y += shift*(1-smooth(.84, .95, z))
        return p
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            continue
        if o == body or 'fur tufts' in o.name or 'fine short fur' in o.name:
            inv = o.matrix_world.inverted()
            if o != body:
                # Move every tuft as a unit so the fur never becomes a long ribbon.
                for i in range(0, len(o.data.vertices), 4):
                    vs = o.data.vertices[i:i+4]
                    c = sum((o.matrix_world@v.co/unit for v in vs), Vector())/len(vs)
                    delta = (sculpt(c.copy())-c)*unit
                    for v in vs:
                        v.co = inv@(o.matrix_world@v.co+delta)
            else:
                for v in o.data.vertices:
                    v.co = inv@(sculpt(o.matrix_world@v.co/unit)*unit)
    pads = material('Natural charcoal paw pads', (.065, .046, .038), .91)
    nails = material('Short wolf keratin claws', (.19, .17, .13), .62)
    horn = material('Warm ivory hoof horn', (.58, .55, .43), .58)
    dew_horn = material('Muted bovine dewclaw keratin', (.40, .36, .28), .68)
    heel = material('Softer hoof heel bulbs', (.40, .34, .25), .85)
    bpy.context.view_layer.update()
    for side, x in [('L', -profile['legX']), ('R', profile['legX'])]:
        for end, y in [('F', profile['frontY']), ('H', profile['backY'])]:
            leg, fy = end+side, foot_y(profile, end+side, y)
            if not carnivore:
                width = .068 if unit < 1 else .078
                parts = [hoof_half('Hoof half', x, fy, s, width, horn, unit) for s in [-1, 1]]
                for s in [-1, 1]:
                    parts.append(ellipsoid('Hoof heel', (x+s*(width+.009), fy+.105, .115),
                                           (width*.83, .073, .098), heel, unit, .014))
                join(parts, 'Natural cloven hoof '+leg, leg, 'hoof', 2)
                parts = [bovine_dewclaw(body, x, y, s, dew_horn, unit) for s in [-1, 1]]
                join(parts, 'Hoof dewclaws '+leg, leg, 'dewclaws', 2)
                continue
            new_parts = []
            paw_coat = coat.copy() if species == 'leopard' else coat
            if species == 'leopard':
                paw_coat.name = 'Native leopard paw coat '+leg
            # Two central digits project slightly further than the outer pair.
            for i, dx in enumerate([-.132, -.045, .045, .132]):
                middle = i in [1, 2]
                ty = fy-(.155 if middle else .124)
                w = (.053 if middle else .049)*(1.06 if species == 'leopard' else 1)
                length = .115 if species == 'wolf' else .104
                new_parts.append(ellipsoid('Paw toe '+str(i+1), (x+dx, ty, .103),
                                           (w, length, .088), paw_coat, unit, .018))
                new_parts.append(ellipsoid('Digital pad '+str(i+1), (x+dx, ty+.003, .025),
                                           (w*.83, length*.73, .019), pads, unit, .012))
                if species == 'wolf':
                    claw = ellipsoid('Short claw '+str(i+1), (x+dx, ty-length+.008, .069),
                                      (.015, .048, .020), nails, unit)
                    new_parts.append(claw)
            toes = join(new_parts, 'Paw toes '+leg, leg, 'toes', 4)
            if species == 'leopard':
                bake_paw_coat(toes, paw_coat)
            main = ellipsoid('Central paw pad '+leg, (x, fy+.023, .030),
                             (.130, .113, .024), pads, unit, .012)
            join([main], 'Paw sole '+leg, leg, 'sole')
            if end == 'F':
                # The fifth digit is raised on the inside, outside the footprint.
                dew_coat = material('Natural golden small paw digit', (.83, .68, .006), .84) if species == 'leopard' else coat
                dew = ellipsoid('Paw dewclaw '+leg, (x+(.115 if side == 'L' else -.115), fy+.055, .24),
                                (.037, .052, .057), dew_coat, unit)
                join([dew], 'Paw dewclaw '+leg, leg, 'dewclaws', 1)
    body['feet_revision'] = 'anatomical-v1'
