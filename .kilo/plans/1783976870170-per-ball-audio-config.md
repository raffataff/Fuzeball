# Per-Ball-Type Audio Config

## Goal

Add a per-ball-type `audio` object in `CONFIG.ballTypes` so each ball sounds different when it contacts surfaces or gets kicked. Missing fields fall back to the current hard-coded defaults in `audio.js`, so existing ball types that don't define audio keep their current sound.

## Config Structure

Each entry in `CONFIG.ballTypes` gets an optional `audio` block:

```js
ballTypes:{
  classic:{
    name:'...', col:0x..., em:0x..., mass:4, maxV:120, w:70, trail:'#ffffff',
    audio:{
      kick:{       // foot/rod strike sound
        // All fields optional — undefined = use default values below
        noiseDur:0.06, noiseFreq:900, noiseFreqScale:8,  // noiseFreq = noiseFreq + force * noiseFreqScale
        noiseVol:0.1, noiseVolScale:0.003, noiseVolMax:0.4,
        beepFreq:95, beepDur:0.09, beepType:'sine',
        beepVol:0.08, beepVolScale:0.003, beepVolMax:0.45,
        beepSlide:-45
      },
      wall:{       // wall, floor, and ball-ball contact (all use Au.wall today)
        noiseDur:0.045, noiseFreq:2300,
        noiseVol:0.04, noiseVolScale:0.002, noiseVolMax:0.28
      },
      post:{       // goal post/crossbar metallic clang
        noiseDur:0.03, noiseFreq:3200, noiseVolScale:0.5,  // noise burst params
        freqs:[523,832,1290,1900],       // overtone frequencies (or single value for mono)
        droop:0.94,                       // freq droop multiplier over time
        attack:0.003, decay:0.28,        // envelope per overtone
        vol:0.14, volScale:0.004, volMax:0.5,
        intervals:[0, -0.045, -0.09, -0.135],  // decay shift per overtone index
        falloff:[1, 0.82, 0.64, 0.46]           // amp multiplier per overtone index
      }
    }
  },
  fire:{...}, cannon:{...}, split:{...}, golden:{...}
}
```

## Code Changes

### 1. `js/config.js` — Add audio sub-objects to ballTypes

Add the `audio` block to each existing ball type (classic/fire/cannon/split/golden) with reasonable defaults that match current behavior, plus tuned variants for the special balls.

### 2. `js/audio.js` — Refactor Au methods to accept a ball's audio config

Each contact-sound method (`Au.kick`, `Au.wall`, `Au.post`) gains an optional `audioCfg` parameter. The function merges the ball's config over the hard-coded defaults, so:

- `Au.kick(force)` → `Au.kick(force, b?.t?.audio?.kick)`
- `Au.wall(force)` → `Au.wall(force, b?.t?.audio?.wall)`
- `Au.post(force)` → `Au.post(force, b?.t?.audio?.post)`

Every caller in `physics.js` that already passes `b` or can access it adds the ball as a parameter.

### 3. `js/physics.js` — Pass ball reference to audio calls

Call sites that currently look like:

```js
Au.wall(Math.abs(v.z));
Au.kick(-vn);
Au.post(-vn);
Au.wall((van-vbn)*2);
```

Need to include the ball whose audio config applies. All these calls are already inside loops or functions that have `b`, `a`, or `b` accessible. The ball-ball collision will take the heavier ball's audio config (or the primary's).

### 4. `js/arena.js` — Pass ball to `Au.wall`

The arena wall contact function `arenaContact` already receives `b`. Pass `b.t.audio?.wall`.

## Backward Compatibility

- Existing configs that lack `audio` blocks produce `undefined` which the Au methods treat as "use defaults" — zero behavioral change.
- Existing localStorage saves are unaffected.
- No change to the `cfg` (localStorage) schema.

## Validation

1. Start a match with classic balls — sounds identical to current.
2. Use dev tools to change a ball type's `audio.kick` parameters — confirm kick sound changes.
3. Verify fireball/cannonball/split/golden balls can have distinct wall/floor/post hit sounds.
4. Ball-ball collision — confirm the sound respects one of the two balls' config.

## Default Audio Config Per Ball (proposed values)

- **classic**: current defaults exactly (no change)
- **fire**: kick has more noise/crackle (higher noiseFreqScale, different noiseVol), post has a sharper ring
- **cannon**: kick is a heavy thud (lower beepFreq, more sub-bass feel), wall sounds heavier
- **split**: lighter, glass-like wall sound, higher-pitched kick
- **golden**: metallic ping on kick and wall contact

## Task List

1. Add `audio` object structure documentation comment in `CONFIG.ballTypes`
2. Add `audio` blocks to all 5 ball types with tuned values
3. Refactor `Au.kick()` to accept `audioCfg` parameter, merge with defaults
4. Refactor `Au.wall()` to accept `audioCfg` parameter, merge with defaults
5. Refactor `Au.post()` to accept `audioCfg` parameter, merge with defaults
6. Update `physics.js` callers: `stepBall` (floor/wall), `arenaContact`, `collideRod` (kick), `goalFrameCollide` (post), `ballBall`
7. Update `js/arena.js` `arenaContact` to pass `b.t.audio?.wall`
8. Test: classic balls sound the same, fireball/cannon have distinct sounds
