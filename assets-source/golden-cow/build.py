import bpy, math, random, json
from pathlib import Path
from mathutils import Vector, noise as m_noise
import numpy as np
SRC=Path(__file__).resolve().parent
ROOT=SRC.parents[1]
OUT=ROOT/'output/golden-cow'
DEST=ROOT/'src/assets/models/golden-cow'
random.seed(42)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def material(name,c):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=.84
 return m
gold=material('Reference lemon yellow short coat',(.87,.65,.015))
pink=material('Reference cool ivory gray muzzle',(.66,.69,.64))
lip=material('Subtle gray mouth crease',(.31,.35,.30))
horn=material('Reference blue gray speckled horns',(.23,.34,.36))
white=material('Cool narrow eye whites',(.61,.76,.76))
dark=material('Dark teal horizontal pupils',(.012,.044,.040))
brow=material('Muted green gray eyebrows',(.085,.21,.16))
hoof=material('Reference pale cloven hooves',(.72,.75,.64))
inner=material('Ivory inner ears',(.70,.73,.57))
tailmat=material('Ochre tail tuft',(.34,.23,.035))
# Embedded coat color texture survives GLB export. Fine bumps are actual geometry.
im=bpy.data.images.new('Golden coat mottled pigment',width=512,height=512)
px=[];heights=np.zeros((512,512),dtype=np.float32)
for y in range(512):
 for x in range(512):
  coarse=m_noise.noise(Vector((x*.055,y*.055,8.3)))
  fine=m_noise.noise(Vector((x*.40,y*.16,2.1)))
  grain=random.uniform(-.022,.022)
  t=coarse*.072+fine*.047+grain
  px.extend((min(1,.94+t),max(0,.77+t*1.25),max(0,.065+t*.3),1))
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
 nm=mat.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.36 if mat==gold else .72
 mat.node_tree.links.new(nt.outputs['Color'],nm.inputs['Color']);mat.node_tree.links.new(nm.outputs['Normal'],mat.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
normal_texture(gold,heights,'Embedded fine short coat normal',1.8)
# Gray blue horns have irregular peppered flecks rather than a flat white finish.
himg=bpy.data.images.new('Embedded blue gray horn speckles',width=512,height=512);hp=[]
for y in range(512):
 for x in range(512):
  n=m_noise.noise(Vector((x*.24,y*.24,12.2)));t=n*.28+random.uniform(-.035,.035)
  if n<-.13:t-=.13
  hp.extend((max(0,.40+t),max(0,.53+t),max(0,.56+t),1))
himg.colorspace_settings.name='sRGB';himg.pixels.foreach_set(hp);himg.pack()
hn=horn.node_tree.nodes.new('ShaderNodeTexImage');hn.image=himg;horn.node_tree.links.new(hn.outputs['Color'],horn.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
normal_texture(horn,heights,'Embedded horn fine roughness normal',1.0)
noise=bpy.data.textures.new('Very short irregular fur relief',type='CLOUDS');noise.noise_scale=.033;noise.noise_depth=2
def finish(o,name,mat,rough=False):
 o.name=name;o.data.materials.append(mat)
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if rough:
  d=o.modifiers.new('Short fur silhouette','DISPLACE');d.texture=noise;d.strength=.016;d.texture_coords='GLOBAL'
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
ell('Horizontal broad barrel',(0,.32,1.30),(.70,1.18,.69),gold,True)
ell('Powerful shoulder',(0,-.48,1.42),(.71,.65,.74),gold,True)
ell('Rounded rear haunch',(0,1.03,1.34),(.68,.55,.67),gold,True)
for x in [-.46,.46]:
 for y in [-.56,1.04]:
  ell('Leg upper', (x,y,.78),(.235,.26,.51),gold,True)
  rounded('Short sturdy lower leg',(x,y,.40),(.17,.19,.27),gold,.13,True)
  for dx in [-.088,.088]:rounded('Cloven cream hoof',(x+dx,y-.025,.135),(.082,.21,.125),hoof,.06)
ell('Forward neck',(0,-.85,1.66),(.52,.56,.66),gold,True)
head=rounded('Tapered broad character head',(0,-1.22,2.02),(.67,.47,.55),gold,.32,True)
for v in head.data.vertices:
 # Broad above the brows, narrowing toward the enlarged muzzle.
 t=max(0,min(1,(v.co.z+.55)/1.10));v.co.x*=.67+.38*t
ell('Large domed forehead',(0,-1.24,2.34),(.67,.47,.29),gold,True)
for s in [-1,1]:
 ear=ell('Pointed outer ear',(s*.69,-1.13,2.24),(.34,.14,.15),gold,True);ear.rotation_euler.y=s*-.27
 e=ell('Cream inner ear',(s*.73,-1.25,2.24),(.23,.028,.095),inner);e.rotation_euler.y=s*-.27
 tube('Swept up gray horn',[(s*.53,-1.10,2.46),(s*.72,-1.08,2.58),(s*.83,-1.06,2.77),(s*.85,-1.04,2.94),(s*.82,-1.035,3.00)],[.145,.122,.089,.058,.030],horn,28)
 # The upper lids overlap eyeballs to reproduce the sleepy narrow expression.
 ell('Narrow almond eye white',(s*.30,-1.678,2.10),(.202,.025,.043),white)
 ell('Horizontal teal pupil',(s*.30,-1.704,2.104),(.082,.011,.029),dark)
 ell('Flush upper eyelid',(s*.30,-1.648,2.145),(.215,.025,.035),gold,True)
 tube('Low expressive brow',[(s*.13,-1.686,2.267),(s*.30,-1.708,2.292),(s*.48,-1.67,2.283)],[.008,.014,.007],brow,12)
# Broad fleshy nose with rounded paired nostril recesses and a layered lip.
ell('Pale bridge of nose',(0,-1.74,1.81),(.24,.17,.15),pink)
ell('Large upper muzzle',(0,-1.82,1.635),(.495,.24,.245),pink)
rounded('Broad lower chin',(0,-1.785,1.405),(.435,.21,.175),pink,.16)
ell('Soft central nose tip',(0,-2.022,1.776),(.077,.044,.059),pink)
for s in [-1,1]:
 ell('Shallow horizontal nostril',(s*.205,-2.022,1.78),(.085,.017,.022),lip)
 tube('Raised nostril rim',[(s*.295,-2.011,1.77),(s*.26,-2.037,1.806),(s*.19,-2.043,1.81),(s*.135,-2.025,1.783)],[.018,.025,.025,.014],pink,14)
tube('Soft mouth line',[(-.444,-1.925,1.545),(-.28,-2.016,1.499),(0,-2.039,1.480),(.28,-2.016,1.499),(.444,-1.925,1.545)],[.006,.010,.012,.010,.006],lip,12)
tube('Lower lip',[(-.425,-1.94,1.513),(-.26,-2.025,1.47),(0,-2.045,1.451),(.26,-2.025,1.47),(.425,-1.94,1.513)],[.018,.022,.023,.022,.018],pink,16)
tube('Lower muzzle fold',[(-.365,-1.951,1.357),(-.23,-1.99,1.33),(0,-1.995,1.32),(.23,-1.99,1.33),(.365,-1.951,1.357)],[.004,.006,.007,.006,.004],lip,12)
tube('Hanging curved tail',[(0,1.44,1.55),(.10,1.71,1.43),(.22,1.84,.97),(.25,1.86,.58)],[.085,.061,.047,.035],gold)
ell('Golden brown tail tuft',(.25,1.86,.48),(.105,.10,.19),tailmat,True)
# Smooth away primitive seams around the forehead and the fleshy nose bridge.
for prefixes,label,voxel in [(('Tapered broad','Large domed'),'Continuous tapered head',.014),(('Pale bridge','Large upper muzzle','Broad lower chin','Soft central nose tip'),'Continuous ivory muzzle',.012)]:
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
 for vert in verts[:3500]:
  n=vert.normal.normalized();p=coat.matrix_world@vert.co
  flow=Vector((0,.35,-1));flow=(flow-n*flow.dot(n))
  if flow.length<.1:flow=n.cross(Vector((1,0,0)))
  flow.normalize();w=n.cross(flow).normalized();length=random.uniform(.015,.026);width=random.uniform(.002,.004)
  base=len(vs);start=p+n*.001;end=start+flow*length+n*.003
  vs.extend([tuple(start-w*width),tuple(start+w*width),tuple((start+end)*.5+n*.004),tuple(end)])
  fs.extend([(base,base+1,base+2),(base+1,base+3,base+2),(base+3,base,base+2)])
  u=random.random();v=random.random();uvs.extend([(u,v),(u+.003,v),(u+.0015,v+.002),(u+.0015,v+.006)])
me=bpy.data.meshes.new('Short golden fur detail');me.from_pydata(vs,[],fs);me.update();tufts=bpy.data.objects.new('Fine short tapered fur tufts',me);bpy.context.collection.objects.link(tufts);me.materials.append(gold)
uv=me.uv_layers.new(name='Fur pigment UV')
for poly in me.polygons:
 for li in poly.loop_indices:uv.data[li].uv=uvs[me.loops[li].vertex_index]
model=[o for o in bpy.context.scene.objects if o.type=='MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in model:o.select_set(True)
bpy.context.view_layer.objects.active=model[0]
bpy.ops.wm.save_as_mainfile(filepath=str(SRC/'golden-cow.blend'))
tri=sum(len(p.vertices)-2 for o in model for p in o.data.polygons)
(OUT/'stats.json').write_text(json.dumps({'triangles':tri,'mesh_objects':len(model),'pose':'quadruped standing','rigged':False},indent=2))
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
for name,pos,target in [('three-quarter',(4,-6,3.4),(0,-.15,1.50)),('front',(0,-7,2.85),(0,-.30,1.58)),('side',(7,-.25,2.8),(0,-.03,1.55)),('face-detail',(0,-7,4.8),(0,-1.30,2.12))]:
 cam.data.ortho_scale=2.55 if name=='face-detail' else 5.1
 cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
 scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
print('DONE',tri)
