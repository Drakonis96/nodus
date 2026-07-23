import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppLanguage } from '@shared/types';
import type { TutorialLanguage } from '@shared/tutorialPreferences';
import { TOOLKIT_TOOLS } from '../navigation';
import zoteroLogo from '../assets/brands/zotero.svg';
import { Icon } from './ui';
import { NodiAvatar } from './nodi/NodiAvatar';

export const PLATFORM_HIGHLIGHTS_TUTORIAL_VERSION = 5;
const SEEN_KEY = 'nodus.platformHighlightsSeen.2026-07';

type PlatformSlideCopy = {
  eyebrow: string;
  title: string;
  summary: string;
  body: string;
  detailA: string;
  detailB: string;
  detailC?: string;
  tip: string;
};

type PlatformCopy = {
  slides: [PlatformSlideCopy, PlatformSlideCopy, PlatformSlideCopy];
  modalBadge: string;
  modalTitle: string;
  modalSummary: string;
  previous: string;
  next: string;
  finish: string;
  step: string;
  of: string;
};

const SHARED_MODAL_EN = {
  modalBadge: 'NEW · CONNECTED WORKFLOWS',
  modalTitle: 'Nodus now reaches further',
  modalSummary: 'Connect AI clients, share a filtered vault, work inside Zotero, and use the complete Toolkit.',
  previous: 'Back',
  next: 'Next',
  finish: 'Start exploring',
  step: 'Step',
  of: 'of',
};

const COPY: Record<TutorialLanguage, PlatformCopy> = {
  es: {
    slides: [
      {
        eyebrow: 'Conectar y compartir',
        title: 'MCP local y Nodus Server',
        summary: 'Dos caminos distintos para usar tu conocimiento fuera de la ventana principal, sin confundir sus límites.',
        body: 'El servidor MCP conecta clientes compatibles con la bóveda activa mediante herramientas controladas. Nodus Server comparte por web una proyección filtrada de una bóveda con las personas que autorices.',
        detailA: 'MCP funciona en tu ordenador, usa un token y muestra solo las herramientas pertinentes para el tipo de bóveda.',
        detailB: 'Nodus Server es experimental, vive en Docker y recibe únicamente conexiones HTTPS salientes desde Nodus Desktop.',
        tip: 'Son sistemas independientes: Nodus Server no publica el puerto, el listener ni el token de tu MCP local.',
      },
      {
        eyebrow: 'Trabajar donde lees',
        title: 'Nodus para Zotero',
        summary: 'Un plugin beta que lleva el contexto de Nodus al panel lateral y al lector de Zotero.',
        body: 'Pregunta por el documento abierto o por varios ítems, encuentra conexiones con tu biblioteca y usa citas de página desde una conversación que detecta Nodus automáticamente.',
        detailA: 'Resume, explica, traduce y conversa sobre el texto seleccionado sin abandonar el lector.',
        detailB: 'Puede auto-subrayar pasajes importantes y guardar el chat como una nota de Zotero.',
        detailC: 'El modo agente propone crear notas, subrayar, etiquetar o editar campos; cada acción pide permiso por defecto.',
        tip: 'Instálalo o actualízalo desde Ajustes → Nodus para Zotero. También puedes descargar el archivo .xpi.',
      },
      {
        eyebrow: 'Herramientas prácticas',
        title: 'El Toolkit completo',
        summary: 'Seis espacios para crear miniapps y trabajar con documentos, traducción, privacidad, presentaciones y OCR.',
        body: 'Nodus Apps se suma a Convert, Protect, Translate, PDF Presenter y OCR Workspace. Cada herramienta mantiene su propio flujo y deja claros los pasos que usan IA.',
        detailA: 'Nodus Apps crea herramientas adaptables para investigar, estudiar o enseñar y permite compartir sesiones por QR.',
        detailB: 'Presenter importa PDF y presentaciones; OCR reconstruye escaneados difíciles; Convert, Protect y Translate preparan copias nuevas sin tocar el original.',
        tip: 'Abre Herramientas en la barra lateral para ver el catálogo completo. El procesamiento es local salvo cuando una función indica que usa un proveedor de IA.',
      },
    ],
    modalBadge: 'NUEVO · FLUJOS CONECTADOS',
    modalTitle: 'Nodus llega más lejos',
    modalSummary: 'Conecta clientes de IA, comparte una bóveda filtrada, trabaja dentro de Zotero y aprovecha el Toolkit completo.',
    previous: 'Anterior',
    next: 'Siguiente',
    finish: 'Empezar a explorar',
    step: 'Paso',
    of: 'de',
  },
  en: {
    slides: [
      {
        eyebrow: 'Connect and share',
        title: 'Local MCP and Nodus Server',
        summary: 'Two separate ways to use your knowledge beyond the main window, each with clear boundaries.',
        body: 'The MCP server connects compatible clients to the active vault through controlled tools. Nodus Server shares a filtered vault projection on the web with people you authorise.',
        detailA: 'MCP runs on your computer, uses a token, and exposes only the tools relevant to the active vault type.',
        detailB: 'Nodus Server is experimental, runs in Docker, and receives outbound HTTPS connections only from Nodus Desktop.',
        tip: 'They are independent systems: Nodus Server never publishes your local MCP port, listener, or token.',
      },
      {
        eyebrow: 'Work where you read',
        title: 'Nodus for Zotero',
        summary: 'A beta plugin that brings Nodus context into Zotero’s sidebar and reader.',
        body: 'Ask about the open document or multiple selected items, discover links across your library, and use page citations in a conversation that finds Nodus automatically.',
        detailA: 'Summarise, explain, translate, and discuss selected text without leaving the reader.',
        detailB: 'It can auto-highlight important passages and save a conversation as a Zotero note.',
        detailC: 'Agent mode proposes notes, highlights, tags, or field edits; every action asks for permission by default.',
        tip: 'Install or update it under Settings → Nodus for Zotero. You can also download the .xpi file.',
      },
      {
        eyebrow: 'Practical tools',
        title: 'The complete Toolkit',
        summary: 'Six workspaces for miniapps, document conversion, translation, privacy, presentations, and OCR.',
        body: 'Nodus Apps joins Convert, Protect, Translate, PDF Presenter, and OCR Workspace. Each tool has a focused workflow and clearly identifies the steps that use AI.',
        detailA: 'Nodus Apps creates adaptable research, study, or teaching tools and can share live sessions by QR.',
        detailB: 'Presenter imports PDFs and presentation files; OCR rebuilds difficult scans; Convert, Protect, and Translate create new outputs without touching originals.',
        tip: 'Open Tools in the sidebar for the full catalogue. Processing is local unless a feature explicitly says it uses an AI provider.',
      },
    ],
    ...SHARED_MODAL_EN,
  },
  fr: {
    slides: [
      {
        eyebrow: 'Connecter et partager',
        title: 'MCP local et Nodus Server',
        summary: 'Deux moyens distincts d’utiliser vos connaissances hors de la fenêtre principale, avec des limites claires.',
        body: 'Le serveur MCP relie les clients compatibles à l’espace actif par des outils contrôlés. Nodus Server partage sur le Web une projection filtrée d’un espace avec les personnes autorisées.',
        detailA: 'MCP fonctionne sur votre appareil, utilise un jeton et n’expose que les outils adaptés au type d’espace actif.',
        detailB: 'Nodus Server est expérimental, fonctionne dans Docker et ne reçoit que des connexions HTTPS sortantes de Nodus Desktop.',
        tip: 'Les deux systèmes sont indépendants : Nodus Server ne publie jamais le port, le listener ni le jeton du MCP local.',
      },
      {
        eyebrow: 'Travailler là où vous lisez',
        title: 'Nodus pour Zotero',
        summary: 'Un plugin bêta qui apporte le contexte de Nodus dans le panneau latéral et le lecteur de Zotero.',
        body: 'Interrogez le document ouvert ou plusieurs éléments, trouvez des liens dans votre bibliothèque et utilisez des citations de page dans une conversation qui détecte automatiquement Nodus.',
        detailA: 'Résumez, expliquez, traduisez et discutez le texte sélectionné sans quitter le lecteur.',
        detailB: 'Le plugin peut surligner automatiquement les passages importants et enregistrer le chat comme note Zotero.',
        detailC: 'Le mode agent propose notes, surlignages, étiquettes ou modifications de champs ; chaque action demande une autorisation par défaut.',
        tip: 'Installez-le ou mettez-le à jour dans Réglages → Nodus pour Zotero, ou téléchargez le fichier .xpi.',
      },
      {
        eyebrow: 'Outils pratiques',
        title: 'Le Toolkit complet',
        summary: 'Six espaces pour les miniapps, les documents, la traduction, la confidentialité, les présentations et l’OCR.',
        body: 'Nodus Apps rejoint Convert, Protect, Translate, PDF Presenter et OCR Workspace. Chaque outil possède un flux ciblé et signale clairement les étapes qui utilisent l’IA.',
        detailA: 'Nodus Apps crée des outils adaptables pour la recherche, les études ou l’enseignement et partage des sessions par QR.',
        detailB: 'Presenter importe PDF et présentations ; OCR reconstruit les scans difficiles ; Convert, Protect et Translate créent de nouveaux résultats sans modifier les originaux.',
        tip: 'Ouvrez Outils dans la barre latérale pour voir le catalogue complet. Le traitement est local sauf indication explicite d’un fournisseur d’IA.',
      },
    ],
    modalBadge: 'NOUVEAU · FLUX CONNECTÉS',
    modalTitle: 'Nodus va désormais plus loin',
    modalSummary: 'Connectez des clients IA, partagez un espace filtré, travaillez dans Zotero et utilisez tout le Toolkit.',
    previous: 'Précédent',
    next: 'Suivant',
    finish: 'Commencer à explorer',
    step: 'Étape',
    of: 'sur',
  },
  de: {
    slides: [
      {
        eyebrow: 'Verbinden und teilen',
        title: 'Lokales MCP und Nodus Server',
        summary: 'Zwei getrennte Wege, Wissen außerhalb des Hauptfensters zu nutzen – mit klaren Grenzen.',
        body: 'Der MCP-Server verbindet kompatible Clients über kontrollierte Werkzeuge mit dem aktiven Arbeitsbereich. Nodus Server teilt eine gefilterte Projektion eines Arbeitsbereichs im Web mit autorisierten Personen.',
        detailA: 'MCP läuft auf deinem Gerät, verwendet ein Token und zeigt nur die für den aktiven Arbeitsbereichstyp passenden Werkzeuge.',
        detailB: 'Nodus Server ist experimentell, läuft in Docker und erhält ausschließlich ausgehende HTTPS-Verbindungen von Nodus Desktop.',
        tip: 'Beide Systeme sind unabhängig: Nodus Server veröffentlicht niemals Port, Listener oder Token des lokalen MCP.',
      },
      {
        eyebrow: 'Dort arbeiten, wo du liest',
        title: 'Nodus für Zotero',
        summary: 'Ein Beta-Plugin, das den Nodus-Kontext in die Seitenleiste und den Reader von Zotero bringt.',
        body: 'Frage nach dem geöffneten Dokument oder mehreren markierten Einträgen, entdecke Verbindungen in deiner Bibliothek und nutze Seitenzitate in einem Chat, der Nodus automatisch findet.',
        detailA: 'Fasse markierten Text zusammen, erkläre oder übersetze ihn und diskutiere ihn, ohne den Reader zu verlassen.',
        detailB: 'Das Plugin kann wichtige Passagen automatisch markieren und den Chat als Zotero-Notiz speichern.',
        detailC: 'Der Agentenmodus schlägt Notizen, Markierungen, Tags oder Feldänderungen vor; standardmäßig wird jede Aktion bestätigt.',
        tip: 'Installiere oder aktualisiere es unter Einstellungen → Nodus für Zotero oder lade die .xpi-Datei herunter.',
      },
      {
        eyebrow: 'Praktische Werkzeuge',
        title: 'Das vollständige Toolkit',
        summary: 'Sechs Bereiche für Mini-Apps, Dokumente, Übersetzung, Datenschutz, Präsentationen und OCR.',
        body: 'Nodus Apps ergänzt Convert, Protect, Translate, PDF Presenter und OCR Workspace. Jedes Werkzeug hat einen fokussierten Ablauf und kennzeichnet KI-Schritte klar.',
        detailA: 'Nodus Apps erstellt anpassbare Werkzeuge für Forschung, Studium oder Lehre und teilt Sitzungen per QR.',
        detailB: 'Presenter importiert PDFs und Präsentationen; OCR rekonstruiert schwierige Scans; Convert, Protect und Translate erzeugen neue Ausgaben, ohne Originale zu verändern.',
        tip: 'Öffne Werkzeuge in der Seitenleiste für den ganzen Katalog. Die Verarbeitung ist lokal, sofern nicht ausdrücklich ein KI-Anbieter genannt wird.',
      },
    ],
    modalBadge: 'NEU · VERBUNDENE ABLÄUFE',
    modalTitle: 'Nodus reicht jetzt weiter',
    modalSummary: 'Verbinde KI-Clients, teile einen gefilterten Arbeitsbereich, arbeite in Zotero und nutze das komplette Toolkit.',
    previous: 'Zurück',
    next: 'Weiter',
    finish: 'Jetzt entdecken',
    step: 'Schritt',
    of: 'von',
  },
  it: {
    slides: [
      {
        eyebrow: 'Connetti e condividi',
        title: 'MCP locale e Nodus Server',
        summary: 'Due modi distinti per usare le tue conoscenze fuori dalla finestra principale, con limiti chiari.',
        body: 'Il server MCP collega i client compatibili al vault attivo tramite strumenti controllati. Nodus Server condivide sul web una proiezione filtrata di un vault con le persone autorizzate.',
        detailA: 'MCP funziona sul tuo dispositivo, usa un token e mostra solo gli strumenti adatti al tipo di vault attivo.',
        detailB: 'Nodus Server è sperimentale, vive in Docker e riceve solo connessioni HTTPS in uscita da Nodus Desktop.',
        tip: 'Sono sistemi indipendenti: Nodus Server non pubblica mai porta, listener o token del tuo MCP locale.',
      },
      {
        eyebrow: 'Lavora dove leggi',
        title: 'Nodus per Zotero',
        summary: 'Un plugin beta che porta il contesto di Nodus nella barra laterale e nel lettore di Zotero.',
        body: 'Fai domande sul documento aperto o su più elementi, trova collegamenti nella biblioteca e usa citazioni di pagina in una conversazione che rileva Nodus automaticamente.',
        detailA: 'Riassumi, spiega, traduci e discuti il testo selezionato senza lasciare il lettore.',
        detailB: 'Può evidenziare automaticamente i passaggi importanti e salvare la chat come nota Zotero.',
        detailC: 'La modalità agente propone note, evidenziazioni, tag o modifiche ai campi; ogni azione richiede il permesso per impostazione predefinita.',
        tip: 'Installalo o aggiornalo da Impostazioni → Nodus per Zotero, oppure scarica il file .xpi.',
      },
      {
        eyebrow: 'Strumenti pratici',
        title: 'Il Toolkit completo',
        summary: 'Sei spazi per miniapp, documenti, traduzione, privacy, presentazioni e OCR.',
        body: 'Nodus Apps si unisce a Convert, Protect, Translate, PDF Presenter e OCR Workspace. Ogni strumento ha un flusso mirato e segnala chiaramente i passaggi che usano l’IA.',
        detailA: 'Nodus Apps crea strumenti adattabili per ricerca, studio o insegnamento e condivide sessioni tramite QR.',
        detailB: 'Presenter importa PDF e presentazioni; OCR ricostruisce scansioni difficili; Convert, Protect e Translate creano nuovi risultati senza toccare gli originali.',
        tip: 'Apri Strumenti nella barra laterale per il catalogo completo. L’elaborazione è locale salvo quando viene indicato un provider IA.',
      },
    ],
    modalBadge: 'NOVITÀ · FLUSSI CONNESSI',
    modalTitle: 'Nodus ora arriva più lontano',
    modalSummary: 'Collega client IA, condividi un vault filtrato, lavora in Zotero e usa il Toolkit completo.',
    previous: 'Indietro',
    next: 'Avanti',
    finish: 'Inizia a esplorare',
    step: 'Passaggio',
    of: 'di',
  },
  pt: {
    slides: [
      {
        eyebrow: 'Ligar e partilhar',
        title: 'MCP local e Nodus Server',
        summary: 'Duas formas distintas de usar o seu conhecimento fora da janela principal, com limites claros.',
        body: 'O servidor MCP liga clientes compatíveis ao espaço ativo através de ferramentas controladas. O Nodus Server partilha na Web uma projeção filtrada de um espaço com as pessoas autorizadas.',
        detailA: 'O MCP funciona no seu equipamento, usa um token e mostra apenas as ferramentas adequadas ao tipo de espaço ativo.',
        detailB: 'O Nodus Server é experimental, funciona em Docker e recebe apenas ligações HTTPS de saída do Nodus Desktop.',
        tip: 'São sistemas independentes: o Nodus Server nunca publica a porta, o listener nem o token do MCP local.',
      },
      {
        eyebrow: 'Trabalhar onde lê',
        title: 'Nodus para Zotero',
        summary: 'Um plugin beta que leva o contexto do Nodus ao painel lateral e ao leitor do Zotero.',
        body: 'Pergunte sobre o documento aberto ou vários itens, encontre ligações na biblioteca e use citações de página numa conversa que deteta o Nodus automaticamente.',
        detailA: 'Resuma, explique, traduza e discuta o texto selecionado sem sair do leitor.',
        detailB: 'Pode sublinhar automaticamente passagens importantes e guardar a conversa como nota do Zotero.',
        detailC: 'O modo agente propõe notas, sublinhados, etiquetas ou alterações de campos; cada ação pede autorização por predefinição.',
        tip: 'Instale ou atualize em Definições → Nodus para Zotero, ou descarregue o ficheiro .xpi.',
      },
      {
        eyebrow: 'Ferramentas práticas',
        title: 'O Toolkit completo',
        summary: 'Seis espaços para miniapps, documentos, tradução, privacidade, apresentações e OCR.',
        body: 'O Nodus Apps junta-se ao Convert, Protect, Translate, PDF Presenter e OCR Workspace. Cada ferramenta tem um fluxo próprio e identifica claramente os passos que usam IA.',
        detailA: 'O Nodus Apps cria ferramentas adaptáveis para investigação, estudo ou ensino e partilha sessões por QR.',
        detailB: 'O Presenter importa PDF e apresentações; o OCR reconstrói digitalizações difíceis; Convert, Protect e Translate criam novos resultados sem alterar os originais.',
        tip: 'Abra Ferramentas na barra lateral para ver o catálogo completo. O processamento é local salvo indicação explícita de um fornecedor de IA.',
      },
    ],
    modalBadge: 'NOVO · FLUXOS LIGADOS',
    modalTitle: 'O Nodus chega agora mais longe',
    modalSummary: 'Ligue clientes de IA, partilhe um espaço filtrado, trabalhe no Zotero e use todo o Toolkit.',
    previous: 'Anterior',
    next: 'Seguinte',
    finish: 'Começar a explorar',
    step: 'Passo',
    of: 'de',
  },
  'pt-BR': {
    slides: [
      {
        eyebrow: 'Conectar e compartilhar',
        title: 'MCP local e Nodus Server',
        summary: 'Duas formas distintas de usar seu conhecimento fora da janela principal, com limites claros.',
        body: 'O servidor MCP conecta clientes compatíveis ao espaço ativo por ferramentas controladas. O Nodus Server compartilha na Web uma projeção filtrada de um espaço com as pessoas autorizadas.',
        detailA: 'O MCP funciona no seu dispositivo, usa um token e mostra apenas as ferramentas adequadas ao tipo de espaço ativo.',
        detailB: 'O Nodus Server é experimental, funciona em Docker e recebe somente conexões HTTPS de saída do Nodus Desktop.',
        tip: 'São sistemas independentes: o Nodus Server nunca publica a porta, o listener nem o token do MCP local.',
      },
      {
        eyebrow: 'Trabalhe onde lê',
        title: 'Nodus para Zotero',
        summary: 'Um plugin beta que leva o contexto do Nodus à barra lateral e ao leitor do Zotero.',
        body: 'Pergunte sobre o documento aberto ou vários itens, encontre conexões na biblioteca e use citações de página em uma conversa que detecta o Nodus automaticamente.',
        detailA: 'Resuma, explique, traduza e discuta o texto selecionado sem sair do leitor.',
        detailB: 'Ele pode destacar automaticamente trechos importantes e salvar a conversa como nota do Zotero.',
        detailC: 'O modo agente propõe notas, destaques, etiquetas ou alterações de campos; cada ação pede permissão por padrão.',
        tip: 'Instale ou atualize em Configurações → Nodus para Zotero, ou baixe o arquivo .xpi.',
      },
      {
        eyebrow: 'Ferramentas práticas',
        title: 'O Toolkit completo',
        summary: 'Seis espaços para miniapps, documentos, tradução, privacidade, apresentações e OCR.',
        body: 'O Nodus Apps se junta ao Convert, Protect, Translate, PDF Presenter e OCR Workspace. Cada ferramenta tem um fluxo próprio e identifica claramente as etapas que usam IA.',
        detailA: 'O Nodus Apps cria ferramentas adaptáveis para pesquisa, estudo ou ensino e compartilha sessões por QR.',
        detailB: 'O Presenter importa PDFs e apresentações; o OCR reconstrói digitalizações difíceis; Convert, Protect e Translate criam novos resultados sem alterar os originais.',
        tip: 'Abra Ferramentas na barra lateral para ver o catálogo completo. O processamento é local, salvo quando uma função indica que usa um provedor de IA.',
      },
    ],
    modalBadge: 'NOVO · FLUXOS CONECTADOS',
    modalTitle: 'O Nodus agora vai mais longe',
    modalSummary: 'Conecte clientes de IA, compartilhe um espaço filtrado, trabalhe no Zotero e use todo o Toolkit.',
    previous: 'Anterior',
    next: 'Próximo',
    finish: 'Começar a explorar',
    step: 'Etapa',
    of: 'de',
  },
  tr: {
    slides: [
      {
        eyebrow: 'Bağlan ve paylaş',
        title: 'Yerel MCP ve Nodus Server',
        summary: 'Bilginizi ana pencerenin dışında kullanmanın sınırları açık iki ayrı yolu.',
        body: 'MCP sunucusu uyumlu istemcileri denetimli araçlarla etkin kasaya bağlar. Nodus Server ise kasanın filtrelenmiş bir görünümünü yetkilendirdiğiniz kişilerle web üzerinden paylaşır.',
        detailA: 'MCP cihazınızda çalışır, belirteç kullanır ve yalnızca etkin kasa türüne uygun araçları gösterir.',
        detailB: 'Nodus Server deneyseldir, Docker’da çalışır ve Nodus Desktop’tan yalnızca dışarı giden HTTPS bağlantıları alır.',
        tip: 'Bu sistemler bağımsızdır: Nodus Server yerel MCP bağlantı noktasını, dinleyicisini veya belirtecini yayımlamaz.',
      },
      {
        eyebrow: 'Okuduğun yerde çalış',
        title: 'Zotero için Nodus',
        summary: 'Nodus bağlamını Zotero’nun yan paneline ve okuyucusuna taşıyan beta eklenti.',
        body: 'Açık belge veya seçili öğeler hakkında sorun, kütüphanenizdeki bağlantıları bulun ve Nodus’u otomatik algılayan sohbette sayfa alıntılarını kullanın.',
        detailA: 'Okuyucudan ayrılmadan seçili metni özetleyin, açıklayın, çevirin ve tartışın.',
        detailB: 'Önemli bölümleri otomatik vurgulayabilir ve sohbeti Zotero notu olarak kaydedebilir.',
        detailC: 'Ajan modu not, vurgu, etiket veya alan değişikliği önerir; varsayılan olarak her işlem izin ister.',
        tip: 'Ayarlar → Zotero için Nodus bölümünden kurun veya güncelleyin; .xpi dosyasını da indirebilirsiniz.',
      },
      {
        eyebrow: 'Pratik araçlar',
        title: 'Eksiksiz Toolkit',
        summary: 'Mini uygulamalar, belgeler, çeviri, gizlilik, sunumlar ve OCR için altı çalışma alanı.',
        body: 'Nodus Apps; Convert, Protect, Translate, PDF Presenter ve OCR Workspace’e katılır. Her araç odaklı bir akış sunar ve yapay zekâ kullanan adımları açıkça belirtir.',
        detailA: 'Nodus Apps araştırma, öğrenme veya öğretim için uyarlanabilir araçlar oluşturur ve oturumları QR ile paylaşır.',
        detailB: 'Presenter PDF ve sunumları içe aktarır; OCR zor taramaları yeniden kurar; diğer araçlar asıllara dokunmadan yeni çıktılar üretir.',
        tip: 'Tam katalog için kenar çubuğunda Araçlar’ı açın. Bir yapay zekâ sağlayıcısı açıkça belirtilmedikçe işlem yereldir.',
      },
    ],
    ...SHARED_MODAL_EN,
  },
  zh: {
    slides: [
      {
        eyebrow: '连接与共享',
        title: '本地 MCP 与 Nodus Server',
        summary: '两种彼此独立、边界清楚的方式，让你在主窗口之外使用知识。',
        body: 'MCP 服务器通过受控工具把兼容客户端连接到当前资料库。Nodus Server 则通过网页向获授权的人共享资料库的筛选视图。',
        detailA: 'MCP 在本机运行，使用令牌，并且只显示适合当前资料库类型的工具。',
        detailB: 'Nodus Server 尚属实验功能，运行在 Docker 中，只接收 Nodus Desktop 发出的 HTTPS 连接。',
        tip: '两套系统彼此独立：Nodus Server 不会公开本地 MCP 的端口、监听器或令牌。',
      },
      {
        eyebrow: '在阅读处工作',
        title: 'Nodus for Zotero',
        summary: '把 Nodus 上下文带入 Zotero 侧栏和阅读器的测试版插件。',
        body: '可询问当前文献或多个所选条目，查找资料库中的联系，并在自动发现 Nodus 的对话中使用页码引用。',
        detailA: '无需离开阅读器即可概述、解释、翻译和讨论所选文字。',
        detailB: '可自动高亮重要段落，并把对话保存为 Zotero 笔记。',
        detailC: '代理模式会建议创建笔记、高亮、标签或修改字段；默认每项操作都需要许可。',
        tip: '可在“设置 → Nodus for Zotero”中安装或更新，也可下载 .xpi 文件。',
      },
      {
        eyebrow: '实用工具',
        title: '完整 Toolkit',
        summary: '六个工作区，覆盖迷你应用、文档、翻译、隐私、演示和 OCR。',
        body: 'Nodus Apps 与 Convert、Protect、Translate、PDF Presenter 和 OCR Workspace 组成完整工具集。每项工具都有专用流程，并清楚标出使用 AI 的步骤。',
        detailA: 'Nodus Apps 可创建适用于研究、学习或教学的工具，并通过二维码共享会话。',
        detailB: 'Presenter 导入 PDF 和演示文件；OCR 重建复杂扫描件；其余工具在不改动原件的情况下生成新输出。',
        tip: '在侧栏打开“工具”查看完整目录。除非明确说明使用 AI 服务商，否则处理均在本机完成。',
      },
    ],
    ...SHARED_MODAL_EN,
  },
  ja: {
    slides: [
      {
        eyebrow: '接続と共有',
        title: 'ローカルMCPとNodus Server',
        summary: '知識をメイン画面の外で使うための、境界が明確な二つの独立した方法です。',
        body: 'MCPサーバーは制御されたツールで対応クライアントを現在のVaultに接続します。Nodus Serverは、許可した相手にVaultの絞り込まれた表示をWebで共有します。',
        detailA: 'MCPは端末上で動作し、トークンを使い、現在のVault種別に合うツールだけを表示します。',
        detailB: 'Nodus Serverは実験機能で、Docker上で動作し、Nodus Desktopからの外向きHTTPS接続だけを受け取ります。',
        tip: '両者は独立しています。Nodus ServerがローカルMCPのポート、リスナー、トークンを公開することはありません。',
      },
      {
        eyebrow: '読む場所で作業',
        title: 'Nodus for Zotero',
        summary: 'Nodusの文脈をZoteroのサイドバーとリーダーに届けるベータ版プラグインです。',
        body: '開いている文献や複数の選択項目について質問し、ライブラリ内のつながりを探し、Nodusを自動検出する会話でページ引用を使えます。',
        detailA: 'リーダーを離れずに、選択した文章の要約、説明、翻訳、対話ができます。',
        detailB: '重要箇所を自動でハイライトし、会話をZoteroノートとして保存できます。',
        detailC: 'エージェントモードはノート、ハイライト、タグ、フィールド編集を提案し、既定では操作ごとに許可を求めます。',
        tip: '設定 → Nodus for Zoteroから導入・更新できます。.xpiファイルのダウンロードも可能です。',
      },
      {
        eyebrow: '実用ツール',
        title: '完全なToolkit',
        summary: 'ミニアプリ、文書、翻訳、プライバシー、プレゼン、OCRのための六つのワークスペースです。',
        body: 'Nodus AppsがConvert、Protect、Translate、PDF Presenter、OCR Workspaceに加わりました。各ツールは用途別の流れを持ち、AIを使う工程を明示します。',
        detailA: 'Nodus Appsは研究、学習、教育向けの調整可能なツールを作成し、QRでセッションを共有できます。',
        detailB: 'PresenterはPDFとプレゼンを読み込み、OCRは難しいスキャンを再構築し、ほかのツールは原本を変えずに新しい出力を作ります。',
        tip: 'サイドバーの「ツール」で全カタログを確認できます。AIプロバイダーの使用が明記されない限り、処理はローカルです。',
      },
    ],
    ...SHARED_MODAL_EN,
  },
  ru: {
    slides: [
      {
        eyebrow: 'Подключение и общий доступ',
        title: 'Локальный MCP и Nodus Server',
        summary: 'Два независимых способа использовать знания вне главного окна с чёткими границами.',
        body: 'Сервер MCP подключает совместимые клиенты к активному хранилищу через контролируемые инструменты. Nodus Server публикует в вебе отфильтрованную проекцию хранилища для авторизованных людей.',
        detailA: 'MCP работает на устройстве, использует токен и показывает только инструменты для типа активного хранилища.',
        detailB: 'Nodus Server — экспериментальная система в Docker, принимающая только исходящие HTTPS-подключения от Nodus Desktop.',
        tip: 'Системы независимы: Nodus Server не публикует порт, listener или токен локального MCP.',
      },
      {
        eyebrow: 'Работайте там, где читаете',
        title: 'Nodus для Zotero',
        summary: 'Бета-плагин переносит контекст Nodus в боковую панель и читалку Zotero.',
        body: 'Задавайте вопросы об открытом документе или нескольких выбранных элементах, находите связи в библиотеке и используйте постраничные ссылки в чате, который автоматически находит Nodus.',
        detailA: 'Резюмируйте, объясняйте, переводите и обсуждайте выделенный текст, не покидая читалку.',
        detailB: 'Плагин может автоматически выделять важные фрагменты и сохранять чат как заметку Zotero.',
        detailC: 'Режим агента предлагает заметки, выделения, теги и правки полей; по умолчанию каждое действие требует разрешения.',
        tip: 'Установите или обновите его в Настройки → Nodus для Zotero либо скачайте файл .xpi.',
      },
      {
        eyebrow: 'Практические инструменты',
        title: 'Полный Toolkit',
        summary: 'Шесть пространств для мини-приложений, документов, перевода, приватности, презентаций и OCR.',
        body: 'Nodus Apps дополняет Convert, Protect, Translate, PDF Presenter и OCR Workspace. У каждого инструмента отдельный рабочий процесс и ясное обозначение шагов с ИИ.',
        detailA: 'Nodus Apps создаёт настраиваемые инструменты для исследований, учёбы и преподавания и делится сессиями по QR.',
        detailB: 'Presenter импортирует PDF и презентации; OCR восстанавливает сложные сканы; остальные инструменты создают новые результаты, не меняя оригиналы.',
        tip: 'Откройте «Инструменты» в боковой панели, чтобы увидеть весь каталог. Обработка локальна, если явно не указан поставщик ИИ.',
      },
    ],
    ...SHARED_MODAL_EN,
  },
  uk: {
    slides: [
      {
        eyebrow: 'Підключення й спільний доступ',
        title: 'Локальний MCP і Nodus Server',
        summary: 'Два незалежні способи використовувати знання поза головним вікном із чіткими межами.',
        body: 'Сервер MCP підключає сумісні клієнти до активного сховища через контрольовані інструменти. Nodus Server ділиться у вебі відфільтрованою проєкцією сховища з уповноваженими людьми.',
        detailA: 'MCP працює на пристрої, використовує токен і показує лише інструменти для типу активного сховища.',
        detailB: 'Nodus Server — експериментальна система в Docker, яка приймає лише вихідні HTTPS-з’єднання від Nodus Desktop.',
        tip: 'Системи незалежні: Nodus Server не публікує порт, listener або токен локального MCP.',
      },
      {
        eyebrow: 'Працюйте там, де читаєте',
        title: 'Nodus для Zotero',
        summary: 'Бета-плагін переносить контекст Nodus у бічну панель і читач Zotero.',
        body: 'Запитуйте про відкритий документ або кілька вибраних елементів, знаходьте зв’язки у бібліотеці та використовуйте сторінкові цитати в чаті, який автоматично знаходить Nodus.',
        detailA: 'Підсумовуйте, пояснюйте, перекладайте й обговорюйте виділений текст, не залишаючи читач.',
        detailB: 'Плагін може автоматично виділяти важливі уривки й зберігати чат як нотатку Zotero.',
        detailC: 'Режим агента пропонує нотатки, виділення, теги або зміни полів; типово кожна дія потребує дозволу.',
        tip: 'Установіть або оновіть його в Налаштування → Nodus для Zotero чи завантажте файл .xpi.',
      },
      {
        eyebrow: 'Практичні інструменти',
        title: 'Повний Toolkit',
        summary: 'Шість просторів для мініпрограм, документів, перекладу, приватності, презентацій та OCR.',
        body: 'Nodus Apps доповнює Convert, Protect, Translate, PDF Presenter і OCR Workspace. Кожен інструмент має окремий процес і чітко позначає кроки зі ШІ.',
        detailA: 'Nodus Apps створює адаптивні інструменти для досліджень, навчання чи викладання та ділиться сесіями через QR.',
        detailB: 'Presenter імпортує PDF і презентації; OCR відновлює складні скани; інші інструменти створюють нові результати, не змінюючи оригінали.',
        tip: 'Відкрийте «Інструменти» на бічній панелі, щоб побачити весь каталог. Обробка локальна, якщо явно не вказано постачальника ШІ.',
      },
    ],
    ...SHARED_MODAL_EN,
  },
};

function Notice({ children }: { children: ReactNode }) {
  return <div className="platform-guide-notice"><Icon name="shield" size={16} /><span>{children}</span></div>;
}

function ConnectionPanel({ language }: { language: TutorialLanguage }) {
  const copy = COPY[language].slides[0];
  return <>
    <p>{copy.body}</p>
    <div className="platform-guide-pair">
      <div><span><Icon name="link" size={20} /></span><div><b>MCP</b><small>{copy.detailA}</small></div></div>
      <div><span><Icon name="globe" size={20} /></span><div><b>Nodus Server · experimental</b><small>{copy.detailB}</small></div></div>
    </div>
    <Notice>{copy.tip}</Notice>
  </>;
}

function ZoteroPanel({ language }: { language: TutorialLanguage }) {
  const copy = COPY[language].slides[1];
  return <>
    <div className="platform-guide-zotero">
      <span className="platform-guide-zotero-brand"><img src={zoteroLogo} alt="Zotero" /></span>
      <div><b>Zotero + Nodus</b><p>{copy.body}</p></div>
    </div>
    <div className="platform-guide-feature-list">
      {[copy.detailA, copy.detailB, copy.detailC].filter(Boolean).map((detail) => <div key={detail}><Icon name="check" size={14} /><span>{detail}</span></div>)}
    </div>
    <Notice>{copy.tip}</Notice>
    <p className="platform-guide-trademark">Zotero is a trademark of the Corporation for Digital Scholarship. Nodus is independent and is not endorsed by Zotero.</p>
  </>;
}

function ToolkitPanel({ language }: { language: TutorialLanguage }) {
  const copy = COPY[language].slides[2];
  return <>
    <p>{copy.body}</p>
    <div className="platform-guide-tool-grid">
      {TOOLKIT_TOOLS.map((tool) => <div key={tool.page}><span><Icon name={tool.icon} size={17} /></span><b>{tool.name}</b></div>)}
    </div>
    <div className="platform-guide-feature-list compact">
      <div><Icon name="sparkles" size={14} /><span>{copy.detailA}</span></div>
      <div><Icon name="presentation" size={14} /><span>{copy.detailB}</span></div>
    </div>
    <Notice>{copy.tip}</Notice>
  </>;
}

export type PlatformHighlightSlide = {
  eyebrow: string;
  title: string;
  summary: string;
  icon: string;
  nodi: 'connecting' | 'discovering' | 'thinking';
  content: ReactNode;
};

export function platformHighlightSlides(language: TutorialLanguage): PlatformHighlightSlide[] {
  const [connection, zotero, toolkit] = COPY[language].slides;
  return [
    { ...connection, icon: 'link', nodi: 'connecting', content: <ConnectionPanel language={language} /> },
    { ...zotero, icon: 'book', nodi: 'discovering', content: <ZoteroPanel language={language} /> },
    { ...toolkit, icon: 'tools', nodi: 'thinking', content: <ToolkitPanel language={language} /> },
  ];
}

function shouldPresent(previousTutorialVersion: number): boolean {
  if (previousTutorialVersion <= 0 || previousTutorialVersion >= PLATFORM_HIGHLIGHTS_TUTORIAL_VERSION) return false;
  try { return localStorage.getItem(SEEN_KEY) !== '1'; } catch { return true; }
}

function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage unavailable: show again next launch */ }
}

export function PlatformHighlightsUpdateTour({
  uiLanguage,
  previousTutorialVersion,
  onSettled,
}: {
  uiLanguage: AppLanguage;
  previousTutorialVersion: number;
  onSettled: () => void;
}) {
  const [eligible] = useState(() => shouldPresent(previousTutorialVersion));
  const [index, setIndex] = useState(0);
  const copy = COPY[uiLanguage];
  const slides = useMemo(() => platformHighlightSlides(uiLanguage), [uiLanguage]);

  useEffect(() => { if (!eligible) onSettled(); }, [eligible, onSettled]);
  if (!eligible) return null;

  const slide = slides[index];
  const last = index === slides.length - 1;
  const finish = () => {
    // Deliberately written only after the user completes this runtime tour. Merely
    // installing or testing the build never pre-marks the announcement as seen.
    markSeen();
    onSettled();
  };

  return <motion.div className="toolkit-guide-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .22 }}>
    <motion.section
      className="toolkit-guide-cinema platform-guide-cinema"
      data-testid="platform-highlights-update-tour"
      data-guide-step={index}
      role="dialog"
      aria-modal="true"
      aria-labelledby="platform-guide-title"
      initial={{ opacity: 0, y: 28, scale: .96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: .46, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <header className="toolkit-guide-hero platform-guide-hero">
        <div className="toolkit-guide-aurora" aria-hidden="true" />
        <div className="toolkit-guide-hero-copy">
          <div className="toolkit-guide-kicker"><Icon name="sparkles" size={14} /> {copy.modalBadge}</div>
          <h2>{copy.modalTitle}</h2>
          <p>{copy.modalSummary}</p>
        </div>
        <div className="toolkit-guide-nodi"><NodiAvatar state={last ? 'celebrating' : slide.nodi} height={172} /></div>
      </header>
      <div className="toolkit-guide-progress" aria-label={`${index + 1}/${slides.length}`}>
        {slides.map((_, itemIndex) => <button key={itemIndex} className={itemIndex <= index ? 'active' : ''} disabled={itemIndex > index} onClick={() => setIndex(itemIndex)} aria-label={`${copy.step} ${itemIndex + 1}`} />)}
      </div>
      <div className="toolkit-guide-stage">
        <AnimatePresence mode="wait">
          <motion.article key={index} initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -22 }} transition={{ duration: .25 }}>
            <div className="toolkit-guide-eyebrow"><Icon name={slide.icon} size={15} /> {copy.step} {index + 1} {copy.of} {slides.length} · {slide.eyebrow}</div>
            <h3 id="platform-guide-title">{slide.title}</h3>
            <p className="toolkit-guide-summary">{slide.summary}</p>
            <div className="toolkit-guide-content">{slide.content}</div>
          </motion.article>
        </AnimatePresence>
      </div>
      <footer className="toolkit-guide-footer">
        <button disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}><Icon name="arrowLeft" size={14} /> {copy.previous}</button>
        {last
          ? <button className="primary" data-testid="platform-highlights-tour-complete" onClick={finish}>{copy.finish} <Icon name="check" size={14} /></button>
          : <button className="primary" onClick={() => setIndex((value) => value + 1)}>{copy.next} <Icon name="chevronRight" size={14} /></button>}
      </footer>
    </motion.section>
  </motion.div>;
}
