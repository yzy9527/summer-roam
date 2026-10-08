"""Preserve the imported face; add a closed, walkable rock mountain. Run surface.mjs first."""
import bpy, json
from pathlib import Path
from mathutils import Vector, Matrix

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(HERE / 'six_hokage_mountain.glb'))
objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
worlds = {o: o.matrix_world.copy() for o in objects}
points = [worlds[o] @ Vector(c) for o in objects for c in o.bound_box]
low = Vector([min(p[i] for p in points) for i in range(3)])
high = Vector([max(p[i] for p in points) for i in range(3)])
scale = 26 / (high.x - low.x)
for o in objects:
    matrix = worlds[o]
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
    for vertex in o.data.vertices:
        p = matrix @ vertex.co
        vertex.co = ((p.x - (low.x + high.x) / 2) * scale, (p.y - high.y) * scale + 6, (p.z - low.z) * scale)
    o.data.update()
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
# Discard microscopic imported planar debris, not the rock/sculpture surfaces.
meaningful = []
for o in objects:
    size = [max(v.co[i] for v in o.data.vertices) - min(v.co[i] for v in o.data.vertices) for i in range(3)]
    if max(size) < .2: bpy.data.objects.remove(o, do_unlink=True)
    else: meaningful.append(o)
objects = meaningful
floor = min(v.co.z for o in objects for v in o.data.vertices)
for o in objects:
    for v in o.data.vertices: v.co.z -= floor
    o.data.update()
# Group by actual material. Flat ornament pieces retain their authored geometry.
groups = {}
for o in objects:
    key = o.data.materials[0].name if o.data.materials else 'unpainted'
    groups.setdefault(key, []).append(o)
area = {}
for key, members in groups.items():
    area[key] = sum(p.area for o in members for p in o.data.polygons)
rock_key = max(area, key=area.get)
rock = groups[rock_key][0].data.materials[0].copy()
rock.name = 'Mountain matching rock'
for key, members in groups.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in members: o.select_set(True)
    bpy.context.view_layer.objects.active = members[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = 'Hokage cliff ' + key
    if len(o.data.polygons) > 18000:
        mod = o.modifiers.new('Conservative rock simplification', 'DECIMATE')
        mod.ratio = .75
        bpy.ops.object.modifier_apply(modifier=mod.name)

data = json.loads((HERE / 'surface.json').read_text())
g, nx, nz = data['grid'], data['columns'], data['rows']
verts = [(g['minX'] + (i % nx) * g['step'], -(g['minZ'] + (i // nx) * g['step']), h) for i, h in enumerate(data['heights'])]
faces = []
for row in range(nz - 1):
    for col in range(nx - 1):
        i = row * nx + col
        faces.extend([(i, i + nx, i + 1), (i + 1, i + nx, i + nx + 1)])
# Seal the perimeter and underside, overlapping the retained original cliff.
ring = list(range(nx)) + [r * nx + nx - 1 for r in range(1, nz)] + list(range(nx * nz - 2, (nz - 1) * nx - 1, -1)) + [r * nx for r in range(nz - 2, 0, -1)]
bottom = len(verts)
verts.extend([(verts[i][0], verts[i][1], -.12) for i in ring])
for j, i in enumerate(ring):
    k = (j + 1) % len(ring)
    faces.append((i, bottom + j, bottom + k, ring[k]))
faces.append(tuple(reversed(range(bottom, len(verts)))))
mesh = bpy.data.meshes.new('Shared sampled mountain surface')
mesh.from_pydata(verts, [], faces); mesh.update()
body = bpy.data.objects.new('Completed sides back summit and trail', mesh)
bpy.context.collection.objects.link(body); mesh.materials.append(rock)
uv = mesh.uv_layers.new(name='RockUV')
for polygon in mesh.polygons:
    for index in polygon.loop_indices:
        v = mesh.vertices[mesh.loops[index].vertex_index].co
        normal = polygon.normal
        if abs(normal.z) > .6: coord = (v.x, v.y)
        elif abs(normal.x) > abs(normal.y): coord = (v.y, v.z)
        else: coord = (v.x, v.z)
        uv.data[index].uv = (coord[0] / 4.5, coord[1] / 4.5)
# Flat, planted road is encoded in the same mesh as the rock, not a floating ribbon.
for material in bpy.data.materials:
    if material.use_nodes:
        for node in material.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                node.inputs['Metallic'].default_value = 0
                node.inputs['Roughness'].default_value = .95
                node.inputs['Specular IOR Level'].default_value = .12
    material.use_backface_culling = False
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / 'hokage-mountain-complete.blend'))
target = ROOT / 'src/assets/models/hokage-mountain.glb'
bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', export_yup=True, export_cameras=False, export_lights=False)
stats = {'source': 'six_hokage_mountain.glb', 'rockMaterial': rock_key, 'sourceObjects': 558, 'retainedSourceObjects': len(objects), 'exportObjects': len([o for o in bpy.context.scene.objects if o.type == 'MESH']), 'triangles': sum(len(o.data.loop_triangles) for o in bpy.context.scene.objects if o.type == 'MESH'), 'bytes': target.stat().st_size}
(HERE / 'stats.json').write_text(json.dumps(stats, indent=2))
print('MOUNTAIN_EXPORT', stats)
