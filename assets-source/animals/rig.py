"""Non-destructive locomotion/facial rig derived from the approved static cow."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from feet import enhance_feet, leg_bones, distal_weights, mesh_weights
ID=sys.argv[sys.argv.index('--')+1]
ROOT=Path(__file__).resolve().parents[2]
SRC=ROOT/'assets-source'/ID
DEST=ROOT/'src/assets/models'/ID
OUT=ROOT/'output'/ID/'rigged'
PROFILE=json.loads((ROOT/'assets-source/animals/rig-profiles.json').read_text())[ID]
WOLF=PROFILE['species']=='wolf'
UNIT=PROFILE['unit']
# Coordinates are before the source-model uniform shrink; weight lookup reverses UNIT.
LEG_X=PROFILE['legX']
FRONT_Y=PROFILE['frontY']
BACK_Y=PROFILE['backY']
EYE_Z=PROFILE['eyeZ']
TAIL=PROFILE['tail']
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SRC/(ID+'.blend')))
enhance_feet(PROFILE)
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
bpy.ops.object.select_all(action='DESELECT')
data=bpy.data.armatures.new('Shared quadruped locomotion and expression skeleton')
rig=bpy.data.objects.new(ID.replace('-','_')+'Rig',data);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
def bone(name,head,tail,parent=None):
 b=data.edit_bones.new(name);b.head=Vector(head)*UNIT;b.tail=Vector(tail)*UNIT
 if parent:b.parent=data.edit_bones[parent]
 return b
bone('Root',(0,0,0),(0,0,.35))
bone('Body',(0,.2,1.1),(0,.2,1.6),'Root')
bone('Neck',(0,-.48,1.48),(0,-.86,1.72),'Body')
bone('Head',(0,-.86,1.72),(0,-1.28,2.12),'Neck')
bone('Jaw',(0,-1.64,1.55),(0,-1.98,1.40),'Head')
bone('Tail',TAIL[0],TAIL[1],'Body')
bone('Tail_Mid',TAIL[1],TAIL[2],'Tail')
bone('Tail_Tip',TAIL[2],TAIL[3],'Tail_Mid')
legs=[]
for side,x in [('L',-LEG_X),('R',LEG_X)]:
 for end,y in [('F',FRONT_Y),('H',BACK_Y)]:
  name=end+side;legs.append((name,x,y))
  leg_bones(bone,PROFILE,name,x,y)
for side,x in [('L',-.46 if WOLF else -.69),('R',.46 if WOLF else .69)]:
 bone('Ear_'+side,(x,-.80,2.30) if WOLF else (x*.82,-1.13,2.24),(x,-.80,2.60) if WOLF else (x*1.22,-1.13,2.24),'Head')
bpy.ops.object.mode_set(mode='OBJECT')
def smooth(a,b,x):
 t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def coat_weights(p):
 distal=distal_weights(p,PROFILE,legs)
 if distal is not None:return distal
 x,y,z=p;best=None;amount=0
 if WOLF and z<.32:
  # The fused paws extend well ahead of their hips. Never leave their toes on Body.
  name=min(legs,key=lambda leg:(x-leg[1])**2+(y-(.96 if leg[0][0]=='H' else -.83))**2)[0]
  foot=1-smooth(.20,.32,z)
  return {name+'_Hoof':foot,name+'_Lower':1-foot}
 for name,lx,ly in legs:
  # Broad blend at the shoulder/hip, rigid below the knee.
  lateral=1-smooth(.16,.36,abs(x-lx))
  along=1-smooth(.22,.43,abs(y-ly))
  w=lateral*along*(1-smooth(.83,1.22,z))
  if w>amount:best=name;amount=w
 neck=(1-smooth(-.90,-.35,y))*smooth(1.1,1.65,z)
 if not best or amount<.001:return {'Body':1-neck,'Neck':neck}
 lower=1-smooth(.40 if WOLF else .46,.72 if WOLF else .69,z)
 return {'Body':(1-amount)*(1-neck),'Neck':(1-amount)*neck,best+'_Upper':amount*(1-lower),best+'_Lower':amount*lower}
def muzzle_weights(p):
 lower=1-smooth(*PROFILE['muzzleBlend'],p.z)
 return {'Head':1-lower,'Jaw':lower}
for o in meshes:
 label=o.name
 groups={name:o.vertex_groups.new(name=name) for name in data.bones.keys()}
 fur_weights={}
 if 'fur tufts' in label or 'Wolf fine short fur' in label:
  # Source stores 3500 four-vertex tufts for body, then 3500 for head.
  # Keep each tuft on the same skin weights so it cannot stretch across a joint.
  for i in range(0,len(o.data.vertices),4):
   center=sum((o.matrix_world@v.co for v in o.data.vertices[i:i+4]),Vector())/(4*UNIT)
   fur_weights[i//4]=(coat_weights(center) if ('body' in label or 'bib' in label) else muzzle_weights(center) if 'muzzle' in label else {'Head':1}) if WOLF else ({'Head':1} if i>=len(o.data.vertices)//2 else coat_weights(center))
 for v in o.data.vertices:
  p=(o.matrix_world@v.co)/UNIT
  if o.get('foot_leg'):w=mesh_weights(o,p,PROFILE)
  elif 'fur tufts' in label or 'Wolf fine short fur' in label:w=fur_weights[v.index//4]
  elif 'body and four legs' in label or label=='Continuous horizontal wolf body' or 'chest bib' in label.lower():w=coat_weights(p)
  elif 'hoof' in label.lower() or 'paw toe' in label.lower():
   name=min(legs,key=lambda leg:(p.x-leg[1])**2+(p.y-leg[2])**2)[0];w={name+'_Hoof':1}
  elif 'tail' in label.lower():
   if 'tuft' in label.lower():w={'Tail_Tip':1}
   else:
    base=smooth(TAIL[1][2]-.12,TAIL[0][2]-.05,p.z);middle=smooth(TAIL[2][2]-.11,TAIL[2][2]+.11,p.z)
    w={'Tail':base,'Tail_Mid':(1-base)*middle,'Tail_Tip':(1-base)*(1-middle)}
  elif 'ear' in label.lower():w={'Ear_'+('L' if p.x<0 else 'R'):1}
  elif 'muzzle' in label.lower():w=muzzle_weights(p)
  elif label.startswith(('Lower lip','Lower muzzle','Soft mouth','Thick lower lip','Straight soft calf mouth','Thin pale lower mouth','Black smiling mouth')):w={'Jaw':1}
  else:w={'Head':1}
  for name,weight in w.items():
   if weight>.00001:groups[name].add([v.index],weight,'REPLACE')
 modifier=o.modifiers.new('Animal deform skeleton','ARMATURE');modifier.object=rig
 o.parent=rig
 # Eye surfaces contract into a closed line; eyelids slide over the gap.
 if any(part in label for part in ['eye white','teal pupil','upper eyelid','narrow eye','vertical pupil','eye catchlight']):
  o.shape_key_add(name='Basis');key=o.shape_key_add(name='Blink')
  inv=o.matrix_world.inverted();eye_z=EYE_Z*UNIT
  for v in key.data:
   p=o.matrix_world@v.co
   if 'upper eyelid' in label:p.z-=.040*UNIT
   else:p.z=eye_z+(p.z-eye_z)*.05
   v.co=inv@p
  if 'pupil' in label or 'catchlight' in label:
   for name,shift in [('GazeLeft',-.025),('GazeRight',.025)]:
    gaze=o.shape_key_add(name=name)
    for v in gaze.data:
     p=o.matrix_world@v.co;p.x+=shift*UNIT;v.co=inv@p
rig['animation_controller']='src/animal-animation.js: planted-foot IK, distance-driven four-beat walk, facial bones, Blink morph'
bpy.ops.object.select_all(action='DESELECT')
for o in meshes+[rig]:o.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(SRC/(ID+'-rigged.blend')))
bpy.ops.export_scene.gltf(filepath=str(DEST/(ID+'-rigged.glb')),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_morph=True,export_skins=True)
(OUT/'validation.json').write_text(json.dumps({'bones':len(data.bones),'skinned_meshes':len(meshes),'blink_meshes':sum(bool(o.data.shape_keys) for o in meshes),'asset_bytes':(DEST/(ID+'-rigged.glb')).stat().st_size,'static_source_preserved':True},indent=2))
print('RIG_VALIDATION', (OUT/'validation.json').read_text())
