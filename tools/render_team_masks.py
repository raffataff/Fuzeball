# -*- coding: utf-8 -*-
"""
FUZEBALL — team-part mask exporter (Blender 4.x and 5.x)
========================================================

Emits `assets/renders/render_<stem>_teammask.png` per figurine: a matte covering ONLY that
figurine's team-coloured kit, so the pre-match tape can tint its Cycles portrait to the team colour
without touching skin, hair or eyes.

WHAT DECIDES THE MATTE (and what doesn't)
-----------------------------------------
ONLY MATERIAL NAMES MATTER. Blender's Cryptomatte Material pass keys on the material name, and the
names it needs are the ones already in js/config.js as `teamParts` — `kit_cyborg`, `kit_Grimlot`,
`kit_maria2` and so on. Nothing is hand-painted or colour-keyed.

Object names, mesh names and collection names are IRRELEVANT to the matte. They matter here only
for isolation (below), never for what ends up white in the mask. Skin and hair drop out because
they are different materials — `hairParts` is a separate list in config.js for exactly that reason.

ISOLATION — the part that matters when all figurines share one scene
--------------------------------------------------------------------
The mask has to line up pixel-for-pixel with the beauty render it sits on top of, which means the
same camera, the same framing and the same set of visible objects that produced
`render_<stem>_cycles.png`.

Cryptomatte itself does not need the figurines separated: each kit material name is unique to one
figurine, so mattes never bleed between them even with the whole cast on screen. Isolation exists
purely to reproduce the beauty render's framing.

  --isolate auto (default)  Use the figurine's own top-level collection if it has one to itself;
                            otherwise fall through to `stacked`. A staging collection holding the
                            whole cast cannot isolate anything, so auto detects that and says so.
  --isolate stacked         For a cast stacked on the world origin and picked by visibility: keep
                            this figurine's objects, hide every OTHER mesh in the staging
                            collections — attributed or not. An unattributed mesh at the origin is
                            standing inside the shot, so "hide the other figurines" isn't enough.
  --isolate objects         Keep this figurine's objects, hide only the other figurines'. Use when
                            the scene has meshes at the origin that must stay in frame.
  --isolate collection      Use the explicit collection named in the manifest for each figurine.
  --isolate none            Render the scene exactly as saved.

Lights, empties, armatures and the camera are NEVER hidden by any mode — hiding a key light would
change the render the mask has to match, and an armature drives the pose.

Run --inspect FIRST. It reports which figurines it found, which objects and collections carry each
kit material, which cameras exist, and any teamParts entry from config.js that is missing from the
blend — without rendering anything.

BLENDER VERSION
---------------
Blender 5.0 removed `scene.use_nodes` and `scene.node_tree`; the compositor is now a node group on
`scene.compositing_node_group`, terminated by a Group Output rather than a Composite node. Both
paths are implemented and picked at runtime, so this runs on 4.x and 5.x alike.

THE MATTE GOES IN THE ALPHA CHANNEL. CSS `mask-image` keys off alpha, not luminance, so a plain
black-and-white PNG would be fully opaque and the tint would cover the whole portrait box. The
compositor pipes the matte through SetAlpha over a white RGB and writes RGBA.

USAGE
-----
    # look before you leap — reports structure, renders nothing
    blender -b scene.blend -P tools/render_team_masks.py -- --inspect

    # every figurine found in the open blend
    blender -b scene.blend -P tools/render_team_masks.py -- --all

    # one figurine
    blender -b scene.blend -P tools/render_team_masks.py -- --id alienGrimlot

    # per-figurine collection / camera overrides, when auto-isolation guesses wrong
    blender -b scene.blend -P tools/render_team_masks.py -- --all --manifest tools/mask_manifest.json

        mask_manifest.json:
            { "alienGrimlot": {"collection": "GRIMLOT", "camera": "CAM_portrait"},
              "cyborg":       {"collection": "CYBORG"} }

Flags: --out DIR, --scale N (default 50), --samples N (default 32), --isolate MODE, --dry-run.
Exits non-zero if anything failed to resolve, so it can gate a build.
"""

import argparse
import glob
import os
import sys

import bpy


# ---------------------------------------------------------------------------
# Figurine table — MIRRORS js/config.js CONFIG.playerModel.models.
#
# `stem` is the filename stem the renders were exported under; it does NOT always match the model
# id (womanAndroid → jennyBot, manrichie → richie, rocko → rocko2). It must agree with RENDER_STEM
# in js/league.js or the runtime won't find the mask.
#
# `team` is verbatim `teamParts`. Hair is deliberately absent — it's a separate list in config.js
# and a separate material in the blend, which is why excluding it here costs nothing.
# ---------------------------------------------------------------------------
# `hair` is config.js's hairParts. It is NOT matted — hair must stay its own colour — but it is
# needed to ATTRIBUTE objects: a character whose hair is a separate mesh has to be recognised as
# part of that character, or isolation leaves it floating over whoever is rendered next. Every
# figurine here is stacked on the world origin, so a stray part is not off to one side; it is
# inside the shot.
FIGURINES = {
    "cyborg":       {"stem": "cyborg",    "team": ["kit_cyborg", "kit_cyborg_visor"],
                     "hair": ["kit_cyborg_hair"]},
    "deltaborg":    {"stem": "deltaborg", "team": ["kit_deltaborg"], "hair": []},
    "irnman":       {"stem": "irnman",    "team": ["kit_irnman", "kit_irnman_centre"], "hair": []},
    "mechaMan":     {"stem": "mechaman",  "team": ["kit_mechaman_new"], "hair": []},
    "stormer":      {"stem": "stormer",   "team": ["kit_stormer"], "hair": []},
    "rocko":        {"stem": "rocko2",    "team": ["kit_rocko", "kit_rocko_badge"], "hair": []},
    "manJerry":     {"stem": "jerry",     "team": ["kit_manJerry"], "hair": ["kit_manJerry_hair"]},
    "manrichie":    {"stem": "richie",    "team": ["kit_richie"], "hair": ["kit_richie_hair"]},
    "womanMaria":   {"stem": "maria",     "team": ["kit_maria2"], "hair": ["kit_maria2_hair"]},
    "womanKimi":    {"stem": "kimi",      "team": ["kit_kimi"], "hair": ["kit_kimi_hair"]},
    "womanTalia":   {"stem": "talia",     "team": ["kit_talia", "kit_talia_centre"],
                     "hair": ["kit_talia_hair"]},
    "womanTanya":   {"stem": "tanya",     "team": ["kit_tanya", "kit_tanya_centre"],
                     "hair": ["kit_tanya_hair"]},
    "womanSasha":   {"stem": "sasha",     "team": ["kit_sasha"], "hair": ["kit_sasha_hair"]},
    "womanAndroid": {"stem": "jennyBot",  "team": ["woman_android"],
                     "hair": ["woman_android_hair"]},
    "womanZaneesh": {"stem": "zaneesh",   "team": ["kit_zaneesh"], "hair": []},
    "alienTamirok": {"stem": "tamirok",   "team": ["kit_tamirok", "kit_tamirok_centre"], "hair": []},
    "alienGrimlot": {"stem": "grimlot",   "team": ["kit_Grimlot"], "hair": []},
    "alienKatum":   {"stem": "katum",     "team": ["kit_Katum"], "hair": []},
    "alienKodus":   {"stem": "kodus",     "team": ["kit_Kodus", "kit_kodus_centre"], "hair": []},
    "alienZargon":  {"stem": "zargon",    "team": ["kit_Zargon", "kit_zargon_centre"], "hair": []},
}

IS_5X = bpy.app.version[0] >= 5
IN_GUI = not bpy.app.background


# ===========================================================================
# GUI RUN CONFIG — edit these three, hit ▶ Run Script, read teammask.log
# ===========================================================================
# Running from Blender's Text Editor gives the script no command line, so it reads GUI_ARGS instead
# of sys.argv. Output is mirrored into a text datablock called `teammask.log` inside this blend —
# open it from the Text Editor's datablock dropdown, no System Console needed.
#
#   ["--inspect"]                          report only, renders nothing. Start here.
#   ["--id", "alienGrimlot"]               one figurine, for checking before committing to all
#   ["--all"]                              the whole cast
#   add "--dry-run" to any of the above    do the isolation, stop before rendering
#
GUI_ARGS = ["--inspect"]
#GUI_ARGS = ["--id", "alienGrimlot"]      # one figurine, once --inspect looks right
#GUI_ARGS = ["--all"]                     # the whole cast

# Where masks are written. Leave "" to auto-detect from this script's location on disk (works when
# the .py was opened from the repo, which is the normal case). Set it explicitly if auto-detect
# reports the wrong folder — in the GUI there is no reliable current working directory, and a wrong
# guess means the masks land somewhere you'll never find them. --inspect prints the resolved path.
OUT_DIR = ""


class Done(Exception):
    """Carries an exit code without calling sys.exit().

    THIS IS LOAD-BEARING, not style. sys.exit() raises SystemExit, and when a script runs inside
    the Blender GUI nothing catches it — Blender treats it as a request to quit and the whole
    application closes instantly, with no error, no traceback and no crash log. It reads exactly
    like a hard crash. Every exit path here raises this instead, and only the background/CLI entry
    point turns it back into a real process exit code."""
    def __init__(self, code):
        super().__init__("exit %d" % code)
        self.code = code


class SafeParser(argparse.ArgumentParser):
    """argparse calls sys.exit() itself on a bad flag or on --help — same GUI-killing problem as
    above, and the likelier one to hit first, since a typo in GUI_ARGS would take Blender down
    before any of our own checks ran."""
    def exit(self, status=0, message=None):
        if message:
            log(message.rstrip())
        raise Done(status)

    def error(self, message):
        log("! bad arguments: %s" % message)
        log("  usage: --inspect | --all | --id <modelId>   [--isolate auto|none|collection]")
        raise Done(2)


LOG_TEXT = "teammask.log"


def log_reset():
    """Start a fresh log datablock for this run.

    The Text Editor doesn't show stdout, and requiring the System Console to be open before you hit
    Run is a bad trade when the whole point is staying in the Scripting workspace. Everything is
    mirrored into a text datablock instead — pick `teammask.log` from the Text Editor's datablock
    dropdown and it's all there, scrollable, after the run finishes."""
    if not IN_GUI:
        return
    txt = bpy.data.texts.get(LOG_TEXT) or bpy.data.texts.new(LOG_TEXT)
    txt.clear()


def log(msg):
    """Blender's background stdout is noisy; a fixed prefix makes our lines greppable."""
    line = "[teammask] %s" % msg
    print(line)
    if IN_GUI:
        txt = bpy.data.texts.get(LOG_TEXT)
        if txt:
            txt.write(line + "\n")


def script_args(argv):
    """Blender takes everything before `--` for itself; our flags live after it.

    With no `--` on the command line there is nothing for us — which is the normal case when the
    script is run from the Text Editor rather than `blender -b ... -P ...` — so fall back to
    GUI_ARGS. Returning [] instead is what made a Text Editor run reach an exit path immediately."""
    if "--" in argv:
        return argv[argv.index("--") + 1:]
    if IN_GUI:
        log("no command line (running inside the Blender GUI) — using GUI_ARGS = %r" % (GUI_ARGS,))
        return list(GUI_ARGS)
    return []


def repo_root():
    """Locate the Fuzeball repo root, so masks land in assets/renders and not somewhere random.

    Three sources, in descending order of trust:
      1. __file__ — set when Blender runs the script with -P, absent in the Text Editor.
      2. The text datablock's own filepath — set when the .py was OPENED from disk into the Text
         Editor (Text ▸ Open), which is how the Scripting workflow normally goes. This is what
         makes GUI runs find the repo without being told.
      3. os.getcwd() — a genuine last resort. In the GUI this is wherever Blender was launched
         from, usually its install directory, so it is reported as a warning rather than used
         quietly. Set OUT_DIR at the top of the file if you ever see that."""
    try:
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    except NameError:
        pass
    for txt in bpy.data.texts:
        fp = getattr(txt, "filepath", "")
        if fp and os.path.basename(fp).lower() == "render_team_masks.py":
            resolved = bpy.path.abspath(fp)
            return os.path.dirname(os.path.dirname(resolved))
    log("  ! could not locate this script on disk — falling back to the working directory.")
    log("    If the output path below looks wrong, set OUT_DIR at the top of this file.")
    return os.getcwd()


def resolve_out_dir(explicit):
    """OUT_DIR / --out beats detection; detection beats guessing."""
    if explicit:
        return bpy.path.abspath(explicit)
    if OUT_DIR:
        return bpy.path.abspath(OUT_DIR)
    return os.path.join(repo_root(), "assets", "renders")


# ---------------------------------------------------------------------------
# Material + object discovery
# ---------------------------------------------------------------------------

def resolve_materials(wanted):
    """Map config.js material names onto the blend's ACTUAL material names.

    Case-insensitive on purpose: config.js is inconsistent (`kit_Grimlot` and `kit_kodus_centre`
    sit in the same roster) and the game only ever compares lowercased — so a case drift that is
    harmless at runtime would silently produce an empty matte here.

    Blender also uniquifies duplicate names as `kit_cyborg.001`, which is a DIFFERENT material to
    cryptomatte. Those are collected too, because a figurine whose kit got duplicated on import
    would otherwise matte only half its geometry."""
    resolved, missing = [], []
    all_names = [m.name for m in bpy.data.materials]
    lower = {n.lower(): n for n in all_names}
    for name in wanted:
        hit = lower.get(name.lower())
        dupes = [n for n in all_names
                 if n.lower().startswith(name.lower() + ".") and n[len(name) + 1:].isdigit()]
        if hit:
            resolved.append(hit)
        if dupes:
            resolved.extend(dupes)
            log("  note: %r also has numbered duplicates %s — including them" % (name, dupes))
        if not hit and not dupes:
            missing.append(name)
    return resolved, missing


def objects_using(material_names):
    """Every object with one of these materials in a slot."""
    want = {n.lower() for n in material_names}
    out = []
    for ob in bpy.data.objects:
        for slot in getattr(ob, "material_slots", []):
            if slot.material and slot.material.name.lower() in want:
                out.append(ob)
                break
    return out


def top_collections_of(objs):
    """The scene-level collections these objects sit under.

    Resolves each object's collection to its highest ancestor beneath the scene root, so a figurine
    split across `GRIMLOT/body` + `GRIMLOT/cloth` reports as `GRIMLOT` and isolation takes the whole
    character rather than half of it. An object parked directly in the scene root has no top-level
    collection of its own and reports nothing — that's the <NONE> case --inspect warns about."""
    scene_root = bpy.context.scene.collection

    top_of = {}                       # collection name → name of the top-level ancestor
    def walk(coll, top):
        if coll.name in top_of:
            return                    # already reached via another link; collections can be shared
        top_of[coll.name] = top
        for child in coll.children:
            walk(child, top)
    for child in scene_root.children:
        walk(child, child.name)

    tops = set()
    for ob in objs:
        for coll in ob.users_collection:
            if coll is scene_root:
                continue
            tops.add(top_of.get(coll.name, coll.name))
    return sorted(tops)


def hierarchy_of(objs):
    """Every object sharing a parent chain with one of these — the whole rig, not just the mesh.

    A figurine is often a body mesh plus separate eyes, teeth or an armature, and only some of
    those carry a named material we know about. They are almost always parented together, so
    walking to the root and back down catches the parts that material lookup alone misses. With the
    cast stacked on the world origin, a part left behind is a part standing inside the next
    figurine's portrait."""
    def root_of(ob):
        seen = set()
        while ob.parent is not None and ob.parent.name not in seen:
            seen.add(ob.name)
            ob = ob.parent
        return ob

    roots = {root_of(ob) for ob in objs}
    out = set(objs)
    for ob in bpy.data.objects:
        if root_of(ob) in roots:
            out.add(ob)
    return out


def figurine_object_map():
    """model id → every object belonging to that figurine.

    Seeded from the figurine's kit AND hair materials — every one of those names is unique to a
    single character, so 'which objects are Grimlot' is answerable with no naming convention on the
    objects themselves — then grown along the parent hierarchy to pick up unnamed parts.

    Hair is used for attribution only. It is never fed to Cryptomatte: hair must keep its own
    colour, which is the entire reason config.js keeps hairParts separate from teamParts."""
    out = {}
    for model_id, entry in FIGURINES.items():
        team, _ = resolve_materials(entry["team"])
        hair, _ = resolve_materials(entry.get("hair", []))
        if not team:
            continue                      # no kit → nothing to matte → not our problem
        objs = objects_using(team + hair)
        if objs:
            out[model_id] = sorted(hierarchy_of(objs), key=lambda o: o.name)
    return out


def kit_objects(model_id):
    """Just the kit-material carriers — used for reporting, not for isolation."""
    team, _ = resolve_materials(FIGURINES[model_id]["team"])
    return objects_using(team) if team else []


def expand_to_collections(objs):
    """Grow a set of kit-bearing objects to every object in the same top-level collection.

    A figurine is more than its kit: hiding the others has to hide their heads and hands too, and
    those objects carry no kit material. If the character isn't in a collection of its own this
    falls back to the kit objects alone, which is why --inspect is worth running first."""
    names = top_collections_of(objs)
    grown = set(objs)
    for name in names:
        coll = bpy.data.collections.get(name)
        if coll:
            grown.update(coll.all_objects)
    return grown, names


def walk_layer_collections(root):
    """Every LayerCollection under `root`, depth first.

    Layer collections are the per-view-layer wrapper around a collection, and `exclude` (the
    checkbox in the outliner) lives there rather than on the collection itself. It is a separate
    switch from hide_render and will blank a render on its own."""
    out = [root]
    for child in root.children:
        out.extend(walk_layer_collections(child))
    return out


def shared_collections(fig_objs):
    """Top-level collections that more than one figurine resolves to.

    This is the check that makes collection-based isolation safe. A staging collection that several
    characters have been linked into — anything called 'render collection', 'WORLD' and so on — is
    not a per-character grouping, and expanding to it means 'isolating' one figurine keeps all the
    others on screen while hiding nothing. Auto mode drops to object isolation when it sees one,
    rather than confidently rendering twenty identical wrong masks."""
    owners = {}
    for model_id, objs in fig_objs.items():
        for name in top_collections_of(objs):
            owners.setdefault(name, []).append(model_id)
    return {name: ids for name, ids in owners.items() if len(ids) > 1}


def isolation_set(model_id, fig_objs, mode, conf, shared):
    """The objects to KEEP visible for this figurine, plus a label describing how we chose them.

      collection  Explicit collection from the manifest. Trusted as given.
      auto        The figurine's own top-level collection, but ONLY if no other figurine claims it.
                  A staging collection holding the whole cast cannot isolate anything, so auto
                  drops to `stacked` when it sees one.
      stacked     This figurine's objects, everything else hidden. The correct mode when the cast
                  is stacked on the world origin and picked by visibility.
      objects     Same keep-set as stacked; they differ in what gets HIDDEN (see export_mask)."""
    mine = set(fig_objs.get(model_id, []))

    if mode == "collection" and conf.get("collection"):
        coll = bpy.data.collections.get(conf["collection"])
        if coll:
            return set(coll.all_objects), "collection %r" % coll.name
        log("  ! collection %r not found — falling back" % conf["collection"])

    if mode in ("auto", "collection"):
        grown, names = expand_to_collections(fig_objs.get(model_id, []))
        clashes = [n for n in names if n in shared]
        if names and not clashes:
            return grown, "collection %s" % ", ".join(names)
        if clashes:
            others = sorted(set(sum((shared[c] for c in clashes), [])) - {model_id})
            log("  ! %s also holds %d other figurines — isolating by it would keep them all on "
                "screen. Using this figurine's own objects instead."
                % (", ".join(clashes), len(others)))

    return mine, "own objects (%s)" % (", ".join(o.name for o in sorted(mine, key=lambda o: o.name))
                                       or "NONE")


# ---------------------------------------------------------------------------
# Compositor — 4.x and 5.x take different routes to the same graph
# ---------------------------------------------------------------------------

def build_compositor(scene, matte_id):
    """Wire: Render Layers → Cryptomatte(Matte) → SetAlpha over white → output.

    Blender 5.0 moved the compositor onto `scene.compositing_node_group` (a real node group,
    terminated by a Group Output whose FIRST image socket becomes the render result) and dropped
    `scene.use_nodes` / `scene.node_tree` along with the Composite node. 4.x still wants the old
    shape, so both are built here.

    The white RGB is only a carrier for the matte's alpha. We never read the colour channels at
    runtime — writing white rather than the beauty pass keeps the file tiny and makes the mask
    obvious if you open it."""
    if IS_5X:
        tree = bpy.data.node_groups.new(name="FZ_TeamMask", type="CompositorNodeTree")
        tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        out_node = tree.nodes.new("NodeGroupOutput")
        scene.compositing_node_group = tree
    else:
        scene.use_nodes = True
        tree = scene.node_tree
        for node in list(tree.nodes):
            tree.nodes.remove(node)
        out_node = tree.nodes.new("CompositorNodeComposite")
        out_node.use_alpha = True
    out_node.location = (140, 0)

    rl = tree.nodes.new("CompositorNodeRLayers")
    rl.scene = scene
    rl.location = (-620, 0)

    crypto = tree.nodes.new("CompositorNodeCryptomatteV2")
    crypto.location = (-360, 0)
    crypto.source = "RENDER"
    crypto.scene = scene
    # layer_name's enum items are generated from the render's available crypto layers, which may
    # not be listed yet in a blend where the pass was only just switched on. Guarded rather than
    # allowed to abort a 20-figurine batch.
    try:
        crypto.layer_name = "CryptoMaterial"
    except (TypeError, ValueError):
        log("  ! could not set layer_name='CryptoMaterial' — using node default")
    crypto.matte_id = matte_id

    white = tree.nodes.new("CompositorNodeRGB")
    white.location = (-360, -230)
    white.outputs[0].default_value = (1.0, 1.0, 1.0, 1.0)

    set_alpha = tree.nodes.new("CompositorNodeSetAlpha")
    set_alpha.location = (-110, 0)
    try:
        set_alpha.mode = "REPLACE_ALPHA"
    except (AttributeError, TypeError):
        pass  # pre-2.93 SetAlpha has no mode and already replaces

    tree.links.new(white.outputs[0], set_alpha.inputs["Image"])
    tree.links.new(crypto.outputs["Matte"], set_alpha.inputs["Alpha"])
    tree.links.new(set_alpha.outputs["Image"], out_node.inputs[0])
    return tree


def clear_compositor(scene, tree):
    """Drop the temporary graph so a batch doesn't leave 20 orphan node groups in bpy.data, and so
    a figurine's matte_id can never leak into the next one's render."""
    if IS_5X:
        scene.compositing_node_group = None
        if tree and tree.users == 0:
            bpy.data.node_groups.remove(tree)
    else:
        scene.use_nodes = False


def quote_matte_id(names):
    """matte_id is a comma-separated list; names with a comma or space need quoting or the node
    splits them in the wrong place."""
    return ",".join('"%s"' % n if ("," in n or " " in n) else n for n in names)


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------

def configure_render(scene, scale, samples):
    """Cheapen the render as far as the matte allows and force straight RGBA PNG out.

    Cryptomatte is a coverage/ID pass, not light transport — it does not need the sample count the
    beauty render did. Colour management is pinned to Standard because alpha is never
    colour-managed but a Filmic/AgX view transform would tonemap the white RGB to grey and make the
    file confusing to inspect by hand."""
    scene.render.resolution_percentage = scale
    scene.render.film_transparent = True

    img = scene.render.image_settings
    img.file_format = "PNG"
    img.color_mode = "RGBA"
    img.color_depth = "8"
    img.compression = 90
    try:
        img.color_management = "OVERRIDE"
        img.view_settings.view_transform = "Standard"
        img.view_settings.look = "None"
    except (AttributeError, TypeError):
        pass

    cy = getattr(scene, "cycles", None)
    if cy is not None:
        for attr, val in (("samples", samples), ("use_denoising", False),
                          ("use_adaptive_sampling", False)):
            try:
                setattr(cy, attr, val)
            except (AttributeError, TypeError):
                pass

    for vl in scene.view_layers:
        try:
            vl.use_pass_cryptomatte_material = True
            vl.pass_cryptomatte_depth = 6
        except AttributeError:
            log("  ! this view layer has no cryptomatte material pass property")
        for unused in ("use_pass_cryptomatte_object", "use_pass_cryptomatte_asset"):
            if hasattr(vl, unused):
                setattr(vl, unused, False)   # we don't read these; they cost render time


def check_aspect(scene, out_dir, stem):
    """Warn if the mask's aspect doesn't match the beauty render already on disk.

    This is the cheap early catch for 'the camera in this blend is no longer framed the way it was
    when render_<stem>_cycles.png was made'. The mask is applied with mask-size:contain against the
    portrait's object-fit:contain, so resolution may differ freely but ASPECT may not — a mismatch
    slides the matte off the figurine."""
    existing = os.path.join(out_dir, "render_%s_cycles.png" % stem)
    if not os.path.exists(existing):
        return
    try:
        img = bpy.data.images.load(existing, check_existing=False)
        ew, eh = img.size
        bpy.data.images.remove(img)
    except Exception:
        return
    if not ew or not eh:
        return
    have = scene.render.resolution_x / float(scene.render.resolution_y)
    want = ew / float(eh)
    if abs(have - want) > 0.01:
        log("  ! ASPECT MISMATCH — %s is %dx%d (%.3f) but this scene renders %.3f. The mask will "
            "not line up; check the camera and resolution used for the original render."
            % (os.path.basename(existing), ew, eh, want, have))


def alpha_coverage(path):
    """Percentage of the written mask that is actually matted.

    Cheap post-flight check. Loading it back is the only way to know the render produced anything:
    an empty frame writes a perfectly valid, correctly sized, fully transparent PNG."""
    try:
        img = bpy.data.images.load(path, check_existing=False)
        px = list(img.pixels)
        bpy.data.images.remove(img)
    except Exception:
        return None
    if not px:
        return None
    alphas = px[3::4]
    return 100.0 * sum(1 for a in alphas if a > 0.5) / len(alphas)


def render_to(scene, path):
    """Render the still and guarantee it lands at exactly `path`.

    write_still normally honours the filepath verbatim, but some version/format combinations append
    a frame number. Rather than depend on it, render to an extension-less base and reconcile
    whatever actually appeared."""
    base = os.path.splitext(path)[0]
    scene.render.filepath = base
    scene.render.use_file_extension = True
    bpy.ops.render.render(write_still=True)

    if os.path.exists(path):
        return path
    for candidate in sorted(glob.glob(base + "*.png")):
        if candidate != path:
            if os.path.exists(path):
                os.remove(path)
            os.rename(candidate, path)
            return path
    return None


# ---------------------------------------------------------------------------
# Per-figurine export
# ---------------------------------------------------------------------------

def export_mask(model_id, out_dir, args, fig_objs, overrides, shared):
    """Export one figurine's mask from the currently open blend."""
    entry = FIGURINES[model_id]
    stem = entry["stem"]
    scene = bpy.context.scene

    resolved, missing = resolve_materials(entry["team"])
    log("%s → %s" % (model_id, stem))
    log("  materials: %s" % (resolved or "NONE"))
    for name in missing:
        log("  ! not in this blend: %r — check teamParts in js/config.js against the blend" % name)
    if not resolved:
        log("  ! nothing to matte, skipping")
        return False

    conf = overrides.get(model_id, {})
    hidden = []
    revealed_obs, revealed_colls, revealed_lcs = [], [], []
    prev_cam = scene.camera

    try:
        # --- camera ---
        cam_name = conf.get("camera")
        if cam_name:
            cam = bpy.data.objects.get(cam_name)
            if cam:
                scene.camera = cam
                log("  camera: %s" % cam_name)
            else:
                log("  ! camera %r not found, using scene camera %s"
                    % (cam_name, prev_cam.name if prev_cam else "<none>"))

        # --- isolation ---
        if args.isolate != "none":
            keep, how = isolation_set(model_id, fig_objs, args.isolate, conf, shared)
            log("  keeping: %s" % how)
            if not keep:
                log("  ! nothing left visible for this figurine — check --inspect")

            # WHAT GETS HIDDEN. With the cast stacked on the world origin, "hide the other
            # figurines" is not enough: any mesh we failed to attribute to a character is standing
            # in the same spot and lands in the shot. So in stacked/auto mode we hide every MESH in
            # the staging collections that isn't this figurine's, attributed or not.
            #
            # Only meshes. Lights, empties, armatures and the camera are left exactly as the blend
            # has them — hiding a key light would change the render the mask has to match, and an
            # armature drives the pose we need kept.
            candidates = set()
            for other_id, objs in fig_objs.items():
                if other_id != model_id:
                    candidates.update(objs)
            if args.isolate in ("auto", "stacked"):
                for name in shared:
                    coll = bpy.data.collections.get(name)
                    if coll:
                        candidates.update(o for o in coll.all_objects if o.type == "MESH")

            stray = 0
            for ob in candidates:
                if ob in keep or ob.hide_render or ob.type != "MESH":
                    continue
                ob.hide_render = True
                hidden.append(ob)
                if not any(ob in objs for objs in fig_objs.values()):
                    stray += 1
            log("  hid %d meshes (%d of them unattributed to any figurine)" % (len(hidden), stray))

            # --- and make sure the SUBJECT is renderable ---
            # Hiding the others is only half the job. The workflow that produced the beauty renders
            # shows one character at a time, so whichever figurines were switched off when the
            # blend was last saved are STILL off — and a figurine sitting in a disabled collection
            # renders an empty frame, which comes out as a fully transparent mask that silently
            # tints nothing. Three separate switches can each do it, so all three are cleared here
            # and restored afterwards:
            #   object.hide_render      the camera icon on the object
            #   collection.hide_render  the camera icon on the collection
            #   layer_collection.exclude the checkbox — removes it from the view layer entirely
            for ob in keep:
                if ob.hide_render:
                    ob.hide_render = False
                    revealed_obs.append(ob)
                for coll in ob.users_collection:
                    if coll.hide_render:
                        coll.hide_render = False
                        revealed_colls.append(coll)
            keep_colls = {c for ob in keep for c in ob.users_collection}
            for lc in walk_layer_collections(scene.view_layers[0].layer_collection):
                if lc.exclude and lc.collection in keep_colls:
                    lc.exclude = False
                    revealed_lcs.append(lc)
            if revealed_obs or revealed_colls or revealed_lcs:
                log("  un-hid the subject: %d objects, %d collections, %d excluded layers"
                    % (len(revealed_obs), len(revealed_colls), len(revealed_lcs)))

        if args.dry_run:
            return not missing

        configure_render(scene, args.scale, args.samples)
        check_aspect(scene, out_dir, stem)
        tree = build_compositor(scene, quote_matte_id(resolved))
        try:
            written = render_to(scene, os.path.join(out_dir, "render_%s_teammask.png" % stem))
        finally:
            clear_compositor(scene, tree)

        if not written:
            log("  ! render produced no file")
            return False
        log("  wrote %s (%.0f KB)" % (os.path.basename(written),
                                      os.path.getsize(written) / 1024.0))
        cov = alpha_coverage(written)
        if cov is not None:
            log("  matte covers %.1f%% of the frame" % cov)
            # A blank matte is the failure that LOOKS like success: the file exists, it's the right
            # size, and the tape silently tints nothing. Almost always means the figurine wasn't
            # actually visible for its own render.
            if cov < 0.5:
                log("  ! MATTE IS EMPTY — this figurine rendered nothing. Check that its objects "
                    "and collections are enabled for rendering.")
                return False
        return not missing

    finally:
        # Leave the blend exactly as we found it — this runs in the GUI against the file the user
        # has open, so a half-restored visibility state would be theirs to untangle by hand.
        for ob in hidden:
            ob.hide_render = False        # the hide pass only ever touched visible objects
        for ob in revealed_obs:
            ob.hide_render = True
        for coll in revealed_colls:
            coll.hide_render = True
        for lc in revealed_lcs:
            lc.exclude = True
        scene.camera = prev_cam


def world_centre(objs):
    """Mean world-space origin of these objects — enough to tell 'all stacked on one spot' from
    'spread across the scene', which decides whether hiding the cast is sufficient to frame one."""
    if not objs:
        return None
    n = float(len(objs))
    return tuple(sum(ob.matrix_world.translation[i] for ob in objs) / n for i in range(3))


def in_camera_frame(objs):
    """Is this figurine inside the active camera's frustum right now?

    The decisive diagnostic for a one-scene blend: if exactly one character is in frame and the
    rest sit outside it, framing is positional and hiding the others changes nothing. If they are
    ALL in frame, they're stacked on one spot and visibility is what picks the subject."""
    scene = bpy.context.scene
    cam = scene.camera
    if not cam or not objs:
        return None
    try:
        from bpy_extras.object_utils import world_to_camera_view
    except ImportError:
        return None
    for ob in objs:
        try:
            co = world_to_camera_view(scene, cam, ob.matrix_world.translation)
        except Exception:
            return None
        if 0.0 <= co.x <= 1.0 and 0.0 <= co.y <= 1.0 and co.z > 0.0:
            return True
    return False


def renders_now(objs):
    """Would these objects appear in a render as the blend currently stands?

    Checks the object flag and its collections' render flags. Combined with in_camera_frame this
    reconstructs the workflow that made the beauty renders without anyone having to remember it."""
    for ob in objs:
        if ob.hide_render:
            continue
        if any(c.hide_render for c in ob.users_collection):
            continue
        return True
    return False


def inspect(fig_objs):
    """Report the blend's structure without rendering. Run this first."""
    scene = bpy.context.scene
    log("Blender %s — compositor API: %s"
        % (".".join(str(v) for v in bpy.app.version), "5.x node group" if IS_5X else "4.x node_tree"))
    log("scene: %r   camera: %s   %dx%d"
        % (scene.name, scene.camera.name if scene.camera else "<NONE>",
           scene.render.resolution_x, scene.render.resolution_y))
    log("cameras in blend: %s"
        % (", ".join(o.name for o in bpy.data.objects if o.type == "CAMERA") or "<none>"))
    log("top-level collections: %s"
        % (", ".join(c.name for c in scene.collection.children) or "<none>"))

    shared = shared_collections(fig_objs)
    if shared:
        log("")
        log("SHARED COLLECTIONS — these hold more than one figurine, so they cannot isolate:")
        for name, ids in sorted(shared.items(), key=lambda kv: -len(kv[1])):
            log("  %-22s %2d figurines: %s" % (name, len(ids), ", ".join(sorted(ids))))
        log("  Auto isolation falls back to kit objects for anything landing in one of these.")

    log("")
    log("FIGURINES FOUND (%d of %d in config.js):" % (len(fig_objs), len(FIGURINES)))
    in_frame, visible = [], []
    for model_id in FIGURINES:
        entry = FIGURINES[model_id]
        resolved, missing = resolve_materials(entry["team"])
        if model_id not in fig_objs:
            log("  -- %-14s %-10s not in this blend (missing materials: %s)"
                % (model_id, entry["stem"], ", ".join(missing) or "none, but no objects use them"))
            continue
        objs = fig_objs[model_id]
        grown, colls = expand_to_collections(objs)
        framed, shown = in_camera_frame(objs), renders_now(objs)
        if framed:
            in_frame.append(model_id)
        if shown:
            visible.append(model_id)
        ctr = world_centre(objs)
        log("  OK %-14s %-10s materials=%s" % (model_id, entry["stem"], resolved))
        log("     kit objects: %s" % ", ".join(o.name for o in objs[:6])
            + (" (+%d more)" % (len(objs) - 6) if len(objs) > 6 else ""))
        log("     collection : %s%s"
            % (", ".join(colls) if colls else "<NONE>",
               "  [SHARED]" if any(c in shared for c in colls) else ""))
        log("     at %s   renders now: %s   in camera frame: %s"
            % ("(%.1f, %.1f, %.1f)" % ctr if ctr else "?",
               "yes" if shown else "NO",
               {True: "yes", False: "no", None: "?"}[framed]))
        if missing:
            log("     ! MISSING  : %s  — in config.js teamParts but not in this blend"
                % ", ".join(missing))
    # Anything in a staging collection we could not attribute to a figurine. With the cast stacked
    # on the origin these are the leak risk — they stand inside every portrait, and only `stacked`
    # isolation hides them.
    attributed = set()
    for objs in fig_objs.values():
        attributed.update(o.name for o in objs)
    orphans = []
    for name in shared:
        coll = bpy.data.collections.get(name)
        if not coll:
            continue
        for ob in coll.all_objects:
            if ob.type == "MESH" and ob.name not in attributed:
                orphans.append("%s  (in %s)" % (ob.name, name))
    if orphans:
        log("")
        log("UNATTRIBUTED MESHES in the staging collections (%d):" % len(orphans))
        for o in orphans[:25]:
            log("  %s" % o)
        if len(orphans) > 25:
            log("  … +%d more" % (len(orphans) - 25))
        log("  These belong to no figurine this script can identify. --isolate stacked hides them;")
        log("  --isolate objects would leave them standing in every portrait.")

    log("")
    log("masks would be written to: %s" % resolve_out_dir(None))
    log("  set OUT_DIR at the top of this file if that isn't your repo's assets/renders")
    log("")
    log("SUMMARY: %d figurines currently render, %d sit inside the camera frame."
        % (len(visible), len(in_frame)))
    if len(in_frame) > 1:
        log("  More than one in frame → the subject is picked by TOGGLING VISIBILITY, so isolation")
        log("  has to hide the rest. --isolate stacked (the auto fallback) is the right mode.")
    elif len(in_frame) == 1:
        log("  Exactly one in frame (%s) → framing is POSITIONAL: the characters are parked in"
            % in_frame[0])
        log("  different places and this camera only ever sees that one. Hiding the others changes")
        log("  nothing, so a per-figurine camera or a move-to-mark step is needed for the rest.")
    log("  In frame: %s" % (", ".join(in_frame) or "<none>"))


def report_mask_stems(out_dir, rendered):
    """Print the MASK_STEMS line to paste into js/league.js.

    Built from what is ON DISK, not from what this run produced: a partial run (--id, or one
    figurine failing) must not drop the stems that were already exported, and a stem listed in
    league.js whose file is missing is the one way to reintroduce the 404 this list exists to
    prevent. Blank mattes are excluded — a mask that tints nothing is a fetch for no reason."""
    have = []
    for entry in FIGURINES.values():
        stem = entry["stem"]
        path = os.path.join(out_dir, "render_%s_teammask.png" % stem)
        if not os.path.exists(path):
            continue
        cov = alpha_coverage(path)
        if cov is not None and cov < 0.5:
            log("  (excluding %s from MASK_STEMS — its matte is empty)" % stem)
            continue
        have.append(stem)

    log("")
    log("PASTE THIS INTO js/league.js (replacing the existing MASK_STEMS):")
    log("")
    line, out = " ", []
    for stem in have:
        piece = "'%s'," % stem
        if len(line) + len(piece) > 96:
            out.append(line)
            line = " "
        line += piece
    out.append(line)
    log("const MASK_STEMS=new Set([")
    for row in out:
        log(row)
    log("]);")
    log("")


def main():
    """Raises Done(code) rather than exiting — see the Done docstring for why that matters."""
    log_reset()
    ap = SafeParser(prog="render_team_masks.py", add_help=False)
    ap.add_argument("-h", "--help", action="store_true", help="show this and stop")
    ap.add_argument("--inspect", action="store_true", help="report blend structure, render nothing")
    ap.add_argument("--all", action="store_true", help="every figurine found in this blend")
    ap.add_argument("--id", help="single model id from config.js, e.g. alienGrimlot")
    ap.add_argument("--manifest", help="JSON of per-figurine {collection, camera} overrides")
    ap.add_argument("--isolate", choices=["auto", "stacked", "objects", "collection", "none"],
                   default="auto", help="how to hide the rest of the cast (default auto)")
    ap.add_argument("--out", help="output directory (default <repo>/assets/renders)")
    ap.add_argument("--scale", type=int, default=50, help="resolution percentage (default 50)")
    ap.add_argument("--samples", type=int, default=32, help="Cycles samples (default 32)")
    ap.add_argument("--dry-run", action="store_true", help="resolve and isolate, render nothing")
    args = ap.parse_args(script_args(sys.argv))

    if args.help:
        log(ap.format_help())
        raise Done(0)

    log("Blender %s | %s | compositor: %s"
        % (".".join(str(v) for v in bpy.app.version),
           "GUI" if IN_GUI else "background",
           "5.x node group" if IS_5X else "4.x node_tree"))

    fig_objs = figurine_object_map()
    shared = shared_collections(fig_objs)

    # No mode flag is a mistake, not a request to quit — report and stop cleanly. Reaching a bare
    # sys.exit() here is what closed Blender the instant the script ran from the Text Editor.
    if not (args.inspect or args.all or args.id):
        log("! need one of --inspect, --all, or --id.")
        log("  Running from the Text Editor? Set GUI_ARGS near the top of this file — it's")
        log("  currently %r." % (GUI_ARGS,))
        raise Done(2)

    if args.inspect:
        inspect(fig_objs)
        raise Done(0)

    out_dir = resolve_out_dir(args.out)
    if not args.dry_run:
        os.makedirs(out_dir, exist_ok=True)
    log("output dir: %s" % out_dir)

    overrides = {}
    if args.manifest:
        import json
        with open(args.manifest, "r", encoding="utf-8") as fh:
            overrides = json.load(fh)

    if args.id:
        if args.id not in FIGURINES:
            log("! unknown model id %r — known: %s" % (args.id, ", ".join(sorted(FIGURINES))))
            raise Done(2)
        targets = [args.id]
    else:
        targets = [m for m in FIGURINES if m in fig_objs]
        log("rendering %d figurines found in this blend" % len(targets))
        if not targets:
            log("! no figurine materials found in this blend — run --inspect to see why")
            raise Done(1)

    ok = True
    good = []
    for model_id in targets:
        won = export_mask(model_id, out_dir, args, fig_objs, overrides, shared)
        ok &= won
        if won:
            good.append(FIGURINES[model_id]["stem"])

    # Emit the MASK_STEMS line for js/league.js. The tape declares which stems have a matte rather
    # than probing for one, because a probe means a 404 in the console for every figurine that
    # hasn't been exported yet — fine in dev, but it reads as a broken game in a shipping build.
    # Declaring it costs this copy-paste step; printing the exact line is what stops it drifting.
    if good and not args.dry_run:
        report_mask_stems(out_dir, good)

    log("done — %s" % ("all masks resolved cleanly" if ok else "COMPLETED WITH WARNINGS (see !)"))
    raise Done(0 if ok else 1)


def run():
    """The ONLY place allowed to touch sys.exit, and only when Blender is headless.

    In the GUI the exit code is just logged: killing the app on a bad flag is never the right
    behaviour there, and an uncaught exception would otherwise land in a place the user can't see
    unless the System Console happens to be open."""
    try:
        main()
    except Done as d:
        if IN_GUI:
            log("finished (status %d)" % d.code)
            if d.code:
                log("Nothing was rendered. Read the ! lines above.")
        else:
            sys.exit(d.code)
    except Exception:
        import traceback
        log("UNHANDLED ERROR — traceback follows:")
        traceback.print_exc()
        if not IN_GUI:
            sys.exit(1)


# Blender's Text Editor executes the file with __name__ == '__main__' just like the CLI does, so a
# single entry point covers both. Nothing below this line may call sys.exit directly.
if __name__ == "__main__":
    run()
