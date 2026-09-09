import geometry from './nodusMark.json';
const shade = (hex: string, amount: number) => '#' + [1, 3, 5].map(index => {
  const channel = parseInt(hex.slice(index, index + 2), 16);
  return Math.round(channel + ((amount > 0 ? 255 : 0) - channel) * Math.abs(amount)).toString(16).padStart(2, '0');
}).join('');
/** Same canonical N geometry as the application header, loading screen and dock. */
export function marketplaceLogoSvg(accent = '#6366f1'): string {
  const color = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#6366f1';
  const light = shade(color, .55), dark = shade(color, -.4), g = geometry;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-labelledby="title desc">
  <title id="title">Nodus Marketplace</title><desc id="desc">A shopping basket containing the original connected Nodus N.</desc>
  <defs><linearGradient id="basket" x1="24" y1="36" x2="106" y2="118" gradientUnits="userSpaceOnUse"><stop stop-color="${light}"/><stop offset=".45" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></linearGradient><linearGradient id="mark" x1="${g.gradient.x1}" y1="${g.gradient.y1}" x2="${g.gradient.x2}" y2="${g.gradient.y2}" gradientUnits="userSpaceOnUse"><stop stop-color="${light}"/><stop offset=".45" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
  <rect x="4" y="4" width="120" height="120" rx="32" fill="${shade(color, -.85)}"/>
  <path d="m37 45 17-24m37 24L74 21" fill="none" stroke="url(#basket)" stroke-width="7" stroke-linecap="round"/>
  <path d="M22 46h84l-8 52a12 12 0 0 1-12 10H42a12 12 0 0 1-12-10z" fill="${color}" fill-opacity=".14" stroke="url(#basket)" stroke-width="4" stroke-linejoin="round"/>
  <path d="M20 46h88" stroke="${light}" stroke-width="7" stroke-linecap="round"/>
  <g transform="translate(32 45)">
    <path d="M${g.leftX} ${g.bottomY}V${g.topY}L${g.rightX} ${g.bottomY}V${g.topY}" fill="none" stroke="url(#mark)" stroke-width="${g.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${g.leftX}" cy="${g.topY}" r="${g.nodeRadius}" fill="${light}"/><circle cx="${g.leftX}" cy="${g.bottomY}" r="${g.nodeRadius}" fill="${color}"/><circle cx="${g.rightX}" cy="${g.bottomY}" r="${g.nodeRadius}" fill="${shade(color, -.15)}"/><circle cx="${g.rightX}" cy="${g.topY}" r="${g.nodeRadius}" fill="${dark}"/>
  </g>
  <path d="m105 17 2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="${light}"/>
</svg>`;
}
