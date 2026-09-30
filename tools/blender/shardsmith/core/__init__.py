"""Shardsmith core: the fracture engine.

Everything in here works on plain numpy arrays. Only meshdata.py (reading a Blender mesh),
objects.py (writing pieces back) and caps.py / voronoi.py (mathutils' CDT and KDTree) touch Blender.
"""
