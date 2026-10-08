"""Create three runtime LODs from the approved tree without editing its source.

Blender --background --python scripts/export_anime_tree_forest.py
"""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'blender/anime_tree.blend'
OUTPUT=ROOT/'src/assets/trees/anime-tree/anime-tree.glb'
EDITABLE=ROOT/'assets-source/trees/anime-tree/anime-tree-lod.blend'
REPORT=ROOT/'assets-source/trees/anime-tree/stats.json'
for path in (OUTPUT,EDITABLE,REPORT):path.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
bpy.context.preferences.filepaths.save_version=0
wood=bpy.data.objects['Tree trunk branches and concealed crown supports']
leaves=bpy.data.objects['Six major crowns with overlapping volumetric leaf puffs']
assert len(leaves.data.vertices)==19072*8
pigments=leaves.data.color_attributes['CrownColor']
source_normals={loop.vertex_index:leaves.data.corner_normals[i].vector.copy()
                for i,loop in enumerate(leaves.data.loops)}
runtime=[];stats={}

def leaf_lod(level,stride):
    vertices=[];faces=[];colors=[];normals=[]
    # Dither selection within each stratum, keeping leaves distributed across
    # all large masses. Broaden retained curved leaves to preserve crown cover.
    selected=[i for i in range(0,19072,stride)]
    scale=1 if stride==1 else math.sqrt(stride)*.95
    for leaf in selected:
        first=leaf*8
        centre=leaves.data.vertices[first].co
        offset=len(vertices)
        for i in range(first,first+8):
            vertices.append(tuple(centre+(leaves.data.vertices[i].co-centre)*scale))
            colors.append(tuple(pigments.data[i].color))
            normals.append(tuple(source_normals[i]))
        for polygon in leaves.data.polygons[leaf*7:leaf*7+7]:
            faces.append(tuple(offset+i-first for i in polygon.vertices))
    mesh=bpy.data.meshes.new(f'Anime_{level}_leaf')
    mesh.from_pydata(vertices,[],faces);mesh.update()
    # All six foliage slots share PBR parameters. Keep pigment in COLOR_0 and
    # merge identical slots into one primitive for one instanced foliage draw.
    mesh.materials.append(leaves.data.materials[0])
    for polygon in mesh.polygons:polygon.use_smooth=True
    attr=mesh.color_attributes.new(name='CrownColor',type='FLOAT_COLOR',domain='POINT')
    attr.data.foreach_set('color',[c for rgba in colors for c in rgba])
    mesh.normals_split_custom_set_from_vertices(normals)
    obj=bpy.data.objects.new(mesh.name,mesh);bpy.context.collection.objects.link(obj)
    obj['role']='foliage';obj['lod']=level;obj['sourceLeafStride']=stride
    obj['sourceAsset']='anime_tree.blend'
    return obj

for level,stride,wood_ratio in [('near',1,1),('mid',4,.5),('far',24,.2)]:
    branch=wood.copy();branch.data=wood.data.copy();branch.name=f'Anime_{level}_wood'
    branch.parent=None;branch.matrix_world=wood.matrix_world.copy()
    bpy.context.collection.objects.link(branch)
    if wood_ratio<1:
        bpy.context.view_layer.objects.active=branch
        modifier=branch.modifiers.new('Runtime branch reduction','DECIMATE')
        modifier.ratio=wood_ratio
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    leaf=leaf_lod(level,stride)
    runtime.extend([branch,leaf])
    stats[level]={'triangles':sum(len(p.vertices)-2 for obj in (branch,leaf) for p in obj.data.polygons),
                  'leaves':len(leaf.data.vertices)//8,'meshObjects':2,
                  'opaqueLeaves':True,'embeddedBark':True}
assert stats['near']['triangles']==139996
assert stats['near']['triangles']>stats['mid']['triangles']>stats['far']['triangles']
assert stats['far']['triangles']<9000
for obj in list(bpy.context.scene.objects):
    if obj not in runtime:bpy.data.objects.remove(obj,do_unlink=True)
for material in list(bpy.data.materials):
    if material.users==0:bpy.data.materials.remove(material)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.wm.save_as_mainfile(filepath=str(EDITABLE))
bpy.ops.export_scene.gltf(filepath=str(OUTPUT),export_format='GLB',use_selection=True,
    export_yup=True,export_extras=True,export_cameras=False,export_lights=False)
REPORT.write_text(json.dumps({'source':'blender/anime_tree.blend','variant':'Anime',
    'lodDistancesMetres':[28,85],'levels':stats,'origin':[0,0,0],
    'preservedNearGeometry':True,'sourceUnmodified':True},indent=2))
print('ANIME_FOREST_LODS_READY',json.dumps(stats))
