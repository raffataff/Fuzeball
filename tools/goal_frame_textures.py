"""Texture and UV utilities for the Circuit goal frame builds."""
import bpy
import numpy as np


def smoothstep(lo, hi, value):
    t = np.clip((value - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def blur(values, radius, padding='edge'):
    weights = (1/16, 4/16, 6/16, 4/16, 1/16)
    for axis in range(2):
        rows = np.swapaxes(values, 0, axis)
        padded = np.pad(rows, ((2*radius, 2*radius), (0, 0)), mode=padding)
        values = np.swapaxes(sum(weight * padded[i*radius:i*radius+len(rows)]
                                 for i, weight in enumerate(weights)), 0, axis)
    return values


def load_tile(path):
    size = 512
    source = bpy.data.images.load(path, check_existing=False)
    source.scale(size, size)
    pixels = np.empty(size*size*4, dtype=np.float32)
    source.pixels.foreach_get(pixels)
    bpy.data.images.remove(source)
    art = pixels.reshape(size, size, 4)[:, :, :3]
    edge = np.minimum(np.arange(size)+.5, size-np.arange(size)-.5)
    blend = (1-smoothstep(5, 58, edge)).astype(np.float32)
    # Blend through the middle of the source at each tile boundary so the
    # fissures and height gradients continue across the wrap.
    for axis, weight in enumerate((blend[:, None, None], blend[None, :, None])):
        art = art*(1-weight) + np.roll(art, size//2, axis=axis)*weight
    return art


def tile_gradient(height, spacing=(1, 1)):
    return tuple((np.roll(height, -1, axis) - np.roll(height, 1, axis))/(2*step)
                 for axis, step in enumerate(spacing))


def map_goal_frame(ob, repeats, offset, path=None):
    # U follows the centerline and V wraps the profile. For the outer
    # polyline, turn the uniformly spaced corner UVs into arc length.
    if path is not None:
        distances = np.cumsum([0, *((b-a).length for a, b in zip(path, path[1:]))])
        knots = np.linspace(0, 1, len(path))
        distances /= distances[-1]
    for loop in ob.data.uv_layers.active.data:
        u, v = loop.uv
        if path is not None:
            u = np.interp(u, knots, distances)
        # A slow rotation of the wrap varies which fissures face the pitch.
        loop.uv = (u*repeats+offset, v+1.38*u)
