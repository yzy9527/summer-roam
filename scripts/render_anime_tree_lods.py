"""Visually inspect the actual runtime GLB, without accessing a browser."""
import sys
from pathlib import Path
import bpy
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).resolve().parent))
import generate_anime_tree as tree

tree.clean_scene()
bpy.ops.import_scene.gltf(filepath=str(tree.ROOT/'src/assets/trees/anime-tree/anime-tree.glb'))
for obj in list(bpy.context.scene.objects):
    if obj.type!='MESH':continue
    level=next(level for level in ('near','mid','far') if f'_{level}_' in obj.name)
    obj.location.x+={'near':-5,'mid':0,'far':5}[level]
camera=tree.setup_render()
scene=bpy.context.scene
scene.render.resolution_x=1800;scene.render.resolution_y=850
camera.data.ortho_scale=17.4
camera.location=(0,-20,6)
camera.rotation_euler=(Vector((0,0,3))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(tree.RENDERS/'tree_runtime_lods.png')
bpy.ops.render.render(write_still=True)
print('RUNTIME_LODS_RENDERED_LEFT_TO_RIGHT_NEAR_MID_FAR')
