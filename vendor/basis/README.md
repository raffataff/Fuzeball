Basis Universal transcoder, taken from three.js **r137** examples (`examples/js/libs/basis/`).

Deliberately NOT r128's copy, which is what the rest of vendor/ is pinned to. r128 predates
`KTX2Loader` entirely — it only ships `BasisTextureLoader`, which reads bare `.basis` files and
cannot open a KTX2 container — and its transcoder wasm (440,267 bytes) is the older build without
KTX2 container or Zstandard support. r137's (499,935 bytes) has both.

Verified against r128 core: `KTX2Loader.js` and `WorkerPool.js` from r137 reference only THREE
symbols that exist in r128, and r128's own `GLTFLoader` already implements `KHR_texture_basisu`
and `setKTX2Loader`. Tested end to end in headless Chromium on the real room and figurine GLBs —
ETC1S transcoded to BPTC, UASTC to ASTC 4x4, full mip chains, `glGetError` clean.

Do not "upgrade" these to match three's r128 pin. That is the bug, not the inconsistency.
