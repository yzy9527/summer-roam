"""Editable, deterministic rounded stream pebbles. Run with Blender --background --python."""
from pathlib import Path
import math
import bpy

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
palette = [(0.62, 0.58, 0.47), (0.49, 0.53, 0.47), (0.72, 0.68, 0.57), (0.48, 0.46, 0.39)]
for i, color in enumerate(palette):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10)
    rock = bpy.context.object
    rock.name = f'Water_pebble_{i}'
    for v in rock.data.vertices:
        p = v.co
        warp = 1 + .07 * math.sin(p.x * 4 + p.y * 3 + i) * math.cos(p.z * 3 - i)
        p.x *= (.95 + i * .07) * warp
        p.y *= (.76 + i * .05) * warp
        p.z = p.z * (.46 + .025 * i) * warp + .30
    for face in rock.data.polygons:
        face.use_smooth = True
    mat = bpy.data.materials.new(f'Warm river stone {i}')
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = .93
    rock.data.materials.append(mat)
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / 'water-pebbles.blend'))
destination = ROOT / 'src/assets/models/water-pebbles.glb'
destination.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB', export_yup=True)
