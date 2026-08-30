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
} as const;
