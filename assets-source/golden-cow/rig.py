"""Non-destructive locomotion/facial rig derived from the approved static cow."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'animals'))
from feet import enhance_feet, leg_bones, distal_weights, mesh_weights
PROFILE={'species':'cow','unit':1,'legX':.46,'frontY':-.56,'backY':1.04}
SRC=Path(__file__).resolve().parent
ROOT=SRC.parents[1]
DEST=ROOT/'src/assets/models/golden-cow'
OUT=ROOT/'output/golden-cow/rigged'
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SRC/'golden-cow.blend'))
enhance_feet(PROFILE)
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
bpy.ops.object.select_all(action='DESELECT')
data=bpy.data.armatures.new('Golden cow locomotion and expression skeleton')
rig=bpy.data.objects.new('GoldenCowRig',data);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
def bone(name,head,tail,parent=None):
 b=data.edit_bones.new(name);b.head=head;b.tail=tail
 if parent:b.parent=data.edit_bones[parent]
 return b
bone('Root',(0,0,0),(0,0,.35))
bone('Body',(0,.2,1.1),(0,.2,1.6),'Root')
bone('Neck',(0,-.48,1.48),(0,-.86,1.72),'Body')
bone('Head',(0,-.86,1.72),(0,-1.28,2.12),'Neck')
bone('Jaw',(0,-1.64,1.55),(0,-1.98,1.40),'Head')
bone('Tail',(0,1.44,1.55),(.10,1.71,1.43),'Body')
bone('Tail_Mid',(.10,1.71,1.43),(.22,1.84,.97),'Tail')
bone('Tail_Tip',(.22,1.84,.97),(.25,1.86,.48),'Tail_Mid')
legs=[]
for side,x in [('L',-.46),('R',.46)]:
 for end,y in [('F',-.56),('H',1.04)]:
  name=end+side;legs.append((name,x,y))
  leg_bones(bone,PROFILE,name,x,y)
for side,x in [('L',-.69),('R',.69)]:
 bone('Ear_'+side,(x*.82,-1.13,2.24),(x*1.22,-1.13,2.24),'Head')
bpy.ops.object.mode_set(mode='OBJECT')
def smooth(a,b,x):
 t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def coat_weights(p):
 distal=distal_weights(p,PROFILE,legs)
 if distal is not None:return distal
 x,y,z=p;best=None;amount=0
 for name,lx,ly in legs:
  # Broad blend at the shoulder/hip, rigid below the knee.
  lateral=1-smooth(.16,.36,abs(x-lx))
  along=1-smooth(.22,.43,abs(y-ly))
  w=lateral*along*(1-smooth(.83,1.22,z))
  if w>amount:best=name;amount=w
 neck=(1-smooth(-.90,-.35,y))*smooth(1.1,1.65,z)
 if not best or amount<.001:return {'Body':1-neck,'Neck':neck}
 lower=1-smooth(.46,.69,z)
 return {'Body':(1-amount)*(1-neck),'Neck':(1-amount)*neck,best+'_Upper':amount*(1-lower),best+'_Lower':amount*lower}
for o in meshes:
 label=o.name
 groups={name:o.vertex_groups.new(name=name) for name in data.bones.keys()}
 fur_weights={}
 if 'fur tufts' in label:
  # Source stores 3500 four-vertex tufts for body, then 3500 for head.
  # Keep each tuft on the same skin weights so it cannot stretch across a joint.
  for i in range(0,len(o.data.vertices),4):
   center=sum((o.matrix_world@v.co for v in o.data.vertices[i:i+4]),Vector())/4
   fur_weights[i//4]={'Head':1} if i>=len(o.data.vertices)//2 else coat_weights(center)
 for v in o.data.vertices:
  p=o.matrix_world@v.co
  if o.get('foot_leg'):w=mesh_weights(o,p,PROFILE)
  elif 'body and four legs' in label:w=coat_weights(p)
  elif 'fur tufts' in label:w=fur_weights[v.index//4]
  elif 'hoof' in label.lower():
   name=min(legs,key=lambda leg:(p.x-leg[1])**2+(p.y-leg[2])**2)[0];w={name+'_Hoof':1}
  elif 'tail' in label.lower():
   if 'tuft' in label.lower():w={'Tail_Tip':1}
   else:
    base=smooth(1.31,1.50,p.z);middle=smooth(.86,1.08,p.z)
    w={'Tail':base,'Tail_Mid':(1-base)*middle,'Tail_Tip':(1-base)*(1-middle)}
  elif 'ear' in label.lower():w={'Ear_'+('L' if p.x<0 else 'R'):1}
  elif 'ivory muzzle' in label:
   lower=1-smooth(1.43,1.63,p.z);w={'Head':1-lower,'Jaw':lower}
  elif label.startswith(('Lower lip','Lower muzzle','Soft mouth')):w={'Jaw':1}
  else:w={'Head':1}
  for name,weight in w.items():
   if weight>.00001:groups[name].add([v.index],weight,'REPLACE')
 modifier=o.modifiers.new('Golden cow deform skeleton','ARMATURE');modifier.object=rig
 o.parent=rig
 # Eye surfaces contract into a closed line; eyelids slide over the gap.
 if any(part in label for part in ['eye white','teal pupil','upper eyelid']):
  o.shape_key_add(name='Basis');key=o.shape_key_add(name='Blink')
  inv=o.matrix_world.inverted();eye_z=2.10
  for v in key.data:
   p=o.matrix_world@v.co
   if 'upper eyelid' in label:p.z-=.040
   else:p.z=eye_z+(p.z-eye_z)*.05
   v.co=inv@p
  if 'teal pupil' in label:
   for name,shift in [('GazeLeft',-.025),('GazeRight',.025)]:
    gaze=o.shape_key_add(name=name)
    for v in gaze.data:
     p=o.matrix_world@v.co;p.x+=shift;v.co=inv@p
rig['animation_controller']='src/animal-animation.js: planted-foot IK, distance-driven four-beat walk, facial bones, Blink morph'
bpy.ops.object.select_all(action='DESELECT')
for o in meshes+[rig]:o.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(SRC/'golden-cow-rigged.blend'))
bpy.ops.export_scene.gltf(filepath=str(DEST/'golden-cow-rigged.glb'),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_morph=True,export_skins=True)
(OUT/'validation.json').write_text(json.dumps({'bones':len(data.bones),'skinned_meshes':len(meshes),'blink_meshes':sum(bool(o.data.shape_keys) for o in meshes),'asset_bytes':(DEST/'golden-cow-rigged.glb').stat().st_size,'static_source_preserved':True},indent=2))
print('RIG_VALIDATION', (OUT/'validation.json').read_text())
