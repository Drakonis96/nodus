const KEYS = [
  'Comprender tus obras completas',
  'Nodus puede analizar cada obra completa por secciones y construir una ficha jerárquica auditada de su tesis, método, estructura y conceptos principales.',
  'Qué mejora',
  'Selecciona mejor qué obras consultar antes de buscar ideas y pasajes.',
  'Añade contexto global a Chat, Nodi, Deep Research e Immersion sin sustituir las ideas ni sus relaciones.',
  'Mantiene la trazabilidad: las respuestas siguen citando el texto original, nunca la ficha generada.',
  'Antes de empezar',
  'El primer análisis de un vault grande puede tardar y utilizará los proveedores de IA y embeddings que tengas configurados. Se ejecuta en segundo plano, puede pausarse y omite las obras que ya estén actualizadas.',
  'Analizar automáticamente las obras nuevas',
  'Analizar mi vault ahora',
  'Ahora no',
  'Podrás activarlo más adelante desde Biblioteca → Índice documental o desde Ajustes → Biblioteca.',
  'No se pudo iniciar el análisis documental. Revisa los modelos configurados e inténtalo desde la Biblioteca.',
] as const;

function table(values: readonly string[]): Record<string, string> {
  if (values.length !== KEYS.length) throw new Error('Document-understanding consent translations are incomplete.');
  return Object.fromEntries(KEYS.map((key, index) => [key, values[index]]));
}

const en = table([
  'Understand your complete works',
  'Nodus can analyze each complete work section by section and build an audited hierarchical profile of its thesis, method, structure, and main concepts.',
  'What improves',
  'It chooses which works to consult more accurately before searching ideas and passages.',
  'It adds global context to Chat, Nodi, Deep Research, and Immersion without replacing ideas or their relationships.',
  'Traceability remains intact: answers still cite the original text, never the generated profile.',
  'Before you start',
  'The first analysis of a large vault can take time and will use your configured AI and embedding providers. It runs in the background, can be paused, and skips works that are already up to date.',
  'Analyze new works automatically', 'Analyze my vault now', 'Not now',
  'You can enable it later from Library → Document index or Settings → Library.',
  'Document analysis could not be started. Check the configured models and try again from Library.',
]);
const fr = table([
  'Comprendre vos œuvres complètes',
  'Nodus peut analyser chaque œuvre complète section par section et créer une fiche hiérarchique auditée de sa thèse, sa méthode, sa structure et ses principaux concepts.',
  'Ce qui s’améliore',
  'Il sélectionne plus précisément les œuvres à consulter avant de rechercher des idées et des passages.',
  'Il ajoute un contexte global à Chat, Nodi, Deep Research et Immersion sans remplacer les idées ni leurs relations.',
  'La traçabilité reste intacte : les réponses citent toujours le texte original, jamais la fiche générée.',
  'Avant de commencer',
  'La première analyse d’un grand coffre peut prendre du temps et utilisera vos fournisseurs d’IA et d’embeddings configurés. Elle s’exécute en arrière-plan, peut être suspendue et ignore les œuvres déjà à jour.',
  'Analyser automatiquement les nouvelles œuvres', 'Analyser mon coffre maintenant', 'Pas maintenant',
  'Vous pourrez l’activer plus tard depuis Bibliothèque → Index documentaire ou Réglages → Bibliothèque.',
  'Impossible de démarrer l’analyse documentaire. Vérifiez les modèles configurés et réessayez depuis la Bibliothèque.',
]);
const de = table([
  'Vollständige Werke verstehen',
  'Nodus kann jedes vollständige Werk abschnittsweise analysieren und ein geprüftes hierarchisches Profil seiner These, Methode, Struktur und Hauptbegriffe erstellen.',
  'Was sich verbessert',
  'Vor der Suche nach Ideen und Passagen werden die passenden Werke genauer ausgewählt.',
  'Chat, Nodi, Deep Research und Immersion erhalten globalen Kontext, ohne Ideen oder ihre Beziehungen zu ersetzen.',
  'Die Nachvollziehbarkeit bleibt erhalten: Antworten zitieren weiterhin den Originaltext, niemals das erzeugte Profil.',
  'Vor dem Start',
  'Die erste Analyse eines großen Vaults kann dauern und nutzt die konfigurierten KI- und Embedding-Anbieter. Sie läuft im Hintergrund, kann pausiert werden und überspringt bereits aktuelle Werke.',
  'Neue Werke automatisch analysieren', 'Meinen Vault jetzt analysieren', 'Jetzt nicht',
  'Du kannst dies später unter Bibliothek → Dokumentindex oder Einstellungen → Bibliothek aktivieren.',
  'Die Dokumentanalyse konnte nicht gestartet werden. Prüfe die konfigurierten Modelle und versuche es erneut in der Bibliothek.',
]);
const pt = table([
  'Compreender as suas obras completas',
  'O Nodus pode analisar cada obra completa por secções e criar uma ficha hierárquica auditada da sua tese, método, estrutura e conceitos principais.',
  'O que melhora',
  'Seleciona com maior precisão as obras a consultar antes de procurar ideias e passagens.',
  'Acrescenta contexto global ao Chat, Nodi, Deep Research e Immersion sem substituir as ideias nem as suas relações.',
  'A rastreabilidade mantém-se: as respostas continuam a citar o texto original, nunca a ficha gerada.',
  'Antes de começar',
  'A primeira análise de um cofre grande pode demorar e utilizará os fornecedores de IA e embeddings configurados. É executada em segundo plano, pode ser pausada e ignora obras já atualizadas.',
  'Analisar automaticamente novas obras', 'Analisar o meu cofre agora', 'Agora não',
  'Poderá ativar esta opção mais tarde em Biblioteca → Índice documental ou Ajustes → Biblioteca.',
  'Não foi possível iniciar a análise documental. Verifique os modelos configurados e tente novamente na Biblioteca.',
]);
const ptBR = table([
  'Compreender suas obras completas',
  'O Nodus pode analisar cada obra completa por seções e criar uma ficha hierárquica auditada de sua tese, método, estrutura e conceitos principais.',
  'O que melhora',
  'Seleciona com mais precisão quais obras consultar antes de buscar ideias e trechos.',
  'Adiciona contexto global ao Chat, Nodi, Deep Research e Immersion sem substituir as ideias nem suas relações.',
  'A rastreabilidade permanece intacta: as respostas continuam citando o texto original, nunca a ficha gerada.',
  'Antes de começar',
  'A primeira análise de um vault grande pode demorar e usará os provedores de IA e embeddings configurados. É executada em segundo plano, pode ser pausada e ignora obras já atualizadas.',
  'Analisar automaticamente novas obras', 'Analisar meu vault agora', 'Agora não',
  'Você poderá ativar depois em Biblioteca → Índice documental ou Ajustes → Biblioteca.',
  'Não foi possível iniciar a análise documental. Verifique os modelos configurados e tente novamente na Biblioteca.',
]);
const it = table([
  'Comprendere le opere complete',
  'Nodus può analizzare ogni opera completa sezione per sezione e creare una scheda gerarchica verificata della tesi, del metodo, della struttura e dei concetti principali.',
  'Cosa migliora',
  'Seleziona con maggiore precisione le opere da consultare prima di cercare idee e passaggi.',
  'Aggiunge contesto globale a Chat, Nodi, Deep Research e Immersion senza sostituire le idee o le loro relazioni.',
  'La tracciabilità resta intatta: le risposte continuano a citare il testo originale, mai la scheda generata.',
  'Prima di iniziare',
  'La prima analisi di un vault grande può richiedere tempo e userà i provider di IA ed embedding configurati. Viene eseguita in background, può essere sospesa e salta le opere già aggiornate.',
  'Analizza automaticamente le nuove opere', 'Analizza il mio vault ora', 'Non ora',
  'Potrai attivarla in seguito da Biblioteca → Indice documentale o Impostazioni → Biblioteca.',
  'Impossibile avviare l’analisi documentale. Controlla i modelli configurati e riprova dalla Biblioteca.',
]);
const tr = table([
  'Tam eserlerinizi kavrayın',
  'Nodus her tam eseri bölüm bölüm analiz ederek tezini, yöntemini, yapısını ve ana kavramlarını içeren denetlenmiş hiyerarşik bir profil oluşturabilir.',
  'Neler iyileşir',
  'Fikir ve pasaj aramadan önce hangi eserlerin inceleneceğini daha doğru seçer.',
  'Fikirlerin ve ilişkilerinin yerini almadan Chat, Nodi, Deep Research ve Immersion’a genel bağlam ekler.',
  'İzlenebilirlik korunur: yanıtlar oluşturulan profili değil, özgün metni alıntılamayı sürdürür.',
  'Başlamadan önce',
  'Büyük bir vault’un ilk analizi zaman alabilir ve yapılandırılmış yapay zekâ ile embedding sağlayıcılarını kullanır. Arka planda çalışır, duraklatılabilir ve güncel eserleri atlar.',
  'Yeni eserleri otomatik analiz et', 'Vault’umu şimdi analiz et', 'Şimdi değil',
  'Daha sonra Kütüphane → Belge indeksi veya Ayarlar → Kütüphane bölümünden etkinleştirebilirsiniz.',
  'Belge analizi başlatılamadı. Yapılandırılmış modelleri kontrol edip Kütüphane’den yeniden deneyin.',
]);

export const DOCUMENT_UNDERSTANDING_CONSENT_TRANSLATIONS = { en, fr, de, pt, 'pt-BR': ptBR, it, tr } as const;
