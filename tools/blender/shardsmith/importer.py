"""Import a GLB, including the game's own KTX2/Basis-textured ones.

Blender's glTF importer does not implement KHR_texture_basisu and rejects any file that requires it. Those files are
made by the project's tools/ktx2-encode.mjs, and tools/ktx2-decode.mjs is its inverse: it transcodes every KTX2 image
to PNG with the same Basis transcoder the game ships and drops the extension. This module runs it through Node.

The decoder is found by walking up from the GLB looking for tools/ktx2-decode.mjs (a game asset lives inside the
project), or from the "Game project folder" preference. If Node or the tool cannot be found the file is still
imported: the extension is stripped in Python and the geometry, UVs and materials come in without their textures.
"""
import json
import os
import shutil
import struct
import subprocess
import tempfile

import bpy
from bpy.props import BoolProperty, EnumProperty, StringProperty
from bpy.types import AddonPreferences, Operator
from bpy_extras.io_utils import ImportHelper

TOOL = "ktx2-decode.mjs"
ENCODER = "ktx2-encode.mjs"


# ---------------------------------------------------------------------------------------------------------
# reading a GLB
# ---------------------------------------------------------------------------------------------------------
def read_glb(path):
    """(json, list of (chunk type, bytes)) of a .glb; (json, []) for a .gltf."""
    if path.lower().endswith(".gltf"):
        with open(path, "r", encoding="utf8") as f:
            return json.load(f), []
    with open(path, "rb") as f:
        data = f.read()
    off, chunks = 12, []
    while off + 8 <= len(data):
        n, t = struct.unpack("<II", data[off:off + 8])
        chunks.append((t, data[off + 8:off + 8 + n]))
        off += 8 + n
    return json.loads(chunks[0][1].decode("utf8")), chunks


def needs_ktx2_decode(path):
    try:
        j, _ = read_glb(path)
    except Exception:
        return False
    if "KHR_texture_basisu" in (j.get("extensionsUsed") or []) or "KHR_texture_basisu" in (j.get("extensionsRequired") or []):
        return True
    return any(i.get("mimeType") == "image/ktx2" for i in j.get("images", []))


def strip_basisu(src, dst):
    """Fallback: a copy of a GLB with the KTX2 textures removed (geometry and materials only)."""
    j, chunks = read_glb(src)
    for key in ("extensionsUsed", "extensionsRequired"):
        if key in j:
            j[key] = [e for e in j[key] if e != "KHR_texture_basisu"]
            if not j[key]:
                del j[key]
    j["textures"] = []
    j["images"] = []
    for m in j.get("materials", []):
        for k in ("baseColorTexture", "metallicRoughnessTexture"):
            m.get("pbrMetallicRoughness", {}).pop(k, None)
        for k in ("normalTexture", "occlusionTexture", "emissiveTexture"):
            m.pop(k, None)
    js = json.dumps(j).encode("utf8")
    js += b" " * ((4 - len(js) % 4) % 4)
    chunks[0] = (chunks[0][0], js)
    body = b"".join(struct.pack("<II", len(c), t) + c for t, c in chunks)
    with open(dst, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body)


# ---------------------------------------------------------------------------------------------------------
# finding the decoder
# ---------------------------------------------------------------------------------------------------------
def get_prefs(context):
    try:
        return context.preferences.addons[__package__].preferences
    except Exception:
        return None


def _parents(path, depth=8):
    d = os.path.abspath(path if os.path.isdir(path) else os.path.dirname(path))
    for _ in range(depth):
        yield d
        p = os.path.dirname(d)
        if p == d:
            return
        d = p


def find_tool(name, near, prefs=None):
    """Path of the project's tools/<name> (one of the Node scripts), or None.

    Looked up from the Game project folder preference, then by walking up from `near` (a file or folder) and from the
    .blend. The tool must sit beside a node_modules folder, or it could not load its libraries."""
    roots = []
    if prefs is not None and getattr(prefs, "project_folder", ""):
        roots.append(bpy.path.abspath(prefs.project_folder))
    roots.extend(_parents(near))
    if bpy.data.filepath:
        roots.extend(_parents(bpy.data.filepath))
    for r in roots:
        for cand in (os.path.join(r, "tools", name), os.path.join(r, name)):
            if os.path.isfile(cand) and os.path.isdir(os.path.join(os.path.dirname(cand), "node_modules")):
                return cand
    return None


def find_decoder(glb_path, prefs=None):
    """Path of tools/ktx2-decode.mjs, or None."""
    return find_tool(TOOL, glb_path, prefs)


def find_node(prefs=None):
    if prefs is not None and getattr(prefs, "node_path", ""):
        p = bpy.path.abspath(prefs.node_path)
        if os.path.isfile(p):
            return p
    w = shutil.which("node")
    if w:
        return w
    for p in (os.path.join(os.environ.get("ProgramFiles", ""), "nodejs", "node.exe"),
              os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "nodejs", "node.exe"),
              "/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node"):
        if p and os.path.isfile(p):
            return p
    return None


def decode_ktx2(glb_path, out_path, size, prefs=None):
    """Run the project's decoder. Returns the list of image reports; raises RuntimeError with a reason."""
    tool = find_decoder(glb_path, prefs)
    if tool is None:
        raise RuntimeError("tools/%s not found above the file (set the Game project folder in the add-on preferences)" % TOOL)
    node = find_node(prefs)
    if node is None:
        raise RuntimeError("Node.js not found (install it or set its path in the add-on preferences)")
    cmd = [node, tool, glb_path, out_path]
    if size:
        cmd += ["--max-size", str(size)]
    try:
        r = subprocess.run(cmd, cwd=os.path.dirname(tool), capture_output=True, text=True, timeout=900)
    except subprocess.TimeoutExpired:
        raise RuntimeError("the texture decoder timed out")
    if r.returncode != 0 or not os.path.exists(out_path):
        raise RuntimeError("the texture decoder failed: %s" % ((r.stderr or r.stdout).strip().splitlines() or ["?"])[-1])
    for line in reversed(r.stdout.strip().splitlines()):
        if line.startswith("{"):
            try:
                return json.loads(line).get("images", [])
            except Exception:
                break
    return []


def compress_ktx2(glb_path, prefs=None):
    """Re-encode a GLB's textures as KTX2/Basis in place with the project's tools/ktx2-encode.mjs.

    Returns the encoder's one-line summary (the video-memory saving); raises RuntimeError with the reason when it
    cannot run. The file is only replaced once the encoder has written a complete one."""
    if not read_glb(glb_path)[0].get("images"):
        return ""                                       # nothing to compress
    tool = find_tool(ENCODER, glb_path, prefs)
    if tool is None:
        raise RuntimeError("tools/%s not found above the folder (set the Game project folder in the add-on preferences)" % ENCODER)
    node = find_node(prefs)
    if node is None:
        raise RuntimeError("Node.js not found (install it or set its path in the add-on preferences)")
    tmp = os.path.splitext(glb_path)[0] + ".ktx2tmp.glb"
    try:
        r = subprocess.run([node, tool, glb_path, tmp], cwd=os.path.dirname(tool), capture_output=True, text=True, timeout=900)
    except subprocess.TimeoutExpired:
        raise RuntimeError("the texture encoder timed out")
    if r.returncode != 0 or not os.path.exists(tmp):
        if os.path.exists(tmp):
            os.remove(tmp)
        raise RuntimeError("the texture encoder failed: %s" % ((r.stderr or r.stdout).strip().splitlines() or ["?"])[-1])
    os.replace(tmp, glb_path)
    for line in reversed(r.stdout.strip().splitlines()):
        if line.startswith("TOTAL"):
            return " ".join(line.split())
    return ""


# ---------------------------------------------------------------------------------------------------------
class SHARDSMITH_AP_prefs(AddonPreferences):
    bl_idname = __package__

    project_folder: StringProperty(name="Game project folder", subtype='DIR_PATH', default="",
                                   description="Folder that contains tools/ktx2-decode.mjs. Usually found by itself from the GLB's location")
    node_path: StringProperty(name="Node.js", subtype='FILE_PATH', default="",
                              description="node executable. Usually found on the PATH")

    def draw(self, context):
        lay = self.layout
        lay.prop(self, "project_folder")
        lay.prop(self, "node_path")
        tool = None
        if self.project_folder:
            tool = find_decoder(bpy.path.abspath(self.project_folder), self)
        node = find_node(self)
        col = lay.column(align=True)
        col.label(text="Node.js: %s" % (node or "not found"), icon='CHECKMARK' if node else 'ERROR')
        if self.project_folder:
            col.label(text="Decoder: %s" % (tool or "not found in that folder"), icon='CHECKMARK' if tool else 'ERROR')
        else:
            col.label(text="Decoder: looked up from each GLB's location", icon='INFO')


class SHARDSMITH_OT_import_glb(Operator, ImportHelper):
    bl_idname = "shardsmith.import_glb"
    bl_label = "Import Game GLB"
    bl_description = "Import a GLB, including the game's KTX2-textured ones that Blender cannot open on its own"
    bl_options = {'REGISTER', 'UNDO'}

    filename_ext = ".glb"
    filter_glob: StringProperty(default="*.glb;*.gltf", options={'HIDDEN'})
    texture_size: EnumProperty(name="Textures", default='FULL', items=[
        ('FULL', "Full size", "Decode KTX2 textures at their full resolution"),
        ('2048', "2048", "At most 2048 pixels on the longer side"),
        ('1024', "1024", "At most 1024 pixels on the longer side"),
        ('512', "512", "At most 512 pixels on the longer side"),
    ], description="Resolution to decode KTX2 textures at (only used for KTX2 files)")
    join_meshes: BoolProperty(name="Join Meshes", default=True,
                              description="Join every mesh in the file into one object so it can be shattered in one go")

    def execute(self, context):
        path = self.filepath
        if not os.path.isfile(path):
            self.report({'ERROR'}, "File not found: %s" % path)
            return {'CANCELLED'}
        tmp = tempfile.mkdtemp(prefix="shardsmith_")
        notes = []
        try:
            use = path
            if needs_ktx2_decode(path):
                out = os.path.join(tmp, "decoded.glb")
                try:
                    imgs = decode_ktx2(path, out, 0 if self.texture_size == 'FULL' else int(self.texture_size), get_prefs(context))
                    use = out
                    notes.append("decoded %d KTX2 textures" % sum(1 for i in imgs if i.get("decoded")))
                except RuntimeError as e:
                    out = os.path.join(tmp, "stripped.glb")
                    strip_basisu(path, out)
                    use = out
                    self.report({'WARNING'}, "Imported without textures: %s" % e)
                    notes.append("no textures")
            before = set(bpy.data.objects)
            try:
                bpy.ops.import_scene.gltf(filepath=use)
            except Exception as e:
                self.report({'ERROR'}, "glTF import failed: %s" % e)
                return {'CANCELLED'}
            new = [o for o in bpy.data.objects if o not in before]
            meshes = [o for o in new if o.type == 'MESH']
            for img in bpy.data.images:
                if img.filepath and not img.packed_file and os.path.abspath(bpy.path.abspath(img.filepath)).startswith(tmp):
                    img.pack()
                    img.filepath = ""
            if not meshes:
                self.report({'WARNING'}, "The file has no meshes")
                return {'FINISHED'}
            if self.join_meshes and len(meshes) > 1:
                for o in meshes:
                    if o.parent is not None:
                        world = o.matrix_world.copy()
                        o.parent = None
                        o.matrix_world = world
                with context.temp_override(active_object=meshes[0], object=meshes[0], selected_objects=meshes, selected_editable_objects=meshes):
                    bpy.ops.object.join()
                meshes = [meshes[0]]
                notes.append("joined into one mesh")
            for o in context.view_layer.objects:
                o.select_set(False)
            meshes[0].select_set(True)
            context.view_layer.objects.active = meshes[0]
            self.report({'INFO'}, "Imported %s (%s)" % (meshes[0].name, ", ".join(notes) or "plain glTF"))
            return {'FINISHED'}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def draw(self, context):
        lay = self.layout
        lay.use_property_split = True
        lay.prop(self, "texture_size")
        lay.prop(self, "join_meshes")


def menu_import(self, context):
    self.layout.operator(SHARDSMITH_OT_import_glb.bl_idname, text="Game GLB, KTX2 textures OK (Shardsmith)")


CLASSES = (SHARDSMITH_AP_prefs, SHARDSMITH_OT_import_glb)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)
    bpy.types.TOPBAR_MT_file_import.append(menu_import)


def unregister():
    bpy.types.TOPBAR_MT_file_import.remove(menu_import)
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
