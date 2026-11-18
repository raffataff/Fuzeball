"""Lathed rod hardware with an axial UV unwrap and a split wrap seam."""

import math

import bpy
from mathutils import Vector

SEGMENTS = 72


class Surface:
    """Build revolved sections in rod-local coordinates with an unwrapped UV seam."""

    def __init__(self, start, end, uv_name='RodWrap'):
        self.start, self.end, self.uv_name = start, end, uv_name
        self.vertices, self.faces, self.uvs, self.smooth = [], [], [], []

    def add(self, profile, sectors=range(SEGMENTS), relief=None, wrap=None):
        base = len(self.vertices)
        for t, radius in profile:
            y = self.start + (self.end - self.start) * t
            for j in range(SEGMENTS):
                angle = math.tau * j / SEGMENTS
                r = radius + (relief(t, j) if relief else 0)
                self.vertices.append((r * math.cos(angle), y, r * math.sin(angle)))

        for row, ((u0, r0), (u1, r1)) in enumerate(zip(profile, profile[1:])):
            lo = base + row * SEGMENTS
            hi = lo + SEGMENTS
            flat = u0 == u1
            if wrap:
                u0, u1 = ((u - wrap[0]) / (wrap[1] - wrap[0]) for u in (u0, u1))
            for j in sectors:
                k = (j + 1) % SEGMENTS
                face = (lo + j, hi + j, hi + k, lo + k)
                self.faces.append(face)
                self.smooth.append(not flat)
                a, b = (r0 / 2, r1 / 2) if flat else (u0, u1)
                v0, v1 = j / SEGMENTS, (j + 1) / SEGMENTS
                self.uvs.append(((a, v0), (b, v0), (b, v1), (a, v1)))

    def mesh(self, name, mat):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        mesh.materials.append(mat)
        uv = mesh.uv_layers.new(name=self.uv_name)
        for face in mesh.polygons:
            face.use_smooth = self.smooth[face.index]
            for li, coord in zip(face.loop_indices, self.uvs[face.index]):
                uv.data[li].uv = coord
        return obj


def part(name, start, end, mats, sections, uv_name='RodWrap'):
    for finish, profiles in sections.items():
        surface = Surface(start, end, uv_name)
        for profile in profiles:
            surface.add(*profile)
        surface.mesh(f'{name}_{finish}', mats[finish])


def full(profile):
    return (profile, range(SEGMENTS))


def trim(t0, t1, radius):
    # Small real bevels catch highlights on the solid metal rings.
    edge = (t1 - t0) * .22
    return full([(t0, radius - .038), (t0 + edge, radius), (t1 - edge, radius), (t1, radius - .038)])


def extents(obj):
    positions = [(obj.matrix_world @ Vector(p)).y for p in obj.bound_box]
    return min(positions), max(positions)
