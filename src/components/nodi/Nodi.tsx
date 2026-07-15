import { useId, useMemo, type CSSProperties } from 'react';
import './nodi.css';

export type NodiState =
  | 'idle'
  | 'thinking'
  | 'connecting'
  | 'discovering'
  | 'waving'
  | 'celebrating'
  | 'loading'
  | 'sleeping';
export type NodiRole = 'none' | 'academic' | 'genealogy' | 'study';

type MeshNode = { x: number; y: number; z: number };

/** Deterministic geodesic mesh drawn inside the body: fibonacci-sphere points
 *  projected to 2D, joined to their nearest neighbours, opacity by depth. */
function buildMesh() {
  const cx = 130;
  const cy = 140;
  const R = 52;
  const N = 58;
  const pts: MeshNode[] = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963229;
    pts.push({ x: cx + Math.cos(th) * rr * R, y: cy - y * R, z: Math.sin(th) * rr });
  }
  const lines: { x1: number; y1: number; x2: number; y2: number; w: number; o: number }[] = [];
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
      lines.push({ x1: pts[a].x, y1: pts[a].y, x2: pts[b].x, y2: pts[b].y, w: 0.4 + depth * 0.4, o: 0.05 + depth * 0.2 });
    }
  }
  const dots = pts.map((p) => {
    const depth = (p.z + 1) / 2;
    return { x: p.x, y: p.y, r: 0.7 + depth * 0.6, o: 0.18 + depth * 0.35 };
  });
  const sparks = [6, 17, 24, 33, 41, 50]
    .map((si) => pts[si])
    .filter((p) => p && p.z >= 0)
    .map((p, n) => ({ x: p.x, y: p.y, delay: n * 0.35 }));
  return { lines, dots, sparks };
}

function Pearl({ big = false, glow, pearl }: { big?: boolean; glow: string; pearl: string }) {
  const rim = big ? 9 : 8.5;
  return (
    <>
      <circle r={big ? 12 : 11} fill="#FFEFC0" opacity=".55" filter={glow} />
      <circle r={rim} fill={pearl} />
      <circle r={rim} fill="none" stroke="#D4AF37" strokeWidth="1.5" opacity=".85" />
      <ellipse cx={-3} cy={-3} rx={big ? 2.4 : 2.2} ry={big ? 1.7 : 1.6} fill="#FFFEF6" opacity=".85" />
    </>
  );
}

export function Nodi({
  state = 'idle',
  role = 'none',
  height = 200,
  draggable = false,
  raiseArm = false,
  className,
  style,
}: {
  state?: NodiState;
  role?: NodiRole;
  height?: number;
  draggable?: boolean;
  /** Raise Nodi's right arm (e.g. to flag an unread notification). */
  raiseArm?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const mesh = useMemo(buildMesh, []);
  // Namespace the gradient/filter/clip IDs so several Nodi can coexist in one document.
  const raw = useId();
  const uid = `nodi-${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
  const u = (id: string) => `${uid}-${id}`;
  const ref = (id: string) => `url(#${uid}-${id})`;

  return (
    <svg
      className={['nodi-svg', draggable ? 'nodi-draggable' : '', raiseArm ? 'arm-up' : '', className].filter(Boolean).join(' ')}
      style={{ height, ...style }}
      viewBox="0 0 270 300"
      role="img"
      aria-label="Nodi"
      data-state={state}
      data-role={role}
    >
      <defs>
        <radialGradient id={u('bodyG')} cx="40%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#FFFEFA" />
          <stop offset="40%" stopColor="#FBF3DE" />
          <stop offset="78%" stopColor="#F2E4C2" />
          <stop offset="100%" stopColor="#E7D5AC" />
        </radialGradient>
        <radialGradient id={u('pearlG')} cx="36%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#FFFEF6" />
          <stop offset="60%" stopColor="#F6EAC9" />
          <stop offset="100%" stopColor="#E4D0A2" />
        </radialGradient>
        <radialGradient id={u('eyeG')} cx="38%" cy="28%" r="75%">
          <stop offset="0%" stopColor="#7a5330" />
          <stop offset="45%" stopColor="#3a2412" />
          <stop offset="100%" stopColor="#160c04" />
        </radialGradient>
        <linearGradient id={u('stemG')} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#2f6b3c" />
          <stop offset="100%" stopColor="#57a862" />
        </linearGradient>
        <radialGradient id={u('leafG')} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#63c07a" />
          <stop offset="100%" stopColor="#2c7d47" />
        </radialGradient>
        <radialGradient id={u('goldG')} cx="34%" cy="28%" r="78%">
          <stop offset="0%" stopColor="#FCEEB6" />
          <stop offset="45%" stopColor="#E4C368" />
          <stop offset="100%" stopColor="#B4892C" />
        </radialGradient>
        <radialGradient id={u('haloG')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFF6D6" stopOpacity=".95" />
          <stop offset="55%" stopColor="#FBECC2" stopOpacity=".32" />
          <stop offset="100%" stopColor="#FBECC2" stopOpacity="0" />
        </radialGradient>
        <filter id={u('fSm')} x="-90%" y="-90%" width="280%" height="280%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <clipPath id={u('bodyClip')}>
          <circle cx="130" cy="140" r="56" />
        </clipPath>
      </defs>

      <g className="nodi-core">
        <circle className="halo" cx="130" cy="140" r="86" fill={ref('haloG')} />
        <g className="hoverwrap">
          <g className="limbs">
            <g className="limb arm-l">
              <path className="thread" d="M92 150 C 76 166 66 190 64 214" />
              <g className="hand"><Pearl big glow={ref('fSm')} pearl={ref('pearlG')} /></g>
            </g>
            <g className="limb arm-r">
              <path className="thread" d="M168 150 C 184 166 194 190 196 214" />
              <g className="hand"><Pearl big glow={ref('fSm')} pearl={ref('pearlG')} /></g>
            </g>
            <g className="limb leg-l">
              <path className="thread" d="M112 190 C 104 216 98 244 96 266" />
              <g className="hand"><Pearl big glow={ref('fSm')} pearl={ref('pearlG')} /></g>
            </g>
            <g className="limb leg-r">
              <path className="thread" d="M150 192 C 160 218 168 250 170 276" />
              <g className="hand"><Pearl big glow={ref('fSm')} pearl={ref('pearlG')} /></g>
            </g>
          </g>

          <circle cx="130" cy="140" r="56" fill={ref('bodyG')} />
          <g clipPath={ref('bodyClip')}>
            <g className="mesh">
              {mesh.lines.map((l, i) => (
                <line key={`l${i}`} x1={l.x1.toFixed(1)} y1={l.y1.toFixed(1)} x2={l.x2.toFixed(1)} y2={l.y2.toFixed(1)} stroke="#FFFCEC" strokeWidth={l.w.toFixed(2)} opacity={l.o.toFixed(2)} />
              ))}
              {mesh.dots.map((d, i) => (
                <circle key={`d${i}`} cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r={d.r.toFixed(2)} fill="#FFFDF0" opacity={d.o.toFixed(2)} />
              ))}
              {mesh.sparks.map((s, i) => (
                <g key={`s${i}`} className="mspark" style={{ transformBox: 'view-box', transformOrigin: `${s.x.toFixed(1)}px ${s.y.toFixed(1)}px`, animationDelay: `${s.delay.toFixed(2)}s` } as CSSProperties}>
                  <path
                    d={`M${s.x.toFixed(1)} ${(s.y - 4).toFixed(1)} L${(s.x + 0.9).toFixed(1)} ${(s.y - 0.9).toFixed(1)} L${(s.x + 4).toFixed(1)} ${s.y.toFixed(1)} L${(s.x + 0.9).toFixed(1)} ${(s.y + 0.9).toFixed(1)} L${s.x.toFixed(1)} ${(s.y + 4).toFixed(1)} L${(s.x - 0.9).toFixed(1)} ${(s.y + 0.9).toFixed(1)} L${(s.x - 4).toFixed(1)} ${s.y.toFixed(1)} L${(s.x - 0.9).toFixed(1)} ${(s.y - 0.9).toFixed(1)} Z`}
                    fill="#FFFBEA"
                  />
                </g>
              ))}
            </g>
            <ellipse cx="130" cy="176" rx="42" ry="22" fill="#C9A96A" opacity=".16" filter={ref('fSm')} />
          </g>
          <circle cx="130" cy="140" r="55" fill="none" stroke="#FFFDF2" strokeWidth="4" opacity=".8" filter={ref('fSm')} />
          <ellipse cx="110" cy="114" rx="20" ry="13" fill="#FFFFFF" opacity=".45" filter={ref('fSm')} />

          <g className="headwrap">
            <g className="face">
              <g className="eyes-open">
                <ellipse cx="113" cy="140" rx="8" ry="9" fill="#c79a63" opacity=".3" filter={ref('fSm')} />
                <ellipse cx="147" cy="140" rx="8" ry="9" fill="#c79a63" opacity=".3" filter={ref('fSm')} />
                <ellipse cx="113" cy="139" rx="5.4" ry="7.6" fill={ref('eyeG')} />
                <ellipse cx="147" cy="139" rx="5.4" ry="7.6" fill={ref('eyeG')} />
                <circle cx="115" cy="135" r="1.7" fill="#fff" opacity=".92" />
                <circle cx="149" cy="135" r="1.7" fill="#fff" opacity=".92" />
                <circle cx="112" cy="143" r="1" fill="#e9c58a" opacity=".7" />
                <circle cx="146" cy="143" r="1" fill="#e9c58a" opacity=".7" />
              </g>
              <g className="eyes-happy" fill="none" stroke="#2a1a0c" strokeWidth="2.8" strokeLinecap="round">
                <path d="M107 142 Q113 133 119 142" />
                <path d="M141 142 Q147 133 153 142" />
              </g>
              <g className="eyes-sleep" fill="none" stroke="#2a1a0c" strokeWidth="2.6" strokeLinecap="round" opacity=".85">
                <path d="M107 139 Q113 144 119 139" />
                <path d="M141 139 Q147 144 153 139" />
              </g>
              <path className="mouth-smile" d="M123 158 Q130 164 137 158" fill="none" stroke="#9a5f38" strokeWidth="2.2" strokeLinecap="round" />
              <path className="mouth-open" d="M121 156 Q130 168 139 156 Q130 162 121 156 Z" fill="#8a4f30" />
              <g className="eyes-surprised">
                <ellipse cx="113" cy="139" rx="6.7" ry="7.4" fill={ref('eyeG')} />
                <ellipse cx="147" cy="139" rx="6.7" ry="7.4" fill={ref('eyeG')} />
                <circle cx="115" cy="135" r="2.1" fill="#fff" opacity=".92" />
                <circle cx="149" cy="135" r="2.1" fill="#fff" opacity=".92" />
              </g>
              <ellipse className="mouth-surprised" cx="130" cy="161" rx="4.2" ry="5.4" fill="#7a4326" />
            </g>
          </g>

          <g className="deco deco-sweat">
            <g transform="translate(151,105)"><path className="sweatdrop" d="M0 0 C -3.5 5 -3.5 9 0 9 C 3.5 9 3.5 5 0 0 Z" fill="#a9d8f0" /></g>
            <g transform="translate(107,111)"><path className="sweatdrop" d="M0 0 C -3 4 -3 8 0 8 C 3 8 3 4 0 0 Z" fill="#a9d8f0" style={{ animationDelay: '.55s' }} /></g>
          </g>

          <g className="deco deco-think">
            <g className="orbitring">
              <ellipse cx="130" cy="140" rx="74" ry="92" fill="none" stroke="#c9a24a" strokeWidth="1" strokeDasharray="3 7" opacity=".3" transform="rotate(-12 130 140)" />
              <circle cx="130" cy="48" r="4" fill={ref('goldG')} />
            </g>
            <circle className="thinkdot" cx="182" cy="86" r="3" fill="#12203a" style={{ animationDelay: '0s' }} />
            <circle className="thinkdot" cx="194" cy="74" r="4" fill="#12203a" style={{ animationDelay: '.2s' }} />
            <circle className="thinkdot" cx="208" cy="60" r="5" fill={ref('goldG')} style={{ animationDelay: '.4s' }} />
            <g className="chinarm">
              <path className="thread" d="M100 184 C 104 176 110 169 116 164" />
              <g className="hand"><Pearl glow={ref('fSm')} pearl={ref('pearlG')} /></g>
            </g>
          </g>

          <g className="deco deco-connect">
            <line className="cline" x1="188" y1="128" x2="236" y2="104" />
            <line className="cline" x1="192" y1="146" x2="242" y2="152" style={{ animationDelay: '.3s' }} />
            <line className="cline" x1="186" y1="164" x2="234" y2="196" style={{ animationDelay: '.6s' }} />
            <circle cx="238" cy="102" r="5" fill="#12203a" />
            <circle cx="244" cy="152" r="5.5" fill="none" stroke="#D4AF37" strokeWidth="2" />
            <circle cx="234" cy="198" r="5" fill="#12203a" />
          </g>

          <g className="deco deco-discover">
            <line className="lline" x1="228" y1="152" x2="246" y2="134" />
            <line className="lline" x1="246" y1="134" x2="263" y2="112" style={{ animationDelay: '.2s' }} />
            <line className="lline" x1="246" y1="134" x2="260" y2="168" style={{ animationDelay: '.35s' }} />
            <line className="lline" x1="260" y1="168" x2="242" y2="198" style={{ animationDelay: '.5s' }} />
            <circle className="lnode" cx="246" cy="134" r="6" fill="none" stroke="#c9a24a" strokeWidth="2" style={{ animationDelay: '.1s' }} />
            <circle className="lnode" cx="263" cy="112" r="5" fill="#0D1424" style={{ animationDelay: '.3s' }} />
            <circle className="lnode" cx="260" cy="168" r="6" fill="none" stroke="#c9a24a" strokeWidth="2" style={{ animationDelay: '.5s' }} />
            <circle className="lnode" cx="242" cy="198" r="5" fill="#0D1424" style={{ animationDelay: '.7s' }} />
            <g transform="translate(140,74)">
              <path className="spark" d="M0 -12 L3 -3 L12 0 L3 3 L0 12 L-3 3 L-12 0 L-3 -3 Z" fill={ref('goldG')} />
            </g>
          </g>

          <g className="deco deco-wave" fill="none" stroke="#D4AF37" strokeWidth="2.4" strokeLinecap="round">
            <path className="waveline" d="M230 52 q7 -6 0 -14" style={{ animationDelay: '0s' }} />
            <path className="waveline" d="M238 58 q10 -8 0 -20" style={{ animationDelay: '.25s' }} />
          </g>

          <g className="deco deco-sleep">
            <g transform="translate(150,98)"><path className="zzz" d="M0 0 h6 l-6 7 h6" style={{ animationDelay: '0s' }} /></g>
            <g transform="translate(159,90)"><path className="zzz" d="M0 0 h7 l-7 8 h7" style={{ animationDelay: '1s' }} /></g>
            <g transform="translate(169,82)"><path className="zzz" d="M0 0 h8 l-8 9 h8" style={{ animationDelay: '2s' }} /></g>
          </g>

          <g className="role role-academic">
            <path d="M110 91 Q130 100 150 91 L150 96 Q130 104 110 96 Z" fill="#0b1220" />
            <polygon points="130,86 158,79 130,72 102,79" fill="#152238" />
            <polygon points="130,74 158,79 130,86 102,79" fill="#0d1626" />
            <polygon points="130,72 158,79 130,86 102,79" fill="none" stroke="#D4AF37" strokeWidth="1" opacity=".55" />
            <circle cx="130" cy="79" r="2.3" fill={ref('goldG')} />
            <path d="M130 79 L154 84 L154 100" fill="none" stroke="#D4AF37" strokeWidth="1.5" />
            <path d="M150 100 L158 100 L154 108 Z" fill="#D4AF37" />
            <circle cx="154" cy="100" r="2.2" fill="#E4C368" />
          </g>

          <g className="role role-genealogy">
            <path d="M130 90 C 129 80 131 72 129 62" fill="none" stroke={ref('stemG')} strokeWidth="2.6" strokeLinecap="round" />
            <path d="M129 74 C 118 74 112 66 114 58 C 123 58 129 65 129 74 Z" fill={ref('leafG')} />
            <path d="M114 60 Q122 64 128 72" fill="none" stroke="#256b38" strokeWidth="1" opacity=".6" />
            <path d="M130 70 C 141 70 148 62 146 53 C 137 53 130 60 130 70 Z" fill={ref('leafG')} />
            <path d="M146 55 Q138 60 131 68" fill="none" stroke="#256b38" strokeWidth="1" opacity=".6" />
            <circle cx="129" cy="60" r="3" fill="#63c07a" />
            <circle cx="128" cy="59" r="1" fill="#d9f5df" opacity=".8" />
          </g>

          <g className="role role-study">
            <g fill="rgba(255,255,255,.08)" stroke="#5b3f1c" strokeWidth="1.8">
              <rect x="104" y="131" width="18" height="17" rx="7" />
              <rect x="138" y="131" width="18" height="17" rx="7" />
            </g>
            <path d="M122 138 Q130 135 138 138" fill="none" stroke="#5b3f1c" strokeWidth="1.8" />
            <path d="M104 137 L96 133" fill="none" stroke="#5b3f1c" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M156 137 L164 133" fill="none" stroke="#5b3f1c" strokeWidth="1.8" strokeLinecap="round" />
            <g transform="rotate(-16 108 196)">
              <path d="M84 190 L110 194 L110 214 L84 210 Z" fill="#233a63" />
              <path d="M134 190 L110 194 L110 214 L134 210 Z" fill="#1a2c4d" />
              <path d="M87 192 Q110 189 110 194 L110 212 Q87 207 87 200 Z" fill="#FBF4E2" />
              <path d="M131 192 Q110 189 110 194 L110 212 Q131 207 131 200 Z" fill="#F5ECD6" />
              <path d="M110 194 L110 212" stroke="#c9b98f" strokeWidth="1" />
              <path d="M92 196 L104 197 M92 199 L104 200 M116 197 L128 196 M116 200 L128 199" stroke="#9a8a5f" strokeWidth="1" opacity=".55" />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
