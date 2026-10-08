"""Blender BVH checks for wheel/body intersection under existing steering/lean limits."""
import bpy,math,json
from pathlib import Path
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2];deps=bpy.context.evaluated_depsgraph_get()
def triangles(objects,transforms):
 v=[];f=[]
 for o,transform in zip(objects,transforms):
  e=o.evaluated_get(deps);me=e.to_mesh();me.calc_loop_triangles();base=len(v);v.extend(transform@q.co for q in me.vertices);f.extend(tuple(base+i for i in t.vertices) for t in me.loop_triangles);e.to_mesh_clear()
 return BVHTree.FromPolygons(v,f,all_triangles=True)
body=[o for o in bpy.data.objects if o.type=='MESH' and (o.name in ['Orange continuous body','Orange cabin pillars','Cream rounded roof','Recessed dark chassis'] or o.name.startswith('Orange flared wheel arch'))]
results=[]
for lean in [0,-.0168,.0168]:
 for bounce in [0,-.0072,.0292]:
  matrix=Matrix.Translation((0,0,bounce))@Matrix.Rotation(-lean,4,'Y');bodytree=triangles(body,[matrix@o.matrix_world for o in body])
  for steer in [-.35,0,.35]:
   for pivot in [o for o in bpy.data.objects if o.name.startswith('wheel_')]:
    tyre=[o for o in pivot.children if o.name.startswith('tyre')];angle=steer if '_F' in pivot.name else 0
    for roll in [0,.23,1.1]:
     transforms=[pivot.matrix_world@Matrix.Rotation(angle,4,'Z')@Matrix.Rotation(roll,4,'X')@o.matrix_local for o in tyre]
     overlaps=bodytree.overlap(triangles(tyre,transforms));results.append({'wheel':pivot.name,'steer':angle,'roll':roll,'lean':lean,'bounce':bounce,'intersections':len(overlaps)})
accessories=[o.name for o in bpy.data.objects if any(part in o.name.lower() for part in ['luggage','travel bag','rack','handle sewn','pocket','surfboard','tail fin'])]
assert not accessories, 'Roof accessories remain: '+str(accessories)
report={'roofAccessories':accessories,'cases':len(results),'failures':[r for r in results if r['intersections']],'maximumTriangleIntersections':max(r['intersections'] for r in results),'method':'Evaluated mesh triangle BVH overlap; wheel steering +/- .35, body lean +/- .0168 rad, ride -.0072 to +.0292 m'}
(ROOT/'output/surf-car-09/geometry-audit.json').write_text(json.dumps(report,indent=2));print('GEOMETRY AUDIT',json.dumps(report))
