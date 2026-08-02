import { escapeHtml } from './http.mjs';

const LANGUAGE_OPTIONS = [
  ['en', 'English'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['pt', 'Português (Portugal)'],
  ['pt-BR', 'Português (Brasil)'],
  ['it', 'Italiano'],
  ['tr', 'Türkçe'],
];

export function nodusMark(id, className = 'brand-mark') {
  const safeId = escapeHtml(id);
  return `<svg class="${escapeHtml(className)}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="${safeId}" x1="14" y1="10" x2="50" y2="54" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#ddd6fe"/>
        <stop offset=".45" stop-color="#a78bfa"/>
        <stop offset="1" stop-color="#7c3aed"/>
      </linearGradient>
      <filter id="${safeId}-shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="3" stdDeviation="2.4" flood-color="#05030d" flood-opacity=".42"/>
      </filter>
    </defs>
    <g filter="url(#${safeId}-shadow)">
      <path d="M18 48V16L46 48V16" fill="none" stroke="url(#${safeId})" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="18" cy="16" r="6.5" fill="#ddd6fe"/>
      <circle cx="18" cy="48" r="6.5" fill="#a78bfa"/>
      <circle cx="46" cy="48" r="6.5" fill="#8b5cf6"/>
      <circle cx="46" cy="16" r="6.5" fill="#7c3aed"/>
    </g>
  </svg>`;
}

export function languagePicker(currentLanguage, labels) {
  const options = LANGUAGE_OPTIONS.map(([value, label]) => (
    `<option value="${value}"${value === currentLanguage ? ' selected' : ''}>${label}</option>`
  )).join('');
  return `<form class="language-picker" method="post" action="/language" data-testid="language-picker">
    <label for="language-select">${escapeHtml(labels.language)}</label>
    <select id="language-select" name="language" aria-label="${escapeHtml(labels.language)}">${options}</select>
    <button class="language-apply" type="submit">${escapeHtml(labels.apply)}</button>
  </form>`;
}

export function helpTip(text, label) {
  return `<details class="help-tip">
    <summary aria-label="${escapeHtml(label)}">?</summary>
    <span class="help-popover" role="tooltip">${escapeHtml(text)}</span>
  </details>`;
}

export const WEB_STYLES = `
  :root{
    color-scheme:dark;
    font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    --bg:#08080d;
    --surface:#121219;
    --surface-raised:#181821;
    --surface-soft:#0d0d14;
    --border:#2a2a36;
    --border-strong:#3c3c4d;
    --text:#f5f5f7;
    --muted:#a1a1b0;
    --subtle:#6f7080;
    --violet:#8b5cf6;
    --violet-strong:#7c3aed;
    --violet-soft:rgba(139,92,246,.13);
    --indigo:#6366f1;
    --teal:#2dd4bf;
    --success:#6ee7b7;
    --warning:#fbbf24;
    --danger:#fca5a5;
    background:var(--bg);
  }
  *{box-sizing:border-box}
  html{min-height:100%;background:var(--bg)}
  body{min-height:100vh;margin:0;color:var(--text);background:
    radial-gradient(circle at 8% -8%,rgba(124,58,237,.17),transparent 32rem),
    radial-gradient(circle at 95% 8%,rgba(45,212,191,.07),transparent 26rem),
    linear-gradient(180deg,#0b0b12 0%,var(--bg) 42%);
    -webkit-font-smoothing:antialiased;
  }
  body::before{position:fixed;inset:0;z-index:-1;content:"";pointer-events:none;opacity:.24;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(to bottom,black,transparent 72%)}
  a{color:#c4b5fd;text-decoration:none}
  a:hover{color:#ede9fe}
  button,input,select{font:inherit}
  button,a,select,input,summary{outline:none}
  :where(button,a,select,input,summary):focus-visible{outline:3px solid var(--teal);outline-offset:3px}
  .site-header{display:flex;align-items:center;justify-content:space-between;gap:20px;width:min(1180px,calc(100% - 40px));margin:0 auto;padding:22px 0}
  .site-brand{display:inline-flex;align-items:center;gap:11px;color:var(--text);font-weight:720;letter-spacing:-.015em}
  .site-brand:hover{color:#fff}
  .brand-mark{width:36px;height:36px;flex:0 0 auto}
  .site-brand small{display:block;margin-top:2px;color:var(--subtle);font-size:10px;font-weight:650;letter-spacing:.16em;text-transform:uppercase}
  .language-picker{display:flex;align-items:center;gap:8px;margin:0}
  .language-picker label{margin:0;color:var(--subtle);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .language-picker select{width:auto;min-width:148px;height:36px;padding:0 32px 0 11px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:#e7e7ec;font-size:12px}
  .language-apply{height:36px;margin:0;padding:0 12px;border:1px solid var(--border);border-radius:9px;background:var(--surface-raised);color:#dddde5;font-size:12px;font-weight:650;cursor:pointer}
  .language-apply:hover{border-color:#5b4b86;background:#211b30;color:#fff}
  .app-main{width:min(1180px,calc(100% - 40px));margin:0 auto;padding:30px 0 70px}
  .auth-main{display:grid;grid-template-columns:minmax(300px,.88fr) minmax(430px,1.12fr);width:min(1040px,calc(100% - 40px));min-height:calc(100vh - 116px);margin:0 auto;padding:32px 0 72px;align-items:center}
  .auth-story{position:relative;z-index:0;padding:52px 58px 52px 12px}
  .auth-story::before{position:absolute;inset:3% 8% 3% -24%;z-index:-1;content:"";border-radius:50%;background:radial-gradient(circle,rgba(124,58,237,.18),transparent 66%);filter:blur(8px)}
  .auth-mark{width:104px;height:104px;margin-left:-8px}
  .brand-kicker,.eyebrow{margin:20px 0 0;color:#a78bfa;font-size:11px;font-weight:760;letter-spacing:.18em;text-transform:uppercase}
  .auth-story h2{max-width:470px;margin:12px 0 0;color:#fff;font-size:clamp(2.1rem,4vw,3.65rem);font-weight:760;line-height:1.03;letter-spacing:-.045em}
  .auth-story>p:not(.brand-kicker){max-width:470px;margin:20px 0 0;color:var(--muted);font-size:15px;line-height:1.75}
  .trust-list{display:flex;flex-wrap:wrap;gap:9px;margin-top:28px}
  .trust-pill{display:inline-flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid rgba(139,92,246,.22);border-radius:999px;background:rgba(17,14,27,.72);color:#c9c7d4;font-size:11px}
  .trust-pill::before{width:6px;height:6px;border-radius:50%;background:var(--teal);box-shadow:0 0 0 3px rgba(45,212,191,.09);content:""}
  .auth-card{position:relative;padding:38px;border:1px solid rgba(139,92,246,.28);border-radius:24px;background:linear-gradient(145deg,rgba(25,25,35,.97),rgba(14,14,21,.98));box-shadow:0 30px 90px rgba(0,0,0,.42),inset 0 1px rgba(255,255,255,.035)}
  .auth-card::before{position:absolute;top:0;right:32px;left:32px;height:1px;content:"";background:linear-gradient(90deg,transparent,rgba(196,181,253,.55),transparent)}
  h1,h2,h3{color:var(--text)}
  h1{margin:0;font-size:clamp(1.75rem,3vw,2.35rem);font-weight:740;line-height:1.14;letter-spacing:-.035em}
  h2{margin:0;font-size:1.04rem;font-weight:690;letter-spacing:-.015em}
  h3{margin:0;font-size:.88rem;font-weight:670}
  p{line-height:1.6}
  .lead{margin:10px 0 0;color:var(--muted);font-size:14px}
  .card{padding:22px;border:1px solid var(--border);border-radius:16px;background:rgba(18,18,25,.88);box-shadow:0 10px 32px rgba(0,0,0,.12)}
  .auth-card .card{margin-top:25px;padding:0;border:0;background:transparent;box-shadow:none}
  .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
  .stack{display:grid;gap:16px}
  .field{margin-top:17px}
  .field:first-of-type{margin-top:0}
  .label-line,.section-title{display:flex;align-items:center;gap:8px}
  label{display:block;margin:0 0 7px;color:#d8d8e1;font-size:12px;font-weight:650}
  .label-line label{margin:0}
  input,select{box-sizing:border-box;width:100%;height:44px;padding:0 12px;border:1px solid var(--border-strong);border-radius:10px;background:#0b0b11;color:#fff;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}
  input::placeholder{color:#5f6070}
  input:hover,select:hover{border-color:#535366}
  input:focus,select:focus{border-color:var(--violet);background:#0f0d16;box-shadow:0 0 0 3px rgba(139,92,246,.12)}
  button{min-height:40px;margin-top:16px;padding:0 15px;border:1px solid transparent;border-radius:10px;background:linear-gradient(135deg,var(--indigo),var(--violet-strong));color:#fff;font-weight:680;cursor:pointer;box-shadow:0 8px 22px rgba(79,70,229,.18);transition:transform .16s ease,border-color .16s ease,background .16s ease}
  button:hover{transform:translateY(-1px);background:linear-gradient(135deg,#7274f5,#8b5cf6)}
  button:active{transform:translateY(0)}
  button.secondary,.button-secondary{border-color:var(--border);background:#20202a;color:#e1e1e8;box-shadow:none}
  button.secondary:hover,.button-secondary:hover{border-color:#505064;background:#292934}
  button.danger{border-color:rgba(239,68,68,.28);background:rgba(127,29,29,.24);color:#fecaca;box-shadow:none}
  .button-link{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 13px;border:1px solid var(--border);border-radius:10px;background:#17171f;color:#e1e1e8;font-size:12px;font-weight:650}
  .button-link:hover{border-color:#515164;background:#20202a;color:#fff}
  .muted{color:var(--muted);font-size:.86rem}
  .ok,.warn{margin:18px 0 0;padding:11px 13px;border:1px solid;border-radius:10px;font-size:12px;line-height:1.5}
  .ok{border-color:rgba(16,185,129,.28);background:rgba(6,78,59,.18);color:var(--success)}
  .warn{border-color:rgba(245,158,11,.3);background:rgba(120,53,15,.18);color:#fde68a}
  code{padding:3px 6px;border:1px solid #30303c;border-radius:6px;background:#0b0b11;color:#c4b5fd;font-family:"SFMono-Regular",Consolas,monospace;font-size:.78em;overflow-wrap:anywhere}
  .help-tip{position:relative;display:inline-flex}
  .help-tip summary{display:grid;width:20px;height:20px;place-items:center;border:1px solid #47405e;border-radius:50%;background:var(--violet-soft);color:#c4b5fd;font-size:11px;font-weight:800;cursor:pointer;list-style:none}
  .help-tip summary::-webkit-details-marker{display:none}
  .help-tip[open] summary{border-color:#8b5cf6;background:rgba(139,92,246,.25);color:#fff}
  .help-popover{position:absolute;z-index:20;top:28px;left:50%;width:min(290px,70vw);padding:11px 12px;border:1px solid #47405e;border-radius:10px;background:#1a1824;color:#d8d6e2;font-size:11px;font-weight:450;line-height:1.55;box-shadow:0 16px 40px rgba(0,0,0,.46);transform:translateX(-50%)}
  .help-popover::before{position:absolute;top:-5px;left:50%;width:8px;height:8px;border-top:1px solid #47405e;border-left:1px solid #47405e;background:#1a1824;content:"";transform:translateX(-50%) rotate(45deg)}
  .page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:22px}
  .page-heading .eyebrow{margin:0 0 8px}
  .heading-actions{display:flex;align-items:center;gap:9px}
  .heading-actions form{margin:0}
  .heading-actions button{margin:0}
  .server-overview{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;padding:20px 22px;border:1px solid rgba(139,92,246,.25);border-radius:16px;background:linear-gradient(115deg,rgba(99,102,241,.12),rgba(18,18,25,.88) 55%)}
  .status-line{display:flex;align-items:center;gap:9px;margin-bottom:7px;color:#d9d8e3;font-size:12px;font-weight:650}
  .status-dot{width:8px;height:8px;border-radius:50%;background:#34d399;box-shadow:0 0 0 4px rgba(52,211,153,.1)}
  .endpoint{display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--muted);font-size:12px}
  .endpoint code{font-size:11px}
  .metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .metric{min-width:110px;padding:13px;border:1px solid var(--border);border-radius:12px;background:rgba(9,9,14,.56)}
  .metric strong{display:block;color:#fff;font-size:1.35rem;line-height:1}
  .metric span{display:block;margin-top:6px;color:var(--subtle);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .section{margin-top:18px}
  .section-header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}
  .section-header p{margin:5px 0 0;color:var(--muted);font-size:12px}
  .table-shell{overflow-x:auto;border:1px solid var(--border);border-radius:14px;background:rgba(14,14,20,.76)}
  table{width:100%;border-collapse:collapse}
  th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #252530;vertical-align:top;font-size:12px}
  th{color:#767787;font-size:10px;font-weight:760;letter-spacing:.09em;text-transform:uppercase}
  td{color:#d5d5de}
  tr:last-child td{border-bottom:0}
  td form{display:inline-block;margin:0 6px 5px 0}
  td form button{min-height:32px;margin:0;padding:0 10px;font-size:11px}
  td p{margin:8px 0 0}
  td select{height:34px;margin-bottom:7px;font-size:11px}
  .empty{padding:30px 18px!important;text-align:center;color:var(--subtle)}
  .access-list{display:grid;gap:6px}
  .access-chip{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border:1px solid #2d2d39;border-radius:8px;background:#101016}
  .access-chip form{margin:0}
  .access-chip button{display:grid;min-width:26px;min-height:26px;padding:0 8px;place-items:center}
  .access-chip select{min-height:26px;padding:2px 6px;font-size:.85rem}
  .role-tag{padding:2px 8px;border:1px solid #3b3b4a;border-radius:999px;font-size:.8rem;color:#a9a9bd}
  .grant-list{display:grid;gap:8px;margin-top:6px}
  .grant-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid #2d2d39;border-radius:8px;background:#101016}
  .grant-name{display:flex;align-items:center;gap:8px;margin:0;font-weight:500}
  .grant-row select{min-height:30px;padding:2px 8px;font-size:.85rem}
  .role-legend{margin-top:4px;font-size:.82rem;line-height:1.6}
  .code-panel{text-align:center}
  .code-panel h2{margin:22px 0}
  .code-panel h2 code{display:inline-block;padding:12px 18px;border-color:rgba(139,92,246,.4);background:rgba(139,92,246,.1);color:#ddd6fe;font-size:1.6rem;letter-spacing:.12em}
  .inline-actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center}
  .inline-actions>*{margin:0}
  .danger-card{border-color:rgba(239,68,68,.3);background:rgba(69,10,10,.16)}
  .site-footer{width:min(1180px,calc(100% - 40px));margin:0 auto;padding:0 0 28px;color:#555665;font-size:10px;text-align:center}
  .sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
  @media(max-width:860px){
    .auth-main{grid-template-columns:1fr;max-width:600px;padding-top:6px}
    .auth-story{padding:26px 10px 34px;text-align:center}
    .auth-mark{width:78px;height:78px}
    .auth-story h2,.auth-story>p:not(.brand-kicker){margin-right:auto;margin-left:auto}
    .trust-list{justify-content:center}
    .server-overview{grid-template-columns:1fr}
    .metric-grid{grid-template-columns:repeat(3,1fr)}
  }
  @media(max-width:620px){
    .site-header{align-items:flex-start;width:min(100% - 28px,1180px);padding:15px 0}
    .site-brand small,.language-picker label{display:none}
    .language-picker select{min-width:122px;max-width:43vw}
    .language-apply{padding:0 9px}
    .app-main,.auth-main{width:min(100% - 28px,1180px)}
    .auth-card{padding:26px 20px;border-radius:19px}
    .grid,.metric-grid{grid-template-columns:1fr}
    .page-heading{display:grid}
    .heading-actions{flex-wrap:wrap}
    .server-overview{padding:17px}
    .help-popover{right:-12px;left:auto;transform:none}
    .help-popover::before{right:17px;left:auto;transform:rotate(45deg)}
    th,td{padding:11px}
  }
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important}}
`;
