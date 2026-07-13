// One-off generator for the Archive document-type taxonomy data block in
// shared/archiveDocTypes.ts. Self-contained: the 188 rows + their curated English
// labels, keywords (synonyms for the semantic search), legacy-id map and per-type
// form-template assignment are all embedded here, so it re-runs without the source CSV.
// Emits the `RAW_DOC_TYPES` tuple array (paste into archiveDocTypes.ts).
//
//   node scripts/gen-archive-doc-types.mjs > /tmp/raw-doc-types.ts
//
// The tuple order is:
//   [slug, es, en, category, template, naturaleza[], epoca[], ambito[],
//    funcion[], soporteMonumental[], estatus, soporteFisico[], genealogia, keywords[]]

// ── Dimension value → [slug, en] ────────────────────────────────────────────────
const NAT = {
  'Patrimonio documental': ['documental', 'Documentary heritage'],
  'Patrimonio monumental / construido': ['monumental', 'Built / monumental heritage'],
  'Patrimonio efímero': ['efimera', 'Ephemera'],
  'Patrimonio arqueológico': ['arqueologico', 'Archaeological heritage'],
  'Patrimonio inmaterial': ['inmaterial', 'Intangible heritage'],
};
const EP = {
  'Prehistoria / Antigüedad': ['antiguo', 'Prehistory / Antiquity'],
  'Época medieval': ['medieval', 'Medieval'],
  'Época moderna': ['moderna', 'Early modern'],
  'Época contemporánea': ['contemporanea', 'Contemporary'],
  'Actualidad': ['actual', 'Present day'],
  'Transversal': ['transversal', 'Cross-period'],
};
const AMB = {
  'Civil': ['civil', 'Civil'],
  'Comercial': ['comercial', 'Commercial'],
  'Doméstico': ['domestico', 'Domestic'],
  'Educativo': ['educativo', 'Educational'],
  'Funerario': ['funerario', 'Funerary'],
  'Heráldico': ['heraldico', 'Heraldic'],
  'Judicial': ['judicial', 'Judicial'],
  'Laboral': ['laboral', 'Labour'],
  'Militar': ['militar', 'Military'],
  'Notarial': ['notarial', 'Notarial'],
  'Ocio y cultura popular': ['ocio', 'Leisure & popular culture'],
  'Prensa': ['prensa', 'Press'],
  'Religioso': ['religioso', 'Religious'],
  'Sanitario': ['sanitario', 'Health'],
};
const FUN = {
  'Registro vital': ['registro_vital', 'Vital record'],
  'Expediente / trámite': ['expediente', 'File / procedure'],
  'Correspondencia': ['correspondencia', 'Correspondence'],
  'Escrito personal / narrativo': ['narrativo', 'Personal / narrative writing'],
  'Base de datos / transcripción': ['datos', 'Database / transcription'],
};
const SM = {
  'Arquitectura civil': ['arq_civil', 'Civil architecture'],
  'Arquitectura funeraria': ['arq_funeraria', 'Funerary architecture'],
  'Arquitectura militar / defensiva': ['arq_militar', 'Military / defensive architecture'],
  'Arquitectura religiosa': ['arq_religiosa', 'Religious architecture'],
  'Arquitectura rural / vernácula': ['arq_rural', 'Rural / vernacular architecture'],
  'Elemento natural': ['elem_natural', 'Natural feature'],
  'Elemento urbano menor': ['elem_urbano', 'Minor urban feature'],
  'Infraestructura': ['infraestructura', 'Infrastructure'],
};
const EST = {
  'Bien declarado': ['declarado', 'Listed / protected'],
  'Sin protección formal': ['sin_proteccion', 'No formal protection'],
};
const SF = {
  'Fotográfico': ['fotografico', 'Photographic'],
  'Impreso': ['impreso', 'Printed'],
  'Manuscrito': ['manuscrito', 'Manuscript'],
  'Objeto': ['objeto', 'Object'],
};

// Legacy ids that MUST be preserved (existing archive_items.doc_type values + bespoke forms).
const LEGACY = {
  'Partida de nacimiento': 'birth_record',
  'Partida de bautismo': 'baptism_record',
  'Partida de matrimonio': 'marriage_record',
  'Partida de defunción': 'death_record',
  'Censo / Padrón': 'census',
  'Trámite administrativo': 'administrative',
  'Registro militar': 'military',
  'Registro de migración': 'migration',
  'Diario': 'diary',
  'Memorias': 'memoirs',
  'Correspondencia': 'letter',
  'Notas': 'notes',
  'Fotografía': 'photograph',
  'Ilustración': 'illustration',
  'Obra (artística)': 'artwork',
  'Mapa / Plano': 'map',
  'Base de datos': 'database',
  'Índice / Transcripción': 'transcription',
  'Otro documento': 'other_doc',
};

// English labels for all 188 elements.
const EN = {
  'Acta de asociación / sociedad': 'Association / society minutes',
  'Acta de pleno municipal / cabildo': 'Town-council / cabildo minutes',
  'Acta notarial': 'Notarial deed',
  'Acueducto': 'Aqueduct',
  'Anuncio de prensa': 'Newspaper advertisement',
  'Árbol genealógico anterior': 'Earlier family tree',
  'Arco triunfal': 'Triumphal arch',
  'Arrendamiento / contrato de colonia': 'Lease / tenancy contract',
  'Atalaya / torre vigía': 'Watchtower',
  'Auto de fe / expediente inquisitorial': 'Auto-da-fé / Inquisition file',
  'Ayuntamiento histórico': 'Historic town hall',
  'Bando / ordenanza municipal': 'Proclamation / municipal ordinance',
  'Base de datos': 'Database',
  'Bien de Interés Cultural (BIC)': 'Listed heritage asset (BIC)',
  'Billete de embarque': 'Boarding / embarkation ticket',
  'Billete de transporte': 'Transport ticket',
  'Bodega / lagar tradicional': 'Traditional winery / press house',
  'Bula / indulgencia': 'Papal bull / indulgence',
  'Búnker / fortificación': 'Bunker / fortification',
  'Caja de cerillas / fosforera': 'Matchbox',
  'Calendario publicitario': 'Advertising calendar',
  'Calzada romana': 'Roman road',
  'Campana (con inscripción fundacional)': 'Bell (with foundational inscription)',
  'Carta de aprendizaje / examen de maestría (gremio)': 'Apprenticeship / guild mastership record',
  'Carta de fundación': 'Foundation charter',
  'Carta de naturaleza / nacionalización': 'Naturalisation / citizenship record',
  'Carta de pago / recibo de deuda': 'Payment receipt / debt acquittance',
  'Cárcel histórica': 'Historic prison',
  'Cartel / póster': 'Poster',
  'Cartilla de la seguridad social / mutualidad': 'Social-security / mutual-fund booklet',
  'Cartilla militar / libreta de servicio': 'Military service booklet',
  'Castillo / fortaleza': 'Castle / fortress',
  'Castro': 'Hillfort (castro)',
  'Catedral': 'Cathedral',
  'Causa penal / sumario': 'Criminal case / indictment',
  'Cédula de identidad': 'Identity card',
  'Cementerio histórico': 'Historic cemetery',
  'Cenotafio': 'Cenotaph',
  'Censo / Padrón': 'Census / register of inhabitants',
  'Censo enfitéutico / foro': 'Emphyteusis / ground rent',
  'Certificado de vacunación': 'Vaccination certificate',
  'Chapa / pin conmemorativo': 'Commemorative pin / badge',
  'Chimenea industrial': 'Industrial chimney',
  'Colegiata': 'Collegiate church',
  'Concordia (acuerdo entre partes)': 'Concordia (settlement between parties)',
  'Conjunto histórico-artístico': 'Historic-artistic ensemble',
  'Contrato de matrimonio civil': 'Civil marriage contract',
  'Contrato de trabajo': 'Employment contract',
  'Correspondencia': 'Correspondence',
  'Cromo / álbum de cromos': 'Trading card / sticker album',
  'Cruceiro / cruz de piedra': 'Stone wayside cross (cruceiro)',
  'Cruz de término o de cementerio': 'Boundary / cemetery cross',
  'Decreto / ley histórica': 'Decree / historic law',
  'Denuncia / atestado policial': 'Police report / complaint',
  'Diario': 'Diary',
  'Diploma o certificado decorativo': 'Decorative diploma / certificate',
  'Ejecutoria (de hidalguía u otra)': 'Ejecutoria (patent of nobility / judgment)',
  'Entrada / billete de espectáculo': 'Event / show ticket',
  'Envoltorio / etiqueta de producto': 'Product wrapper / label',
  'Ermita / capilla': 'Hermitage / chapel',
  'Escritura de compraventa': 'Deed of sale',
  'Escudo de armas / expediente heráldico': 'Coat of arms / heraldic file',
  'Escudo de casa (piedra armera)': 'House coat of arms (armorial stone)',
  'Escudo heráldico en fachada': 'Heraldic shield on façade',
  'Esquela / necrológica': 'Death notice / obituary',
  'Estación de ferrocarril histórica': 'Historic railway station',
  'Estatua / busto conmemorativo': 'Commemorative statue / bust',
  'Etiqueta de correspondencia comercial': 'Commercial letterhead / label',
  'Etiqueta de equipaje / hotel': 'Luggage / hotel label',
  'Ex-libris': 'Ex-libris (bookplate)',
  'Expediente académico / matrícula escolar': 'Academic record / school enrolment',
  'Expediente de depuración / represión política': 'Purge / political-repression file',
  'Expediente de dispensa matrimonial': 'Marriage dispensation file',
  'Expediente de hidalguía / nobleza': 'Nobility / hidalguía file',
  'Expediente de limpieza de sangre': 'Blood-purity (limpieza de sangre) file',
  'Expediente de ordenación sacerdotal': 'Priestly ordination file',
  'Expediente de quintas / sorteo': 'Conscription / draft file',
  'Expediente penitenciario': 'Prison / penitentiary file',
  'Fábrica histórica': 'Historic factory',
  'Faro': 'Lighthouse',
  'Folleto publicitario': 'Advertising leaflet',
  'Fotografía': 'Photograph',
  'Fuente monumental': 'Monumental fountain',
  'Fuero / carta de población': 'Charter of privileges / settlement charter',
  'Grabado / litografía': 'Engraving / lithograph',
  'Hoja de servicios': 'Service record',
  'Horno de pan / de cal': 'Bread / lime oven',
  'Hospital histórico': 'Historic hospital',
  'Hórreo': 'Raised granary (hórreo)',
  'Iglesia': 'Church',
  'Ilustración': 'Illustration',
  'Índice / Transcripción': 'Index / transcription',
  'Inventario post-mortem': 'Post-mortem inventory',
  'Invitación': 'Invitation',
  'Jardín histórico': 'Historic garden',
  'Juguete de papel / recortable': 'Paper toy / cut-out',
  'Libro de cofradía / hermandad': 'Confraternity / brotherhood book',
  'Libro de confirmaciones': 'Register of confirmations',
  'Libro de cuentas familiar': 'Family account book',
  'Libro de defunciones por epidemia': 'Epidemic deaths register',
  'Libro de escolaridad / calificaciones': 'School / grades record',
  'Libro de fábrica parroquial': 'Parish fabric account book',
  'Libro de familia': 'Family record book',
  'Lonja / mercado histórico': 'Historic exchange / market hall',
  'Mapa / Plano': 'Map / plan',
  'Matrícula del mar': 'Seafarers register (matrícula del mar)',
  'Mayorazgo / vínculo': 'Entailed estate (mayorazgo)',
  'Medalla conmemorativa': 'Commemorative medal',
  'Memorias': 'Memoirs',
  'Menú de restaurante o banquete': 'Restaurant / banquet menu',
  'Miliario': 'Milestone (miliario)',
  'Mojón / hito de término': 'Boundary marker',
  'Molino': 'Mill',
  'Monasterio / convento': 'Monastery / convent',
  'Moneda histórica': 'Historic coin',
  'Monumento a los caídos': 'War / fallen memorial',
  'Muralla': 'City wall',
  'Naipe / baraja publicitaria': 'Playing card / advertising deck',
  'Necrópolis': 'Necropolis',
  'Necrópolis judía': 'Jewish necropolis',
  'Nicho / columbario': 'Niche / columbarium',
  'Noria / pozo': 'Waterwheel / well',
  'Notas': 'Notes',
  'Nómina / libro de jornales': 'Payroll / wage book',
  'Obelisco': 'Obelisk',
  'Obra (artística)': 'Artwork',
  'Otro documento': 'Other document',
  'Padrón de riqueza / catastro': 'Wealth register / cadastre',
  'Palacio / casona indiana': 'Palace / indiano manor house',
  'Palomar': 'Dovecote',
  'Panteón / mausoleo familiar': 'Family pantheon / mausoleum',
  'Panteón de hombres ilustres': 'Pantheon of illustrious figures',
  'Papel moneda local / vale de emergencia': 'Local banknote / emergency scrip',
  'Parte de guerra / correspondencia militar': 'War dispatch / military correspondence',
  'Partición de herencia': 'Partition of an estate',
  'Partida de bautismo': 'Baptism record',
  'Partida de defunción': 'Death record',
  'Partida de matrimonio': 'Marriage record',
  'Partida de nacimiento': 'Birth record',
  'Partitura o cancionero popular': 'Sheet music / popular songbook',
  'Pasaporte / salvoconducto': 'Passport / safe-conduct',
  'Patente o privilegio industrial': 'Patent / industrial privilege',
  'Patrimonio de la Humanidad (UNESCO)': 'World Heritage Site (UNESCO)',
  'Petroglifo': 'Petroglyph',
  'Pila bautismal histórica': 'Historic baptismal font',
  'Placa conmemorativa': 'Commemorative plaque',
  'Plaza mayor histórica': 'Historic main square',
  'Pleito civil': 'Civil lawsuit',
  'Poder notarial': 'Power of attorney',
  'Postal': 'Postcard',
  'Poste indicador antiguo': 'Old signpost',
  'Presa / azud histórico': 'Historic dam / weir',
  'Privilegio real / merced': 'Royal privilege / grant',
  'Profesión religiosa / toma de hábito': 'Religious profession / taking of vows',
  'Programa de mano': 'Programme (playbill)',
  'Protocolo notarial': 'Notarial protocol',
  'Pósito': 'Communal grain store (pósito)',
  'Puente histórico': 'Historic bridge',
  'Puerto histórico': 'Historic port',
  'Publicidad recortada de prensa': 'Clipped press advertisement',
  'Real cédula': 'Royal decree (real cédula)',
  'Recorte de hemeroteca / noticia de periódico': 'Press clipping / news item',
  'Recordatorio religioso': 'Religious remembrance card',
  'Registro de migración': 'Migration record',
  'Registro militar': 'Military record',
  'Reloj de sol': 'Sundial',
  'Retablo': 'Altarpiece (retablo)',
  'Ruta o camino histórico': 'Historic route / road',
  'Santuario': 'Sanctuary / shrine',
  'Sello / viñeta (fiscal, benéfica, conmemorativa)': 'Stamp / seal (fiscal, charity, commemorative)',
  'Sello postal (filatelia)': 'Postage stamp (philately)',
  'Sentencia judicial': 'Court ruling',
  'Sepulcro / arca funeraria': 'Tomb / funerary chest',
  'Sinagoga / mezquita histórica': 'Historic synagogue / mosque',
  'Sitio histórico': 'Historic site',
  'Tarjeta de visita / felicitación': 'Visiting / greeting card',
  'Tebeo / cómic': 'Comic',
  'Teatro histórico': 'Historic theatre',
  'Testamento / codicilo': 'Will / codicil',
  'Título o diploma': 'Degree / diploma',
  'Torre defensiva / torreón': 'Defensive tower',
  'Trámite administrativo': 'Administrative procedure',
  'Universidad histórica': 'Historic university',
  'Vale / cupón / bono de racionamiento': 'Ration voucher / coupon',
  'Vía crucis / hornacina': 'Way of the Cross / niche shrine',
  'Villa romana': 'Roman villa',
  'Visita pastoral': 'Pastoral visitation',
  'Yacimiento arqueológico': 'Archaeological site',
};

// Extra synonyms (semantic search). Base keywords are derived from the label tokens;
// these add cross-language + colloquial terms so an inexact query still surfaces the type.
const KW = {
  'Lápida': ['tumba', 'sepultura', 'epitafio', 'gravestone', 'tombstone'],
  'Sepulcro / arca funeraria': ['tumba', 'sarcófago', 'tomb', 'grave'],
  'Panteón / mausoleo familiar': ['tumba', 'cripta', 'mausoleum', 'vault', 'grave'],
  'Nicho / columbario': ['tumba', 'urna', 'niche', 'grave'],
  'Cenotafio': ['monumento funerario', 'cenotaph', 'memorial'],
  'Cementerio histórico': ['camposanto', 'necrópolis', 'graveyard', 'cemetery'],
  'Partida de nacimiento': ['nacimiento', 'natalicio', 'birth', 'born'],
  'Partida de bautismo': ['bautizo', 'baptism', 'christening'],
  'Partida de matrimonio': ['boda', 'casamiento', 'matrimonio', 'wedding', 'marriage'],
  'Partida de defunción': ['muerte', 'fallecimiento', 'óbito', 'death', 'burial'],
  'Censo / Padrón': ['empadronamiento', 'vecindario', 'census', 'roll'],
  'Testamento / codicilo': ['última voluntad', 'herencia', 'will', 'testament'],
  'Escritura de compraventa': ['venta', 'compra', 'propiedad', 'deed', 'sale'],
  'Fotografía': ['foto', 'retrato', 'photo', 'picture'],
  'Correspondencia': ['carta', 'cartas', 'misiva', 'letter', 'mail'],
  'Diario': ['dietario', 'journal', 'diary'],
  'Memorias': ['autobiografía', 'recuerdos', 'memoir'],
  'Mapa / Plano': ['cartografía', 'plano', 'map', 'chart'],
  'Castillo / fortaleza': ['fortaleza', 'alcázar', 'castle', 'fortress'],
  'Iglesia': ['parroquia', 'templo', 'church', 'parish'],
  'Ermita / capilla': ['capilla', 'chapel', 'hermitage'],
  'Muralla': ['murallas', 'wall', 'rampart'],
  'Molino': ['aceña', 'mill', 'windmill', 'watermill'],
  'Puente histórico': ['bridge'],
  'Postal': ['tarjeta postal', 'postcard'],
  'Cartel / póster': ['afiche', 'poster', 'billboard'],
  'Folleto publicitario': ['panfleto', 'flyer', 'leaflet', 'brochure'],
  'Cromo / álbum de cromos': ['estampa', 'sticker', 'trading card'],
  'Envoltorio / etiqueta de producto': ['etiqueta', 'wrapper', 'label', 'packaging'],
  'Moneda histórica': ['numismática', 'coin', 'currency'],
  'Sello postal (filatelia)': ['timbre', 'estampilla', 'stamp'],
  'Pasaporte / salvoconducto': ['passport', 'travel document'],
  'Expediente de hidalguía / nobleza': ['nobleza', 'hidalgo', 'nobility'],
  'Escudo de armas / expediente heráldico': ['heráldica', 'blasón', 'coat of arms', 'crest'],
  'Yacimiento arqueológico': ['excavación', 'ruinas', 'archaeological', 'dig', 'ruins'],
  'Dolmen': ['megalito', 'dolmen'],
  'Bien de Interés Cultural (BIC)': ['protegido', 'catalogado', 'listed', 'heritage'],
  'Decreto / ley histórica': ['ley', 'norma', 'legislación', 'law', 'decree', 'statute'],
  'Sentencia judicial': ['fallo', 'veredicto', 'ruling', 'judgment'],
  'Pleito civil': ['litigio', 'demanda', 'lawsuit', 'litigation'],
  'Causa penal / sumario': ['proceso', 'juicio penal', 'criminal case', 'trial'],
};

// ── Category (dropdown grouping) + form template, from naturaleza/ambito/función ──
function pick(list) { return (list || '').split(';')[0].trim(); }

function categoryAndTemplate(row, legacyId) {
  const nat = pick(row.Naturaleza_patrimonio);
  const amb = pick(row.Ambito_tematico);
  const fun = pick(row.Funcion_documental);
  const el = row.Elemento;

  // Legacy types keep their own bespoke fields (template 'legacy') + original category.
  const LEGACY_CAT = {
    birth_record: 'vital', baptism_record: 'vital', marriage_record: 'vital', death_record: 'vital',
    census: 'administrativo', administrative: 'administrativo', military: 'militar', migration: 'administrativo',
    diary: 'narrative', memoirs: 'narrative', letter: 'narrative', notes: 'narrative',
    photograph: 'visual', illustration: 'visual', artwork: 'visual', map: 'visual',
    database: 'data', transcription: 'data', other_doc: 'other',
  };
  if (legacyId) return [LEGACY_CAT[legacyId], 'legacy'];

  if (nat === 'Patrimonio monumental / construido') return ['monumental', 'monumento'];
  if (nat === 'Patrimonio arqueológico') return ['arqueologico', 'arqueologico'];
  if (nat === 'Patrimonio efímero') return ['efimera', 'efimera'];

  // Documentary heritage → by ámbito / función.
  if (fun === 'Base de datos / transcripción') return ['data', 'datos'];
  if (fun === 'Correspondencia') return ['narrative', 'correspondencia'];
  if (fun === 'Escrito personal / narrativo') {
    if (amb === 'Prensa') return ['prensa', 'prensa'];
    return ['narrative', 'personal'];
  }
  if (fun === 'Registro vital') {
    if (amb === 'Religioso') return ['eclesiastico', 'eclesiastico'];
    return ['vital', 'vital'];
  }
  // Expediente / trámite branch, by ámbito.
  switch (amb) {
    case 'Notarial': return ['notarial', 'notarial'];
    case 'Judicial': return ['judicial', 'judicial'];
    case 'Religioso': return ['eclesiastico', 'eclesiastico'];
    case 'Militar': return ['militar', 'militar'];
    case 'Educativo': return ['educativo', 'educativo'];
    case 'Sanitario': return ['sanitario', 'sanitario'];
    case 'Laboral': return ['laboral', 'laboral'];
    case 'Heráldico': return ['heraldico', 'heraldico'];
    case 'Prensa': return ['prensa', 'prensa'];
    case 'Ocio y cultura popular': return ['visual', 'visual'];
    default: return ['administrativo', 'administrativo'];
  }
}

function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

function mapMulti(raw, table) {
  return (raw || '').split(';').map((v) => v.trim()).filter(Boolean)
    .map((v) => (table[v] ? table[v][0] : null)).filter(Boolean);
}

// ── CSV parse (RFC-4180-ish; handles quoted commas) ─────────────────────────────
import fs from 'node:fs';
const CSV = process.env.CSV || '/private/tmp/claude-501/-Users-jorgepb96-Documents-GitHub-nodus/b187be89-73f6-46e8-bda6-294c31116c1c/scratchpad/genealogy_archive_doc_types.csv';
function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; } }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const lines = parseCsv(fs.readFileSync(CSV, 'utf8'));
const header = lines[0];
const recs = lines.slice(1).map((cols) => Object.fromEntries(header.map((h, i) => [h, cols[i] ?? ''])));

// Elements the user named that never made it into the CSV consolidation (Lápida was
// their headline monument example; megaliths were listed too). Added here so the
// generator stays the single source of truth.
const EXTRA = [
  {
    Elemento: 'Lápida / losa sepulcral', Naturaleza_patrimonio: 'Patrimonio monumental / construido',
    Epoca: 'Transversal', Ambito_tematico: 'Funerario', Funcion_documental: '',
    Soporte_monumental: 'Arquitectura funeraria', Estatus_proteccion: 'Sin protección formal', Soporte_fisico: '', Genealogia: 'Sí',
  },
  {
    Elemento: 'Epitafio', Naturaleza_patrimonio: 'Patrimonio documental',
    Epoca: 'Transversal', Ambito_tematico: 'Funerario', Funcion_documental: 'Escrito personal / narrativo',
    Soporte_monumental: '', Estatus_proteccion: '', Soporte_fisico: '', Genealogia: 'Sí',
  },
  {
    Elemento: 'Dolmen / menhir / túmulo megalítico', Naturaleza_patrimonio: 'Patrimonio arqueológico',
    Epoca: 'Prehistoria / Antigüedad', Ambito_tematico: '', Funcion_documental: '',
    Soporte_monumental: 'Elemento natural', Estatus_proteccion: 'Bien declarado', Soporte_fisico: '', Genealogia: 'No',
  },
];
EN['Lápida / losa sepulcral'] = 'Gravestone / grave slab';
EN['Epitafio'] = 'Epitaph';
EN['Dolmen / menhir / túmulo megalítico'] = 'Dolmen / menhir / megalithic mound';
KW['Lápida / losa sepulcral'] = ['tumba', 'sepultura', 'gravestone', 'tombstone', 'headstone'];
KW['Epitafio'] = ['inscripción funeraria', 'epitaph', 'inscription'];
KW['Dolmen / menhir / túmulo megalítico'] = ['megalito', 'megalith', 'dolmen', 'menhir', 'tumulus'];
recs.push(...EXTRA);

const usedSlugs = new Set();
const out = [];
for (const r of recs) {
  const el = r.Elemento.trim();
  const legacyId = LEGACY[el] || null;
  const [category, template] = categoryAndTemplate(r, legacyId);
  let slug = legacyId || slugify(el);
  while (usedSlugs.has(slug)) slug += '_x';
  usedSlugs.add(slug);
  const en = EN[el] || el;
  const nat = mapMulti(r.Naturaleza_patrimonio, NAT);
  const ep = mapMulti(r.Epoca, EP);
  const amb = mapMulti(r.Ambito_tematico, AMB);
  const fun = mapMulti(r.Funcion_documental, FUN);
  const sm = mapMulti(r.Soporte_monumental, SM);
  const estRaw = pick(r.Estatus_proteccion);
  const est = EST[estRaw] ? EST[estRaw][0] : '';
  const sf = mapMulti(r.Soporte_fisico, SF);
  const gen = r.Genealogia.trim() === 'Sí';
  // Keywords: label tokens + curated synonyms.
  const base = new Set();
  for (const w of `${el} ${en}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)) {
    if (w.length >= 4) base.add(w);
  }
  const kw = [...new Set([...(KW[el] || [])])];
  const j = (arr) => `[${arr.map((x) => `'${x}'`).join(',')}]`;
  out.push(`  ['${slug}', ${JSON.stringify(el)}, ${JSON.stringify(en)}, '${category}', '${template}', ${j(nat)}, ${j(ep)}, ${j(amb)}, ${j(fun)}, ${j(sm)}, '${est}', ${j(sf)}, ${gen}, ${JSON.stringify(kw)}],`);
}
console.log(`// ${out.length} document types — generated by scripts/gen-archive-doc-types.mjs`);
console.log('export const RAW_DOC_TYPES: RawDocType[] = [');
console.log(out.join('\n'));
console.log('];');
