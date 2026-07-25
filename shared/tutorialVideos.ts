import type { TutorialLanguage } from './tutorialPreferences';
import { isVaultType, type VaultType } from './vaultTypes';

/**
 * The published video tutorials, and every string that describes them.
 *
 * The videos are streamed from YouTube rather than bundled: the installers already
 * weigh 460–939 MB, and three ~15-minute captures would add hundreds of megabytes
 * to every platform for material most users watch once. Streaming also means a new
 * tutorial reaches installed copies without a release. The written guide remains the
 * offline, network-silent path — which is what makes the video path defensible.
 *
 * The copy lives here, in the tutorial's twelve languages, instead of in the i18n
 * tables (seven UI languages) so that a reader who picked 日本語 in the cinematic
 * guide is not handed English cards. `AppLanguage` is a subset of
 * `TutorialLanguage`, so Settings can look its copy up with `settings.uiLanguage`
 * directly.
 */

export type TutorialVideoId = 'essentials' | 'academic' | 'nodi';

export interface TutorialVideo {
  /** A `TutorialVideoId` for the built-ins; any slug for entries published later. */
  id: string;
  youtubeId: string;
  /** Position in the published series, rendered as "Tutorial 1", "Tutorial 2", … */
  order: number;
  /** Icon name from the renderer's `Icon` set. */
  icon: string;
  /** Poster gradient, so a card is recognisable before anything loads. */
  poster: string;
  /** The vault whose in-app tour this video can replace, when it covers one. */
  vaultType?: VaultType;
  /**
   * Its own translations, carried by catalogue entries this build predates. Built-in
   * videos leave this unset and take their copy from the table below instead.
   */
  copy?: Partial<Record<TutorialLanguage, { title: string; body: string }>>;
}

/** Frames come from the no-cookie host; keep this in step with the CSP in index.html. */
export const TUTORIAL_VIDEO_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

export const TUTORIAL_VIDEOS: readonly TutorialVideo[] = [
  {
    id: 'essentials',
    youtubeId: 'QqSY1_DeDRM',
    order: 1,
    icon: 'network',
    poster: 'linear-gradient(140deg, #0f766e 0%, #155e75 55%, #1e1b4b 100%)',
  },
  {
    id: 'academic',
    youtubeId: 'Z-5CpJBVV_I',
    order: 2,
    icon: 'archive',
    poster: 'linear-gradient(140deg, #3730a3 0%, #1e40af 55%, #0f172a 100%)',
    vaultType: 'academic',
  },
  {
    id: 'nodi',
    youtubeId: '5OTe5CtefME',
    order: 3,
    icon: 'sparkles',
    poster: 'linear-gradient(140deg, #0369a1 0%, #4338ca 55%, #111827 100%)',
  },
];

export function tutorialVideo(id: string, videos: readonly TutorialVideo[] = TUTORIAL_VIDEOS): TutorialVideo | undefined {
  return videos.find((video) => video.id === id);
}

/** The video that covers a vault type, when one has been published for it. */
export function tutorialVideoForVault(
  type: VaultType | undefined,
  videos: readonly TutorialVideo[] = TUTORIAL_VIDEOS,
): TutorialVideo | undefined {
  if (!type) return undefined;
  return videos.find((video) => video.vaultType === type);
}

export function youtubeWatchUrl(video: TutorialVideo): string {
  return `https://www.youtube.com/watch?v=${video.youtubeId}`;
}

/**
 * Embed URL for the in-app player. `rel=0` keeps the end screen to this channel and
 * `modestbranding=1` drops the watermark; the player's own controls provide pause,
 * seeking, captions, speed and fullscreen.
 */
export function youtubeEmbedUrl(video: TutorialVideo, language: TutorialLanguage): string {
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    autoplay: '1',
    hl: language,
  });
  return `${TUTORIAL_VIDEO_EMBED_ORIGIN}/embed/${video.youtubeId}?${params.toString()}`;
}

export interface TutorialVideoCopy {
  /** Series word, rendered next to `order`. */
  tutorialWord: string;
  chooseTitle: string;
  chooseLede: string;
  videoOption: { title: string; body: string; badge: string };
  textOption: { title: string; body: string };
  gridTitle: string;
  gridLede: string;
  /** Promise that the catalogue keeps growing. Required in every language. */
  more: string;
  watched: string;
  markUnwatched: string;
  openExternal: string;
  hosting: string;
  /** Says out loud that opening the list checks the Nodus site for new tutorials. */
  catalogueNote: string;
  close: string;
  play: string;
  tourVideo: string;
  videos: Record<TutorialVideoId, { title: string; body: string }>;
}

const COPY: Record<TutorialLanguage, TutorialVideoCopy> = {
  es: {
    tutorialWord: 'Tutorial',
    chooseTitle: '¿Cómo prefieres aprender?',
    chooseLede: 'Elige cómo quieres conocer Nodus. La otra opción sigue disponible en Ajustes → Tutoriales.',
    videoOption: { title: 'Ver los tutoriales en vídeo', body: 'Tutoriales guiados que puedes pausar y ver a pantalla completa sin salir de Nodus.', badge: 'Recomendado' },
    textOption: { title: 'Leer la guía a tu ritmo', body: 'Capítulos con enlaces y avisos, dentro de la app y sin conexión.' },
    gridTitle: 'Tutoriales en vídeo',
    gridLede: 'Abre el que quieras. Se marca como visto en cuanto lo abres.',
    more: 'Más tutoriales próximamente.',
    watched: 'Visto',
    markUnwatched: 'Marcar como no visto',
    openExternal: 'Abrir en el navegador',
    hosting: 'Los vídeos están alojados en YouTube: al abrir uno, tu conexión contacta con sus servidores. La guía en texto funciona sin conexión.',
    catalogueNote: 'Al abrir esta lista, Nodus consulta en su web si hay tutoriales nuevos.',
    close: 'Cerrar',
    play: 'Ver el vídeo',
    tourVideo: 'Ver el tutorial en vídeo',
    videos: {
      essentials: { title: 'Introducción y primeros pasos', body: 'Qué es Nodus, cómo se organiza en bóvedas y qué necesitas para empezar.' },
      academic: { title: 'La bóveda académica', body: 'De tu biblioteca a un grafo de ideas, autores y relaciones.' },
      nodi: { title: 'Nodi, tu acompañante', body: 'Cómo usar a Nodi para conversar, consultar avisos y abrir la ayuda.' },
    },
  },
  en: {
    tutorialWord: 'Tutorial',
    chooseTitle: 'How do you prefer to learn?',
    chooseLede: 'Choose how you want to get to know Nodus. The other option stays available under Settings → Tutorials.',
    videoOption: { title: 'Watch the video tutorials', body: 'Guided tutorials you can pause and watch fullscreen without leaving Nodus.', badge: 'Recommended' },
    textOption: { title: 'Read the guide at your own pace', body: 'Chapters with links and warnings, inside the app and offline.' },
    gridTitle: 'Video tutorials',
    gridLede: 'Open any of them. Each is marked as watched as soon as you open it.',
    more: 'More tutorials on the way.',
    watched: 'Watched',
    markUnwatched: 'Mark as unwatched',
    openExternal: 'Open in browser',
    hosting: 'The videos are hosted on YouTube: opening one connects to its servers. The written guide works offline.',
    catalogueNote: 'Opening this list asks the Nodus website whether new tutorials have been published.',
    close: 'Close',
    play: 'Watch video',
    tourVideo: 'Watch the video tutorial',
    videos: {
      essentials: { title: 'Introduction and first steps', body: 'What Nodus is, how vaults organise it and what you need to begin.' },
      academic: { title: 'The academic vault', body: 'From your library to a graph of ideas, authors and relations.' },
      nodi: { title: 'Nodi, your companion', body: 'How to use Nodi to chat, check notifications and open help.' },
    },
  },
  fr: {
    tutorialWord: 'Tutoriel',
    chooseTitle: 'Comment préférez-vous apprendre ?',
    chooseLede: 'Choisissez comment découvrir Nodus. L’autre option reste disponible dans Réglages → Tutoriels.',
    videoOption: { title: 'Voir les tutoriels en vidéo', body: 'Des tutoriels guidés que vous pouvez mettre en pause et afficher en plein écran sans quitter Nodus.', badge: 'Recommandé' },
    textOption: { title: 'Lire le guide à votre rythme', body: 'Des chapitres avec liens et avertissements, dans l’app et hors ligne.' },
    gridTitle: 'Tutoriels vidéo',
    gridLede: 'Ouvrez celui que vous voulez. Il est marqué comme vu dès l’ouverture.',
    more: 'D’autres tutoriels arrivent bientôt.',
    watched: 'Vu',
    markUnwatched: 'Marquer comme non vu',
    openExternal: 'Ouvrir dans le navigateur',
    hosting: 'Les vidéos sont hébergées sur YouTube : en ouvrir une contacte ses serveurs. Le guide écrit fonctionne hors ligne.',
    catalogueNote: 'À l’ouverture de cette liste, Nodus demande à son site si de nouveaux tutoriels existent.',
    close: 'Fermer',
    play: 'Voir la vidéo',
    tourVideo: 'Voir le tutoriel en vidéo',
    videos: {
      essentials: { title: 'Introduction et premiers pas', body: 'Ce qu’est Nodus, comment les coffres l’organisent et ce qu’il faut pour commencer.' },
      academic: { title: 'Le coffre académique', body: 'De votre bibliothèque à un graphe d’idées, d’auteurs et de relations.' },
      nodi: { title: 'Nodi, votre compagnon', body: 'Utiliser Nodi pour discuter, consulter les avis et ouvrir l’aide.' },
    },
  },
  tr: {
    tutorialWord: 'Eğitim',
    chooseTitle: 'Nasıl öğrenmeyi tercih edersiniz?',
    chooseLede: 'Nodus’u nasıl tanımak istediğinizi seçin. Diğer seçenek Ayarlar → Eğitimler bölümünde kalır.',
    videoOption: { title: 'Video eğitimleri izle', body: 'Nodus’tan çıkmadan duraklatabileceğiniz ve tam ekranda izleyebileceğiniz rehberli eğitimler.', badge: 'Önerilen' },
    textOption: { title: 'Kılavuzu kendi hızınızda okuyun', body: 'Bağlantılar ve uyarılarla bölümler; uygulama içinde ve çevrimdışı.' },
    gridTitle: 'Video eğitimler',
    gridLede: 'İstediğinizi açın. Açtığınız anda izlendi olarak işaretlenir.',
    more: 'Yakında daha fazla eğitim.',
    watched: 'İzlendi',
    markUnwatched: 'İzlenmedi olarak işaretle',
    openExternal: 'Tarayıcıda aç',
    hosting: 'Videolar YouTube’da barındırılıyor: birini açtığınızda bağlantınız onun sunucularına gider. Yazılı kılavuz çevrimdışı çalışır.',
    catalogueNote: 'Bu listeyi açtığınızda Nodus, yeni eğitim var mı diye kendi web sitesine bakar.',
    close: 'Kapat',
    play: 'Videoyu izle',
    tourVideo: 'Eğitimi videoda izle',
    videos: {
      essentials: { title: 'Giriş ve ilk adımlar', body: 'Nodus nedir, kasalarla nasıl düzenlenir ve başlamak için ne gerekir.' },
      academic: { title: 'Akademik kasa', body: 'Kitaplığınızdan fikir, yazar ve ilişki grafiğine.' },
      nodi: { title: 'Nodi, yardımcınız', body: 'Sohbet etmek, bildirimlere bakmak ve yardımı açmak için Nodi’yi kullanma.' },
    },
  },
  de: {
    tutorialWord: 'Tutorial',
    chooseTitle: 'Wie möchten Sie lernen?',
    chooseLede: 'Wählen Sie, wie Sie Nodus kennenlernen möchten. Die andere Option bleibt unter Einstellungen → Tutorials verfügbar.',
    videoOption: { title: 'Die Video-Tutorials ansehen', body: 'Geführte Tutorials, die Sie pausieren und im Vollbild ansehen können, ohne Nodus zu verlassen.', badge: 'Empfohlen' },
    textOption: { title: 'Die Anleitung in Ihrem Tempo lesen', body: 'Kapitel mit Links und Hinweisen, in der App und offline.' },
    gridTitle: 'Video-Tutorials',
    gridLede: 'Öffnen Sie eines davon. Es wird beim Öffnen als gesehen markiert.',
    more: 'Weitere Tutorials folgen bald.',
    watched: 'Gesehen',
    markUnwatched: 'Als nicht gesehen markieren',
    openExternal: 'Im Browser öffnen',
    hosting: 'Die Videos liegen auf YouTube: Wenn Sie eines öffnen, verbindet sich Ihr Gerät mit dessen Servern. Die schriftliche Anleitung funktioniert offline.',
    catalogueNote: 'Beim Öffnen dieser Liste fragt Nodus auf seiner Website nach neuen Tutorials.',
    close: 'Schließen',
    play: 'Video ansehen',
    tourVideo: 'Das Tutorial als Video ansehen',
    videos: {
      essentials: { title: 'Einführung und erste Schritte', body: 'Was Nodus ist, wie Vaults es ordnen und was Sie zum Start brauchen.' },
      academic: { title: 'Der akademische Vault', body: 'Von Ihrer Bibliothek zu einem Graphen aus Ideen, Autoren und Beziehungen.' },
      nodi: { title: 'Nodi, Ihre Begleitung', body: 'Wie Sie mit Nodi chatten, Hinweise sehen und die Hilfe öffnen.' },
    },
  },
  it: {
    tutorialWord: 'Tutorial',
    chooseTitle: 'Come preferisci imparare?',
    chooseLede: 'Scegli come conoscere Nodus. L’altra opzione resta disponibile in Impostazioni → Tutorial.',
    videoOption: { title: 'Guarda i tutorial video', body: 'Tutorial guidati che puoi mettere in pausa e vedere a schermo intero senza uscire da Nodus.', badge: 'Consigliato' },
    textOption: { title: 'Leggi la guida al tuo ritmo', body: 'Capitoli con link e avvisi, dentro l’app e offline.' },
    gridTitle: 'Tutorial video',
    gridLede: 'Apri quello che vuoi. Viene segnato come visto appena lo apri.',
    more: 'Altri tutorial in arrivo.',
    watched: 'Visto',
    markUnwatched: 'Segna come non visto',
    openExternal: 'Apri nel browser',
    hosting: 'I video sono ospitati su YouTube: aprirne uno contatta i suoi server. La guida scritta funziona offline.',
    catalogueNote: 'Aprendo questa lista, Nodus chiede al proprio sito se ci sono nuovi tutorial.',
    close: 'Chiudi',
    play: 'Guarda il video',
    tourVideo: 'Guarda il tutorial in video',
    videos: {
      essentials: { title: 'Introduzione e primi passi', body: 'Che cos’è Nodus, come i vault lo organizzano e cosa serve per iniziare.' },
      academic: { title: 'Il vault accademico', body: 'Dalla tua biblioteca a un grafo di idee, autori e relazioni.' },
      nodi: { title: 'Nodi, il tuo compagno', body: 'Come usare Nodi per conversare, vedere gli avvisi e aprire la guida.' },
    },
  },
  pt: {
    tutorialWord: 'Tutorial',
    chooseTitle: 'Como prefere aprender?',
    chooseLede: 'Escolha como quer conhecer o Nodus. A outra opção continua disponível em Definições → Tutoriais.',
    videoOption: { title: 'Ver os tutoriais em vídeo', body: 'Tutoriais guiados que pode pausar e ver em ecrã inteiro sem sair do Nodus.', badge: 'Recomendado' },
    textOption: { title: 'Ler o guia ao seu ritmo', body: 'Capítulos com ligações e avisos, dentro da app e sem ligação.' },
    gridTitle: 'Tutoriais em vídeo',
    gridLede: 'Abra o que quiser. Fica marcado como visto assim que o abre.',
    more: 'Mais tutoriais em breve.',
    watched: 'Visto',
    markUnwatched: 'Marcar como não visto',
    openExternal: 'Abrir no navegador',
    hosting: 'Os vídeos estão alojados no YouTube: ao abrir um, a sua ligação contacta os servidores dele. O guia escrito funciona sem ligação.',
    catalogueNote: 'Ao abrir esta lista, o Nodus consulta o seu site para ver se há tutoriais novos.',
    close: 'Fechar',
    play: 'Ver o vídeo',
    tourVideo: 'Ver o tutorial em vídeo',
    videos: {
      essentials: { title: 'Introdução e primeiros passos', body: 'O que é o Nodus, como os cofres o organizam e o que precisa para começar.' },
      academic: { title: 'O cofre académico', body: 'Da sua biblioteca a um grafo de ideias, autores e relações.' },
      nodi: { title: 'Nodi, o seu companheiro', body: 'Como usar o Nodi para conversar, ver avisos e abrir a ajuda.' },
    },
  },
  'pt-BR': {
    tutorialWord: 'Tutorial',
    chooseTitle: 'Como você prefere aprender?',
    chooseLede: 'Escolha como quer conhecer o Nodus. A outra opção continua disponível em Configurações → Tutoriais.',
    videoOption: { title: 'Assistir aos tutoriais em vídeo', body: 'Tutoriais guiados que você pode pausar e ver em tela cheia sem sair do Nodus.', badge: 'Recomendado' },
    textOption: { title: 'Ler o guia no seu ritmo', body: 'Capítulos com links e avisos, dentro do app e offline.' },
    gridTitle: 'Tutoriais em vídeo',
    gridLede: 'Abra o que quiser. Ele é marcado como visto assim que você abre.',
    more: 'Mais tutoriais em breve.',
    watched: 'Visto',
    markUnwatched: 'Marcar como não visto',
    openExternal: 'Abrir no navegador',
    hosting: 'Os vídeos ficam no YouTube: ao abrir um, sua conexão fala com os servidores dele. O guia escrito funciona offline.',
    catalogueNote: 'Ao abrir esta lista, o Nodus consulta o site dele para ver se há tutoriais novos.',
    close: 'Fechar',
    play: 'Assistir ao vídeo',
    tourVideo: 'Assistir ao tutorial em vídeo',
    videos: {
      essentials: { title: 'Introdução e primeiros passos', body: 'O que é o Nodus, como os cofres organizam tudo e o que você precisa para começar.' },
      academic: { title: 'O cofre acadêmico', body: 'Da sua biblioteca a um grafo de ideias, autores e relações.' },
      nodi: { title: 'Nodi, seu companheiro', body: 'Como usar o Nodi para conversar, ver avisos e abrir a ajuda.' },
    },
  },
  zh: {
    tutorialWord: '教程',
    chooseTitle: '你想怎么上手？',
    chooseLede: '选择你想了解 Nodus 的方式。另一种方式随时可在「设置 → 教程」中使用。',
    videoOption: { title: '观看视频教程', body: '可暂停、可全屏的引导教程，无需离开 Nodus。', badge: '推荐' },
    textOption: { title: '按自己的节奏阅读指南', body: '带链接和提示的章节，在应用内，离线也能读。' },
    gridTitle: '视频教程',
    gridLede: '想看哪个就打开。打开后会自动标记为已看。',
    more: '更多教程即将推出。',
    watched: '已看',
    markUnwatched: '标记为未看',
    openExternal: '在浏览器中打开',
    hosting: '视频托管在 YouTube：打开任一视频都会连接其服务器。文字指南可离线使用。',
    catalogueNote: '打开这份列表时，Nodus 会向自己的网站查询是否有新教程。',
    close: '关闭',
    play: '观看视频',
    tourVideo: '观看视频教程',
    videos: {
      essentials: { title: '介绍与第一步', body: 'Nodus 是什么、资料库如何组织，以及开始前需要准备什么。' },
      academic: { title: '学术资料库', body: '把你的文献库变成想法、作者与关系的图谱。' },
      nodi: { title: '认识 Nodi', body: '用 Nodi 聊天、查看提醒并打开帮助。' },
    },
  },
  ja: {
    tutorialWord: 'チュートリアル',
    chooseTitle: 'どの方法で学びますか？',
    chooseLede: 'Nodusを知る方法を選んでください。もう一方は「設定 → チュートリアル」からいつでも使えます。',
    videoOption: { title: '動画チュートリアルを見る', body: '一時停止も全画面もできるガイド付き動画。Nodusを離れずに視聴できます。', badge: 'おすすめ' },
    textOption: { title: '自分のペースでガイドを読む', body: 'リンクと注意書きのある章立て。アプリ内で、オフラインでも読めます。' },
    gridTitle: '動画チュートリアル',
    gridLede: '好きなものを開いてください。開いた時点で視聴済みになります。',
    more: 'チュートリアルは今後も追加されます。',
    watched: '視聴済み',
    markUnwatched: '未視聴にする',
    openExternal: 'ブラウザーで開く',
    hosting: '動画はYouTubeにあります。開くとそのサーバーに接続します。文章のガイドはオフラインでも使えます。',
    catalogueNote: 'このリストを開くと、Nodusは自身のサイトに新しいチュートリアルがあるか問い合わせます。',
    close: '閉じる',
    play: '動画を見る',
    tourVideo: 'チュートリアルを動画で見る',
    videos: {
      essentials: { title: '紹介と最初の一歩', body: 'Nodusとは何か、Vaultでどう整理するか、始めるために必要なもの。' },
      academic: { title: 'アカデミックVault', body: '蔵書から、アイデア・著者・関係のグラフへ。' },
      nodi: { title: '相棒のNodi', body: 'Nodiで会話し、通知を確認し、ヘルプを開く方法。' },
    },
  },
  ru: {
    tutorialWord: 'Урок',
    chooseTitle: 'Как вам удобнее учиться?',
    chooseLede: 'Выберите, как познакомиться с Nodus. Второй вариант всегда доступен в «Настройки → Обучение».',
    videoOption: { title: 'Смотреть видеоуроки', body: 'Уроки с пояснениями: можно ставить на паузу и открывать на весь экран, не выходя из Nodus.', badge: 'Рекомендуем' },
    textOption: { title: 'Читать руководство в своём темпе', body: 'Главы со ссылками и предупреждениями — в приложении и офлайн.' },
    gridTitle: 'Видеоуроки',
    gridLede: 'Откройте любой. Он отмечается как просмотренный сразу при открытии.',
    more: 'Скоро будут новые уроки.',
    watched: 'Просмотрен',
    markUnwatched: 'Отметить как непросмотренный',
    openExternal: 'Открыть в браузере',
    hosting: 'Видео размещены на YouTube: при открытии устройство соединяется с его серверами. Текстовое руководство работает офлайн.',
    catalogueNote: 'При открытии этого списка Nodus запрашивает у своего сайта, появились ли новые уроки.',
    close: 'Закрыть',
    play: 'Смотреть видео',
    tourVideo: 'Посмотреть урок в видео',
    videos: {
      essentials: { title: 'Знакомство и первые шаги', body: 'Что такое Nodus, как хранилища его организуют и что нужно для начала.' },
      academic: { title: 'Академическое хранилище', body: 'От вашей библиотеки к графу идей, авторов и связей.' },
      nodi: { title: 'Ноди, ваш помощник', body: 'Как общаться с Ноди, смотреть уведомления и открывать справку.' },
    },
  },
  uk: {
    tutorialWord: 'Урок',
    chooseTitle: 'Як вам зручніше вчитися?',
    chooseLede: 'Виберіть, як познайомитися з Nodus. Другий варіант завжди доступний у «Налаштування → Навчання».',
    videoOption: { title: 'Дивитися відеоуроки', body: 'Уроки з поясненнями: можна ставити на паузу й відкривати на весь екран, не виходячи з Nodus.', badge: 'Рекомендуємо' },
    textOption: { title: 'Читати посібник у своєму темпі', body: 'Розділи з посиланнями та застереженнями — у застосунку й офлайн.' },
    gridTitle: 'Відеоуроки',
    gridLede: 'Відкрийте будь-який. Він позначається як переглянутий одразу після відкриття.',
    more: 'Скоро з’являться нові уроки.',
    watched: 'Переглянуто',
    markUnwatched: 'Позначити як непереглянутий',
    openExternal: 'Відкрити у браузері',
    hosting: 'Відео розміщені на YouTube: коли ви відкриваєте одне з них, ваш пристрій з’єднується з його серверами. Текстовий посібник працює офлайн.',
    catalogueNote: 'Коли ви відкриваєте цей список, Nodus запитує на своєму сайті, чи з’явилися нові уроки.',
    close: 'Закрити',
    play: 'Дивитися відео',
    tourVideo: 'Подивитися урок у відео',
    videos: {
      essentials: { title: 'Знайомство та перші кроки', body: 'Що таке Nodus, як сховища його впорядковують і що потрібно для початку.' },
      academic: { title: 'Академічне сховище', body: 'Від вашої бібліотеки до графа ідей, авторів і зв’язків.' },
      nodi: { title: 'Ноді, ваш помічник', body: 'Як спілкуватися з Ноді, дивитися повідомлення й відкривати довідку.' },
    },
  },
};

export function tutorialVideoCopy(language: TutorialLanguage): TutorialVideoCopy {
  return COPY[language] ?? COPY.en;
}

/** Every language this build can serve, in the order the guide offers them. */
export const TUTORIAL_COPY_LANGUAGES = Object.keys(COPY) as TutorialLanguage[];

/** A video's title and description, wherever they come from. */
export function videoCopyFor(video: TutorialVideo, language: TutorialLanguage): { title: string; body: string } {
  if (video.copy) {
    const own = video.copy[language] ?? video.copy.en ?? Object.values(video.copy)[0];
    if (own) return own;
  }
  const table = tutorialVideoCopy(language).videos as Record<string, { title: string; body: string } | undefined>;
  // The slug is a poor title, but a card with no title at all is worse — and this is
  // only reachable for a catalogue entry that shipped without any copy.
  return table[video.id] ?? { title: video.id, body: '' };
}

// ── the list, refreshable without shipping a release ────────────────────────────
//
// The three videos above are compiled in, so the grid renders instantly and offline.
// A published catalogue can add to them: the app asks for it from the MAIN process
// when a grid is opened (never at startup, and never from the renderer, which would
// mean widening the CSP for a second remote host).
//
// Everything in that file is untrusted input from the network, so it is validated
// rather than trusted: ids are slugs, video ids must have YouTube's exact shape (no
// arbitrary URL can be smuggled in), and posters are NOT taken from it at all — a
// remote CSS value in a `style` attribute could fetch a remote image and undo the
// promise that an unopened grid makes no requests.

export const TUTORIAL_CATALOGUE_URL = 'https://drakonis96.github.io/nodus/tutorials.json';

const YOUTUBE_ID_SHAPE = /^[A-Za-z0-9_-]{11}$/;
const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Icons a catalogue entry may pick; anything else falls back to the play glyph. */
const CATALOGUE_ICONS = ['play', 'network', 'archive', 'sparkles', 'graduation', 'layers', 'tree', 'table', 'chartBar', 'microphone', 'image', 'tools', 'star'];
/** Posters handed out, in order, to entries this build knows nothing about. */
const CATALOGUE_POSTERS = [
  'linear-gradient(140deg, #155e75 0%, #1e3a8a 55%, #111827 100%)',
  'linear-gradient(140deg, #6d28d9 0%, #1e3a8a 55%, #0f172a 100%)',
  'linear-gradient(140deg, #0f766e 0%, #3730a3 55%, #111827 100%)',
  'linear-gradient(140deg, #9d174d 0%, #4338ca 55%, #0f172a 100%)',
];

const MAX_CATALOGUE_ENTRIES = 40;
const MAX_TITLE = 120;
const MAX_BODY = 320;

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function parseEntryCopy(value: unknown): TutorialVideo['copy'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const copy: NonNullable<TutorialVideo['copy']> = {};
  for (const [language, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!TUTORIAL_COPY_LANGUAGES.includes(language as TutorialLanguage)) continue;
    if (!entry || typeof entry !== 'object') continue;
    const title = cleanString((entry as Record<string, unknown>).title, MAX_TITLE);
    const body = cleanString((entry as Record<string, unknown>).body, MAX_BODY);
    if (!title || !body) continue;
    copy[language as TutorialLanguage] = { title, body };
  }
  return Object.keys(copy).length > 0 ? copy : null;
}

function parseEntry(value: unknown, index: number): TutorialVideo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const id = typeof entry.id === 'string' && SLUG_SHAPE.test(entry.id) ? entry.id : null;
  const youtubeId = typeof entry.youtubeId === 'string' && YOUTUBE_ID_SHAPE.test(entry.youtubeId) ? entry.youtubeId : null;
  if (!id || !youtubeId) return null;
  const order = typeof entry.order === 'number' && Number.isFinite(entry.order) ? entry.order : index + 1;
  const builtIn = TUTORIAL_VIDEOS.find((video) => video.id === id);
  const copy = parseEntryCopy(entry.copy);
  // A brand-new entry with no usable copy would render as a bare slug: drop it.
  if (!builtIn && !copy) return null;
  return {
    id,
    youtubeId,
    order,
    icon: typeof entry.icon === 'string' && CATALOGUE_ICONS.includes(entry.icon) ? entry.icon : builtIn?.icon ?? 'play',
    poster: builtIn?.poster ?? CATALOGUE_POSTERS[index % CATALOGUE_POSTERS.length],
    ...(isVaultType(entry.vaultType) ? { vaultType: entry.vaultType } : builtIn?.vaultType ? { vaultType: builtIn.vaultType } : {}),
    ...(copy ? { copy } : {}),
  };
}

export interface TutorialCatalogueParse {
  videos: TutorialVideo[];
  /** Entries thrown away for failing validation. Logged, never silently swallowed. */
  rejected: number;
}

export function parseTutorialCatalogue(raw: unknown): TutorialCatalogueParse {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { videos?: unknown }).videos)
      ? ((raw as { videos: unknown[] }).videos)
      : null;
  if (!list) return { videos: [], rejected: 0 };
  const videos: TutorialVideo[] = [];
  let rejected = 0;
  for (const [index, item] of list.slice(0, MAX_CATALOGUE_ENTRIES).entries()) {
    const parsed = parseEntry(item, index);
    if (parsed && !videos.some((video) => video.id === parsed.id)) videos.push(parsed);
    else rejected += 1;
  }
  return { videos, rejected };
}

/**
 * Built-in list plus whatever the catalogue adds, ordered by `order`.
 *
 * A published entry can update a built-in video's copy or its vault, but it can never
 * make one disappear: a truncated or half-written file must not hide the tutorial a
 * user is looking for. Retiring a video is rare enough to ride a release.
 */
export function mergeTutorialCatalogue(remote: readonly TutorialVideo[]): TutorialVideo[] {
  const merged = new Map<string, TutorialVideo>();
  for (const video of TUTORIAL_VIDEOS) merged.set(video.id, video);
  for (const video of remote) merged.set(video.id, { ...merged.get(video.id), ...video });
  return [...merged.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
