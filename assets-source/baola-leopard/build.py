import bpy, math, random, json, sys
from pathlib import Path
from mathutils import Vector, noise as m_noise
import numpy as np
SRC=Path(__file__).resolve().parent
ROOT=SRC.parents[1]
OUT=ROOT/'output/baola-leopard'
DEST=ROOT/'src/assets/models/baola-leopard'
random.seed(134)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def material(name,c):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=.84
 return m
gold=material('Charcoal black short coat',(.007,.011,.010))
gold.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.18
pale=material('Reference pale gray white chest',(.65,.67,.62))
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
  palepx.extend((.79+t*2,.80+t*2,.77+t*2,1));heights[y,x]=n*.6+random.uniform(-.07,.07)
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

# Baola keeps the reference character's bright yellow rosettes, broad round head,
# round ears, white sclera, brown pupils, pink nose and pale oval chest.
gold.name='Reference yellow and dark brown leopard rosettes'
pale.name='Reference pale gray white chest fur'
nosemat=material('Reference pink brown nose',(.56,.29,.20))
lipmat=material('Reference warm pink lower lip',(.48,.26,.18))
earinner=material('Reference warm pale inner ears',(.64,.44,.25))
white=material('Warm white eye sclera',(.86,.85,.73))
pupil=material('Large near black reference eyes',(.008,.003,.001))
highlight=material('Eye catchlight',(.98,.98,.93))
brow=material('Dark brown eyebrows',(.14,.10,.025))
teeth=material('Small ivory canine teeth',(.90,.84,.63))
# World-space rosettes are baked to embedded UV images, continuous at sculpt seams.
nt=gold.node_tree;coat_bsdf=nt.nodes.get('Principled BSDF')
for link in list(nt.links):
 if link.to_node==coat_bsdf and link.to_socket.name=='Base Color':nt.links.remove(link)
pos=nt.nodes.new('ShaderNodeNewGeometry')
warp=nt.nodes.new('ShaderNodeTexNoise');warp.inputs['Scale'].default_value=17;warp.inputs['Detail'].default_value=2
nt.links.new(pos.outputs['Position'],warp.inputs['Vector'])
scale=nt.nodes.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs['Scale'].default_value=.045;nt.links.new(warp.outputs['Color'],scale.inputs[0])
add=nt.nodes.new('ShaderNodeVectorMath');add.operation='ADD';nt.links.new(pos.outputs['Position'],add.inputs[0]);nt.links.new(scale.outputs[0],add.inputs[1])
vor=nt.nodes.new('ShaderNodeTexVoronoi');vor.inputs['Scale'].default_value=9;nt.links.new(add.outputs[0],vor.inputs['Vector'])
ramp=nt.nodes.new('ShaderNodeValToRGB');ramp.color_ramp.interpolation='EASE'
# Smaller filled spots among ragged dark rings match the reference's dense coat.
colors=[(0,(.52,.37,.012,1)),(.20,(.68,.53,.008,1)),(.29,(.11,.065,.006,1)),(.40,(.095,.055,.005,1)),(.49,(.83,.68,.006,1)),(.75,(.83,.68,.006,1))]
cr=ramp.color_ramp;cr.elements.remove(cr.elements[1]);cr.elements[0].position=colors[0][0];cr.elements[0].color=colors[0][1]
for at,c in colors[1:]:cr.elements.new(at).color=c
fleck=nt.nodes.new('ShaderNodeTexNoise');fleck.inputs['Scale'].default_value=24;fleck.inputs['Detail'].default_value=3;nt.links.new(pos.outputs['Position'],fleck.inputs['Vector'])
fleck_gain=nt.nodes.new('ShaderNodeMath');fleck_gain.operation='MULTIPLY_ADD';fleck_gain.inputs[1].default_value=.24;fleck_gain.inputs[2].default_value=-.12;nt.links.new(fleck.outputs['Fac'],fleck_gain.inputs[0])
spotted=nt.nodes.new('ShaderNodeMath');spotted.operation='ADD';nt.links.new(vor.outputs['Distance'],spotted.inputs[0]);nt.links.new(fleck_gain.outputs[0],spotted.inputs[1]);nt.links.new(spotted.outputs[0],ramp.inputs[0])
emission=nt.nodes.new('ShaderNodeEmission');nt.links.new(ramp.outputs['Color'],emission.inputs['Color'])
out=nt.nodes.get('Material Output');nt.links.new(emission.outputs[0],out.inputs['Surface'])
# Cat torso and paws; head deliberately stays large rather than becoming realistic.
ell('Body barrel',(0,.23,1.17),(.57,1.02,.55),gold,True)
ell('Body shoulder',(0,-.43,1.22),(.60,.53,.61),gold,True)
ell('Body haunch',(0,.94,1.14),(.55,.48,.56),gold,True)
ell('Body neck',(0,-.79,1.49),(.45,.45,.57),gold,True)
for s in [-1,1]:
 ell('Body front leg upper',(s*.41,-.63,.75),(.18,.20,.43),gold,True)
 rounded('Body front leg lower',(s*.41,-.72,.35),(.13,.14,.28),gold,.11,True)
 ell('Body front paw',(s*.41,-.83,.125),(.19,.24,.12),gold,True)
 tube('Body back bent leg',[(s*.43,.91,1.02),(s*.44,1.08,.71),(s*.44,.94,.40),(s*.44,.96,.16)],[.22,.16,.12,.11],gold)
 ell('Body back paw',(s*.44,.96,.12),(.18,.23,.115),gold,True)
body=sculpt_join(('Body ',),'Continuous quadruped body and four legs',.024)
tail=tube('Long spotted feline tail',[(0,1.20,1.36),(.07,1.65,1.24),(.15,2.10,.94),(.25,2.49,.60),(.33,2.72,.56)],[.095,.085,.073,.056,.022],gold,24)
# Independently sculpted anthropomorphic face. No screenshot or projected face.
# Cross-sections narrow from forehead and cheeks to a human-shaped jaw/chin.
sections=[(1.46,.14,.18),(1.52,.29,.27),(1.65,.39,.34),(1.86,.49,.41),(2.08,.59,.44),(2.32,.62,.44),(2.48,.56,.38),(2.56,.42,.29),(2.61,.01,.01)]
def dimensions(z):
 for j in range(1,len(sections)):
  if z<=sections[j][0]:
   a,b=sections[j-1],sections[j];t=max(0,min(1,(z-a[0])/(b[0]-a[0])));return (a[1]*(1-t)+b[1]*t,a[2]*(1-t)+b[2]*t)
 return sections[-1][1:]
def g(x,z,cx,cz,rx,rz):return math.exp(-((x-cx)/rx)**2-((z-cz)/rz)**2)
def face_y(x,z):
 width,depth=dimensions(z);t=min(.999,abs(x)/max(.01,width));y=-1.10-depth*(1-t*t)**.175
 # Eye sockets have a real recess; bridge and cheek volumes rise gently.
 y+=.028*(g(x,z,-.285,2.115,.21,.105)+g(x,z,.285,2.115,.21,.105))
 y-=.032*g(x,z,-.025,1.972,.075,.18)+.011*(g(x,z,-.30,1.88,.17,.14)+g(x,z,.30,1.88,.17,.14))
 return y
verts=[];faces=[];uvs=[];rings,segments=92,128
for j in range(rings+1):
 z=sections[0][0]+(sections[-1][0]-sections[0][0])*j/rings;width,depth=dimensions(z)
 for i in range(segments):
  theta=math.tau*i/segments;x=width*math.sin(theta);front=math.cos(theta)
  y=face_y(x,z) if front>=0 else -1.10-depth*front
  verts.append((x,y,z));uvs.append((i/segments,j/rings))
for j in range(rings):
 for i in range(segments):
  a=j*segments+i;b=j*segments+(i+1)%segments;faces.append((a,b,b+segments,a+segments))
faces.extend([tuple(reversed(range(segments))),tuple(rings*segments+i for i in range(segments))])
me=bpy.data.meshes.new('Sculpted human feline head');me.from_pydata(verts,[],faces);me.update();head=bpy.data.objects.new('Broad yellow leopard mask head',me);bpy.context.collection.objects.link(head);me.materials.append(gold)
uv=me.uv_layers.new(name='Continuous head coat UV')
for polygon in me.polygons:
 polygon.use_smooth=True
 seam=max(uvs[me.loops[li].vertex_index][0] for li in polygon.loop_indices)-min(uvs[me.loops[li].vertex_index][0] for li in polygon.loop_indices)>.5
 for li in polygon.loop_indices:
  u,v=uvs[me.loops[li].vertex_index];uv.data[li].uv=(u+1 if seam and u<.5 else u,v)
# Recalculate outward normals; preserve smooth high-resolution eye sockets.
bpy.context.view_layer.objects.active=head;head.select_set(True)
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
facegray=material('Drawn warm gray human facial markings',(.27,.245,.17))
graylip=material('Human upper lip contour',(.32,.235,.16))
normal_texture(facegray,heights,'Gray facial short fur normal',.7)
# Fine drawn gray patches curl from each inner eye corner around the nose/mouth.
def surface_strip(name,points,widths,mat):
 original=[Vector(p) for p in points];sample=[];sample_width=[]
 for j in range(len(original)-1):
  a=original[max(0,j-1)];b=original[j];c=original[j+1];d=original[min(len(original)-1,j+2)]
  for k in range(7):
   t=k/7;sample.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t**3));sample_width.append((widths[j]*(1-t)+widths[j+1]*t)*.8)
 sample.append(original[-1]);sample_width.append(widths[-1]*.8);points=sample;widths=sample_width
 vs=[];fs=[]
 for j,(x,z) in enumerate(points):
  a=Vector(points[max(0,j-1)]);b=Vector(points[min(len(points)-1,j+1)]);direction=(b-a).normalized();normal=Vector((-direction.y,direction.x))
  for side in [-1,1]:
   px=x+side*normal.x*widths[j];pz=z+side*normal.y*widths[j];vs.append((px,face_y(px,pz)-.007,pz))
 for j in range(len(points)-1):fs.append((j*2,j*2+1,j*2+3,j*2+2))
 me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);me.materials.append(mat)
 for f in me.polygons:f.use_smooth=True
 return o
for side in [-1,1]:
 surface_strip('Human gray cheek contour '+str(side),[(side*.165,2.045),(side*.15,1.995),(side*.185,1.95),(side*.20,1.91),(side*.15,1.84),(side*.11,1.78),(side*.18,1.72),(side*.24,1.69)],[.012,.022,.031,.027,.023,.019,.017,.008],facegray)
# Nose one: a shallow human bridge and nostril wings between the eyes.
ell('Human gray nose bridge',(-.025,face_y(-.025,1.99)-.014,1.99),(.055,.032,.17),facegray)
ell('Human gray nose tip',(-.025,face_y(-.025,1.89)-.035,1.895),(.080,.043,.054),facegray)
for side in [-1,1]:
 x=-.025+side*.068
 ell('Human nostril wing',(x,face_y(x,1.87)-.019,1.87),(.038,.025,.032),facegray)
 ell('Human dark nostril',(x,face_y(x,1.86)-.041,1.858),(.016,.004,.009),dark)
# Nose two: the reference's small pink nose sits below the human nose, on the face.
# Its two light tooth-like notches and pink nasal rim are modeled explicitly.
x=.025;z=1.785;y=face_y(x,z)
rounded('Pink lower reference nose',(x,y-.027,z),(.133,.047,.070),nosemat,.041)
for side in [-1,1]:
 ell('Lower pink nose opening',(x+side*.061,y-.074,1.774),(.027,.003,.013),dark)
 ell('Tiny ivory nose tooth',(x+side*.062,y-.079,1.759),(.014,.005,.010),teeth)
# Layered human mouth contour and lower pink lips; no long animal muzzle.
upper_points=[(-.26,1.675),(-.18,1.686),(-.07,1.671),(.02,1.665),(.12,1.681),(.25,1.696)]
surface_strip('Human upper mouth contour',upper_points,[.006,.012,.011,.009,.011,.004],graylip)
def face_tube(name,xz,radii,mat,offset=.018):return tube(name,[(x,face_y(x,z)-offset,z) for x,z in xz],radii,mat,20)
face_tube('Black smiling mouth inset',[(-.285,1.637),(-.19,1.633),(-.07,1.611),(.045,1.607),(.16,1.631),(.26,1.664)],[.023,.012,.008,.008,.007,.003],dark,.022)
face_tube('Pink upper human lip',[(-.21,1.650),(-.13,1.643),(-.035,1.634),(.075,1.639),(.18,1.660),(.26,1.680)],[.010,.015,.017,.017,.012,.005],lipmat,.028)
face_tube('Thick lower lip human smile',[(-.25,1.612),(-.15,1.583),(-.03,1.570),(.10,1.590),(.22,1.631),(.28,1.671)],[.008,.018,.022,.022,.016,.004],lipmat,.026)
# Keep a yellow face skin control mesh under the lower nose for real GLB QA.
ell('Reference yellow muzzle',(.025,face_y(.025,1.78)+.025,1.78),(.13,.035,.075),gold)
# Almond eye surfaces share the socket curvature. Their depth is a few millimetres.
def almond_limits(t,side):
 profile=max(0,1-t*t)**.65;slope=side*.022*t
 return (-.060*profile+slope,.085*profile+slope)
def eye_patch(name,side,kind,mat):
 cx=side*.285;cz=2.112;vs=[];fs=[];uvs=[];columns,rows=60,24
 for j in range(rows+1):
  for i in range(columns+1):
   t=i/columns*2-1;dx=t*(.203 if kind=='white' else .124)
   lo,hi=almond_limits(dx/.203,side)
   if kind=='pupil':
    extent=.079*math.sqrt(max(0,1-t*t));lo=max(lo,-extent);hi=min(hi,extent)
   dz=lo+(hi-lo)*j/rows;x=cx+dx;z=cz+dz
   y=face_y(x,z)-(.008 if kind=='white' else .011)
   vs.append((x,y,z));uvs.append((i/columns,j/rows))
 for j in range(rows):
  for i in range(columns):a=j*(columns+1)+i;fs.append((a,a+1,a+columns+2,a+columns+1))
 me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);me.materials.append(mat);uv=me.uv_layers.new(name='Eye surface UV')
 for polygon in me.polygons:
  polygon.use_smooth=True
  for li in polygon.loop_indices:uv.data[li].uv=uvs[me.loops[li].vertex_index]
 o['blink_eye_z']=cz
 return o
for side in [-1,1]:
 suffix='L' if side<0 else 'R'
 ell('Rounded spotted ear',(side*.49,-.89,2.55),(.17,.13,.27),gold,True)
 ell('Warm round inner ear',(side*.49,-1.013,2.58),(.09,.018,.185),earinner)
 eye_patch('Reference eye white '+suffix,side,'white',white)
 eye_patch('Reference vertical pupil '+suffix,side,'pupil',pupil)
 eyelid=[]
 for k in range(13):
  t=-1+2*k/12;x=side*.285+.203*t;z=2.112+almond_limits(t,side)[1]+.004;eyelid.append((x,z))
 lid=face_tube('Spotted upper eyelid '+suffix,eyelid,[.007+.004*math.sin(math.pi*k/12) for k in range(13)],gold,.007);lid['blink_eye_z']=2.112
 x=side*.285-.025;z=2.137
 catch=ell('Small eye catchlight '+suffix,(x,face_y(x,z)-.014,z),(.010,.002,.012),highlight);catch['blink_eye_z']=2.112
 face_tube('Reference fine human brow '+suffix,[(side*.075,2.292),(side*.19,2.299),(side*.32,2.323),(side*.48,2.345)],[.007,.011,.011,.004],brow,.008)
# A pale oval patch lies on the front chest and extends beneath the horizontal belly.
vs=[];fs=[];uvs=[]
levels=[(.70,.02),(.79,.20),(.97,.33),(1.15,.39),(1.33,.40),(1.48,.34),(1.59,.20),(1.62,.025)]
inverse=body.matrix_world.inverted();direction=inverse.to_3x3()@Vector((0,1,0))
for j,(z,width) in enumerate(levels):
 for k in range(25):
  x=(k/12-1)*width;hit,location,normal,index=body.ray_cast(inverse@Vector((x,-5,z)),direction)
  p=body.matrix_world@location if hit else Vector((x,-1,z));p.y-=.012
  vs.append(tuple(p));uvs.append((k/24,j/(len(levels)-1)))
for j in range(len(levels)-1):
 for k in range(24):a=j*25+k;fs.append((a,a+1,a+26,a+25))
me=bpy.data.meshes.new('Oval chest patch');me.from_pydata(vs,[],fs);me.update();bib=bpy.data.objects.new('Pale oval chest bib',me);bpy.context.collection.objects.link(bib);me.materials.append(pale)
uv=me.uv_layers.new(name='Chest UV')
for face in me.polygons:
 face.use_smooth=True
 for li in face.loop_indices:uv.data[li].uv=uvs[me.loops[li].vertex_index]
bpy.context.view_layer.objects.active=bib
su=bib.modifiers.new('Smooth chest patch','SUBSURF');su.levels=2;bpy.ops.object.modifier_apply(modifier=su.name)
# Reproject after subdivision: interpolation across the neck/shoulder curve clips.
for v in bib.data.vertices:
 hit,location,normal,index=body.ray_cast(inverse@Vector((v.co.x,-5,v.co.z)),direction)
 if hit:
  p=body.matrix_world@location;p.y-=.025;v.co=p

ell('Pale belly chest bib',(0,.17,.697),(.37,.82,.044),pale,True)
# Bake each coat object's spatial pattern without altering separate deform groups.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1;scene.render.bake.margin=12
coat_objects=[o for o in scene.objects if o.type=='MESH' and gold in list(o.data.materials)]
for o in coat_objects:
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
 vor.inputs['Scale'].default_value=13.5 if o==head or 'eyelid' in o.name or 'muzzle' in o.name else 9
 resolution=2048 if o==head else 1024 if o==body else 512
 img=bpy.data.images.new('Baola rosette coat '+o.name,width=resolution,height=resolution)
 tex=nt.nodes.new('ShaderNodeTexImage');tex.image=img;nt.nodes.active=tex
 bpy.ops.object.bake(type='EMIT');img.pack();o['coat_image']=img.name
 nt.nodes.remove(tex)
# Per-object materials share fur normal detail but use their own baked pigment.
nt.links.new(coat_bsdf.outputs[0],out.inputs['Surface'])
for o in coat_objects:
 mat=gold.copy();mat.name='Embedded leopard skin '+o.name
 texture=mat.node_tree.nodes.new('ShaderNodeTexImage');texture.image=bpy.data.images[o['coat_image']]
 mat.node_tree.links.new(texture.outputs['Color'],mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color']);o.data.materials.clear();o.data.materials.append(mat)
# Fine surface fibers follow the actual baked coat UV instead of random pigment.
for surface in [body,head,bib]:
 surface.data.update();uv_by_vertex={}
 for polygon in surface.data.polygons:
  for li in polygon.loop_indices:uv_by_vertex[surface.data.loops[li].vertex_index]=tuple(surface.data.uv_layers.active.data[li].uv)
 vertices=list(surface.data.vertices);random.shuffle(vertices);vs=[];fs=[];uvs=[]
 for vertex in vertices[:2200 if surface!=bib else 500]:
  n=vertex.normal.normalized();p=surface.matrix_world@vertex.co;flow=Vector((0,.3,-1));flow-=n*flow.dot(n)
  if flow.length<.1:flow=n.cross(Vector((1,0,0)))
  flow.normalize();w=n.cross(flow).normalized();a=p+n*.001;b=a+flow*random.uniform(.012,.023)+n*.002
  width=random.uniform(.001,.002);base=len(vs);vs.extend([tuple(a-w*width),tuple(a+w*width),tuple((a+b)*.5+n*.002),tuple(b)])
  fs.extend([(base,base+1,base+2),(base+1,base+3,base+2),(base+3,base,base+2)]);uvs.extend([uv_by_vertex.get(vertex.index,(0,0))]*4)
 me=bpy.data.meshes.new('Baola fine fur');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new('Baola fine short fur '+surface.name,me);bpy.context.collection.objects.link(o);me.materials.append(surface.data.materials[0]);uv=me.uv_layers.new(name='Matching coat pigment')
 for polygon in me.polygons:
  for li in polygon.loop_indices:uv.data[li].uv=uvs[me.loops[li].vertex_index]
model=[o for o in scene.objects if o.type=='MESH'];bpy.ops.object.select_all(action='DESELECT')
for o in model:o.select_set(True)
bpy.context.view_layer.objects.active=model[0]
bpy.ops.wm.save_as_mainfile(filepath=str(SRC/'baola-leopard.blend'))
tri=sum(len(p.vertices)-2 for o in model for p in o.data.polygons)
(OUT/'stats.json').write_text(json.dumps({'triangles':tri,'mesh_objects':len(model),'pose':'quadruped','embedded_coat_images':len(coat_objects),'reference':'assets-source/baola-leopard/reference.png'},indent=2))
# Studio evidence only; saved source and exports exclude these objects.
floor=material('Neutral studio',(.22,.25,.21));bpy.ops.mesh.primitive_plane_add(size=200);bpy.context.object.data.materials.append(floor)
scene.cycles.samples=24;scene.world.color=(.30,.30,.30)
def area(loc,power,size):
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1.4))-o.location).to_track_quat('-Z','Y').to_euler()
area((-3,-4,6),500,5);area((4,-2,4),300,4);area((1,4,5),600,3)
bpy.ops.object.camera_add();cam=bpy.context.object;scene.camera=cam;cam.data.type='ORTHO'
scene.render.resolution_x=900;scene.render.resolution_y=850;scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=-.35
for name,pos,target in [('three-quarter',(4,-6,3.2),(0,.15,1.35)),('front',(0,-7,2.8),(0,-.35,1.40)),('side',(7,-.15,2.9),(0,.45,1.4)),('face-detail',(.3,-7,2.5),(0,-1.15,2.08))]:
 if '--face-only' in sys.argv and name!='face-detail':continue
 cam.data.ortho_scale=1.75 if name=='face-detail' else 4.9;cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
print('BAOLA_COMPLETE',tri)
