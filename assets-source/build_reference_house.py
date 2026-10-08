"""Independent house reference study. Does NOT overwrite driving-scene assets.
Blender 5.2+: blender --background --python assets-source/build_reference_house.py
Coordinates: Blender Z up, facade toward -Y (GLB front is +Z).
Original geometry and deterministic procedural color textures, standard glTF PBR.
"""
import bpy, math, random, json, time
from mathutils import Vector
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'src/assets/studies';SOURCE=ROOT/'assets-source/studies'
OUT.mkdir(parents=True,exist_ok=True);SOURCE.mkdir(parents=True,exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
rng=random.Random(20261002);METADATA=[]
def clear():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def texture(name,base,kind):
 size=512;image=bpy.data.images.new(name,width=size,height=size);pixels=[];rr=random.Random(391)
 for y in range(size):
  for x in range(size):
   u=x/size;v=y/size
   if kind=='wood':
    # Low contrast longitudinal grain: U across fibre, V along fibre.
    broad=math.sin(u*5.1)*.008+math.sin(v*3.8)*.005
    broad+=math.sin(u*37+.16*math.sin(v*3))*.0035+math.sin(u*81+.12*math.sin(v*7))*.0018
   elif kind=='plaster':
    broad=math.sin(u*6.5)*math.cos(v*4.1)*.009+math.sin(v*2.8+u)*.005
    broad-=.038*math.exp(-(1-v)/.095)
   elif kind=='tile':
    broad=math.sin(u*5.2+v*2.1)*.002+math.cos(v*3)*.001
   elif kind=='glass':
    broad=(v-.5)*.025+math.cos(u*math.pi*2)*.009
   else:
    broad=math.sin(u*8)*math.cos(v*6.5)*.010+math.sin(u*31+v*21)*.004
   fleck=(rr.random()-.5)*.002
   linear=[max(.005,min(.95,c+broad+fleck)) for c in base]
   pixels.extend([12.92*c if c<=.0031308 else 1.055*c**(1/2.4)-.055 for c in linear]+[1.])
 image.pixels.foreach_set(pixels);image.filepath_raw=str(SOURCE/(name+'.png'));image.file_format='PNG';image.save();image.pack();return image
def mat(name,color,rough=.85,kind=None,vertex=False,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 if kind:
  tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=texture(name,color,kind);m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
 if vertex:
  vc=m.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Paint';m.node_tree.links.new(vc.outputs['Color'],p.inputs['Base Color'])
 m.use_backface_culling=False;return m
def mesh(name,verts,faces,material,colors=None,uv=None,smooth=False):
 data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update();o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);data.materials.append(material)
 for p in data.polygons:p.use_smooth=smooth
 if colors:
  attr=data.color_attributes.new(name='Paint',type='FLOAT_COLOR',domain='CORNER')
  for p in data.polygons:
   for index in p.loop_indices:attr.data[index].color=(*colors[data.loops[index].vertex_index],1)
 if uv:
  layer=data.uv_layers.new(name='UVMap')
  for p in data.polygons:
   for index in p.loop_indices:layer.data[index].uv=uv[data.loops[index].vertex_index]
 return o
def cube(name,loc,scale,material,bevel=.015):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
 if bevel:
  mod=o.modifiers.new('Subtle worn edges','BEVEL');mod.width=bevel;mod.segments=2;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 # Explicit face UVs remove rotated cube unwrap patterns; fibre follows each member.
 if 'timber' in material.name.lower() or 'plaster' in material.name.lower():
  layer=o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
  bounds=[(min(v.co[k] for v in o.data.vertices),max(v.co[k] for v in o.data.vertices)) for k in range(3)]
  for face in o.data.polygons:
   axes=[k for k in range(3) if k!=max(range(3),key=lambda k:abs(face.normal[k]))]
   vertical=2 if 'plaster' in material.name.lower() and 2 in axes else max(axes,key=lambda k:scale[k])
   horizontal=next(k for k in axes if k!=vertical)
   for li in face.loop_indices:
    co=o.data.vertices[o.data.loops[li].vertex_index].co
    layer.data[li].uv=((co[horizontal]-bounds[horizontal][0])/max(.001,bounds[horizontal][1]-bounds[horizontal][0]),(co[vertical]-bounds[vertical][0])/max(.001,bounds[vertical][1]-bounds[vertical][0]))
 return o
def tube(name,points,radii,material,n=12,paint=False):
 verts=[];uv=[];colors=[]
 for j,p in enumerate(points):
  p=Vector(p);direction=Vector(points[min(j+1,len(points)-1)])-Vector(points[max(0,j-1)]);direction.normalize();axis=direction.cross(Vector((0,1,0)))
  if axis.length<.001:axis=direction.cross(Vector((1,0,0)))
  axis.normalize();second=direction.cross(axis).normalized()
  for i in range(n):
   a=i/n*math.tau;rad=radii[j]*(1+.065*math.sin(i*2.1+j*.6));v=p+(axis*math.cos(a)+second*math.sin(a))*rad;verts.append(v);uv.append((i/n,j/max(1,len(points)-1)*2))
   if paint:
    value=.028*math.sin(i*1.8+j*.7);colors.append((.30+value,.23+value*.9,.135+value*.7))
 faces=[]
 for j in range(len(points)-1):
  for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 faces.extend([tuple(reversed(range(n))),tuple((len(points)-1)*n+i for i in range(n))]);return mesh(name,verts,faces,material,colors if paint else None,uv,smooth=True)
def beam(name,a,b,width,depth,material):
 a=Vector(a);b=Vector(b);o=cube(name,(a+b)*.5,(width,depth,(b-a).length),material,.018);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
def rock(name,loc,scale,material,seed=1):
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=loc);o=bpy.context.object;o.name=name;o.scale=scale
 rr=random.Random(seed)
 for v in o.data.vertices:v.co*=.86+rr.random()*.25
 o.data.materials.append(material);return o
def join_materials():
 groups={}
 for o in list(bpy.context.scene.objects):
  if o.type=='MESH' and len(o.data.materials)==1:groups.setdefault(o.data.materials[0].name,[]).append(o)
 for name,objects in groups.items():
  if len(objects)<2:continue
  bpy.ops.object.select_all(action='DESELECT')
  for o in objects:o.select_set(True)
  bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();bpy.context.object.name=name.replace(' ','_')
def save(name,label):
 join_materials();bpy.context.view_layer.update();objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];coords=[o.matrix_world@v.co for o in objects for v in o.data.vertices];minimum=[min(c[i] for c in coords) for i in range(3)];maximum=[max(c[i] for c in coords) for i in range(3)];tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects)
 bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(name+'.blend')))
 bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False,export_texcoords=True,export_normals=True)
 METADATA.append({'id':name,'label':label,'dimensionsBlender':[round(maximum[i]-minimum[i],3) for i in range(3)],'triangles':tris,'meshObjects':len(objects),'meshGroups':sum(len(o.data.materials) for o in objects),'source':f'assets-source/studies/{name}.blend','glb':f'src/assets/studies/{name}.glb','front':'Blender -Y / glTF +Z','textures':'Original deterministic baked color maps; glTF standard PBR.'})

# 02: one storey, tall gable, asymmetric entrance canopy, timber wainscot.
clear();rng.seed(102)
plaster=mat('House warm lime plaster',(.76,.70,.58),kind='plaster');timber=mat('House aged warm timber',(.25,.135,.059),kind='wood');lightwood=mat('House cut timber',(.35,.215,.11),kind='wood');tiles=mat('House slate blue ceramic',(.085,.12,.17),kind='tile');tile_edge=mat('House tile underside',(.062,.095,.135));stone=mat('House foundation stone',(.36,.37,.31),kind='stone');glass=mat('House muted blue window glass',(.26,.28,.30),rough=.35,metal=.02,kind='glass');dark=mat('House interior shade',(.055,.044,.026))
W=4.6;D=4.7;EAVE=3.35;RIDGE=5.12;FLOOR=.42
cube('Continuous stone footing',(0,0,.19),(4.9,5,.38),stone,.025)
for row in range(2):
 z=.12+row*.19
 for side in [-1,1]:
  for i in range(9):cube('Foundation side block',(side*2.43,-2.29+i*.56+(row%2)*.12,z),(.24,.53,.18),stone,.037)
  for i in range(8):cube('Foundation facade block',(-2.21+i*.59+(row%2)*.12,side*2.48,z),(.56,.23,.18),stone,.035)
wall=cube('Wall volume',(0,0,(FLOOR+EAVE)*.5),(W,D,EAVE-FLOOR),plaster,.02)
for y in [-D/2-.005,D/2+.005]:mesh('Plaster gable',[(-W/2,y,EAVE),(W/2,y,EAVE),(0,y,RIDGE-.13)],[(0,1,2)] if y<0 else [(2,1,0)],plaster,uv=[(0,0),(1,0),(.5,1)])
# Wood lower walls: actual separate vertical planks, not printed wall lines.
for side in [-1,1]:
 for i in range(23):cube('Side lower siding',(side*2.318,-2.28+i*.207,.91),(.055,.197,.97),timber,.006)
 for i in range(22):cube('Front and rear lower siding',(-2.22+i*.211,side*2.371,.91),(.200,.055,.97),timber,.006)
 for x in [-2.24,0,2.24]:cube('Facade main post',(x,side*2.398,1.9),(.15,.16,2.95),timber,.015)
 for z in [.47,1.45,2.93,3.29]:cube('Facade horizontal beam',(0,side*2.40,z),(4.62,.17,.14),timber,.012)
 for y in [-2.24,0,2.24]:cube('Side main post',(side*2.349,y,1.9),(.16,.15,2.95),timber,.012)
 for z in [1.45,2.93,3.29]:cube('Side longitudinal beam',(side*2.348,0,z),(.16,4.72,.14),timber,.012)
# Gable timbers, ridge support, and dark ventilation grille.
for side in [-1,1]:
 y=side*2.42
 cube('Gable king post',(0,y,4.12),(.16,.14,1.48),timber)
 beam('Gable diagonal bar',(-2.32,y,3.33),(0,y,5.05),.14,.18,lightwood);beam('Gable diagonal bar',(0,y,5.05),(2.32,y,3.33),.14,.18,lightwood)
 cube('Gable vent dark recess',(0,y+side*.025,4.02),(.60,.055,.63),dark)
 for x in [-.31,.31]:cube('Vent jamb',(x,y+side*.058,4.02),(.07,.07,.69),lightwood)
 for x in [-.23,-.115,0,.115,.23]:cube('Vent slat',(x,y+side*.069,4.02),(.042,.08,.59),timber,.004)
# Window opening details: front small window, long-wall broad window, two back windows.
def window(name,cx,cy,cz,width,height,side_wall=False):
 group=[]
 def piece(label,u,depth,z,w,d,h,material,bevel=.008):
  loc=(cx+depth,cy+u,cz+z) if side_wall else (cx+u,cy+depth,cz+z);scale=(d,w,h) if side_wall else (w,d,h);group.append(cube(name+' '+label,loc,scale,material,bevel))
 sign=(1 if cx>0 else -1) if side_wall else (1 if cy>0 else -1)
 # Cut a real recess into the wall; opaque glass sits inside the reveal.
 loc=(cx-sign*.13,cy,cz) if side_wall else (cx,cy-sign*.13,cz)
 dims=(.42,width-.08,height-.08) if side_wall else (width-.08,.42,height-.08)
 cutter=cube('Temporary window recess cutter',loc,dims,dark,0)
 bpy.context.view_layer.objects.active=wall
 mod=wall.modifiers.new('True recessed window','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cutter
 bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
 piece('recess backing',0,-.285*sign,0,width-.07,.018,height-.07,dark,0)
 piece('glass',0,-.18*sign,0,width-.13,.025,height-.13,glass,.003)
 for u in [-width/2,width/2]:piece('thick jamb',u,-.025*sign,0,.11,.33,height+.16,timber)
 for z in [-height/2,height/2]:piece('deep sill',0,-.015*sign,z,width+.19,.35,.10,lightwood)
 for i in range(1,4):piece('mullion',-width/2+i*width/4,-.12*sign,0,.045,.10,height-.04,timber,.005)
 piece('middle rail',0,-.105*sign,0,width-.04,.10,.052,timber,.005)
window('Front right window',1.20,-2.41,2.05,1.35,1.12)
window('Right side window',2.36,.10,2.03,2.50,1.12,True)
for x in [-1.15,1.15]:window('Back window',x,2.41,2.00,1.06,1.00)
# Left wall has a modest rear window, kept structurally consistent where unseen.
window('Left wall window',-2.36,.95,2.08,1.10,1.10,True)
# Door left of front centre, three dimensional lattice with a dark interior behind it.
DX=-.95
cube('Door recessed backing',(DX,-2.40,1.61),(1.20,.07,2.23),dark)
for x in [DX-.63,DX+.63]:cube('Door jamb',(x,-2.49,1.62),(.13,.16,2.32),lightwood)
for z in [.51,2.73]:cube('Door top and bottom',(DX,-2.50,z),(1.38,.14,.13),timber)
for i in range(11):cube('Door vertical lattice',(DX-.53+i*.106,-2.52,1.6),(.038,.065,2.07),timber,.004)
for z in [.89,1.40,1.91,2.40]:cube('Door lattice rail',(DX,-2.55,z),(1.17,.045,.043),lightwood,.004)
cube('Door threshold',(DX,-2.62,.46),(1.43,.40,.09),lightwood,.012)
# Main roof actual curved tile meshes, with eave overhang and sculpted ridge caps.
XEDGE=2.75;YEDGE=2.72;SLOPE=(RIDGE-EAVE)/2.42
for side in [-1,1]:
 verts=[(0,-YEDGE,RIDGE),(side*XEDGE,-YEDGE,RIDGE-XEDGE*SLOPE),(side*XEDGE,YEDGE,RIDGE-XEDGE*SLOPE),(0,YEDGE,RIDGE)]
 mesh('Roof solid underside',verts,[(0,1,2,3)] if side>0 else [(3,2,1,0)],tile_edge)
 beam('Eave fascia',(side*XEDGE,-YEDGE,RIDGE-XEDGE*SLOPE-.045),(side*XEDGE,YEDGE,RIDGE-XEDGE*SLOPE-.045),.19,.21,timber)
 for end in [-1,1]:beam('Gable fascia',(0,end*YEDGE,RIDGE-.04),(side*XEDGE,end*YEDGE,RIDGE-XEDGE*SLOPE-.04),.18,.22,timber)
 for j in range(20):
  yy=-YEDGE+.12+j*.29
  for i in range(7):
   start=.02+i*.397;end=min(XEDGE,start+.43);v=[];uv=[]
   y0=max(-YEDGE,-YEDGE+j*.29-(.145 if i%2 else 0));y1=min(YEDGE,-YEDGE+(j+1)*.29-(.145 if i%2 else 0))
   if y1<=y0:continue
   y0+=.004;y1-=.004
   for row in range(2):
    x=start+(end-start)*row
    for k in range(5):
     y=y0+(y1-y0)*k/4;z=RIDGE-x*SLOPE+.036+math.sin(k/4*math.pi)*.006+row*.045;v.append((side*x,y,z));uv.append((k/4*.45+(j%3)*.17,row*.45+(i%3)*.17))
   faces=[(k,k+1,k+6,k+5) for k in range(4)];faces=[tuple(reversed(f)) for f in faces] if side>0 else faces
   v.extend([(x,y,z-.042) for x,y,z in list(v)]);uv.extend(list(uv))
   boundary=[0,1,2,3,4,9,8,7,6,5]
   for k in range(len(boundary)):
    a=boundary[k];b=boundary[(k+1)%len(boundary)];faces.append((a,b,b+10,a+10))
   mesh('Individual ceramic tile',v,faces,tiles,uv=uv)
 # Visible small rafters underneath the overhang.
 for j in range(12):
  y=-2.58+j*.47;beam('Eave rafter',(side*2.17,y,EAVE+.09),(side*2.69,y,EAVE-.23),.10,.09,lightwood)
for j in range(20):
 y=-2.72+j*.284;v=[]
 for yy in [y,y+.27]:
  for i in range(9):a=i/8*math.pi;v.append((math.cos(a)*.115,yy,RIDGE+math.sin(a)*.115+.01))
 mesh('Ridge cap',v,[(i,i+1,i+10,i+9) for i in range(8)],tiles,uv=[(i%9/8,i//9) for i in range(18)])
for y in [-2.77,2.82]:cube('Ridge finial',(0,y,RIDGE+.14),(.22,.12,.39),tiles,.095)
# Entrance lean-to: clearly lower and only over the left portion.
PW=2.35;PX=-.96;BACK=-2.33;FRONT=-3.32
verts=[(PX-PW/2,BACK,3.15),(PX+PW/2,BACK,3.15),(PX+PW/2,FRONT,2.87),(PX-PW/2,FRONT,2.87)]
mesh('Porch roof base',verts,[(3,2,1,0)],tile_edge)
for row in range(3):
 yy=BACK-(row+.5)*.33;zz=3.15+(yy-BACK)*.283
 for col in range(9):
  o=cube('Porch ceramic tile',(PX-PW/2+.13+col*.265,yy,zz+.034),(.257,.36,.05),tiles,.014);o.rotation_euler.x=math.atan(.283)
beam('Porch front fascia',(PX-PW/2,FRONT,2.81),(PX+PW/2,FRONT,2.81),.13,.16,timber)
for x in [PX-PW/2+.10,PX+PW/2-.10]:
 cube('Porch post',(x,-3.18,1.59),(.15,.15,2.33),lightwood,.018);cube('Porch stone post foot',(x,-3.18,.44),(.29,.29,.20),stone,.035)
for j in range(7):beam('Porch rafter',(PX-PW/2+.17+j*.32,-2.35,3.06),(PX-PW/2+.17+j*.32,-3.35,2.78),.075,.075,lightwood)
for step in range(2):
 width=1.65+step*.19;y=-2.89-step*.49;top=.42-step*.16
 cube('Entrance step',(DX,y,top*.5),(width,.65,top),stone,.038)
 for i in range(4):cube('Step separate stones',(DX-width*.5+.21+i*width/4,y-.25,top-.085),(width/4-.025,.23,.16),stone,.034)
save('reference-house','乡间住宅 · 单层高山墙')


(SOURCE/'manifest.json').write_text(json.dumps(METADATA,ensure_ascii=False,indent=2))
print('HOUSE_READY',METADATA)
