"""Convert the supplied Bear STL to an editable, weighted Blender rig and GLB.

blender --background --factory-startup --python tools/build_bear.py -- --source /path/Bear.stl
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--triangles', type=int, default=10000)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
project = Path(__file__).resolve().parent.parent
output = project / 'public' / 'models'
editable = project / 'assets'
output.mkdir(parents=True, exist_ok=True)
editable.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.stl_import(filepath=str(args.source))
bear = bpy.context.object
bear.name = 'Bear_Surface'
source_triangles = len(bear.data.polygons)
low = min(v.co.z for v in bear.data.vertices)
high = max(v.co.z for v in bear.data.vertices)
scale = 3.2 / (high - low)
# STL uses Z up and looks down -Y. Blender: Z up, nose toward +X.
for vertex in bear.data.vertices:
    x, y, z = vertex.co
    vertex.co = (-y * scale, x * scale, (z - low) * scale)
bear.data.update()

modifier = bear.modifiers.new('Web silhouette optimization', 'DECIMATE')
modifier.ratio = min(1, args.triangles / source_triangles)
modifier.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier=modifier.name)
# This print-ready STL joins its front paws at the center. A narrow, capped
# separation below the belly removes that bridge before skinning; otherwise it
# becomes a stretched membrane when the left and right paws move independently.
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
cutter = bpy.context.object
cutter.name = 'Temporary paw separation'
cutter.dimensions = (6, .04, 1.6)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.context.view_layer.objects.active = bear
separate = bear.modifiers.new('Separate fused print paws', 'BOOLEAN')
separate.operation = 'DIFFERENCE'
separate.solver = 'EXACT'
separate.object = cutter
bpy.ops.object.modifier_apply(modifier=separate.name)
bpy.data.objects.remove(cutter, do_unlink=True)
triangulate = bear.modifiers.new('Triangulate web surface', 'TRIANGULATE')
bpy.ops.object.modifier_apply(modifier=triangulate.name)
for face in bear.data.polygons:
    face.use_smooth = False

def linear(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4

def material(name, color):
    mat = bpy.data.materials.new(name)
    rgb = tuple(linear(int(color[i:i+2], 16) / 255) for i in (0, 2, 4))
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = 1
    return mat

coat = material('Nord Snow Storm', 'e5e9f0')
ink = material('Nord Polar Night', '2e3440')
bear.data.materials.clear()
bear.data.materials.append(coat)
bear.data.materials.append(ink)

armature = bpy.data.armatures.new('Bear_Skeleton')
rig = bpy.data.objects.new('Bear_Rig', armature)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bear.select_set(False)
bpy.ops.object.mode_set(mode='EDIT')

def bone(name, head, tail, parent=None):
    result = armature.edit_bones.new(name)
    result.head, result.tail = head, tail
    if parent:
        result.parent = armature.edit_bones[parent]
    return result

bone('Root', (0, 0, 0), (0, 0, .45))
armature.edit_bones['Root'].use_deform = False
bone('Spine', (-.65, 0, 2.05), (.68, 0, 2.17), 'Root')
bone('Neck', (.68, 0, 2.17), (1.24, 0, 1.98), 'Spine')
bone('Head', (1.24, 0, 1.98), (1.99, 0, 1.23), 'Neck')
for side, sign in [('L', -1), ('R', 1)]:
    for kind, hip, knee, ankle, toe in [
        ('Front', (.57, .64, 2.08), (.35, .55, 1.05), (.57, .39, .23), (1.06, .30, .13)),
        ('Hind', (-1.4, .64, 2.05), (-1.18, .56, 1.11), (-1.62, .43, .24), (-1.04, .31, .13)),
    ]:
        points = [(x, y * sign, z) for x, y, z in [hip, knee, ankle, toe]]
        names = [f'{kind}Upper_{side}', f'{kind}Lower_{side}', f'{kind}Paw_{side}']
        bone(names[0], points[0], points[1], 'Spine')
        bone(names[1], points[1], points[2], names[0])
        bone(names[2], points[2], points[3], names[1])
bpy.ops.object.mode_set(mode='OBJECT')

# Heat weighting follows the actual surface topology around shoulders and hips.
bpy.ops.object.select_all(action='DESELECT')
bear.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
if not bear.vertex_groups:
    raise RuntimeError('Automatic skin weighting did not produce vertex groups')

# Enforce four normalized influences, and prevent opposite paws pulling each other
# through the very narrow gap in this sculpture's standing pose.
index_names = {group.index: group.name for group in bear.vertex_groups}
def smoothstep(value):
    t = max(0, min(1, value))
    return t * t * (3 - 2 * t)

for vertex in bear.data.vertices:
    weights = [(g.group, g.weight) for g in vertex.groups if g.weight > 1e-5]
    if vertex.co.z < 1.25 and abs(vertex.co.y) > .015:
        wrong_side = '_R' if vertex.co.y < 0 else '_L'
        weights = [(group, weight) for group, weight in weights if not index_names[group].endswith(wrong_side)]
    # The upper back is a stable mass; heat weights otherwise let nearby upper
    # legs pull it away from the bird socket by a few centimeters.
    rigidity = smoothstep((vertex.co.z - 2.3) / .3) * smoothstep((1.3 - vertex.co.x) / .5)
    target_group = bear.vertex_groups['Spine'].index
    if vertex.co.z < .35:
        # Keep the printed flat soles rigid, blending into the ankle above them.
        rigidity = 1 - smoothstep((vertex.co.z - .16) / .19)
        kind = 'Front' if vertex.co.x > -.4 else 'Hind'
        side = 'L' if vertex.co.y < 0 else 'R'
        target_group = bear.vertex_groups[f'{kind}Paw_{side}'].index
    combined = {group: weight * (1 - rigidity) for group, weight in weights}
    combined[target_group] = combined.get(target_group, 0) + rigidity
    weights = [(group, weight) for group, weight in combined.items() if weight > 1e-5]
    weights.sort(key=lambda item: item[1], reverse=True)
    weights = weights[:4]
    if not weights:
        weights = [(bear.vertex_groups['Spine'].index, 1)]
    total = sum(weight for _, weight in weights)
    # Store indices before mutating the vertex's group collection.
    for group_index in [group.group for group in vertex.groups]:
        bear.vertex_groups[group_index].remove([vertex.index])
    for group, weight in weights:
        bear.vertex_groups[group].add([vertex.index], weight / total, 'REPLACE')

# A socket on the actual mesh keeps the bird in contact after body animation.
hit, location, normal, _ = bear.ray_cast(Vector((-.45, -.13, 5)), Vector((0, 0, -1)))
if not hit:
    raise RuntimeError('Could not find the back surface for the bird perch')
perch = bpy.data.objects.new('Perch', None)
bpy.context.collection.objects.link(perch)
perch.empty_display_type = 'PLAIN_AXES'
perch.empty_display_size = .15
perch.parent = rig
perch.parent_type = 'BONE'
perch.parent_bone = 'Spine'
bpy.context.view_layer.update()
perch.matrix_world.translation = location + Vector((0, 0, .006))
# Bone parenting defaults at the bone tail. Setting matrix_world preserves the
# socket's identity orientation in the rest pose as well as its surface position.
from mathutils import Matrix
world = Matrix.Identity(4)
world.translation = location + Vector((0, 0, .006))
perch.matrix_world = world

# Small facial inlays follow Head rigidly; the imported mesh supplies anatomy.
inlays = [
    ('Eye_L', (1.78, -3, 1.71), (0, 1, 0), (.024, .024, .024)),
    ('Eye_R', (1.78, 3, 1.71), (0, -1, 0), (.024, .024, .024)),
    ('Nose', (3, 0, 1.17), (-1, 0, 0), (.055, .115, .067)),
]
for name, origin, direction, size in inlays:
    hit, loc, normal, _ = bear.ray_cast(Vector(origin), Vector(direction))
    if hit:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=loc + normal * .012)
        eye = bpy.context.object
        eye.name = name
        for vertex in eye.data.vertices:
            vertex.co.x *= size[0]
            vertex.co.y *= size[1]
            vertex.co.z *= size[2]
        eye.data.materials.append(ink)
        eye.parent = rig
        eye.parent_type = 'BONE'
        eye.parent_bone = 'Head'
        bpy.context.view_layer.update()
        matrix = Matrix.Identity(4)
        matrix.translation = loc + normal * .012
        eye.matrix_world = matrix

rig['source'] = args.source.name
rig['source_sha256'] = hashlib.sha256(args.source.read_bytes()).hexdigest()
rig['source_triangles'] = source_triangles
rig['optimized_triangles'] = len(bear.data.polygons)
rig['rig_version'] = 1
rig.show_in_front = True
bpy.context.view_layer.update()

# The editable source keeps a neutral rest pose and named, deforming bones.
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.context.scene.render.engine = 'CYCLES'
bpy.ops.wm.save_as_mainfile(filepath=str(editable / 'bear-rig.blend'))
bpy.ops.export_scene.gltf(
    filepath=str(output / 'bear.glb'), export_format='GLB',
    export_yup=True, export_skins=True, export_animations=False,
    # Missing normals deliberately requests flat face normals in glTF, allowing
    # shared vertices instead of splitting every triangle into three vertices.
    export_extras=True, export_materials='EXPORT', export_normals=False,
    export_apply=False, export_cameras=False, export_lights=False,
)
manifest = {
    'source': args.source.name, 'sourceSha256': rig['source_sha256'],
    'sourceTriangles': source_triangles, 'triangles': len(bear.data.polygons),
    'bones': len(armature.bones), 'perchBlender': list(location),
}
(output / 'bear.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('BEAR_EXPORT', json.dumps(manifest))
