import type { AppLanguage } from '@shared/types';

// Localized, in-app content for the About "legal" cards (privacy, GDPR, licenses).
// These are self-contained summaries shown inside a modal — no external file is
// opened — with a link to the authoritative full document on GitHub. The content
// is authored per language (like WhatsNewModal's release notes) so it never falls
// back to Spanish in a non-Spanish UI. Each record must cover every AppLanguage.

export type LegalDocId = 'privacy' | 'gdpr' | 'licenses';

export interface LegalDocSection {
  heading: string;
  bullets: string[];
}

export interface LegalDocContent {
  title: string;
  intro: string;
  sections: LegalDocSection[];
  canonicalLabel: string;
}

export interface LegalDoc {
  id: LegalDocId;
  icon: string;
  /** Tailwind classes for the header icon badge. */
  badgeClass: string;
  canonicalUrl: string;
  content: Record<AppLanguage, LegalDocContent>;
}

const NODUS_REPOSITORY_URL = 'https://github.com/Drakonis96/nodus';

const PRIVACY: Record<AppLanguage, LegalDocContent> = {
  es: {
    title: 'Privacidad y control de datos',
    intro:
      'Nodus funciona principalmente en el dispositivo: no requiere una cuenta, no incluye publicidad, telemetría ni analítica remota y no opera un backend propio que reciba el contenido de tus vaults.',
    sections: [
      {
        heading: 'Qué permanece en tu equipo',
        bullets: [
          'Bases de datos, archivos, grabaciones, transcripciones, notas, expedientes y resultados se guardan en tu dispositivo.',
          'Seleccionar un archivo o iniciar una grabación no lo publica ni lo sube a Nodus.',
        ],
      },
      {
        heading: 'Cuándo salen datos del dispositivo',
        bullets: [
          'Solo las funciones opcionales que actives de forma expresa contactan con terceros: un proveedor de IA en la nube que elijas, Zotero, Unpaywall, GitHub (comprobar actualizaciones) o Hugging Face (descargar modelos).',
          'Si conectas ChatGPT mediante OpenAI Secure MCP Tunnel, OpenAI recibe las solicitudes y resultados de herramientas; el servidor de Nodus continúa limitado a este equipo.',
          'Si conectas el Nodus Server opcional y autohospedado, se publica por HTTPS una copia filtrada del vault; no incluye PDF, credenciales, rutas, embeddings, listas de alumnos ni calificaciones.',
          'Cada servicio externo queda identificado antes de usarse.',
        ],
      },
      {
        heading: 'Alumnado y datos docentes',
        bullets: [
          'La IA no recibe listados, notas ni respuestas del alumnado y no puede calificar, perfilar ni evaluar estudiantes.',
        ],
      },
    ],
    canonicalLabel: 'Leer la política de privacidad completa en GitHub',
  },
  en: {
    title: 'Privacy and data control',
    intro:
      'Nodus works primarily on the device: it requires no account, includes no advertising, telemetry or remote analytics, and operates no backend of its own that receives your vault content.',
    sections: [
      {
        heading: 'What stays on your device',
        bullets: [
          'Databases, files, recordings, transcripts, notes, dossiers and results are stored on your device.',
          'Selecting a file or starting a recording never publishes or uploads it to Nodus.',
        ],
      },
      {
        heading: 'When data leaves the device',
        bullets: [
          'Only optional features you explicitly enable contact third parties: a cloud AI provider you choose, Zotero, Unpaywall, GitHub (update checks) or Hugging Face (model downloads).',
          'If you connect ChatGPT through OpenAI Secure MCP Tunnel, OpenAI receives tool requests and results; the Nodus server remains restricted to this device.',
          'If you connect the optional self-hosted Nodus Server, a filtered vault copy is published over HTTPS; it excludes PDFs, credentials, paths, embeddings, student rosters and grades.',
          'Each external service is identified before it is used.',
        ],
      },
      {
        heading: 'Students and teaching data',
        bullets: [
          'The AI never receives student rosters, notes or answers, and cannot grade, profile or evaluate students.',
        ],
      },
    ],
    canonicalLabel: 'Read the full privacy policy on GitHub',
  },
  fr: {
    title: 'Confidentialité et contrôle des données',
    intro:
      "Nodus fonctionne principalement sur l'appareil : aucun compte requis, ni publicité, ni télémétrie ou analyse à distance, et aucun serveur propre ne reçoit le contenu de vos coffres.",
    sections: [
      {
        heading: "Ce qui reste sur votre appareil",
        bullets: [
          'Bases de données, fichiers, enregistrements, transcriptions, notes, dossiers et résultats sont stockés sur votre appareil.',
          "Sélectionner un fichier ou lancer un enregistrement ne le publie ni ne l'envoie à Nodus.",
        ],
      },
      {
        heading: "Quand les données quittent l'appareil",
        bullets: [
          "Seules les fonctions optionnelles que vous activez expressément contactent des tiers : un fournisseur d'IA cloud de votre choix, Zotero, Unpaywall, GitHub (vérification des mises à jour) ou Hugging Face (téléchargement de modèles).",
          'Si vous connectez ChatGPT via OpenAI Secure MCP Tunnel, OpenAI reçoit les requêtes et résultats des outils ; le serveur Nodus reste limité à cet appareil.',
          "Si vous connectez le Nodus Server optionnel et auto-hébergé, une copie filtrée du coffre est publiée via HTTPS, sans PDF, identifiants, chemins, embeddings, listes d'élèves ni notes.",
          'Chaque service externe est identifié avant utilisation.',
        ],
      },
      {
        heading: 'Élèves et données pédagogiques',
        bullets: [
          "L'IA ne reçoit jamais de listes, de notes ni de réponses des élèves et ne peut ni noter, ni profiler, ni évaluer les élèves.",
        ],
      },
    ],
    canonicalLabel: 'Lire la politique de confidentialité complète sur GitHub',
  },
  de: {
    title: 'Datenschutz und Datenkontrolle',
    intro:
      'Nodus arbeitet hauptsächlich auf dem Gerät: kein Konto erforderlich, keine Werbung, keine Telemetrie oder Ferndatenanalyse und kein eigenes Backend, das die Inhalte deiner Tresore empfängt.',
    sections: [
      {
        heading: 'Was auf deinem Gerät bleibt',
        bullets: [
          'Datenbanken, Dateien, Aufnahmen, Transkripte, Notizen, Dossiers und Ergebnisse werden auf deinem Gerät gespeichert.',
          'Das Auswählen einer Datei oder das Starten einer Aufnahme veröffentlicht sie nicht und lädt sie nicht zu Nodus hoch.',
        ],
      },
      {
        heading: 'Wann Daten das Gerät verlassen',
        bullets: [
          'Nur optionale Funktionen, die du ausdrücklich aktivierst, kontaktieren Dritte: einen von dir gewählten Cloud-KI-Anbieter, Zotero, Unpaywall, GitHub (Update-Prüfung) oder Hugging Face (Modell-Downloads).',
          'Wenn du ChatGPT über OpenAI Secure MCP Tunnel verbindest, erhält OpenAI Werkzeuganfragen und Ergebnisse; der Nodus-Server bleibt auf dieses Gerät beschränkt.',
          'Wenn du den optionalen selbst gehosteten Nodus Server verbindest, wird eine gefilterte Tresorkopie über HTTPS veröffentlicht – ohne PDFs, Zugangsdaten, Pfade, Embeddings, Schülerlisten oder Noten.',
          'Jeder externe Dienst wird vor der Nutzung benannt.',
        ],
      },
      {
        heading: 'Lernende und Unterrichtsdaten',
        bullets: [
          'Die KI erhält niemals Listen, Noten oder Antworten der Lernenden und kann Schülerinnen und Schüler weder benoten noch profilieren oder bewerten.',
        ],
      },
    ],
    canonicalLabel: 'Die vollständige Datenschutzerklärung auf GitHub lesen',
  },
  pt: {
    title: 'Privacidade e controlo de dados',
    intro:
      'O Nodus funciona principalmente no dispositivo: não exige conta, não inclui publicidade, telemetria ou análise remota e não opera um backend próprio que receba o conteúdo dos teus cofres.',
    sections: [
      {
        heading: 'O que permanece no teu dispositivo',
        bullets: [
          'Bases de dados, ficheiros, gravações, transcrições, notas, processos e resultados são guardados no teu dispositivo.',
          'Selecionar um ficheiro ou iniciar uma gravação não o publica nem o envia para o Nodus.',
        ],
      },
      {
        heading: 'Quando os dados saem do dispositivo',
        bullets: [
          'Apenas as funções opcionais que ativas expressamente contactam terceiros: um fornecedor de IA na nuvem à tua escolha, Zotero, Unpaywall, GitHub (verificar atualizações) ou Hugging Face (transferir modelos).',
          'Se ligares o ChatGPT através do OpenAI Secure MCP Tunnel, a OpenAI recebe pedidos e resultados das ferramentas; o servidor do Nodus permanece limitado a este dispositivo.',
          'Se ligares o Nodus Server opcional e autoalojado, é publicada por HTTPS uma cópia filtrada do cofre, sem PDF, credenciais, caminhos, embeddings, listas de alunos ou classificações.',
          'Cada serviço externo é identificado antes de ser usado.',
        ],
      },
      {
        heading: 'Alunos e dados pedagógicos',
        bullets: [
          'A IA nunca recebe listas, notas ou respostas dos alunos e não pode classificar, criar perfis nem avaliar estudantes.',
        ],
      },
    ],
    canonicalLabel: 'Ler a política de privacidade completa no GitHub',
  },
  'pt-BR': {
    title: 'Privacidade e controle de dados',
    intro:
      'O Nodus funciona principalmente no dispositivo: não exige conta, não inclui publicidade, telemetria ou análise remota e não opera um backend próprio que receba o conteúdo dos seus cofres.',
    sections: [
      {
        heading: 'O que permanece no seu dispositivo',
        bullets: [
          'Bancos de dados, arquivos, gravações, transcrições, notas, dossiês e resultados são armazenados no seu dispositivo.',
          'Selecionar um arquivo ou iniciar uma gravação não o publica nem o envia para o Nodus.',
        ],
      },
      {
        heading: 'Quando os dados saem do dispositivo',
        bullets: [
          'Apenas os recursos opcionais que você ativa expressamente contatam terceiros: um provedor de IA na nuvem de sua escolha, Zotero, Unpaywall, GitHub (verificar atualizações) ou Hugging Face (baixar modelos).',
          'Se você conectar o ChatGPT pelo OpenAI Secure MCP Tunnel, a OpenAI receberá solicitações e resultados de ferramentas; o servidor do Nodus continuará restrito a este dispositivo.',
          'Se você conectar o Nodus Server opcional e auto-hospedado, uma cópia filtrada do cofre será publicada por HTTPS, sem PDFs, credenciais, caminhos, embeddings, listas de alunos ou notas.',
          'Cada serviço externo é identificado antes de ser usado.',
        ],
      },
      {
        heading: 'Alunos e dados pedagógicos',
        bullets: [
          'A IA nunca recebe listas, notas ou respostas dos alunos e não pode dar notas, traçar perfis nem avaliar estudantes.',
        ],
      },
    ],
    canonicalLabel: 'Ler a política de privacidade completa no GitHub',
  },
  it: {
    title: 'Privacy e controllo dei dati',
    intro:
      'Nodus funziona principalmente sul dispositivo: non richiede un account, non include pubblicità, telemetria o analisi remota e non gestisce un backend proprio che riceva il contenuto dei tuoi vault.',
    sections: [
      {
        heading: 'Cosa resta sul tuo dispositivo',
        bullets: [
          'Database, file, registrazioni, trascrizioni, note, fascicoli e risultati sono salvati sul tuo dispositivo.',
          'Selezionare un file o avviare una registrazione non lo pubblica né lo carica su Nodus.',
        ],
      },
      {
        heading: 'Quando i dati lasciano il dispositivo',
        bullets: [
          "Solo le funzioni opzionali che attivi espressamente contattano terze parti: un fornitore di IA nel cloud a tua scelta, Zotero, Unpaywall, GitHub (verifica aggiornamenti) o Hugging Face (download dei modelli).",
          'Se connetti ChatGPT tramite OpenAI Secure MCP Tunnel, OpenAI riceve richieste e risultati degli strumenti; il server Nodus resta limitato a questo dispositivo.',
          'Se connetti il Nodus Server opzionale e auto-ospitato, una copia filtrata del vault viene pubblicata via HTTPS, senza PDF, credenziali, percorsi, embedding, elenchi di studenti o voti.',
          'Ogni servizio esterno è identificato prima di essere usato.',
        ],
      },
      {
        heading: 'Studenti e dati didattici',
        bullets: [
          "L'IA non riceve mai elenchi, voti o risposte degli studenti e non può valutare, profilare o giudicare gli studenti.",
        ],
      },
    ],
    canonicalLabel: 'Leggi l’informativa sulla privacy completa su GitHub',
  },
};

const GDPR: Record<AppLanguage, LegalDocContent> = {
  es: {
    title: 'Cómo facilita Nodus el cumplimiento del RGPD',
    intro:
      'El diseño aplica minimización de datos, privacidad por defecto y avisos justo antes de grabar. Esto facilita el cumplimiento del RGPD, pero no es una certificación: el responsable decide la base jurídica, la conservación, el acceso y los proveedores.',
    sections: [
      {
        heading: 'Privacidad desde el diseño',
        bullets: [
          'El tratamiento local se distingue claramente de las conexiones externas opcionales.',
          'Aparecen avisos breves justo antes de acciones sensibles como grabar.',
        ],
      },
      {
        heading: 'Qué sigue siendo tu responsabilidad',
        bullets: [
          'Documentar cada finalidad, base jurídica, plazo de conservación y destinatario.',
          'Facilitar el aviso completo de los artículos 13/14 a las personas afectadas.',
          'Completar la lista de implantación para tu organización.',
        ],
      },
    ],
    canonicalLabel: 'Abrir la lista de implantación del RGPD en GitHub',
  },
  en: {
    title: 'How Nodus supports GDPR compliance',
    intro:
      'The design applies data minimisation, privacy by default and just-in-time notices before recording. This helps you comply with the GDPR, but it is not a certification: the controller decides the lawful basis, retention, access and providers.',
    sections: [
      {
        heading: 'Privacy by design',
        bullets: [
          'Local processing is clearly separated from optional external connections.',
          'Short notices appear just before sensitive actions such as recording.',
        ],
      },
      {
        heading: 'What remains your responsibility',
        bullets: [
          'Document each purpose, lawful basis, retention period and recipient.',
          'Provide the complete Articles 13/14 notice to the people involved.',
          'Complete the deployment checklist for your organisation.',
        ],
      },
    ],
    canonicalLabel: 'Open the GDPR deployment checklist on GitHub',
  },
  fr: {
    title: 'Comment Nodus facilite la conformité au RGPD',
    intro:
      "La conception applique la minimisation des données, la confidentialité par défaut et des avis affichés juste avant l'enregistrement. Cela facilite la conformité au RGPD, mais ne constitue pas une certification : le responsable décide de la base légale, de la conservation, de l'accès et des prestataires.",
    sections: [
      {
        heading: 'Protection dès la conception',
        bullets: [
          'Le traitement local est clairement distingué des connexions externes optionnelles.',
          "De brefs avis apparaissent juste avant les actions sensibles comme l'enregistrement.",
        ],
      },
      {
        heading: 'Ce qui reste de votre responsabilité',
        bullets: [
          'Documenter chaque finalité, base légale, durée de conservation et destinataire.',
          "Fournir l'information complète des articles 13/14 aux personnes concernées.",
          'Compléter la liste de déploiement pour votre organisation.',
        ],
      },
    ],
    canonicalLabel: 'Ouvrir la liste de déploiement RGPD sur GitHub',
  },
  de: {
    title: 'Wie Nodus die DSGVO-Konformität unterstützt',
    intro:
      'Das Design setzt auf Datenminimierung, Datenschutz durch Voreinstellung und Hinweise direkt vor der Aufnahme. Das erleichtert die DSGVO-Konformität, ist aber keine Zertifizierung: Der Verantwortliche entscheidet über Rechtsgrundlage, Aufbewahrung, Zugriff und Anbieter.',
    sections: [
      {
        heading: 'Datenschutz durch Technikgestaltung',
        bullets: [
          'Die lokale Verarbeitung ist klar von optionalen externen Verbindungen getrennt.',
          'Kurze Hinweise erscheinen direkt vor sensiblen Aktionen wie dem Aufnehmen.',
        ],
      },
      {
        heading: 'Was in deiner Verantwortung bleibt',
        bullets: [
          'Jeden Zweck, jede Rechtsgrundlage, Aufbewahrungsfrist und jeden Empfänger dokumentieren.',
          'Den vollständigen Hinweis nach Artikel 13/14 den betroffenen Personen bereitstellen.',
          'Die Bereitstellungs-Checkliste für deine Organisation ausfüllen.',
        ],
      },
    ],
    canonicalLabel: 'Die DSGVO-Bereitstellungs-Checkliste auf GitHub öffnen',
  },
  pt: {
    title: 'Como o Nodus facilita a conformidade com o RGPD',
    intro:
      'O design aplica minimização de dados, privacidade por predefinição e avisos mesmo antes de gravar. Isto facilita a conformidade com o RGPD, mas não é uma certificação: o responsável decide a base jurídica, a conservação, o acesso e os fornecedores.',
    sections: [
      {
        heading: 'Privacidade desde a conceção',
        bullets: [
          'O tratamento local distingue-se claramente das ligações externas opcionais.',
          'Surgem avisos breves mesmo antes de ações sensíveis como gravar.',
        ],
      },
      {
        heading: 'O que continua a ser da tua responsabilidade',
        bullets: [
          'Documentar cada finalidade, base jurídica, prazo de conservação e destinatário.',
          'Fornecer o aviso completo dos artigos 13.º/14.º às pessoas envolvidas.',
          'Completar a lista de implementação para a tua organização.',
        ],
      },
    ],
    canonicalLabel: 'Abrir a lista de implementação do RGPD no GitHub',
  },
  'pt-BR': {
    title: 'Como o Nodus facilita a conformidade com a LGPD/GDPR',
    intro:
      'O design aplica minimização de dados, privacidade por padrão e avisos logo antes de gravar. Isso facilita a conformidade com o GDPR, mas não é uma certificação: o controlador decide a base legal, a retenção, o acesso e os fornecedores.',
    sections: [
      {
        heading: 'Privacidade desde a concepção',
        bullets: [
          'O tratamento local é claramente separado das conexões externas opcionais.',
          'Avisos curtos aparecem logo antes de ações sensíveis, como gravar.',
        ],
      },
      {
        heading: 'O que continua sendo sua responsabilidade',
        bullets: [
          'Documentar cada finalidade, base legal, prazo de retenção e destinatário.',
          'Fornecer o aviso completo dos artigos 13/14 às pessoas envolvidas.',
          'Concluir a lista de implantação para a sua organização.',
        ],
      },
    ],
    canonicalLabel: 'Abrir a lista de implantação do GDPR no GitHub',
  },
  it: {
    title: 'Come Nodus facilita la conformità al GDPR',
    intro:
      "Il design applica la minimizzazione dei dati, la privacy per impostazione predefinita e avvisi appena prima della registrazione. Questo facilita la conformità al GDPR, ma non è una certificazione: il titolare decide la base giuridica, la conservazione, l'accesso e i fornitori.",
    sections: [
      {
        heading: 'Privacy fin dalla progettazione',
        bullets: [
          'Il trattamento locale è chiaramente distinto dalle connessioni esterne opzionali.',
          'Brevi avvisi compaiono appena prima di azioni sensibili come la registrazione.',
        ],
      },
      {
        heading: 'Cosa resta sotto la tua responsabilità',
        bullets: [
          'Documentare ogni finalità, base giuridica, periodo di conservazione e destinatario.',
          "Fornire l'informativa completa degli articoli 13/14 alle persone interessate.",
          'Completare la lista di implementazione per la tua organizzazione.',
        ],
      },
    ],
    canonicalLabel: 'Aprire la lista di implementazione GDPR su GitHub',
  },
};

const LICENSES: Record<AppLanguage, LegalDocContent> = {
  es: {
    title: 'Licencias y atribuciones',
    intro:
      'Nodus se publica con licencia MIT. Las licencias, atribuciones y textos exigidos por cada componente, modelo, voz o conjunto de datos de terceros se incluyen con cada versión.',
    sections: [
      {
        heading: 'Código abierto',
        bullets: [
          'El código, el historial y los documentos legales de Nodus son públicos y auditables.',
        ],
      },
      {
        heading: 'Avisos de terceros',
        bullets: [
          'Cada aplicación empaquetada incluye un directorio legal con la licencia MIT, el inventario generado completo de las dependencias de producción y los avisos exigidos (ONNX Runtime, sharp/libvips, Electron, Chromium y textos GPL/LGPL y Creative Commons).',
          'Se incluyen instrucciones para reconstruir o reemplazar los componentes LGPL.',
        ],
      },
    ],
    canonicalLabel: 'Ver los avisos de terceros en GitHub',
  },
  en: {
    title: 'Licenses and attributions',
    intro:
      'Nodus is released under the MIT License. The licenses, attributions and notices required by each third-party component, model, voice or dataset ship with every release.',
    sections: [
      {
        heading: 'Open source',
        bullets: [
          "Nodus's source, history and legal documents are public and auditable.",
        ],
      },
      {
        heading: 'Third-party notices',
        bullets: [
          'Each packaged app includes a legal directory with the MIT license, the full generated inventory of production dependencies, and the required upstream notices (ONNX Runtime, sharp/libvips, Electron, Chromium, and GPL/LGPL and Creative Commons texts).',
          'Rebuild or replacement instructions for LGPL components are included.',
        ],
      },
    ],
    canonicalLabel: 'View the third-party notices on GitHub',
  },
  fr: {
    title: 'Licences et attributions',
    intro:
      "Nodus est publié sous licence MIT. Les licences, attributions et textes exigés par chaque composant, modèle, voix ou jeu de données tiers sont inclus dans chaque version.",
    sections: [
      {
        heading: 'Open source',
        bullets: [
          'Le code, l’historique et les documents juridiques de Nodus sont publics et auditables.',
        ],
      },
      {
        heading: 'Avis de tiers',
        bullets: [
          "Chaque application packagée inclut un répertoire légal avec la licence MIT, l'inventaire généré complet des dépendances de production et les avis requis (ONNX Runtime, sharp/libvips, Electron, Chromium, ainsi que les textes GPL/LGPL et Creative Commons).",
          'Des instructions pour reconstruire ou remplacer les composants LGPL sont incluses.',
        ],
      },
    ],
    canonicalLabel: 'Voir les avis de tiers sur GitHub',
  },
  de: {
    title: 'Lizenzen und Namensnennungen',
    intro:
      'Nodus wird unter der MIT-Lizenz veröffentlicht. Die Lizenzen, Namensnennungen und geforderten Texte jeder Drittkomponente, jedes Modells, jeder Stimme oder jedes Datensatzes liegen jeder Version bei.',
    sections: [
      {
        heading: 'Open Source',
        bullets: [
          'Quellcode, Verlauf und Rechtsdokumente von Nodus sind öffentlich und prüfbar.',
        ],
      },
      {
        heading: 'Hinweise zu Drittanbietern',
        bullets: [
          'Jede paketierte App enthält ein Rechtsverzeichnis mit der MIT-Lizenz, dem vollständigen generierten Inventar der Produktionsabhängigkeiten und den erforderlichen Hinweisen (ONNX Runtime, sharp/libvips, Electron, Chromium sowie GPL/LGPL- und Creative-Commons-Texte).',
          'Anleitungen zum Neu-Erstellen oder Ersetzen der LGPL-Komponenten sind enthalten.',
        ],
      },
    ],
    canonicalLabel: 'Die Drittanbieter-Hinweise auf GitHub ansehen',
  },
  pt: {
    title: 'Licenças e atribuições',
    intro:
      'O Nodus é publicado sob a licença MIT. As licenças, atribuições e textos exigidos por cada componente, modelo, voz ou conjunto de dados de terceiros são incluídos em cada versão.',
    sections: [
      {
        heading: 'Código aberto',
        bullets: [
          'O código, o histórico e os documentos legais do Nodus são públicos e auditáveis.',
        ],
      },
      {
        heading: 'Avisos de terceiros',
        bullets: [
          'Cada aplicação empacotada inclui um diretório legal com a licença MIT, o inventário gerado completo das dependências de produção e os avisos exigidos (ONNX Runtime, sharp/libvips, Electron, Chromium e textos GPL/LGPL e Creative Commons).',
          'São incluídas instruções para reconstruir ou substituir os componentes LGPL.',
        ],
      },
    ],
    canonicalLabel: 'Ver os avisos de terceiros no GitHub',
  },
  'pt-BR': {
    title: 'Licenças e atribuições',
    intro:
      'O Nodus é publicado sob a licença MIT. As licenças, atribuições e textos exigidos por cada componente, modelo, voz ou conjunto de dados de terceiros são incluídos em cada versão.',
    sections: [
      {
        heading: 'Código aberto',
        bullets: [
          'O código, o histórico e os documentos legais do Nodus são públicos e auditáveis.',
        ],
      },
      {
        heading: 'Avisos de terceiros',
        bullets: [
          'Cada aplicativo empacotado inclui um diretório legal com a licença MIT, o inventário gerado completo das dependências de produção e os avisos exigidos (ONNX Runtime, sharp/libvips, Electron, Chromium e textos GPL/LGPL e Creative Commons).',
          'São incluídas instruções para reconstruir ou substituir os componentes LGPL.',
        ],
      },
    ],
    canonicalLabel: 'Ver os avisos de terceiros no GitHub',
  },
  it: {
    title: 'Licenze e attribuzioni',
    intro:
      'Nodus è pubblicato con licenza MIT. Le licenze, le attribuzioni e i testi richiesti da ogni componente, modello, voce o set di dati di terze parti sono inclusi in ogni versione.',
    sections: [
      {
        heading: 'Open source',
        bullets: [
          'Il codice, la cronologia e i documenti legali di Nodus sono pubblici e verificabili.',
        ],
      },
      {
        heading: 'Avvisi di terze parti',
        bullets: [
          "Ogni app pacchettizzata include una cartella legale con la licenza MIT, l'inventario generato completo delle dipendenze di produzione e gli avvisi richiesti (ONNX Runtime, sharp/libvips, Electron, Chromium e i testi GPL/LGPL e Creative Commons).",
          'Sono incluse istruzioni per ricostruire o sostituire i componenti LGPL.',
        ],
      },
    ],
    canonicalLabel: 'Visualizza gli avvisi di terze parti su GitHub',
  },
};

export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = {
  privacy: {
    id: 'privacy',
    icon: 'shield',
    badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    canonicalUrl: `${NODUS_REPOSITORY_URL}/blob/main/PRIVACY.md`,
    content: PRIVACY,
  },
  gdpr: {
    id: 'gdpr',
    icon: 'globe',
    badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    canonicalUrl: `${NODUS_REPOSITORY_URL}/blob/main/legal/RGPD_DEPLOYMENT_CHECKLIST.md`,
    content: GDPR,
  },
  licenses: {
    id: 'licenses',
    icon: 'book',
    badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    canonicalUrl: `${NODUS_REPOSITORY_URL}/blob/main/THIRD_PARTY_NOTICES.md`,
    content: LICENSES,
  },
};

export function legalDocContent(doc: LegalDoc, language: AppLanguage): LegalDocContent {
  return doc.content[language] ?? doc.content.en;
}
