# Arena skin proposals

Three material studies rendered directly on the shipped `assets/tables/arena/fuzeball_table_arena_standard.glb` mesh. The source asset and game configuration are untouched. Each `.blend` contains an editable proposal with procedural materials, a separate presentation pitch, camera, and studio lights. These are review concepts; the procedural materials would need baking before game integration.

1. **Federation Finals** — Federation blue enamel, walnut ramps, aged gold goal frames and hardware, precise double gold coachlines. An official championship table that retains its Earth-made timber.
2. **Starport Salvage** — utility cream, oxidised teal supports, warm timber and copper hardware. Abraded diagonal cargo markings around the fascia ends suggest years of transfers between spaceport arcades.
3. **Saucer Social Club** — oxblood enamel, dark mahogany, aged champagne brass and repeating diamond inlays. An old members' club table in a saucer bar: ceremonial and slightly theatrical.

All three preserve the arena bowl, corner curves, goal mouths, rod collars, frames and pedestal geometry. The lower ramp remains timber; surface graphics do not displace the mesh. Nets use the existing translucent goal-box meshes. Rods and figures are omitted to expose the skin surfaces; they are separate game assets.

`verification.json` records matching hashes of vertices, polygon indices and object transforms before and after skin assignment. `geometry-reference.glb` retains the source geometry binary with compressed texture references removed solely for Blender import; it is not an installable skin.

Reproduce with Blender 5.2:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python tools\preview_arena_skins.py
```

The designs follow the project's DIRECTION.md: worn Earth-made furniture in galactic venues, copper/gold Federation ceremony, and restrained material detail.
