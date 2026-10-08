import bpy, math, random, json
from pathlib import Path
from mathutils import Vector, noise as m_noise
import numpy as np
SRC=Path(__file__).resolve().parent
ROOT=SRC.parents[1]
OUT=ROOT/'output/copper-cow'
DEST=ROOT/'src/assets/models/copper-cow'
random.seed(93)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def material(name,c):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=.84
 return m
gold=material('Reference russet orange short coat',(.68,.30,.045))
pink=material('Reference warm pale pink gray muzzle',(.65,.49,.43))
lip=material('Warm muted mouth crease',(.26,.18,.15))
horn=material('Reference broad gray curved horns',(.32,.34,.31))
white=material('Warm ivory eye whites',(.72,.71,.58))
dark=material('Dark brown watchful pupils',(.031,.037,.021))
brow=material('Dark russet eyebrow hair',(.23,.10,.020))
hoof=material('Reference pale cloven hooves',(.72,.75,.64))
inner=material('Ivory inner ears',(.70,.73,.57))
tailmat=material('Ochre tail tuft',(.34,.23,.035))
# Embedded coat color texture survives GLB export. Fine bumps are actual geometry.
im=bpy.data.images.new('Copper orange coat mottled pigment',width=512,height=512)
px=[];heights=np.zeros((512,512),dtype=np.float32)
for y in range(512):
 for x in range(512):
  coarse=m_noise.noise(Vector((x*.055,y*.055,8.3)))
  fine=m_noise.noise(Vector((x*.40,y*.16,2.1)))
  grain=random.uniform(-.022,.022)
  t=coarse*.072+fine*.047+grain
  px.extend((min(1,.86+t),max(0,.47+t*.9),max(0,.10+t*.35),1))
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
himg=bpy.data.images.new('Embedded gray horn mottling',width=512,height=512);hp=[]
for y in range(512):
 for x in range(512):
  n=m_noise.noise(Vector((x*.24,y*.24,12.2)));t=n*.17+random.uniform(-.035,.035)
  if n<-.16:t-=.06
  hp.extend((max(0,.54+t),max(0,.56+t),max(0,.53+t),1))
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
ell('Horizontal broad barrel',(0,.32,1.32),(.76,1.20,.72),gold,True)
ell('Powerful shoulder',(0,-.48,1.48),(.79,.68,.79),gold,True)
ell('Rounded rear haunch',(0,1.03,1.36),(.73,.57,.70),gold,True)
for x in [-.49,.49]:
 for y in [-.56,1.04]:
  ell('Leg upper', (x,y,.78),(.255,.275,.51),gold,True)
  rounded('Short sturdy lower leg',(x,y,.40),(.17,.19,.27),gold,.13,True)
  for dx in [-.088,.088]:rounded('Cloven cream hoof',(x+dx,y-.025,.135),(.082,.21,.125),hoof,.06)
ell('Forward neck',(0,-.85,1.69),(.56,.56,.73),gold,True)
head=rounded('Tapered broad character head',(0,-1.22,2.03),(.59,.48,.64),gold,.32,True)
for v in head.data.vertices:
 # Broad above the brows, narrowing toward the enlarged muzzle.
 t=max(0,min(1,(v.co.z+.64)/1.28));v.co.x*=.88+.14*t
ell('Large domed forehead',(0,-1.24,2.40),(.59,.47,.30),gold,True)
for s in [-1,1]:
 ear=ell('Pointed outer ear',(s*.65,-1.07,2.30),(.29,.13,.115),gold,True);ear.rotation_euler.y=s*-.27
 e=ell('Cream inner ear',(s*.69,-1.185,2.30),(.20,.026,.070),inner);e.rotation_euler.y=s*-.27
 tube('Swept up gray horn',[(s*.48,-1.06,2.53),(s*.79,-1.03,2.64),(s*1.02,-1.00,2.88),(s*1.055,-.96,3.18),(s*.96,-.94,3.42),(s*.85,-.94,3.49)],[.205,.18,.144,.105,.060,.025],horn,28)
 # The upper lids overlap eyeballs to reproduce the sleepy narrow expression.
 ell('Narrow almond eye white',(s*.27,-1.70,2.16),(.187,.026,.054),white)
 ell('Horizontal teal pupil',(s*.27,-1.730,2.157),(.053,.012,.045),dark)
 ell('Flush upper eyelid',(s*.27,-1.676,2.219),(.199,.034,.066),gold,True)
 tube('Low expressive brow',[(s*.10,-1.713,2.251),(s*.27,-1.726,2.292),(s*.45,-1.687,2.305)],[.019,.035,.012],brow,12)
# Broad fleshy nose with rounded paired nostril recesses and a layered lip.
bridge=ell('Pale bridge of nose',(0,-1.73,1.91),(.245,.195,.23),pink)
for v in bridge.data.vertices:
 v.co.x*=1-.60*max(0,v.co.z/.23)
ell('Broad nose pad',(0,-2.005,1.795),(.30,.13,.15),pink)
ell('Large upper muzzle',(0,-1.875,1.65),(.409,.265,.225),pink)
rounded('Broad lower chin',(0,-1.82,1.416),(.378,.235,.18),pink,.16)
ell('Soft central nose tip',(0,-2.085,1.794),(.085,.065,.087),pink)
for s in [-1,1]:
 ell('Deep vertical nostril',(s*.15,-2.143,1.79),(.045,.020,.073),lip)
 tube('Vertical soft nostril rim',[(s*.20,-2.09,1.73),(s*.197,-2.12,1.815),(s*.164,-2.136,1.866),(s*.116,-2.12,1.837)],[.018,.028,.029,.015],pink,16)
tube('Neutral upper mouth line',[(-.363,-1.99,1.516),(-.23,-2.091,1.525),(0,-2.118,1.534),(.23,-2.091,1.525),(.363,-1.99,1.516)],[.008,.011,.013,.011,.008],lip,12)
tube('Thick lower lip',[(-.35,-2.006,1.485),(-.22,-2.11,1.49),(0,-2.135,1.503),(.22,-2.11,1.49),(.35,-2.006,1.485)],[.022,.027,.029,.027,.022],pink,16)
tube('Lower muzzle fold',[(-.32,-1.991,1.367),(-.21,-2.043,1.346),(0,-2.056,1.34),(.21,-2.043,1.346),(.32,-1.991,1.367)],[.004,.006,.007,.006,.004],lip,12)
tube('Hanging curved tail',[(0,1.44,1.55),(.10,1.71,1.43),(.22,1.84,.97),(.25,1.86,.58)],[.085,.061,.047,.035],gold)
ell('Golden brown tail tuft',(.25,1.86,.48),(.105,.10,.19),tailmat,True)
# Smooth away primitive seams around the forehead and the fleshy nose bridge.
for prefixes,label,voxel in [(('Tapered broad','Large domed'),'Continuous tapered head',.014),(('Pale bridge','Large upper muzzle','Broad lower chin','Soft central nose tip','Broad nose pad'),'Continuous ivory muzzle',.012)]:
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
bpy.ops.wm.save_as_mainfile(filepath=str(SRC/'copper-cow.blend'))
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
for name,pos,target in [('three-quarter',(4,-6,3.4),(0,-.15,1.50)),('front',(0,-7,2.85),(0,-.30,1.58)),('side',(7,-.25,2.8),(0,-.03,1.55)),('face-detail',(0,-7,3.0),(0,-1.30,2.32))]:
 cam.data.ortho_scale=3.05 if name=='face-detail' else 5.4
 cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
 scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
print('DONE',tri)
