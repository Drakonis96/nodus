/** Strings introduced by bidirectional relations, typed rollups and safe formula ASTs. */
const catalog = [
  ['Cardinalidad', 'Cardinality', 'Cardinalité', 'Kardinalität', 'Cardinalidade', 'Cardinalidade', 'Cardinalità', 'Kardinalite'],
  ['Varias páginas', 'Multiple pages', 'Plusieurs pages', 'Mehrere Seiten', 'Várias páginas', 'Várias páginas', 'Più pagine', 'Birden çok sayfa'],
  ['Una página', 'One page', 'Une page', 'Eine Seite', 'Uma página', 'Uma página', 'Una pagina', 'Tek sayfa'],
  ['Relación inversa', 'Inverse relation', 'Relation inverse', 'Gegenbeziehung', 'Relação inversa', 'Relação inversa', 'Relazione inversa', 'Ters ilişki'],
  ['Sin propiedad inversa', 'No inverse property', 'Sans propriété inverse', 'Keine Gegenbeziehung', 'Sem propriedade inversa', 'Sem propriedade inversa', 'Nessuna proprietà inversa', 'Ters özellik yok'],
  ['Los enlaces nuevos se reflejarán en ambas bases.', 'New links will appear in both databases.', 'Les nouveaux liens apparaîtront dans les deux bases.', 'Neue Links erscheinen in beiden Datenbanken.', 'As novas ligações aparecerão em ambas as bases.', 'Os novos links aparecerão em ambas as bases.', 'I nuovi collegamenti appariranno in entrambi i database.', 'Yeni bağlantılar iki veritabanında da görünür.'],
  ['Crea primero una relación compatible en la base de destino.', 'First create a compatible relation in the target database.', 'Créez d’abord une relation compatible dans la base cible.', 'Erstellen Sie zuerst eine passende Beziehung in der Zieldatenbank.', 'Crie primeiro uma relação compatível na base de destino.', 'Primeiro, crie uma relação compatível no banco de destino.', 'Crea prima una relazione compatibile nel database di destinazione.', 'Önce hedef veritabanında uyumlu bir ilişki oluşturun.'],
  ['Limpiar relaciones rotas', 'Clean up broken relations', 'Nettoyer les relations rompues', 'Defekte Beziehungen bereinigen', 'Limpar relações quebradas', 'Limpar relações quebradas', 'Pulisci relazioni interrotte', 'Bozuk ilişkileri temizle'],
  ['Reparar relación', 'Repair relation', 'Réparer la relation', 'Beziehung reparieren', 'Reparar relação', 'Reparar relação', 'Ripara relazione', 'İlişkiyi onar'],
  ['Reparar', 'Repair', 'Réparer', 'Reparieren', 'Reparar', 'Reparar', 'Ripara', 'Onar'],
  ['Buscar destino de sustitución…', 'Search for a replacement target…', 'Rechercher une cible de remplacement…', 'Ersatzziel suchen…', 'Procurar destino de substituição…', 'Buscar destino substituto…', 'Cerca una destinazione sostitutiva…', 'Yeni hedef ara…'],
  ['Selecciona el destino correcto para reparar el enlace.', 'Select the correct target to repair the link.', 'Sélectionnez la bonne cible pour réparer le lien.', 'Wählen Sie das richtige Ziel, um den Link zu reparieren.', 'Selecione o destino correto para reparar a ligação.', 'Selecione o destino correto para reparar o link.', 'Seleziona la destinazione corretta per riparare il collegamento.', 'Bağlantıyı onarmak için doğru hedefi seçin.'],
  ['Resultado materializado como {type}', 'Result materialized as {type}', 'Résultat matérialisé en {type}', 'Ergebnis als {type} materialisiert', 'Resultado materializado como {type}', 'Resultado materializado como {type}', 'Risultato materializzato come {type}', 'Sonuç {type} olarak somutlaştırıldı'],
  ['Fórmula avanzada', 'Advanced formula', 'Formule avancée', 'Erweiterte Formel', 'Fórmula avançada', 'Fórmula avançada', 'Formula avanzata', 'Gelişmiş formül'],
  ['Expresión segura con fechas, listas, relaciones y personas', 'Safe expression with dates, lists, relations, and people', 'Expression sûre avec dates, listes, relations et personnes', 'Sicherer Ausdruck mit Daten, Listen, Beziehungen und Personen', 'Expressão segura com datas, listas, relações e pessoas', 'Expressão segura com datas, listas, relações e pessoas', 'Espressione sicura con date, elenchi, relazioni e persone', 'Tarih, liste, ilişki ve kişilerle güvenli ifade'],
  ['Expresión segura', 'Safe expression', 'Expression sûre', 'Sicherer Ausdruck', 'Expressão segura', 'Expressão segura', 'Espressione sicura', 'Güvenli ifade'],
  ['Solo admite propiedades, operadores y funciones de la lista. No ejecuta JavaScript.', 'Only listed properties, operators, and functions are allowed. JavaScript is never executed.', 'Seuls les propriétés, opérateurs et fonctions listés sont autorisés. JavaScript n’est jamais exécuté.', 'Nur aufgeführte Eigenschaften, Operatoren und Funktionen sind erlaubt. JavaScript wird nie ausgeführt.', 'Só são permitidos propriedades, operadores e funções da lista. JavaScript nunca é executado.', 'Apenas propriedades, operadores e funções listados são permitidos. JavaScript nunca é executado.', 'Sono consentiti solo proprietà, operatori e funzioni elencati. JavaScript non viene mai eseguito.', 'Yalnızca listedeki özellik, işleç ve işlevlere izin verilir. JavaScript çalıştırılmaz.'],
  ['Expresión de fórmula', 'Formula expression', 'Expression de formule', 'Formelausdruck', 'Expressão da fórmula', 'Expressão da fórmula', 'Espressione della formula', 'Formül ifadesi'],
  ['Autocompletar propiedades', 'Autocomplete properties', 'Compléter les propriétés', 'Eigenschaften vervollständigen', 'Completar propriedades', 'Autocompletar propriedades', 'Completa proprietà', 'Özellikleri otomatik tamamla'],
  ['Autocompletar funciones', 'Autocomplete functions', 'Compléter les fonctions', 'Funktionen vervollständigen', 'Completar funções', 'Autocompletar funções', 'Completa funzioni', 'İşlevleri otomatik tamamla'],
  ['Sintaxis y tipos válidos', 'Valid syntax and types', 'Syntaxe et types valides', 'Gültige Syntax und Typen', 'Sintaxe e tipos válidos', 'Sintaxe e tipos válidos', 'Sintassi e tipi validi', 'Geçerli sözdizimi ve türler'],
  ['Ejemplo', 'Example', 'Exemple', 'Beispiel', 'Exemplo', 'Exemplo', 'Esempio', 'Örnek'],
  ['Columna o número', 'Property or number', 'Propriété ou nombre', 'Eigenschaft oder Zahl', 'Propriedade ou número', 'Propriedade ou número', 'Proprietà o numero', 'Özellik veya sayı'],
  ['Número fijo', 'Fixed number', 'Nombre fixe', 'Feste Zahl', 'Número fixo', 'Número fixo', 'Numero fisso', 'Sabit sayı'],
  ['Mostrar valores únicos', 'Show unique values', 'Afficher les valeurs uniques', 'Eindeutige Werte anzeigen', 'Mostrar valores únicos', 'Mostrar valores únicos', 'Mostra valori univoci', 'Benzersiz değerleri göster'],
  ['Contar vacíos', 'Count empty', 'Compter les vides', 'Leere zählen', 'Contar vazios', 'Contar vazios', 'Conta vuoti', 'Boşları say'],
  ['% vacíos', '% empty', '% vides', '% leer', '% vazios', '% vazios', '% vuoti', '% boş'],
  ['% con valor', '% not empty', '% avec valeur', '% mit Wert', '% com valor', '% com valor', '% con valore', '% dolu'],
  ['Mediana', 'Median', 'Médiane', 'Median', 'Mediana', 'Mediana', 'Mediana', 'Medyan'],
  ['Fecha más temprana', 'Earliest date', 'Date la plus ancienne', 'Frühestes Datum', 'Data mais antiga', 'Data mais antiga', 'Data meno recente', 'En erken tarih'],
  ['Fecha más tardía', 'Latest date', 'Date la plus récente', 'Spätestes Datum', 'Data mais recente', 'Data mais recente', 'Data più recente', 'En geç tarih'],
  ['Rango de fechas', 'Date range', 'Plage de dates', 'Datumsbereich', 'Intervalo de datas', 'Intervalo de datas', 'Intervallo di date', 'Tarih aralığı'],
  ['Marcadas', 'Checked', 'Cochées', 'Markiert', 'Marcadas', 'Marcadas', 'Selezionate', 'İşaretli'],
  ['Sin marcar', 'Unchecked', 'Non cochées', 'Nicht markiert', 'Não marcadas', 'Desmarcadas', 'Non selezionate', 'İşaretsiz'],
  ['% sin marcar', '% unchecked', '% non cochées', '% nicht markiert', '% não marcadas', '% desmarcadas', '% non selezionate', '% işaretsiz'],
  ['text', 'text', 'texte', 'Text', 'texto', 'texto', 'testo', 'metin'],
  ['number', 'number', 'nombre', 'Zahl', 'número', 'número', 'numero', 'sayı'],
  ['date', 'date', 'date', 'Datum', 'data', 'data', 'data', 'tarih'],
  ['json', 'JSON', 'JSON', 'JSON', 'JSON', 'JSON', 'JSON', 'JSON'],
] as const;

function language(index: number): Record<string, string> {
  return Object.fromEntries(catalog.map((row) => [row[0], row[index]]));
}

export const DATABASE_RELATION_FORMULA_TRANSLATIONS = {
  en: language(1), fr: language(2), de: language(3), pt: language(4), 'pt-BR': language(5), it: language(6), tr: language(7),
} as const;
