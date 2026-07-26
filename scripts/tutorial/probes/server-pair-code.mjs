// Obtain a real pairing code from a local Nodus Server.
//
// The tutorial pairs for real rather than miming it, so the connection that shows
// up in "connected vaults" is genuine. The admin panel is plain HTML with CSRF
// tokens, so this logs in, creates a space if needed, and asks for a code.
//
//   node scripts/tutorial/server-pair-code.mjs [baseUrl]

const BASE = process.argv[2] ?? 'http://localhost:7443';
const EMAIL = process.env.NODUS_ADMIN_EMAIL ?? 'demo@nodus.local';
const PASSWORD = process.env.NODUS_ADMIN_PASSWORD ?? 'nodus-demo-1234';

let cookie = '';
const remember = (res) => {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) cookie = c.split(';')[0];
};
const get = async (p) => {
  const res = await fetch(`${BASE}${p}`, { headers: { cookie }, redirect: 'manual' });
  remember(res);
  return res.text();
};
const post = async (p, fields) => {
  const res = await fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });
  remember(res);
  const location = res.headers.get('location');
  return location ? get(location) : res.text();
};
const csrfOf = (html) => html.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';

await get('/login');
const login = await get('/login');
let html = await post('/login', { csrf: csrfOf(login), email: EMAIL, password: PASSWORD });
if (!/csrf/.test(html)) html = await get('/admin');

let spaceId = html.match(/name="spaceId" value="([^"]+)"/)?.[1];
if (!spaceId) {
  html = await post('/admin/spaces', { csrf: csrfOf(html), name: 'Overland Trail', description: 'Shared research space' });
  spaceId = html.match(/name="spaceId" value="([^"]+)"/)?.[1];
}
if (!spaceId) throw new Error('could not create or find a space — is the server running and the admin password right?');

html = await post('/admin/pairing', { csrf: csrfOf(html), spaceId });
// The plaintext code is shown once, in the notice line.
// Rendered once, as <h2><code>XXXX-XXXX</code></h2>, and never stored in clear.
const code = html.match(/<h2><code>([A-Z0-9-]+)<\/code><\/h2>/)?.[1];
if (!code) {
  console.error('--- response ---');
  console.error(html.replace(/\s+/g, ' ').slice(0, 900));
  throw new Error('paired, but no code found in the response');
}
console.log(code);
