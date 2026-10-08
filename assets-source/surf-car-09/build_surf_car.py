"""09 orange surf hatch. Blender-native geometry; no reference projection.
Blender X right, -Y forward, Z up; glTF +Z forward, Y up. Wheels rotate X.
Run with -- --stage base or --stage final. Only this vehicle is rebuilt.
"""
import bpy, math, json, sys, argparse
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
SRC=Path(__file__).resolve().parent
OUT=ROOT/'output/surf-car-09'
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
p=argparse.ArgumentParser();p.add_argument('--stage',default='final');p.add_argument('--render',action='store_true');a=p.parse_args(args)
FINAL=a.stage=='final';R=.35
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def xyz(x,y,z):return (x,-z,y)
def mat(name,color,rough,metal=0,alpha=1):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,alpha)
 q=m.node_tree.nodes.get('Principled BSDF');q.inputs['Base Color'].default_value=(*color,alpha);q.inputs['Roughness'].default_value=rough;q.inputs['Metallic'].default_value=metal;q.inputs['Alpha'].default_value=alpha
 if alpha<1:m.surface_render_method='DITHERED';m.use_backface_culling=True
 return m
paint=mat('09 orange enamel / broad soft highlight',(1.0,.205,.025),.33,.06)
cream=mat('Warm cream enamel',(.89,.79,.57),.38,.02)
black=mat('Thin charcoal window seals',(.022,.030,.035),.67)
rubber=mat('Matte graphite tyres',(.026,.029,.030),.88)
glass=mat('Blue grey glass',(.16,.29,.34),.18,.12,.68)
metal=mat('Satin silver small fittings',(.52,.57,.58),.28,.72)
seat=mat('Blue charcoal upholstery',(.09,.16,.19),.87)
light=mat('Headlight glass',(.64,.72,.73),.20,.2)
amber=mat('Amber indicators',(.95,.45,.035),.28,.04)
red=mat('Red rear lenses',(.55,.035,.025),.25,.04)
strap=mat('Caramel webbing straps',(.59,.24,.06),.72)
def mesh(name,v,f,m,smooth=True):
 me=bpy.data.meshes.new(name);me.from_pydata([xyz(*q) for q in v],[],f);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);o.data.materials.append(m)
 for q in me.polygons:q.use_smooth=smooth
 return o
def bevel(o,width=.025,segments=4):
 mod=o.modifiers.new('Soft manufactured edge','BEVEL');mod.width=width;mod.segments=segments
 bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o
def box(name,loc,size,m,b=.02):
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(*loc));o=bpy.context.object;o.name=name;o.scale=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 if b:bevel(o,b)
 for q in o.data.polygons:q.use_smooth=True
 mod=o.modifiers.new('Weighted face normals','WEIGHTED_NORMAL');mod.keep_sharp=True
 return o
def tube(name,points,r,m,closed=False):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=16;cu.bevel_depth=r;cu.bevel_resolution=4
 sp=cu.splines.new('POLY');sp.points.add(len(points)-1)
 for q,co in zip(sp.points,points):q.co=(*xyz(*co),1)
 sp.use_cyclic_u=closed;o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);o.data.materials.append(m);return o
def loft(name,rings,m,n=128,power=.35):
 # Dense section sampling prevents large boolean shading facets around arches.
 def cr(j,k,t):
  p0=rings[max(0,j-1)][k];p1=rings[j][k];p2=rings[j+1][k];p3=rings[min(len(rings)-1,j+2)][k]
  return .5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)
 rings=[tuple(cr(j,k,t/6) for k in range(4)) for j in range(len(rings)-1) for t in range(6)]+[rings[-1]]
 v=[]
 for y,w,l,zc in rings:
  for i in range(n):
   t=math.tau*i/n;c=math.cos(t);s=math.sin(t);v.append((w/2*math.copysign(abs(c)**power,c),y,zc+l/2*math.copysign(abs(s)**power,s)))
 f=[]
 for j in range(len(rings)-1):
  for i in range(n):f.append((j*n+i,(j+1)*n+i,(j+1)*n+(i+1)%n,j*n+(i+1)%n))
 f+=[tuple(range(n)),tuple(reversed([(len(rings)-1)*n+i for i in range(n)]))]
 return mesh(name,v,f,m)
def cut(o,c):
 bpy.ops.object.select_all(action='DESELECT');c.select_set(True);bpy.context.view_layer.objects.active=c;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');c.select_set(False)
 mod=o.modifiers.new('Actual open aperture','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=c;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(c,do_unlink=True)
def cylinder(name,loc,r,depth,m,axis='X'):
 bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=r,depth=depth,location=xyz(*loc));o=bpy.context.object;o.name=name;o.data.materials.append(m)
 o.rotation_euler[1 if axis=='X' else 0]=math.pi/2
 bevel(o,.035 if m==rubber else min(.016,r*.12));
 for q in o.data.polygons:q.use_smooth=True
 return o
# Continuous rounded lower body, not an assembly of rectangular blocks.
body_profile=[(.23,1.37,3.02,0),(.30,1.54,3.30,0),(.43,1.64,3.49,0),(.68,1.66,3.50,0),(.87,1.61,3.42,-.015),(1.00,1.53,3.18,-.05),(1.055,1.42,2.90,-.10)]
body=loft('Orange continuous body',body_profile,paint,power=.22)
def body_section(y):
 samples=[]
 for j in range(len(body_profile)-1):
  p0=body_profile[max(0,j-1)];p1=body_profile[j];p2=body_profile[j+1];p3=body_profile[min(len(body_profile)-1,j+2)]
  for i in range(7):
   t=i/6;samples.append(tuple(.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t*t+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t*t*t) for k in range(4)))
 for lo,hi in zip(samples,samples[1:]):
  if lo[0]<=y<=hi[0] and hi[0]>lo[0]:
   t=(y-lo[0])/(hi[0]-lo[0]);return [lo[k]*(1-t)+hi[k]*t for k in [1,2,3]]
 return body_profile[-1][1:]
def body_z(x,y,front=True):
 w,l,c=body_section(y);return c+l/2*max(0,1-abs(x/(w/2))**(2/.22))**(.22/2)*(1 if front else -1)
def body_x(y,z):
 w,l,c=body_section(y);return w/2*max(0,1-abs((z-c)/(l/2))**(2/.22))**(.22/2)
def body_top(x,z):
 lo=.87;hi=1.055
 for _ in range(20):
  y=(lo+hi)/2;w,l,c=body_section(y)
  if abs(x/(w/2))**(2/.22)+abs((z-c)/(l/2))**(2/.22)<=1:lo=y
  else:hi=y
 return lo+.005
# Smooth reference shell supplies stable normals after aperture booleans.
normal_source=body.copy();normal_source.data=body.data.copy();bpy.context.collection.objects.link(normal_source)
for z in [1.13,-1.11]:
 c=cylinder('Arch cutter',(0,R,z),.415,2.5,black);cut(body,c)
bevel(body,.012,3)
mod=body.modifiers.new('Preserve continuous body normals','DATA_TRANSFER');mod.object=normal_source;mod.use_loop_data=True;mod.data_types_loops={'CUSTOM_NORMAL'};mod.loop_mapping='POLYINTERP_NEAREST';bpy.context.view_layer.objects.active=body;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(normal_source,do_unlink=True)
# Hollow cabin envelope, with genuine window openings.
cabin=loft('Orange cabin pillars',[(1.00,1.54,2.46,-.42),(1.08,1.55,2.35,-.45),(1.30,1.47,2.15,-.53),(1.52,1.34,1.90,-.60),(1.60,1.28,1.75,-.61)],paint)
cavity=loft('Cabin hollow',[(.94,1.35,2.10,-.45),(1.09,1.38,2.08,-.48),(1.30,1.31,1.90,-.54),(1.53,1.18,1.66,-.60),(1.58,1.10,1.51,-.61)],black);cut(cabin,cavity)
# Rounded polygons are sampled quadratics at corners, keeping panes inset.
def rounded(poly,r=.12):
 pts=[]
 for i,b in enumerate(poly):
  pre=Vector(poly[i-1]);cur=Vector(b);nxt=Vector(poly[(i+1)%len(poly)]);p=cur+(pre-cur)*r;q=cur+(nxt-cur)*r
  for k in range(9):
   t=k/8;pts.append(tuple((1-t)**2*p+2*t*(1-t)*cur+t*t*q))
 return pts
def cabin_section(y):
 rings=[(1.00,1.54,2.46,-.42),(1.08,1.55,2.35,-.45),(1.30,1.47,2.15,-.53),(1.52,1.34,1.90,-.60),(1.60,1.28,1.75,-.61)]
 for i in range(len(rings)-1):
  lo,hi=rings[i],rings[i+1]
  if lo[0]<=y<=hi[0]:
   t=(y-lo[0])/(hi[0]-lo[0]);return [lo[k]*(1-t)+hi[k]*t for k in [1,2,3]]
 return rings[0][1:]
def side_x(y,z):
 w,l,c=cabin_section(y);return w/2*max(0,1-abs((z-c)/(l/2))**(2/.35))**(.35/2)+.003
def window_surface(name,boundary,project,m=None):
 # Concentric tessellation follows the curved cabin surface instead of floating flat panes.
 center=sum((Vector(q) for q in boundary),Vector((0,0)))/len(boundary);v=[project(*center)];n=len(boundary)
 for j in range(1,7):
  for q in boundary:v.append(project(*(center+(Vector(q)-center)*(j/6))))
 f=[(0,1+i,1+(i+1)%n) for i in range(n)]
 for j in range(5):
  for i in range(n):f.append((1+j*n+i,1+(j+1)*n+i,1+(j+1)*n+(i+1)%n,1+j*n+(i+1)%n))
 return mesh(name,v,f,m or glass)
# Side x is the sloping cabin surface. Polygon input is (height, longitudinal z).
for s in [-1,1]:
 for label,poly in [('door',[(1.095,.59),(1.52,.18),(1.535,-.49),(1.09,-.53)]),('quarter',[(1.09,-.64),(1.535,-.61),(1.50,-1.24),(1.105,-1.44)])]:
  pts=rounded(poly,.16);n=len(pts);v=[(x,y,z) for x in [-1.1,1.1] for y,z in pts];f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
  cutter=mesh('Side aperture',v,f,black);# Only cut corresponding side, avoiding opposite pane overlap.
  # cutter spans both sides; repeated side cuts are harmless.
  cut(cabin,cutter)
  surf=[(s*side_x(y,z),y,z) for y,z in pts]
  # Side glass faces outward (double sided export disabled for seals, enabled glass).
  pane=window_surface('Glass '+label+(' L' if s<0 else ' R'),pts,lambda y,z:(s*side_x(y,z),y,z))
  tube('Fine black '+label+' window seal',surf,.013,black,True)
# Front / rear surfaces on slanted planes, rounded corners.
for label,poly in [('windscreen',[(-.64,1.09),(.64,1.09),(.55,1.535),(-.55,1.535)]),('rear window',[(.64,1.10),(-.64,1.10),(-.53,1.525),(.53,1.525)])]:
 pts=rounded(poly,.16);n=len(pts);front=label=='windscreen'
 def zp(x,y):
  w,l,c=cabin_section(y);d=l/2*max(0,1-abs(x/(w/2))**(2/.35))**(.35/2);return c+(d+.003)*(1 if front else -1)
 surf=[(x,y,zp(x,y)) for x,y in pts]
 v=[(x,y,zp(x,y)+dz) for dz in [-.25,.25] for x,y in pts];f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 cut(cabin,mesh('Front rear window opening',v,f,black))
 window_surface('Glass '+label,pts,lambda x,y:(x,y,zp(x,y)));tube('Fine black '+label+' seal',surf,.014,black,True)
roof=loft('Cream rounded roof',[(1.55,1.31,1.86,-.61),(1.60,1.37,1.94,-.61),(1.67,1.25,1.83,-.62),(1.70,1.03,1.60,-.62),(1.706,.70,1.14,-.62)],cream)
# Cream windshield brow wraps just above the front glass.
for s in [-1,1]:
 points=[]
 for i in range(25):
  t=i/24;y=1.065+.495*t;x=s*(.67-.12*t);w,l,c=cabin_section(y);z=c+l/2*max(0,1-abs(x/(w/2))**(2/.35))**(.35/2)+.008;points.append((x,y,z))
 tube('Cream A pillar',points,.026,cream)
# Four independent wheel roots at exact axle centres.
for s,side in [(-1,'L'),(1,'R')]:
 for z,end in [(1.13,'F'),(-1.11,'B')]:
  pivot=bpy.data.objects.new('wheel_'+end+side,None);bpy.context.collection.objects.link(pivot);pivot.location=xyz(s*.77,R,z);pivot['radius']=R
  for label,r,d,m in [('tyre',R,.225,rubber),('cream rim',.267,.231,cream),('rim recess',.219,.237,cream),('silver hub',.106,.25,metal)]:
   o=cylinder(label,(0,0,0),r,d,m);o.parent=pivot;o.location=(0,0,0)
  if FINAL:
   for offset in [-.062,-.024,.024,.062]:
    # Fine circumferential tread grooves, modest geometry, no noisy checker pattern.
    bpy.ops.mesh.primitive_torus_add(major_radius=R-.005,minor_radius=.0035,major_segments=80,minor_segments=6,location=(0,0,0),rotation=(0,math.pi/2,0));o=bpy.context.object;o.name='Tyre circumferential groove';o.data.materials.append(black);o.parent=pivot;o.location=(offset,0,0)
box('Recessed dark chassis',(0,.27,0),(1.07,.15,2.92),black,.05)
if FINAL:
 # Rounded orange arch lips blend the aperture back into the body surface.
 for side in [-1,1]:
  for axle in [1.13,-1.11]:
   v=[]
   for i in range(65):
    t=math.pi*i/64
    for j,radius in enumerate([.415,.432,.457,.478]):
     y=R+math.sin(t)*radius;z=axle+math.cos(t)*radius
     # Four-point rolled cross-section produces a broad, soft fender highlight.
     x=side*(body_x(y,z)+.004+.026*math.sin(math.pi*j/3)*(.6+.4*math.sin(t)))
     v.append((x,y,z))
   lip=mesh('Orange flared wheel arch',v,[(4*i+j,4*i+j+1,4*(i+1)+j+1,4*(i+1)+j) for i in range(64) for j in range(3)],paint)
   mod=lip.modifiers.new('Arch return edge','SOLIDIFY');mod.thickness=.009
 # Curved inset lamp surfaces follow the actual body, including outer fenders.
 def round_lamp(name,cx,cy,front=True,head=True):
  radii=[0,.026,.095,.141,.155,.170] if head else [0,.044,.053,.061]
  mats=[light,metal,light,metal,black] if head else [amber,amber,black]
  v=[(cx,cy,body_z(cx,cy,front)+(.010 if front else -.010))];n=80
  for j,r in enumerate(radii[1:]):
   for i in range(n):
    t=math.tau*i/n;x=cx+r*math.cos(t);y=cy+r*math.sin(t);offset=[.027,.020,.014,.024,.005][j] if head else [.018,.015,.004][j]
    v.append((x,y,body_z(x,y,front)+offset*(1 if front else -1)))
  f=[(0,1+i,1+(i+1)%n) for i in range(n)];slots=[0]*n
  for j in range(len(radii)-2):
   for i in range(n):f.append((1+j*n+i,1+(j+1)*n+i,1+(j+1)*n+(i+1)%n,1+j*n+(i+1)%n));slots.append(j+1)
  o=mesh(name,v,f,mats[0])
  for m in mats[1:]:o.data.materials.append(m)
  for poly,slot in zip(o.data.polygons,slots):poly.material_index=slot
  return o
 for side in [-1,1]:
  round_lamp('Recessed round headlight',side*.585,.855)
  round_lamp('Small round amber front indicator',side*.635,.51,head=False)
  cylinder('Side indicator',(side*(body_x(.93,.93)+.006),.93,.93),.034,.019,amber)
  # Rounded rear lenses lie on the rear corner rather than protruding box housings.
  x=side*.66
  for name,width,height,cy,offset,m in [('Rear lamp dark seal',.166,.415,.735,.006,black),('Rear lamp cream surround',.145,.390,.735,.012,cream),('Rear red lens',.115,.232,.800,.019,red),('Rear amber lens',.115,.113,.607,.019,amber)]:
   poly=rounded([(x-width/2,cy-height/2),(x+width/2,cy-height/2),(x+width/2,cy+height/2),(x-width/2,cy+height/2)],.24)
   window_surface(name,poly,lambda x,y:(x,y,body_z(x,y,False)-offset),m)
 box('Narrow black lower grille',(0,.42,1.734),(.85,.105,.055),black,.045)
 for y in [.396,.433]:box('Dark inset grille bar',(0,y,1.767),(.76,.012,.009),rubber,.004)
 for z in [1.748,-1.736]:box('Cream bumper',(0,.305,z),(1.64,.145,.15),cream,.068)
 cylinder('Small nose badge',(0,.70,1.744),.052,.017,metal,'Z');cylinder('Badge dark centre',(0,.70,1.759),.038,.008,glass,'Z')
 # Door seams follow the side surface and terminate above the sill.
 for s in [-1,1]:
  seam=rounded([(1.048,.62),(.94,.58),(.34,.56),(.302,.45),(.302,-.40),(.37,-.54),(1.048,-.55)],.12)
  tube('Three door seam',[(s*(body_x(y,z)+.003),y,z) for y,z in seam],.003,black)
  tube('Orange sill soft lip',[(s*.78,.278,-.69),(s*.793,.27,.68)],.023,paint)
  box('Cream door handle',(s*.831,.99,-.40),(.044,.045,.139),cream,.02)
  tube('Mirror short stem',[(s*side_x(1.075,.53),1.075,.53),(s*.91,1.13,.58)],.025,black)
  box('Cream mirror shell',(s*.938,1.18,.60),(.16,.13,.20),cream,.06)
  box('Mirror glass',(s*.94,1.18,.50),(.125,.097,.012),glass,.04)
  cylinder('Fuel cap seam',(s*.811,.91,-1.18),.083,.009,black)
  cylinder('Orange fuel cap',(s*.819,.91,-1.18),.076,.01,paint)
 # Hood and rear hatch understated seams.
 hood=rounded([(-.60,.77),(-.63,1.27),(-.48,1.51),(.48,1.51),(.63,1.27),(.60,.77)],.15)
 tube('Hood seam',[(x,body_top(x,z),z) for x,z in hood],.003,black)
 hatch=rounded([(-.59,1.03),(-.59,.42),(-.48,.39),(.48,.39),(.59,.42),(.59,1.03)],.15)
 tube('Rear hatch seam',[(x,y,body_z(x,y,False)-.004) for x,y in hatch],.003,black)
 box('Rear orange plate recess',(0,.67,-1.751),(.58,.24,.02),strap,.045);box('Plain orange plate',(0,.67,-1.765),(.54,.20,.016),paint,.035)
 box('Rear hatch handle',(0,.94,-1.71),(.15,.036,.027),metal,.015)
 for s in [-1,1]:tube('Front wiper',[(s*.50,1.096,.747),(s*.16,1.112,.726)],.012,black)
 tube('Rear wiper',[(.39,1.142,-1.61),(.12,1.161,-1.607),(-.13,1.16,-1.60)],.012,black)
 # Interior visible through blue grey panes; modest shapes, no driver character.
 for s in [-1,1]:
  box('Front seat cushion',(s*.36,.60,-.10),(.49,.14,.52),seat,.065)
  back=box('Front seat back',(s*.36,.88,-.32),(.48,.49,.13),seat,.065);back.rotation_euler[0]=-.10
  box('Front headrest',(s*.36,1.185,-.35),(.29,.20,.11),seat,.045)
 box('Rear bench',(0,.64,-1.02),(1.12,.15,.42),seat,.06);box('Rear backrest',(0,.91,-1.27),(1.1,.41,.10),seat,.05)
 box('Dashboard',(0,1.0,.44),(1.28,.15,.29),seat,.06)
 bpy.ops.mesh.primitive_torus_add(major_radius=.132,minor_radius=.014,major_segments=48,minor_segments=10,location=xyz(-.35,1.01,.20),rotation=(math.pi/2-.3,0,0));bpy.context.object.name='Steering wheel';bpy.context.object.data.materials.append(black)
# Standard export. Wheel roots remain top-level and unrotated.
for o in bpy.context.scene.objects:
 if o.type=='MESH' and o!=body:
  # Normalize polygon normals, including pane winding.
  bpy.context.view_layer.objects.active=o;o.select_set(True)
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');o.select_set(False)
# Glass is double-sided so internal view also works.
glass.use_backface_culling=False
bpy.context.scene['vehicle']='09 orange three-door travel hatch';bpy.context.scene['wheel_radius']=R
SRC.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
blend=SRC/('surf-car-09.blend' if FINAL else 'surf-car-09-base.blend')
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
glb=ROOT/'src/assets/models'/('surf-car-09.glb' if FINAL else 'surf-car-09-base.glb')
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False,export_extras=True)
# Preserve the runtime scaling and driving configuration when rebuilding accessories.

# Runtime directory contains the sole GLB export; editable .blend files stay here.
report={'stage':a.stage,'wheelRadius':R,'wheelbase':2.24,'bodyLength':3.50,'bodyWidth':1.66,'bodyRoofHeight':1.706,'roofAccessories':[],'coordinates':'Blender X/-Y/Z => glTF X/Z/Y; wheel axis X','textures':[],'materials':[{ 'name':m.name,'roughness':m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value,'metallic':m.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value} for m in bpy.data.materials if m.use_nodes and m.node_tree.nodes.get('Principled BSDF')]}
(OUT/f'{a.stage}-asset.json').write_text(json.dumps(report,indent=2))
if a.render:
 # Render-only studio; excluded from saved editable model and GLB.
 floor=mat('Studio warm grey',(.53,.51,.46),.9);box('Render studio floor',(0,-.035,0),(200,.05,200),floor,.0)
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True;scene.render.resolution_x=1000;scene.render.resolution_y=760;scene.render.resolution_percentage=100
 scene.world.color=(.30,.30,.30)
 for loc,power,size in [((-3,-4,7),700,5),((4,1,5),450,4),((0,5,6),550,3)]:
  bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,.8))-o.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.object.camera_add();cam=bpy.context.object;scene.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=4.75;scene.view_settings.view_transform='AgX'
 for label,loc in [('front-side',(-4,-6,3.1)),('side',(-6,0,2.0)),('rear-side',(-4,6,3.0))]:
  cam.location=loc;cam.rotation_euler=(Vector((0,.10,1.0))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(OUT/f'{a.stage}-blender-{label}.png');bpy.ops.render.render(write_still=True)
print('SURF CAR COMPLETE',report)
