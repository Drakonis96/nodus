// A curated, self-consistent genealogy demo: the Serrano–Vidal family across four
// generations in 19th-century Andalusia. It exists so a first-time genealogist can
// see EVERY feature of the genealogy vault populated and connected — the tree,
// Personas fichas, the Timeline, the evidence Archive with typed documents linked to
// people, place hierarchy, cited evidence, and (crucially) the evidence-driven AI:
// open kinship SUGGESTIONS awaiting review and document↔person discovery — without a
// GEDCOM import or an AI key. Portraits are generated separately (Gemini) if a key is
// present; otherwise the tree simply shows the default silhouettes.
//
// Every id is prefixed `demo-` so the data removes surgically and can never collide
// with real, scanned content. Seeding flips the active vault to the `genealogy` type
// (remembering the prior type so leaving the demo restores it) and is only ever
// allowed on an empty vault. Person names, place names and verbatim record text stay
// in their original Spanish; UI-facing titles follow the interface language.

import { getDb } from './database';
import { getSettings, updateSettings } from './settingsRepo';
import { getActiveVault, setVaultType } from '../vaults/vaultRegistry';
import { parseHistoricalDate } from '@shared/genealogyDates';
import type { VaultType } from '@shared/types';

type Localized = { es: string; en: string };
function loc(v: Localized): string {
  return getSettings().uiLanguage === 'es' ? v.es : v.en;
}

// ── Curated data ───────────────────────────────────────────────────────────────

interface DemoPerson {
  id: string;
  name: string;
  sex: 'male' | 'female';
  birth: string | null;
  death: string | null;
  /** Appearance/era hint for the daguerreotype portrait prompt. */
  portrait: string;
}

const PERSONS: DemoPerson[] = [
  { id: 'demo-p1', name: 'Bartolomé Serrano Ortega', sex: 'male', birth: '1838', death: '1901', portrait: 'a stern middle-aged man with a full grey beard and dark frock coat, 1870s' },
  { id: 'demo-p2', name: 'Rosalía Campos Ríos', sex: 'female', birth: 'c. 1842', death: '1919', portrait: 'an elderly woman with hair parted in the centre and a dark lace shawl, 1870s' },
  { id: 'demo-p3', name: 'Ignacio Vidal Moreno', sex: 'male', birth: '1836', death: '1898', portrait: 'a bearded man in a high collar and cravat, serious expression, 1860s' },
  { id: 'demo-p4', name: 'Manuela Ferrer Blanco', sex: 'female', birth: '1841', death: '1907', portrait: 'a woman with a modest bun and a buttoned dark dress, 1860s' },
  { id: 'demo-p5', name: 'Tomás Serrano Campos', sex: 'male', birth: '12 de marzo de 1865', death: '1932', portrait: 'a moustached man in his forties, dark suit and waistcoat, 1900s' },
  { id: 'demo-p6', name: 'Dolores Serrano Campos', sex: 'female', birth: '1868', death: '1941', portrait: 'a woman with dark hair drawn back and a high-necked blouse, 1890s' },
  { id: 'demo-p7', name: 'Encarnación Vidal Ferrer', sex: 'female', birth: '1867', death: '1940', portrait: 'a poised woman with an ornate comb and mantilla, 1890s' },
  { id: 'demo-p8', name: 'Rafael Serrano Vidal', sex: 'male', birth: '1890', death: '1961', portrait: 'a young clean-shaven man with a side parting and a tie, 1910s' },
  { id: 'demo-p9', name: 'Amparo Serrano Vidal', sex: 'female', birth: '1893', death: '1975', portrait: 'a young woman with waved hair and a lace collar, 1910s' },
  { id: 'demo-p10', name: 'Vicente Serrano Vidal', sex: 'male', birth: '1896', death: '1918', portrait: 'a very young man in a soldier’s tunic, short hair, 1910s' },
  { id: 'demo-p11', name: 'Josefa Marín León', sex: 'female', birth: '1895', death: '1980', portrait: 'a young woman with a bobbed style and a beaded necklace, 1920s' },
  { id: 'demo-p12', name: 'Carmen Serrano Marín', sex: 'female', birth: '1921', death: '2004', portrait: 'a girl with plaited hair and a pinafore, 1930s' },
  { id: 'demo-p14', name: 'Casimiro Reyes Pardo', sex: 'male', birth: '1861', death: '1930', portrait: 'a heavyset man with a moustache and a watch chain, 1890s' },
  { id: 'demo-p15', name: 'Lucía Reyes Serrano', sex: 'female', birth: '1892', death: '1969', portrait: 'a young woman with a centre parting and a plain dark dress, 1910s' },
];

/** Extra name spellings/variants (for the identity-matching demo). */
const NAME_VARIANTS: { personId: string; name: string; kind: string }[] = [
  { personId: 'demo-p7', name: 'Encarna Vidal', kind: 'apodo' },
  { personId: 'demo-p7', name: 'Encarnación Vidal y Ferrer', kind: 'registro' },
  { personId: 'demo-p5', name: 'Tomás Serrano', kind: 'variante' },
  { personId: 'demo-p1', name: 'Bartolomé Serrano', kind: 'variante' },
];

interface DemoRel {
  from: string;
  to: string;
  type: 'parent' | 'spouse';
  provenance: 'user_asserted' | 'ai_confirmed';
}
const RELATIONSHIPS: DemoRel[] = [
  { from: 'demo-p1', to: 'demo-p5', type: 'parent', provenance: 'user_asserted' },
  { from: 'demo-p2', to: 'demo-p5', type: 'parent', provenance: 'user_asserted' },
  { from: 'demo-p1', to: 'demo-p6', type: 'parent', provenance: 'user_asserted' },
  { from: 'demo-p2', to: 'demo-p6', type: 'parent', provenance: 'user_asserted' },
  { from: 'demo-p3', to: 'demo-p7', type: 'parent', provenance: 'user_asserted' },
  { from: 'demo-p4', to: 'demo-p7', type: 'parent', provenance: 'user_asserted' },
  { from: 'demo-p5', to: 'demo-p8', type: 'parent', provenance: 'ai_confirmed' },
  { from: 'demo-p7', to: 'demo-p8', type: 'parent', provenance: 'ai_confirmed' },
  { from: 'demo-p5', to: 'demo-p9', type: 'parent', provenance: 'user_asserted' },
  { from: 'demo-p7', to: 'demo-p9', type: 'parent', provenance: 'user_asserted' },
  { from: 'demo-p5', to: 'demo-p10', type: 'parent', provenance: 'user_asserted' },
  { from: 'demo-p7', to: 'demo-p10', type: 'parent', provenance: 'user_asserted' },
  { from: 'demo-p8', to: 'demo-p12', type: 'parent', provenance: 'user_asserted' },
  { from: 'demo-p11', to: 'demo-p12', type: 'parent', provenance: 'user_asserted' },
  { from: 'demo-p1', to: 'demo-p2', type: 'spouse', provenance: 'user_asserted' },
  { from: 'demo-p3', to: 'demo-p4', type: 'spouse', provenance: 'user_asserted' },
  { from: 'demo-p5', to: 'demo-p7', type: 'spouse', provenance: 'ai_confirmed' },
  { from: 'demo-p8', to: 'demo-p11', type: 'spouse', provenance: 'user_asserted' },
];

interface DemoEvent {
  id: string;
  type: 'birth' | 'baptism' | 'marriage' | 'death' | 'burial' | 'census' | 'residence' | 'migration' | 'occupation' | 'other';
  date: string;
  placeId: string | null;
  label: string | null;
  participants: { personId: string; role: 'principal' | 'spouse' | 'father' | 'mother' | 'child' | 'witness' | 'officiant' | 'other' }[];
  /** Evidence pointing back at an archive item. */
  evidence?: { itemId: string; quote: string; location: string };
}
const EVENTS: DemoEvent[] = [
  {
    id: 'demo-evt1', type: 'baptism', date: '12 de marzo de 1865', placeId: 'demo-plc-parr', label: null,
    participants: [{ personId: 'demo-p5', role: 'principal' }, { personId: 'demo-p1', role: 'father' }, { personId: 'demo-p2', role: 'mother' }],
    evidence: { itemId: 'demo-ait1', quote: 'bauticé solemnemente a Tomás, hijo legítimo de Bartolomé Serrano y de Rosalía Campos', location: 'fol. 34v' },
  },
  {
    id: 'demo-evt2', type: 'marriage', date: '1889', placeId: 'demo-plc-carmona', label: null,
    participants: [{ personId: 'demo-p5', role: 'principal' }, { personId: 'demo-p7', role: 'spouse' }],
    evidence: { itemId: 'demo-ait2', quote: 'contrajeron matrimonio Tomás Serrano Campos y Encarnación Vidal Ferrer', location: 'fol. 12' },
  },
  {
    id: 'demo-evt3', type: 'baptism', date: '1890', placeId: 'demo-plc-parr', label: null,
    participants: [{ personId: 'demo-p8', role: 'principal' }, { personId: 'demo-p5', role: 'father' }, { personId: 'demo-p7', role: 'mother' }],
  },
  {
    id: 'demo-evt4', type: 'baptism', date: '1893', placeId: 'demo-plc-parr', label: null,
    participants: [{ personId: 'demo-p9', role: 'principal' }, { personId: 'demo-p5', role: 'father' }, { personId: 'demo-p7', role: 'mother' }],
  },
  {
    id: 'demo-evt5', type: 'census', date: '1900', placeId: 'demo-plc-carmona', label: 'Padrón municipal',
    participants: [
      { personId: 'demo-p5', role: 'principal' },
      { personId: 'demo-p7', role: 'spouse' },
      { personId: 'demo-p8', role: 'child' },
      { personId: 'demo-p9', role: 'child' },
      { personId: 'demo-p10', role: 'child' },
    ],
    evidence: { itemId: 'demo-ait3', quote: 'Serrano Campos, Tomás, cabeza de familia, 35 años; Vidal, Encarnación, esposa', location: 'hoja 118' },
  },
  { id: 'demo-evt6', type: 'migration', date: '1912', placeId: 'demo-plc-sevilla', label: 'Traslado a Sevilla', participants: [{ personId: 'demo-p8', role: 'principal' }] },
  {
    id: 'demo-evt7', type: 'marriage', date: '1919', placeId: 'demo-plc-sevilla', label: null,
    participants: [{ personId: 'demo-p8', role: 'principal' }, { personId: 'demo-p11', role: 'spouse' }],
  },
  {
    id: 'demo-evt8', type: 'death', date: '1918', placeId: 'demo-plc-sevilla', label: null,
    participants: [{ personId: 'demo-p10', role: 'principal' }],
    evidence: { itemId: 'demo-ait6', quote: 'falleció Vicente Serrano Vidal, de veintidós años, a consecuencia de la epidemia de gripe', location: 'fol. 8' },
  },
  { id: 'demo-evt9', type: 'baptism', date: '1921', placeId: 'demo-plc-sevilla', label: null, participants: [{ personId: 'demo-p12', role: 'principal' }, { personId: 'demo-p8', role: 'father' }, { personId: 'demo-p11', role: 'mother' }] },
  { id: 'demo-evt10', type: 'death', date: '1901', placeId: 'demo-plc-carmona', label: null, participants: [{ personId: 'demo-p1', role: 'principal' }] },
];

interface DemoPlace {
  id: string;
  name: string;
  parentId: string | null;
  kind: string;
  lat: number | null;
  lng: number | null;
  admin1?: string | null;
  country?: string | null;
  gazetteerId?: string | null;
}
const PLACES: DemoPlace[] = [
  { id: 'demo-plc-sevilla', name: 'Sevilla', parentId: null, kind: 'municipality', lat: 37.3886, lng: -5.9823, admin1: 'Andalucía', country: 'España', gazetteerId: 'geonames:2510911' },
  { id: 'demo-plc-carmona', name: 'Carmona', parentId: 'demo-plc-sevilla', kind: 'municipality', lat: 37.4713, lng: -5.6469, admin1: 'Andalucía', country: 'España', gazetteerId: 'geonames:2520118' },
  { id: 'demo-plc-parr', name: 'Parroquia de Santa María, Carmona', parentId: 'demo-plc-carmona', kind: 'parish', lat: 37.4718, lng: -5.6432, admin1: 'Andalucía', country: 'España' },
  { id: 'demo-plc-ecija', name: 'Écija', parentId: 'demo-plc-sevilla', kind: 'municipality', lat: 37.5411, lng: -5.0824, admin1: 'Andalucía', country: 'España', gazetteerId: 'geonames:2513917' },
];

/** Per-person place records → the individual maps + the general map (movements). */
interface DemoPersonPlace {
  personId: string;
  placeId: string;
  label: string;
  date: string | null;
}
const PERSON_PLACES: DemoPersonPlace[] = [
  // Founding generation, rooted in Carmona.
  { personId: 'demo-p1', placeId: 'demo-plc-carmona', label: 'residence', date: 'c. 1860' },
  { personId: 'demo-p1', placeId: 'demo-plc-carmona', label: 'death', date: '1901' },
  { personId: 'demo-p2', placeId: 'demo-plc-carmona', label: 'residence', date: 'c. 1865' },
  // Tomás Serrano — a life in Carmona.
  { personId: 'demo-p5', placeId: 'demo-plc-carmona', label: 'birth', date: '1865' },
  { personId: 'demo-p5', placeId: 'demo-plc-carmona', label: 'marriage', date: '1889' },
  { personId: 'demo-p5', placeId: 'demo-plc-carmona', label: 'residence', date: '1900' },
  { personId: 'demo-p7', placeId: 'demo-plc-carmona', label: 'residence', date: '1889' },
  { personId: 'demo-p7', placeId: 'demo-plc-sevilla', label: 'residence', date: '1912' },
  // Rafael — the emigrant to the city (Carmona → Sevilla).
  { personId: 'demo-p8', placeId: 'demo-plc-carmona', label: 'birth', date: '1890' },
  { personId: 'demo-p8', placeId: 'demo-plc-sevilla', label: 'migration', date: '1912' },
  { personId: 'demo-p8', placeId: 'demo-plc-sevilla', label: 'marriage', date: '1919' },
  { personId: 'demo-p10', placeId: 'demo-plc-carmona', label: 'birth', date: '1896' },
  { personId: 'demo-p10', placeId: 'demo-plc-sevilla', label: 'death', date: '1918' },
  { personId: 'demo-p12', placeId: 'demo-plc-sevilla', label: 'birth', date: '1921' },
  // Dolores' branch marries into Écija (the Reyes family).
  { personId: 'demo-p6', placeId: 'demo-plc-carmona', label: 'birth', date: '1868' },
  { personId: 'demo-p6', placeId: 'demo-plc-ecija', label: 'marriage', date: '1890' },
  { personId: 'demo-p14', placeId: 'demo-plc-ecija', label: 'residence', date: 'c. 1885' },
  { personId: 'demo-p15', placeId: 'demo-plc-ecija', label: 'birth', date: '1892' },
];

interface DemoArchiveItem {
  id: string;
  title: Localized;
  kind: 'image' | 'csv' | 'xlsx' | 'pdf' | 'text' | 'other';
  docType: string;
  metadata: Record<string, string>;
  text: string;
  description?: string;
  tags: string[];
  persons: string[];
}
const FOLDER = { id: 'demo-afd-1', name: { es: 'Familia Serrano — fuentes primarias', en: 'Serrano family — primary sources' } as Localized };
const ARCHIVE_ITEMS: DemoArchiveItem[] = [
  {
    id: 'demo-ait1', kind: 'pdf', docType: 'baptism',
    title: { es: 'Partida de bautismo de Tomás Serrano (1865)', en: 'Baptism record of Tomás Serrano (1865)' },
    metadata: { persona: 'Tomás Serrano Campos', fecha: '12 de marzo de 1865', padres: 'Bartolomé Serrano y Rosalía Campos', padrinos: 'Ignacio Vidal y Manuela Ferrer', parroquia_registro: 'Parroquia de Santa María, Carmona' },
    text: 'En la villa de Carmona, a doce de marzo de mil ochocientos sesenta y cinco, yo, el infrascrito cura, bauticé solemnemente a Tomás, hijo legítimo de Bartolomé Serrano Ortega y de Rosalía Campos Ríos, naturales de esta villa. Fueron sus padrinos Ignacio Vidal y Manuela Ferrer.',
    tags: ['bautismo', 'Carmona'], persons: ['demo-p5', 'demo-p1', 'demo-p2'],
  },
  {
    id: 'demo-ait2', kind: 'pdf', docType: 'marriage_record',
    title: { es: 'Acta de matrimonio de Tomás y Encarnación (1889)', en: 'Marriage record of Tomás and Encarnación (1889)' },
    metadata: { conyuge_1: 'Tomás Serrano Campos', conyuge_2: 'Encarnación Vidal Ferrer', fecha: '1889', parroquia_registro: 'Parroquia de Santa María, Carmona' },
    text: 'En Carmona, año de mil ochocientos ochenta y nueve, contrajeron matrimonio Tomás Serrano Campos, hijo de Bartolomé Serrano y Rosalía Campos, y Encarnación Vidal Ferrer, hija de Ignacio Vidal y Manuela Ferrer.',
    tags: ['matrimonio', 'Carmona'], persons: ['demo-p5', 'demo-p7'],
  },
  {
    id: 'demo-ait3', kind: 'csv', docType: 'census',
    title: { es: 'Hoja del padrón de Carmona (1900)', en: 'Carmona census sheet (1900)' },
    metadata: { anio: '1900', municipio: 'Carmona', hogar: 'Calle Real, 14', personas: 'Tomás Serrano; Encarnación Vidal; Rafael, Amparo y Vicente Serrano' },
    text: 'Apellidos,Nombre,Parentesco,Edad\nSerrano Campos,Tomás,Cabeza,35\nVidal Ferrer,Encarnación,Esposa,33\nSerrano Vidal,Rafael,Hijo,10\nSerrano Vidal,Amparo,Hija,7\nSerrano Vidal,Vicente,Hijo,4',
    tags: ['censo', 'padrón', '1900'], persons: ['demo-p5', 'demo-p7', 'demo-p8', 'demo-p9', 'demo-p10'],
  },
  {
    id: 'demo-ait4', kind: 'text', docType: 'diary',
    title: { es: 'Diario de Encarnación Vidal', en: 'Diary of Encarnación Vidal' },
    metadata: { persona: 'Encarnación Vidal Ferrer', fecha: '1903' },
    text: 'Hoy ha venido a casa mi cuñada Dolores con Casimiro, su marido, y su pequeña Lucía. Rafael ya es todo un hombre; habla de marcharse a Sevilla en cuanto pueda. Amparo cose a mi lado y Vicente no para quieto.',
    tags: ['diario'], persons: ['demo-p7'],
  },
  {
    id: 'demo-ait5', kind: 'text', docType: 'letter',
    title: { es: 'Carta de Amparo a su hermano Rafael (1925)', en: 'Letter from Amparo to her brother Rafael (1925)' },
    metadata: { remitente: 'Amparo Serrano Vidal', destinatario: 'Rafael Serrano Vidal', fecha: '1925' },
    text: 'Querido Rafael: te escribe tu hermana Amparo Serrano desde Carmona. Madre pregunta por ti y por Josefa Marín. Aún lloramos a nuestro Vicente. Escríbenos pronto.',
    tags: ['carta', 'correspondencia'], persons: ['demo-p8'],
  },
  {
    id: 'demo-ait6', kind: 'pdf', docType: 'death_record',
    title: { es: 'Partida de defunción de Vicente Serrano (1918)', en: 'Death record of Vicente Serrano (1918)' },
    metadata: { persona: 'Vicente Serrano Vidal', fecha_defuncion: '1918', edad: '22 años', causa: 'gripe' },
    text: 'En Sevilla, año de mil novecientos dieciocho, falleció Vicente Serrano Vidal, de veintidós años, hijo de Tomás Serrano y Encarnación Vidal, a consecuencia de la epidemia de gripe.',
    tags: ['defunción', 'Sevilla'], persons: ['demo-p10'],
  },
  {
    id: 'demo-ait7', kind: 'image', docType: 'photograph',
    title: { es: 'Retrato de estudio de la familia Serrano (h. 1905)', en: 'Studio portrait of the Serrano family (c. 1905)' },
    metadata: { fecha: 'h. 1905', lugar: 'Sevilla' },
    description: 'Fotografía de estudio en sepia: un matrimonio sentado con tres hijos de pie detrás, vestidos de domingo. Al dorso, a lápiz: «Los Serrano, Sevilla».',
    text: 'Los Serrano, Sevilla, h. 1905. De pie: Rafael, Amparo, Vicente. Sentados: Tomás y Encarnación.',
    tags: ['fotografía', 'retrato'], persons: ['demo-p5', 'demo-p7', 'demo-p8', 'demo-p9'],
  },
  {
    id: 'demo-ait8', kind: 'pdf', docType: 'marriage_record',
    title: { es: 'Acta de matrimonio de Dolores Serrano y Casimiro Reyes (1890)', en: 'Marriage record of Dolores Serrano and Casimiro Reyes (1890)' },
    metadata: { conyuge_1: 'Dolores Serrano Campos', conyuge_2: 'Casimiro Reyes Pardo', fecha: '1890', parroquia_registro: 'Parroquia de Santa María, Carmona' },
    text: 'En Carmona, año de mil ochocientos noventa, contrajeron matrimonio Casimiro Reyes Pardo y Dolores Serrano Campos, hija de Bartolomé Serrano y Rosalía Campos.',
    tags: ['matrimonio', 'Carmona'], persons: ['demo-p6', 'demo-p14'],
  },
  {
    id: 'demo-ait9', kind: 'pdf', docType: 'baptism',
    title: { es: 'Partida de bautismo de Lucía Reyes (1892)', en: 'Baptism record of Lucía Reyes (1892)' },
    metadata: { persona: 'Lucía Reyes Serrano', fecha: '1892', padres: 'Casimiro Reyes y Dolores Serrano', parroquia_registro: 'Parroquia de Santa María, Carmona' },
    text: 'En Carmona, año de mil ochocientos noventa y dos, bauticé a Lucía, hija de Casimiro Reyes Pardo y de Dolores Serrano Campos.',
    tags: ['bautismo', 'Carmona'], persons: ['demo-p15', 'demo-p6', 'demo-p14'],
  },
];

// The provenance of each archive item — the "Source" field. Proper nouns, so they
// read the same in either UI language; a repository, a fonds, or a private holding.
const ARCHIVE_SOURCES: Record<string, string> = {
  'demo-ait1': 'Archivo Parroquial de Santa María, Carmona · Libro de bautismos',
  'demo-ait2': 'Archivo Parroquial de Santa María, Carmona · Libro de matrimonios',
  'demo-ait3': 'Archivo Municipal de Carmona · Padrón municipal de 1900',
  'demo-ait4': 'Colección familiar Serrano (documento privado)',
  'demo-ait5': 'Colección familiar Serrano (documento privado)',
  'demo-ait6': 'Registro Civil de Sevilla · Sección de defunciones',
  'demo-ait7': 'Álbum fotográfico de la familia Serrano',
  'demo-ait8': 'Archivo Parroquial de Santa María, Carmona · Libro de matrimonios',
  'demo-ait9': 'Archivo Parroquial de Santa María, Carmona · Libro de bautismos',
};

interface DemoPersonEvidence {
  personId: string;
  itemId: string;
  quote: string;
  location: string;
}
const PERSON_EVIDENCE: DemoPersonEvidence[] = [
  { personId: 'demo-p5', itemId: 'demo-ait1', quote: 'Tomás, hijo legítimo de Bartolomé Serrano Ortega y de Rosalía Campos Ríos', location: 'fol. 34v' },
  { personId: 'demo-p7', itemId: 'demo-ait2', quote: 'Encarnación Vidal Ferrer, hija de Ignacio Vidal y Manuela Ferrer', location: 'fol. 12' },
  { personId: 'demo-p10', itemId: 'demo-ait6', quote: 'Vicente Serrano Vidal, de veintidós años', location: 'fol. 8' },
];

interface DemoSuggestion {
  id: string;
  from: string;
  to: string;
  type: 'parent' | 'spouse';
  evidence: { id: string; signal: 'record_role' | 'explicit_claim'; itemId: string; quote: string; location: string; weight: number }[];
}
// Open kinship suggestions — deliberately NOT written as relationships, so the review
// flow ("Parentescos sugeridos") has real proposals to confirm or dismiss. The AI
// found these in the sources; the user vets them.
const SUGGESTIONS: DemoSuggestion[] = [
  {
    id: 'demo-ksg1', from: 'demo-p14', to: 'demo-p6', type: 'spouse',
    evidence: [
      { id: 'demo-kse1', signal: 'record_role', itemId: 'demo-ait8', quote: 'contrajeron matrimonio Casimiro Reyes Pardo y Dolores Serrano Campos', location: 'fol. 3', weight: 1 },
      { id: 'demo-kse2', signal: 'explicit_claim', itemId: 'demo-ait4', quote: 'mi cuñada Dolores con Casimiro, su marido', location: '', weight: 0.8 },
    ],
  },
  {
    id: 'demo-ksg2', from: 'demo-p14', to: 'demo-p15', type: 'parent',
    evidence: [{ id: 'demo-kse3', signal: 'record_role', itemId: 'demo-ait9', quote: 'Lucía, hija de Casimiro Reyes Pardo y de Dolores Serrano Campos', location: 'fol. 21', weight: 1 }],
  },
  {
    id: 'demo-ksg3', from: 'demo-p6', to: 'demo-p15', type: 'parent',
    evidence: [{ id: 'demo-kse4', signal: 'record_role', itemId: 'demo-ait9', quote: 'Lucía, hija de Casimiro Reyes Pardo y de Dolores Serrano Campos', location: 'fol. 21', weight: 1 }],
  },
];

interface DemoContact {
  id: string;
  name: Localized;
  notes: Localized;
}
const SOCIAL_CONTACTS: DemoContact[] = [
  {
    id: 'demo-ctc1',
    name: { es: 'Antonio Ruiz Cabello', en: 'Antonio Ruiz Cabello' },
    notes: {
      es: 'Notario del pueblo entre 1868 y 1895. Redactó varias escrituras de la familia.',
      en: 'The village notary between 1868 and 1895. Drafted several of the family’s deeds.',
    },
  },
  {
    id: 'demo-ctc2',
    name: { es: 'Padre Eugenio Lozano', en: 'Father Eugenio Lozano' },
    notes: {
      es: 'Párroco de Santa María entre 1855 y 1880. Ofició varios bautismos y matrimonios de la familia.',
      en: 'Parish priest of Santa María between 1855 and 1880. Officiated several of the family’s baptisms and marriages.',
    },
  },
];

interface DemoSocialRel {
  id: string;
  from: string;
  targetId: string;
  role: Localized;
  notes: Localized;
}
// A SECOND, independent network from the kinship tree — the demo's payoff for the
// social/prosopographical use case (patronage, clergy, professional ties).
const SOCIAL_RELATIONSHIPS: DemoSocialRel[] = [
  {
    id: 'demo-srel1',
    from: 'demo-p5',
    targetId: 'demo-ctc1',
    role: { es: 'cliente', en: 'client' },
    notes: { es: 'Le compró una finca de olivar en 1889, según la escritura conservada.', en: 'Bought an olive grove through him in 1889, per the surviving deed.' },
  },
  {
    id: 'demo-srel2',
    from: 'demo-p1',
    targetId: 'demo-ctc2',
    role: { es: 'feligrés', en: 'parishioner' },
    notes: { es: '', en: '' },
  },
  {
    id: 'demo-srel3',
    from: 'demo-p5',
    targetId: 'demo-p14',
    role: { es: 'socio', en: 'business partner' },
    notes: { es: 'Compartieron la explotación de una prensa de aceite entre 1895 y 1905.', en: 'Ran a shared olive press between 1895 and 1905.' },
  },
];

// ── Seed / clear ────────────────────────────────────────────────────────────────

/** True when the vault already holds ANY content (genealogy or academic). Gates the
 *  demo so it can never overwrite a real library, and keeps the two demos exclusive. */
export function hasGenealogyData(): boolean {
  const db = getDb();
  const n = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return (
    n('persons') > 0 ||
    n('archive_items') > 0 ||
    n('places') > 0 ||
    n('events') > 0 ||
    n('works') > 0 ||
    n('ideas') > 0 ||
    n('notes') > 0
  );
}

function normSpouse(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Seed the genealogy demo. No-op (returns false) if any genealogy data already exists.
 * Flips the active vault to the genealogy type (remembering the prior type) and sets
 * the demo flag. Portraits are generated separately.
 */
export function seedGenealogyDemoData(): boolean {
  const db = getDb();
  if (hasGenealogyData()) return false;

  const active = getActiveVault();
  const priorType: VaultType = active.type;
  if (priorType !== 'genealogy') {
    setVaultType(active.id, 'genealogy');
    updateSettings({ demoPriorVaultType: priorType });
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    // Places (parents before children — PLACES is ordered so).
    const insPlace = db.prepare(
      `INSERT INTO places (place_id, name, parent_id, kind, latitude, longitude, notes, gazetteer_id, admin1, country, country_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of PLACES)
      insPlace.run(p.id, p.name, p.parentId, p.kind, p.lat, p.lng, p.gazetteerId ?? null, p.admin1 ?? null, p.country ?? null, p.country ? 'ES' : null, now, now);

    // Persons + name variants.
    const insPerson = db.prepare(
      `INSERT INTO persons (person_id, display_name, sex, birth_date, birth_date_sort, death_date, death_date_sort, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    );
    const insName = db.prepare('INSERT OR IGNORE INTO person_names (id, person_id, name, kind) VALUES (?, ?, ?, ?)');
    for (const p of PERSONS) {
      const b = parseHistoricalDate(p.birth);
      const d = parseHistoricalDate(p.death);
      insPerson.run(p.id, p.name, p.sex, p.birth, b.sortKey, p.death, d.sortKey, now, now);
      insName.run(`${p.id}-n`, p.id, p.name, 'nacimiento');
    }
    NAME_VARIANTS.forEach((v, i) => insName.run(`demo-nv${i + 1}`, v.personId, v.name, v.kind));

    // Relationships (spouse pairs normalised).
    const insRel = db.prepare(
      'INSERT OR IGNORE INTO relationships (rel_id, from_person, to_person, type, provenance, subtype, notes, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)'
    );
    RELATIONSHIPS.forEach((r, i) => {
      const [from, to] = r.type === 'spouse' ? normSpouse(r.from, r.to) : [r.from, r.to];
      insRel.run(`demo-rel${i + 1}`, from, to, r.type, r.provenance, now);
    });

    // Events + participants.
    const insEvent = db.prepare(
      `INSERT INTO events (event_id, type, label, date, date_sort, date_end_sort, place_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    );
    const insPart = db.prepare('INSERT OR IGNORE INTO event_participants (id, event_id, person_id, role) VALUES (?, ?, ?, ?)');
    for (const e of EVENTS) {
      const parsed = parseHistoricalDate(e.date);
      insEvent.run(e.id, e.type, e.label, e.date, parsed.sortKey, parsed.endSortKey, e.placeId, now, now);
      e.participants.forEach((part, j) => insPart.run(`${e.id}-p${j}`, e.id, part.personId, part.role));
    }

    // Per-person place records → the individual maps + the general map (movements).
    const insPersonPlace = db.prepare(
      `INSERT INTO person_places (id, person_id, place_id, label, date, date_sort, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    );
    PERSON_PLACES.forEach((pp, i) => {
      const parsed = parseHistoricalDate(pp.date);
      insPersonPlace.run(`demo-ppl${i + 1}`, pp.personId, pp.placeId, pp.label, pp.date, parsed.sortKey, now, now);
    });

    // Evidence archive: folder, items, tags, person links.
    db.prepare('INSERT INTO archive_folders (folder_id, name, parent_id, created_at) VALUES (?, ?, NULL, ?)').run(
      FOLDER.id,
      loc(FOLDER.name),
      now
    );
    const insItem = db.prepare(
      `INSERT INTO archive_items (item_id, folder_id, title, kind, file_name, mime_type, bytes, blob, extracted_text, description, source, content_hash, doc_type, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?)`
    );
    const insItemTag = db.prepare('INSERT OR IGNORE INTO archive_item_tags (item_id, tag) VALUES (?, ?)');
    const insItemPerson = db.prepare('INSERT OR IGNORE INTO archive_item_persons (item_id, person_id, created_at) VALUES (?, ?, ?)');
    // "Carpeta" multi-select membership (mirrors the legacy folder_id above).
    const insItemFolder = db.prepare('INSERT OR IGNORE INTO archive_item_folders (item_id, folder_id, created_at) VALUES (?, ?, ?)');
    for (const it of ARCHIVE_ITEMS) {
      insItem.run(
        it.id,
        FOLDER.id,
        loc(it.title),
        it.kind,
        it.text.length,
        it.text,
        it.description ?? null,
        ARCHIVE_SOURCES[it.id] ?? null,
        it.docType,
        JSON.stringify(it.metadata),
        now,
        now
      );
      for (const tag of it.tags) insItemTag.run(it.id, tag);
      for (const pid of it.persons) insItemPerson.run(it.id, pid, now);
      insItemFolder.run(it.id, FOLDER.id, now);
    }

    // Event + person evidence, pointing back at the archive items that back them.
    const insEvidence = db.prepare(
      'INSERT INTO record_evidence (id, target_kind, target_id, nodus_id, source_kind, quote, location, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)'
    );
    for (const e of EVENTS) {
      if (!e.evidence) continue;
      insEvidence.run(`${e.id}-ev`, 'event', e.id, e.evidence.itemId, 'archive', e.evidence.quote, e.evidence.location, now);
    }
    PERSON_EVIDENCE.forEach((pe, i) =>
      insEvidence.run(`demo-pev${i + 1}`, 'person', pe.personId, pe.itemId, 'archive', pe.quote, pe.location, now)
    );

    // Open kinship suggestions + their evidence (AI proposals awaiting the user).
    const insSug = db.prepare(
      "INSERT INTO kinship_suggestions (suggestion_id, from_person, to_person, type, subtype, status, score, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 'open', ?, ?, ?)"
    );
    const insSugEv = db.prepare(
      'INSERT INTO kinship_suggestion_evidence (id, suggestion_id, signal, source_kind, nodus_id, quote, location, weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const s of SUGGESTIONS) {
      const [from, to] = s.type === 'spouse' ? normSpouse(s.from, s.to) : [s.from, s.to];
      const score = Math.min(3, s.evidence.reduce((sum, ev) => sum + ev.weight, 0));
      insSug.run(s.id, from, to, s.type, Math.round(score * 100) / 100, now, now);
      for (const ev of s.evidence) insSugEv.run(ev.id, s.id, ev.signal, 'archive', ev.itemId, ev.quote, ev.location, ev.weight, now);
    }

    // The social-relations network: a SECOND graph, independent from the kinship
    // tree — patronage, clergy, business ties, the material for a social historian.
    const insContact = db.prepare(
      'INSERT INTO social_contacts (contact_id, display_name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const c of SOCIAL_CONTACTS) insContact.run(c.id, loc(c.name), loc(c.notes) || null, now, now);
    const insSocialRel = db.prepare(
      `INSERT INTO social_relations (relation_id, person_id, target_kind, target_id, role, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const contactIds = new Set(SOCIAL_CONTACTS.map((c) => c.id));
    for (const r of SOCIAL_RELATIONSHIPS) {
      const targetKind = contactIds.has(r.targetId) ? 'contact' : 'person';
      insSocialRel.run(r.id, r.from, targetKind, r.targetId, loc(r.role), loc(r.notes) || null, now, now);
    }

    updateSettings({ demoMode: true, genealogyTourComplete: false });
  });
  tx();
  return true;
}

/** Person ids whose demo portrait should be generated (main line + the suggested pair). */
export function demoPortraitTargets(): { personId: string; name: string; sex: 'male' | 'female'; birthYear: number | null; portrait: string }[] {
  return PERSONS.map((p) => ({
    personId: p.id,
    name: p.name,
    sex: p.sex,
    birthYear: parseHistoricalDate(p.birth).year,
    portrait: p.portrait,
  }));
}

/**
 * Remove every genealogy demo row (by `demo-` id) and restore the vault type the demo
 * flipped. Guarded so it never touches real data. Called from the shared demo clear.
 */
export function clearGenealogyDemoData(): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM social_relations WHERE relation_id LIKE 'demo-%';
      DELETE FROM social_contacts WHERE contact_id LIKE 'demo-%';
      DELETE FROM kinship_suggestion_evidence WHERE suggestion_id LIKE 'demo-%';
      DELETE FROM kinship_suggestions WHERE suggestion_id LIKE 'demo-%';
      DELETE FROM archive_item_persons WHERE item_id LIKE 'demo-%';
      DELETE FROM archive_item_tags WHERE item_id LIKE 'demo-%';
      DELETE FROM archive_item_folders WHERE item_id LIKE 'demo-%';
      DELETE FROM archive_items WHERE item_id LIKE 'demo-%';
      DELETE FROM archive_folders WHERE folder_id LIKE 'demo-%';
      DELETE FROM record_evidence WHERE id LIKE 'demo-%';
      DELETE FROM event_participants WHERE event_id LIKE 'demo-%';
      DELETE FROM events WHERE event_id LIKE 'demo-%';
      DELETE FROM person_places WHERE id LIKE 'demo-%';
      DELETE FROM relationships WHERE rel_id LIKE 'demo-%';
      DELETE FROM person_portraits WHERE person_id LIKE 'demo-%';
      DELETE FROM person_names WHERE person_id LIKE 'demo-%';
      DELETE FROM persons WHERE person_id LIKE 'demo-%';
      DELETE FROM places WHERE place_id LIKE 'demo-%';
    `);
    const prior = getSettings().demoPriorVaultType;
    if (prior) {
      setVaultType(getActiveVault().id, prior);
      updateSettings({ demoPriorVaultType: null });
    }
  });
  tx();
}
