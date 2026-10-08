import bpy, math, random, json
from pathlib import Path
from mathutils import Vector, noise as m_noise
import numpy as np
SRC=Path(__file__).resolve().parent
ROOT=SRC.parents[1]
OUT=ROOT/'output/hornless-calf'
DEST=ROOT/'src/assets/models/hornless-calf'
random.seed(210)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def material(name,c):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=.84
 return m
gold=material('Reference calf red orange short coat',(.62,.20,.052))
pink=material('Reference calf warm sandy muzzle',(.68,.57,.45))
lip=material('Warm muted mouth crease',(.26,.18,.15))
chinmat=material('Reference pale cream lower lip',(.79,.71,.60))
white=material('Warm ivory eye whites',(.72,.71,.58))
dark=material('Dark brown watchful pupils',(.031,.037,.021))
brow=material('Reference thick dark brown eyebrows',(.090,.052,.023))
hoof=material('Reference pale cloven hooves',(.72,.75,.64))
inner=material('Calf pink tan inner ears',(.56,.34,.23))
tailmat=material('Ochre tail tuft',(.34,.23,.035))
# Embedded coat color texture survives GLB export. Fine bumps are actual geometry.
im=bpy.data.images.new('Fine calf red orange pigment',width=512,height=512)
px=[];heights=np.zeros((512,512),dtype=np.float32)
for y in range(512):
 for x in range(512):
  coarse=m_noise.noise(Vector((x*.055,y*.055,8.3)))
  fine=m_noise.noise(Vector((x*.40,y*.16,2.1)))
  grain=random.uniform(-.022,.022)
  t=coarse*.024+fine*.018+grain*.35
  px.extend((min(1,.83+t),max(0,.39+t*.8),max(0,.14+t*.4),1))
  heights[y,x]=fine*.65+grain*3
im.colorspace_settings.name='sRGB';im.pixels.foreach_set(px);im.pack()
node=gold.node_tree.nodes.new('ShaderNodeTexImage');node.image=im
gold.node_tree.links.new(node.outputs['Color'],gold.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
def normal_texture(mat,height,name,strength):
 dx=(np.roll(height,1,axis=1)-np.roll(height,-1,axis=1))*strength
 dy=(np.roll(height,1,axis=0)-np.roll(height,-1,axis=0))*strength
 normal=np.stack((dx,dy,np.ones_like(dx)),axis=2);normal/=np.linalg.norm(normal,axis=2)[:,:,None]
 rgba=np.concatenate((normal*.5+.5,np.ones((512,512,1))),axis=2).astype(np.float32)
 img=bpy.data.images.new(name,width=512,height=512);img.colorspace_settings.name='Non-Color';img.pixels.foreach_set(rgba.ravel());img.pack()
 nt=mat.node_tree.nodes.new('ShaderNodeTexImage');nt.image=img
 nm=mat.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.17
 mat.node_tree.links.new(nt.outputs['Color'],nm.inputs['Color']);mat.node_tree.links.new(nm.outputs['Normal'],mat.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
normal_texture(gold,heights,'Embedded fine short coat normal',1.8)
noise=bpy.data.textures.new('Very short irregular fur relief',type='CLOUDS');noise.noise_scale=.033;noise.noise_depth=2
def finish(o,name,mat,rough=False):
 o.name=name;o.data.materials.append(mat)
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if rough:
  d=o.modifiers.new('Short fur silhouette','DISPLACE');d.texture=noise;d.strength=.007;d.texture_coords='GLOBAL'
  bpy.ops.object.modifier_apply(modifier=d.name)
 for p in o.data.polygons:p.use_smooth=True
 return o
def ell(name,loc,scale,mat,rough=False):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=64,ring_count=40,location=loc)
 o=bpy.context.object;o.scale=scale;return finish(o,name,mat,rough)
def rounded(name,loc,scale,mat,r=.22,rough=False):
 bpy.ops.mesh.primitive_cube_add(size=2,location=loc);o=bpy.context.object;o.scale=scale
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 b=o.modifiers.new('Soft sculpted corners','BEVEL');b.width=r;b.segments=5;bpy.ops.object.modifier_apply(modifier=b.name)
 s=o.modifiers.new('Smooth sculpt surface','SUBSURF');s.levels=2;bpy.ops.object.modifier_apply(modifier=s.name)
 return finish(o,name,mat,rough)
def tube(name,points,radii,mat,sides=20):
 pts=[Vector(p) for p in points];sample=[];rs=[]
 for j in range(len(pts)-1):
  a=pts[max(0,j-1)];b=pts[j];c=pts[j+1];d=pts[min(len(pts)-1,j+2)]
  for k in range(7):
   t=k/7;sample.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t**3));rs.append(radii[j]*(1-t)+radii[j+1]*t)
 sample.append(pts[-1]);rs.append(radii[-1]);vs=[];fs=[]
 for j,p in enumerate(sample):
  tangent=(sample[min(j+1,len(sample)-1)]-sample[max(0,j-1)]).normalized()
  u=tangent.cross(Vector((0,1,0)))
  if u.length<.001:u=tangent.cross(Vector((1,0,0)))
  u.normalize();v=tangent.cross(u)
  for k in range(sides):
   a=k*math.tau/sides;vs.append(tuple(p+rs[j]*(u*math.cos(a)+v*math.sin(a))))
 for j in range(len(sample)-1):
  for k in range(sides):fs.append((j*sides+k,j*sides+(k+1)%sides,(j+1)*sides+(k+1)%sides,(j+1)*sides+k))
 fs.extend([tuple(reversed(range(sides))),tuple((len(sample)-1)*sides+k for k in range(sides))])
 me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o)
 uv=me.uv_layers.new(name='Tube UV')
 for p in me.polygons:
  ks=[me.loops[i].vertex_index%sides for i in p.loop_indices];seam=max(ks)-min(ks)>sides/2
  for i in p.loop_indices:
   vi=me.loops[i].vertex_index;k=vi%sides
   uv.data[i].uv=((sides if seam and k==0 else k)/sides,(vi//sides)/(len(sample)-1))
 return finish(o,name,mat)
# Z up; face points toward negative Y. Four legs, with barrel parallel to ground.
ell('Horizontal broad barrel',(0,.29,1.26),(.61,1.04,.59),gold,True)
ell('Powerful shoulder',(0,-.48,1.37),(.63,.58,.67),gold,True)
ell('Rounded rear haunch',(0,.92,1.26),(.59,.48,.59),gold,True)
for x in [-.40,.40]:
 for y in [-.56,.95]:
  ell('Leg upper', (x,y,.75),(.20,.235,.46),gold,True)
  rounded('Short sturdy lower leg',(x,y,.39),(.145,.165,.26),gold,.13,True)
  for dx in [-.072,.072]:rounded('Cloven cream hoof',(x+dx,y-.025,.135),(.067,.18,.125),hoof,.06)
ell('Forward neck',(0,-.85,1.64),(.47,.50,.65),gold,True)
head=rounded('Tapered broad character head',(0,-1.22,2.03),(.64,.46,.60),gold,.32,True)
for v in head.data.vertices:
 # Broad above the brows, narrowing toward the enlarged muzzle.
 t=max(0,min(1,(v.co.z+.60)/1.20));v.co.x*=.79+.23*t
ell('Large domed forehead',(0,-1.24,2.39),(.63,.45,.30),gold,True)
for s in [-1,1]:
 # Broad pointed calf ears, angled upward at the outer corners.
 points=[(s*.55,-1.175,2.39),(s*.61,-1.175,2.18),(s*1.00,-1.145,2.43),(s*.55,-.99,2.39),(s*.61,-.99,2.18),(s*1.00,-1.04,2.43)]
 me=bpy.data.meshes.new('Pointed calf ear');me.from_pydata(points,[],[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)]);me.update();o=bpy.data.objects.new('Broad pointed outer ear',me);bpy.context.collection.objects.link(o);me.materials.append(gold);bpy.context.view_layer.objects.active=o
 be=o.modifiers.new('Rounded ear rim','BEVEL');be.width=.028;be.segments=4;bpy.ops.object.modifier_apply(modifier=be.name)
 for poly in o.data.polygons:poly.use_smooth=True
 points=[(s*.635,-1.207,2.345),(s*.66,-1.207,2.24),(s*.895,-1.17,2.389)]
 me=bpy.data.meshes.new('Inner calf ear');me.from_pydata(points,[],[(0,2,1)]);me.update();o=bpy.data.objects.new('Tan pink inner ear',me);bpy.context.collection.objects.link(o);me.materials.append(inner)
 o.data.materials[0].use_backface_culling=False
 # The upper lids overlap eyeballs to reproduce the sleepy narrow expression.
 ell('Narrow almond eye white',(s*.275,-1.664,2.192),(.143,.021,.043),white)
 ell('Horizontal teal pupil',(s*.275,-1.688,2.189),(.044,.010,.036),dark)
 ell('Small eye catchlight',(s*.275-.012,-1.700,2.202),(.008,.006,.010),white)
 ell('Flush upper eyelid',(s*.275,-1.648,2.238),(.155,.024,.043),gold,True)
 tube('Low expressive brow',[(s*.105,-1.682,2.300),(s*.27,-1.691,2.343),(s*.455,-1.65,2.35)],[.023,.036,.017],brow,12)
# The calf has a broad, shallow sandy muzzle and small restrained nostrils.
bridge=ell('Pale bridge of nose',(0,-1.715,1.948),(.275,.175,.205),pink)
for v in bridge.data.vertices:
 v.co.x*=1-.30*max(0,v.co.z/.205)
rounded('Large upper muzzle',(0,-1.845,1.711),(.437,.21,.217),pink,.165)
rounded('Broad lower chin',(0,-1.805,1.433),(.390,.21,.105),chinmat,.098)
for s in [-1,1]:
 ell('Small calf nostril',(s*.155,-1.838,2.030),(.026,.008,.021),lip)
tube('Straight soft calf mouth line',[(-.398,-1.959,1.563),(-.26,-2.026,1.559),(0,-2.052,1.557),(.26,-2.026,1.559),(.398,-1.959,1.563)],[.005,.008,.009,.008,.005],lip,12)
tube('Hanging curved tail',[(0,1.31,1.45),(.08,1.57,1.33),(.18,1.69,.88),(.20,1.72,.54)],[.085,.061,.047,.035],gold)
ell('Golden brown tail tuft',(.20,1.72,.46),(.09,.09,.16),tailmat,True)
# Smooth away primitive seams around the forehead and the fleshy nose bridge.
for prefixes,label,voxel in [(('Tapered broad','Large domed'),'Continuous tapered head',.014),(('Pale bridge','Large upper muzzle'),'Continuous ivory muzzle',.012)]:
 group=[o for o in bpy.context.scene.objects if o.name.startswith(prefixes)]
 bpy.ops.object.select_all(action='DESELECT')
 for o in group:o.select_set(True)
 bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join();o=group[0];o.name=label
 rm=o.modifiers.new('Continuous sculpted form','REMESH');rm.mode='VOXEL';rm.voxel_size=voxel;rm.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=rm.name)
 sm=o.modifiers.new('Soft transitions','SMOOTH');sm.factor=.65;sm.iterations=4;bpy.ops.object.modifier_apply(modifier=sm.name)
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(island_margin=.02);bpy.ops.object.mode_set(mode='OBJECT')
# Fuse shoulder, barrel, hips, neck and legs into one continuous sculpted coat.
parts=[o for o in bpy.context.scene.objects if o.name.startswith(('Horizontal broad','Powerful shoulder','Rounded rear','Leg upper','Short sturdy','Forward neck'))]
bpy.ops.object.select_all(action='DESELECT')
for o in parts:o.select_set(True)
bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();body=parts[0];body.name='Continuous quadruped body and four legs'
rm=body.modifiers.new('Fuse coat volumes','REMESH');rm.mode='VOXEL';rm.voxel_size=.026;rm.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=rm.name)
sm=body.modifiers.new('Blend anatomical transitions','SMOOTH');sm.factor=.65;sm.iterations=4;bpy.ops.object.modifier_apply(modifier=sm.name)
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(island_margin=.02);bpy.ops.object.mode_set(mode='OBJECT')
# Tiny tapered fur tufts sit on the coat, with no long fur or alpha cards.
vs=[];fs=[];uvs=[]
for coat in [body,bpy.data.objects.get('Continuous tapered head')]:
 coat.data.update();verts=list(coat.data.vertices);random.shuffle(verts)
 for vert in verts[:5000]:
  n=vert.normal.normalized();p=coat.matrix_world@vert.co
  flow=Vector((0,.35,-1));flow=(flow-n*flow.dot(n))
  if flow.length<.1:flow=n.cross(Vector((1,0,0)))
  flow.normalize();w=n.cross(flow).normalized();length=random.uniform(.008,.015);width=random.uniform(.0015,.0025)
  base=len(vs);start=p+n*.001;end=start+flow*length+n*.003
  vs.extend([tuple(start-w*width),tuple(start+w*width),tuple((start+end)*.5+n*.004),tuple(end)])
  fs.extend([(base,base+1,base+2),(base+1,base+3,base+2),(base+3,base,base+2)])
  u=random.random();v=random.random();uvs.extend([(u,v),(u+.003,v),(u+.0015,v+.002),(u+.0015,v+.006)])
me=bpy.data.meshes.new('Short golden fur detail');me.from_pydata(vs,[],fs);me.update();tufts=bpy.data.objects.new('Fine short tapered fur tufts',me);bpy.context.collection.objects.link(tufts);me.materials.append(gold)
uv=me.uv_layers.new(name='Fur pigment UV')
for poly in me.polygons:
 for li in poly.loop_indices:uv.data[li].uv=uvs[me.loops[li].vertex_index]
model=[o for o in bpy.context.scene.objects if o.type=='MESH']
# A smaller calf with a relatively large head; all four hooves stay on the ground.
for o in model:
 o.location*=.78;o.scale*=.78
bpy.ops.object.select_all(action='DESELECT')
for o in model:o.select_set(True)
bpy.context.view_layer.objects.active=model[0]
bpy.ops.wm.save_as_mainfile(filepath=str(SRC/'hornless-calf.blend'))
tri=sum(len(p.vertices)-2 for o in model for p in o.data.polygons)
(OUT/'stats.json').write_text(json.dumps({'triangles':tri,'mesh_objects':len(model),'pose':'quadruped standing','rigged':False,'horns':False,'scale_vs_adult':.78},indent=2))
# Studio scene is render-only, excluded from asset and editable source.
floor=material('Studio sage floor',(.16,.21,.19))
bpy.ops.mesh.primitive_plane_add(size=200);bpy.context.object.data.materials.append(floor)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32
scene.world.color=(.25,.25,.25)
def area(loc,power,size):
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1.4))-o.location).to_track_quat('-Z','Y').to_euler()
area((-3,-4,6),450,5);area((4,-2,4),230,4);area((1,4,5),450,3)
bpy.ops.object.camera_add();cam=bpy.context.object;scene.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=5.1
scene.render.resolution_x=1000;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=-.55
for name,pos,target in [('three-quarter',(4,-6,2.9),(0,-.12,1.05)),('front',(0,-7,2.20),(0,-.24,1.08)),('side',(7,-.25,2.20),(0,-.06,1.10)),('face-detail',(0,-7,2.30),(0,-1.01,1.65))]:
 cam.data.ortho_scale=1.95 if name=='face-detail' else 3.8
 cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
 scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
print('DONE',tri)
