import { getActiveLang } from "./i18n";
import { FR as LEGACY_FR } from "./i18n.fr";
import { DE as LEGACY_DE } from "./i18n.de";
import { PT as LEGACY_PT } from "./i18n.pt";
import { PT_BR as LEGACY_PT_BR } from "./i18n.pt-BR";
import { IT as LEGACY_IT } from "./i18n.it";
import { TR as LEGACY_TR } from "./i18n.tr";

/** Compass copy is kept in a feature slice so the view can ship independently of
 * the large legacy language tables. Spanish is the source language used by Nodus. */
const EN: Record<string, string> = {
  "Nodus Compass": "Nodus Compass",
  "Descubre literatura académica en fuentes abiertas.":
    "Discover academic literature across open sources.",
  "Buscar literatura": "Search literature",
  Buscar: "Search",
  "Limpiar resultados": "Clear results",
  "Interpretar con IA": "Interpret with AI",
  Filtros: "Filters",
  "Limpiar filtros": "Clear filters",
  Desde: "From",
  Hasta: "To",
  Idioma: "Language",
  Tipo: "Type",
  Disciplina: "Discipline",
  Proveedor: "Provider",
  "Solo acceso abierto": "Open access only",
  Relevancia: "Relevance",
  Fecha: "Date",
  Citas: "Citations",
  "Cargar más": "Load more",
  "Seleccionar página": "Select page",
  "Importar selección": "Import selection",
  Guardado: "Saved",
  Guardar: "Save",
  Descartar: "Dismiss",
  Restaurar: "Restore",
  Similar: "Find similar",
  "Abrir fuente": "Open source",
  "Sin resultados": "No results",
  "Prueba otra consulta o quita algún filtro.":
    "Try another query or remove a filter.",
  "Escribe una consulta para empezar.": "Enter a query to get started.",
  "Buscando…": "Searching…",
  "Interpretando consulta…": "Interpreting query…",
  "Resultados parciales": "Partial results",
  "Búsqueda completa": "Search complete",
  "Búsqueda cancelada": "Search canceled",
  "Error en la búsqueda": "Search error",
  Historial: "History",
  "Borrar historial": "Clear history",
  "No hay búsquedas todavía.": "No searches yet.",
  Proveedores: "Providers",
  Selección: "Selection",
  "{n} seleccionados": "{n} selected",
  "Importando…": "Importing…",
  "Importación completada": "Import completed",
  "Importación fallida": "Import failed",
  "Importación cancelada": "Import canceled",
  Cancelar: "Cancel",
  Reintentar: "Retry",
  Creado: "Created",
  Vinculado: "Linked",
  Fallidos: "Failed",
  "Esta consulta se enviará a las fuentes seleccionadas.":
    "This query will be sent to the selected sources.",
  "La interpretación con IA es opcional.": "AI interpretation is optional.",
  Cerrar: "Close",
  Detalles: "Details",
  Autores: "Authors",
  Publicado: "Published",
  "Sin fecha": "Undated",
  "Acceso abierto": "Open access",
  Fuente: "Source",
  "No disponible": "Unavailable",
  "Cargando…": "Loading…",
  Seleccionar: "Select",
  "Limpiar selección": "Clear selection",
  "Sin título": "Untitled",
  "Sin resumen": "No abstract",
  resultados: "results",
  Ordenar: "Sort",
  Borrar: "Delete",
  "Por qué se recomienda": "Why this was recommended",
  "Coincide con los conceptos de la consulta":
    "Matches the concepts in your query",
  "Coincide con una frase exacta": "Matches an exact phrase",
  "Coincide con el autor solicitado": "Matches the requested author",
  "Coincide con el idioma solicitado": "Matches the requested language",
  "Coincide con el tipo de publicación":
    "Matches the requested publication type",
  "Coincide con el intervalo de fechas": "Matches the requested date range",
  "Tiene acceso abierto verificado": "Has verified open access",
  "Procede de una fuente adecuada para la consulta":
    "Comes from an index suited to the query",
  "Está relacionado por citas": "Is related through citations",
  "Tiene similitud semántica local": "Has local semantic similarity",
  Artículo: "Article",
  Libro: "Book",
  Capítulo: "Chapter",
  Tesis: "Thesis",
  Informe: "Report",
  "Conjunto de datos": "Dataset",
  Prepublicación: "Preprint",
  Otro: "Other",
  "Candidatos guardados": "Saved candidates",
  "Reintentar búsqueda": "Retry search",
  "Sin conexión": "Offline",
  idle: "idle",
  queued: "queued",
  searching: "searching",
  complete: "complete",
  "rate-limited": "rate limited",
  error: "error",
  canceled: "canceled",
  "Descubre literatura académica y fuentes primarias abiertas.":
    "Discover scholarly literature and open primary sources.",
  "Literatura académica": "Scholarly literature",
  "Fuentes primarias": "Primary sources",
  "Tipo de fuente": "Source type",
  "La consulta se envía directamente a los proveedores mostrados; Nodus no usa proxy.":
    "The query is sent directly to the providers shown; Nodus does not use a proxy.",
  "El LLM permanece apagado por defecto.": "The LLM remains off by default.",
  "Disponible digitalmente": "Digitally available",
  "{n} seleccionados, {hidden} ocultos por filtros":
    "{n} selected, {hidden} hidden by filters",
  "En cola": "Queued",
  "Límite temporal": "Rate limited",
  "Presupuesto agotado": "Budget exhausted",
  "Error parcial": "Partial error",
  "Archivo abierto verificado": "Verified open file",
  Fotografía: "Photograph",
  Prensa: "Newspaper",
  Mapa: "Map",
  Manuscrito: "Manuscript",
  Audio: "Audio",
  Vídeo: "Video",
  "Objeto de archivo": "Archive item",
  photograph: "photograph",
  newspaper: "newspaper",
  map: "map",
  manuscript: "manuscript",
  audio: "audio",
  video: "video",
  "archive-item": "archive item",
  offline: "offline",
  "budget-exhausted": "budget exhausted",
  "temporarily-disabled": "temporarily disabled",
  created: "metadata created",
  "linked-existing": "linked to existing",
  "metadata-completed": "metadata completed",
  downloading: "downloading",
  attached: "attached",
  "no-file": "no open file",
  "skipped-limit": "skipped by limit",
  "skipped-duplicate": "already present",
  failed: "failed",
  checking: "checking",
};

function completeCompass(overrides: Record<string, string>, legacy: Record<string, string>): Record<string, string> {
  // Reuse the complete application catalog for shared keys, then apply Compass
  // terminology overrides. EN is retained only as a safety net for newly added
  // feature copy; the parity test rejects accidental EN inheritance.
  return Object.fromEntries(Object.keys(EN).map((key) => [key, overrides[key] ?? legacy[key] ?? EN[key]]));
}

const FR: Record<string, string> = completeCompass({
  "Nodus Compass": "Nodus Compass",
  "Descubre literatura académica en fuentes abiertas.":
    "Découvrez la littérature académique dans des sources ouvertes.",
  "Buscar literatura": "Rechercher dans la littérature",
  Buscar: "Rechercher",
  "Limpiar resultados": "Effacer les résultats",
  Filtros: "Filtres",
  "Limpiar filtros": "Effacer les filtres",
  Desde: "De",
  Hasta: "À",
  Idioma: "Langue",
  Tipo: "Type",
  Disciplina: "Discipline",
  Proveedor: "Fournisseur",
  "Solo acceso abierto": "Accès ouvert uniquement",
  Relevancia: "Pertinence",
  Fecha: "Date",
  Citas: "Citations",
  "Cargar más": "Charger plus",
  Guardar: "Enregistrer",
  Descartar: "Ignorer",
  Restaurar: "Restaurer",
  Similar: "Trouver des similaires",
  "Abrir fuente": "Ouvrir la source",
  "Sin resultados": "Aucun résultat",
  "Escribe una consulta para empezar.": "Saisissez une requête pour commencer.",
  "Buscando…": "Recherche…",
  Historial: "Historique",
  Proveedores: "Fournisseurs",
  Selección: "Sélection",
  "{n} seleccionados": "{n} sélectionnés",
  "Importando…": "Importation…",
  Cancelar: "Annuler",
  Cerrar: "Fermer",
  Detalles: "Détails",
  "Literatura académica": "Littérature académique",
  "Fuentes primarias": "Sources primaires",
  "Tipo de fuente": "Type de source",
  "Disponible digitalmente": "Disponible en ligne",
  Fotografía: "Photographie",
  Prensa: "Presse",
  Mapa: "Carte",
  Manuscrito: "Manuscrit",
  Vídeo: "Vidéo",
  "Objeto de archivo": "Objet d’archive",
  "En cola": "En attente",
  "Límite temporal": "Limite temporaire",
  "Presupuesto agotado": "Budget épuisé",
  "Error parcial": "Erreur partielle",
  "Archivo abierto verificado": "Fichier ouvert vérifié",
  offline: "hors ligne",
  "budget-exhausted": "budget épuisé",
  "temporarily-disabled": "temporairement désactivé",
  downloading: "téléchargement",
  attached: "joint",
  "no-file": "aucun fichier ouvert",
  "skipped-limit": "omis (limite)",
  failed: "échec",
}, LEGACY_FR);

// Compass-specific labels override the shared locale catalog below. New Compass
// copy should be added here (or to the shared catalog) rather than left in English.
const DE: Record<string, string> = completeCompass({
  Buscar: "Suchen",
  "Limpiar resultados": "Ergebnisse löschen",
  Filtros: "Filter",
  "Cargar más": "Mehr laden",
  Guardar: "Speichern",
  Descartar: "Verwerfen",
  Cerrar: "Schließen",
  Idioma: "Sprache",
  Tipo: "Typ",
  Fecha: "Datum",
  Citas: "Zitate",
  "Literatura académica": "Wissenschaftliche Literatur",
  "Fuentes primarias": "Primärquellen",
  "Tipo de fuente": "Quellentyp",
  "Disponible digitalmente": "Digital verfügbar",
  Fotografía: "Fotografie",
  Prensa: "Presse",
  Mapa: "Karte",
  Manuscrito: "Manuskript",
  Vídeo: "Video",
  "Objeto de archivo": "Archivobjekt",
  "En cola": "In Warteschlange",
  "Límite temporal": "Ratenlimit",
  "Presupuesto agotado": "Budget erschöpft",
  "Error parcial": "Teilfehler",
  "Archivo abierto verificado": "Verifizierte offene Datei",
  offline: "offline",
  "budget-exhausted": "Budget erschöpft",
  "temporarily-disabled": "vorübergehend deaktiviert",
  downloading: "wird heruntergeladen",
  attached: "angehängt",
  "no-file": "keine offene Datei",
  "skipped-limit": "wegen Limit übersprungen",
  failed: "fehlgeschlagen",
}, LEGACY_DE);
const PT: Record<string, string> = completeCompass({
  Buscar: "Pesquisar",
  "Limpiar resultados": "Limpar resultados",
  Filtros: "Filtros",
  "Cargar más": "Carregar mais",
  Guardar: "Guardar",
  Descartar: "Descartar",
  Cerrar: "Fechar",
  Idioma: "Idioma",
  Tipo: "Tipo",
  Fecha: "Data",
  Citas: "Citações",
  "Literatura académica": "Literatura académica",
  "Fuentes primarias": "Fontes primárias",
  "Tipo de fuente": "Tipo de fonte",
  "Disponible digitalmente": "Disponível digitalmente",
  Fotografía: "Fotografia",
  Prensa: "Imprensa",
  Mapa: "Mapa",
  Manuscrito: "Manuscrito",
  Vídeo: "Vídeo",
  "Objeto de archivo": "Item de arquivo",
  "En cola": "Na fila",
  "Límite temporal": "Limite temporário",
  "Presupuesto agotado": "Orçamento esgotado",
  "Error parcial": "Erro parcial",
  "Archivo abierto verificado": "Ficheiro aberto verificado",
  offline: "offline",
  "budget-exhausted": "orçamento esgotado",
  "temporarily-disabled": "temporariamente desativado",
  downloading: "a descarregar",
  attached: "anexado",
  "no-file": "sem ficheiro aberto",
  "skipped-limit": "omitido por limite",
  failed: "falhou",
}, LEGACY_PT);
const PT_BR: Record<string, string> = completeCompass({ "Cargar más": "Carregar mais" }, LEGACY_PT_BR);
const IT: Record<string, string> = completeCompass({
  Buscar: "Cerca",
  "Limpiar resultados": "Cancella risultati",
  Filtros: "Filtri",
  "Cargar más": "Carica altro",
  Guardar: "Salva",
  Descartar: "Ignora",
  Cerrar: "Chiudi",
  Idioma: "Lingua",
  Tipo: "Tipo",
  Fecha: "Data",
  Citas: "Citazioni",
  "Literatura académica": "Letteratura accademica",
  "Fuentes primarias": "Fonti primarie",
  "Tipo de fuente": "Tipo di fonte",
  "Disponible digitalmente": "Disponibile digitalmente",
  Fotografía: "Fotografia",
  Prensa: "Stampa",
  Mapa: "Mappa",
  Manuscrito: "Manoscritto",
  Vídeo: "Video",
  "Objeto de archivo": "Oggetto d’archivio",
  "En cola": "In coda",
  "Límite temporal": "Limite temporaneo",
  "Presupuesto agotado": "Budget esaurito",
  "Error parcial": "Errore parziale",
  "Archivo abierto verificado": "File aperto verificato",
  offline: "offline",
  "budget-exhausted": "budget esaurito",
  "temporarily-disabled": "temporaneamente disabilitato",
  downloading: "download in corso",
  attached: "allegato",
  "no-file": "nessun file aperto",
  "skipped-limit": "omesso per limite",
  failed: "non riuscito",
}, LEGACY_IT);
const TR: Record<string, string> = completeCompass({
  Buscar: "Ara",
  "Limpiar resultados": "Sonuçları temizle",
  Filtros: "Filtreler",
  "Cargar más": "Daha fazla yükle",
  Guardar: "Kaydet",
  Descartar: "Yoksay",
  Cerrar: "Kapat",
  Idioma: "Dil",
  Tipo: "Tür",
  Fecha: "Tarih",
  Citas: "Atıflar",
  "Literatura académica": "Akademik literatür",
  "Fuentes primarias": "Birincil kaynaklar",
  "Tipo de fuente": "Kaynak türü",
  "Disponible digitalmente": "Dijital olarak mevcut",
  Fotografía: "Fotoğraf",
  Prensa: "Basın",
  Mapa: "Harita",
  Manuscrito: "El yazması",
  Vídeo: "Video",
  "Objeto de archivo": "Arşiv öğesi",
  "En cola": "Sırada",
  "Límite temporal": "Hız sınırı",
  "Presupuesto agotado": "Bütçe tükendi",
  "Error parcial": "Kısmi hata",
  "Archivo abierto verificado": "Doğrulanmış açık dosya",
  offline: "çevrimdışı",
  "budget-exhausted": "bütçe tükendi",
  "temporarily-disabled": "geçici olarak devre dışı",
  downloading: "indiriliyor",
  attached: "eklendi",
  "no-file": "açık dosya yok",
  "skipped-limit": "sınır nedeniyle atlandı",
  failed: "başarısız",
}, LEGACY_TR);

Object.assign(FR, {
  "Descubre literatura académica y fuentes primarias abiertas.":
    "Découvrez la littérature académique et les sources primaires ouvertes.",
  "La consulta se envía directamente a los proveedores mostrados; Nodus no usa proxy.":
    "La requête est envoyée directement aux fournisseurs affichés ; Nodus n’utilise aucun proxy.",
  "El LLM permanece apagado por defecto.": "Le LLM reste désactivé par défaut.",
  "{n} seleccionados, {hidden} ocultos por filtros":
    "{n} sélectionnés, {hidden} masqués par les filtres",
  "Seleccionar página": "Sélectionner la page",
  "Importar selección": "Importer la sélection",
  Reintentar: "Réessayer",
  photograph: "photographie",
  newspaper: "presse",
  map: "carte",
  manuscript: "manuscrit",
  audio: "audio",
  video: "vidéo",
  "archive-item": "objet d’archive",
  created: "métadonnées créées",
  "linked-existing": "lié à l’existant",
  "metadata-completed": "métadonnées terminées",
  "skipped-duplicate": "déjà présent",
  checking: "vérification",
  canceled: "annulé",
  queued: "en attente",
  searching: "recherche",
  complete: "terminé",
  "rate-limited": "débit limité",
  error: "erreur",
});
Object.assign(DE, {
  "Descubre literatura académica y fuentes primarias abiertas.":
    "Entdecke wissenschaftliche Literatur und offene Primärquellen.",
  "La consulta se envía directamente a los proveedores mostrados; Nodus no usa proxy.":
    "Die Suchanfrage wird direkt an die angezeigten Anbieter gesendet; Nodus verwendet keinen Proxy.",
  "El LLM permanece apagado por defecto.":
    "Das LLM bleibt standardmäßig ausgeschaltet.",
  "{n} seleccionados, {hidden} ocultos por filtros":
    "{n} ausgewählt, {hidden} durch Filter ausgeblendet",
  "Seleccionar página": "Seite auswählen",
  "Importar selección": "Auswahl importieren",
  Reintentar: "Erneut versuchen",
  photograph: "Fotografie",
  newspaper: "Presse",
  map: "Karte",
  manuscript: "Manuskript",
  audio: "Audio",
  video: "Video",
  "archive-item": "Archivobjekt",
  created: "Metadaten erstellt",
  "linked-existing": "mit vorhandenem Eintrag verknüpft",
  "metadata-completed": "Metadaten abgeschlossen",
  "skipped-duplicate": "bereits vorhanden",
  checking: "wird geprüft",
  canceled: "abgebrochen",
  queued: "in Warteschlange",
  searching: "wird gesucht",
  complete: "abgeschlossen",
  "rate-limited": "Ratenlimit",
  error: "Fehler",
});
Object.assign(PT, {
  "Descubre literatura académica y fuentes primarias abiertas.":
    "Descubra literatura académica e fontes primárias abertas.",
  "La consulta se envía directamente a los proveedores mostrados; Nodus no usa proxy.":
    "A consulta é enviada diretamente aos fornecedores apresentados; o Nodus não usa proxy.",
  "El LLM permanece apagado por defecto.":
    "O LLM permanece desligado por predefinição.",
  "{n} seleccionados, {hidden} ocultos por filtros":
    "{n} selecionados, {hidden} ocultos pelos filtros",
  "Seleccionar página": "Selecionar página",
  "Importar selección": "Importar seleção",
  Reintentar: "Tentar novamente",
  photograph: "fotografia",
  newspaper: "imprensa",
  map: "mapa",
  manuscript: "manuscrito",
  audio: "áudio",
  video: "vídeo",
  "archive-item": "item de arquivo",
  created: "metadados criados",
  "linked-existing": "associado ao existente",
  "metadata-completed": "metadados concluídos",
  "skipped-duplicate": "já existente",
  checking: "a verificar",
  canceled: "cancelado",
  queued: "na fila",
  searching: "a pesquisar",
  complete: "concluído",
  "rate-limited": "limite de pedidos",
  error: "erro",
});
Object.assign(PT_BR, PT, {
  "El LLM permanece apagado por defecto.":
    "O LLM permanece desligado por padrão.",
  "La consulta se envía directamente a los proveedores mostrados; Nodus no usa proxy.":
    "A consulta é enviada diretamente aos provedores exibidos; o Nodus não usa proxy.",
});
Object.assign(IT, {
  "Descubre literatura académica y fuentes primarias abiertas.":
    "Scopri letteratura accademica e fonti primarie aperte.",
  "La consulta se envía directamente a los proveedores mostrados; Nodus no usa proxy.":
    "La query viene inviata direttamente ai fornitori mostrati; Nodus non usa proxy.",
  "El LLM permanece apagado por defecto.":
    "Il LLM rimane disattivato per impostazione predefinita.",
  "{n} seleccionados, {hidden} ocultos por filtros":
    "{n} selezionati, {hidden} nascosti dai filtri",
  "Seleccionar página": "Seleziona pagina",
  "Importar selección": "Importa selezione",
  Reintentar: "Riprova",
  photograph: "fotografia",
  newspaper: "stampa",
  map: "mappa",
  manuscript: "manoscritto",
  audio: "audio",
  video: "video",
  "archive-item": "oggetto d’archivio",
  created: "metadati creati",
  "linked-existing": "collegato a un elemento esistente",
  "metadata-completed": "metadati completati",
  "skipped-duplicate": "già presente",
  checking: "verifica in corso",
  canceled: "annullato",
  queued: "in coda",
  searching: "ricerca in corso",
  complete: "completato",
  "rate-limited": "limite di richieste",
  error: "errore",
});
Object.assign(TR, {
  "Descubre literatura académica y fuentes primarias abiertas.":
    "Akademik literatürü ve açık birincil kaynakları keşfedin.",
  "La consulta se envía directamente a los proveedores mostrados; Nodus no usa proxy.":
    "Sorgu doğrudan gösterilen sağlayıcılara gönderilir; Nodus proxy kullanmaz.",
  "El LLM permanece apagado por defecto.":
    "LLM varsayılan olarak kapalı kalır.",
  "{n} seleccionados, {hidden} ocultos por filtros":
    "{n} seçili, {hidden} filtrelerle gizli",
  "Seleccionar página": "Sayfayı seç",
  "Importar selección": "Seçimi içe aktar",
  Reintentar: "Yeniden dene",
  photograph: "fotoğraf",
  newspaper: "basın",
  map: "harita",
  manuscript: "el yazması",
  audio: "ses",
  video: "video",
  "archive-item": "arşiv öğesi",
  created: "üst veri oluşturuldu",
  "linked-existing": "mevcut kayda bağlandı",
  "metadata-completed": "üst veri tamamlandı",
  "skipped-duplicate": "zaten mevcut",
  checking: "kontrol ediliyor",
  canceled: "iptal edildi",
  queued: "sırada",
  searching: "aranıyor",
  complete: "tamamlandı",
  "rate-limited": "hız sınırı",
  error: "hata",
});

// The shared catalogs predate Compass-specific explanatory copy. Keep the
// remaining strings native here so a catalog lookup can never silently expose
// the English baseline in these six locales.
Object.assign(FR, {
  "Interpretar con IA": "Interpréter avec l’IA", Tipo: "Catégorie", Disciplina: "Domaine", Fecha: "Date calendaire", Citas: "Références",
  "Prueba otra consulta o quita algún filtro.": "Essayez une autre requête ou retirez un filtre.", "Interpretando consulta…": "Interprétation de la requête…", "Resultados parciales": "Résultats partiels", "Búsqueda completa": "Recherche terminée", "Búsqueda cancelada": "Recherche annulée", "Error en la búsqueda": "Erreur de recherche", "No hay búsquedas todavía.": "Aucune recherche pour le moment.", Vinculado: "Associé", Fallidos: "Échecs", "Esta consulta se enviará a las fuentes seleccionadas.": "Cette requête sera envoyée aux sources sélectionnées.", "La interpretación con IA es opcional.": "L’interprétation par IA est facultative.", "Acceso abierto": "Libre accès", Fuente: "Origine", "Sin resumen": "Sans résumé", "Por qué se recomienda": "Pourquoi cette recommandation", "Coincide con los conceptos de la consulta": "Correspond aux concepts de votre requête", "Coincide con una frase exacta": "Correspond à une expression exacte", "Coincide con el autor solicitado": "Correspond à l’auteur demandé", "Coincide con el idioma solicitado": "Correspond à la langue demandée", "Coincide con el tipo de publicación": "Correspond au type de publication demandé", "Coincide con el intervalo de fechas": "Correspond à la période demandée", "Tiene acceso abierto verificado": "Dispose d’un accès ouvert vérifié", "Procede de una fuente adecuada para la consulta": "Provient d’un index adapté à la requête", "Está relacionado por citas": "Est lié par les citations", "Tiene similitud semántica local": "Présente une similarité sémantique locale", "Artículo": "Publication", "Capítulo": "Section", "Informe": "Compte rendu", "Prepublicación": "Version préliminaire", "Candidatos guardados": "Candidats enregistrés", "Sin conexión": "Hors connexion", idle: "inactif", Audio: "Son", audio: "son",
});
Object.assign(DE, {
  "Descubre literatura académica en fuentes abiertas.": "Entdecken Sie wissenschaftliche Literatur in offenen Quellen.", "Buscar literatura": "Literatur suchen", "Interpretar con IA": "Mit KI interpretieren", Disciplina: "Fachgebiet", "Solo acceso abierto": "Nur Open Access", "Prueba otra consulta o quita algún filtro.": "Versuchen Sie eine andere Suchanfrage oder entfernen Sie einen Filter.", "Escribe una consulta para empezar.": "Geben Sie zum Start eine Suchanfrage ein.", "Interpretando consulta…": "Suchanfrage wird interpretiert…", "Resultados parciales": "Teilergebnisse", "Búsqueda completa": "Suche abgeschlossen", "Búsqueda cancelada": "Suche abgebrochen", "Error en la búsqueda": "Suchfehler", "No hay búsquedas todavía.": "Noch keine Suchen vorhanden.", Vinculado: "Verknüpft", Fallidos: "Fehlgeschlagen", "Esta consulta se enviará a las fuentes seleccionadas.": "Diese Suchanfrage wird an die ausgewählten Quellen gesendet.", "La interpretación con IA es opcional.": "Die KI-Interpretation ist optional.", Detalles: "Einzelheiten", "Acceso abierto": "Offener Zugang", "Sin resumen": "Keine Zusammenfassung", "Por qué se recomienda": "Grund für die Empfehlung", "Coincide con los conceptos de la consulta": "Entspricht den Begriffen Ihrer Suchanfrage", "Coincide con una frase exacta": "Entspricht einer exakten Formulierung", "Coincide con el autor solicitado": "Entspricht dem gewünschten Autor", "Coincide con el idioma solicitado": "Entspricht der gewünschten Sprache", "Coincide con el tipo de publicación": "Entspricht dem gewünschten Publikationstyp", "Coincide con el intervalo de fechas": "Entspricht dem gewünschten Zeitraum", "Tiene acceso abierto verificado": "Verfügt über geprüften offenen Zugang", "Procede de una fuente adecuada para la consulta": "Stammt aus einem passenden Index", "Está relacionado por citas": "Ist über Zitate verknüpft", "Tiene similitud semántica local": "Hat lokale semantische Ähnlichkeit", "Capítulo": "Beitrag", "Informe": "Dokument", "Prepublicación": "Vorabveröffentlichung", "Candidatos guardados": "Gespeicherte Kandidaten", "Sin conexión": "Offline-Modus", idle: "untätig", Audio: "Ton", "Vídeo": "Videodatei", offline: "nicht verbunden",
});
Object.assign(PT, {
  "Descubre literatura académica en fuentes abiertas.": "Descubra literatura académica em fontes abertas.", "Buscar literatura": "Pesquisar literatura", "Interpretar con IA": "Interpretar com IA", Disciplina: "Área", "Solo acceso abierto": "Apenas acesso aberto", "Prueba otra consulta o quita algún filtro.": "Experimente outra pesquisa ou remova um filtro.", "Escribe una consulta para empezar.": "Escreva uma pesquisa para começar.", "Interpretando consulta…": "A interpretar a pesquisa…", "Resultados parciales": "Resultados parciais", "Búsqueda completa": "Pesquisa concluída", "Búsqueda cancelada": "Pesquisa cancelada", "Error en la búsqueda": "Erro na pesquisa", "No hay búsquedas todavía.": "Ainda não existem pesquisas.", Vinculado: "Associado", Fallidos: "Falhados", "Esta consulta se enviará a las fuentes seleccionadas.": "Esta pesquisa será enviada para as fontes selecionadas.", "La interpretación con IA es opcional.": "A interpretação por IA é opcional.", Detalles: "Detalhes", "Acceso abierto": "Acesso livre", "Sin resumen": "Sem resumo", "Por qué se recomienda": "Por que é recomendado", "Coincide con los conceptos de la consulta": "Coincide com os conceitos da pesquisa", "Coincide con una frase exacta": "Coincide com uma frase exata", "Coincide con el autor solicitado": "Coincide com o autor solicitado", "Coincide con el idioma solicitado": "Coincide com o idioma solicitado", "Coincide con el tipo de publicación": "Coincide com o tipo de publicação solicitado", "Coincide con el intervalo de fechas": "Coincide com o período solicitado", "Tiene acceso abierto verificado": "Tem acesso aberto verificado", "Procede de una fuente adecuada para la consulta": "Vem de um índice adequado à pesquisa", "Está relacionado por citas": "Está relacionado por citações", "Tiene similitud semántica local": "Tem semelhança semântica local", "Capítulo": "Secção", "Informe": "Relatório", "Prepublicación": "Pré-publicação", "Candidatos guardados": "Candidatos guardados", "Sin conexión": "Sem ligação", idle: "inativo", offline: "desligado",
});
Object.assign(PT_BR, {
  "Descubre literatura académica en fuentes abiertas.": "Descubra literatura acadêmica em fontes abertas.", "Buscar literatura": "Pesquisar literatura", "Interpretar con IA": "Interpretar com IA", Disciplina: "Área", "Solo acceso abierto": "Somente acesso aberto", "Prueba otra consulta o quita algún filtro.": "Tente outra busca ou remova um filtro.", "Escribe una consulta para empezar.": "Digite uma busca para começar.", "Interpretando consulta…": "Interpretando a busca…", "Resultados parciales": "Resultados parciais", "Búsqueda completa": "Busca concluída", "Búsqueda cancelada": "Busca cancelada", "Error en la búsqueda": "Erro na busca", "No hay búsquedas todavía.": "Ainda não há buscas.", Vinculado: "Vinculado", Fallidos: "Falhos", "Esta consulta se enviará a las fuentes seleccionadas.": "Esta busca será enviada às fontes selecionadas.", "La interpretación con IA es opcional.": "A interpretação por IA é opcional.", Detalles: "Detalhes", "Acceso abierto": "Acesso aberto", "Sin resumen": "Sem resumo", "Por qué se recomienda": "Por que é recomendado", "Coincide con los conceptos de la consulta": "Corresponde aos conceitos da busca", "Coincide con una frase exacta": "Corresponde a uma frase exata", "Coincide con el autor solicitado": "Corresponde ao autor solicitado", "Coincide con el idioma solicitado": "Corresponde ao idioma solicitado", "Coincide con el tipo de publicación": "Corresponde ao tipo de publicação solicitado", "Coincide con el intervalo de fechas": "Corresponde ao período solicitado", "Tiene acceso abierto verificado": "Tem acesso aberto verificado", "Procede de una fuente adecuada para la consulta": "Vem de um índice adequado à busca", "Está relacionado por citas": "Está relacionado por citações", "Tiene similitud semántica local": "Tem similaridade semântica local", "Capítulo": "Capítulo de obra", "Informe": "Relatório", "Prepublicación": "Pré-publicação", "Candidatos guardados": "Candidatos salvos", "Sin conexión": "Sem conexão", idle: "inativo", offline: "desconectado",
});
Object.assign(IT, {
  "Descubre literatura académica en fuentes abiertas.": "Scopri la letteratura accademica nelle fonti aperte.", "Buscar literatura": "Cerca letteratura", "Interpretar con IA": "Interpreta con l’IA", Disciplina: "Ambito", Proveedor: "Fornitore", "Solo acceso abierto": "Solo accesso aperto", "Prueba otra consulta o quita algún filtro.": "Prova un’altra ricerca o rimuovi un filtro.", "Escribe una consulta para empezar.": "Inserisci una ricerca per iniziare.", "Interpretando consulta…": "Interpretazione della ricerca…", "Resultados parciales": "Risultati parziali", "Búsqueda completa": "Ricerca completata", "Búsqueda cancelada": "Ricerca annullata", "Error en la búsqueda": "Errore di ricerca", "No hay búsquedas todavía.": "Nessuna ricerca disponibile.", Vinculado: "Collegato", Fallidos: "Non riusciti", "Esta consulta se enviará a las fuentes seleccionadas.": "Questa ricerca verrà inviata alle fonti selezionate.", "La interpretación con IA es opcional.": "L’interpretazione con IA è facoltativa.", Detalles: "Dettagli", "Acceso abierto": "Accesso aperto", "Cargando…": "Caricamento in corso…", "Sin resumen": "Senza abstract", "Por qué se recomienda": "Perché è consigliato", "Coincide con los conceptos de la consulta": "Corrisponde ai concetti della ricerca", "Coincide con una frase exacta": "Corrisponde a una frase esatta", "Coincide con el autor solicitado": "Corrisponde all’autore richiesto", "Coincide con el idioma solicitado": "Corrisponde alla lingua richiesta", "Coincide con el tipo de publicación": "Corrisponde al tipo di pubblicazione richiesto", "Coincide con el intervalo de fechas": "Corrisponde all’intervallo richiesto", "Tiene acceso abierto verificado": "Dispone di accesso aperto verificato", "Procede de una fuente adecuada para la consulta": "Proviene da un indice adatto alla ricerca", "Está relacionado por citas": "È collegato tramite citazioni", "Tiene similitud semántica local": "Presenta similarità semantica locale", "Capítulo": "Sezione", "Informe": "Relazione", "Prepublicación": "Pubblicazione preliminare", "Candidatos guardados": "Candidati salvati", "Sin conexión": "Non in linea", idle: "inattivo", Audio: "Suono", "Vídeo": "Video clip", audio: "suono", video: "video file", offline: "non connesso",
});
Object.assign(TR, {
  "Descubre literatura académica en fuentes abiertas.": "Açık kaynaklarda akademik literatürü keşfedin.", "Buscar literatura": "Literatür ara", "Interpretar con IA": "Yapay zekâ ile yorumla", Disciplina: "Alan", "Solo acceso abierto": "Yalnızca açık erişim", "Prueba otra consulta o quita algún filtro.": "Başka bir arama deneyin veya bir filtreyi kaldırın.", "Escribe una consulta para empezar.": "Başlamak için bir arama yazın.", "Interpretando consulta…": "Arama yorumlanıyor…", "Resultados parciales": "Kısmi sonuçlar", "Búsqueda completa": "Arama tamamlandı", "Búsqueda cancelada": "Arama iptal edildi", "Error en la búsqueda": "Arama hatası", "No hay búsquedas todavía.": "Henüz arama yok.", Vinculado: "Bağlı", Fallidos: "Başarısız", "Esta consulta se enviará a las fuentes seleccionadas.": "Bu arama seçilen kaynaklara gönderilecek.", "La interpretación con IA es opcional.": "Yapay zekâ ile yorumlama isteğe bağlıdır.", Detalles: "Ayrıntılar", "Acceso abierto": "Açık erişim", "Sin resumen": "Özet yok", "Por qué se recomienda": "Neden öneriliyor", "Coincide con los conceptos de la consulta": "Aramanızdaki kavramlarla eşleşiyor", "Coincide con una frase exacta": "Tam bir ifadeyle eşleşiyor", "Coincide con el autor solicitado": "İstenen yazarla eşleşiyor", "Coincide con el idioma solicitado": "İstenen dille eşleşiyor", "Coincide con el tipo de publicación": "İstenen yayın türüyle eşleşiyor", "Coincide con el intervalo de fechas": "İstenen tarih aralığıyla eşleşiyor", "Tiene acceso abierto verificado": "Doğrulanmış açık erişim sunuyor", "Procede de una fuente adecuada para la consulta": "Aramaya uygun bir dizinden geliyor", "Está relacionado por citas": "Atıflar üzerinden ilişkili", "Tiene similitud semántica local": "Yerel anlamsal benzerlik taşıyor", "Capítulo": "Bölüm", "Informe": "Rapor", "Prepublicación": "Ön baskı", "Candidatos guardados": "Kaydedilen adaylar", "Sin conexión": "Bağlantı yok", idle: "boşta", "Vídeo": "Video klibi", video: "video dosyası",
});

Object.assign(FR, {
  "Reintentar búsqueda": "Réessayer la recherche",
  "Importación completada": "Importation terminée",
  "Importación fallida": "Échec de l’importation",
  "Importación cancelada": "Importation annulée",
});
Object.assign(DE, {
  "Reintentar búsqueda": "Suche erneut versuchen",
  "Importación completada": "Import abgeschlossen",
  "Importación fallida": "Import fehlgeschlagen",
  "Importación cancelada": "Import abgebrochen",
});
Object.assign(PT, {
  "Reintentar búsqueda": "Tentar pesquisa novamente",
  "Importación completada": "Importação concluída",
  "Importación fallida": "Falha na importação",
  "Importación cancelada": "Importação cancelada",
});
Object.assign(PT_BR, PT);
Object.assign(IT, {
  "Reintentar búsqueda": "Riprova la ricerca",
  "Importación completada": "Importazione completata",
  "Importación fallida": "Importazione non riuscita",
  "Importación cancelada": "Importazione annullata",
});
Object.assign(TR, {
  "Reintentar búsqueda": "Aramayı yeniden dene",
  "Importación completada": "İçe aktarma tamamlandı",
  "Importación fallida": "İçe aktarma başarısız",
  "Importación cancelada": "İçe aktarma iptal edildi",
});

export function compassT(
  key: string,
  vars: Record<string, string | number> = {},
): string {
  if (getActiveLang() === "es") {
    let source = key;
    for (const [name, replacement] of Object.entries(vars))
      source = source.replaceAll(`{${name}}`, String(replacement));
    return source;
  }
  const tables: Record<string, Record<string, string>> = {
    en: EN,
    fr: FR,
    de: DE,
    pt: PT,
    "pt-BR": PT_BR,
    it: IT,
    tr: TR,
  };
  const table = tables[getActiveLang()] ?? EN;
  let value = table?.[key] ?? EN[key] ?? key;
  for (const [name, replacement] of Object.entries(vars))
    value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}

// Exported for the locale parity test; the view continues to use compassT only.
export { EN, FR, DE, PT, PT_BR, IT, TR };
