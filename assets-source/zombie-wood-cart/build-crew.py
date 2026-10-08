"""Enlarge the editable original without overwriting it; Blender background entry."""
import bpy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).resolve().parent
sys.path.insert(0, str(SOURCE))
from farm_cart import upgrade_farm_cart, validate_and_render
bpy.ops.wm.open_mainfile(filepath=str(SOURCE / 'zombie-wood-cart.blend'))
bpy.context.preferences.filepaths.save_version = 0
# Stretch timber and axle spacing, preserving round wheels and their radius.
for obj in bpy.context.scene.objects:
    if obj.parent is None:
        continue
    obj.location.x *= 1.71
    obj.location.y *= 1.84
    if obj.type == 'MESH' and not any(
        obj.name.startswith(prefix) for prefix in ('solid_wheel', 'wheel_hub', 'axle_wood_peg')
    ):
        obj.scale.x *= 1.71
        obj.scale.y *= 1.84
# Leave a real opening beside the giant bench. A fold-out step cannot pass
# through a solid side wall; split the left wall and its rails around this bay.
for name in ('side_panel_-1', 'side_top_rail_-1', 'side_bottom_rail_-1'):
    original = bpy.data.objects[name]
    for index, (lo, hi) in enumerate(((-3.40, -1.36), (.82, 1.36))):
        part = original.copy()
        part.data = original.data.copy()
        bpy.context.collection.objects.link(part)
        part.name = name + '_bay_' + str(index)
        part.location.y = -(lo + hi) / 2
        part.dimensions.y = hi - lo
    bpy.data.objects.remove(original, do_unlink=True)
root = bpy.data.objects['wood_cart']
root['bedWidth'] = 1.55 * 1.71
root['bedLength'] = 2.5 * 1.84
body = bpy.data.objects['cart_body']
material = bpy.data.objects['driver_seat'].data.materials[0]
for name, size, position in [
    # Blender dimensions are X, depth, height; the old .80 height made a wall.
    # Front edge stays behind the bending thighs; top .83 supports their skin.
    ('giant_bench', (2.3, .58, .13), (0, .47, .765)),
    ('giant_bench_leg_L', (.14, .44, .149), (-.9, .47, .6255)),
    ('giant_bench_leg_R', (.14, .44, .149), (.9, .47, .6255)),
]:
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    obj.parent = body
socket = bpy.data.objects.new('giant_socket', None)
bpy.context.collection.objects.link(socket)
socket.parent = root
socket.location = (0, .30, 1.08)
bpy.context.view_layer.update()
upgrade_farm_cart(root, body, SOURCE)
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'zombie-crew-cart.blend'))
bpy.ops.object.select_all(action='SELECT')
path = ROOT / 'src/assets/models/zombie-crew-cart.glb'
bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                          export_extras=True, export_yup=True, export_animations=False)
out = ROOT / 'output/zombie-calf-heist'
out.mkdir(parents=True, exist_ok=True)
(out / 'cart-model.json').write_text(json.dumps({
    'path': str(path.relative_to(ROOT)), 'bedWidth': root['bedWidth'],
    'bedLength': root['bedLength'], 'originalPreserved': True,
    'wheelRadius': .46,
    'design': 'open-cockpit-farm-cart',
}, indent=2))
validate_and_render(path, ROOT / 'output/zombie-farm-cart')
