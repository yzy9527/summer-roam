"""One original anime background tree. Blender metres, Z up, root at origin.

Build + inspect the major masses in front first:
  Blender --background --python scripts/generate_anime_tree.py -- --front-only
After the front composition passes, render the saved model from three angles:
  Blender --background --python scripts/generate_anime_tree.py -- --render-views
Only after reviewing all three renders, export and reimport:
  Blender --background --python scripts/generate_anime_tree.py -- --export
"""
import bpy
import bmesh
import math
import random
import json
import sys
import hashlib
from array import array
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / 'blender/anime_tree.blend'
GLB = ROOT / 'assets/anime_tree.glb'
RENDERS = ROOT / 'renders'
REPORT = RENDERS / 'tree_stats.json'
BARK_TEXTURE = ROOT / 'assets/textures/anime_bark.png'
BARK_REPEAT_METRES = .8
ORIGINAL_FOLIAGE_PALETTE = ['#176D73','#259D87','#48C47A','#78D96D','#9BE85F','#B7EF63']
# Use the roadside tree's subdued yellow-green pigment as the colour reference.
FOLIAGE_PALETTE = ['#2F5941','#466F49','#628C42','#789E4A','#8DAA54','#A6B965']
SEED = 48137
for directory in (BLEND.parent, GLB.parent, RENDERS):
    directory.mkdir(parents=True, exist_ok=True)

def srgb(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4

def color(hexcode):
    return tuple(srgb(int(hexcode[i:i+2], 16) / 255) for i in (1, 3, 5))

def make_material(name, hexcode, roughness=.86):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color(hexcode), 1)
    p.inputs['Metallic'].default_value = 0
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Specular IOR Level'].default_value = .12
    m.diffuse_color = (*color(hexcode), 1)
    m.use_backface_culling = False
    return m

def clean_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            if item.users == 0: block.remove(item)

def create_mesh(name, vertices, faces, materials, mat_indices=None, normals=None, colors=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.validate(verbose=True)
    data.update()
    for m in materials: data.materials.append(m)
    for i, p in enumerate(data.polygons):
        p.use_smooth = True
        if mat_indices: p.material_index = mat_indices[i]
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    # Leaves share a coherent shading field within each crown pad while their
    # silhouettes and slight folds remain actual, individually shaped geometry.
    if normals: data.normals_split_custom_set_from_vertices(normals)
    if colors:
        attr=data.color_attributes.new(name='CrownColor',type='FLOAT_COLOR',domain='POINT')
        attr.data.foreach_set('color',[v for rgba in colors for v in rgba])
    return obj

def make_bark_material():
    """One opaque, hand-painted albedo; no renderer-specific shader or bump."""
    assert BARK_TEXTURE.is_file(), BARK_TEXTURE
    material=make_material('Anime hand-painted warm tan bark', '#9B7B5C', .92)
    shader=material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=(1,1,1,1)
    shader.inputs['Specular IOR Level'].default_value=.05
    # Load the current PNG; the saved blend may contain an older packed image
    # at the same path after a user-requested texture edit.
    image=bpy.data.images.load(str(BARK_TEXTURE),check_existing=False)
    image.colorspace_settings.name='sRGB'
    image.pack()
    texture=material.node_tree.nodes.new('ShaderNodeTexImage')
    texture.name='Hand-painted anime bark albedo'
    texture.image=image
    texture.extension='REPEAT'
    uv=material.node_tree.nodes.new('ShaderNodeUVMap');uv.uv_map='BarkUV'
    material.node_tree.links.new(uv.outputs['UV'],texture.inputs['Vector'])
    material.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
    return material

def assign_bark_uv(wood):
    """Unwrap each tapered tube along its actual centreline, including branches.

    The existing trunk mesh contains disconnected capped tubes. Following their
    rings keeps brush grain aligned with curved branches without changing mesh
    topology, leaf geometry, or normals. The wrap seam is split in loop UVs.
    """
    mesh=wood.data
    neighbors=[set() for _ in mesh.vertices]
    for edge in mesh.edges:
        a,b=edge.vertices;neighbors[a].add(b);neighbors[b].add(a)
    caps_by_vertex={}
    for polygon in mesh.polygons:
        if len(polygon.vertices)>4:
            for index in polygon.vertices:caps_by_vertex[index]=polygon
    remaining=set(range(len(mesh.vertices)));coordinates={};cap_faces=set();tubes=0
    while remaining:
        start=next(iter(remaining));component={start};stack=[start]
        while stack:
            for index in neighbors[stack.pop()]-component:
                component.add(index);stack.append(index)
        remaining-=component
        caps={caps_by_vertex[index].index for index in component if index in caps_by_vertex}
        assert len(caps)==2, ('Expected a capped branch tube',len(caps),len(component))
        cap_faces.update(caps)
        def radius(polygon):
            center=sum((mesh.vertices[i].co for i in polygon.vertices),Vector())/len(polygon.vertices)
            return sum((mesh.vertices[i].co-center).length for i in polygon.vertices)/len(polygon.vertices)
        base=max((mesh.polygons[i] for i in caps),key=radius)
        ring=list(base.vertices);visited=set();distance=0.;last_center=None
        while ring:
            center=sum((mesh.vertices[i].co for i in ring),Vector())/len(ring)
            if last_center is not None:distance+=(center-last_center).length
            for k,index in enumerate(ring):coordinates[index]=(k/len(ring),distance/BARK_REPEAT_METRES)
            visited.update(ring);following=[]
            for index in ring:
                candidates=neighbors[index]-visited
                assert len(candidates)<=1, ('Ambiguous branch ring',index)
                if candidates:following.append(next(iter(candidates)))
            assert len(following) in (0,len(ring))
            ring=following;last_center=center
        assert visited==component, 'Incomplete bark unwrap'
        tubes+=1
    uv=mesh.uv_layers.get('BarkUV') or mesh.uv_layers.new(name='BarkUV')
    mesh.uv_layers.active=uv
    for polygon in mesh.polygons:
        values=[coordinates[i] for i in polygon.vertices]
        seam=max(u for u,v in values)-min(u for u,v in values)>.5
        for k,loop_index in enumerate(polygon.loop_indices):
            u,v=values[k]
            if polygon.index in cap_faces:
                uv.data[loop_index].uv=(.5+.45*math.cos(u*math.tau),.5+.45*math.sin(u*math.tau))
            else:
                uv.data[loop_index].uv=(u+1 if seam and u<.5 else u,v)
    mesh.update()
    return tubes

def apply_bark(wood):
    wood.data.materials.clear()
    wood.data.materials.append(make_bark_material())
    for polygon in wood.data.polygons:polygon.material_index=0
    tubes=assign_bark_uv(wood)
    for material in list(bpy.data.materials):
        if material.users==0:bpy.data.materials.remove(material)
    for image in list(bpy.data.images):
        if image.type=='IMAGE' and image.users==0:bpy.data.images.remove(image)
    return {'style':'hand-painted anime warm tan bark with broken scars','baseColorTexture':'assets/textures/anime_bark.png',
            'packedInBlend':True,'uv':'BarkUV','centrelineAlignedTubes':tubes,
            'verticalRepeatMetres':BARK_REPEAT_METRES,'roughness':.92,'metallic':0,'specular':.05}

def geometry_fingerprint(obj):
    """Confirm the material-only edit preserves the accepted foliage exactly."""
    digest=hashlib.sha256()
    coords=array('f',[0])* (len(obj.data.vertices)*3)
    obj.data.vertices.foreach_get('co',coords);digest.update(coords.tobytes())
    indices=array('i',[0])*len(obj.data.loops)
    obj.data.loops.foreach_get('vertex_index',indices);digest.update(indices.tobytes())
    for attr in obj.data.color_attributes:
        colors=array('f',[0])*(len(attr.data)*4)
        attr.data.foreach_get('color',colors);digest.update(colors.tobytes())
    normals=array('f',[0])*(len(obj.data.corner_normals)*3)
    obj.data.corner_normals.foreach_get('vector',normals);digest.update(normals.tobytes())
    return digest.hexdigest()

def recolor_foliage():
    """Change pigment and material only, retaining the approved leaf structure."""
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    foliage=bpy.data.objects['Six major crowns with overlapping volumetric leaf puffs']
    coords=[tuple(v.co) for v in foliage.data.vertices]
    normals=[tuple(n.vector) for n in foliage.data.corner_normals]
    stats=json.loads(REPORT.read_text())
    old=stats.get('foliageColor',{}).get('palette',ORIGINAL_FOLIAGE_PALETTE)
    old=[Vector(color(c)) for c in old];new=[Vector(color(c)) for c in FOLIAGE_PALETTE]
    attr=foliage.data.color_attributes['CrownColor']
    for vertex in attr.data:
        pigment=Vector(vertex.color[:3]);best=None
        for i in range(5):
            axis=old[i+1]-old[i]
            t=max(0,min(1,(pigment-old[i]).dot(axis)/axis.length_squared))
            error=(old[i].lerp(old[i+1],t)-pigment).length_squared
            if best is None or error<best[0]:best=(error,i,t)
        _,index,t=best
        vertex.color=(*new[index].lerp(new[index+1],t),1)
    for i,material in enumerate(foliage.data.materials):
        shader=material.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Emission Strength'].default_value=0
        shader.inputs['Roughness'].default_value=.94
        material.diffuse_color=(*new[i],1)
    assert coords==[tuple(v.co) for v in foliage.data.vertices]
    assert normals==[tuple(n.vector) for n in foliage.data.corner_normals]
    stats['foliageColor']={'reference':'sample-tree-02 roadside tree','palette':FOLIAGE_PALETTE,
        'emissionStrength':0,'roughness':.94,'geometryNormalsUnchanged':True}
    stats['surfaceStyle']['tealAmbientFill']=0
    stats.pop('reimport',None)
    REPORT.write_text(json.dumps(stats,indent=2))
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    render_views(setup_render())
    print('FOLIAGE_RECOLORED',json.dumps(stats['foliageColor']))

# Six designed major masses: peak, left, right, middle, two lower supports.
# Their broad overlapping child volumes establish the crown before small tufts.
# Units (cx,cy,cz, radiusX,radiusY,radiusZ, phase). Front looks from -Y.
LOBES = [
    (-.32,.10,5.18,.84,.86,.57,.8),
    (-1.27,-.18,4.12,1.04,.93,.54,1.2),
    (1.10,.48,4.58,1.03,.97,.56,3.8),
    (.08,-.64,3.72,1.10,1.02,.58,2.2),
    (-1.07,.24,2.85,.88,.82,.43,.2),
    (1.28,-.15,3.00,.99,.89,.49,1.4),
]
GROUP_COUNTS = [6,7,6,7,5,6]

def build_tree():
    clean_scene()
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.preferences.filepaths.save_version = 0
    foliage = [make_material(name, code,.94) for name,code in zip([
        'Deep teal interior','Teal shade','Mid green','New leaf light green',
        'Sunlit lime','Warm yellow green edge'],FOLIAGE_PALETTE)]
    palette=[tuple(m.diffuse_color[:3]) for m in foliage]
    # Standard glTF COLOR_0 gives continuous tuft pigment, avoiding six hard
    # colour steps and independent random bright/dark leaves over the surface.
    for m in foliage:
        p=m.node_tree.nodes.get('Principled BSDF')
        p.inputs['Base Color'].default_value=(1,1,1,1)
        # Match the roadside tree's matte pigment response to actual scene light.
        p.inputs['Emission Strength'].default_value=0
        attr=m.node_tree.nodes.new('ShaderNodeVertexColor')
        attr.layer_name='CrownColor'
        m.node_tree.links.new(attr.outputs['Color'],p.inputs['Base Color'])
    bark = [make_bark_material()]
    rng = random.Random(SEED)
    wood_v, wood_f, wood_m = [], [], []
    def tube(points, radii, sides):
        path=list(map(Vector,points)); samples=[]; widths=[]
        for j in range(len(path)-1):
            a=path[max(0,j-1)];b=path[j];c=path[j+1];d=path[min(j+2,len(path)-1)]
            for k in range(4):
                t=k/4
                samples.append(.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
                widths.append(radii[j]*(1-t)+radii[j+1]*t)
        samples.append(path[-1]);widths.append(radii[-1]);off=len(wood_v)
        for j,p in enumerate(samples):
            n=(samples[min(j+1,len(samples)-1)]-samples[max(0,j-1)]).normalized()
            u=n.cross(Vector((0,1,0))).normalized();v=n.cross(u).normalized()
            for k in range(sides):
                a=k*math.tau/sides
                wood_v.append(tuple(p+(u*math.cos(a)+v*math.sin(a))*widths[j]*(1+.035*math.sin(a*4))))
        for j in range(len(samples)-1):
            for k in range(sides):
                a=off+j*sides+k;b=off+j*sides+(k+1)%sides
                wood_f.append((a,b,b+sides,a+sides));wood_m.append(0)
        wood_f.extend([tuple(off+k for k in reversed(range(sides))),tuple(off+(len(samples)-1)*sides+k for k in range(sides))]);wood_m.extend([0,0])
    trunk=[(0,0,0),(.035,.02,.28),(.08,.015,1.1),(.02,.05,1.8),(-.09,.06,2.75),(-.13,.10,3.8),(-.28,.12,4.7),(-.31,.04,5.35)]
    tube(trunk,[.135,.11,.09,.079,.067,.052,.032,.004],12)
    limbs=[
        ([(.04,.03,1.35),(-.33,.09,1.98),(-.77,.02,2.35),(-1.48,-.03,2.70)],[.075,.056,.034,.008]),
        ([(.02,.05,1.86),(.51,.03,2.23),(.91,.07,2.59),(1.55,.09,2.91)],[.074,.055,.028,.008]),
        ([(-.08,.07,2.6),(-.47,.03,3.18),(-1.02,.05,3.68),(-1.64,.02,4.00)],[.06,.044,.024,.004]),
        ([(-.10,.08,2.91),(.33,.16,3.46),(.87,.21,3.99),(1.47,.12,4.40)],[.054,.04,.022,.004]),
        ([(-.12,.09,3.32),(-.34,.51,3.60),(-.17,.78,3.97),(.19,.75,4.19)],[.044,.03,.018,.004]),
        ([(-.17,.10,3.91),(.16,.24,4.31),(.53,.22,4.76),(.99,.29,5.02)],[.04,.031,.018,.003]),
    ]
    for points,radii in limbs:tube(points,radii,8)
    # Upper supports end inside the substantial crown volumes. Existing major
    # limbs remain the structure; there is no exposed twig for every leaf tuft.
    for j in (0,3):
        x,y,z,*_=LOBES[j]
        base=Vector((-.12,.09,z-.75));end=Vector((x,y,z))
        tube([base,base.lerp(end,.50),end],[.026,.015,.003],6)
    for j in range(5):
        a=j*math.tau/5+.2;d=Vector((math.cos(a),math.sin(a),0))
        tube([(0,0,.18),tuple(d*.16+Vector((0,0,.035))),tuple(d*rng.uniform(.29,.43)+Vector((0,0,.012)))],[.062,.035,.003],6)
    # Eight deterministic templates, each a small twig-shaped fan of 5–7 leaves.
    # They are reused as data then merged into a few draw meshes, not thousands
    # of Blender objects. Seven perimeter vertices and one raised centre give
    # eight-vertex rounded leaves a little depth, avoiding thin edge-on needles.
    templates=[]
    for variant in range(8):
        tr=random.Random(710+variant);tuft=[]
        for k in range(5+variant%3):
            t=k/(4+variant%3);side=-1 if k%2 else 1
            bend=(variant-3.5)*.025
            leaf_direction=Vector((side*(.46+.06*math.sin(variant)), .82+t*.08, .08+tr.random()*.08)).normalized()
            offset=Vector((side*(.010+t*.016), (t-.5)*.048, .007*math.sin(t*4+variant)))
            length=tr.uniform(.058,.078)*(1+.06*math.sin(variant))
            tuft.append((offset,leaf_direction,length,tr.uniform(.80,.98),bend))
        templates.append(tuft)
    LV,LF,LM,LN,LC=[],[],[],[],[]
    tuft_count=leaf_count=edge_count=0
    group_count=0
    group_layout=[]
    light_direction=Vector((-.6,-.6,.7)).normalized()
    up=Vector((0,0,1))

    def add_tuft(p, growth, center, height, scale, template, edge=False):
        nonlocal tuft_count,leaf_count,edge_count
        # The fan grows along a shoot, never along a crown/sphere normal.
        shoot=(growth+Vector((rng.uniform(-.10,.10),rng.uniform(-.10,.10),rng.uniform(-.07,.09)))).normalized()
        # Broad oblique tuft planes retain width in front and side views.
        # The bowed leaves and shared shading still belong to one colony.
        preferred=Vector((.45 if template%2 else -.45,.45 if template%4<2 else -.45,.75)).normalized()
        shoot=(shoot-preferred*shoot.dot(preferred)).normalized()
        right=shoot.cross(preferred).normalized()
        normal=right.cross(shoot).normalized()
        roll=rng.uniform(-.14,.14)
        right,normal=right*math.cos(roll)+normal*math.sin(roll),normal*math.cos(roll)-right*math.sin(roll)
        relative=(p.z-center.z)/height
        tuft_tone=.43+.40*relative+.18*(center.z/5.8-.5)+rng.uniform(-.010,.010)
        if center.z>4.85:tuft_tone+=.035
        if edge and growth.z>.65:tuft_tone+=.035
        level=max(0,min(5,tuft_tone*6))
        material=int(level);mix=level-material
        pigment=tuple(palette[material][c]*(1-mix)+palette[min(5,material+1)][c]*mix for c in range(3))
        field=Vector(((p.x-center.x)/(height*1.65),(p.y-center.y)/(height*1.45),relative+.50)).normalized()
        shade=(field*.68+up*.32).normalized()
        facing=normal if normal.dot(shade)>=0 else -normal
        for offset,direction,length,aspect,bend in templates[template]:
            leaf_p=p+(right*offset.x+shoot*offset.y+facing*(offset.z+.006))*scale
            angle=rng.uniform(-.20,.20)+bend
            axis=(right*(direction.x*math.cos(angle)-direction.y*math.sin(angle))+
                  shoot*(direction.x*math.sin(angle)+direction.y*math.cos(angle))+
                  normal*direction.z).normalized()
            across=normal.cross(axis).normalized()
            length*=scale*.80*rng.uniform(.7,1.3)
            width=length*aspect
            off=len(LV)
            # Small open curved leaf surfaces overlap inside each compact fan.
            # A raised centre keeps the leaf cloud substantial from the side.
            for a,b,c in [(0,0,.11),(-.46,0,0),(-.24,-.40,.006),(.14,-.46,.006),(.41,-.17,0),(.41,.17,0),(.14,.46,.006),(-.24,.40,.006)]:
                LV.append(tuple(leaf_p+axis*(a*length)+across*(b*width)+normal*(c*length)))
                LN.append(tuple(shade))
                LC.append((*pigment,1))
            for k in range(7):
                tri=(off,off+1+k,off+1+(k+1)%7)
                a,b,c=(Vector(LV[i]) for i in tri)
                if (b-a).cross(c-a).dot(shade)<0:tri=tuple(reversed(tri))
                LF.append(tri);LM.append(material)
            leaf_count+=1
            if edge:edge_count+=1
        tuft_count+=1

    # A major mass contains 4–8 overlapping medium puffs, rather than a row
    # of small shoots. Only the leaf fans exist: no solid core or surface shell.
    # Front/back offsets hide structural branches while leaving local windows.
    colonies=[(-.38,-.28,.10),(.35,-.24,.20),(-.20,.30,.24),(.25,.30,-.15),(0,0,-.32)]
    colony_axes=[(.75,.20,.10),(-.75,.20,.10),(.20,-.70,.10),(-.20,.75,.10),(.60,.10,-.08)]
    patterns=[(-.52,-.23,.03),(.02,-.42,.25),(.52,-.15,.06),
              (-.28,.31,.32),(.37,.34,.28),(-.18,-.04,-.35),
              (.34,.06,-.30),(-.63,.24,-.12)]
    for j,lobe in enumerate(LOBES):
        x,y,z,rx,ry,rz,phase=lobe
        center=Vector((x,y,z))
        branch=(center-Vector((-.12,.09,z-.65))).normalized()
        hub=center-branch*.20
        count=GROUP_COUNTS[j];group_count+=count;groups=[]
        for k,(px,py,pz) in enumerate(patterns[:count]):
            # Unequal, broad puffs overlap enough to read as a single mass.
            # Selected lower lobes are smaller and pulled inward, not a skirt.
            size=rng.uniform(.88,1.13)*(0.83 if k==6 else 1)
            if j==3:size*=1.09 if k==1 else .78 if k==6 else .97
            gcenter=center+Vector((px*rx,py*ry,pz*rz))
            gcenter+=Vector((rng.uniform(-.045,.045),rng.uniform(-.035,.035),rng.uniform(-.035,.035)))
            width=rx*rng.uniform(.48,.63)*size
            depth=ry*rng.uniform(.54,.70)*size
            height=rz*rng.uniform(.66,.86)*size
            growth=(branch*.30+Vector((px*.90,py*.85,.12+rng.uniform(-.12,.15)))).normalized()
            tube([hub,hub.lerp(gcenter,.66),gcenter],[.007*size,.0035*size,.001],6)
            side=growth.cross(light_direction).normalized()
            across_axis=side.cross(growth).normalized()
            buds=84+(j+k*3)%13
            for b in range(buds):
                # Sample the full three-dimensional bud colony, not its hull.
                # Compact fan growth emerges from many short internal shoots.
                direction=Vector((rng.gauss(0,1),rng.gauss(0,1),rng.gauss(0,1))).normalized()
                radius=rng.random()**.44
                q=direction*radius
                # Local lower/side cutouts produce a few indentations per mass;
                # there is no continuous fringe and no repeated ring of holes.
                if k in (0,2,6) and q.z<-.28 and q.x*(1 if k==2 else -1)>.35:
                    continue
                cx,cy,cz=colonies[b%5]
                p=gcenter+Vector(((cx+q.x*.53)*width,(cy+q.y*.53)*depth,(cz+q.z*.74)*height))
                a=b*2.39996+j*.31
                axis=Vector(colony_axes[b%5]).normalized()
                shoot=(axis+side*(.10*math.cos(a))+across_axis*(.10*math.sin(a))).normalized()
                local=Vector(((p.x-gcenter.x)/width,(p.y-gcenter.y)/depth,(p.z-gcenter.z)/height))
                taper=max(.62,min(1.08,1.08-(local.length-.60)*1.1))
                add_tuft(p,shoot,gcenter,height,rng.uniform(.96,1.31)*size*taper,rng.randrange(8))
            # Small detail only at a few silhouette outcrops, never all around.
            if k in (0,2):
                for b in range(1):
                    sign=-1 if k==0 else 1
                    p=gcenter+Vector((sign*width*.73,(b-1)*depth*.23,height*.32))
                    shoot=(growth+Vector((sign*.45,0,.15))).normalized()
                    add_tuft(p,shoot,gcenter,height,rng.uniform(.55,.79),rng.randrange(8),True)
            groups.append({'center':list(gcenter),'growth':list(growth),'tufts':buds,
                           'halfExtents':[width,depth,height]})
        group_layout.append({'mass':j,'groups':groups})
    wood=create_mesh('Tree trunk branches and concealed crown supports',wood_v,wood_f,bark,wood_m)
    leaves=create_mesh('Six major crowns with overlapping volumetric leaf puffs',LV,LF,foliage,LM,LN,LC)
    root=bpy.data.objects.new('Anime Tree 5.8 metres',None)
    bpy.context.collection.objects.link(root)
    for obj in (wood,leaves):obj.parent=root
    root['seed']=SEED;root['foliage_clusters']=len(LOBES);root['tuft_templates']=8
    root['geometry']='Six major masses, overlapping medium puffs, local windows, no surface shell'
    root['subgroups']=group_count
    # Tolerance is tiny compared with the smallest leaf; it only removes exact
    # duplicates, without welding separate overlapping leaves together.
    for obj in (wood,):
        bm=bmesh.new();bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
    highest=max(v.co.z for obj in (wood,leaves) for v in obj.data.vertices)
    lowest=min(v.co.z for obj in (wood,leaves) for v in obj.data.vertices)
    factor=5.95/(highest-lowest)
    for obj in (wood,leaves):
        for v in obj.data.vertices:v.co*=factor
        obj.data.update()
    bark_stats=apply_bark(wood)
    bpy.context.view_layer.update()
    bounds=[root.matrix_world @ Vector(corner) for obj in (wood,leaves) for corner in obj.bound_box]
    triangles=sum(len(p.vertices)-2 for obj in (wood,leaves) for p in obj.data.polygons)
    stats={'seed':SEED,'clusters':len(LOBES),'tuftTemplates':8,'tufts':tuft_count,'leaves':leaf_count,
           'outlineLeaves':edge_count,'triangles':triangles,'meshObjects':2,'subgroups':group_count,'groupsPerMass':[len(m['groups']) for m in group_layout],
           'foliagePlacement':'six major masses with overlapping volume groups, no surface shell','opaqueCrownBodies':0,
           'heightMetres':max(v.z for v in bounds)-min(v.z for v in bounds),
           'widthMetres':max(v.x for v in bounds)-min(v.x for v in bounds),
           'leafMaterialFaces':{m.name:LM.count(i) for i,m in enumerate(foliage)},
           'alphaTextures':False,'origin':[0,0,0],'growthAxis':'+Z','bark':bark_stats}
    stats['surfaceStyle']={'leafVertices':8,'tuftSharedPigment':True,'vertexColor':'CrownColor / glTF COLOR_0',
                           'leafRollRadians':.14,'leafAngleVariationRadians':.20,'opaqueCrownBodies':0,
                           'microColoniesPerSubgroup':5,'fineLeafScale':.80,'leafBendRatio':.11,'tealAmbientFill':0}
    stats['foliageColor']={'reference':'sample-tree-02 roadside tree','palette':FOLIAGE_PALETTE,
        'emissionStrength':0,'roughness':.94}
    REPORT.write_text(json.dumps(stats,indent=2))
    assert 50000<triangles<150000,stats
    assert 5<stats['heightMetres']<6.2,stats
    return root

def setup_render():
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.device='CPU'
    scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1100;scene.render.resolution_y=1100
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.view_settings.view_transform='Standard'
    scene.view_settings.look='None'
    scene.view_settings.exposure=0
    scene.world.use_nodes=True
    world=scene.world.node_tree
    world.nodes.clear()
    out=world.nodes.new('ShaderNodeOutputWorld')
    background=world.nodes.new('ShaderNodeBackground')
    background.inputs['Color'].default_value=(*color('#94BBC0'),1)
    background.inputs['Strength'].default_value=1.1
    # Camera sees dark blue-grey; the model receives soft blue ambient fill.
    visible=world.nodes.new('ShaderNodeBackground')
    visible.inputs['Color'].default_value=(*color('#1B303C'),1)
    visible.inputs['Strength'].default_value=1
    path=world.nodes.new('ShaderNodeLightPath');mix=world.nodes.new('ShaderNodeMixShader')
    world.links.new(path.outputs['Is Camera Ray'],mix.inputs[0]);world.links.new(background.outputs[0],mix.inputs[1]);world.links.new(visible.outputs[0],mix.inputs[2]);world.links.new(mix.outputs[0],out.inputs[0])
    light=bpy.data.lights.new('Large warm upper-left area','AREA')
    light.energy=620;light.color=(1.,.93,.77);light.shape='DISK';light.size=7
    obj=bpy.data.objects.new(light.name,light);bpy.context.collection.objects.link(obj)
    obj.location=(-4,-5,9);obj.rotation_euler=(Vector((0,0,3.5))-obj.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.018))
    floor=bpy.context.object;floor.name='Render backdrop floor'
    floor.data.materials.append(make_material('Backdrop only','#1B303C',1))
    camera=bpy.data.cameras.new('Inspection camera');camera.type='ORTHO';camera.ortho_scale=6.9
    obj=bpy.data.objects.new(camera.name,camera);bpy.context.collection.objects.link(obj);scene.camera=obj
    return obj

def render_views(camera, suffix=''):
    target=Vector((0,0,2.95))
    views=[('front',0)] if '--front-only' in sys.argv else [('front',0),('45deg',math.pi/4),('side',math.pi/2)]
    for name,a in views:
        camera.location=(math.sin(a)*11,-math.cos(a)*11,4.9)
        camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
        bpy.context.scene.render.filepath=str(RENDERS/f'tree_{name}{suffix}.png')
        bpy.ops.render.render(write_still=True)

def render_bark_closeup(camera, suffix=''):
    camera.data.ortho_scale=2.8
    camera.location=(.7,-5,2.1)
    camera.rotation_euler=(Vector((0,0,1.30))-camera.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.scene.render.filepath=str(RENDERS/f'tree_bark_closeup{suffix}.png')
    bpy.ops.render.render(write_still=True)

def update_bark():
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    wood=bpy.data.objects['Tree trunk branches and concealed crown supports']
    leaves=bpy.data.objects['Six major crowns with overlapping volumetric leaf puffs']
    before_wood=geometry_fingerprint(wood);before_leaves=geometry_fingerprint(leaves)
    bark=apply_bark(wood)
    assert geometry_fingerprint(wood)==before_wood
    assert geometry_fingerprint(leaves)==before_leaves
    bark['woodGeometryUnchanged']=True
    bark['foliageGeometryColorsNormalsUnchanged']=True
    bark['foliageFingerprint']=before_leaves
    stats=json.loads(REPORT.read_text());stats['bark']=bark
    stats.pop('reimport',None)
    REPORT.write_text(json.dumps(stats,indent=2))
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    camera=setup_render();render_views(camera);render_bark_closeup(camera)
    print('BARK_UPDATED_GEOMETRY_UNCHANGED',json.dumps(bark))

def export_and_reimport():
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    root=bpy.data.objects.get('Anime Tree 5.8 metres')
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.parent==root]
    assert len(meshes)==2
    merged_vertices=0
    for obj in meshes:
        bm=bmesh.new();bm.from_mesh(obj.data)
        before=len(bm.verts)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
        removed=before-len(bm.verts)
        # With the deterministic tufts there are no coincident leaf vertices;
        # avoid round-tripping unchanged leaf data and losing custom normals.
        if removed:
            bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
            bm.to_mesh(obj.data)
        merged_vertices+=removed
        bm.free()
    for material in list(bpy.data.materials):
        if material.users==0:bpy.data.materials.remove(material)
    if merged_vertices:bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for obj in meshes:
        assert all(v>0 for v in obj.scale)
        assert not any(not math.isfinite(c) for v in obj.data.vertices for c in v.co)
        assert not obj.data.validate()
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(GLB),export_format='GLB',use_selection=True,
        export_yup=True,export_extras=True,export_cameras=False,export_lights=False)
    # Import to a completely clean scene, never trusting only an export result.
    clean_scene()
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    bpy.context.view_layer.update()
    imported=[o for o in bpy.context.scene.objects if o.type=='MESH']
    assert len(imported)==2
    assert any(o.data.color_attributes for o in imported), 'Missing glTF foliage vertex colours'
    assert all(o.type not in ('LIGHT','CAMERA') for o in bpy.context.scene.objects)
    assert all(all(s>0 for s in o.scale) for o in imported)
    assert all(o.data.materials for o in imported)
    imported_wood=next(o for o in imported if 'trunk branches' in o.name)
    bark_material=imported_wood.data.materials[0]
    images=[node.image for node in bark_material.node_tree.nodes if node.type=='TEX_IMAGE' and node.image]
    assert images and all(image.size[0]>0 and image.size[1]>0 for image in images), 'Missing embedded bark texture'
    assert imported_wood.data.uv_layers, 'Missing bark UV coordinates'
    for obj in imported:
        assert all(math.isfinite(c) for v in obj.data.vertices for c in v.co)
        assert not obj.data.validate()
        assert all(p.area > 1e-12 for p in obj.data.polygons)
        assert all(math.isfinite(c) for n in obj.data.corner_normals for c in n.vector)
    points=[o.matrix_world@Vector(c) for o in imported for c in o.bound_box]
    height=max(p.z for p in points)-min(p.z for p in points)
    assert 5<height<6.2,height
    stats=json.loads(REPORT.read_text())
    stats['cleanup']={'mergeByDistanceMetres':.000001,'mergedVertices':merged_vertices,
        'unusedMaterials':0,'hiddenTestObjects':0,'appliedObjectTransforms':True}
    stats['reimport']={'meshObjects':len(imported),'heightMetres':height,
        'materials':len({m.name for o in imported for m in o.data.materials}),
        'triangles':sum(len(p.vertices)-2 for o in imported for p in o.data.polygons),
        'cameras':0,'lights':0,'finiteGeometry':True,'positiveScale':True,
        'foliageVertexColors':any(o.data.color_attributes for o in imported),
        'barkTexture':True,'barkUV':True,'barkTextureSize':list(images[0].size)}
    REPORT.write_text(json.dumps(stats,indent=2))
    # A front render of the actual reimport also catches material/shading loss.
    camera=setup_render()
    camera.location=(0,-11,4.9)
    camera.rotation_euler=(Vector((0,0,2.95))-camera.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.scene.render.filepath=str(RENDERS/'tree_glb_reimport.png')
    bpy.ops.render.render(write_still=True)
    render_bark_closeup(camera,'_glb_reimport')
    print('GLB_REIMPORT_OK',json.dumps(stats['reimport']))

if __name__ == '__main__':
    if '--recolor-foliage' in sys.argv:
        recolor_foliage()
    elif '--update-bark' in sys.argv:
        update_bark()
    elif '--export' in sys.argv:
        export_and_reimport()
    elif '--render-views' in sys.argv:
        bpy.ops.wm.open_mainfile(filepath=str(BLEND))
        camera=setup_render();render_views(camera);render_bark_closeup(camera)
    elif '--render-bark' in sys.argv:
        bpy.ops.wm.open_mainfile(filepath=str(BLEND))
        render_bark_closeup(setup_render())
    else:
        build_tree()
        # Source contains only the model; presentation objects follow the save.
        bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
        render_views(setup_render())
        print('RENDERS_READY_FOR_REVIEW',REPORT.read_text())
