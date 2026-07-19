/* Test-only excerpt from IDprotector v0.4.1 app.js.
 * It preserves the exact regulatory literals used by the parity suite.
 * Runtime code must not import this fixture. See ../../README.md.
 */
  var EU_REGULATION_URLS = {
    es: "https://eur-lex.europa.eu/eli/reg/2016/679/oj/spa",
    en: "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng",
    fr: "https://eur-lex.europa.eu/eli/reg/2016/679/oj/fra",
    pt: "https://eur-lex.europa.eu/eli/reg/2016/679/oj/por",
    de: "https://eur-lex.europa.eu/eli/reg/2016/679/oj/deu",
    it: "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"
  };
  var DPA_AUTHORITIES = [
    { code: "AT", country: "Austria", name: "Österreichische Datenschutzbehörde (DSB)", url: "https://www.dsb.gv.at/" },
    { code: "BE", country: "Belgium", name: "Autorité de protection des données / Gegevensbeschermingsautoriteit (APD-GBA)", url: "https://www.autoriteprotectiondonnees.be/" },
    { code: "BG", country: "Bulgaria", name: "Commission for Personal Data Protection (CPDP)", url: "https://www.cpdp.bg/" },
    { code: "HR", country: "Croatia", name: "Agencija za zaštitu osobnih podataka (AZOP)", url: "https://azop.hr/" },
    { code: "CY", country: "Cyprus", name: "Office of the Commissioner for Personal Data Protection", url: "https://www.dataprotection.gov.cy/" },
    { code: "CZ", country: "Czech Republic", name: "Úřad pro ochranu osobních údajů (ÚOOÚ)", url: "https://uoou.gov.cz/" },
    { code: "DK", country: "Denmark", name: "Datatilsynet", url: "https://www.datatilsynet.dk/" },
    { code: "EE", country: "Estonia", name: "Andmekaitse Inspektsioon (AKI)", url: "https://www.aki.ee/" },
    { code: "FI", country: "Finland", name: "Tietosuojavaltuutetun toimisto", url: "https://tietosuoja.fi/" },
    { code: "FR", country: "France", name: "Commission Nationale de l'Informatique et des Libertés (CNIL)", url: "https://www.cnil.fr/" },
    { code: "DE", country: "Germany", name: "Die Bundesbeauftragte für den Datenschutz und die Informationsfreiheit (BfDI)", url: "https://www.bfdi.bund.de/" },
    { code: "GR", country: "Greece", name: "Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα (HDPA)", url: "https://www.dpa.gr/" },
    { code: "HU", country: "Hungary", name: "Nemzeti Adatvédelmi és Információszabadság Hatóság (NAIH)", url: "https://naih.hu/" },
    { code: "IS", country: "Iceland", name: "Persónuvernd", url: "https://www.personuvernd.is/" },
    { code: "IE", country: "Ireland", name: "Data Protection Commission (DPC)", url: "https://www.dataprotection.ie/" },
    { code: "IT", country: "Italy", name: "Garante per la protezione dei dati personali", url: "https://www.garanteprivacy.it/" },
    { code: "LV", country: "Latvia", name: "Datu valsts inspekcija (DVI)", url: "https://www.dvi.gov.lv/" },
    { code: "LI", country: "Liechtenstein", name: "Datenschutzstelle (DSS)", url: "https://www.datenschutzstelle.li/" },
    { code: "LT", country: "Lithuania", name: "Valstybinė duomenų apsaugos inspekcija (VDAI)", url: "https://vdai.lrv.lt/" },
    { code: "LU", country: "Luxembourg", name: "Commission nationale pour la protection des données (CNPD)", url: "https://cnpd.public.lu/" },
    { code: "MT", country: "Malta", name: "Information and Data Protection Commissioner (IDPC)", url: "https://idpc.org.mt/" },
    { code: "NL", country: "Netherlands", name: "Autoriteit Persoonsgegevens (AP)", url: "https://www.autoriteitpersoonsgegevens.nl/" },
    { code: "NO", country: "Norway", name: "Datatilsynet", url: "https://www.datatilsynet.no/" },
    { code: "PL", country: "Poland", name: "Urząd Ochrony Danych Osobowych (UODO)", url: "https://uodo.gov.pl/" },
    { code: "PT", country: "Portugal", name: "Comissão Nacional de Proteção de Dados (CNPD)", url: "https://www.cnpd.pt/" },
    { code: "RO", country: "Romania", name: "Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP)", url: "https://www.dataprotection.ro/" },
    { code: "SK", country: "Slovakia", name: "Úrad na ochranu osobných údajov Slovenskej republiky", url: "https://dataprotection.gov.sk/" },
    { code: "SI", country: "Slovenia", name: "Informacijski pooblaščenec (IP-RS)", url: "https://www.ip-rs.si/" },
    { code: "ES", country: "Spain", name: "Agencia Española de Protección de Datos (AEPD)", url: "https://www.aepd.es/" },
    { code: "SE", country: "Sweden", name: "Integritetsskyddsmyndigheten (IMY)", url: "https://www.imy.se/" },
    { code: "CH", country: "Switzerland", name: "Eidgenössischer Datenschutz- und Öffentlichkeitsbeauftragter (EDÖB)", url: "https://www.edoeb.admin.ch/" },
    { code: "GB", country: "United Kingdom", name: "Information Commissioner's Office (ICO)", url: "https://ico.org.uk/" }
  ];
