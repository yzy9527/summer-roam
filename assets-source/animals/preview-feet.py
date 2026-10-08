"""Render preserved-source comparisons and current rig previews without saving scenes."""
import bpy
import bmesh
import json
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'output/animal-feet'
OUT.mkdir(parents=True, exist_ok=True)
profiles = json.loads((ROOT/'assets-source/animals/rig-profiles.json').read_text())
profiles['golden-cow'] = {'unit': 1, 'legX': .46, 'frontY': -.56}
args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
selected = [arg for arg in args if not arg.startswith('--')]


def lighting(target, size, full=False, rear=False):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 720
    scene.render.resolution_y = 620 if full else 540
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world = bpy.data.worlds.new('Foot review studio')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.33, .38, .42, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .65
    camera = bpy.data.cameras.new('Foot review camera')
    obj = bpy.data.objects.new('Foot review camera', camera)
    scene.collection.objects.link(obj)
    obj.location = target + Vector((size*1.7, size*(2.5 if rear else -2.5), size*1.5))
    obj.rotation_euler = (target-obj.location).to_track_quat('-Z', 'Y').to_euler()
    camera.type, camera.ortho_scale = 'ORTHO', size
    scene.camera = obj
    for name, offset, energy in [('Key', (-2, -3, 4), 500), ('Rim', (2, 1, 3), 380)]:
        lamp = bpy.data.lights.new(name, 'AREA')
        lamp.energy, lamp.shape, lamp.size = energy, 'DISK', 4
        obj = bpy.data.objects.new(name, lamp)
        scene.collection.objects.link(obj)
        obj.location = target+Vector(offset)
        obj.rotation_euler = (target-obj.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    floor = bpy.context.object
    m = bpy.data.materials.new('Review warm gray floor')
    m.diffuse_color = (.24, .27, .28, 1)
    floor.data.materials.append(m)


for animal, profile in profiles.items():
    if selected and animal not in selected:
        continue
    unit = profile['unit']
    fy = -.83 if animal in ['reference-wolf', 'baola-leopard'] else profile['frontY']-.025
    x = -profile['legX']
    stages = [] if '--full-only' in args else ['after'] if '--after-only' in args else ['before', 'after']
    for stage in stages:
        suffix = '' if stage == 'before' else '-rigged'
        bpy.ops.wm.open_mainfile(filepath=str(ROOT/f'assets-source/{animal}/{animal}{suffix}.blend'))
        for o in list(bpy.context.scene.objects):
            if o.type != 'MESH':
                o.hide_render = True
                continue
            bm = bmesh.new()
            bm.from_mesh(o.data)
            outside = []
            for v in bm.verts:
                p = o.matrix_world@v.co/unit
                if not (abs(p.x-x) < .25 and abs(p.y-fy) < .41 and -.05 < p.z < .52):
                    outside.append(v)
            bmesh.ops.delete(bm, geom=outside, context='VERTS')
            if not bm.faces:
                o.hide_render = True
            else:
                # Shape keys belong to the face; only cropped leg meshes remain.
                bm.to_mesh(o.data)
                o.data.update()
            bm.free()
        rear = '--rear' in args
        lighting(Vector((x, fy-.045, .20))*unit, .74*unit, rear=rear)
        suffix = '-rear' if rear else ''
        bpy.context.scene.render.filepath = str(OUT/f'{animal}-foot-{stage}{suffix}.png')
        bpy.ops.render.render(write_still=True)
    if '--feet-only' in args:
        continue
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/f'assets-source/{animal}/{animal}-rigged.blend'))
    for o in bpy.context.scene.objects:
        if o.type != 'MESH':
            o.hide_render = True
    lighting(Vector((0, .1, 1.20))*unit, 3.8*unit, full=True)
    bpy.context.scene.render.filepath = str(OUT/f'{animal}-full.png')
    bpy.ops.render.render(write_still=True)
