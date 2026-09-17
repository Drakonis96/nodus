# Nodus Connector in its thirteen languages

The Chrome popup as the connector extension actually renders it, one capture per
shipped language, taken from the connector end-to-end run in real Chrome.

Reproduce with `node scripts/e2e-browser-connector.mjs`. The check stubs each
locale's catalog, opens the popup against a routed Nodus API, and reads every
localized node back from the DOM, so a message that is missing, stale or still in
English fails the run rather than reaching a user. It also compares the document
type in the reviewed card against the shared label table, and captures the
settings and privacy pages.

`popup-en.png`, `popup-es.png`, `popup-fr.png`, `popup-de.png`, `popup-pt_PT.png`,
`popup-pt_BR.png`, `popup-it.png` and `popup-tr.png` are the nine interface
languages. `popup-zh_CN.png` and the four below it cover the rest:

| Capture | Language | Notes |
| --- | --- | --- |
| `popup-zh_CN.png` | Simplified Chinese | |
| `popup-ja.png` | Japanese | |
| `popup-ko.png` | Korean | |
| `popup-ru.png` | Russian | longest type label of the four |
| `popup-zh_TW.png` | Traditional Chinese | Taiwan conventions: 設定, 儲存, 檔案, 中繼資料 |

The document type shown is `journal-article`, whose label comes from
`browser-extension/lib/presentation.js`. The German capture carries the longest
label in the product (`Wissenschaftlicher Zeitschriftenartikel`) and still fits the
review card, which is why it is worth keeping in this set.
