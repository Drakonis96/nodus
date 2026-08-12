// SPDX-License-Identifier: AGPL-3.0-only
const msg=(key)=>chrome.i18n.getMessage(key)||key;
for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=msg(el.dataset.i18n);
const stored=await chrome.storage.local.get({port:4321});
document.getElementById('port').value=String(stored.port);
document.getElementById('port').addEventListener('change',async(event)=>{const port=Math.max(1024,Math.min(65535,Number(event.target.value)||4321));event.target.value=String(port);await chrome.storage.local.set({port});document.getElementById('status').textContent=msg('savedSetting')});
document.getElementById('clear').addEventListener('click',async()=>{await chrome.storage.local.remove(['token']);document.getElementById('status').textContent=msg('pairingForgotten')});
