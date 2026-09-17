// SPDX-License-Identifier: AGPL-3.0-only
const msg=(key)=>chrome.i18n.getMessage(key)||key;
document.documentElement.lang=chrome.i18n.getUILanguage().split('-')[0]||'en';
document.title=msg('privacyTitle');
for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=msg(el.dataset.i18n);
