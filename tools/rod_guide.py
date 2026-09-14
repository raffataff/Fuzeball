"""
rod_guide.py  --  Fuzeball rod alignment guide.

WHAT IT DOES
    Builds a throwaway "ROD GUIDE" collection of markers showing exactly where the
    game puts everything on a rod: each player, the lane he owns, the side walls,
    how far the rod slides, and the plane your rubber bumper has to land on. Model
    your rod against it, then delete the collection before export.

HOW TO USE
    1. Blender -> Scripting tab -> Open -> pick this file.
    2. Press Run Script.
    3. Markers appear in a "ROD GUIDE" collection. Run again any time -- it wipes
       and rebuilds itself. Delete the collection when you're done.

    By default you get ONE rod (the 5-man) sitting on the world origin, which is
    where your rod .blend already has its bar. Change ROD to 1, 2 or 3 for the
    others, or set MODE to 'SPREAD' / 'TABLE' -- but those get busy, so start here.

IF IT LOOKS LIKE A BLACK SCRIBBLE
    The guides are colour coded, but Blender only shows object colour when you
    tell it to. The script tries to set this for you. If it's still black:
        Viewport Shading dropdown (top right of the 3D view) -> Color -> Object
    Everything is also split into four sub-collections per rod -- players,
    slide+bumpers, hardware, labels. Untick the ones you don't need in the
    outliner and the clutter goes away.
    For guaranteed colour set STYLE = 'SOLID' below and switch the viewport to
    Material Preview; the guides become see-through coloured volumes instead.

THE FRAME IT BUILDS IN
    X = along the table, goal to goal
    Y = along the rod, the slide direction, handle on +Y
    Z = up
    ONE and SPREAD put the bar centre line on Z 0, the same place your rod .blend
    has it, so the pitch sits below at Z -7.5. TABLE drops the pitch to Z 0 and
    lays out all eight rods where they really live.

THE MARKERS
    root            drag this to move a whole guide
    origin          your rod's origin goes here (bar centre)
    axis, bar_tip   bar centre line, and how far the bar has to reach
    handle, knob    where the game's stock handle sits
    collar          the stopper on the far end
    manN_pin        that player's centre on the bar
    laneN           the boundary between two players -- cross it and men collide
    manN_leg        leg, bar down to the boot
    manN_foot       the boot's kick box, what the ball actually hits
    travel          the strip of pitch the players sweep
    wall            the side wall's inner face, rod at rest
    wall_slid       that same face as the rod sees it at FULL slide
    bumper_stop     ** your rubber bumper's outer face goes on this ring **
    bumper_space    the room you have between boot and wall
    ball_ref        a ball, for scale

    Numbers also land in a text block called "rod_guide_numbers" -- open it in the
    Text Editor if you want them written out.

Everything below mirrors js/config.js. Retune rods there, retune them here.
"""

import bpy
import math

# ----------------------------------------------------------------- settings
MODE  = 'ONE'     # 'ONE'    one rod on the world origin  (start here)
                  # 'SPREAD' all four sizes side by side
                  # 'TABLE'  the whole table, all eight rods, pitch at Z 0
ROD   = 5         # which rod 'ONE' builds: 1 = GK, 2 = DEF, 3 = ATT, 5 = MID
GAP   = 34.0      # spacing between rods in SPREAD mode
STYLE = 'WIRE'    # 'WIRE'  outlines, never hides your model
                  # 'SOLID' see-through volumes, needs Material Preview shading

SHOW_HARDWARE = True    # stock handle / collar / bar ghosts
SHOW_FOOT     = True    # legs and kick boxes
SHOW_LABELS   = True
LOCK_GUIDES   = True    # stops you selecting guides while modelling

# --------------------------------------------------- numbers from js/config.js
TABLE_W    = 68.0     # table.W
TABLE_L    = 120.0    # table.L
WALL_H     = 10.0     # table.wallH
WALL_T     = 3.0      # side wall thickness
WALL_BASE  = -1.0     # wall bottom relative to the pitch

SPACING    = {2: 24.0, 3: 18.5}   # rods.spacing.two / .three
SPACING_D  = 11.9                 # rods.spacing.other
MARGIN     = 8.0                  # rods.margin
GK_SLIDE   = 11.0                 # rods.gkSlide
WALL_CLEAR = 2.5                  # rods.wallClear
HANDLE_LEN = 5.0                  # rods.handleLen
COLLAR_LEN = 2.4                  # rods.collarLen
CAP_OUT    = 3.0                  # rods.capOut

ROD_H      = 7.50     # physics.rodH -- bar height above the pitch
ARM        = 6.30     # physics.arm  -- bar down to boot
PRAD       = 1.0      # physics.prad -- player capsule radius
BALL_R     = 1.9      # physics.ballR
FOOT_BOX   = (1.3, 1.0, 1.35)   # physics.footBox half extents: along leg, across leg, along rod
FOOT_OFF   = (-0.65, 0.4)       # physics.footBoxOff, the second value flips with the team

BAR_R      = 0.55     # stock primitive rod, world.js dressRod
HANDLE_R   = 1.4
KNOB       = (0.9, 2.6, 0.9)
KNOB_X     = 1.6
COLLAR_R   = 1.1

# rods.defs -- x, team, men, role, slideCap
RODDEFS = [
    (-52.5, 0, 1, 'GK',  10.0),
    (-37.5, 0, 2, 'DEF', None),
    (-22.5, 1, 3, 'ATT', None),
    ( -7.5, 0, 5, 'MID', None),
    (  7.5, 1, 5, 'MID', None),
    ( 22.5, 0, 3, 'ATT', None),
    ( 37.5, 1, 2, 'DEF', None),
    ( 52.5, 1, 1, 'GK',  10.0),
]

# ------------------------------------------------------------------- colours
C_ORIGIN = (1.00, 1.00, 1.00, 1.00)
C_BAR    = (0.70, 0.72, 0.78, 1.00)
C_MAN    = (0.15, 1.00, 0.40, 1.00)
C_LANE   = (0.10, 0.55, 0.30, 0.25)
C_FOOT   = (0.75, 1.00, 0.25, 1.00)
C_TRAVEL = (0.20, 0.55, 1.00, 0.25)
C_WALL   = (0.75, 0.75, 0.80, 0.30)
C_SLID   = (1.00, 0.40, 0.05, 0.35)
C_BUMP   = (1.00, 0.85, 0.00, 1.00)
C_SPACE  = (0.85, 0.60, 0.00, 0.30)
C_HANDLE = (0.10, 0.75, 1.00, 1.00)
C_COLLAR = (1.00, 0.20, 0.80, 1.00)
C_BALL   = (1.00, 1.00, 1.00, 1.00)

ROOT_NAME = "ROD GUIDE"
MAT_TAG = "rodguide_"


# -------------------------------------------------------------------- maths
def spacing_of(men):
    return SPACING.get(men, SPACING_D)


def slide_of(men, role, cap):
    """The same expression world.js buildRods uses."""
    mo = (TABLE_W - MARGIN - (men - 1) * spacing_of(men)) / 2.0
    if cap is not None:
        mo = min(mo, cap)
    elif role == 'GK':
        mo = min(mo, GK_SLIDE)
    return mo


def collar_of(max_off):
    """world.js rodCollar -- bar centre to the far stopper."""
    return TABLE_W / 2.0 + WALL_T + WALL_CLEAR + max_off


def man_ys(men):
    sp = spacing_of(men)
    return [(i - (men - 1) / 2.0) * sp for i in range(men)]


def sign(s):
    return '+' if s > 0 else '-'


# --------------------------------------------------------------- scene bits
def wipe():
    old = bpy.data.collections.get(ROOT_NAME)
    dead = []
    if old:
        def strip(col):
            for child in list(col.children):
                strip(child)
            for ob in list(col.objects):
                if ob.data:
                    dead.append(ob.data)
                bpy.data.objects.remove(ob, do_unlink=True)
            bpy.data.collections.remove(col)
        strip(old)
    for d in dead:
        if d.users:
            continue
        if isinstance(d, bpy.types.Mesh):
            bpy.data.meshes.remove(d)
        elif isinstance(d, bpy.types.Curve):
            bpy.data.curves.remove(d)
    for m in list(bpy.data.materials):
        if m.name.startswith(MAT_TAG) and not m.users:
            bpy.data.materials.remove(m)


def mat_for(colour):
    """One shared material per colour, so the guides read in Material Preview too."""
    name = MAT_TAG + "%02x%02x%02x" % tuple(int(c * 255) for c in colour[:3])
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.diffuse_color = colour                       # viewport display colour
    m.use_nodes = True
    try:
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = colour[:3] + (1.0,)
        bsdf.inputs["Alpha"].default_value = colour[3]
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = colour[:3] + (1.0,)
            bsdf.inputs["Emission Strength"].default_value = 0.6
    except Exception:
        pass
    if colour[3] < 1.0:
        for attr, val in (("blend_method", 'BLEND'), ("surface_render_method", 'BLENDED')):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
        m.show_transparent_back = False
    return m


def finish(ob, col, colour, root, front=False):
    ob.color = colour
    if root is not None:
        ob.parent = root
    if LOCK_GUIDES:
        ob.hide_select = True
    ob.show_in_front = front
    col.objects.link(ob)
    return ob


def mesh_obj(name, verts, edges, faces, col, colour, root, loc=(0, 0, 0), front=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, edges, faces)
    me.update()
    me.materials.append(mat_for(colour))
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.display_type = 'WIRE' if (STYLE == 'WIRE' or not faces) else 'TEXTURED'
    ob.show_all_edges = True
    return finish(ob, col, colour, root, front)


def line(name, p0, p1, col, colour, root, front=False):
    return mesh_obj(name, [p0, p1], [(0, 1)], [], col, colour, root, front=front)


def box(name, centre, size, col, colour, root, front=False):
    hx, hy, hz = size[0] / 2.0, size[1] / 2.0, size[2] / 2.0
    v = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
         (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    f = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2),
         (2, 6, 7, 3), (3, 7, 4, 0)]
    return mesh_obj(name, v, [], f, col, colour, root, centre, front)


def quad(name, centre, corners, col, colour, root, front=False):
    return mesh_obj(name, corners, [], [(0, 1, 2, 3)], col, colour, root, centre, front)


def plane_y(name, y, x_half, z0, z1, col, colour, root, front=False):
    """A flat panel across the rod, at one Y."""
    v = [(-x_half, y, z0), (x_half, y, z0), (x_half, y, z1), (-x_half, y, z1)]
    return quad(name, (0, 0, 0), v, col, colour, root, front)


def _tube(name, pts_at, a, b, segs, rungs, col, colour, root, centre, front=False):
    v, e = [], []
    for end in (a, b):
        base = len(v)
        for j in range(segs):
            v.append(pts_at(end, 2.0 * math.pi * j / segs))
        e += [(base + j, base + (j + 1) % segs) for j in range(segs)]
    if rungs:
        step = max(1, segs // rungs)
        e += [(j, segs + j) for j in range(0, segs, step)]
    return mesh_obj(name, v, e, [], col, colour, root, centre, front)


def tube_y(name, y0, y1, r, centre, col, colour, root, segs=10, rungs=4, front=False):
    return _tube(name, lambda y, a: (r * math.cos(a), y, r * math.sin(a)),
                 y0, y1, segs, rungs, col, colour, root, centre, front)


def tube_z(name, z0, z1, r, centre, col, colour, root, segs=8, rungs=4, front=False):
    return _tube(name, lambda z, a: (r * math.cos(a), r * math.sin(a), z),
                 z0, z1, segs, rungs, col, colour, root, centre, front)


def ring_y(name, y, r, centre, col, colour, root, segs=16, front=True):
    v = [(r * math.cos(2 * math.pi * j / segs), y, r * math.sin(2 * math.pi * j / segs))
         for j in range(segs)]
    e = [(j, (j + 1) % segs) for j in range(segs)]
    return mesh_obj(name, v, e, [], col, colour, root, centre, front)


def ball(name, centre, r, col, colour, root, segs=12):
    v, e = [], []
    for axis in range(3):
        base = len(v)
        for j in range(segs):
            a = 2.0 * math.pi * j / segs
            c, s = r * math.cos(a), r * math.sin(a)
            v.append((c, s, 0.0) if axis == 0 else (c, 0.0, s) if axis == 1 else (0.0, c, s))
        e += [(base + j, base + (j + 1) % segs) for j in range(segs)]
    return mesh_obj(name, v, e, [], col, colour, root, centre)


def empty(name, loc, kind, size, col, colour, root, front=True):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = kind
    ob.empty_display_size = size
    ob.location = loc
    return finish(ob, col, colour, root, front)


def label(name, text, loc, size, col, root, align='LEFT'):
    if not SHOW_LABELS:
        return None
    cu = bpy.data.curves.new(name, type='FONT')
    cu.body = text
    cu.size = size
    cu.align_x = align
    cu.materials.append(mat_for(C_ORIGIN))
    ob = bpy.data.objects.new(name, cu)
    ob.location = loc
    return finish(ob, col, C_ORIGIN, root)


def sub(parent, name):
    c = bpy.data.collections.new(name)
    parent.children.link(c)
    return c


# ------------------------------------------------------------- one rod guide
def build_rod(parent, tag, x, team, men, role, cap, z_off, lbl=1.0, inline=True):
    """z_off shifts the whole table frame: 0 puts the pitch on the floor,
    -ROD_H puts the bar on the floor, which is how a rod .blend is authored."""
    max_off = slide_of(men, role, cap)
    sp = spacing_of(men)
    collar = collar_of(max_off)
    bar_half = collar + COLLAR_LEN + CAP_OUT
    ys = man_ys(men)
    outer = ys[-1]
    kick_dir = 1 if team == 0 else -1

    pitch_z = z_off                  # top of the pitch
    bar_z = ROD_H + z_off            # bar centre line
    foot_z = ROD_H - ARM + z_off     # boot centre
    kick_z = foot_z - FOOT_OFF[0]    # kick box centre

    wall_in = TABLE_W / 2.0          # inner wall face
    stop = wall_in - max_off         # where that face sits at full slide

    top = sub(parent, "%s %d man" % (role, men))
    g_men = sub(top, "%s players" % tag)
    g_slide = sub(top, "%s slide + bumpers" % tag)
    g_hw = sub(top, "%s hardware" % tag)
    g_txt = sub(top, "%s labels" % tag)

    root = bpy.data.objects.new("%s_root" % tag, None)
    root.empty_display_type = 'PLAIN_AXES'
    root.empty_display_size = 5
    root.location = (x, 0.0, 0.0)
    root.color = C_ORIGIN
    top.objects.link(root)

    # bar -------------------------------------------------------------------
    empty("%s_origin" % tag, (0, 0, bar_z), 'SPHERE', 2.5, top, C_ORIGIN, root)
    line("%s_axis" % tag, (0, -bar_half, bar_z), (0, bar_half, bar_z), top, C_BAR, root, True)
    for s in (1, -1):
        empty("%s_bar_tip%s" % (tag, sign(s)), (0, s * bar_half, bar_z),
              'PLAIN_AXES', 2.0, top, C_BAR, root)
    if SHOW_HARDWARE:
        tube_y("%s_bar" % tag, -bar_half, bar_half, BAR_R, (0, 0, bar_z),
               g_hw, C_BAR, root, segs=8, rungs=0)
        tube_y("%s_handle" % tag, collar, collar + HANDLE_LEN, HANDLE_R,
               (0, 0, bar_z), g_hw, C_HANDLE, root)
        box("%s_knob" % tag, (KNOB_X, collar + HANDLE_LEN / 2.0, bar_z), KNOB,
            g_hw, C_HANDLE, root)
        tube_y("%s_collar" % tag, -collar, -(collar + COLLAR_LEN), COLLAR_R,
               (0, 0, bar_z), g_hw, C_COLLAR, root)

    # players ---------------------------------------------------------------
    lane_top = bar_z + 2.0
    for i, y in enumerate(ys):
        n = "%s_man%d" % (tag, i + 1)
        empty(n + "_pin", (0, y, bar_z), 'PLAIN_AXES', 3.0, g_men, C_MAN, root)
        if SHOW_FOOT:
            tube_z(n + "_leg", bar_z, foot_z, PRAD, (0, y, 0), g_men, C_MAN, root)
            box(n + "_foot", (FOOT_OFF[1] * kick_dir, y, kick_z),
                (2 * FOOT_BOX[1], 2 * FOOT_BOX[2], 2 * FOOT_BOX[0]),
                g_men, C_FOOT, root, True)
    if men > 1:
        for i in range(men + 1):
            y = ys[0] - sp / 2.0 + i * sp
            plane_y("%s_lane%d" % (tag, i + 1), y, 3.0, pitch_z, lane_top,
                    g_men, C_LANE, root)
    ball_y = ys[0] - (sp / 2.0 if men > 1 else 8.0)
    ball("%s_ball_ref" % tag, (0, ball_y, pitch_z + BALL_R), BALL_R, g_men, C_BALL, root)

    # slide, walls, and where the bumper has to stop ------------------------
    reach = outer + max_off
    quad("%s_travel" % tag, (0, 0, pitch_z + 0.1),
         [(-3, -reach, 0), (3, -reach, 0), (3, reach, 0), (-3, reach, 0)],
         g_slide, C_TRAVEL, root)
    for s in (1, -1):
        sfx = sign(s)
        empty("%s_reach%s" % (tag, sfx), (0, s * reach, pitch_z + 0.3),
              'CIRCLE', 2.0, g_slide, C_TRAVEL, root)
        plane_y("%s_wall%s" % (tag, sfx), s * wall_in, 7.0,
                pitch_z + WALL_BASE, pitch_z + WALL_H, g_slide, C_WALL, root)
        plane_y("%s_wall_slid%s" % (tag, sfx), s * stop, 5.5,
                pitch_z + WALL_BASE, pitch_z + WALL_H, g_slide, C_SLID, root)
        ring_y("%s_bumper_stop%s" % (tag, sfx), s * stop, 3.0, (0, 0, bar_z),
               g_slide, C_BUMP, root)
        empty("%s_bumper_face%s" % (tag, sfx), (0, s * stop, bar_z),
              'SINGLE_ARROW', 4.0, g_slide, C_BUMP, root)
        inner = outer + PRAD + 0.5
        if stop - inner > 0.25:
            tube_y("%s_bumper_space%s" % (tag, sfx), s * inner, s * stop, 2.0,
                   (0, 0, bar_z), g_slide, C_SPACE, root, segs=10)

    # labels -----------------------------------------------------------------
    if SHOW_LABELS:
        head = "%s  %d man\nslide +/-%.1f\nbumper %.1f" % (role, men, max_off, stop)
        if men > 1:
            head += "\nspacing %.1f" % sp
        label("%s_lbl" % tag, head, (0, collar + HANDLE_LEN + 7.0, pitch_z + 0.4),
              2.2 * lbl, g_txt, root, align='CENTER')
        if inline:
            label("%s_lbl_bump" % tag, "bumper %.1f  (boot +%.1f)" % (stop, stop - outer),
                  (4.0, stop, bar_z), 1.5 * lbl, g_txt, root)
            label("%s_lbl_wall" % tag, "wall %.1f" % wall_in,
                  (4.0, wall_in, pitch_z + 0.4), 1.5 * lbl, g_txt, root)
            label("%s_lbl_tip" % tag, "bar tip %.1f" % bar_half,
                  (-10.0, bar_half, bar_z), 1.5 * lbl, g_txt, root)

    return dict(role=role, men=men, sp=sp, max_off=max_off, collar=collar,
                bar_half=bar_half, outer=outer, stop=stop, ys=ys)


def build_table(parent, z_off):
    col = sub(parent, "table")
    hw, hl = TABLE_W / 2.0, TABLE_L / 2.0
    quad("pitch", (0, 0, 0),
         [(-hl, -hw, z_off), (hl, -hw, z_off), (hl, hw, z_off), (-hl, hw, z_off)],
         col, C_TRAVEL, None)
    for s in (1, -1):
        plane_y("side_wall%s" % sign(s), s * hw, (TABLE_L + 10.0) / 2.0,
                z_off + WALL_BASE, z_off + WALL_H, col, C_WALL, None)


# ----------------------------------------------------------------------- run
def main():
    wipe()
    parent = bpy.data.collections.new(ROOT_NAME)
    bpy.context.scene.collection.children.link(parent)

    if MODE == 'TABLE':
        z_off = 0.0                       # pitch on the floor, rods up at 7.5
        build_table(parent, z_off)
        rows = [build_rod(parent, "r%d_%s" % (i, d[3]), d[0], d[1], d[2], d[3], d[4],
                          z_off, lbl=0.6, inline=False)
                for i, d in enumerate(RODDEFS)]
    else:
        z_off = -ROD_H                    # bar on the origin, how a rod is modelled
        sizes = [(1, 'GK', 10.0), (2, 'DEF', None), (3, 'ATT', None), (5, 'MID', None)]
        if MODE == 'ONE':
            sizes = [s for s in sizes if s[0] == ROD] or sizes[-1:]
            xs = [0.0]
        else:
            xs = [(i - (len(sizes) - 1) / 2.0) * GAP for i in range(len(sizes))]
        rows = [build_rod(parent, "%s%d" % (s[1], s[0]), xs[i], 0, s[0], s[1], s[2], z_off)
                for i, s in enumerate(sizes)]

    report(rows, z_off)
    tidy_viewports()


def tidy_viewports():
    """Colour by object, and kill the dotted parent lines that turn this into soup."""
    for scr in bpy.data.screens:
        for area in scr.areas:
            if area.type != 'VIEW_3D':
                continue
            for sp in area.spaces:
                if sp.type != 'VIEW_3D':
                    continue
                for attr in ("color_type", "wireframe_color_type"):
                    try:
                        setattr(sp.shading, attr, 'OBJECT')
                    except Exception:
                        pass
                try:
                    sp.overlay.show_relationship_lines = False
                except Exception:
                    pass


def report(rows, z_off):
    L = ["FUZEBALL ROD GUIDE",
         "mode %s     bar centre line at Z %.1f     pitch at Z %.1f"
         % (MODE, ROD_H + z_off, z_off), "",
         "%-5s %-4s %-8s %-9s %s" % ("rod", "men", "spacing", "slide", "men at Y")]
    for r in rows:
        L.append("%-5s %-4d %-8s +/-%-6.1f %s"
                 % (r['role'], r['men'], "%.1f" % r['sp'] if r['men'] > 1 else "-",
                    r['max_off'], ", ".join("%.1f" % y for y in r['ys'])))
    L += ["", "%-5s %-10s %-12s %-15s %-8s %-9s %s"
          % ("rod", "outer man", "bumper face", "boot to bumper", "collar", "bar tip", "bar length")]
    for r in rows:
        L.append("%-5s %-10.1f %-12.1f %-15.1f %-8.1f %-9.1f %.1f"
                 % (r['role'], r['outer'], r['stop'], r['stop'] - r['outer'],
                    r['collar'], r['bar_half'], r['bar_half'] * 2))
    L += ["",
          "BUMPER FACE is the wall's inner face (%.1f) pulled in by the slide." % (TABLE_W / 2.0),
          "Put the outer face of your rubber bumper on that ring and it kisses the",
          "wall exactly as the rod bottoms out. Further out and it buries itself in",
          "the wall; further in and the rod never reaches.",
          "",
          "BAR TIP is the minimum half length of the bar. Short of it, the rod pulls",
          "its own end inside the table at full slide.",
          "",
          "Mesh names the game recolours: 'handle' takes the team colour, 'collar'",
          "and 'knob' take the team glow. Everything else keeps its own material.",
          "Origin at the bar centre, bar down Y, handle on +Y, no rotation on export."]
    txt = "\n".join(L)
    print("\n" + txt + "\n")
    blk = bpy.data.texts.get("rod_guide_numbers") or bpy.data.texts.new("rod_guide_numbers")
    blk.clear()
    blk.write(txt)


main()
