"""Compare actual roadside and anime GLBs under identical offline lighting."""
import sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
import generate_anime_tree as tree

tree.clean_scene()
for path,x in [(tree.ROOT/'src/assets/trees/sample-tree-02/sample-tree-02.glb',-3.2),
               (tree.GLB,3.2)]:
    before=set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects=set(bpy.context.scene.objects)-before
    meshes=[obj for obj in objects if obj.type=='MESH']
    bpy.context.view_layer.update()
    points=[obj.matrix_world@Vector(corner) for obj in meshes for corner in obj.bound_box]
    low=min(p.z for p in points);high=max(p.z for p in points)
    factor=5.95/(high-low)
    # Parent only root nodes so the importer hierarchy is scaled once.
    group=bpy.data.objects.new('Colour comparison only',None)
    bpy.context.collection.objects.link(group)
    for obj in objects:
        if obj.parent not in objects:obj.parent=group
    group.scale=(factor,)*3;group.location=(x,0,-low*factor)
camera=tree.setup_render()
bpy.context.scene.render.resolution_x=1600
bpy.context.scene.render.resolution_y=1000
camera.data.ortho_scale=12.5
camera.location=(0,-20,5.5)
camera.rotation_euler=(Vector((0,0,3))-camera.location).to_track_quat('-Z','Y').to_euler()
bpy.context.scene.render.filepath=str(tree.RENDERS/'tree_roadside_color_comparison.png')
bpy.ops.render.render(write_still=True)
print('LEFT_ROADSIDE_REFERENCE_RIGHT_RECOLORED_ANIME_TREE')
