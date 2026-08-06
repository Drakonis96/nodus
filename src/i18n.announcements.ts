/**
 * The notification centre's chrome: the header button, the two section headings and the
 * announcement controls, plus the two settings cards that moved here.
 *
 * Only the chrome. The announcements themselves carry their own copy per language (see
 * shared/announcements.ts) because they are published after the build that shows them,
 * so there is no key here for t() to look up.
 */
export const ANNOUNCEMENT_TRANSLATIONS = {
  en: {
    'Avisos de Nodus y actividad reciente': 'Nodus announcements and recent activity',
    'Avisos de Nodus': 'Nodus announcements',
    'Actividad': 'Activity',
    'Abrir enlace': 'Open link',
    'Recibir avisos': 'Receive announcements',
    'Avisos publicados entre versiones (encuestas, incidencias conocidas, cambios importantes). Se consulta un archivo público cada cuatro horas, sin enviar ningún identificador ni dato de tu bóveda. Al desactivarlo, Nodus deja de hacer esa consulta.': 'Announcements published between releases (surveys, known issues, important changes). A public file is checked every four hours, without sending any identifier or any data from your vault. Turn this off and Nodus stops making that request.',
    'Consulta qué está en desarrollo, qué está planificado y qué ya se ha implementado. El roadmap no atribuye fechas ni versiones.': 'See what is in development, what is planned and what has already shipped. The roadmap assigns neither dates nor versions.',
  },
  fr: {
    'Avisos de Nodus y actividad reciente': 'Annonces de Nodus et activité récente',
    'Avisos de Nodus': 'Annonces de Nodus',
    'Actividad': 'Activité',
    'Abrir enlace': 'Ouvrir le lien',
    'Recibir avisos': 'Recevoir les annonces',
    'Avisos publicados entre versiones (encuestas, incidencias conocidas, cambios importantes). Se consulta un archivo público cada cuatro horas, sin enviar ningún identificador ni dato de tu bóveda. Al desactivarlo, Nodus deja de hacer esa consulta.': 'Annonces publiées entre deux versions (enquêtes, incidents connus, changements importants). Un fichier public est consulté toutes les quatre heures, sans envoyer d’identifiant ni aucune donnée de votre coffre. Si vous le désactivez, Nodus cesse d’effectuer cette requête.',
    'Consulta qué está en desarrollo, qué está planificado y qué ya se ha implementado. El roadmap no atribuye fechas ni versiones.': 'Consultez ce qui est en développement, ce qui est prévu et ce qui existe déjà. La feuille de route n’attribue ni dates ni versions.',
  },
  de: {
    'Avisos de Nodus y actividad reciente': 'Nodus-Mitteilungen und letzte Aktivität',
    'Avisos de Nodus': 'Nodus-Mitteilungen',
    'Actividad': 'Aktivität',
    'Abrir enlace': 'Link öffnen',
    'Recibir avisos': 'Mitteilungen erhalten',
    'Avisos publicados entre versiones (encuestas, incidencias conocidas, cambios importantes). Se consulta un archivo público cada cuatro horas, sin enviar ningún identificador ni dato de tu bóveda. Al desactivarlo, Nodus deja de hacer esa consulta.': 'Mitteilungen, die zwischen zwei Versionen veröffentlicht werden (Umfragen, bekannte Probleme, wichtige Änderungen). Alle vier Stunden wird eine öffentliche Datei abgefragt, ohne eine Kennung oder Daten aus deinem Tresor zu senden. Wenn du das ausschaltest, stellt Nodus diese Anfrage nicht mehr.',
    'Consulta qué está en desarrollo, qué está planificado y qué ya se ha implementado. El roadmap no atribuye fechas ni versiones.': 'Sieh nach, was in Entwicklung ist, was geplant ist und was es schon gibt. Die Roadmap nennt weder Daten noch Versionen.',
  },
  pt: {
    'Avisos de Nodus y actividad reciente': 'Avisos do Nodus e atividade recente',
    'Avisos de Nodus': 'Avisos do Nodus',
    'Actividad': 'Atividade',
    'Abrir enlace': 'Abrir ligação',
    'Recibir avisos': 'Receber avisos',
    'Avisos publicados entre versiones (encuestas, incidencias conocidas, cambios importantes). Se consulta un archivo público cada cuatro horas, sin enviar ningún identificador ni dato de tu bóveda. Al desactivarlo, Nodus deja de hacer esa consulta.': 'Avisos publicados entre versões (inquéritos, incidentes conhecidos, alterações importantes). É consultado um ficheiro público a cada quatro horas, sem enviar qualquer identificador nem dados do teu cofre. Ao desativar, o Nodus deixa de fazer essa consulta.',
    'Consulta qué está en desarrollo, qué está planificado y qué ya se ha implementado. El roadmap no atribuye fechas ni versiones.': 'Consulta o que está em desenvolvimento, o que está planeado e o que já foi implementado. O roadmap não atribui datas nem versões.',
  },
  'pt-BR': {
    'Avisos de Nodus y actividad reciente': 'Avisos do Nodus e atividade recente',
    'Avisos de Nodus': 'Avisos do Nodus',
    'Actividad': 'Atividade',
    'Abrir enlace': 'Abrir link',
    'Recibir avisos': 'Receber avisos',
    'Avisos publicados entre versiones (encuestas, incidencias conocidas, cambios importantes). Se consulta un archivo público cada cuatro horas, sin enviar ningún identificador ni dato de tu bóveda. Al desactivarlo, Nodus deja de hacer esa consulta.': 'Avisos publicados entre versões (pesquisas, problemas conhecidos, mudanças importantes). Um arquivo público é consultado a cada quatro horas, sem enviar nenhum identificador nem dados do seu cofre. Ao desativar, o Nodus para de fazer essa consulta.',
    'Consulta qué está en desarrollo, qué está planificado y qué ya se ha implementado. El roadmap no atribuye fechas ni versiones.': 'Veja o que está em desenvolvimento, o que está planejado e o que já foi implementado. O roadmap não atribui datas nem versões.',
  },
  it: {
    'Avisos de Nodus y actividad reciente': 'Avvisi di Nodus e attività recente',
    'Avisos de Nodus': 'Avvisi di Nodus',
    'Actividad': 'Attività',
    'Abrir enlace': 'Apri il link',
    'Recibir avisos': 'Ricevi gli avvisi',
    'Avisos publicados entre versiones (encuestas, incidencias conocidas, cambios importantes). Se consulta un archivo público cada cuatro horas, sin enviar ningún identificador ni dato de tu bóveda. Al desactivarlo, Nodus deja de hacer esa consulta.': 'Avvisi pubblicati tra una versione e l’altra (sondaggi, problemi noti, modifiche importanti). Ogni quattro ore viene consultato un file pubblico, senza inviare alcun identificativo né dati del tuo vault. Se lo disattivi, Nodus smette di fare quella richiesta.',
    'Consulta qué está en desarrollo, qué está planificado y qué ya se ha implementado. El roadmap no atribuye fechas ni versiones.': 'Scopri cosa è in sviluppo, cosa è pianificato e cosa esiste già. La roadmap non indica date né versioni.',
  },
  tr: {
    'Avisos de Nodus y actividad reciente': 'Nodus duyuruları ve son etkinlikler',
    'Avisos de Nodus': 'Nodus duyuruları',
    'Actividad': 'Etkinlik',
    'Abrir enlace': 'Bağlantıyı aç',
    'Recibir avisos': 'Duyuruları al',
    'Avisos publicados entre versiones (encuestas, incidencias conocidas, cambios importantes). Se consulta un archivo público cada cuatro horas, sin enviar ningún identificador ni dato de tu bóveda. Al desactivarlo, Nodus deja de hacer esa consulta.': 'Sürümler arasında yayımlanan duyurular (anketler, bilinen sorunlar, önemli değişiklikler). Dört saatte bir herkese açık bir dosya kontrol edilir; hiçbir tanımlayıcı ya da kasanızdan veri gönderilmez. Bunu kapattığınızda Nodus bu isteği yapmayı bırakır.',
    'Consulta qué está en desarrollo, qué está planificado y qué ya se ha implementado. El roadmap no atribuye fechas ni versiones.': 'Neyin geliştirilmekte olduğunu, neyin planlandığını ve neyin hazır olduğunu görün. Yol haritası tarih ya da sürüm belirtmez.',
  },
};
