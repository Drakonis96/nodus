import { useId, useMemo, type CSSProperties } from 'react';
import { NODI_ORB_DEFAULT_COLOR, hueOfHex } from '@shared/nodiOrb';
import type { NodiState } from './Nodi';
import './nodiOrb.css';

/**
 * Nodi, drawn as an orb: a glass sphere holding a galaxy, ringed by three tilted
 * orbits. The alternative to the classic character for users who want a soberer
 * companion — same states, same props, so the two are interchangeable.
 *
 * Everything cool in it derives from one hue (see shared/nodiOrb.ts); the golds are
 * fixed. The heavy detail — the constellation, the starfield, the dust, the confetti —
 * is generated deterministically here rather than hand-authored, so the sphere reads
 * as photographic without a hand-placed thousand-node SVG.
 */

type Star = { x: number; y: number; r: number; o: number; warm: boolean; tw: boolean; delay: number; blur: boolean };
type MeshLine = { x1: number; y1: number; x2: number; y2: number; w: number; o: number };
type MeshNode = { x: number; y: number; r: number; o: number; accent?: 'n-c' | 'n-v' | 'n-g'; tw: boolean; delay: number };
type Dust = { x: number; y: number; r: number; warm: boolean; delay: number; duration: number };
type Party = { star: boolean; scale: number; r: number; px: number; py: number; delay: number; tone: number };

/** Deterministic pseudo-random source: the orb must look identical on every render. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Stars inside the sphere: many small, a few warm, some twinkling, the big ones soft. */
function buildStarfield(): Star[] {
  const rnd = seeded(42);
  const stars: Star[] = [];
  for (let i = 0; i < 90; i++) {
    const angle = rnd() * Math.PI * 2;
    const radius = Math.sqrt(rnd()) * 76;
    const r = 0.3 + rnd() * 1.1;
    stars.push({
      x: 160 + Math.cos(angle) * radius,
      y: 160 + Math.sin(angle) * radius,
      r,
      o: 0.2 + rnd() * 0.7,
      warm: rnd() < 0.16,
      tw: rnd() < 0.28,
      delay: rnd() * 4,
      blur: r > 1.15,
    });
  }
  return stars;
}

/** The constellation: the same fibonacci-sphere mesh the classic Nodi carries in its
 *  body, projected to 2D and joined to nearest neighbours, opacity by depth. */
function buildMesh(): { lines: MeshLine[]; nodes: MeshNode[] } {
  const cx = 160;
  const cy = 160;
  const R = 54;
  const N = 50;
  const pts: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963229;
    pts.push({ x: cx + Math.cos(th) * rr * R, y: cy - y * R, z: Math.sin(th) * rr });
  }
  const lines: MeshLine[] = [];
  const done = new Set<string>();
  for (let a = 0; a < N; a++) {
    const order = pts
      .map((_, b) => b)
      .filter((b) => b !== a)
      .map((b) => ({ b, d: Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y) }))
      .sort((p, q) => p.d - q.d);
    for (let k = 0; k < 3; k++) {
      const { b, d } = order[k];
      if (d > R * 0.82) continue;
      const key = `${Math.min(a, b)}_${Math.max(a, b)}`;
      if (done.has(key)) continue;
      done.add(key);
      const depth = ((pts[a].z + pts[b].z) / 2 + 1) / 2;
      lines.push({ x1: pts[a].x, y1: pts[a].y, x2: pts[b].x, y2: pts[b].y, w: 0.35 + depth * 0.35, o: 0.05 + depth * 0.18 });
    }
  }
  const accents: Record<number, ['n-c' | 'n-v' | 'n-g', number]> = { 7: ['n-v', 3.2], 19: ['n-c', 2.8], 31: ['n-v', 2.3], 43: ['n-g', 2.5] };
  const nodes = pts.map((p, i) => {
    const depth = (p.z + 1) / 2;
    const accent = accents[i];
    return accent
      ? { x: p.x, y: p.y, r: accent[1], o: 1, accent: accent[0], tw: false, delay: i * 0.13 }
      : { x: p.x, y: p.y, r: 0.7 + depth * 0.8, o: 0.3 + depth * 0.55, tw: i % 5 === 0, delay: i * 0.21 };
  });
  return { lines, nodes };
}

/** Motes of light drifting around the sphere. */
function buildDust(): Dust[] {
  const rnd = seeded(7);
  const dust: Dust[] = [];
  for (let i = 0; i < 14; i++) {
    const angle = rnd() * Math.PI * 2;
    const dist = 95 + rnd() * 55;
    dust.push({
      x: 160 + Math.cos(angle) * dist,
      y: 160 + Math.sin(angle) * dist * 0.8,
      r: 0.6 + rnd() * 1,
      warm: rnd() < 0.6,
      delay: rnd() * 5,
      duration: 3.5 + rnd() * 4,
    });
  }
  return dust;
}

/** The celebration burst: particles thrown outward on their own vectors. */
function buildParty(): Party[] {
  const party: Party[] = [];
  for (let i = 0; i < 22; i++) {
    const angle = (i / 22) * Math.PI * 2 + (i % 3) * 0.31;
    const dist = 92 + (i % 5) * 16;
    const star = i % 4 === 0;
    const scale = 0.22 + (i % 3) * 0.1;
    // A star sits inside a scaled <g>, so its travel has to be divided by that scale
    // to land where a plain, unscaled particle would.
    const k = star ? 1 / scale : 1;
    party.push({
      star,
      scale,
      r: 1.6 + (i % 3),
      px: Math.cos(angle) * dist * k,
      py: (Math.sin(angle) * dist * 0.82 - 14) * k,
      delay: (i % 7) * 0.13,
      tone: i % 6,
    });
  }
  return party;
}

/** feColorMatrix can't read CSS variables, so the cloud texture is tinted here. */
function cloudTintMatrix(hue: number): string {
  const h = (hue + 7) % 360;
  const s = 1;
  const l = 0.72;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return `0 0 0 0 ${f(0).toFixed(3)} 0 0 0 0 ${f(8).toFixed(3)} 0 0 0 0 ${f(4).toFixed(3)} 0.35 0.35 0.35 0 -0.18`;
}

export function NodiOrb({
  state = 'idle',
  hue,
  height = 200,
  draggable = false,
  raiseArm = false,
  className,
  style,
}: {
  state?: NodiState;
  /** Hue (0–359) every cool colour derives from. Defaults to Nodi's own blue. */
  hue?: number;
  height?: number;
  draggable?: boolean;
  /** Flag an unread notification — the orb's equivalent of the classic Nodi's raised arm. */
  raiseArm?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const starfield = useMemo(buildStarfield, []);
  const mesh = useMemo(buildMesh, []);
  const dust = useMemo(buildDust, []);
  const party = useMemo(buildParty, []);
  const resolvedHue = hue ?? hueOfHex(NODI_ORB_DEFAULT_COLOR);

  // Namespace the gradient/filter/clip ids so several orbs — in different colours —
  // can coexist in one document. Without this, url(#id) would resolve to whichever
  // orb rendered first and every orb would share its hue.
  const raw = useId();
  const uid = `orb-${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
  const u = (id: string) => `${uid}-${id}`;
  const ref = (id: string) => `url(#${uid}-${id})`;

  return (
    <svg
      className={['nodi-orb', draggable ? 'nodi-draggable' : '', raiseArm ? 'arm-up' : '', className].filter(Boolean).join(' ')}
      style={{ height, ['--nodi-hue' as string]: `${resolvedHue}deg`, ...style }}
      viewBox="0 0 320 340"
      role="img"
      aria-label="Nodi"
      data-state={state}
    >
      <defs>
        <filter id={u('b1')} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.2" /></filter>
        <filter id={u('b2')} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.2" /></filter>
        <filter id={u('b4')} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4" /></filter>
        <filter id={u('b6')} x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="6" /></filter>
        <filter id={u('b10')} x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="10" /></filter>
        <filter id={u('b14')} x="-160%" y="-160%" width="420%" height="420%"><feGaussianBlur stdDeviation="14" /></filter>

        <filter id={u('clouds')} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="4" seed="11" result="n" />
          <feColorMatrix in="n" type="matrix" values={cloudTintMatrix(resolvedHue)} />
        </filter>

        <radialGradient id={u('deepSpace')} cx="42%" cy="36%" r="85%">
          <stop offset="0%" className="st-deep1" />
          <stop offset="45%" className="st-deep2" />
          <stop offset="80%" className="st-deep3" />
          <stop offset="100%" className="st-deep4" />
        </radialGradient>
        <radialGradient id={u('vignette')} cx="42%" cy="36%" r="72%">
          <stop offset="0%" stopColor="#000000" stopOpacity="0" />
          <stop offset="72%" stopColor="#000208" stopOpacity="0" />
          <stop offset="100%" stopColor="#000208" stopOpacity=".55" />
        </radialGradient>
        <radialGradient id={u('coreBloomG')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" className="st-core1" stopOpacity=".95" />
          <stop offset="30%" className="st-core2" stopOpacity=".5" />
          <stop offset="65%" className="st-core3" stopOpacity=".16" />
          <stop offset="100%" className="st-core3" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={u('haloG')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" className="st-halo1" stopOpacity=".32" />
          <stop offset="55%" className="st-halo2" stopOpacity=".14" />
          <stop offset="100%" className="st-halo2" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={u('bottomGlow')} cx="50%" cy="100%" r="90%">
          <stop offset="0%" className="st-bot1" stopOpacity=".4" />
          <stop offset="45%" className="st-bot2" stopOpacity=".12" />
          <stop offset="100%" className="st-bot2" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={u('pedGlow')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" className="st-ped1" stopOpacity=".4" />
          <stop offset="60%" className="st-ped2" stopOpacity=".14" />
          <stop offset="100%" className="st-ped2" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={u('pedShadowG')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#26314a" stopOpacity=".38" />
          <stop offset="70%" stopColor="#26314a" stopOpacity=".12" />
          <stop offset="100%" stopColor="#26314a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={u('satHaloGold')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffe9a8" stopOpacity=".9" />
          <stop offset="40%" stopColor="#f7c95e" stopOpacity=".35" />
          <stop offset="100%" stopColor="#f7c95e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={u('satHaloCyan')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" className="st-satc1" stopOpacity=".9" />
          <stop offset="40%" className="st-satc2" stopOpacity=".35" />
          <stop offset="100%" className="st-satc2" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={u('satHaloViolet')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" className="st-satv1" stopOpacity=".9" />
          <stop offset="40%" className="st-satv2" stopOpacity=".35" />
          <stop offset="100%" className="st-satv2" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={u('ringGoldG')} x1="0%" y1="0%" x2="100%" y2="70%">
          <stop offset="0%" stopColor="#ffe9a8" stopOpacity=".95" />
          <stop offset="45%" stopColor="#c99b3f" stopOpacity=".55" />
          <stop offset="100%" stopColor="#8a6a2a" stopOpacity=".26" />
        </linearGradient>
        <linearGradient id={u('ringCyanG')} x1="100%" y1="0%" x2="0%" y2="70%">
          <stop offset="0%" className="st-ringc1" stopOpacity=".75" />
          <stop offset="55%" className="st-ringc2" stopOpacity=".35" />
          <stop offset="100%" className="st-ringc3" stopOpacity=".15" />
        </linearGradient>
        <linearGradient id={u('loadGrad')} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" className="st-load1" stopOpacity="0" />
          <stop offset="55%" className="st-load1" stopOpacity=".85" />
          <stop offset="100%" className="st-load2" />
        </linearGradient>
        <linearGradient id={u('shimmerG')} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity=".2" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={u('rimFresnel')} x1="0%" y1="0%" x2="35%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity=".85" />
          <stop offset="45%" className="st-rim2" stopOpacity=".3" />
          <stop offset="100%" className="st-rim3" stopOpacity=".55" />
        </linearGradient>

        <clipPath id={u('sphereClip')}><circle cx="160" cy="160" r="79" /></clipPath>
        <path id={u('star4')} d="M0,-16 C1.4,-5.5 5.5,-1.4 16,0 C5.5,1.4 1.4,5.5 0,16 C-1.4,5.5 -5.5,1.4 -16,0 C-5.5,-1.4 -1.4,-5.5 0,-16 Z" />
      </defs>

      <g className="float">
        <circle className="halo add" cx="160" cy="160" r="132" fill={ref('haloG')} />

        <g className="ped-glow">
          <ellipse className="add" cx="160" cy="297" rx="98" ry="17" fill={ref('pedGlow')} />
          <ellipse className="ped-pulse ped-ln1" cx="160" cy="297" rx="80" ry="12" fill="none" strokeWidth="1.2" filter={ref('b1')} />
          <ellipse className="ped-ln2" cx="160" cy="299" rx="48" ry="7" fill="none" strokeWidth="1" filter={ref('b1')} />
        </g>
        <g className="ped-shadow">
          <ellipse cx="160" cy="292" rx="72" ry="13" fill={ref('pedShadowG')} />
        </g>

        {/* Orbits: a soft blurred underlay carries the light, a crisp line the shape. */}
        <g transform="rotate(-16 160 160)">
          <ellipse className="ring ring-glow add" cx="160" cy="160" rx="130" ry="42" stroke="rgba(232,198,106,.35)" strokeWidth="3.2" filter={ref('b4')} fill="none" />
          <ellipse className="ring ring-gold-line" cx="160" cy="160" rx="130" ry="42" stroke={ref('ringGoldG')} strokeWidth="1.1" fill="none" />
        </g>
        <g transform="rotate(22 160 160)">
          <ellipse className="ring ring-glow rgB add" cx="160" cy="160" rx="118" ry="54" strokeWidth="2.6" filter={ref('b4')} fill="none" />
          <ellipse className="ring ring-cyan-line" cx="160" cy="160" rx="118" ry="54" stroke={ref('ringCyanG')} strokeWidth=".9" fill="none" />
        </g>
        <g transform="rotate(-38 160 160)">
          <ellipse className="ring ring-glow add" cx="160" cy="160" rx="142" ry="30" stroke="rgba(220,210,190,.16)" strokeWidth="2.2" filter={ref('b4')} fill="none" />
          <ellipse className="ring ring-dim-line" cx="160" cy="160" rx="142" ry="30" stroke={ref('ringGoldG')} strokeWidth=".7" opacity=".55" fill="none" />
        </g>

        <g>
          {dust.map((d, i) => (
            <circle
              key={i}
              className="dust"
              cx={d.x.toFixed(1)}
              cy={d.y.toFixed(1)}
              r={d.r.toFixed(2)}
              fill={d.warm ? 'rgba(255,233,168,.9)' : 'rgba(190,235,255,.85)'}
              style={{ animationDelay: `${d.delay.toFixed(2)}s`, animationDuration: `${d.duration.toFixed(2)}s` }}
            />
          ))}
        </g>

        {/* ── the sphere ───────────────────────────────────────────────────────── */}
        <g>
          {/* The interior is opaque: this is a marble of galaxy, not a soap bubble. */}
          <circle cx="160" cy="160" r="79" fill={ref('deepSpace')} />

          <g clipPath={ref('sphereClip')}>
            <circle className="add" cx="160" cy="160" r="79" filter={ref('clouds')} opacity=".5" />

            <g className="neb-spin">
              <ellipse className="neb-arm1 add" cx="160" cy="160" rx="52" ry="20" fill="none" strokeWidth="16" transform="rotate(28 160 160)" filter={ref('b10')} opacity=".6" />
              <ellipse className="neb-arm1b add" cx="164" cy="156" rx="60" ry="13" fill="none" strokeWidth="9" transform="rotate(6 160 160)" filter={ref('b10')} opacity=".38" />
            </g>
            <g className="neb-spin2">
              <ellipse className="neb-arm2 add" cx="156" cy="164" rx="42" ry="26" fill="none" strokeWidth="13" transform="rotate(-22 160 160)" filter={ref('b14')} opacity=".42" />
              <circle className="neb-cloud add" cx="150" cy="150" r="30" filter={ref('b14')} opacity=".5" />
            </g>

            <g>
              {starfield.map((s, i) => (
                <circle
                  key={i}
                  className={s.tw ? 'star-tw' : undefined}
                  cx={s.x.toFixed(1)}
                  cy={s.y.toFixed(1)}
                  r={s.r.toFixed(2)}
                  fill={s.warm ? 'rgba(255,233,168,.9)' : 'rgba(226,240,255,.9)'}
                  opacity={s.o.toFixed(2)}
                  filter={s.blur ? ref('b1') : undefined}
                  style={s.tw ? { animationDelay: `${s.delay.toFixed(2)}s` } : undefined}
                />
              ))}
            </g>

            <g className="mesh">
              {mesh.lines.map((l, i) => (
                <line key={i} className="mln" x1={l.x1.toFixed(1)} y1={l.y1.toFixed(1)} x2={l.x2.toFixed(1)} y2={l.y2.toFixed(1)} strokeOpacity={l.o.toFixed(2)} strokeWidth={l.w.toFixed(2)} />
              ))}
              {mesh.nodes.map((n, i) =>
                n.accent ? (
                  <g key={i}>
                    <circle className={`${n.accent} add`} cx={n.x.toFixed(1)} cy={n.y.toFixed(1)} r={(n.r * 3.2).toFixed(1)} opacity=".28" filter={ref('b4')} />
                    <circle className={`${n.accent} accent`} cx={n.x.toFixed(1)} cy={n.y.toFixed(1)} r={n.r} style={{ animationDelay: `${n.delay.toFixed(2)}s` }} />
                  </g>
                ) : (
                  <circle
                    key={i}
                    className={n.tw ? 'tw' : undefined}
                    cx={n.x.toFixed(1)}
                    cy={n.y.toFixed(1)}
                    r={n.r.toFixed(2)}
                    fill={`rgba(226,242,255,${n.o.toFixed(2)})`}
                    style={n.tw ? { animationDelay: `${n.delay.toFixed(2)}s` } : undefined}
                  />
                )
              )}
            </g>

            <circle className="add" cx="160" cy="160" r="79" fill={ref('bottomGlow')} />

            <g className="fx fx-connecting">
              <path className="link-base" d="M112,186 L150,128 L206,152 L176,196" />
              <path className="link-pulse" d="M112,186 L150,128 L206,152 L176,196" filter={ref('b2')} />
              <path className="link-base" d="M122,120 L168,172 L214,122" />
              <path className="link-pulse p2" d="M122,120 L168,172 L214,122" filter={ref('b2')} />
              <path className="link-base" d="M104,150 L160,160 L212,180" />
              <path className="link-pulse p3" d="M104,150 L160,160 L212,180" filter={ref('b2')} />
              <circle className="link-node" cx="150" cy="128" r="3.2" filter={ref('b2')} />
              <circle className="link-node" cx="206" cy="152" r="2.8" filter={ref('b2')} />
              <circle className="link-node" cx="168" cy="172" r="2.8" filter={ref('b2')} />
            </g>

            <g className="core">
              <circle className="add" cx="160" cy="160" r="46" fill={ref('coreBloomG')} opacity=".8" />
              <circle className="core-mid add" cx="160" cy="160" r="18" filter={ref('b6')} opacity=".8" />
              <circle cx="160" cy="160" r="5.5" fill="#ffffff" filter={ref('b1')} />
              <circle cx="160" cy="160" r="2.6" fill="#ffffff" />
            </g>
            <g className="flare add">
              <ellipse className="flare-el" cx="160" cy="160" rx="1.6" ry="34" filter={ref('b2')} />
              <ellipse className="flare-el" cx="160" cy="160" rx="26" ry="1.4" filter={ref('b2')} />
              <ellipse cx="160" cy="160" rx="1" ry="14" fill="#ffffff" transform="rotate(45 160 160)" filter={ref('b2')} opacity=".6" />
            </g>

            <rect className="shimmer" x="118" y="68" width="48" height="188" fill={ref('shimmerG')} />

            {/* Spherical shading: the interior falls away toward the rim. */}
            <circle cx="160" cy="160" r="79" fill={ref('vignette')} />
          </g>

          {/* ── the glass shell ─────────────────────────────────────────────────── */}
          <circle className="rim-glow-in add" cx="160" cy="160" r="76.5" fill="none" strokeWidth="4" filter={ref('b4')} />
          <circle cx="160" cy="160" r="79" fill="none" stroke={ref('rimFresnel')} strokeWidth="1.5" />
          <circle className="rim-glow-out add" cx="160" cy="160" r="80.5" fill="none" strokeWidth="2.4" filter={ref('b4')} />
          <ellipse cx="131" cy="110" rx="27" ry="15" fill="rgba(255,255,255,.32)" transform="rotate(-33 131 110)" filter={ref('b6')} />
          <ellipse cx="124" cy="103" rx="10" ry="5.5" fill="rgba(255,255,255,.75)" transform="rotate(-33 124 103)" filter={ref('b2')} />
          <circle cx="117" cy="97" r="1.6" fill="#ffffff" filter={ref('b1')} />
          <ellipse className="rim-bounce add" cx="196" cy="216" rx="14" ry="6" transform="rotate(-36 196 216)" filter={ref('b4')} />
          <path className="rim-base-arc add" d="M103,207 A79,79 0 0 0 192,232" fill="none" strokeWidth="2.4" strokeLinecap="round" filter={ref('b2')} />
        </g>

        {/* The fixed translate lives on a wrapper <g>: the CSS animation on .spk sets
            transform, which would otherwise replace the positioning attribute. */}
        <g className="fx fx-discovering">
          <g transform="translate(126,134) scale(.5)"><use href={`#${u('star4')}`} className="spk" filter={ref('b1')} /></g>
          <g transform="translate(196,142) scale(.42)"><use href={`#${u('star4')}`} className="spk s2" filter={ref('b1')} /></g>
          <g transform="translate(150,196) scale(.38)"><use href={`#${u('star4')}`} className="spk s3" filter={ref('b1')} /></g>
          <g transform="translate(184,182) scale(.55)"><use href={`#${u('star4')}`} className="spk s4" filter={ref('b1')} /></g>
        </g>

        <g className="fx fx-thinking">
          <circle className="think-ring" cx="160" cy="160" r="66" />
        </g>

        {/* Satellites: a hot core inside a gradient halo, carried along the orbit. */}
        <g transform="rotate(-16 160 160)">
          <g className="sat" style={{ ['--dur' as string]: '9s', ['--delay' as string]: '0s', offsetPath: "path('M290,160 A130,42 0 1 1 30,160 A130,42 0 1 1 290,160')" }}>
            <circle r="11" fill={ref('satHaloGold')} className="add" />
            <circle r="3" fill="#fff6d8" />
          </g>
          <g className="sat" style={{ ['--dur' as string]: '9s', ['--delay' as string]: '-4.2s', offsetPath: "path('M290,160 A130,42 0 1 1 30,160 A130,42 0 1 1 290,160')" }}>
            <circle r="6.5" fill={ref('satHaloGold')} className="add" />
            <circle r="1.8" fill="#fff6d8" />
          </g>
        </g>
        <g transform="rotate(22 160 160)">
          <g className="sat" style={{ ['--dur' as string]: '12.5s', ['--delay' as string]: '-2s', offsetPath: "path('M278,160 A118,54 0 1 1 42,160 A118,54 0 1 1 278,160')" }}>
            <circle r="10" fill={ref('satHaloCyan')} className="add" />
            <circle r="2.8" fill="#eefbff" />
          </g>
          <g className="sat" style={{ ['--dur' as string]: '12.5s', ['--delay' as string]: '-8.5s', offsetPath: "path('M278,160 A118,54 0 1 1 42,160 A118,54 0 1 1 278,160')" }}>
            <circle r="6" fill={ref('satHaloCyan')} className="add" />
            <circle r="1.7" fill="#eefbff" />
          </g>
        </g>
        <g transform="rotate(-38 160 160)">
          <g className="sat" style={{ ['--dur' as string]: '16s', ['--delay' as string]: '-6s', offsetPath: "path('M302,160 A142,30 0 1 1 18,160 A142,30 0 1 1 302,160')" }}>
            <circle r="9" fill={ref('satHaloViolet')} className="add" />
            <circle r="2.5" fill="#f2ecff" />
          </g>
          <g className="sat" style={{ ['--dur' as string]: '16s', ['--delay' as string]: '-12s', offsetPath: "path('M302,160 A142,30 0 1 1 18,160 A142,30 0 1 1 302,160')" }}>
            <circle r="5.5" fill={ref('satHaloGold')} className="add" />
            <circle r="1.6" fill="#fff6d8" />
          </g>
        </g>

        <g className="fx fx-loading">
          <circle className="load-track" cx="160" cy="160" r="98" />
          <g className="load-group">
            <circle className="load-arc-glow add" cx="160" cy="160" r="98" filter={ref('b6')} />
            <circle className="load-arc" cx="160" cy="160" r="98" stroke={ref('loadGrad')} />
            <circle className="load-head" cx="258" cy="160" r="3.6" filter={ref('b2')} />
          </g>
        </g>

        <g className="fx fx-notify">
          <circle className="noti-ripple" cx="160" cy="64" r="16" />
          <circle className="noti-halo add" cx="160" cy="64" r="17" fill={ref('satHaloGold')} />
          <g transform="translate(160,64) scale(.8)"><use href={`#${u('star4')}`} className="noti-star" /></g>
        </g>

        <g className="fx fx-celebrating">
          {party.map((p, i) =>
            p.star ? (
              <g key={i} transform={`translate(160,160) scale(${p.scale.toFixed(2)})`}>
                <use
                  href={`#${u('star4')}`}
                  className={`party pc${p.tone}`}
                  style={{ ['--px' as string]: `${p.px.toFixed(0)}px`, ['--py' as string]: `${p.py.toFixed(0)}px`, ['--pd' as string]: `${p.delay.toFixed(2)}s` }}
                />
              </g>
            ) : (
              <circle
                key={i}
                className={`party pc${p.tone}`}
                cx="160"
                cy="160"
                r={p.r.toFixed(1)}
                style={{ ['--px' as string]: `${p.px.toFixed(0)}px`, ['--py' as string]: `${p.py.toFixed(0)}px`, ['--pd' as string]: `${p.delay.toFixed(2)}s` }}
              />
            )
          )}
        </g>

        <g className="fx fx-sleeping">
          <path className="moon" d="M216,84 a13,13 0 1 0 10,21 a10.5,10.5 0 1 1 -10,-21 Z" filter={ref('b1')} />
        </g>
      </g>

      {/* Outside .float so the collapse animation's scale doesn't shrink the rings. */}
      <circle className="close-flash" cx="160" cy="160" r="70" filter={ref('b1')} />
      <circle className="close-flash c2" cx="160" cy="160" r="70" filter={ref('b1')} />
    </svg>
  );
}
