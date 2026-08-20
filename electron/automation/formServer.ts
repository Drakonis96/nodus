import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { getColumns } from '../db/databasesRepo';
import { authenticateDatabaseForm, getDatabaseFormBySlug, submitDatabaseForm } from '../db/databaseAutomationsRepo';
import { formInputType, type DatabaseFormServerStatus, type FormDefinition } from '@shared/databaseAutomations';

let server: Server | null = null;
let port: number | null = null;
const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const fingerprint = (request: IncomingMessage) => createHash('sha256').update(`${request.socket.remoteAddress ?? ''}|${request.headers['user-agent'] ?? ''}`).digest('hex');

function headers(response: ServerResponse, status = 200, type = 'text/html; charset=utf-8'): void {
  response.writeHead(status, { 'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'" });
}

function shell(title:string,body:string,dark=false):string { return `<!doctype html><html lang="es" class="${dark?'dark':''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark;font:16px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;background:#f5f5f4;color:#1c1917}*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:32px 16px;background:radial-gradient(circle at top,#d1fae5 0,transparent 32rem),#f5f5f4}.dark{color-scheme:dark;background:#09090b;color:#f4f4f5}.dark body{background:radial-gradient(circle at top,#064e3b 0,transparent 32rem),#09090b}.card{width:min(720px,100%);margin:auto;background:#fff;border:1px solid #d6d3d1;border-radius:20px;padding:clamp(22px,5vw,42px);box-shadow:0 24px 70px #0002}.dark .card{background:#111113;border-color:#3f3f46;box-shadow:0 24px 70px #0008}.brand{display:flex;align-items:center;gap:10px;color:#047857;font-weight:750}.dark .brand{color:#6ee7b7}h1{font-size:clamp(1.7rem,6vw,2.5rem);line-height:1.12;margin:24px 0 8px}p{color:#57534e}.dark p{color:#a1a1aa}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:28px}.field{display:grid;gap:7px}.full{grid-column:1/-1}label{font-size:.88rem;font-weight:650}.hint{font-size:.78rem;color:#78716c}.dark .hint{color:#a1a1aa}input,select,textarea{width:100%;min-height:46px;border:1px solid #a8a29e;border-radius:11px;background:#fff;color:inherit;padding:10px 12px;font:inherit}textarea{min-height:110px;resize:vertical}.dark input,.dark select,.dark textarea{background:#18181b;border-color:#52525b}input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible{outline:3px solid #34d399;outline-offset:2px}.check{display:flex;align-items:center;gap:9px;min-height:46px}.check input{width:20px;min-height:20px}button{min-height:48px;border:0;border-radius:12px;background:#047857;color:white;padding:12px 20px;font:inherit;font-weight:750;cursor:pointer}button:hover{background:#065f46}.actions{display:flex;justify-content:flex-end;margin-top:26px}.error{border:1px solid #fda4af;background:#fff1f2;color:#9f1239;border-radius:12px;padding:12px;margin:18px 0}.dark .error{background:#4c0519;color:#fecdd3;border-color:#9f1239}@media(max-width:520px){body{padding:12px}.card{border-radius:16px;padding:22px 18px}.grid{grid-template-columns:1fr}.field{grid-column:1/-1}.actions button{width:100%}}
</style></head><body>${body}</body></html>`; }

function authPage(form:FormDefinition,dark:boolean,error=''):string { return shell(form.title,`<main class="card"><div class="brand"><span aria-hidden="true">◆</span> Nodus</div><h1>${escapeHtml(form.title)}</h1><p>${escapeHtml(form.description)}</p>${error?`<div class="error" role="alert">${escapeHtml(error)}</div>`:''}<form method="get"><div class="field"><label for="token">Token de acceso</label><input id="token" name="token" type="password" required autocomplete="current-password"></div><div class="actions"><button type="submit">Acceder</button></div></form></main>`,dark); }

function fieldHtml(form:FormDefinition):string { const columns=new Map(getColumns(form.databaseId).map((column)=>[column.id,column])); return form.fields.map((field)=>{ const column=columns.get(field.columnId); if(!column)return'';
  const inputType=formInputType(column.type); const attrs=`id="field_${escapeHtml(field.columnId)}" name="field_${escapeHtml(field.columnId)}" ${field.required?'required':''}`;
  let control:string; if(inputType==='textarea') control=`<textarea ${attrs}></textarea>`; else if(inputType==='select') { const multiple=column.type==='multi_select'?' multiple':'';
    control=`<select ${attrs}${multiple}><option value="">Selecciona una opción</option>${column.options.map((option)=>`<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`).join('')}</select>`;
  } else if(inputType==='checkbox') control=`<span class="check"><input ${attrs} type="checkbox" value="1"><span>Sí</span></span>`;
  else control=`<input ${attrs} type="${inputType}"${column.type==='number'?' step="any"':''}>`;
  return `<div class="field ${field.width==='full'?'full':''}"><label for="field_${escapeHtml(field.columnId)}">${escapeHtml(field.label)}${field.required?' *':''}</label>${field.description?`<span class="hint">${escapeHtml(field.description)}</span>`:''}${control}</div>`; }).join(''); }

function formPage(form:FormDefinition,token:string|null,dark:boolean,error=''):string { return shell(form.title,`<main class="card"><div class="brand"><span aria-hidden="true">◆</span> Nodus</div><h1>${escapeHtml(form.title)}</h1><p>${escapeHtml(form.description)}</p>${error?`<div class="error" role="alert">${escapeHtml(error)}</div>`:''}<form method="post">${token?`<input type="hidden" name="_token" value="${escapeHtml(token)}">`:''}<div class="grid">${fieldHtml(form)}</div><div class="actions"><button type="submit">Enviar respuesta</button></div></form></main>`,dark); }
function confirmationPage(form:FormDefinition,dark:boolean):string { return shell(form.confirmationTitle,`<main class="card"><div class="brand"><span aria-hidden="true">✓</span> Nodus</div><h1>${escapeHtml(form.confirmationTitle)}</h1><p>${escapeHtml(form.confirmationBody)}</p></main>`,dark); }

async function readBody(request:IncomingMessage):Promise<URLSearchParams> { const chunks:Buffer[]=[]; let size=0; for await(const chunk of request){ const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk); size+=value.length; if(size>1_000_000)throw new Error('La respuesta supera 1 MB.'); chunks.push(value); }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8')); }

async function handle(request:IncomingMessage,response:ServerResponse):Promise<void> { const origin=`http://127.0.0.1:${port}`; const url=new URL(request.url??'/',origin); const match=/^\/forms\/([a-z0-9-]+)$/.exec(url.pathname);
  if(!match){headers(response,404);response.end(shell('No encontrado','<main class="card"><h1>No encontrado</h1></main>'));return;} const form=getDatabaseFormBySlug(match[1]); const dark=url.searchParams.get('theme')==='dark';
  if(!form||!form.enabled){headers(response,404);response.end(shell('Formulario no disponible','<main class="card"><h1>Formulario no disponible</h1></main>',dark));return;}
  if(request.method==='GET'){ const token=url.searchParams.get('token'); const authorized=authenticateDatabaseForm(form.id,token); headers(response,authorized?200:401); response.end(authorized?formPage(form,token,dark):authPage(form,dark,token?'El token no es válido.':'')); return; }
  if(request.method!=='POST'){headers(response,405);response.end();return;} let params:URLSearchParams; try{params=await readBody(request);}catch(cause){headers(response,413);response.end(formPage(form,null,dark,cause instanceof Error?cause.message:String(cause)));return;}
  const token=params.get('_token')??url.searchParams.get('token'); if(!authenticateDatabaseForm(form.id,token)){headers(response,401);response.end(authPage(form,dark,'El token no es válido.'));return;}
  const columns=new Map(getColumns(form.databaseId).map((column)=>[column.id,column])); const values:Record<string,string|null>={}; for(const field of form.fields){ const column=columns.get(field.columnId); if(!column)continue; const raw=params.getAll(`field_${field.columnId}`);
    values[field.columnId]=column.type==='multi_select'?JSON.stringify(raw.filter(Boolean)):column.type==='checkbox'?(raw.length?'1':'0'):(raw[0]?.trim()||null); }
  try{await submitDatabaseForm(form.id,values,'local-http',fingerprint(request));headers(response,200);response.end(confirmationPage(form,dark));}
  catch(cause){headers(response,/límite temporal/i.test(String(cause))?429:400);response.end(formPage(form,token,dark,cause instanceof Error?cause.message:String(cause)));}
}

export async function startDatabaseFormServer(requestedPort=0):Promise<DatabaseFormServerStatus> { if(server)return databaseFormServerStatus(); server=createServer((request,response)=>{void handle(request,response).catch((cause)=>{ if(!response.headersSent)headers(response,500);response.end(shell('Error',`<main class="card"><div class="error">${escapeHtml(cause instanceof Error?cause.message:String(cause))}</div></main>`));});});
  await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(requestedPort,'127.0.0.1',()=>{server!.off('error',reject);resolve();});}); const address=server.address(); port=typeof address==='object'&&address?address.port:null; return databaseFormServerStatus(); }
export async function stopDatabaseFormServer():Promise<void> { const current=server;server=null;port=null;if(!current)return;await new Promise<void>((resolve)=>current.close(()=>resolve())); }
export function databaseFormServerStatus():DatabaseFormServerStatus { return {running:Boolean(server&&port),port,origin:port?`http://127.0.0.1:${port}`:null}; }
export function databaseFormPublicUrl(slug:string):string|null { return port?`http://127.0.0.1:${port}/forms/${encodeURIComponent(slug)}`:null; }
