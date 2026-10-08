import bpy, math, random, json
from pathlib import Path
from mathutils import Vector, noise as m_noise
import numpy as np
SRC=Path(__file__).resolve().parent
ROOT=SRC.parents[1]
OUT=ROOT/'output/reference-wolf'
DEST=ROOT/'src/assets/models/reference-wolf'
random.seed(134)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def material(name,c):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=.84
 return m
gold=material('Charcoal black short coat',(.007,.011,.010))
gold.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.18
pale=material('Reference icy blue gray muzzle and chest',(.37,.62,.67))
yellow=material('Half closed yellow eyes',(.93,.81,.010))
dark=material('Black pupils and mouth',(.003,.007,.006))
nosemat=material('Matte dark olive angular nose',(.042,.058,.030))
earinner=material('Pale yellow inner ears',(.78,.80,.39))
lipmat=material('Pale lower lip line',(.50,.69,.70))
noise=bpy.data.textures.new('Very short irregular fur relief',type='CLOUDS');noise.noise_scale=.033;noise.noise_depth=2
heights=np.zeros((512,512),dtype=np.float32);blackpx=[];palepx=[]
for y in range(512):
 for x in range(512):
  n=m_noise.noise(Vector((x*.35,y*.16,7.1)));t=n*.018+random.uniform(-.009,.009)
  blackpx.extend((max(.015,.050+t),max(.018,.062+t),max(.018,.055+t),1))
  palepx.extend((.57+t*2,.78+t*2,.83+t*2,1));heights[y,x]=n*.6+random.uniform(-.07,.07)
for mat,name,pixels in [(gold,'Embedded charcoal fur pigment',blackpx),(pale,'Embedded icy gray fur pigment',palepx)]:
 im=bpy.data.images.new(name,width=512,height=512);im.colorspace_settings.name='sRGB';im.pixels.foreach_set(pixels);im.pack()
 node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=im;mat.node_tree.links.new(node.outputs['Color'],mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
def normal_texture(mat,height,name,strength):
 dx=(np.roll(height,1,axis=1)-np.roll(height,-1,axis=1))*strength
 dy=(np.roll(height,1,axis=0)-np.roll(height,-1,axis=0))*strength
 normal=np.stack((dx,dy,np.ones_like(dx)),axis=2);normal/=np.linalg.norm(normal,axis=2)[:,:,None]
 rgba=np.concatenate((normal*.5+.5,np.ones((512,512,1))),axis=2).astype(np.float32)
 img=bpy.data.images.new(name,width=512,height=512);img.colorspace_settings.name='Non-Color';img.pixels.foreach_set(rgba.ravel());img.pack()
 nt=mat.node_tree.nodes.new('ShaderNodeTexImage');nt.image=img
 nm=mat.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.38
 mat.node_tree.links.new(nt.outputs['Color'],nm.inputs['Color']);mat.node_tree.links.new(nm.outputs['Normal'],mat.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
normal_texture(gold,heights,'Embedded black short fur normal',1.8)
normal_texture(pale,heights,'Embedded blue gray short fur normal',1.5)
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

def sculpt_join(prefixes,label,voxel):
 obs=[o for o in bpy.context.scene.objects if o.name.startswith(prefixes)]
 bpy.ops.object.select_all(action='DESELECT')
 for o in obs:o.select_set(True)
 bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();o=obs[0];o.name=label
 rm=o.modifiers.new('Continuous animal sculpt','REMESH');rm.mode='VOXEL';rm.voxel_size=voxel;rm.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=rm.name)
 sm=o.modifiers.new('Smooth overlapping forms','SMOOTH');sm.factor=.65;sm.iterations=3;bpy.ops.object.modifier_apply(modifier=sm.name)
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(island_margin=.02);bpy.ops.object.mode_set(mode='OBJECT')
 return o

# Broad feline-like cartoon head and stocky canine body, following the center wolf.
ell('Body barrel',(0,.23,1.17),(.59,1.04,.59),gold,True)
ell('Body shoulder',(0,-.43,1.22),(.65,.57,.67),gold,True)
ell('Body haunch',(0,.96,1.14),(.56,.49,.58),gold,True)
ell('Body neck',(0,-.79,1.48),(.48,.48,.62),gold,True)
for s in [-1,1]:
 ell('Body front leg upper',(s*.41,-.63,.75),(.20,.21,.43),gold,True)
 rounded('Body front leg lower',(s*.41,-.72,.35),(.135,.15,.28),gold,.115,True)
 ell('Body front paw',(s*.41,-.83,.125),(.19,.26,.12),gold,True)
 tube('Body back bent leg',[(s*.43,.91,1.02),(s*.45,1.11,.71),(s*.44,.94,.40),(s*.44,1.025,.16)],[.23,.175,.125,.115],gold)
 ell('Body back paw',(s*.44,.96,.12),(.18,.25,.115),gold,True)
 for y in [-1.005,.785]:
  for dx in [-.11,0,.11]:ell('Rounded black paw toe',(s*.42+dx,y,.11),(.063,.105,.078),gold)
body=sculpt_join(('Body ',),'Continuous horizontal wolf body',.023)
tube('Bushy low wolf tail',[(0,1.19,1.36),(.08,1.58,1.21),(.16,1.86,.87),(.15,2.00,.49),(.10,2.08,.32)],[.17,.235,.23,.145,.025],gold,28)
head=rounded('Wide squared wolf head',(0,-1.10,1.995),(.60,.45,.44),gold,.23,True)
for v in head.data.vertices:
 t=max(0,min(1,(v.co.z+.44)/.88));v.co.x*=.90+.10*t
ell('Wolf broad lower jaw',(0,-1.14,1.69),(.50,.36,.25),gold,True)
head=sculpt_join(('Wide squared','Wolf broad lower'),'Broad black mask head',.015)

# Ears are short triangular cones, with pale inset fronts and rounded edges.
for s in [-1,1]:
 x=s*.46
 verts=[(x-.12,-.87,2.30),(x+.12,-.87,2.30),(x+s*.035,-.81,2.64),(x-.095,-.65,2.30),(x+.095,-.65,2.30),(x+s*.035,-.69,2.61)]
 faces=[(0,1,2),(5,4,3),(0,3,4,1),(1,4,5,2),(2,5,3,0)]
 me=bpy.data.meshes.new('Pointed ear');me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new('Short black triangular ear',me);bpy.context.collection.objects.link(o);me.materials.append(gold)
 bpy.context.view_layer.objects.active=o
 be=o.modifiers.new('Soft ear rim','BEVEL');be.width=.027;be.segments=3;bpy.ops.object.modifier_apply(modifier=be.name)
 for p in o.data.polygons:p.use_smooth=True
 iv=[(x-.052,-.886,2.40),(x+.054,-.886,2.40),(x+s*.029,-.835,2.59)]
 me=bpy.data.meshes.new('Pale ear inset');me.from_pydata(iv,[],[(0,1,2)]);me.update();o=bpy.data.objects.new('Cream yellow ear inset',me);bpy.context.collection.objects.link(o);me.materials.append(earinner)
 so=o.modifiers.new('Inset thickness','SOLIDIFY');so.thickness=.009;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=so.name)
 ell('Yellow narrow eye',(s*.285,-1.56,2.077),(.195,.026,.048),yellow)
 ell('Dark vertical pupil',(s*.285,-1.589,2.075),(.042,.012,.039),dark)
 ell('Black heavy upper eyelid',(s*.285,-1.548,2.134),(.208,.039,.068),gold,True)
 tube('Subtle angled black brow',[(s*.09,-1.54,2.138),(s*.29,-1.564,2.180),(s*.48,-1.517,2.187)],[.025,.036,.018],gold,14)

# Blue gray lower face rises centrally under the nose; the outer cheeks stay black.
ell('Pale short broad snout',(0,-1.74,1.793),(.355,.34,.222),pale,True)
ell('Pale chin',(0,-1.63,1.566),(.355,.28,.135),pale,True)
for s in [-1,1]:
 ell('Pale lower cheek',(s*.25,-1.43,1.665),(.24,.19,.237),pale,True)
muzzle=sculpt_join(('Pale short','Pale chin','Pale lower'),'Continuous icy gray muzzle',.012)
rounded('Dark olive angular wolf nose',(0,-2.048,1.939),(.125,.082,.075),nosemat,.037)
for s in [-1,1]:ell('Small nose nostril',(s*.072,-2.125,1.93),(.023,.007,.012),dark)
ell('Black smiling mouth inset',(0,-2.009,1.664),(.218,.026,.058),dark)
tube('Thin pale lower mouth edge',[(-.20,-2.006,1.658),(-.12,-2.036,1.623),(0,-2.043,1.611),(.12,-2.036,1.623),(.20,-2.006,1.658)],[.008,.010,.011,.010,.008],lipmat,14)

# Chest bib follows the real neck surface, ending in the reference's pointed V.
vs=[];fs=[];uvs=[]
levels=[(.87,.025),(1.00,.21),(1.15,.34),(1.32,.43),(1.48,.45),(1.64,.415),(1.77,.34)]
inverse=body.matrix_world.inverted();direction=inverse.to_3x3()@Vector((0,1,0))
for j,(z,width) in enumerate(levels):
 for k in range(25):
  t=k/12-1;x=t*width;origin=inverse@Vector((x,-5,z))
  hit,location,normal,index=body.ray_cast(origin,direction)
  if hit:p=body.matrix_world@location;p.y-=.025
  else:p=Vector((x,-1.04+.15*t*t,z))
  p.z+=.012*math.sin(k*2.6+j)*abs(t)**6
  vs.append(tuple(p));uvs.append((k/24,j/(len(levels)-1)))
for j in range(len(levels)-1):
 for k in range(24):a=j*25+k;fs.append((a,a+1,a+26,a+25))
me=bpy.data.meshes.new('Pointed chest bib mesh');me.from_pydata(vs,[],fs);me.update();bib=bpy.data.objects.new('Icy gray V shaped chest bib',me);bpy.context.collection.objects.link(bib);me.materials.append(pale)
uv=me.uv_layers.new(name='Chest pigment UV')
for p in me.polygons:
 p.use_smooth=True
 for li in p.loop_indices:uv.data[li].uv=uvs[me.loops[li].vertex_index]
bpy.context.view_layer.objects.active=bib
su=bib.modifiers.new('Rounded chest surface','SUBSURF');su.levels=2;bpy.ops.object.modifier_apply(modifier=su.name)
so=bib.modifiers.new('Bib edge thickness','SOLIDIFY');so.thickness=.014;bpy.ops.object.modifier_apply(modifier=so.name)
di=bib.modifiers.new('Rough short chest fur','DISPLACE');di.texture=noise;di.strength=.018;di.texture_coords='GLOBAL';bpy.ops.object.modifier_apply(modifier=di.name)

# Short fur geometry on the coat and muzzle preserves the rough reference finish.
for coat,mat in [(body,gold),(head,gold),(muzzle,pale),(bib,pale)]:
 vs=[];fs=[];uvs=[];coat.data.update();verts=list(coat.data.vertices);random.shuffle(verts)
 for vert in verts[:2800]:
  n=vert.normal.normalized();p=coat.matrix_world@vert.co;flow=Vector((0,.4,-1));flow-=n*flow.dot(n)
  if flow.length<.1:flow=n.cross(Vector((1,0,0)))
  flow.normalize();w=n.cross(flow).normalized();length=random.uniform(.014,.026);width=random.uniform(.002,.0035)
  base=len(vs);a=p+n*.001;b=a+flow*length+n*.003
  vs.extend([tuple(a-w*width),tuple(a+w*width),tuple((a+b)*.5+n*.003),tuple(b)]);fs.extend([(base,base+1,base+2),(base+1,base+3,base+2),(base+3,base,base+2)])
  u=random.random();v=random.random();uvs.extend([(u,v),(u+.002,v),(u+.001,v+.002),(u+.001,v+.006)])
 me=bpy.data.meshes.new('Wolf fine fur detail');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new('Wolf fine short fur '+coat.name,me);bpy.context.collection.objects.link(o);me.materials.append(mat);uv=me.uv_layers.new(name='Fur pigment')
 for p in me.polygons:
  for li in p.loop_indices:uv.data[li].uv=uvs[me.loops[li].vertex_index]

model=[o for o in bpy.context.scene.objects if o.type=='MESH'];bpy.ops.object.select_all(action='DESELECT')
for o in model:o.select_set(True)
bpy.context.view_layer.objects.active=model[0]
bpy.ops.wm.save_as_mainfile(filepath=str(SRC/'reference-wolf.blend'))
tri=sum(len(p.vertices)-2 for o in model for p in o.data.polygons)
(OUT/'stats.json').write_text(json.dumps({'triangles':tri,'mesh_objects':len(model),'pose':'quadruped standing','rigged':False},indent=2))

# A neutral studio keeps the black coat visible; it is excluded from the GLB.
floor=material('Neutral light gray studio',(.29,.33,.31));bpy.ops.mesh.primitive_plane_add(size=200);bpy.context.object.data.materials.append(floor)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=40;scene.world.color=(.35,.35,.35)
def area(loc,power,size):
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1.4))-o.location).to_track_quat('-Z','Y').to_euler()
area((-3,-4,6),550,5);area((4,-2,4),350,4);area((1,4,5),700,3)
bpy.ops.object.camera_add();cam=bpy.context.object;scene.camera=cam;cam.data.type='ORTHO'
scene.render.resolution_x=1000;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=-.45
for name,pos,target in [('three-quarter',(4,-6,3.1),(0,-.05,1.30)),('front',(0,-7,2.6),(0,-.30,1.40)),('side',(7,-.15,2.7),(0,.20,1.36)),('face-detail',(0,-7,3.2),(0,-1.25,1.99))]:
 cam.data.ortho_scale=2.65 if name=='face-detail' else 4.8;cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
 scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
print('DONE',tri)
