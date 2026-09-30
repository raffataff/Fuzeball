"""Shardsmith: fracture any mesh into pieces and blow it apart with physics.

A replacement for the Cell Fracture add-on that does not depend on boolean operations, so it does not care
whether the mesh is watertight, manifold, consistently wound or free of overlaps. See README.md.
"""
bl_info = {
    "name": "Shardsmith",
    "author": "Fuzeball",
    "version": (1, 1, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar > Shardsmith",
    "description": "Robust Voronoi fracture that survives broken meshes, with rigid-body explosions and glTF export",
    "category": "Object",
}


def register():
    from . import importer, operators, props, ui
    props.register()
    importer.register()
    operators.register()
    ui.register()


def unregister():
    from . import importer, operators, props, ui
    ui.unregister()
    operators.unregister()
    importer.unregister()
    props.unregister()
