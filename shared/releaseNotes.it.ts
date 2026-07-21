/** Italian history, indexed by release and highlight order. */
export const RELEASE_NOTES_IT: Record<string, string[]> = {
  "2.5.0": [
    "Novità in Strumenti: OCR Workspace trascrive PDF scansionati e immagini con qualsiasi modello dotato di visione — locale o nel cloud — e mantiene una libreria di OCR per documento. Ricostruisce un Markdown pulito, lascia intatto l'originale ed esporta il risultato.",
    "PDF Presenter arriva in Strumenti: presenta qualsiasi PDF come diapositive con vista relatore, note del relatore, strumenti di annotazione in tempo reale, video di YouTube per diapositiva e un telecomando dal telefono. La sua libreria conserva copie con cartelle e ricerca; l'originale non viene mai toccato.",
    "Il server MCP cresce: nuovi strumenti di sola lettura per la modalità Docenza, scrittura di righe e celle nei database e una limitazione per tipo di deposito, così ogni client vede solo gli strumenti pertinenti. Gli studenti sono sempre identificati da un codice, mai dal nome.",
    "Nuova categoria di plugin: i copiloti di Nodus per Microsoft Word e LibreOffice Writer funzionano direttamente nel tuo elaboratore di testi — il pannello segue il cursore, analizza il paragrafo, collega ciò che scrivi alla tua libreria e inserisce testo citato redatto dall'IA. Il copilota di Word aggiunge ora note a piè di pagina, redazione sulla selezione (riscrivere, ampliare o ribattere) e ricerca di passaggi citabili. Installali dalle Impostazioni e la connessione si configura da sola.",
    "Maggiore trasparenza sui tuoi dati: Nodus mostra avvisi sulla privacy dove le informazioni vengono elaborate, include un'informativa sulla privacy e avvisi di terze parti e aggiunge misure di conformità delle licenze. Tutta l'elaborazione sensibile rimane locale.",
    "L'estrazione delle idee è più affidabile con i modelli locali e del piano gratuito: i modelli di sola visione che restituivano risultati vuoti vengono ora esclusi dall'analisi con un avviso chiaro, e le scansioni approfondita e leggera falliscono con un errore utilizzabile invece di archiviare dati parziali.",
    "La roadmap di Nodus inaugura una vista con lo stato di ogni iniziativa — pianificata, in sviluppo o pubblicata — presentata in un modale cinematografico per vedere a colpo d'occhio dove è diretta l'app.",
    "Study affina la sua chat: migliora il recupero dei contenuti per rispondere con ciò che si trova nel tuo deposito, corregge diverse traduzioni e ripara i controlli dell'intestazione.",
    "La gestione dei materiali in Studio e Docenza è più comoda: caricali con il trascinamento, rinominali o eliminali e goditi un visualizzatore PDF migliorato. Inoltre, Nodus chiede il consenso esplicito prima di inviare qualsiasi materiale a un modello di IA e i controlli dell'orario rimangono all'interno della loro fascia.",
    "Il deposito accademico dimostrativo inaugura un grafo della conoscenza più ricco — con più idee, temi e connessioni — per esplorare come Nodus mette in relazione la letteratura prima di caricare il tuo corpus.",
    "La chat di Nodi ora cita le fonti del corpus alla base delle sue risposte, proprio come l'assistente di ricerca, così puoi risalire da ogni affermazione alla tua libreria.",
    "Nodi rifinisce il suo aspetto nel tema chiaro: le barre di scorrimento dei suoi pannelli vengono di nuovo visualizzate correttamente."
  ],
  "2.4.0": [
    "Nodi ha un nuovo look tra cui puoi scegliere: mantieni la classica mascotte o passa a un'elegante sfera (una sfera di vetro che contiene una costellazione) e la tua scelta ti seguirà in tutta l'app. Nodi ottiene anche note Markdown rapide che puoi annotare direttamente dal suo menu radiale.",
    "Nodi si comporta in modo più stabile ovunque: la sovrapposizione mobile non sfarfalla più tra le app o quando la trascini e fai clic su di essa, rimbalza uniformemente sui bordi dello schermo, i suoi controlli si adattano al colore della cassaforte attiva e la sfera è perfettamente centrata nel tutorial.",
    "Nodus Toolkit arriva come nuova sezione Strumenti, con il suo primo convertitore, Nodus Convert: converti ed elabora file sul tuo computer, uno alla volta o in batch. Documenti (PDF, DOCX, EPUB, Markdown, HTML e testo), utilità PDF (unisci, dividi, ruota, riordina, estrai immagini e modifica metadati), OCR leggero con PDF ricercabile, immagini (inclusi HEIC, ridimensionamento e compressione) e utilità di testo. Tutto è locale e deterministico; il file originale non viene mai modificato.",
    "Nodus Convert continua a crescere: PDF in immagini, comprimi e converti in scala di grigi, aggiungi numeri di pagina, filigrane e ritaglia margini; nuove opzioni di ritaglio, rotazione, capovolgimento e filigrana per le immagini; e i lavori batch vengono ora consegnati impacchettati in un unico ZIP.",
    "Arriva Nodus Protect: combina PDF e immagini, oscura o sfoca i dati, ritaglia, ruota e raddrizza, aggiunge sette motivi di filigrana e un piè di pagina legale ed esporta copie rasterizzate senza testo o livelli nascosti. Può usare file dal disco o dal deposito, salvarli nella libreria Copie protette e creare o verificare marcature tracciabili IDPS v1 compatibili con IDprotector. Tutta l’elaborazione dei documenti avviene localmente.",
    "L’intera interfaccia di Nodus è ora disponibile anche in italiano, la settima lingua globale. Include navigazione, impostazioni, tutorial, ripristino, messaggi di runtime, vocabolario di ogni deposito, note di versione e Nodus Protect; l’impostazione separata della lingua dei prompt di IA rimane invariata.",
    "Diversi dettagli dell'interfaccia sono stati migliorati: il badge del caveau rimane centrato nell'intestazione invece di spostarsi sotto la guida dell'azione, lo spinner di caricamento della ricerca ora gira correttamente e le superfici e le sostituzioni del tema della luce sono state corrette.",
    "La modalità Novità ora presenta ogni modifica con un'icona per la sua area (deposito, server MCP, Nodi, lingue o strumenti) e raggruppa le modifiche per categoria, ordinate in modo che le aree con il maggior numero di aggiornamenti vengano visualizzate per prime.",
    "Study ora organizza corsi, materie e orari per anno accademico (ad esempio 2024/2025). L’anno è ereditabile – impostalo su un corso e le sue materie lo adottano, o impostalo per materia per una laurea pluriennale – quindi un corso insegnato di nuovo ogni settembre mantiene i materiali e l’orario dell’anno scorso invece di sovrascriverli, con una scorciatoia per copiare un orario in un altro anno accademico.",
    "L’intelligenza artificiale dello studio è più affidabile: le estrazioni non vengono più scartate silenziosamente quando un modello utilizza una formulazione leggermente diversa per le relazioni e le risposte troncate vengono rilevate invece di essere archiviate come dati parziali.",
    "Il server MCP ha ricevuto un controllo completo: una superficie di strumenti unificata e impaginata per ogni tipo di deposito (genealogia ed eventi e archivio di origine primaria, query e filtri di database digitati e banca delle domande di studio) oltre a tre modalità di errore silenzioso corrette, in modo che un corpus non indicizzato, un deposito cambiato o un fornitore di intelligenza artificiale in errore ora riportino chiaramente invece di fuorviare il cliente.",
    "Il selettore della lingua del prompt ora offre le varianti tedesca e portoghese (europea e brasiliana, scritte separatamente, senza alias), quindi le tue idee, rapporti e domande vengono generati nella lingua in cui leggi Nodus; Il turco funziona di nuovo su MCP e diverse traduzioni dell'interfaccia e il fallback inglese sono stati corretti.",
    "La genealogia è più fedele ai tuoi dati: l'importazione e l'esportazione di GEDCOM non trasforma più un bambino adottato in un bambino naturale in viaggio di andata e ritorno tra i programmi, e la rete di relazioni sociali ora mostra il nome di ogni contatto invece di punti anonimi.",
    "La modalità database si muove verso la versione beta con colonne formula costruite da ricette visive (operazioni, statistiche, se/allora con colori, testo combinato) che si comportano come qualsiasi altra colonna per filtri, ordinamenti ed esportazione; L'importazione CSV è notevolmente più veloce, la corrispondenza collettiva degli allegati è più intelligente e gli allegati delle immagini utilizzano le miniature."
  ],
  "2.3.8": [
    "Nodus è ora completamente disponibile in francese, tedesco, portoghese europeo e portoghese brasiliano. Ogni interfaccia mantiene il proprio vocabolario, copre anche tassonomie, parentela e recupero e ritorna in sicurezza all'inglese se manca una traduzione.",
    "La procedura guidata di configurazione dell'archivio ora rileva automaticamente l'intelligenza artificiale disponibile e i modelli di incorporamento tra provider locali e cloud. Combina i risultati in due chiari selettori ricercabili, tollera i provider offline e scarica un modello integrato solo al termine della configurazione.",
    "I controlli radiali di Nodi ora rimangono bilanciati in modo uniforme, rimangono cliccabili negli angoli superiori e rimangono visibili durante il suo addio. Il menu contestuale mantiene in modo affidabile l'azione chiusa e le interazioni evitano l'apertura o la chiusura accidentale.",
    "L'icona Nodus ora mantiene la stessa \"N\" compatta e stilizzata sia che l'applicazione sia aperta o chiusa. L'icona in bundle e le varianti dinamiche condividono una geometria, impedendo a macOS di mostrare un segno di grandi dimensioni dopo l'uscita."
  ],
  "2.3.7": [
    "L'albero genealogico è ora più diretto ed espressivo: trascina per spostarti, apri la cartella laterale con un clic e centra una persona con un doppio clic. I rami fondono i colori selezionati per entrambi i genitori ed evidenziano in oro i discendenti della persona focus; vengono ora distinti anche i rapporti familiari e sociali iniziali.",
    "La sequenza temporale e la mappa della genealogia ora presentano filtri a selezione multipla, schede più chiare, miniature e accesso completo ai dossier quando si fa clic su una persona. I problemi di sfarfallio e stratificazione sono scomparsi, la mappa si adatta ai punti visibili e i collegamenti di credito si aprono in modo sicuro nel browser.",
    "L'archivio genealogico ora porta la creazione delle voci in un'unica modalità ben organizzata, accetta qualsiasi tipo di allegato e supporta le importazioni da Zotero. I dossier personali includono anche un identificatore nazionale opzionale ricercabile in tutto il deposito.",
    "Ora è possibile scaricare i materiali di studio, rivelare il nome di ciascuna azione al passaggio del mouse e apparire correttamente all'interno dei corsi e delle materie assegnati. Nodi, chat e strumenti AI possono utilizzare il contenuto indicizzato di immagini, PDF e altri file.",
    "Study ora include una ricerca approfondita incentrata sull'apprendimento e riutilizza lo stesso grafico e motore di idee, design e funzionalità dei depositi accademici, mantenendo isolato il contenuto di ogni deposito. I nomi degli orari rimangono leggibili e il selettore non duplica più le emoji.",
    "Le procedure guidate per la creazione di archivi accademici, genealogici, di studio e di database ora ti consentono di scegliere modelli separati di intelligenza artificiale e di incorporamento, locali o basati su cloud, e di scaricare un modello locale quando necessario.",
    "Nodi contrae e gira gli arti mentre pensa, chiude gli occhi e ritorna dolcemente alla sua posa normale. Può anche essere trascinato sullo schermo intero e chiuso dal menu contestuale con un addio animato che ne spiega l'estetica.",
    "L'interfaccia ora mantiene il colore attivo del vault mentre ridimensiona la barra laterale, dà alle carte di creazione una dimensione coerente e corregge le superfici chiare, i pulsanti, i campi di ricerca e i menu a discesa. Le icone Novità identificano anche il relativo gruppo al passaggio del mouse.",
    "Nodus ora esegue un controllo di aggiornamento cinematografico all'avvio, segnalando se sei aggiornato, è disponibile una nuova versione o si è verificato un errore. Mostra l'avanzamento del download e supporta l'installazione e il riavvio senza sovrapporsi alla modalità Novità."
  ],
  "2.3.6": [
    "La parentela viene ora completamente ricalcolata ogni volta che cambia la persona focus: coniugi, genitori, figli, fratelli, suoceri, famiglie miste, cugini di qualsiasi grado e le relazioni intergenerazionali ricevono la loro etichetta precisa, anche negli alberi estesi. Anche Nodi e l'assistente capiscono queste relazioni calcolate.",
    "Il dossier della persona presenta ora Varianti del nome, Parentela, Eventi della vita, Luoghi, Documenti, Prove e Note in sezioni coerenti con Biografia e Relazioni. Varianti, eventi e luoghi vengono aggiunti tramite modalità pulite con pulsanti di dimensioni uniformi.",
    "L'icona Nodus aggiornata viene ora conservata anche durante il lancio di un'applicazione a freddo, prima che il vault attivo venga caricato.",
    "La modalità Novità ora mostra la cronologia completa della versione principale installata, ad esempio ogni versione 2.x, in inglese o spagnolo. Ogni modifica storica include anche l'icona e il colore della cassetta, oppure l'indicatore generale quando influisce sull'intera applicazione."
  ],
  "2.3.5": [
    "I rami estesi non si mescolano più: zii, zie e i loro partner rimangono all’interno del corrispondente blocco paterno o materno, con la coppia genitoriale come punto centrale e ogni generazione allineata in modo coerente.",
    "I filari di alberi orizzontali vengono ora percorsi esclusivamente attraverso lo spazio libero tra le generazioni. Anche i nomi, le etichette di parentela e le date hanno uno sfondo protettivo in modo che rimangano leggibili sia in modalità chiara che scura.",
    "L'albero ora include la ricerca tra nomi, date ed etichette di parentela, con corrispondenza senza accento. Le corrispondenze vengono evidenziate mentre il resto dell'albero rimane visibile in uno stato oscurato per preservare il contesto familiare."
  ],
  "2.3.4": [
    "L'albero ora mantiene separati i nuclei familiari, evitando che le linee dei nonni paterni e materni vengano unite in modo errato. I rami paterni e materni utilizzano il blu e il rosso per impostazione predefinita, ti consentono di scegliere i loro due colori principali e di distinguere i rami secondari attraverso variazioni tonali.",
    "Ogni persona ora mostra un'etichetta di parentela relativa alla persona focus dell'albero, inclusi genitori, fratelli, zii e zie, cugini, nipoti e nipoti, nonni, bisnonni, trisnonni e i loro discendenti equivalenti. Le etichette vengono ricalcolate quando cambia il focus e vengono incluse anche nel contesto Nodi e assistente.",
    "Le relazioni familiari e sociali ora condividono un'interfaccia più pulita: ogni sezione mantiene il suo elenco persistente e fornisce un pulsante che apre una modalità di aggiunta o modifica. I selettori includono la ricerca, supportano più persone e le relazioni sociali ti consentono di scegliere uno o più tipi predefiniti in un'unica operazione.",
    "Diversi dettagli dell'interfaccia sono stati migliorati: il marchio Nodus mantiene il suo margine quando la barra laterale è nascosta, la prima persona nell'elenco non viene più ritagliata, i menu a discesa appaiono sopra le modalità senza sovrapporre l'icona di ricerca e il testo e il banner di supporto non duplica più il pulsante PayPal."
  ],
  "2.3.3": [
    "I rapporti familiari ora possono essere creati da un dossier personale o direttamente dall'albero con un chiaro selettore: genitore, figlio, fratello o partner. Quando aggiungi un bambino, puoi specificare entrambi i genitori conosciuti o solo uno.",
    "La barra laterale dell'albero ora mantiene visibile ogni relazione della persona selezionata, quindi puoi modificarla, invertirla o eliminarla. Avverte inoltre sulle date cronologicamente improbabili senza bloccare i casi storici che è necessario documentare.",
    "L'albero ora posiziona gli antenati in alto per impostazione predefinita e può facoltativamente invertire il suo orientamento. Il layout e i connettori di genitore, figlio, fratello e partner sono stati corretti mantenendo compatibili le relazioni esistenti.",
    "La modalità Novità ora identifica visivamente ogni modifica: le modifiche generali utilizzano un'icona neutra, mentre le modifiche specifiche del vault mostrano il colore e l'icona corrispondenti sia in modalità chiara che scura."
  ],
  "2.3.2": [
    "Risolto un problema che impediva a Nodus di leggere alcune chiavi API AI salvate in precedenza, facendole scomparire dalle Impostazioni. Le chiavi non erano state cancellate: Nodus le recupera in modo sicuro e le include nuovamente nel backup del workspace protetto.",
    "Nodus ora rileva nuovamente il modello utilizzato per creare ciascun indice dello spazio di lavoro. Se i tuoi incorporamenti sono stati generati, ad esempio, con BGE-M3 tramite OpenRouter, quel modello viene selezionato nuovamente senza eliminare o reindicizzare alcun vettore.",
    "Vengono ripristinati anche i modelli preferiti e le selezioni per attività conservati prima della migrazione. La modalità di base o avanzata e il modello di incorporamento appartengono nuovamente a ciascuna area di lavoro, impedendo a un'area di lavoro di sovrascriverne un'altra."
  ],
  "2.3.1": [
    "Risolto un problema che impediva a Nodus di leggere alcune chiavi API AI salvate in precedenza, facendole scomparire dalle Impostazioni. Le chiavi non sono state cancellate: questa versione le recupera in modo sicuro, conserva le loro precedenti copie crittografate e le include nuovamente nel backup dell'area di lavoro protetta.",
    "Su macOS, Portachiavi potrebbe richiedere l'autorizzazione durante il ripristino. Verifica che la richiesta appartenga a Nodus e scegli “Consenti sempre”; se l'hai ignorato, riprova da Impostazioni → Provider."
  ],
  "2.3.0": [
    "Study Vault fa un grande passo avanti: corsi e materie, cartelle e appunti, materiali annotabili, registrazioni con trascrizioni, orari, calendario, banca delle domande, test, flashcard, revisioni, progressi, un grafico della conoscenza e chat basata sulla fonte.",
    "L'integrazione di Zotero va più in profondità: i vault possono utilizzare le librerie di gruppo e, da corsi o materiali, cercare un elemento e scegliere se importare il suo allegato in Nodus o mantenere un collegamento che lo apra in Zotero.",
    "Groq e Cerebras si uniscono ai fornitori di intelligenza artificiale, con la scoperta del modello ogni volta che il fornitore lo supporta. La configurazione di base e avanzata ora richiede conferma prima di cambiare modalità, impedendo configurazioni accidentali del modello incomplete.",
    "I modelli locali sono più facili da usare: scarica, seleziona e rimuovi modelli integrati per diverse attività e quando un modello richiede prima un motore, Nodus lo installa automaticamente prima di avviare il download.",
    "Una nuova guida essenziale al cinema con protagonista Nodi spiega casseforti, fornitori, modelli, incorporamenti e discorsi. Nodi viene presentato alla fine, rimane più calmo per tutto il tour e non si sovrappone più al compagno dal vivo.",
    "Un nuovo sistema di ripristino completo protegge automaticamente ogni deposito, documento, impostazione, cronologia, file e chiave in istantanee crittografate all'interno di una cartella sicura. Include una chiave di ripristino e un assistente di migrazione per installazioni precedenti, compatibile con le cartelle sincronizzate da Google Drive, Dropbox, iCloud e servizi simili.",
    "Le demo Academic, Genealogy, Databases e Study sono state ampliate in modo che nessuna sezione inizi vuota: includono cartelle, note, materiali, conversazioni, report ed esempi collegati che puoi esplorare e rimuovere in seguito.",
    "Nodi ora chiude correttamente il menu, la chat e i pannelli quando si fa clic altrove. Anche l'esperienza mobile e le animazioni dei tutorial sono state migliorate e l'icona dell'app ora mantiene l'archivio attivo e l'aspetto del tema dopo l'uscita.",
    "La navigazione nella barra laterale ora sembra più coerente: il marchio Nodus rimane centrato mentre il menu viene ridimensionato e l'intera intestazione può mostrarlo o nasconderlo.",
    "Il pannello Novità ora ha una presentazione cinematografica con Nodi che celebra, versioni e modifiche chiaramente visibili in modalità chiaro e scuro, oltre a una sezione opzionale per supportare il progetto open source tramite PayPal."
  ],
  "2.2.0": [
    "Ti presento Nodi, la nuova mascotte di Nodus: un piccolo nodo di luce che ti tiene compagnia, fluttuante in basso a destra. Trascinalo nella finestra e attivalo o disattivalo in Impostazioni → Interfaccia.",
    "Fai clic su Nodi per aprire il suo menu: una chat con un'IA che conosce Nodus e la tua configurazione, un centro notifiche (contrassegna gli elementi non letti con un punto rosso e una mano alzata) e una guida rapida. Nodi cambia persino abito per adattarsi alla modalità del caveau (accademico, genealogico, database), che puoi disattivare se preferisci il semplice Nodi.",
    "Se lo desideri, Nodi può vivere in una piccola finestra mobile del desktop, sempre in primo piano rispetto alle altre app, anche a schermo intero, quindi è sempre a portata di mano senza cambiare app."
  ],
  "2.1.1": [
    "I modelli che scegli per ciascun fornitore e per ciascuna attività di intelligenza artificiale sono ora condivisi in tutti i tuoi depositi, proprio come lo erano già le tue chiavi API. Configurali una volta e saranno pronti in ogni caveau.",
    "Poiché i depositi condividono chiavi e modelli, abbiamo rimosso il messaggio \"carica chiavi API da un altro deposito\": non era più necessario."
  ],
  "2.1.0": [
    "Nodus introduce la modalità Database: un gestore di database in stile Notion all'interno del tuo vault. Costruisci tabelle con molti tipi di colonne (testo, numero, selezione, data, relazione, rollup, immagine...), organizza i dati in diverse visualizzazioni con filtri e ordinamento e modifica tutto direttamente nella griglia. Importa ed esporta CSV ogni volta che ne hai bisogno.",
    "Colonne AI: lascia che l'IA riempia un'intera colonna dal resto della riga, con testo (riepiloghi, classificazioni, traduzioni) o con immagini generate. E una chat integrata risponde alle domande sui dati della tua tabella.",
    "Analisi statistica onesta: l'intelligenza artificiale propone le giuste analisi sulle colonne reali (correlazioni, chi-quadrato, ANOVA, regressione) e l'app le calcola in modo deterministico, con grafici nativi: mappe di calore, grafici a dispersione e grafici a scatola. I piani dell'IA; il motore calcola, senza numeri inventati.",
    "L'archivio genealogico è ricostruito come una griglia modificabile in stile database: modifica ogni cella in linea, archivia i documenti in più cartelle contemporaneamente e classificali con una tassonomia di oltre 190 tipi di documenti del patrimonio, completi di ricerca intelligente e filtri sfaccettati."
  ],
  "2.0.2": [
    "L'Archivio ottiene un campo \"Sorgente\" su ogni documento: registra da dove proviene (l'archivio o il repository, una citazione o un URL). È la spina dorsale di una buona citazione genealogica e viaggia con i tuoi backup come il resto del documento."
  ],
  "2.0.1": [
    "Il commutatore del deposito ora mostra un badge con il tipo di ciascun deposito (Accademico, Genealogico...) e l'etichetta \"Attivo\" e il pulsante \"Carica\" condividono finalmente la stessa tipografia.",
    "Nel dossier persona, i pulsanti di modifica ed eliminazione delle relazioni sociali sono ora icone, e il pannello verticale “Regola inquadratura” si chiude con un clic esterno e non è più disallineato.",
    "Risolto il problema con la finestra delle novità: ora appare correttamente dopo l'aggiornamento e recupera le modifiche 2.0.0 se le hai perse."
  ],
  "2.0.0": [
    "Nodus introduce i tipi di deposito: ogni deposito ora ha una modalità che personalizza le sezioni mostrate e il personaggio dell'assistente AI. Questa versione include due modalità, \"Accademica\" e \"Genealogia\", e prevede un'anteprima di quelle successive: Studio, Fonti primarie e Database.",
    "Nuova modalità Genealogia: ricostruisci la storia familiare da fonti primarie con dossier personali, un albero genealogico, una cronologia, un archivio di prove e una mappa reale. L'assistente funge da genealogista e propone la parentela in base alle prove, seguendo lo standard della prova genealogica.",
    "Relazioni sociali: una seconda rete, indipendente dalla parentela, per amicizie, mecenatismo, impiego, rivalità e corrispondenza - il materiale dello storico sociale e prosopografico.",
    "Deep Research apprende la genealogia: compone un rapporto genealogico sull'archivio e sulla biblioteca indicizzati per incorporamento. L'intestazione ora mostra la modalità del deposito attivo nel suo colore principale.",
    "Backup multi-deposito: il sistema di backup automatico crittografato ora copre tutti i tuoi depositi con rotazione generazionale."
  ],
  "1.8.0": [
    "Nuovo copilota di scrittura per LibreOffice Writer (Linux, macOS e Windows): installa la macro da Impostazioni → Copilota di scrittura (LibreOffice), eseguila in Writer e il riquadro copilot segue il cursore per analizzare il paragrafo e inserire il testo citato redatto da AI. La connessione si configura da sola.",
    "Nodus sbarca su Linux: ogni versione ora include programmi di installazione .deb e AppImage e l'app eredita il tema del cursore di sistema su Wayland.",
    "Le lingue di richiesta ora includono il francese e il turco: idee, rapporti di ricerca approfondita e bozze di workshop possono essere generati anche in quelle lingue. Le citazioni letterali mantengono sempre la lingua di partenza.",
    "Risolto: i PDF locali allegati dopo una prima scansione vengono ripresi durante la sincronizzazione invece di rimanere contrassegnati come \"senza testo\" per sempre.",
    "Questa versione include il primo contributo esterno del progetto: il copilota di LibreOffice, i pacchetti Linux e i nuovi linguaggi nati dal lavoro di Oğuz Karayemiş (@oguzkarayemis). Grazie!"
  ],
  "1.7.5": [
    "I modelli locali (LM Studio / Ollama) con una piccola finestra di contesto non falliscono più nell'assistente di ricerca: l'app ora adatta il contesto alla finestra del modello in modo che possa sempre rispondere.",
    "Le citazioni dai modelli locali ora vengono visualizzate correttamente come \"Autore, Anno\" invece dell'ID dell'idea interna.",
    "La procedura guidata di configurazione ora mostra le raccolte come una struttura espandibile, in modo da poter monitorare sottoraccolte specifiche quando una raccolta è molto grande."
  ],
  "1.7.4": [
    "Immersion ha una nuova galleria con visualizzazioni a griglia ed elenco, oltre a un pulsante \"Nuova immersione\" con la propria finestra di dialogo, proprio come Deep Research.",
    "Selezione multipla in Ricerca approfondita e Immersione per eliminare più elementi contemporaneamente, con conferma.",
    "Nuovo pulsante \"Traduci\": genera una traduzione AI di un report o di un'immersione in qualsiasi lingua. Ogni traduzione viene salvata per essere riletta, rigenerata o eliminata.",
    "Dopo ogni aggiornamento vedrai questa finestra delle novità con le ultime modifiche e correzioni."
  ],
  "1.7.3": [
    "L'interfaccia non si blocca più mentre l'audio della narrazione viene generato in Ricerca profonda e Immersione.",
    "Risolto il problema con la voce \"Sharvard\": ora appare come una voce maschile, che è ciò che effettivamente rende il motore."
  ]
};
