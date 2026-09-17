/** Copy for the Chrome connector settings and the desktop pairing modal. */
const ES_KEYS = [
  'Nodus Research Connector',
  'Activar Nodus Research Connector',
  'Conectar Nodus Research Connector',
  '¿Quieres permitir que esta extensión envíe páginas a Nodus?',
  'Origen',
  'Extensión oficial de Nodus Research desde Chrome Web Store.',
  'Extensión de desarrollo (descomprimida) u otra instalación local.',
] as const;

function table(values: readonly string[]): Record<string, string> {
  if (values.length !== ES_KEYS.length) {
    throw new Error(`Browser Connector i18n: expected ${ES_KEYS.length} values, received ${values.length}`);
  }
  return Object.fromEntries(ES_KEYS.map((key, index) => [key, values[index]]));
}

export const BROWSER_CONNECTOR_TRANSLATIONS = {
  en: table([
    'Nodus Research Connector',
    'Enable Nodus Research Connector',
    'Connect Nodus Research Connector',
    'Do you want to allow this extension to send pages to Nodus?',
    'Origin',
    'Official Nodus Research extension from the Chrome Web Store.',
    'Unpacked development extension or another local installation.',
  ]),
  fr: table([
    'Nodus Research Connector',
    'Activer Nodus Research Connector',
    'Connecter Nodus Research Connector',
    'Voulez-vous autoriser cette extension à envoyer des pages à Nodus ?',
    'Origine',
    'Extension officielle de Nodus Research provenant du Chrome Web Store.',
    'Extension de développement (non empaquetée) ou autre installation locale.',
  ]),
  de: table([
    'Nodus Research Connector',
    'Nodus Research Connector aktivieren',
    'Nodus Research Connector verbinden',
    'Möchtest du dieser Erweiterung erlauben, Seiten an Nodus zu senden?',
    'Ursprung',
    'Offizielle Nodus-Research-Erweiterung aus dem Chrome Web Store.',
    'Entwicklererweiterung (entpackt) oder eine andere lokale Installation.',
  ]),
  pt: table([
    'Nodus Research Connector',
    'Ativar o Nodus Research Connector',
    'Ligar o Nodus Research Connector',
    'Pretende permitir que esta extensão envie páginas para o Nodus?',
    'Origem',
    'Extensão oficial do Nodus Research proveniente da Chrome Web Store.',
    'Extensão de desenvolvimento (descompactada) ou outra instalação local.',
  ]),
  'pt-BR': table([
    'Nodus Research Connector',
    'Ativar o Nodus Research Connector',
    'Conectar o Nodus Research Connector',
    'Quer permitir que esta extensão envie páginas para o Nodus?',
    'Origem',
    'Extensão oficial do Nodus Research proveniente da Chrome Web Store.',
    'Extensão de desenvolvimento (descompactada) ou outra instalação local.',
  ]),
  it: table([
    'Nodus Research Connector',
    'Attiva Nodus Research Connector',
    'Connetti Nodus Research Connector',
    'Vuoi consentire a questa estensione di inviare pagine a Nodus?',
    'Origine',
    'Estensione ufficiale di Nodus Research dal Chrome Web Store.',
    'Estensione di sviluppo (non pacchettizzata) o un\'altra installazione locale.',
  ]),
  tr: table([
    'Nodus Research Connector',
    'Nodus Research Connector’ı etkinleştir',
    'Nodus Research Connector’ı bağla',
    'Bu uzantının Nodus’a sayfa göndermesine izin vermek istiyor musunuz?',
    'Kaynak',
    'Chrome Web Mağazası’ndaki resmî Nodus Research uzantısı.',
    'Paketlenmemiş geliştirme uzantısı veya başka bir yerel kurulum.',
  ]),
  'zh-CN': table([
    'Nodus Research Connector',
    '启用Nodus Research Connector',
    '连接Nodus Research Connector',
    '是否允许此扩展程序向Nodus发送页面？',
    '来源',
    '来自Chrome Web Store的Nodus Research官方扩展程序。',
    '开发扩展程序（未打包）或其他本地安装。',
  ]),
  'zh-TW': table([
    'Nodus Research Connector',
    '啟用Nodus Research Connector',
    '連線Nodus Research Connector',
    '是否允許此擴充套件程式向Nodus傳送頁面？',
    '來源',
    '來自Chrome Web Store的Nodus Research官方擴充套件程式。',
    '開發擴充套件程式（未打包）或其他本地安裝。',
  ]),
  ko: table([
    "노두스 연구 커넥터",
    "Nodus Research 커넥터 활성화",
    "Nodus Research 커넥터 연결",
    "이 확장 프로그램이 Nodus에 페이지를 보낼 수 있도록 허용하시겠습니까?",
    "기원",
    "Chrome 웹 스토어의 공식 Nodus Research 확장 프로그램입니다.",
    "압축을 푼 개발 확장 또는 다른 로컬 설치.",
  ]),
  ja: table([
    "Nodusリサーチコネクター",
    "Nodus Research コネクタを有効にする",
    "Nodus Research コネクターに接続する",
    "この拡張機能が Nodus にページを送信することを許可しますか?",
    "起源",
    "Chrome ウェブストアの公式 Nodus Research 拡張機能。",
    "解凍された開発拡張機能または別のローカルインストール。",
  ]),
} as const;
