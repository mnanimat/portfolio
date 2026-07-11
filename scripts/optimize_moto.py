"""Create a web/mobile GLB derivative while preserving the source file.

Run with Blender:
  blender --background --factory-startup --python scripts/optimize_moto.py -- INPUT OUTPUT
"""

from __future__ import annotations

import os
import sys
import time

import bpy


def cli_paths() -> tuple[str, str]:
    if "--" not in sys.argv:
        raise SystemExit("Expected INPUT and OUTPUT after --")
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 2:
        raise SystemExit("Usage: optimize_moto.py -- INPUT.glb OUTPUT.glb")
    return os.path.abspath(args[0]), os.path.abspath(args[1])


source, target = cli_paths()
if not os.path.isfile(source):
    raise SystemExit(f"Source not found: {source}")

os.makedirs(os.path.dirname(target), exist_ok=True)

started = time.time()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

print(f"[MN] importing {source}", flush=True)
bpy.ops.import_scene.gltf(filepath=source)

mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
triangles = 0
for obj in mesh_objects:
    triangles += sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)

# Some source materials contain clearcoat values above the glTF normative range.
for material in bpy.data.materials:
    if not material.use_nodes or not material.node_tree:
        continue
    for node in material.node_tree.nodes:
        if node.type != "BSDF_PRINCIPLED":
            continue
        clearcoat = node.inputs.get("Coat Weight") or node.inputs.get("Clearcoat")
        if clearcoat and clearcoat.default_value > 1.0:
            clearcoat.default_value = 1.0

actions = len(bpy.data.actions)
print(
    f"[MN] {len(mesh_objects)} mesh objects, {triangles} triangles, "
    f"{actions} actions; exporting optimized derivative",
    flush=True,
)

# Geometry is decimated per object, so transform animations and part names stay
# intact. Small fasteners are kept untouched to avoid collapsing them entirely.
for index, obj in enumerate(mesh_objects, start=1):
    if len(obj.data.polygons) < 500:
        continue
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new(name="MN_Web_LOD", type="DECIMATE")
    modifier.ratio = 0.24
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)
    if index % 20 == 0:
        print(f"[MN] optimized {index}/{len(mesh_objects)} mesh objects", flush=True)

# Draco keeps the derivative comfortably below typical web-hosting asset limits.
# Node transforms, actions and material assignments remain standard glTF data.
bpy.ops.export_scene.gltf(
    filepath=target,
    export_format="GLB",
    export_copyright="Motorcycle model and animation © MN Animation",
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_materials="EXPORT",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_anim_scene_split_object=True,
    export_force_sampling=False,
    export_optimize_animation_size=True,
    export_use_gltfpack=False,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
)

size_mb = os.path.getsize(target) / (1024 * 1024)
print(f"[MN] wrote {target} ({size_mb:.2f} MiB) in {time.time() - started:.1f}s", flush=True)
