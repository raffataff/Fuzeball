"""Scene settings, presets, and the conversion to engine parameters."""
import bpy
from bpy.props import (BoolProperty, EnumProperty, FloatProperty, FloatVectorProperty, IntProperty,
                       PointerProperty, StringProperty)
from bpy.types import PropertyGroup

PATTERNS = [
    ('EVEN', "Even", "Blue-noise seeds: pieces of similar size, no slivers", 'MESH_ICOSPHERE', 0),
    ('RANDOM', "Random", "Uniform random seeds: wildly varied piece sizes", 'PARTICLES', 1),
    ('IMPACT', "Impact", "Small shards around the impact point, larger ones further out", 'FORCE_FORCE', 2),
    ('RADIAL', "Radial", "Rings and spokes around the impact point, like cracked glass", 'LIGHT_SUN', 3),
    ('GRID', "Grid", "A regular lattice of cells with optional jitter", 'MESH_GRID', 4),
    ('SLICE', "Slices", "Parallel slabs along an axis", 'MOD_ARRAY', 5),
    ('CUSTOM', "Custom Points", "Use the vertices of another object as the fracture seeds", 'VERTEXSEL', 6),
]

MATERIALS = [
    ('PLASTIC', "Plastic", "1100 kg/m3"), ('CERAMIC', "Ceramic", "2400 kg/m3"), ('STONE', "Stone", "2600 kg/m3"),
    ('CONCRETE', "Concrete", "2400 kg/m3"), ('WOOD', "Wood", "700 kg/m3"), ('GLASS', "Glass", "2500 kg/m3"),
    ('METAL', "Metal", "7800 kg/m3"), ('RUBBER', "Rubber", "1100 kg/m3"), ('FOAM', "Foam", "60 kg/m3"),
]

_FIGURINE_SHARDS = dict(pattern='IMPACT', count=36, regularity=0.75, relax=2, impact_boost=6.0, impact_radius=0.55, size_variation=0.0,
                        rough=0.18, detail=0.2, merge_small=True, min_size=0.12, wave_speed=5.0, delay_jitter=2, material='PLASTIC')

PRESETS = {
    # Matches the game's existing figurine explosion clips, which js/fracture.js plays on the table: gravity in scene
    # units (Real Height 0), a gentle outward push, and pieces that land and stay close to where the figure stood.
    # Measured on the old clips: peak speed ~17 u/s, pieces land a median 3 / p90 5 / max 7 units from their start.
    'FIGURINE': dict(_FIGURINE_SHARDS, real_height=0.0, blast_speed=0.35, blast_up=0.2, blast_spread=0.15, speed_variation=0.1,
                     mass_influence=0.0, spin=0.6, bounce=0.1, friction=0.8, floor_friction=1.0, angular_damping=0.4, linear_damping=0.1),
    # The same shards as a real explosion: a 1 m statue blown apart. Fast and wide, and it leaves the table.
    'BURST': dict(_FIGURINE_SHARDS, real_height=1.0, blast_speed=3.2, blast_up=0.5, blast_spread=0.4, speed_variation=0.3,
                  mass_influence=0.5, spin=2.2, bounce=0.35, friction=0.5, floor_friction=0.7, angular_damping=0.1, linear_damping=0.04),
    'GLASS': dict(pattern='RADIAL', count=70, jitter=0.6, radial_layers=1, rough=0.0, detail=0.0, smooth_interior=False,
                  merge_small=True, min_size=0.1, blast_speed=1.8, blast_up=0.2, blast_spread=0.3, spin=1.5, wave_speed=0.0,
                  material='GLASS', bounce=0.2, friction=0.3),
    'CONCRETE': dict(pattern='EVEN', count=45, regularity=0.3, relax=0, size_variation=0.55, rough=0.35, detail=0.15, noise_scale=0.8,
                     merge_small=True, min_size=0.15, blast_speed=2.4, blast_up=0.3, blast_spread=0.5, spin=1.2, wave_speed=3.0,
                     material='CONCRETE', bounce=0.1, friction=0.8),
    'DEBRIS': dict(pattern='RANDOM', count=220, rough=0.06, detail=0.3, merge_small=True, min_size=0.3, blast_speed=4.5,
                   blast_up=0.5, blast_spread=0.6, spin=3.0, wave_speed=0.0, material='STONE', bounce=0.2, friction=0.6),
    'CHUNKS': dict(pattern='EVEN', count=14, regularity=0.85, relax=3, rough=0.22, detail=0.2, merge_small=True, min_size=0.2,
                   blast_speed=2.6, blast_up=0.4, blast_spread=0.35, spin=1.4, wave_speed=4.0, material='STONE', bounce=0.15, friction=0.7),
    'SLABS': dict(pattern='SLICE', count=12, axis='Z', jitter=0.35, rough=0.1, detail=0.2, merge_small=False, blast_speed=2.0,
                  blast_up=0.2, blast_spread=0.25, spin=1.0, wave_speed=6.0, material='WOOD', bounce=0.2, friction=0.6),
}
PRESET_ITEMS = [
    ('KEEP', "Keep Settings", "Leave every value as it is"),
    ('FIGURINE', "Figurine Collapse", "For the game: impact-weighted plastic shards that burst, fall and settle close to where the figure stood, like the existing explosion clips"),
    ('BURST', "Figurine Burst", "The same shards thrown apart like a real explosion: fast, wide, and it leaves the table"),
    ('GLASS', "Cracked Glass", "Radial shards, sharp flat faces"),
    ('CONCRETE', "Concrete Crumble", "Uneven rough chunks with a cascading collapse"),
    ('DEBRIS', "Fine Debris", "Many small fragments"),
    ('CHUNKS', "Big Chunks", "A few large pieces"),
    ('SLABS', "Slabs", "Parallel slices"),
]


def _preset_update(self, context):
    name = self.preset
    if name != 'KEEP' and name in PRESETS:
        for k, v in PRESETS[name].items():
            try:
                setattr(self, k, v)
            except Exception:
                pass


def _seed_update(self, context):
    if context.area:
        context.area.tag_redraw()


class ShardsmithSettings(PropertyGroup):
    # --- source / repair ---------------------------------------------------------------------------------
    use_modifiers: BoolProperty(name="Apply Modifiers", default=True,
                                description="Fracture the mesh as it is evaluated (modifiers and armature pose applied)")
    repair_normals: BoolProperty(name="Repair Normals", default=True,
                                 description="Make every shell consistently wound and outward-facing before fracturing")
    keep_cavities: BoolProperty(name="Keep Cavities", default=True,
                                description="An inward-facing shell inside another shell stays a hollow instead of being flipped solid")
    remove_buried: BoolProperty(name="Remove Buried Faces", default=True,
                                description="Drop faces that have solid on both sides (overlapping parts, internal walls)")
    weld: FloatProperty(name="Weld Distance", default=1e-6, min=0.0, max=1e-3, precision=7, step=1e-2,
                        description="Vertices closer than this fraction of the object size count as one when checking topology")
    interior_mode: EnumProperty(name="Interior", default='AUTO', items=[
        ('AUTO', "Auto", "Solid if the mesh is mostly closed, otherwise a hollow shell"),
        ('SOLID', "Solid", "Treat the mesh as a solid and fill the fracture faces"),
        ('SHELL', "Shell", "Fracture the surface only: no interior faces (cloth, single-sided sheets)"),
    ])
    report: StringProperty(default="", options={'HIDDEN'})

    # --- pattern -----------------------------------------------------------------------------------------
    preset: EnumProperty(name="Preset", items=PRESET_ITEMS, default='KEEP', update=_preset_update)
    pattern: EnumProperty(name="Pattern", items=PATTERNS, default='EVEN')
    count: IntProperty(name="Pieces", default=40, min=2, max=1500, soft_max=300, description="Number of fracture cells")
    seed: IntProperty(name="Seed", default=1, min=0, max=999999, description="Random seed: the same seed gives the same fracture")
    regularity: FloatProperty(name="Evenness", default=0.7, min=0.0, max=1.0, subtype='FACTOR',
                              description="0 is random clumping, 1 is as even as possible")
    relax: IntProperty(name="Relaxation", default=2, min=0, max=10, description="Lloyd iterations that even out the cell sizes")
    distribution: EnumProperty(name="Seeds In", default='VOLUME', items=[
        ('VOLUME', "Volume", "Seeds anywhere inside the solid"),
        ('SURFACE', "Surface", "Seeds on the surface only: thin flaky shards"),
        ('MIXED', "Mixed", "A share of the seeds on the surface, the rest inside"),
    ])
    surface_ratio: FloatProperty(name="Surface Share", default=0.35, min=0.0, max=1.0, subtype='FACTOR')
    origin_mode: EnumProperty(name="Impact Point", default='CENTER', items=[
        ('CENTER', "Center", "Center of the object"),
        ('BASE', "Base", "Bottom center of the object"),
        ('CURSOR', "3D Cursor", "The 3D cursor"),
        ('OBJECT', "Object", "Origin of another object (for example an Empty)"),
    ], description="Where the blow lands: densest fracture here, and the explosion pushes away from it")
    origin_object: PointerProperty(name="Impact Object", type=bpy.types.Object)
    impact_radius: FloatProperty(name="Impact Radius", default=0.6, min=0.02, max=4.0, subtype='FACTOR',
                                 description="Size of the dense zone, relative to the object size")
    impact_boost: FloatProperty(name="Impact Density", default=8.0, min=1.0, max=200.0, soft_max=40.0,
                                description="How many times denser the fracture is at the impact point")
    size_variation: FloatProperty(name="Size Variation", default=0.0, min=0.0, max=1.0, subtype='FACTOR',
                                  description="Blend large and small pieces across the object")
    weight_group: StringProperty(name="Density Group", description="Vertex group that paints where the fracture is denser")
    weight_influence: FloatProperty(name="Group Influence", default=0.8, min=0.0, max=1.0, subtype='FACTOR')
    axis: EnumProperty(name="Axis", default='Z', items=[('X', "X", ""), ('Y', "Y", ""), ('Z', "Z", "")])
    radial_layers: IntProperty(name="Layers", default=1, min=1, max=8, description="Radial pattern layers stacked along the axis")
    jitter: FloatProperty(name="Jitter", default=0.5, min=0.0, max=1.0, subtype='FACTOR')
    custom_object: PointerProperty(name="Seed Object", type=bpy.types.Object,
                                   description="Its vertices (or its origin) become the fracture seeds")

    # --- interior ----------------------------------------------------------------------------------------
    interior_material: PointerProperty(name="Material", type=bpy.types.Material,
                                       description="Material of the inside faces (a stone-grey one is made when empty)")
    rough: FloatProperty(name="Roughness", default=0.0, min=0.0, max=1.5, soft_max=0.8, subtype='FACTOR',
                         description="Displacement of the fracture faces, relative to the piece size. 0 is flat")
    noise_scale: FloatProperty(name="Noise Scale", default=1.0, min=0.1, max=6.0, description="Wavelength of the roughness")
    detail: FloatProperty(name="Detail", default=0.18, min=0.04, max=0.6, subtype='FACTOR',
                          description="Spacing of the points that carry the roughness (smaller is finer and heavier)")
    smooth_interior: BoolProperty(name="Smooth Shading", default=True, description="Smooth normals on the fracture faces")
    uv_mode: EnumProperty(name="UVs", default='PLANAR', items=[
        ('PLANAR', "Planar", "Project the inside faces flat, in world scale"),
        ('POINT', "Single Point", "Put every inside face on one UV point (a colour swatch in an atlas)"),
    ])
    uv_scale: FloatProperty(name="UV Scale", default=1.0, min=0.01, max=100.0,
                            description="Size of one texture repeat on the inside faces, in average piece widths")
    uv_point: FloatVectorProperty(name="UV Point", size=2, default=(0.5, 0.5), min=-4.0, max=4.0)
    cap_color: FloatVectorProperty(name="Vertex Color", size=4, subtype='COLOR', default=(0.35, 0.35, 0.35, 1.0), min=0.0, max=1.0,
                                   description="Colour written to colour attributes on the inside faces")

    # --- pieces ------------------------------------------------------------------------------------------
    merge_small: BoolProperty(name="Merge Small Pieces", default=True, description="Fold pieces below the minimum into their largest neighbour")
    min_size: FloatProperty(name="Minimum Size", default=0.12, min=0.0, max=0.6, subtype='FACTOR',
                            description="Smallest allowed piece, relative to the average piece")
    drop_dust: BoolProperty(name="Discard Dust", default=True, description="Delete disconnected specks smaller than the dust size")
    dust_size: FloatProperty(name="Dust Size", default=0.02, min=0.0, max=0.3, subtype='FACTOR')
    split_islands: BoolProperty(name="Split Islands", default=True, description="A cell that covers two separate parts becomes two pieces")
    hide_source: BoolProperty(name="Hide Source", default=True)
    replace_previous: BoolProperty(name="Replace Previous", default=True, description="Delete the previous result for this object first")

    # --- explosion ---------------------------------------------------------------------------------------
    blast_speed: FloatProperty(name="Blast Speed", default=3.0, min=0.0, max=40.0, description="Launch speed, in object sizes per second")
    blast_falloff: EnumProperty(name="Falloff", default='LINEAR', items=[
        ('NONE', "None", "Every piece launches at the same speed"),
        ('LINEAR', "Linear", "Pieces near the blast fly faster"),
        ('INVERSE', "Inverse Square", "A sharp drop-off with distance"),
    ])
    blast_radius: FloatProperty(name="Blast Radius", default=1.2, min=0.05, max=10.0, description="Falloff distance, in object sizes")
    blast_up: FloatProperty(name="Upward Bias", default=0.4, min=0.0, max=3.0, description="Tilts the launch direction upward")
    blast_spread: FloatProperty(name="Scatter", default=0.35, min=0.0, max=2.0, description="Random deviation of the launch direction")
    speed_variation: FloatProperty(name="Speed Variation", default=0.3, min=0.0, max=1.0, subtype='FACTOR')
    spin: FloatProperty(name="Spin", default=2.0, min=0.0, max=20.0, description="Revolutions per second (upper range)")
    mass_influence: FloatProperty(name="Mass Influence", default=0.5, min=0.0, max=1.0, subtype='FACTOR',
                                  description="Lighter pieces fly faster than heavy ones")
    wave_speed: FloatProperty(name="Shockwave Speed", default=0.0, min=0.0, max=100.0,
                              description="Object sizes per second. Pieces release as the wave reaches them; 0 releases everything at once")
    collision_delay: IntProperty(name="Break-up Delay", default=3, min=0, max=60,
                                 description="Frames that touching pieces ignore each other after release, so tightly packed pieces do not shove each other. 0 disables")
    guard_pops: BoolProperty(name="Prevent Pops", default=True,
                             description="When the break-up delay ends, a piece still overlapping a neighbour is pushed out of it hard (typically a "
                                         "small shard inside the convex hull of a bigger piece). Find those pieces and let them pass through that "
                                         "neighbour instead. Switch off to see the raw simulation")
    separation: FloatProperty(name="Clearance", default=0.2, min=0.0, max=2.0, subtype='FACTOR',
                              description="Touching pieces are launched apart at least this fast (relative to the blast speed), so none is thrown into its neighbour")
    delay_jitter: IntProperty(name="Delay Jitter", default=1, min=0, max=60, description="Random extra release delay, in frames")
    start_frame: IntProperty(name="Start Frame", default=5, min=3, description="Frame the blast starts")
    duration: FloatProperty(name="Duration", default=3.0, min=0.2, max=60.0, description="Seconds simulated after the last piece is released")
    real_height: FloatProperty(name="Real Height (m)", default=1.0, min=0.0, max=1000.0,
                               description="How tall the object is in the real world. Gravity and masses are scaled to match, so a large-unit model does not fall in slow motion. 0 uses scene units as metres")
    material: EnumProperty(name="Material", default='PLASTIC', items=MATERIALS, description="Density of the pieces")
    friction: FloatProperty(name="Friction", default=0.5, min=0.0, max=1.0, subtype='FACTOR')
    bounce: FloatProperty(name="Bounciness", default=0.3, min=0.0, max=1.0, subtype='FACTOR')
    linear_damping: FloatProperty(name="Linear Damping", default=0.04, min=0.0, max=1.0, subtype='FACTOR')
    angular_damping: FloatProperty(name="Angular Damping", default=0.1, min=0.0, max=1.0, subtype='FACTOR')
    collision_shape: EnumProperty(name="Collision", default='CONVEX_HULL', items=[
        ('CONVEX_HULL', "Convex Hull", "Fast and stable"),
        ('MESH', "Mesh", "Exact, slow, and unstable for moving bodies"),
        ('BOX', "Box", ""), ('SPHERE', "Sphere", ""), ('CAPSULE', "Capsule", ""),
    ])
    collision_margin: FloatProperty(name="Margin", default=0.0, min=0.0, max=0.05, precision=4,
                                    description="Collision margin, relative to the object size")
    substeps: IntProperty(name="Substeps", default=0, min=0, max=600,
                          description="Physics steps per frame. 0 picks 10-40 from the fastest piece. More is not better: overlapping pieces "
                                      "are pushed apart harder the shorter the step")
    solver_iters: IntProperty(name="Solver Iterations", default=40, min=1, max=200)
    add_floor: BoolProperty(name="Floor", default=True, description="Add a passive floor for the pieces to land on")
    floor_mode: EnumProperty(name="Floor At", default='AUTO', items=[
        ('AUTO', "Base of Object", "The lowest point of the pieces"),
        ('MANUAL', "Height", "A height you set"),
    ])
    floor_z: FloatProperty(name="Floor Height", default=0.0, unit='LENGTH')
    floor_friction: FloatProperty(name="Floor Friction", default=0.7, min=0.0, max=1.0, subtype='FACTOR')
    bake_step: IntProperty(name="Bake Step", default=1, min=1, max=6, description="Frames between baked keyframes")
    settle: BoolProperty(name="Run Until Settled", default=True,
                         description="If pieces are still moving when the Duration ends, keep simulating (up to twice as long again) so the "
                                     "animation does not stop with debris frozen in mid-air")

    # --- export ------------------------------------------------------------------------------------------
    export_path: StringProperty(name="Folder", default="//", subtype='DIR_PATH')
    export_name: StringProperty(name="File", default="", description="Leave empty for <object>_explosion.glb")
    export_ktx2: BoolProperty(name="Compress Textures (KTX2)", default=True,
                              description="Re-encode the textures as KTX2 after exporting, with the game project's tools/ktx2-encode.mjs (needs Node.js). "
                                          "The game loads them 4x smaller in video memory. If the tool is not found the GLB keeps its PNG textures")

    # --- runtime -----------------------------------------------------------------------------------------
    show_preview: BoolProperty(name="Show Pattern", default=False, description="Draw the fracture pattern in the viewport")
    busy: BoolProperty(default=False, options={'HIDDEN'})
    progress: FloatProperty(default=0.0, min=0.0, max=1.0, options={'HIDDEN'})
    progress_msg: StringProperty(default="", options={'HIDDEN'})


CLASSES = (ShardsmithSettings,)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)
    bpy.types.Scene.shardsmith = PointerProperty(type=ShardsmithSettings)


def unregister():
    del bpy.types.Scene.shardsmith
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
