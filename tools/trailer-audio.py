# trailer-audio: the trailer's soundtrack. The music edit (a filter that opens over the intro, drop-outs with a reverb
# tail) plus synthesized sound design on the picture's cues (impacts, whooshes, risers, ball strikes, posts, blasts),
# mixed under a limiter.
#   "C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe" -I tools/trailer-audio.py <cues.json> <out.wav>
#   ... tools/trailer-audio.py --test <dir>      renders every effect alone, plus a spectrogram strip, to look at
# cues.json: {music, music_gain, len, lp:[[t,hz]...], drop:[[t0,t1]...], tail:[t,secs], cues:[{t,k,g,p,...}]}
import sys, json, wave, struct, zlib, os
import numpy as np

SR = 48000

# --- io ---
def wav_read(p):
    w = wave.open(p, 'rb'); sr, ch, sw, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
    raw = w.readframes(n)
    if sw == 2: a = np.frombuffer(raw, np.int16).astype(np.float64) / 32768
    elif sw == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3)
        a = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
        a = np.where(a >= 1 << 23, a - (1 << 24), a).astype(np.float64) / (1 << 23)
    else: a = np.frombuffer(raw, np.int32).astype(np.float64) / 2**31
    a = a.reshape(-1, ch)
    if ch == 1: a = np.repeat(a, 2, 1)
    assert sr == SR, 'music must be 48 kHz'
    return a

def wav_write(p, x):
    x = np.clip(x, -1, 1)
    d = (x * 8388607).astype(np.int32)
    b = np.empty((d.shape[0], d.shape[1], 3), np.uint8)
    b[..., 0] = d & 255; b[..., 1] = (d >> 8) & 255; b[..., 2] = (d >> 16) & 255
    w = wave.open(p, 'wb'); w.setnchannels(2); w.setsampwidth(3); w.setframerate(SR); w.writeframes(b.tobytes()); w.close()

# --- building blocks ---
def T(n): return np.arange(n) / SR
def N(n, seed): return np.random.default_rng(seed).standard_normal(n)
def ns(sec): return int(round(sec * SR))
def fade(x, a=0.002, r=0.01):
    n = len(x); x = x.copy()
    na, nr = min(n, ns(a)), min(n, ns(r))
    if na: x[:na] *= np.linspace(0, 1, na)[:, None] if x.ndim > 1 else np.linspace(0, 1, na)
    if nr: x[-nr:] *= np.linspace(1, 0, nr)[:, None] if x.ndim > 1 else np.linspace(1, 0, nr)
    return x

def fftfilt(x, mag):
    # zero-phase filter by a magnitude function of frequency (Hz)
    n = len(x); m = 1 << int(np.ceil(np.log2(n + 1)))
    X = np.fft.rfft(x, m); f = np.fft.rfftfreq(m, 1 / SR)
    return np.fft.irfft(X * mag(f), m)[:n]
def lp(x, fc, o=2): return fftfilt(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * o)))
def hp(x, fc, o=2): return fftfilt(x, lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** (2 * o)))
def bp(x, f0, q):
    return fftfilt(x, lambda f: 1 / np.sqrt(1 + (q * (f / f0 - f0 / np.maximum(f, 1e-3))) ** 2))

def svf(x, fc, q=0.7, mode='lp'):
    # Chamberlin state-variable filter with a per-sample cutoff (array or scalar); for short sounds only
    n = len(x); fc = np.broadcast_to(np.asarray(fc, float), (n,))
    f = 2 * np.sin(np.pi * np.minimum(fc, SR / 6) / SR); qq = 1 / q
    lo = ba = 0.0; out = np.empty(n)
    for i in range(n):
        lo += f[i] * ba; hi = x[i] - lo - qq * ba; ba += f[i] * hi
        out[i] = lo if mode == 'lp' else ba if mode == 'bp' else hi
    return out

def osc(freq, n, shape='sin', ph=0.0):
    fr = np.broadcast_to(np.asarray(freq, float), (n,))
    p = ph + 2 * np.pi * np.cumsum(fr) / SR
    if shape == 'sin': return np.sin(p)
    if shape == 'saw': u = (p / (2 * np.pi)) % 1; return 2 * u - 1
    if shape == 'tri': u = (p / (2 * np.pi)) % 1; return 4 * np.abs(u - 0.5) - 1

def st(x, p=0.0, w=0.0):
    # mono -> stereo, equal-power pan p in -1..1; w adds a short Haas spread
    a = (p + 1) * np.pi / 4; L, R = np.cos(a) * x, np.sin(a) * x
    if w > 0:
        d = ns(0.0008 + 0.012 * w); R = np.concatenate([np.zeros(d), R])[:len(x)] * 0.9 + R * 0.1
    return np.stack([L, R], 1)

def ir(secs, seed=1, bright=0.5, pre=0.012):
    # a stereo room: decorrelated noise, three bands decaying at different rates (highs die first), a short predelay
    n = ns(secs); t = T(n); out = []
    for c in range(2):
        z = N(n, seed * 7 + c)
        lo, mi, hi = lp(z, 400), bp(z, 1500, 0.6), hp(z, 4000)
        e = lambda t60: np.exp(-6.9 * t / t60)
        y = lo * e(secs) + mi * e(secs * 0.7) * 0.8 + hi * e(secs * 0.35) * bright
        y[:ns(0.004)] *= np.linspace(0, 1, ns(0.004))
        y = np.concatenate([np.zeros(ns(pre)), y])[:n]
        out.append(y / np.sqrt((y ** 2).sum()))
    return np.stack(out, 1)

def conv(x, h):
    # x stereo (n,2) or mono, h stereo (m,2): FFT convolution, length n+m
    if x.ndim == 1: x = np.stack([x, x], 1)
    n = len(x) + len(h); m = 1 << int(np.ceil(np.log2(n)))
    return np.stack([np.fft.irfft(np.fft.rfft(x[:, c], m) * np.fft.rfft(h[:, c], m), m)[:n] for c in range(2)], 1)

def verb(x, secs=1.8, mix=0.25, seed=1, bright=0.5):
    if x.ndim == 1: x = st(x)
    w = conv(x, ir(secs, seed, bright)) * mix
    w[:len(x)] += x * (1 - mix * 0.5)
    return w

def norm(x, peak=1.0): m = np.abs(x).max(); return x * (peak / m) if m > 0 else x

# --- effects: each returns stereo at unit-ish peak; the cue's g sets its level ---
def sub_boom(dur=1.8, f0=62, f1=31, tau=0.55, seed=0):
    n = ns(dur); t = T(n)
    fr = f1 + (f0 - f1) * np.exp(-t / 0.18)
    y = osc(fr, n) + 0.25 * osc(fr * 2, n) * np.exp(-t / 0.08)
    y *= np.exp(-t / tau) * np.minimum(1, t / 0.003)
    return fade(np.tanh(y * 1.6) / np.tanh(1.6), 0.0005, min(0.4, dur * 0.3))

def thump(dur=0.35, fc=220, tau=0.07, seed=1):
    n = ns(dur); t = T(n)
    return norm(lp(N(n, seed), fc, 3) * np.exp(-t / tau) * np.minimum(1, t / 0.001))

def crack(dur=0.12, f0=3200, q=0.8, tau=0.014, seed=2):
    n = ns(dur); t = T(n)
    y = bp(N(n, seed), f0, q) * np.exp(-t / tau)
    y[:ns(0.0015)] += np.hanning(ns(0.003))[:ns(0.0015)] * 3
    return norm(y)

def impact(size=1.0, seed=3, bright=1.0):
    d = 2.6 + size
    b = sub_boom(d, 64, 30, 0.45 + 0.35 * size, seed)
    th = np.zeros(ns(d)); x = thump(0.5, 260, 0.06 + 0.05 * size, seed + 1); th[:len(x)] = x
    cr = np.zeros(ns(d)); x = crack(0.15, 2600, 0.7, 0.02, seed + 2); cr[:len(x)] = x
    # the sub stays dry (a reverberated sub wobbles and muddies); the body and crack get the room
    w = verb(st(th * 0.7 + cr * 0.35 * bright, 0, 0.3), 2.4 + size, 0.32, seed, 0.35)
    w[:len(b)] += st(b * 0.95)
    return norm(fade(w, 0.0005, 0.3))

def hit_small(seed=4):
    # a short punchy accent for cuts and text: a tight thump and a little crack, short room
    th = thump(0.4, 300, 0.045, seed); cr = crack(0.08, 3800, 1.0, 0.009, seed + 1)
    y = np.zeros(ns(0.4)); y[:len(th)] += th; y[:len(cr)] += cr * 0.4
    y += sub_boom(0.4, 90, 48, 0.09, seed) * 0.5
    return norm(fade(verb(st(y, 0, 0.2), 0.9, 0.2, seed, 0.6), 0.0005, 0.08))

def whoosh(dur=0.7, peak=0.6, flo=300, fhi=4200, pan=(-0.7, 0.7), seed=5):
    # band-passed noise whose centre and level swell to `peak` (a fraction of dur) and fall; pans across
    n = ns(dur); t = T(n); u = t / dur
    bell = np.where(u < peak, (u / peak) ** 2.2, np.exp(-((u - peak) / (1 - peak)) * 4.5))
    fc = flo + (fhi - flo) * bell
    z = N(n, seed)
    y = svf(z, fc, 1.4, 'bp') * bell
    y += hp(N(n, seed + 1), 5000) * bell * 0.12
    p = np.linspace(pan[0], pan[1], n); a = (p + 1) * np.pi / 4
    out = np.stack([np.cos(a) * y, np.sin(a) * y], 1)
    return norm(fade(verb(out, 0.8, 0.18, seed, 0.6), 0.003, 0.05))

def riser(dur=2.0, seed=6):
    # noise opening up plus a rising detuned tone, ending abruptly at dur (the hit lands there)
    n = ns(dur); t = T(n); u = t / dur
    a = u ** 2.6
    fc = 250 * (60 ** u)
    z = svf(N(n, seed), fc, 0.9, 'lp') * 0.8 + hp(N(n, seed + 1), 6000) * u ** 4 * 0.25
    f = 110 * (2 ** (u * 1.5))
    tone = sum(osc(f * m * (1 + d), n, 'saw') for m, d in ((1, 0), (1, 0.006), (2, -0.004), (3, 0.003))) / 4
    tone = svf(tone, 400 + 6000 * u ** 2, 0.8, 'lp')
    y = (z + tone * 0.55) * a
    trem = 1 + 0.25 * np.sin(2 * np.pi * (4 + 14 * u ** 2) * t) * u
    y *= trem
    out = verb(st(y, 0, 0.6), 1.2, 0.25, seed, 0.6)[:n]
    out[-ns(0.004):] *= np.linspace(1, 0, ns(0.004))[:, None]
    return norm(out)

def reverse_swell(dur=1.0, seed=7):
    # the reverb tail of a hit, reversed, so it sucks into the downbeat
    x = np.zeros(ns(0.05)); x[0] = 1; x = lp(N(ns(0.05), seed), 3000) * np.exp(-T(ns(0.05)) / 0.01)
    w = conv(st(x, 0, 0.5), ir(dur * 1.4, seed, 0.8))
    w = w[:ns(dur)][::-1]
    w *= np.linspace(0, 1, len(w))[:, None] ** 0.6
    w[-ns(0.003):] *= np.linspace(1, 0, ns(0.003))[:, None]
    return norm(w)

def ball_hit(v=80, seed=8):
    # the strike: a click, a hollow body and, for hard hits, a low thud; v is the ball speed (u/s)
    k = np.clip(v / 120, 0.15, 1.2); n = ns(0.35); t = T(n)
    click = bp(N(n, seed), 3500, 1.2) * np.exp(-t / 0.0025)
    body = (osc(240 - 40 * k, n) * np.exp(-t / 0.03) + 0.5 * osc(520, n) * np.exp(-t / 0.018) + 0.3 * osc(910, n) * np.exp(-t / 0.01))
    thud = osc(95 * (1 + 0.6 * np.exp(-t / 0.02)), n) * np.exp(-t / (0.04 + 0.05 * k)) * k
    y = click * 0.9 + body * 0.6 + thud * 0.9
    return norm(fade(verb(st(y, 0, 0.1), 0.6, 0.12, seed, 0.7), 0.0003, 0.05))

def post_ring(v=80, seed=9):
    n = ns(1.2); t = T(n)
    y = sum(osc(f, n) * np.exp(-t / d) * a for f, d, a in ((523, 0.5, 1), (832, 0.38, 0.7), (1290, 0.25, 0.5), (1900, 0.16, 0.35), (2770, 0.09, 0.2)))
    y += bp(N(n, seed), 4000, 1) * np.exp(-t / 0.004) * 2
    return norm(fade(verb(st(y, 0, 0.3), 1.2, 0.22, seed, 0.8), 0.0003, 0.1))

def wall_tap(v=40, seed=10):
    n = ns(0.2); t = T(n)
    y = bp(N(n, seed), 1800, 0.9) * np.exp(-t / 0.006) + osc(160, n) * np.exp(-t / 0.025) * 0.6
    return norm(fade(st(y, 0, 0.1), 0.0003, 0.03))

def crackle(dur=1.6, rate=60, seed=11):
    # sparse sparkling clicks that thin out
    n = ns(dur); y = np.zeros(n); r = np.random.default_rng(seed)
    tt = 0.0
    while tt < dur:
        tt += r.exponential(1 / (rate * np.exp(-tt / (dur * 0.4)) + 1e-3))
        i = ns(tt)
        if i >= n - 400: break
        m = ns(0.004); g = r.uniform(0.2, 1) * np.exp(-tt / (dur * 0.5))
        y[i:i + m] += bp(r.standard_normal(m), r.uniform(2500, 8000), 2) * np.exp(-T(m) / 0.0012) * g
    out = np.stack([y * np.random.default_rng(seed + 1).uniform(0.4, 1), np.roll(y, ns(0.0007))], 1)
    return norm(verb(out, 0.9, 0.2, seed, 0.9))

def shimmer(dur=1.6, seed=12):
    n = ns(dur); t = T(n)
    y = bp(N(n, seed), 7000, 1.5) * np.exp(-t / (dur * 0.35)) * (1 + 0.5 * np.sin(2 * np.pi * 11 * t))
    y += sum(osc(f, n) * np.exp(-t / d) * 0.15 for f, d in ((3150, 0.9), (4720, 0.6), (6230, 0.45)))
    return norm(fade(verb(st(y, 0, 0.7), 1.4, 0.3, seed, 1.0), 0.004, 0.2))

def goal_blast(seed=13):
    a = impact(1.2, seed); c = crackle(1.8, 80, seed + 1); s = shimmer(1.8, seed + 2)
    y = np.zeros((max(len(a), len(c), len(s)), 2)); y[:len(a)] += a; y[:len(c)] += c * 0.35; y[:len(s)] += s * 0.25
    return norm(y)

def explosion(seed=14):
    # a blast whose noise darkens as it dies, a sub, and debris clatter
    n = ns(2.6); t = T(n)
    fc = 300 + 7000 * np.exp(-t / 0.18)
    z = svf(N(n, seed), fc, 0.6, 'lp') * np.exp(-t / 0.45) * np.minimum(1, t / 0.002)
    b = sub_boom(2.6, 70, 28, 0.6, seed)
    out = verb(st(np.tanh(z * 1.6), 0, 0.4), 2.2, 0.3, seed, 0.4)
    out[:len(b)] += st(b * 0.9)
    deb = np.zeros(len(out)); r = np.random.default_rng(seed + 5)
    for k in range(40):
        tt = 0.08 + r.exponential(0.35); i = ns(tt); m = ns(0.03)
        if i + m >= len(deb): continue
        deb[i:i + m] += bp(r.standard_normal(m), r.uniform(1500, 5000), 3) * np.exp(-T(m) / 0.006) * r.uniform(0.1, 0.5) * np.exp(-tt / 0.6)
    out += st(deb, 0, 0.5) * 0.6
    return norm(fade(out, 0.0005, 0.4))

def debris(dur=1.5, n=70, slow=0.4, seed=18):
    # armour and rock chunks raining onto the pitch, heard in slow motion: every hit is pitched down and stretched by `slow`
    m = ns(dur + 0.6); y = np.zeros(m); r = np.random.default_rng(seed)
    for i in range(n):
        u = r.beta(1.6, 3.2); t0 = u * dur; i0 = ns(t0)
        big = r.random() < 0.25; g = r.uniform(0.25, 1.0) * (1.6 if big else 1) * (1 - 0.5 * u)
        L = ns(0.35 / max(slow, 0.2)); t = T(L)
        click = bp(r.standard_normal(L), r.uniform(700, 2600) * slow, 1.5) * np.exp(-t / (0.006 / slow))
        modes = sum(osc(r.uniform(500, 3200) * slow, L, 'sin', r.uniform(0, 6)) * np.exp(-t / (r.uniform(0.03, 0.09) / slow)) * r.uniform(0.2, 0.6) for _ in range(3))
        thud = osc(r.uniform(70, 140) * (slow ** 0.5), L) * np.exp(-t / (0.05 / slow)) * (1.2 if big else 0.3)
        hit = (click * 1.2 + modes * 0.5 + thud) * g
        k = min(L, m - i0); y[i0:i0 + k] += hit[:k]
    out = np.stack([y * r.uniform(0.7, 1), np.roll(y, ns(0.0009))], 1)
    return norm(fade(verb(out, 1.6, 0.3, seed, 0.5), 0.002, 0.3))

def stretch(y, s):
    # slow motion: play the sound at speed s (< 1 is longer and lower), linear resampling per channel
    s = max(0.25, min(1.0, s))
    if s > 0.97: return y
    n = int(len(y) / s); x = np.arange(n) * s
    return np.stack([np.interp(x, np.arange(len(y)), y[:, c]) for c in range(y.shape[1])], 1) if y.ndim > 1 else np.interp(x, np.arange(len(y)), y)

def beep(f=1046, dur=0.11, seed=15):
    n = ns(dur); t = T(n)
    y = (osc(f, n) * 0.8 + osc(f * 2, n) * 0.15) * np.minimum(1, t / 0.003) * np.minimum(1, (dur - t) / 0.02)
    return norm(verb(st(y, 0, 0.1), 0.5, 0.15, seed, 0.8))

def shing(seed=16):
    # a metallic sheen for the gold text: bright partials and air, a soft attack
    n = ns(1.4); t = T(n)
    y = sum(osc(f, n, 'sin', ph) * np.exp(-t / d) * a for f, d, a, ph in ((2093, 0.7, 0.5, 0), (3136, 0.5, 0.45, 1), (4699, 0.35, 0.35, 2), (6272, 0.25, 0.3, 3)))
    y += bp(N(n, seed), 8000, 1.2) * np.exp(-t / 0.12) * 0.5
    y *= np.minimum(1, t / 0.006)
    return norm(fade(verb(st(y, 0, 0.8), 1.6, 0.35, seed, 1.0), 0.002, 0.2))

def drone(dur=6.0, seed=17):
    # a low bed for the cold open: detuned fifths, slowly breathing
    n = ns(dur); t = T(n)
    y = sum(osc(f * (1 + d), n) * a for f, d, a in ((55, 0, 1), (55, 0.004, 0.8), (82.4, -0.003, 0.5), (110, 0.002, 0.3)))
    y = lp(y * (1 + 0.2 * np.sin(2 * np.pi * 0.23 * t)), 600)
    y *= np.minimum(1, t / 1.2) * np.minimum(1, (dur - t) / 1.0)
    return norm(verb(st(y, 0, 0.8), 2.5, 0.3, seed, 0.3))

FX = dict(impact=lambda c: impact(c.get('size', 1.0), c.get('seed', 3)), hit=lambda c: hit_small(c.get('seed', 4)),
          whoosh=lambda c: whoosh(c.get('dur', 0.7), c.get('peak', 0.6), c.get('flo', 300), c.get('fhi', 4200), tuple(c.get('pan', (-0.7, 0.7))), c.get('seed', 5)),
          riser=lambda c: riser(c['dur'], c.get('seed', 6)), swell=lambda c: reverse_swell(c['dur'], c.get('seed', 7)),
          ball=lambda c: ball_hit(c.get('v', 80), c.get('seed', 8)), post=lambda c: post_ring(c.get('v', 80), c.get('seed', 9)),
          wall=lambda c: wall_tap(c.get('v', 40), c.get('seed', 10)), goal=lambda c: goal_blast(c.get('seed', 13)),
          explosion=lambda c: explosion(c.get('seed', 14)), beep=lambda c: beep(c.get('f', 1046), c.get('dur', 0.11)),
          shing=lambda c: shing(c.get('seed', 16)), crackle=lambda c: crackle(c.get('dur', 1.6), c.get('rate', 60), c.get('seed', 11)),
          drone=lambda c: drone(c.get('dur', 6.0), c.get('seed', 17)), boom=lambda c: st(sub_boom(c.get('dur', 2.0), c.get('f0', 62), c.get('f1', 31), c.get('tau', 0.55)), 0, 0),
          debris=lambda c: debris(c.get('dur', 1.5), c.get('n', 70), c.get('slow', 0.4), c.get('seed', 18)))

# --- the music edit ---
def stft_lp(x, keys):
    # time-varying low-pass by STFT masks; keys [[t,hz]...] interpolated in log-frequency, 20000 = open
    win, hop = 4096, 1024; w = np.hanning(win)
    n = len(x); pad = np.zeros((win, 2)); xx = np.concatenate([pad, x, pad])
    out = np.zeros_like(xx); norm_ = np.zeros(len(xx))
    f = np.fft.rfftfreq(win, 1 / SR)
    kt = np.array([k[0] for k in keys]); kf = np.log(np.array([k[1] for k in keys], float))
    for s in range(0, len(xx) - win, hop):
        tc = (s + win / 2 - win) / SR
        fc = float(np.exp(np.interp(tc, kt, kf)))
        if fc >= 19999:
            mag = np.ones_like(f)
        else:
            r = f / fc; mag = 1 / np.sqrt(1 + r ** 8) * (1 + 0.6 * np.exp(-((r - 1) / 0.18) ** 2))   # a little resonance at the corner
        for c in range(2):
            X = np.fft.rfft(xx[s:s + win, c] * w)
            out[s:s + win, c] += np.fft.irfft(X * mag, win) * w
        norm_[s:s + win] += w * w
    out /= np.maximum(norm_, 1e-6)[:, None]
    return out[win:win + n]

def limiter(x, ceil=0.89, look=0.004, rel=0.12):
    # lookahead brickwall: gain from the peak ahead, instant attack (over the lookahead), smooth release
    n = len(x); a = np.abs(x).max(1); L = ns(look)
    pk = np.copy(a)
    for k in range(1, L + 1): pk[:-k] = np.maximum(pk[:-k], a[k:])
    g = np.minimum(1, ceil / np.maximum(pk, 1e-9))
    out = np.empty(n); r = np.exp(-1 / (rel * SR)); cur = 1.0
    gs = g
    for i in range(n):
        v = gs[i]
        cur = v if v < cur else v + (cur - v) * r
        out[i] = cur
    # smooth the attack over the lookahead so the gain never steps
    k = np.hanning(2 * L + 1); k /= k.sum()
    out = np.minimum(out, np.convolve(out, k, 'same'))
    return x * out[:, None], out

def build(cfg, out):
    mus = wav_read(cfg['music']) * cfg.get('music_gain', 1.0)
    length = cfg['len']; n = ns(length)
    m = np.zeros((n, 2)); m[:min(n, len(mus))] = mus[:n]
    if cfg.get('lp'): m = stft_lp(m, cfg['lp'])
    # drop-outs: the music cuts on t0 (a short fade), its last moment rings on in a reverb tail, it slams back on t1
    for d in cfg.get('drop', []):
        t0, t1 = d[0], d[1]; i0, i1 = ns(t0), ns(t1)
        src = m[max(0, i0 - ns(0.35)):i0].copy()
        tail = conv(src * np.hanning(len(src) * 2)[len(src):, None], ir(d[2] if len(d) > 2 else 2.2, 21, 0.4))
        tail = tail[len(src):]
        g = np.ones(n); fo = ns(0.012); g[i0:i0 + fo] = np.linspace(1, 0, fo); g[i0 + fo:i1] = 0
        m *= g[:, None]
        k = min(len(tail), n - i0); tail = tail[:k] * (d[3] if len(d) > 3 else 0.5)
        tail[-ns(0.02):] *= np.linspace(1, 0, ns(0.02))[:, None]
        tail[max(0, i1 - i0 - ns(0.01)):] *= 0   # nothing of the tail over the slam
        m[i0:i0 + k] += tail
    if cfg.get('tail'):
        t, secs = cfg['tail']; i = ns(t); src = m[max(0, i - ns(0.5)):i]
        tl = conv(src, ir(secs, 23, 0.35))[len(src):] * cfg.get('tail_gain', 0.35)
        k = min(len(tl), n - i); m[i:i + k] += tl[:k]
    fx = np.zeros((n, 2)); duck = np.ones(n)
    cache = {}
    for c in cfg['cues']:
        key = json.dumps({k: v for k, v in c.items() if k not in ('t', 'g', 'p', 'duck', 'duckT', 'src')}, sort_keys=True)
        if key not in cache:
            y = FX[c['k']](c)
            # a sound heard in slow motion plays slower and lower (debris builds its own)
            if c.get('slow') and c['k'] in ('explosion', 'goal', 'post', 'impact', 'ball'): y = stretch(y, c['slow'])
            if c.get('cut') and len(y) > ns(c['cut']):
                y = y[:ns(c['cut'])].copy(); fl = ns(c['cut'] * 0.45); y[-fl:] *= np.linspace(1, 0, fl)[:, None] ** 1.5
            cache[key] = y
        y = cache[key]
        if c.get('p'):
            a = (c['p'] + 1) * np.pi / 4; y = y * np.array([np.cos(a), np.sin(a)]) * np.sqrt(2)
        # a cue whose sound ends ON t (riser, swell) passes its end time; the rest start at t
        t0 = c['t'] - (len(y) / SR if c.get('end') else 0)
        i = ns(t0); j0 = max(0, -i); i = max(0, i); k = min(len(y) - j0, n - i)
        if k > 0: fx[i:i + k] += y[j0:j0 + k] * c.get('g', 0.5)
        if c.get('duck'):
            dd, ln = c['duck'], ns(c.get('duckT', 0.6)); i2 = ns(c['t'])
            e = 1 - dd * np.exp(-np.arange(ln) / (ln / 3)); e[:ns(0.004)] = np.linspace(1, e[ns(0.004)], ns(0.004))
            k2 = min(ln, n - i2)
            if k2 > 0: duck[i2:i2 + k2] = np.minimum(duck[i2:i2 + k2], e[:k2])
    mix = m * duck[:, None] + fx
    fo = ns(cfg.get('fadeout', 0.6)); mix[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 2
    lim, g = limiter(mix, cfg.get('ceil', 0.89))
    wav_write(out, lim)
    rms = np.sqrt((lim ** 2).mean())
    print('wrote', out, 'secs', round(n / SR, 2), 'peak', round(float(np.abs(lim).max()), 3), 'rms dBFS', round(20 * np.log10(rms), 1),
          'max gain reduction dB', round(float(20 * np.log10(g.min())), 1), 'reduced >3 dB secs', round(float((g < 0.708).sum() / SR), 2))
    return lim

def strip(x, path, h=300):
    # spectrogram + waveform strip for looking at a sound
    m = x.mean(1) if x.ndim > 1 else x
    win, hop = 1024, 256; nf = max(1, (len(m) - win) // hop)
    S = np.array([np.abs(np.fft.rfft(m[i * hop:i * hop + win] * np.hanning(win))) for i in range(nf)])
    S = np.log10(S + 1e-5); S = (S - S.max() + 5) / 5; S = np.clip(S, 0, 1)
    fr = np.fft.rfftfreq(win, 1 / SR); ys = np.clip((np.log10(np.maximum(fr, 20)) - np.log10(20)) / (np.log10(20000) - np.log10(20)), 0, 1)
    W = min(1600, nf); img = np.zeros((h + 100, W, 3), np.uint8)
    xs = (np.arange(nf) * W // nf)
    for i in range(nf):
        col = np.zeros(h); idx = (ys * (h - 1)).astype(int); np.maximum.at(col, idx, S[i])
        img[:h, xs[i], :] = np.stack([col * 255, col * 180, col * 60], 1)[::-1].astype(np.uint8)
    env = np.array([np.abs(m[i * hop:i * hop + win]).max() for i in range(nf)])
    for i in range(nf):
        v = int(min(1, env[i]) * 48); img[h + 50 - v:h + 50 + v, xs[i]] = (120, 200, 255)
    hh, ww, _ = img.shape
    raw = b''.join(b'\x00' + img[y].tobytes() for y in range(hh))
    ck = lambda k, d: struct.pack('>I', len(d)) + k + d + struct.pack('>I', zlib.crc32(k + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ck(b'IHDR', struct.pack('>IIBBBBB', ww, hh, 8, 2, 0, 0, 0)) + ck(b'IDAT', zlib.compress(raw, 6)) + ck(b'IEND', b''))

if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == '--test':
        d = a[1]; os.makedirs(d, exist_ok=True)
        tests = dict(impact={'size': 1.0}, hit={}, whoosh={'dur': 0.8}, riser={'dur': 2.0}, swell={'dur': 1.0}, ball={'v': 110}, ball_soft={'k': 'ball', 'v': 40},
                     post={}, goal={}, explosion={}, beep={}, shing={}, crackle={}, drone={'dur': 5})
        for k, c in tests.items():
            kk = c.pop('k', k); y = FX[kk](c)
            wav_write(os.path.join(d, k + '.wav'), y * 0.8); strip(y, os.path.join(d, k + '.png'))
            print(k, 'secs', round(len(y) / SR, 2), 'peak', round(float(np.abs(y).max()), 2), 'rms dB', round(20 * np.log10(np.sqrt((y ** 2).mean()) + 1e-9), 1), 'nan', bool(np.isnan(y).any()))
    else:
        cfg = json.load(open(a[0])); build(cfg, a[1])
