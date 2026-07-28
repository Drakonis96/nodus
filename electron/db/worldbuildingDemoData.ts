// A complete, local-only worldbuilding demo.
//
// "The Ashen Tides" is one coherent story world rather than a bag of sample rows. Every
// developed Worldbuilding surface reads from it: the encyclopedia resolves its links into
// the cast, places and rules; scenes drive the manuscript, conflicts, arcs and continuity;
// the calendar dates the timeline; map markers locate the same places; and the family and
// social graphs reuse the same characters. No AI output is seeded or required.
//
// Every owned id starts with `demo-world-`. Cleanup can therefore remove the corpus
// surgically without touching anything the user creates while exploring it.

import { getDb } from './database';
import { getSettings, updateSettings } from './settingsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { normalizeTitle } from '@shared/worldEncyclopedia';
import { countWords } from '@shared/worldManuscript';
import { recomputeWorldDays } from './worldCalendarRepo';
import { rebuildWorldLinks } from './worldEncyclopediaRepo';
import { runContinuityUnfiltered, muteNotice } from './worldContinuityRepo';

const PREFIX = 'demo-world-';
const AT = '2026-07-28T12:00:00.000Z';
const PREVIOUS_AT = '2026-07-21T12:00:00.000Z';

type DemoLocale = 'es' | 'en';
type Localized = { es: string; en: string };
type SqlValue = string | number | null | Buffer;

function locale(): DemoLocale {
  return getSettings().uiLanguage === 'es' ? 'es' : 'en';
}

function text(es: string, en: string): Localized {
  return { es, en };
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function portraitSvg(name: string, primary: string, secondary: string): Buffer {
  const safe = xml(name);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="${secondary}"/>
        </linearGradient>
        <radialGradient id="halo"><stop stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="480" height="640" fill="url(#bg)"/>
      <circle cx="240" cy="210" r="180" fill="url(#halo)"/>
      <path d="M126 520c18-108 68-166 114-166s96 58 114 166" fill="#111827" fill-opacity=".82"/>
      <circle cx="240" cy="246" r="92" fill="#f1d4b5"/>
      <path d="M148 244c4-110 55-150 104-150 60 0 94 52 81 154-25-31-57-52-94-54-34-2-64 15-91 50z" fill="#202436"/>
      <circle cx="209" cy="246" r="7" fill="#25232a"/><circle cx="272" cy="246" r="7" fill="#25232a"/>
      <path d="M214 290q26 18 52 0" fill="none" stroke="#8b5e52" stroke-width="5" stroke-linecap="round"/>
      <circle cx="394" cy="84" r="45" fill="#fff" fill-opacity=".13"/>
      <text x="394" y="98" text-anchor="middle" font-family="serif" font-size="38" fill="#fff">${xml(initials(name))}</text>
      <rect x="28" y="558" width="424" height="54" rx="12" fill="#09090b" fill-opacity=".72"/>
      <text x="240" y="592" text-anchor="middle" font-family="serif" font-size="23" fill="#f8fafc">${safe}</text>
    </svg>`,
    'utf8'
  );
}

function cardSvg(title: string, primary: string, secondary: string, symbol: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${primary}"/><stop offset="1" stop-color="${secondary}"/></linearGradient></defs>
      <rect width="960" height="640" fill="url(#g)"/>
      <path d="M0 470Q160 380 320 470T640 455T960 470V640H0Z" fill="#09090b" fill-opacity=".42"/>
      <circle cx="480" cy="264" r="150" fill="#fff" fill-opacity=".08" stroke="#fff" stroke-opacity=".2" stroke-width="3"/>
      <text x="480" y="318" text-anchor="middle" font-family="serif" font-size="142" fill="#fff" fill-opacity=".88">${xml(symbol)}</text>
      <rect x="90" y="510" width="780" height="76" rx="18" fill="#09090b" fill-opacity=".72"/>
      <text x="480" y="558" text-anchor="middle" font-family="serif" font-size="31" fill="#f8fafc">${xml(title)}</text>
    </svg>`,
    'utf8'
  );
}

function mapSvg(name: string, detail = false): Buffer {
  const coast = detail
    ? 'M84 89C181 43 268 83 305 159c42 86 155 34 232 79 71 42 27 125 106 173 61 36 141 4 211 61l-18 107H76Z'
    : 'M44 168C139 48 278 84 343 145c84 79 135-21 238 37 83 47 81 142 188 137 65-3 112 44 151 116l-35 144H61Z';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
      <defs>
        <radialGradient id="sea"><stop stop-color="#244b63"/><stop offset="1" stop-color="#102c3f"/></radialGradient>
        <linearGradient id="land" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#c0a36a"/><stop offset=".52" stop-color="#71805e"/><stop offset="1" stop-color="#4c594b"/></linearGradient>
        <filter id="paper"><feTurbulence baseFrequency=".8" numOctaves="2" result="n"/><feBlend in="SourceGraphic" in2="n" mode="soft-light"/></filter>
      </defs>
      <rect width="1280" height="800" fill="url(#sea)"/>
      <g transform="translate(130 60)" filter="url(#paper)">
        <path d="${coast}" fill="url(#land)" stroke="#e7d5aa" stroke-width="7"/>
        <path d="M230 150q55 95 5 195t75 176M580 220q-45 70 18 135t-12 152" fill="none" stroke="#9fd4dc" stroke-width="8" opacity=".8"/>
        <path d="M95 430Q270 315 440 425T790 380" fill="none" stroke="#d8c496" stroke-width="5" stroke-dasharray="13 11"/>
        <path d="M420 214l42-64 39 71 45-82 48 87" fill="none" stroke="#eee1c5" stroke-width="12" opacity=".66"/>
      </g>
      <g fill="#f5e7c6" font-family="serif"><text x="640" y="62" text-anchor="middle" font-size="31">${xml(name)}</text><text x="1110" y="742" font-size="20">N ↑</text></g>
      <path d="M1125 682l20-48 20 48-20-12z" fill="#f5e7c6"/>
    </svg>`,
    'utf8'
  );
}

function insert(table: string, row: Record<string, SqlValue>): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`Unsafe table name: ${table}`);
  const columns = Object.keys(row);
  if (columns.some((column) => !/^[a-z_][a-z0-9_]*$/.test(column))) throw new Error(`Unsafe column in ${table}`);
  getDb()
    .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map((column) => row[column]));
}

const CHARACTERS = [
  {
    id: `${PREFIX}char-ilyra`, name: 'Ilyra Venn', birth: '17 de Brasa, 719 D.F.', death: null,
    species: 'Humana', gender: 'mujer', pronouns: 'ella', life: 'alive', role: 'protagonist', accent: 'violet',
    appearance: text('Cartógrafa de cabello negro trenzado, ojos plateados y una prótesis de vidrio solar en la mano izquierda.', 'A black-haired cartographer with silver eyes and a solar-glass prosthetic left hand.'),
    personality: text('Observadora, obstinada y compasiva; convierte el miedo en preguntas concretas.', 'Observant, stubborn and compassionate; she turns fear into concrete questions.'),
    backstory: text('Hija de [[Aurel Venn]], sobrevivió al Hundimiento de [[Lúmina]]. Busca a su hermana [[Nara Venn]] y oculta que conoce el nombre verdadero del Faro. ???', 'Daughter of [[Aurel Venn]], she survived the Sinking of [[Lumina]]. She searches for her sister [[Nara Venn]] and hides that she knows the Lighthouse’s true name. ???'),
    visual: 'young maritime cartographer, silver eyes, dark braid, brass coat, translucent glass left hand',
    want: text('Encontrar a Nara antes de la próxima Marea Negra.', 'Find Nara before the next Black Tide.'),
    need: text('Aceptar que un mapa no puede controlar a las personas que ama.', 'Accept that a map cannot control the people she loves.'),
    flaw: text('Confunde preparación con control.', 'She mistakes preparation for control.'),
    lie: text('Si comprende todas las rutas, nadie volverá a desaparecer.', 'If she understands every route, nobody will vanish again.'),
    wound: text('No pudo salvar a su madre durante el Hundimiento.', 'She could not save her mother during the Sinking.'),
    voice: ['preciso y contenido', 'enumera opciones cuando está nerviosa', 'Dame un rumbo, no una promesa.'],
    biography: text('Cartógrafa de la Casa del Faro y última heredera reconocida de la línea Venn. Su investigación une el destino de Lúmina con el corazón de vidrio enterrado bajo la ciudad.', 'Cartographer of the Lighthouse House and the last acknowledged heir of the Venn line. Her research ties Lumina’s fate to the glass heart buried beneath the city.'),
    colors: ['#4338ca', '#111827'],
  },
  {
    id: `${PREFIX}char-cael`, name: 'Cael Orun', birth: '3 de Sal, 716 D.F.', death: null,
    species: 'Veyari', gender: 'hombre', pronouns: 'él', life: 'alive', role: 'secondary', accent: 'sky',
    appearance: text('Navegante veyari de piel cobriza, membranas azuladas en los antebrazos y tatuajes de corriente.', 'A copper-skinned Veyari navigator with blue forearm membranes and current tattoos.'),
    personality: text('Irónico, paciente y ferozmente leal cuando decide confiar.', 'Wry, patient and fiercely loyal once he chooses to trust.'),
    backstory: text('Antiguo capitán del [[Gremio de las Seis Velas]], acusado de provocar el naufragio de la Aguja Norte.', 'Former captain of the [[Guild of Six Sails]], accused of causing the wreck of the North Needle.'),
    visual: 'Veyari sailor, copper skin, blue fin-like arm membranes, indigo tattoos, weathered coat',
    want: text('Limpiar su nombre y recuperar su nave.', 'Clear his name and recover his ship.'),
    need: text('Elegir una causa que no dependa de su reputación.', 'Choose a cause that does not depend on his reputation.'),
    flaw: text('Convierte toda intimidad en una broma.', 'He turns every intimacy into a joke.'),
    lie: text('Solo se puede confiar en una tripulación mientras haya paga.', 'A crew can only be trusted while there is pay.'),
    wound: text('Su mentor lo entregó al Consejo de Ceniza.', 'His mentor handed him over to the Ash Council.'),
    voice: ['coloquial y marítimo', 'responde con refranes del viento', 'La marea no negocia, pero avisa.'],
    biography: text('Navegante proscrito, enlace con las comunidades veyari y único piloto que ha cruzado el Mar de Vidrio durante una Marea Negra.', 'Outlaw navigator, liaison to the Veyari communities, and the only pilot to cross the Glass Sea during a Black Tide.'),
    colors: ['#0369a1', '#164e63'],
  },
  {
    id: `${PREFIX}char-maelor`, name: 'Regente Maelor Sarn', birth: '28 de Ceniza, 688 D.F.', death: null,
    species: 'Humano', gender: 'hombre', pronouns: 'él', life: 'alive', role: 'antagonist', accent: 'crimson',
    appearance: text('Hombre alto de cabello blanco, uniforme carmesí y máscara ceremonial de obsidiana.', 'A tall white-haired man in a crimson uniform and ceremonial obsidian mask.'),
    personality: text('Cortés, disciplinado y convencido de que la crueldad preventiva es misericordia.', 'Courteous, disciplined and convinced that preventive cruelty is mercy.'),
    backstory: text('Tomó la regencia tras la desaparición de [[Nara Venn]] y convirtió el racionamiento de luz en instrumento político.', 'He took the regency after [[Nara Venn]] disappeared and turned light rationing into a political instrument.'),
    visual: 'older regent, white hair, obsidian half mask, crimson military coat, solar sigil',
    want: text('Encender el Corazón de Vidrio bajo su control.', 'Ignite the Glass Heart under his control.'),
    need: text('Reconocer que el orden sin consentimiento es otra forma de ruina.', 'Recognise that order without consent is another form of ruin.'),
    flaw: text('No distingue obediencia de lealtad.', 'He cannot distinguish obedience from loyalty.'),
    lie: text('Solo él está dispuesto a pagar el precio de salvar la ciudad.', 'Only he is willing to pay the price of saving the city.'),
    wound: text('Perdió a su familia en el primer apagón del Faro.', 'He lost his family in the Lighthouse’s first blackout.'),
    voice: ['formal y jurídico', 'nunca usa la primera persona al ordenar', 'La ciudad no necesita esperanza; necesita continuidad.'],
    biography: text('Regente de Orthea y arquitecto del Consejo de Ceniza. Su poder descansa sobre una crisis que quizá ayudó a provocar.', 'Regent of Orthea and architect of the Ash Council. His power rests on a crisis he may have helped cause.'),
    colors: ['#9f1239', '#3f0b1d'],
  },
  {
    id: `${PREFIX}char-nara`, name: 'Nara Venn', birth: '8 de Lluvia, 712 D.F.', death: null,
    species: 'Humana', gender: 'mujer', pronouns: 'ella', life: 'missing', role: 'secondary', accent: 'amber',
    appearance: text('Astrónoma de pelo cobrizo, pecas luminosas y lentes con seis diafragmas.', 'A copper-haired astronomer with luminous freckles and six-aperture lenses.'),
    personality: text('Brillante, impaciente y capaz de guardar un secreto demasiado tiempo.', 'Brilliant, impatient and capable of keeping a secret for too long.'),
    backstory: text('Desapareció en el [[Observatorio de Orla]] después de demostrar que la Tercera Luna no era una luna.', 'She vanished at the [[Orla Observatory]] after proving that the Third Moon was not a moon.'),
    visual: 'copper-haired astronomer, luminous freckles, many-lensed spectacles, amber observatory robes',
    want: text('Impedir que el Corazón despierte.', 'Prevent the Heart from waking.'),
    need: text('Compartir la verdad antes de que deje de pertenecerle.', 'Share the truth before it stops belonging to her.'),
    flaw: text('Protege a los demás negándoles información.', 'She protects others by denying them information.'),
    lie: text('La verdad solo es segura mientras nadie la conozca.', 'Truth is only safe while nobody knows it.'),
    wound: text('Su primera predicción causó una evacuación mortal.', 'Her first prediction caused a deadly evacuation.'),
    voice: ['rápido y técnico', 'corrige sus propias frases a mitad', 'No es una estrella. Es una puerta fingiendo distancia.'],
    biography: text('Primogénita de Aurel Venn, astrónoma real y desaparecida desde hace nueve meses.', 'Aurel Venn’s eldest daughter, royal astronomer, missing for nine months.'),
    colors: ['#b45309', '#78350f'],
  },
  {
    id: `${PREFIX}char-sena`, name: 'Sena Mir', birth: '11 de Quietud, 725 D.F.', death: null,
    species: 'Humana', gender: 'no binario', pronouns: 'elle', life: 'alive', role: 'secondary', accent: 'emerald',
    appearance: text('Aprendiz de archivo, piel oscura, pelo rapado y un enjambre de llaves mecánicas al cinturón.', 'A dark-skinned archive apprentice with a shaved head and a swarm of mechanical keys at their belt.'),
    personality: text('Curiose, valiente y pésime mintiendo.', 'Curious, brave and terrible at lying.'),
    backstory: text('Creció en el Barrio Hundido y puede oír los ecos atrapados en el vidrio antiguo.', 'Raised in the Sunken Quarter, they can hear echoes trapped in old glass.'),
    visual: 'young archive apprentice, shaved head, green coat, brass keys, glowing glass fragments',
    want: text('Demostrar que el Barrio Hundido merece ser salvado.', 'Prove the Sunken Quarter deserves to be saved.'),
    need: text('Dejar de medir su valor por la utilidad que ofrece.', 'Stop measuring their worth by how useful they are.'),
    flaw: text('Se ofrece para todo hasta romperse.', 'They volunteer for everything until they break.'),
    lie: text('Si deja de ser útil, volverán a abandonarle.', 'If they stop being useful, they will be abandoned again.'),
    wound: text('El Archivo rechazó a su familia durante la inundación.', 'The Archive turned their family away during the flood.'),
    voice: ['directo y curioso', 'hace preguntas encadenadas', '¿Y si la cerradura no protege lo de dentro, sino lo de fuera?'],
    biography: text('Aprendiz del Archivo Sumergido y primera persona conocida capaz de escuchar memoria residual en vidrio solar.', 'Apprentice of the Sunken Archive and the first known person able to hear residual memory in solar glass.'),
    colors: ['#047857', '#064e3b'],
  },
  {
    id: `${PREFIX}char-odran`, name: 'Odran Vale', birth: '4 de Sal, 701 D.F.', death: '19 de Brasa, 740 D.F.',
    species: 'Humano', gender: 'hombre', pronouns: 'él', life: 'alive', role: 'tertiary', accent: 'slate',
    appearance: text('Guardián canoso con armadura azul ennegrecida y una cicatriz que le cruza la garganta.', 'A grey-haired guard in blackened blue armour with a scar across his throat.'),
    personality: text('Austero, protector y aferrado a juramentos incompatibles.', 'Austere, protective and bound to incompatible oaths.'),
    backstory: text('La ficha dice que murió defendiendo la Puerta de Sal, pero varios testigos lo sitúan después en el Faro.', 'His file says he died defending the Salt Gate, yet several witnesses place him at the Lighthouse later.'),
    visual: 'grey veteran, blackened blue armour, throat scar, weathered lighthouse cloak',
    want: text('Cumplir su último juramento.', 'Fulfil his last oath.'),
    need: text('Aceptar que un juramento puede sobrevivir sin quien lo pronunció.', 'Accept that an oath can outlive the one who spoke it.'),
    flaw: text('Obedece la letra cuando teme decidir.', 'He obeys the letter when afraid to decide.'),
    lie: text('Un deber cumplido justifica cualquier coste.', 'A fulfilled duty justifies any cost.'),
    wound: text('Abandonó una patrulla para salvar al joven Maelor.', 'He abandoned a patrol to save young Maelor.'),
    voice: ['parco y antiguo', 'responde con fórmulas de juramento', 'Mi palabra llegó antes que yo.'],
    biography: text('Antiguo guardián del Faro, oficialmente muerto dos años antes del comienzo del relato.', 'Former Lighthouse guardian, officially dead two years before the story begins.'),
    colors: ['#475569', '#0f172a'],
  },
  {
    id: `${PREFIX}char-aurel`, name: 'Aurel Venn', birth: '2 de Viento, 681 D.F.', death: '30 de Ceniza, 733 D.F.',
    species: 'Humano', gender: 'hombre', pronouns: 'él', life: 'dead', role: 'cameo', accent: 'amber',
    appearance: text('Maestro farero de barba rojiza y manos quemadas por el vidrio solar.', 'A red-bearded lighthouse master whose hands were burned by solar glass.'),
    personality: text('Generoso en público, reservado con su familia.', 'Generous in public, guarded with his family.'),
    backstory: text('Descubrió la deuda que alimenta el Faro y dejó sus mapas cifrados a Ilyra.', 'He discovered the debt feeding the Lighthouse and left his ciphered maps to Ilyra.'),
    visual: 'older lighthouse keeper, red beard, burned hands, ochre coat, brass astrolabe',
    want: text('Romper el ciclo de la Deuda de Eco.', 'Break the cycle of Echo Debt.'),
    need: text('Confiar el peligro a sus hijas.', 'Trust his daughters with the danger.'),
    flaw: text('Calla para proteger.', 'He protects through silence.'),
    lie: text('Un padre puede cargar solo con toda deuda.', 'A father can carry every debt alone.'),
    wound: text('Fue quien encendió el Faro durante el Hundimiento.', 'He was the one who lit the Lighthouse during the Sinking.'),
    voice: ['cálido y sentencioso', 'habla de mapas como seres vivos', 'Toda costa es una decisión dibujada.'],
    biography: text('Último maestro legítimo del Faro y padre de Nara e Ilyra.', 'Last legitimate master of the Lighthouse and father of Nara and Ilyra.'),
    colors: ['#a16207', '#713f12'],
  },
  {
    id: `${PREFIX}char-vesh`, name: 'Hermana Vesh', birth: 'Año desconocido', death: null,
    species: 'Veyari', gender: 'mujer', pronouns: 'ella', life: 'immortal', role: 'tertiary', accent: 'cyan',
    appearance: text('Sacerdotisa veyari de piel azul grisácea, ojos sin pupila y manto tejido con sal cristalizada.', 'A grey-blue Veyari priestess with pupil-less eyes and a cloak woven from crystallised salt.'),
    personality: text('Serena, inescrutable y más divertida de lo que permite su cargo.', 'Serene, inscrutable and more amused than her office permits.'),
    backstory: text('Recuerda mareas anteriores al calendario y asegura haber conocido al Faro cuando todavía caminaba.', 'She remembers tides older than the calendar and claims to have known the Lighthouse when it still walked.'),
    visual: 'ancient Veyari priestess, grey blue skin, pupil-less eyes, crystalline salt cloak',
    want: text('Devolver el Corazón al mar.', 'Return the Heart to the sea.'),
    need: text('Admitir que la memoria también deforma.', 'Admit that memory also distorts.'),
    flaw: text('Confunde antigüedad con autoridad.', 'She mistakes age for authority.'),
    lie: text('Haber visto el origen equivale a comprender el presente.', 'Seeing the origin means understanding the present.'),
    wound: text('Sobrevivió a todas las personas que juró guiar.', 'She outlived everyone she swore to guide.'),
    voice: ['ritual y juguetón', 'cuenta el tiempo en mareas', 'Eso ocurrió hace tres nombres, no tres siglos.'],
    biography: text('Custodia de la memoria oral veyari y testigo imposible de la fundación de Orthea.', 'Keeper of Veyari oral memory and impossible witness to Orthea’s founding.'),
    colors: ['#0e7490', '#164e63'],
  },
  {
    id: `${PREFIX}char-tarek`, name: 'Tarek Sarn', birth: '12 de Lluvia, 721 D.F.', death: null,
    species: 'Humano', gender: 'hombre', pronouns: 'él', life: 'alive', role: 'secondary', accent: 'crimson',
    appearance: text('Joven oficial de pelo oscuro, capa roja y una prótesis auditiva de latón.', 'A young dark-haired officer in a red cloak with a brass hearing device.'),
    personality: text('Honorable, competitivo y atrapado entre afecto y apellido.', 'Honourable, competitive and trapped between affection and family name.'),
    backstory: text('Sobrino del Regente, amigo de infancia de Ilyra y comandante de la Puerta de Sal.', 'The Regent’s nephew, Ilyra’s childhood friend and commander of the Salt Gate.'),
    visual: 'young officer, dark hair, red cloak, brass hearing device, salt gate insignia',
    want: text('Evitar una guerra civil sin traicionar a su familia.', 'Prevent civil war without betraying his family.'),
    need: text('Entender que la neutralidad también elige un bando.', 'Understand that neutrality also chooses a side.'),
    flaw: text('Pospone la decisión moral hasta que otros deciden por él.', 'He postpones moral choices until others choose for him.'),
    lie: text('Puede servir a Maelor y proteger a Ilyra a la vez.', 'He can serve Maelor and protect Ilyra at the same time.'),
    wound: text('Maelor lo crió tras la muerte de sus padres.', 'Maelor raised him after his parents died.'),
    voice: ['medido y militar', 'pide permiso incluso al disentir', 'Puedo abrirte la puerta; no fingir que no lo hice.'],
    biography: text('Comandante de la Guardia de Ceniza y bisagra política entre el Regente y la Casa Venn.', 'Commander of the Ash Guard and political hinge between the Regent and House Venn.'),
    colors: ['#be123c', '#4c0519'],
  },
  {
    id: `${PREFIX}char-elan`, name: 'Elan Venn', birth: 'Previsto para 743 D.F.', death: null,
    species: 'Humano', gender: null, pronouns: null, life: 'unborn', role: 'cameo', accent: 'rose',
    appearance: text('Aún no ha nacido; existe en una profecía y en los planes de dos casas.', 'Not yet born; exists in a prophecy and in the plans of two houses.'),
    personality: text('Sin determinar.', 'Undetermined.'),
    backstory: text('El heredero anunciado por el Oráculo de Sal, cuyo parentesco real sigue en disputa.', 'The heir announced by the Salt Oracle, whose true parentage remains disputed.'),
    visual: 'symbolic empty cradle beneath two moons, rose cloth, salt crystals',
    want: text('Aún no tiene voluntad en el relato.', 'Has no agency in the story yet.'),
    need: text('Ser tratado como persona y no como solución dinástica.', 'Be treated as a person rather than a dynastic solution.'),
    flaw: text('Sin determinar.', 'Undetermined.'),
    lie: text('La profecía habla por él.', 'The prophecy speaks for him.'),
    wound: text('Heredará una guerra antes de nacer.', 'Will inherit a war before birth.'),
    voice: [null, null, null],
    biography: text('Figura futura alrededor de la que las casas Venn y Sarn negocian la sucesión.', 'Future figure around whom Houses Venn and Sarn negotiate succession.'),
    colors: ['#be185d', '#4a044e'],
  },
] as const;

const PLACES = [
  { id: `${PREFIX}place-elyndra`, name: 'Elyndra', kind: 'planet', parent: null, accent: 'indigo', symbol: '◉', appearance: text('Un mundo oceánico de tres lunas, continentes estrechos y mares cubiertos de vidrio flotante.', 'An ocean world of three moons, narrow continents and seas covered in floating glass.'), atmosphere: text('El cielo siempre parece a punto de cambiar de color.', 'The sky always seems about to change colour.'), history: text('Las Mareas Negras marcan sus eras y obligan a reconstruir las costas.', 'Black Tides mark its eras and force its coasts to be rebuilt.') },
  { id: `${PREFIX}place-aster`, name: 'Aster', kind: 'continent', parent: `${PREFIX}place-elyndra`, accent: 'emerald', symbol: '⬡', appearance: text('Una media luna de piedra verde atravesada por cordilleras de sal.', 'A crescent of green stone crossed by salt mountain ranges.'), atmosphere: text('Vientos persistentes y caminos que brillan al anochecer.', 'Persistent winds and roads that glow at dusk.'), history: text('Fue un archipiélago hasta que los Tejedores Solares fijaron sus puentes.', 'It was an archipelago until the Solar Weavers fixed its bridges.') },
  { id: `${PREFIX}place-orthea`, name: 'Orthea', kind: 'kingdom', parent: `${PREFIX}place-aster`, accent: 'amber', symbol: '♜', appearance: text('Reino costero de faros, salinas y canales escalonados.', 'A coastal kingdom of lighthouses, salt pans and stepped canals.'), atmosphere: text('Todo huele a sal, aceite de lámpara y tormenta.', 'Everything smells of salt, lamp oil and storm.'), history: text('Unificado hace siete siglos alrededor del Primer Faro.', 'Unified seven centuries ago around the First Lighthouse.') },
  { id: `${PREFIX}place-lumina`, name: 'Lúmina', kind: 'city', parent: `${PREFIX}place-orthea`, accent: 'sky', symbol: '✦', appearance: text('Capital construida en terrazas blancas alrededor de un faro de vidrio de trescientos metros.', 'A capital built on white terraces around a three-hundred-metre glass lighthouse.'), atmosphere: text('Campanas de marea, reflejos en cada muro y vigilancia constante.', 'Tide bells, reflections on every wall and constant surveillance.'), history: text('La mitad baja se hundió en 733 D.F.; el Consejo nunca permitió reconstruirla.', 'Its lower half sank in 733 A.L.; the Council never allowed it to be rebuilt.') },
  { id: `${PREFIX}place-faro`, name: 'Casa del Faro', kind: 'fortress', parent: `${PREFIX}place-lumina`, accent: 'amber', symbol: '⌂', appearance: text('Fortaleza vertical de vidrio lechoso, latón y pasarelas expuestas al viento.', 'A vertical fortress of milky glass, brass and wind-exposed walkways.'), atmosphere: text('Zumbido de lentes, olor a ozono y silencio ceremonial.', 'Humming lenses, ozone and ceremonial silence.'), history: text('Sede de la dinastía Venn antes de la regencia Sarn.', 'Seat of the Venn dynasty before the Sarn regency.') },
  { id: `${PREFIX}place-hundido`, name: 'Barrio Hundido', kind: 'district', parent: `${PREFIX}place-lumina`, accent: 'cyan', symbol: '≈', appearance: text('Calles medio inundadas bajo cúpulas rotas, unidas por puentes y barcas.', 'Half-flooded streets beneath broken domes, joined by bridges and boats.'), atmosphere: text('Voces amplificadas por el agua y luz azul bajo las puertas.', 'Voices amplified by water and blue light beneath doors.'), history: text('Antiguo centro comercial abandonado tras el Hundimiento.', 'Former commercial centre abandoned after the Sinking.') },
  { id: `${PREFIX}place-archivo`, name: 'Archivo Sumergido', kind: 'building', parent: `${PREFIX}place-hundido`, accent: 'emerald', symbol: '▤', appearance: text('Biblioteca inclinada cuyos depósitos inferiores solo son accesibles durante la bajamar.', 'A tilted library whose lower stacks are only accessible at low tide.'), atmosphere: text('Papel húmedo, mecanismos de llaves y ecos que no pertenecen al presente.', 'Damp paper, key mechanisms and echoes that do not belong to the present.'), history: text('Conserva documentos anteriores al calendario oficial.', 'It preserves documents older than the official calendar.') },
  { id: `${PREFIX}place-orla`, name: 'Observatorio de Orla', kind: 'building', parent: `${PREFIX}place-lumina`, accent: 'violet', symbol: '☾', appearance: text('Seis cúpulas móviles sobre una aguja separada de la ciudad por un puente de vidrio.', 'Six moving domes atop a spire separated from the city by a glass bridge.'), atmosphere: text('Frío seco, engranajes lentos y la sensación de ser observado desde arriba.', 'Dry cold, slow gears and the sense of being watched from above.'), history: text('Nara Venn desapareció aquí mientras observaba la Tercera Luna.', 'Nara Venn vanished here while observing the Third Moon.') },
  { id: `${PREFIX}place-sal`, name: 'Puerta de Sal', kind: 'fortress', parent: `${PREFIX}place-orthea`, accent: 'slate', symbol: '⚔', appearance: text('Muralla tallada en un acantilado blanco, cruzada por un único arco de hierro.', 'A wall carved into a white cliff and pierced by a single iron arch.'), atmosphere: text('Polvo de sal, órdenes breves y el golpeteo de banderas tensas.', 'Salt dust, clipped orders and taut flags beating in the wind.'), history: text('Frontera terrestre de Orthea y escenario de la última revuelta.', 'Orthea’s land border and site of the last revolt.') },
  { id: `${PREFIX}place-nacre`, name: 'Isla Nácar', kind: 'island', parent: `${PREFIX}place-orthea`, accent: 'rose', symbol: '◒', appearance: text('Isla de acantilados rosados y cavernas que respiran con la marea.', 'An island of pink cliffs and caves that breathe with the tide.'), atmosphere: text('Cantos graves bajo el suelo y lluvia tibia.', 'Low songs beneath the ground and warm rain.'), history: text('Santuario veyari y lugar prohibido para naves de guerra.', 'A Veyari sanctuary forbidden to warships.') },
  { id: `${PREFIX}place-vidrio`, name: 'Mar de Vidrio', kind: 'sea', parent: `${PREFIX}place-elyndra`, accent: 'cyan', symbol: '◇', appearance: text('Superficie cubierta por placas transparentes que se separan y chocan como hielo.', 'A surface covered by transparent plates that part and collide like ice.'), atmosphere: text('Crujidos inmensos y destellos que confunden el horizonte.', 'Immense cracking and flashes that confuse the horizon.'), history: text('Nació cuando cayó la Tercera Luna, según los relatos veyari.', 'Born when the Third Moon fell, according to Veyari accounts.') },
  { id: `${PREFIX}place-ceniza`, name: 'Desierto de Ceniza', kind: 'desert', parent: `${PREFIX}place-aster`, accent: 'crimson', symbol: '△', appearance: text('Dunas grises interrumpidas por esqueletos de torres solares.', 'Grey dunes interrupted by the skeletons of solar towers.'), atmosphere: text('Silencio abrasador y sombras que apuntan en direcciones distintas.', 'Scorching silence and shadows pointing in different directions.'), history: text('Aquí terminó la primera guerra entre los Tejedores y el Faro.', 'The first war between the Weavers and the Lighthouse ended here.') },
] as const;

const GROUPS = [
  { id: `${PREFIX}group-council`, kind: 'faction', name: 'Consejo de Ceniza', status: 'active', parent: null, seat: `${PREFIX}place-lumina`, founded: 733, ended: null, accent: 'crimson', symbol: '⚖', summary: text('Gobierno de emergencia que nunca devolvió el poder.', 'An emergency government that never returned power.'), description: text('Controla la luz, la Guardia y las rutas de evacuación. Lo dirige [[Regente Maelor Sarn]].', 'Controls light, the Guard and evacuation routes. Led by [[Regent Maelor Sarn]].') },
  { id: `${PREFIX}group-guard`, kind: 'order', name: 'Guardia de Ceniza', status: 'active', parent: `${PREFIX}group-council`, seat: `${PREFIX}place-sal`, founded: 734, ended: null, accent: 'slate', symbol: '⚔', summary: text('Orden militar creada para sostener el racionamiento.', 'Military order created to enforce rationing.'), description: text('Vigila las puertas de Lúmina y responde ante el Consejo, aunque muchos de sus oficiales juraron primero a la Casa Venn.', 'Guards Lumina’s gates and answers to the Council, though many officers first swore to House Venn.') },
  { id: `${PREFIX}group-vellum`, kind: 'faction', name: 'Archivo de Bajamar', status: 'active', parent: null, seat: `${PREFIX}place-archivo`, founded: 612, ended: null, accent: 'emerald', symbol: '▤', summary: text('Red de archiveros que rescata memoria del agua.', 'A network of archivists rescuing memory from the water.'), description: text('Sus llaves abren depósitos, máquinas y recuerdos atrapados en vidrio. Protege a [[Sena Mir]].', 'Its keys open stacks, machines and memories trapped in glass. It protects [[Sena Mir]].') },
  { id: `${PREFIX}group-sails`, kind: 'faction', name: 'Gremio de las Seis Velas', status: 'active', parent: null, seat: `${PREFIX}place-lumina`, founded: 655, ended: null, accent: 'sky', symbol: '⛵', summary: text('Liga de capitanes que monopoliza las rutas del Mar de Vidrio.', 'Captains’ league monopolising routes across the Glass Sea.'), description: text('Cada vela representa un rumbo seguro. La séptima ruta, borrada de sus cartas, lleva a la Ciudad Sepultada.', 'Each sail represents a safe bearing. The seventh route, erased from its charts, leads to the Buried City.') },
  { id: `${PREFIX}group-venn`, kind: 'house', name: 'Casa Venn', status: 'dormant', parent: null, seat: `${PREFIX}place-faro`, founded: 203, ended: 733, accent: 'amber', symbol: '✦', summary: text('Dinastía de fareros desplazada por la regencia.', 'A lighthouse dynasty displaced by the regency.'), description: text('Su legitimidad procede del pacto con el Faro y de mapas heredados que nadie más sabe leer.', 'Its legitimacy comes from the pact with the Lighthouse and inherited maps nobody else can read.') },
  { id: `${PREFIX}group-tideborn`, kind: 'culture', name: 'Pueblos de la Marea', status: 'active', parent: null, seat: `${PREFIX}place-nacre`, founded: null, ended: null, accent: 'cyan', symbol: '≈', summary: text('Culturas costeras que cuentan el tiempo por mareas y nombres.', 'Coastal cultures that count time in tides and names.'), description: text('Comparten memoria oral, hospitalidad ritual y rechazo a las fronteras fijas sobre el mar.', 'They share oral memory, ritual hospitality and a rejection of fixed borders at sea.') },
  { id: `${PREFIX}group-veyari`, kind: 'species', name: 'Veyari', status: 'active', parent: `${PREFIX}group-tideborn`, seat: `${PREFIX}place-nacre`, founded: null, ended: null, accent: 'sky', symbol: '◈', summary: text('Pueblo anfibio adaptado a las corrientes de vidrio.', 'An amphibious people adapted to glass currents.'), description: text('Sus membranas perciben vibraciones y sus genealogías se cantan, no se escriben.', 'Their membranes sense vibration and their genealogies are sung rather than written.') },
  { id: `${PREFIX}group-tidecant`, kind: 'language', name: 'Habla de Marea', status: 'active', parent: `${PREFIX}group-tideborn`, seat: null, founded: null, ended: null, accent: 'violet', symbol: '≋', summary: text('Lengua tonal cuyo sentido cambia con el ritmo de respiración.', 'A tonal language whose meaning changes with breathing rhythm.'), description: text('Puede pronunciarse bajo el agua y conserva tiempos verbales para recuerdos heredados.', 'It can be spoken underwater and preserves verb tenses for inherited memories.') },
  { id: `${PREFIX}group-firstlight`, kind: 'religion', name: 'Culto de la Primera Luz', status: 'active', parent: null, seat: `${PREFIX}place-faro`, founded: 1, ended: null, accent: 'amber', symbol: '☼', summary: text('Religión cívica que identifica la continuidad del Faro con la del mundo.', 'A civic religion equating the Lighthouse’s continuity with that of the world.'), description: text('Predica que toda luz exige una deuda equivalente, doctrina que el Consejo interpreta literalmente.', 'It teaches that every light demands an equal debt, a doctrine the Council interprets literally.') },
] as const;

const SCENES = [
  { id: `${PREFIX}scene-prologue`, title: text('Prólogo · El último encendido', 'Prologue · The last lighting'), summary: text('Aurel enciende el Faro durante el Hundimiento y esconde un mapa en la prótesis futura de Ilyra.', 'Aurel lights the Lighthouse during the Sinking and hides a map in Ilyra’s future prosthesis.'), place: `${PREFIX}place-faro`, year: 733, day: 131950, status: 'written', order: 0, mode: 'anchor', offset: 0, anchor: 131950 },
  { id: `${PREFIX}scene-arrival`, title: text('La carta que regresó mojada', 'The letter that returned wet'), summary: text('Ilyra recibe una carta reciente con la letra de Nara y pide a Cael cruzar el Barrio Hundido.', 'Ilyra receives a recent letter in Nara’s hand and asks Cael to cross the Sunken Quarter.'), place: `${PREFIX}place-lumina`, year: 742, day: 133450, status: 'written', order: 1, mode: 'anchor', offset: 0, anchor: 133450 },
  { id: `${PREFIX}scene-archive`, title: text('Voces bajo el agua', 'Voices under water'), summary: text('Sena abre el depósito sellado; Ilyra oye a su padre y encuentra la primera coordenada. ???', 'Sena opens the sealed stack; Ilyra hears her father and finds the first coordinate. ???'), place: `${PREFIX}place-archivo`, year: 742, day: 133450, status: 'draft', order: 2, mode: 'same', offset: 0, anchor: null },
  { id: `${PREFIX}scene-gate`, title: text('La Puerta de Sal', 'The Salt Gate'), summary: text('Tarek debe elegir entre detener a Ilyra o falsificar la orden que permitirá su salida.', 'Tarek must choose between arresting Ilyra or forging the order that lets her leave.'), place: `${PREFIX}place-sal`, year: 742, day: 133451, status: 'draft', order: 3, mode: 'offset', offset: 1, anchor: null },
  { id: `${PREFIX}scene-island`, title: text('El nombre que canta la isla', 'The name the island sings'), summary: text('Vesh revela que el Corazón de Vidrio es una criatura y que Nara sigue viva en su memoria.', 'Vesh reveals that the Glass Heart is a creature and Nara remains alive in its memory.'), place: `${PREFIX}place-nacre`, year: 742, day: 133452, status: 'draft', order: 4, mode: 'offset', offset: 1, anchor: null },
  { id: `${PREFIX}scene-observatory`, title: text('La órbita imposible', 'The impossible orbit'), summary: text('El grupo vuelve al Observatorio y descubre el mecanismo con el que Maelor altera la Tercera Luna.', 'The group returns to the Observatory and discovers the mechanism Maelor uses to alter the Third Moon.'), place: `${PREFIX}place-orla`, year: 742, day: 133454, status: 'outline', order: 5, mode: 'offset', offset: 2, anchor: null },
  { id: `${PREFIX}scene-coup`, title: text('Seis campanas de ceniza', 'Six bells of ash'), summary: text('El Consejo declara traidora a la Casa Venn mientras el Gremio bloquea el puerto.', 'The Council declares House Venn traitorous while the Guild blockades the harbour.'), place: `${PREFIX}place-lumina`, year: 742, day: 133454, status: 'outline', order: 6, mode: 'same', offset: 0, anchor: null },
  { id: `${PREFIX}scene-heart`, title: text('El corazón bajo la ciudad', 'The heart beneath the city'), summary: text('Ilyra llega al Corazón antes que Maelor y debe decidir si apagar para siempre el Faro.', 'Ilyra reaches the Heart before Maelor and must decide whether to extinguish the Lighthouse forever.'), place: `${PREFIX}place-hundido`, year: 742, day: 133455, status: 'outline', order: 7, mode: 'offset', offset: 1, anchor: null },
  { id: `${PREFIX}scene-epilogue`, title: text('Epilogo · Una costa sin dibujar', 'Epilogue · An unmapped coast'), summary: text('Meses después, Sena abre un archivo libre mientras una nueva luz aparece mar adentro.', 'Months later, Sena opens a free archive while a new light appears at sea.'), place: null, year: 743, day: null, status: 'outline', order: 8, mode: 'offset', offset: 90, anchor: null },
] as const;

const ARTICLES = [
  { id: `${PREFIX}article-flux`, category: 'magic', title: text('Flujo de vidrio', 'Glass flux'), aka: text('Luz honda\nResonancia', 'Deep light\nResonance'), summary: text('Energía que conserva memoria y transfiere deuda.', 'Energy that preserves memory and transfers debt.'), body: text('El Flujo recorre el vidrio solar y responde a nombres verdaderos. La [[Casa Venn]] lo canaliza mediante mapas; los [[Veyari]] lo escuchan como una corriente. Su ley principal es [[Toda luz deja sombra]].', 'Flux runs through solar glass and responds to true names. [[House Venn]] channels it through maps; the [[Veyari]] hear it as a current. Its main law is [[Every light casts a shadow]].') },
  { id: `${PREFIX}article-firstlight`, category: 'religion', title: text('Liturgia de la Primera Luz', 'Liturgy of the First Light'), aka: text('Libro del Faro', 'Book of the Lighthouse'), summary: text('Canon ritual usado por el Consejo para legitimar el racionamiento.', 'Ritual canon used by the Council to legitimise rationing.'), body: text('El texto funda el [[Culto de la Primera Luz]] y convierte el mantenimiento del [[Casa del Faro]] en deber cívico. La edición de Maelor omite el capítulo sobre consentimiento.', 'The text establishes the [[Cult of the First Light]] and turns maintenance of the [[Lighthouse House]] into a civic duty. Maelor’s edition omits the chapter on consent.') },
  { id: `${PREFIX}article-tidecant`, category: 'language', title: text('Gramática de la Habla de Marea', 'Grammar of Tidecant'), aka: text('Habla de Marea', 'Tidecant'), summary: text('Lengua de respiración, tono y memoria heredada.', 'A language of breath, tone and inherited memory.'), body: text('La [[Habla de Marea]] distingue entre lo recordado por uno mismo y lo recibido de un antepasado. [[Hermana Vesh]] usa un tercer modo reservado para memorias del mar.', '[[Tidecant]] distinguishes personal memories from those inherited from an ancestor. [[Sister Vesh]] uses a third mode reserved for memories of the sea.') },
  { id: `${PREFIX}article-whale`, category: 'creature', title: text('Ballena de brasa', 'Ember whale'), aka: text('Faros nadadores', 'Swimming beacons'), summary: text('Cetáceo luminoso que migra bajo las placas del Mar de Vidrio.', 'A luminous cetacean migrating beneath the plates of the Glass Sea.'), body: text('Las ballenas de brasa guían a los barcos del [[Gremio de las Seis Velas]]. Sus cantos alteran el [[Flujo de vidrio]] y anticipan una Marea Negra.', 'Ember whales guide ships of the [[Guild of Six Sails]]. Their songs alter [[Glass flux]] and foretell a Black Tide.') },
  { id: `${PREFIX}article-veyari`, category: 'species', title: text('Anatomía veyari', 'Veyari anatomy'), aka: text('Hijos de la corriente', 'Children of the current'), summary: text('Adaptaciones anfibias y memoria vibratoria del pueblo veyari.', 'Amphibious adaptations and vibratory memory of the Veyari people.'), body: text('Las membranas de los [[Veyari]] perciben fracturas bajo el agua. [[Cael Orun]] perdió sensibilidad en la izquierda durante el naufragio de la Aguja Norte.', '[[Veyari]] membranes sense fractures underwater. [[Cael Orun]] lost sensation on the left during the wreck of the North Needle.') },
  { id: `${PREFIX}article-compass`, category: 'artifact', title: text('Brújula de ceniza', 'Ash compass'), aka: text('La Séptima Aguja', 'The Seventh Needle'), summary: text('Instrumento que apunta hacia la deuda más cercana, no hacia el norte.', 'An instrument pointing to the nearest debt rather than north.'), body: text('Aurel dejó la brújula dentro de la mano de [[Ilyra Venn]]. Cerca del [[Archivo Sumergido]] gira hacia abajo, hacia la [[Ciudad Sepultada]].', 'Aurel left the compass inside [[Ilyra Venn]]’s hand. Near the [[Sunken Archive]] it points downward, toward the [[Buried City]].') },
  { id: `${PREFIX}article-looms`, category: 'technology', title: text('Telares solares', 'Solar looms'), aka: text('Tejedores de costa', 'Coast weavers'), summary: text('Máquinas que solidifican luz en puentes, lentes y armas.', 'Machines that solidify light into bridges, lenses and weapons.'), body: text('Los telares construyeron las rutas de [[Aster]]. Bajo el [[Consejo de Ceniza]] también producen barreras que solo obedecen sellos oficiales.', 'The looms built the routes of [[Aster]]. Under the [[Ash Council]] they also produce barriers obeying only official seals.') },
  { id: `${PREFIX}article-debt`, category: 'concept', title: text('Deuda de eco', 'Echo debt'), aka: text('El precio de la luz', 'The price of light'), summary: text('Toda memoria extraída del vidrio desplaza o borra otra.', 'Every memory drawn from glass displaces or erases another.'), body: text('La deuda explica por qué el [[Flujo de vidrio]] no es una fuente gratuita. [[Sena Mir]] descubre que los apagones del Faro coinciden con lagunas en la memoria colectiva.', 'Debt explains why [[Glass flux]] is not a free source. [[Sena Mir]] discovers that Lighthouse blackouts coincide with gaps in collective memory.') },
  { id: `${PREFIX}article-sinking`, category: 'event', title: text('Hundimiento de Lúmina', 'Sinking of Lumina'), aka: text('La Noche Baja', 'The Low Night'), summary: text('Catástrofe de 733 D.F. que sumergió tres distritos y acabó con la Casa Venn.', 'The 733 A.L. disaster that submerged three districts and ended House Venn.'), body: text('Durante el Hundimiento, [[Aurel Venn]] encendió el Faro sin completar el precio. El [[Barrio Hundido]] conserva ecos de quienes fueron evacuados demasiado tarde.', 'During the Sinking, [[Aurel Venn]] lit the Lighthouse without completing the price. The [[Sunken Quarter]] preserves echoes of those evacuated too late.') },
  { id: `${PREFIX}article-keepers`, category: 'organization', title: text('Maestros del Faro', 'Lighthouse Masters'), aka: text('Fareros de la Corona', 'Crown keepers'), summary: text('Oficio hereditario y consejo técnico anterior a la regencia.', 'A hereditary office and technical council predating the regency.'), body: text('La [[Casa Venn]] ocupó el cargo durante cinco siglos. El [[Regente Maelor Sarn]] disolvió el consejo tras el Hundimiento.', '[[House Venn]] held the office for five centuries. [[Regent Maelor Sarn]] dissolved the council after the Sinking.') },
  { id: `${PREFIX}article-orchid`, category: 'flora', title: text('Orquídea de sal', 'Salt orchid'), aka: text('Flor de bajamar', 'Low-tide flower'), summary: text('Flor que cristaliza alrededor de recuerdos intensos.', 'A flower crystallising around intense memories.'), body: text('Crece en [[Isla Nácar]] y en las salas más antiguas del [[Archivo Sumergido]]. Los archiveros la usan para detectar documentos alterados.', 'It grows on [[Nacre Island]] and in the oldest halls of the [[Sunken Archive]]. Archivists use it to detect altered documents.') },
  { id: `${PREFIX}article-fox`, category: 'fauna', title: text('Zorro de lomo vítreo', 'Glassback fox'), aka: text('Rastreador de ecos', 'Echo tracker'), summary: text('Pequeño depredador que sigue vibraciones a través de la roca.', 'A small predator tracking vibration through rock.'), body: text('Las patrullas de la [[Guardia de Ceniza]] los adiestran para localizar contrabando de vidrio. Se niegan a entrar en la [[Casa del Faro]].', '[[Ash Guard]] patrols train them to locate glass contraband. They refuse to enter the [[Lighthouse House]].') },
  { id: `${PREFIX}article-feast`, category: 'custom', title: text('Fiesta de las Seis Mareas', 'Feast of Six Tides'), aka: text('Noche de las Velas', 'Night of Sails'), summary: text('Celebración portuaria en que cada casa ilumina una ruta de regreso.', 'A harbour feast in which each household lights a route home.'), body: text('El [[Gremio de las Seis Velas]] abre sus cartas durante una noche. La séptima lámpara, sin nombre, se deja apagada.', 'The [[Guild of Six Sails]] opens its charts for one night. The unnamed seventh lamp is left dark.') },
  { id: `${PREFIX}article-thirdmoon`, category: 'other', title: text('La Tercera Luna', 'The Third Moon'), aka: text('Orla Negra', 'Black Rim'), summary: text('Objeto celeste cuya órbita contradice el resto del sistema.', 'A celestial object whose orbit contradicts the rest of the system.'), body: text('[[Nara Venn]] demostró desde el [[Observatorio de Orla]] que no orbita Elyndra: mantiene distancia fija respecto al Faro.', 'From the [[Orla Observatory]], [[Nara Venn]] proved it does not orbit Elyndra: it keeps a fixed distance from the Lighthouse.') },
] as const;

function link(kind: string, id: string, label: string): string {
  return `[${label}](nodus://world/${kind}/${id})`;
}

function resolveDemoLinks(value: string): string {
  const entries = [
    ...CHARACTERS.map((item) => ({ kind: 'character', id: item.id, names: [item.name] })),
    ...PLACES.map((item) => ({ kind: 'place', id: item.id, names: [item.name] })),
    ...GROUPS.map((item) => ({ kind: 'group', id: item.id, names: [item.name] })),
    ...SCENES.map((item) => ({ kind: 'scene', id: item.id, names: [item.title.es, item.title.en] })),
    ...ARTICLES.map((item) => ({ kind: 'article', id: item.id, names: [item.title.es, item.title.en, ...item.aka.es.split('\n'), ...item.aka.en.split('\n')] })),
  ];
  let result = value;
  for (const entry of entries) {
    for (const name of [...entry.names].sort((a, b) => b.length - a.length)) {
      result = result.split(`[[${name}]]`).join(link(entry.kind, entry.id, name));
    }
  }
  return result;
}

function demoImage(entityKind: string, entityId: string, title: string, primary: string, symbol: string, order = 0): void {
  const bytes = cardSvg(title, primary, '#111827', symbol);
  insert('world_images', {
    image_id: `${PREFIX}image-${entityKind}-${entityId.slice(PREFIX.length)}-${order}`,
    entity_kind: entityKind,
    entity_id: entityId,
    kind: order === 0 ? 'portrait' : 'other',
    label: title,
    mime_type: 'image/svg+xml',
    bytes: bytes.length,
    blob: bytes,
    prompt: null,
    provider: null,
    model: null,
    style: 'demo-vector',
    generated: 0,
    sort_order: order,
    created_at: AT,
    updated_at: AT,
  });
}

function hasWorldbuildingData(): boolean {
  const db = getDb();
  const count = (table: string): number =>
    Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  return [
    'persons', 'places', 'world_groups', 'world_scenes', 'world_maps', 'world_articles',
    'world_rules', 'world_threads', 'world_questions', 'world_secrets', 'world_calendar', 'notes',
  ].some((table) => count(table) > 0);
}

export function seedWorldbuildingDemoData(): boolean {
  if (getActiveVault().type !== 'worldbuilding' || hasWorldbuildingData()) return false;

  const L = locale();
  const db = getDb();
  const tx = db.transaction(() => {
    // Calendar: two eras and six distinct months exercise exact dates, backwards eras,
    // month ordering and the fallback to year-only dates.
    insert('world_calendar', {
      id: 1,
      name: L === 'es' ? 'Calendario de las Mareas' : 'Calendar of Tides',
      notes: L === 'es' ? 'Seis meses de treinta días. D.F. significa Después del Faro.' : 'Six thirty-day months. A.L. means After the Lighthouse.',
      created_at: AT,
      updated_at: AT,
    });
    [
      [`${PREFIX}era-before`, L === 'es' ? 'Antes del Faro' : 'Before the Lighthouse', L === 'es' ? 'A.F.' : 'B.L.', -1, 1, 0],
      [`${PREFIX}era-after`, L === 'es' ? 'Después del Faro' : 'After the Lighthouse', L === 'es' ? 'D.F.' : 'A.L.', 0, 0, 1],
    ].forEach(([era_id, name, abbreviation, start_year, counts_backwards, sort_order]) =>
      insert('world_calendar_eras', { era_id, name, abbreviation, start_year, counts_backwards, sort_order, created_at: AT, updated_at: AT })
    );
    const monthNames = L === 'es'
      ? ['Brasa', 'Lluvia', 'Sal', 'Viento', 'Ceniza', 'Quietud']
      : ['Ember', 'Rain', 'Salt', 'Wind', 'Ash', 'Stillness'];
    monthNames.forEach((name, index) =>
      insert('world_calendar_months', {
        month_id: `${PREFIX}month-${index + 1}`, name, days: 30, sort_order: index, created_at: AT, updated_at: AT,
      })
    );

    // Places and fiction overlays.
    for (const place of PLACES) {
      insert('places', {
        place_id: place.id, name: place.name, parent_id: place.parent, kind: place.kind,
        latitude: null, longitude: null,
        notes: L === 'es' ? `Entrada del atlas de demostración: ${place.name}.` : `Demo atlas entry: ${place.name}.`,
        created_at: AT, updated_at: AT,
      });
      insert('place_profiles', {
        place_id: place.id,
        appearance: resolveDemoLinks(place.appearance[L]),
        atmosphere: resolveDemoLinks(place.atmosphere[L]),
        history: resolveDemoLinks(place.history[L]),
        visual_seed: `${place.name}, illustrated maritime fantasy atlas, ${place.accent}`,
        accent: place.accent,
        created_at: AT,
        updated_at: AT,
      });
      demoImage('place', place.id, place.name, place.accent === 'crimson' ? '#9f1239' : '#075985', place.symbol);
    }

    // Characters: the reusable person row, full fiction profile, names, avatar and
    // gallery. All profile prompts have meaningful values so every dossier panel opens
    // populated; Elan deliberately demonstrates the unborn/unknown states.
    for (const [index, character] of CHARACTERS.entries()) {
      insert('persons', {
        person_id: character.id,
        display_name: character.name,
        sex: 'unknown',
        birth_date: character.birth,
        birth_date_sort: null,
        death_date: character.death,
        death_date_sort: null,
        notes: L === 'es' ? 'Personaje del mundo de demostración Las Mareas de Ceniza.' : 'Character from The Ashen Tides demo world.',
        biography: character.biography[L],
        biography_at: AT,
        frame_style: index % 3 === 0 ? 'brass' : null,
        created_at: PREVIOUS_AT,
        updated_at: AT,
      });
      insert('person_names', { id: `${PREFIX}name-${index}-main`, person_id: character.id, name: character.name, kind: null, secret: 0, known_by: null });
      insert('character_profiles', {
        person_id: character.id,
        species: character.species,
        gender: character.gender,
        pronouns: character.pronouns,
        life_status: character.life,
        narrative_role: character.role,
        accent: character.accent,
        appearance: resolveDemoLinks(character.appearance[L]),
        personality: resolveDemoLinks(character.personality[L]),
        backstory: resolveDemoLinks(character.backstory[L]),
        visual_seed: character.visual,
        birth_year_sort: Number(character.birth.match(/\d{3}/)?.[0] ?? null) || null,
        death_year_sort: character.death ? Number(character.death.match(/\d{3}/)?.[0] ?? null) || null : null,
        arc_want: character.want[L],
        arc_need: character.need[L],
        arc_flaw: character.flaw[L],
        arc_lie: character.lie[L],
        arc_wound: character.wound[L],
        voice_register: character.voice[0],
        voice_tics: character.voice[1],
        voice_sample: character.voice[2],
        biography_proposed: null,
        biography_proposed_at: null,
        created_at: PREVIOUS_AT,
        updated_at: AT,
      });
      const portrait = portraitSvg(character.name, character.colors[0], character.colors[1]);
      insert('person_portraits', {
        person_id: character.id, blob: portrait, mime: 'image/svg+xml',
        focus_x: 0.5, focus_y: 0.42, scale: 1, generated: 0, updated_at: AT,
      });
      demoImage('character', character.id, character.name, character.colors[0], initials(character.name));
    }
    [
      [`${PREFIX}name-ilyra-epithet`, `${PREFIX}char-ilyra`, L === 'es' ? 'La Cartógrafa de Ceniza' : 'The Ash Cartographer', 'epithet', 0, null],
      [`${PREFIX}name-ilyra-secret`, `${PREFIX}char-ilyra`, 'Asteriel', 'true_name', 1, L === 'es' ? 'Nara, Vesh y Sena' : 'Nara, Vesh and Sena'],
      [`${PREFIX}name-cael-nick`, `${PREFIX}char-cael`, L === 'es' ? 'Séptima Vela' : 'Seventh Sail', 'nickname', 0, null],
      [`${PREFIX}name-maelor-title`, `${PREFIX}char-maelor`, L === 'es' ? 'Custodio de la Continuidad' : 'Keeper of Continuity', 'epithet', 0, null],
      [`${PREFIX}name-nara-alias`, `${PREFIX}char-nara`, L === 'es' ? 'Orla' : 'Rim', 'alias', 1, L === 'es' ? 'Ilyra' : 'Ilyra'],
    ].forEach(([id, person_id, name, kind, secret, known_by]) =>
      insert('person_names', { id, person_id, name, kind, secret, known_by })
    );

    // Abilities deliberately include costs and limits: this is the part that prevents a
    // magic system from looking complete while behaving like a plot solvent.
    [
      [`${PREFIX}ability-ilyra-map`, `${PREFIX}char-ilyra`, L === 'es' ? 'Cartografía resonante' : 'Resonant cartography', L === 'es' ? 'Percibe rutas recorridas por la luz.' : 'Perceives routes travelled by light.', L === 'es' ? 'Pierde un recuerdo reciente por cada mapa leído.' : 'Loses one recent memory per map read.', L === 'es' ? 'Solo funciona sobre vidrio que haya visto el sol.' : 'Only works on glass that has seen sunlight.', 0],
      [`${PREFIX}ability-ilyra-hand`, `${PREFIX}char-ilyra`, L === 'es' ? 'Mano prismática' : 'Prismatic hand', L === 'es' ? 'Refracta un haz en seis direcciones.' : 'Refracts one beam in six directions.', L === 'es' ? 'La prótesis se agrieta y causa dolor.' : 'The prosthesis cracks and causes pain.', L === 'es' ? 'No crea luz propia.' : 'It creates no light of its own.', 1],
      [`${PREFIX}ability-cael-current`, `${PREFIX}char-cael`, L === 'es' ? 'Lectura de corrientes' : 'Current reading', L === 'es' ? 'Detecta fracturas y movimiento bajo el agua.' : 'Detects fractures and movement underwater.', L === 'es' ? 'La sobrecarga lo deja sordo a vibraciones.' : 'Overload leaves him deaf to vibration.', L === 'es' ? 'No atraviesa metal macizo.' : 'Cannot pass through solid metal.', 0],
      [`${PREFIX}ability-sena-echo`, `${PREFIX}char-sena`, L === 'es' ? 'Escucha de ecos' : 'Echo listening', L === 'es' ? 'Oye memoria residual almacenada en vidrio.' : 'Hears residual memory stored in glass.', L === 'es' ? 'Confunde recuerdos ajenos con propios durante horas.' : 'Confuses others’ memories with their own for hours.', L === 'es' ? 'No distingue una memoria manipulada.' : 'Cannot distinguish an altered memory.', 0],
      [`${PREFIX}ability-vesh-memory`, `${PREFIX}char-vesh`, L === 'es' ? 'Memoria de marea' : 'Tide memory', L === 'es' ? 'Comparte recuerdos heredados mediante canto.' : 'Shares inherited memories through song.', L === 'es' ? 'Quien escucha hereda también una emoción.' : 'The listener also inherits an emotion.', L === 'es' ? 'No puede transmitir nombres verdaderos.' : 'Cannot transmit true names.', 0],
    ].forEach(([ability_id, person_id, name, description, cost, limits, sort_order]) =>
      insert('character_abilities', { ability_id, person_id, name, description, cost, limits, sort_order, created_at: AT, updated_at: AT })
    );

    // Family tree and social graph.
    [
      [`${PREFIX}rel-aurel-nara`, `${PREFIX}char-aurel`, `${PREFIX}char-nara`, 'parent', 'user_asserted', null],
      [`${PREFIX}rel-aurel-ilyra`, `${PREFIX}char-aurel`, `${PREFIX}char-ilyra`, 'parent', 'user_asserted', null],
      [`${PREFIX}rel-ilyra-elan`, `${PREFIX}char-ilyra`, `${PREFIX}char-elan`, 'parent', 'user_asserted', 'adoptive'],
      [`${PREFIX}rel-ilyra-cael`, `${PREFIX}char-cael`, `${PREFIX}char-ilyra`, 'spouse', 'user_asserted', null],
      [`${PREFIX}rel-maelor-tarek`, `${PREFIX}char-maelor`, `${PREFIX}char-tarek`, 'parent', 'user_asserted', 'adoptive'],
    ].forEach(([rel_id, from_person, to_person, type, provenance, subtype]) =>
      insert('relationships', { rel_id, from_person, to_person, type, provenance, subtype, notes: null, created_at: AT })
    );
    [
      [`${PREFIX}contact-rhea`, 'Rhea Sol', L === 'es' ? 'Contrabandista de lentes y enlace en el puerto.' : 'Lens smuggler and harbour contact.'],
      [`${PREFIX}contact-boros`, 'Boros el Calderero', L === 'es' ? 'Artesano que repara prótesis sin licencia.' : 'Craftsperson repairing prostheses without a licence.'],
      [`${PREFIX}contact-oracle`, L === 'es' ? 'Oráculo de Sal' : 'Salt Oracle', L === 'es' ? 'Identidad desconocida; solo habla a través de conchas selladas.' : 'Unknown identity; speaks only through sealed shells.'],
    ].forEach(([contact_id, display_name, notes]) =>
      insert('social_contacts', { contact_id, display_name, notes, created_at: AT, updated_at: AT })
    );
    [
      [`${PREFIX}social-ilyra-tarek`, `${PREFIX}char-ilyra`, 'person', `${PREFIX}char-tarek`, L === 'es' ? 'amistad rota' : 'broken friendship', L === 'es' ? 'Se criaron juntos en la Casa del Faro.' : 'They grew up together in the Lighthouse House.', 'mixed'],
      [`${PREFIX}social-tarek-ilyra`, `${PREFIX}char-tarek`, 'person', `${PREFIX}char-ilyra`, L === 'es' ? 'protege en secreto' : 'secretly protects', L === 'es' ? 'Manipula órdenes para retrasar su captura.' : 'He alters orders to delay her capture.', 'positive'],
      [`${PREFIX}social-cael-rhea`, `${PREFIX}char-cael`, 'contact', `${PREFIX}contact-rhea`, L === 'es' ? 'socia y acreedora' : 'partner and creditor', L === 'es' ? 'Rhea conserva la escritura de la nave de Cael.' : 'Rhea holds the deed to Cael’s ship.', 'mixed'],
      [`${PREFIX}social-ilyra-boros`, `${PREFIX}char-ilyra`, 'contact', `${PREFIX}contact-boros`, L === 'es' ? 'artesano de confianza' : 'trusted craftsperson', L === 'es' ? 'Construyó la mano prismática a partir del mapa de Aurel.' : 'Built the prismatic hand from Aurel’s map.', 'positive'],
      [`${PREFIX}social-maelor-oracle`, `${PREFIX}char-maelor`, 'contact', `${PREFIX}contact-oracle`, L === 'es' ? 'informante' : 'informant', L === 'es' ? 'Maelor recibe profecías incompletas y cree controlar la fuente.' : 'Maelor receives incomplete prophecies and believes he controls the source.', 'negative'],
      [`${PREFIX}social-sena-vesh`, `${PREFIX}char-sena`, 'person', `${PREFIX}char-vesh`, L === 'es' ? 'mentora improbable' : 'unlikely mentor', L === 'es' ? 'Vesh enseña a Sena a separar memoria y emoción.' : 'Vesh teaches Sena to separate memory from emotion.', 'positive'],
    ].forEach(([relation_id, person_id, target_kind, target_id, role, notes, valence]) =>
      insert('social_relations', { relation_id, person_id, target_kind, target_id, role, notes, valence, since_event_id: null, created_at: AT, updated_at: AT })
    );

    // Groups and affiliations. One deliberately inverted membership feeds a visible,
    // deterministic continuity finding.
    for (const group of GROUPS) {
      insert('world_groups', {
        group_id: group.id, kind: group.kind, name: group.name,
        summary: group.summary[L], description: resolveDemoLinks(group.description[L]),
        visual_seed: `${group.name}, heraldic emblem, maritime fantasy`,
        accent: group.accent, status: group.status, parent_id: group.parent,
        seat_place_id: group.seat, founded_year: group.founded, ended_year: group.ended,
        notes: L === 'es' ? 'Grupo de demostración con relaciones y miembros editables.' : 'Demo group with editable relationships and members.',
        created_at: AT, updated_at: AT,
      });
      demoImage('group', group.id, group.name, group.accent === 'crimson' ? '#9f1239' : '#155e75', group.symbol);
    }
    [
      [`${PREFIX}aff-ilyra-venn`, `${PREFIX}char-ilyra`, `${PREFIX}group-venn`, L === 'es' ? 'heredera' : 'heir', null, null],
      [`${PREFIX}aff-nara-venn`, `${PREFIX}char-nara`, `${PREFIX}group-venn`, L === 'es' ? 'primogénita' : 'firstborn', 131000, 133300],
      [`${PREFIX}aff-maelor-council`, `${PREFIX}char-maelor`, `${PREFIX}group-council`, L === 'es' ? 'regente' : 'regent', 131950, null],
      [`${PREFIX}aff-tarek-guard`, `${PREFIX}char-tarek`, `${PREFIX}group-guard`, L === 'es' ? 'comandante' : 'commander', 132900, null],
      [`${PREFIX}aff-odran-guard`, `${PREFIX}char-odran`, `${PREFIX}group-guard`, L === 'es' ? 'guardián' : 'guardian', 126000, 133100],
      [`${PREFIX}aff-cael-sails`, `${PREFIX}char-cael`, `${PREFIX}group-sails`, L === 'es' ? 'capitán suspendido' : 'suspended captain', 132000, 133000],
      [`${PREFIX}aff-sena-vellum`, `${PREFIX}char-sena`, `${PREFIX}group-vellum`, L === 'es' ? 'aprendiz' : 'apprentice', 133000, null],
      [`${PREFIX}aff-cael-veyari`, `${PREFIX}char-cael`, `${PREFIX}group-veyari`, L === 'es' ? 'navegante' : 'navigator', null, null],
      [`${PREFIX}aff-vesh-veyari`, `${PREFIX}char-vesh`, `${PREFIX}group-veyari`, L === 'es' ? 'guardiana de memoria' : 'memory keeper', null, null],
      [`${PREFIX}aff-vesh-tide`, `${PREFIX}char-vesh`, `${PREFIX}group-tideborn`, L === 'es' ? 'hermana de marea' : 'tide sister', null, null],
      [`${PREFIX}aff-nara-broken`, `${PREFIX}char-nara`, `${PREFIX}group-vellum`, L === 'es' ? 'investigadora invitada' : 'visiting researcher', 133500, 133400],
    ].forEach(([affiliation_id, person_id, group_id, rank, from_world_day, to_world_day]) =>
      insert('character_affiliations', {
        affiliation_id, person_id, group_id, rank, from_world_day, to_world_day,
        notes: null, created_at: AT, updated_at: AT,
      })
    );

    // Secrets and knowledge windows.
    [
      [`${PREFIX}secret-name`, L === 'es' ? 'El nombre verdadero del Faro' : 'The Lighthouse’s true name', L === 'es' ? 'Asteriel: un nombre capaz de detener el Flujo durante una marea.' : 'Asteriel: a name able to stop Flux for one tide.', `${PREFIX}char-nara`, 'kept', null],
      [`${PREFIX}secret-heart`, L === 'es' ? 'El Corazón está vivo' : 'The Heart is alive', L === 'es' ? 'El Corazón de Vidrio es una ballena de brasa inmovilizada bajo Lúmina.' : 'The Glass Heart is an ember whale pinned beneath Lumina.', `${PREFIX}char-vesh`, 'revealed', 133452],
      [`${PREFIX}secret-sinking`, L === 'es' ? 'Maelor ordenó cerrar las compuertas' : 'Maelor ordered the gates closed', L === 'es' ? 'La inundación del Barrio Hundido fue agravada para salvar la terraza alta.' : 'The Sunken Quarter’s flood was worsened to save the upper terrace.', `${PREFIX}char-maelor`, 'kept', null],
    ].forEach(([secret_id, title, content, owner_person_id, status, revealed_world_day]) =>
      insert('world_secrets', { secret_id, title, content, owner_person_id, status, revealed_world_day, notes: null, created_at: AT, updated_at: AT })
    );
    [
      [`${PREFIX}knower-name-nara`, `${PREFIX}secret-name`, `${PREFIX}char-nara`, 133445, L === 'es' ? 'Lo encontró en los mapas de Aurel.' : 'Found it in Aurel’s maps.'],
      [`${PREFIX}knower-name-ilyra`, `${PREFIX}secret-name`, `${PREFIX}char-ilyra`, 133440, L === 'es' ? 'Apareció grabado dentro de su prótesis.' : 'It appeared engraved inside her prosthesis.'],
      [`${PREFIX}knower-name-vesh`, `${PREFIX}secret-name`, `${PREFIX}char-vesh`, null, L === 'es' ? 'Lo recuerda de una marea anterior.' : 'Remembers it from an earlier tide.'],
      [`${PREFIX}knower-heart-vesh`, `${PREFIX}secret-heart`, `${PREFIX}char-vesh`, 120000, L === 'es' ? 'Memoria heredada.' : 'Inherited memory.'],
      [`${PREFIX}knower-heart-sena`, `${PREFIX}secret-heart`, `${PREFIX}char-sena`, 133450, L === 'es' ? 'Lo oyó en el Archivo.' : 'Heard it in the Archive.'],
      [`${PREFIX}knower-sinking-maelor`, `${PREFIX}secret-sinking`, `${PREFIX}char-maelor`, 131950, L === 'es' ? 'Dio la orden.' : 'Gave the order.'],
      [`${PREFIX}knower-sinking-tarek`, `${PREFIX}secret-sinking`, `${PREFIX}char-tarek`, 133454, L === 'es' ? 'Encontró el registro de guardia.' : 'Found the guard log.'],
    ].forEach(([id, secret_id, person_id, since_world_day, how]) =>
      insert('secret_knowers', { id, secret_id, person_id, since_world_day, how, created_at: AT })
    );

    // Events and places of residence feed the chronology and the presence engine.
    const events = [
      [`${PREFIX}event-birth-ilyra`, 'birth', L === 'es' ? 'Nacimiento de Ilyra' : 'Birth of Ilyra', '719 D.F.', `${PREFIX}place-lumina`, 719, 0, 16, [[`${PREFIX}char-ilyra`, 'principal'], [`${PREFIX}char-aurel`, 'father']]],
      [`${PREFIX}event-sinking`, 'loss', L === 'es' ? 'Hundimiento de Lúmina' : 'Sinking of Lumina', '30 de Ceniza, 733 D.F.', `${PREFIX}place-hundido`, 733, 4, 30, [[`${PREFIX}char-aurel`, 'principal'], [`${PREFIX}char-ilyra`, 'witness'], [`${PREFIX}char-maelor`, 'witness']]],
      [`${PREFIX}event-oath-tarek`, 'oath', L === 'es' ? 'Juramento de Tarek' : 'Tarek’s oath', '1 de Brasa, 739 D.F.', `${PREFIX}place-sal`, 739, 0, 1, [[`${PREFIX}char-tarek`, 'principal'], [`${PREFIX}char-maelor`, 'witness']]],
      [`${PREFIX}event-death-odran`, 'death', L === 'es' ? 'Muerte registrada de Odran' : 'Recorded death of Odran', '19 de Brasa, 740 D.F.', `${PREFIX}place-sal`, 740, 0, 19, [[`${PREFIX}char-odran`, 'principal'], [`${PREFIX}char-tarek`, 'witness']]],
      [`${PREFIX}event-nara-missing`, 'loss', L === 'es' ? 'Desaparición de Nara' : 'Nara’s disappearance', '7 de Quietud, 741 D.F.', `${PREFIX}place-orla`, 741, 5, 7, [[`${PREFIX}char-nara`, 'principal']]],
      [`${PREFIX}event-cael-exile`, 'exile', L === 'es' ? 'Expulsión de Cael del Gremio' : 'Cael expelled from the Guild', '22 de Viento, 741 D.F.', `${PREFIX}place-lumina`, 741, 3, 22, [[`${PREFIX}char-cael`, 'principal']]],
      [`${PREFIX}event-odran-after`, 'first_appearance', L === 'es' ? 'Odran visto en el Faro' : 'Odran seen at the Lighthouse', '2 de Sal, 742 D.F.', `${PREFIX}place-faro`, 742, 2, 2, [[`${PREFIX}char-odran`, 'principal'], [`${PREFIX}char-sena`, 'witness']]],
      [`${PREFIX}event-letter`, 'revelation', L === 'es' ? 'Regresa la carta de Nara' : 'Nara’s letter returns', '10 de Sal, 742 D.F.', `${PREFIX}place-lumina`, 742, 2, 10, [[`${PREFIX}char-ilyra`, 'principal'], [`${PREFIX}char-cael`, 'witness']]],
    ] as const;
    for (const [event_id, type, label, date, place_id, year, month_index, day, participants] of events) {
      insert('events', { event_id, type, label, date, date_sort: null, date_end_sort: null, place_id, notes: null, created_at: AT, updated_at: AT });
      insert('event_world_dates', { event_id, world_year: year, world_order: 0, era_id: `${PREFIX}era-after`, month_index, day, world_day: null });
      participants.forEach(([person_id, role], index) =>
        insert('event_participants', { id: `${event_id}-participant-${index}`, event_id, person_id, role })
      );
      insert('record_evidence', {
        id: `${event_id}-evidence`, target_kind: 'event', target_id: event_id, nodus_id: null,
        source_kind: 'work', quote: L === 'es' ? `Registro narrativo: ${label}.` : `Narrative record: ${label}.`,
        location: L === 'es' ? 'Biblia del mundo demo' : 'Demo world bible', confidence: 1, created_at: AT,
      });
    }
    [
      [`${PREFIX}residence-ilyra`, `${PREFIX}char-ilyra`, `${PREFIX}place-faro`, L === 'es' ? 'residencia' : 'residence', '719–733 D.F.'],
      [`${PREFIX}residence-sena`, `${PREFIX}char-sena`, `${PREFIX}place-hundido`, L === 'es' ? 'residencia' : 'residence', '725–742 D.F.'],
      [`${PREFIX}residence-cael`, `${PREFIX}char-cael`, `${PREFIX}place-nacre`, L === 'es' ? 'origen' : 'origin', '716 D.F.'],
      [`${PREFIX}residence-maelor`, `${PREFIX}char-maelor`, `${PREFIX}place-lumina`, L === 'es' ? 'residencia' : 'residence', '688–742 D.F.'],
      [`${PREFIX}residence-vesh`, `${PREFIX}char-vesh`, `${PREFIX}place-nacre`, L === 'es' ? 'santuario' : 'sanctuary', null],
    ].forEach(([id, person_id, place_id, label, date]) =>
      insert('person_places', { id, person_id, place_id, label, date, date_sort: null, notes: null, created_at: AT, updated_at: AT })
    );

    // Scenes, cast, relative day chain and a gallery image on every scene.
    const cast: Record<string, [string, string][]> = {
      [`${PREFIX}scene-prologue`]: [[`${PREFIX}char-aurel`, 'punto de vista'], [`${PREFIX}char-maelor`, 'testigo']],
      [`${PREFIX}scene-arrival`]: [[`${PREFIX}char-ilyra`, 'punto de vista'], [`${PREFIX}char-cael`, 'aliado'], [`${PREFIX}char-tarek`, 'obstáculo']],
      [`${PREFIX}scene-archive`]: [[`${PREFIX}char-ilyra`, 'punto de vista'], [`${PREFIX}char-sena`, 'guía'], [`${PREFIX}char-odran`, 'aparición']],
      [`${PREFIX}scene-gate`]: [[`${PREFIX}char-ilyra`, 'fugitiva'], [`${PREFIX}char-cael`, 'aliado'], [`${PREFIX}char-tarek`, 'punto de vista']],
      [`${PREFIX}scene-island`]: [[`${PREFIX}char-ilyra`, 'visitante'], [`${PREFIX}char-cael`, 'intérprete'], [`${PREFIX}char-vesh`, 'guardiana'], [`${PREFIX}char-sena`, 'aprendiz']],
      [`${PREFIX}scene-observatory`]: [[`${PREFIX}char-ilyra`, 'punto de vista'], [`${PREFIX}char-sena`, 'investigadora'], [`${PREFIX}char-tarek`, 'aliado incierto']],
      [`${PREFIX}scene-coup`]: [[`${PREFIX}char-maelor`, 'punto de vista'], [`${PREFIX}char-tarek`, 'comandante']],
      [`${PREFIX}scene-heart`]: [[`${PREFIX}char-ilyra`, 'punto de vista'], [`${PREFIX}char-cael`, 'aliado'], [`${PREFIX}char-sena`, 'aliade'], [`${PREFIX}char-maelor`, 'antagonista'], [`${PREFIX}char-vesh`, 'testigo']],
      [`${PREFIX}scene-epilogue`]: [[`${PREFIX}char-sena`, 'punto de vista'], [`${PREFIX}char-elan`, 'presagio']],
    };
    for (const scene of SCENES) {
      insert('world_scenes', {
        scene_id: scene.id, title: scene.title[L], summary: resolveDemoLinks(scene.summary[L]),
        place_id: scene.place, world_year: scene.year, world_day: scene.day, status: scene.status,
        narrative_order: scene.order,
        notes: L === 'es' ? 'Escena de demostración: reparto, día, hilos, reglas, preguntas y manuscrito están conectados.' : 'Demo scene: cast, day, threads, rules, questions and manuscript are connected.',
        created_at: AT, updated_at: AT,
      });
      insert('world_scene_days', {
        scene_id: scene.id, mode: scene.mode, offset_days: scene.offset,
        anchor_world_day: scene.anchor, created_at: AT, updated_at: AT,
      });
      (cast[scene.id] ?? []).forEach(([person_id, role], index) =>
        insert('scene_characters', { id: `${scene.id}-cast-${index}`, scene_id: scene.id, person_id, role })
      );
      demoImage('scene', scene.id, scene.title[L], scene.order % 2 === 0 ? '#4338ca' : '#0f766e', '◫');
    }

    // Atlas: multiple maps, previous/reference images, every layer kind needed by the
    // editor, and every marker geometry. Coordinates and periods are real inputs to the
    // coverage, focus and travel engines.
    const maps = [
      { id: `${PREFIX}map-world`, name: L === 'es' ? 'Atlas de Elyndra' : 'Atlas of Elyndra', kind: 'world', place: `${PREFIX}place-elyndra`, parent: null, box: [null, null, null, null], projection: 'globe', radius: 4800, radiusUnit: 'km', scale: [0.12, 0.88, 0.32, 0.88, 1200, 'km'], order: 0, detail: false },
      { id: `${PREFIX}map-orthea`, name: L === 'es' ? 'Reino de Orthea' : 'Kingdom of Orthea', kind: 'region', place: `${PREFIX}place-orthea`, parent: `${PREFIX}map-world`, box: [0.18, 0.25, 0.72, 0.78], projection: 'flat', radius: null, radiusUnit: null, scale: [0.08, 0.91, 0.28, 0.91, 300, 'km'], order: 1, detail: false },
      { id: `${PREFIX}map-lumina`, name: L === 'es' ? 'Ciudad de Lúmina' : 'City of Lumina', kind: 'city', place: `${PREFIX}place-lumina`, parent: `${PREFIX}map-orthea`, box: [0.31, 0.27, 0.61, 0.58], projection: 'flat', radius: null, radiusUnit: null, scale: [0.08, 0.91, 0.28, 0.91, 4, 'km'], order: 2, detail: true },
      { id: `${PREFIX}map-old`, name: L === 'es' ? 'Orthea antes del Hundimiento' : 'Orthea before the Sinking', kind: 'region', place: `${PREFIX}place-orthea`, parent: `${PREFIX}map-world`, box: [0.18, 0.25, 0.72, 0.78], projection: 'flat', radius: null, radiusUnit: null, scale: [0.08, 0.91, 0.28, 0.91, 300, 'km'], order: 3, detail: false },
    ] as const;
    for (const map of maps) {
      const imageId = `${PREFIX}map-image-${map.id.slice(PREFIX.length)}`;
      insert('world_maps', {
        map_id: map.id, name: map.name, kind: map.kind, place_id: map.place, parent_map_id: map.parent,
        parent_x0: map.box[0], parent_y0: map.box[1], parent_x1: map.box[2], parent_y1: map.box[3],
        image_id: imageId, width_px: 1280, height_px: 800,
        scale_x0: map.scale[0], scale_y0: map.scale[1], scale_x1: map.scale[2], scale_y1: map.scale[3],
        scale_distance: map.scale[4], scale_unit: map.scale[5],
        projection: map.projection, planet_radius: map.radius, planet_radius_unit: map.radiusUnit,
        from_world_day: map.id === `${PREFIX}map-old` ? 0 : null,
        to_world_day: map.id === `${PREFIX}map-old` ? 131949 : null,
        visual_seed: 'antique maritime fantasy atlas, glass coastlines, ink and gold',
        style: 'illustrated parchment', model_labels: 0,
        notes: L === 'es' ? 'Mapa vectorial local de demostración con capas, escala y marcadores editables.' : 'Local vector demo map with editable layers, scale and markers.',
        sort_order: map.order, created_at: AT, updated_at: AT,
      });
      const bytes = mapSvg(map.name, map.detail);
      insert('map_images', {
        image_id: imageId, map_id: map.id, role: 'base', mime_type: 'image/svg+xml',
        width: 1280, height: 800, bytes: bytes.length, blob: bytes, thumbnail: bytes,
        prompt: null, provider: null, model: null, style: 'demo-vector', generated: 0, created_at: AT,
      });
    }
    const previousMap = mapSvg(L === 'es' ? 'Borrador anterior de Orthea' : 'Previous Orthea draft');
    insert('map_images', {
      image_id: `${PREFIX}map-image-previous`, map_id: `${PREFIX}map-orthea`, role: 'previous',
      mime_type: 'image/svg+xml', width: 1280, height: 800, bytes: previousMap.length, blob: previousMap,
      thumbnail: previousMap, prompt: null, provider: null, model: null, style: 'demo-vector',
      generated: 0, created_at: PREVIOUS_AT,
    });
    const referenceMap = mapSvg(L === 'es' ? 'Referencia costera' : 'Coastal reference', true);
    insert('map_images', {
      image_id: `${PREFIX}map-image-reference`, map_id: `${PREFIX}map-lumina`, role: 'reference',
      mime_type: 'image/svg+xml', width: 1280, height: 800, bytes: referenceMap.length, blob: referenceMap,
      thumbnail: referenceMap, prompt: null, provider: null, model: null, style: 'demo-vector',
      generated: 0, created_at: PREVIOUS_AT,
    });
    const layers = [
      [`${PREFIX}layer-political`, `${PREFIX}map-orthea`, L === 'es' ? 'Fronteras actuales' : 'Current borders', 'political', '#eab308', 0.72, 1, 0],
      [`${PREFIX}layer-physical`, `${PREFIX}map-orthea`, L === 'es' ? 'Relieve y corrientes' : 'Terrain and currents', 'physical', '#22c55e', 0.68, 1, 1],
      [`${PREFIX}layer-routes`, `${PREFIX}map-orthea`, L === 'es' ? 'Rutas navegables' : 'Navigable routes', 'routes', '#38bdf8', 0.9, 1, 2],
      [`${PREFIX}layer-climate`, `${PREFIX}map-world`, L === 'es' ? 'Mareas Negras' : 'Black Tides', 'climate', '#6366f1', 0.5, 1, 0],
      [`${PREFIX}layer-culture`, `${PREFIX}map-orthea`, L === 'es' ? 'Pueblos de la Marea' : 'Tide Peoples', 'culture', '#a855f7', 0.55, 1, 3],
      [`${PREFIX}layer-battle`, `${PREFIX}map-lumina`, L === 'es' ? 'Asedio previsto' : 'Planned siege', 'battle', '#ef4444', 0.75, 0, 0],
      [`${PREFIX}layer-labels`, `${PREFIX}map-lumina`, L === 'es' ? 'Nombres y distritos' : 'Names and districts', 'labels', '#f8fafc', 1, 1, 1],
      [`${PREFIX}layer-custom`, `${PREFIX}map-lumina`, L === 'es' ? 'Túneles del Archivo' : 'Archive tunnels', 'custom', '#10b981', 0.8, 1, 2],
    ] as const;
    layers.forEach(([layer_id, map_id, name, kind, color, opacity, visible, sort_order]) =>
      insert('map_layers', { layer_id, map_id, name, kind, color, opacity, visible, sort_order, created_at: AT, updated_at: AT })
    );
    const markers = [
      [`${PREFIX}marker-lumina`, `${PREFIX}map-orthea`, `${PREFIX}layer-political`, `${PREFIX}place-lumina`, `${PREFIX}map-lumina`, null, 'point', .22, .31, null, null, 'city', '#f8fafc', null, null, 0],
      [`${PREFIX}marker-nacre`, `${PREFIX}map-orthea`, `${PREFIX}layer-physical`, `${PREFIX}place-nacre`, null, null, 'circle', .78, .72, .055, null, 'island', '#f472b6', null, null, 1],
      [`${PREFIX}marker-sal`, `${PREFIX}map-orthea`, `${PREFIX}layer-political`, `${PREFIX}place-sal`, null, null, 'point', .67, .25, null, null, 'fortress', '#eab308', null, null, 2],
      [`${PREFIX}marker-ceniza`, `${PREFIX}map-world`, `${PREFIX}layer-climate`, `${PREFIX}place-ceniza`, null, null, 'polygon', .58, .42, null, JSON.stringify([[.45,.34],[.71,.31],[.77,.53],[.52,.59]]), 'desert', '#a16207', null, null, 0],
      [`${PREFIX}marker-route`, `${PREFIX}map-orthea`, `${PREFIX}layer-routes`, null, null, L === 'es' ? 'Séptima ruta' : 'Seventh route', 'path', .22, .31, null, JSON.stringify([[.22,.31],[.42,.46],[.61,.55],[.78,.72]]), 'route', '#38bdf8', 133000, null, 3],
      [`${PREFIX}marker-council`, `${PREFIX}map-lumina`, `${PREFIX}layer-battle`, `${PREFIX}place-faro`, null, L === 'es' ? 'Cerco del Consejo' : 'Council cordon', 'circle', .48, .28, .18, null, 'battle', '#ef4444', 133454, 133455, 0],
      [`${PREFIX}marker-hundido`, `${PREFIX}map-lumina`, `${PREFIX}layer-labels`, `${PREFIX}place-hundido`, null, null, 'polygon', .42, .66, null, JSON.stringify([[.23,.53],[.61,.5],[.69,.84],[.29,.9]]), 'district', '#06b6d4', null, null, 1],
      [`${PREFIX}marker-archive`, `${PREFIX}map-lumina`, `${PREFIX}layer-custom`, `${PREFIX}place-archivo`, null, null, 'point', .46, .72, null, null, 'archive', '#10b981', null, null, 2],
      [`${PREFIX}marker-orla`, `${PREFIX}map-lumina`, `${PREFIX}layer-labels`, `${PREFIX}place-orla`, null, null, 'point', .78, .2, null, null, 'observatory', '#a78bfa', null, null, 3],
      [`${PREFIX}marker-old-lumina`, `${PREFIX}map-old`, null, `${PREFIX}place-lumina`, null, L === 'es' ? 'Lúmina antes del Hundimiento' : 'Lumina before the Sinking', 'point', .24, .34, null, null, 'city', '#f8fafc', 0, 131949, 0],
    ] as const;
    markers.forEach(([marker_id, map_id, layer_id, place_id, child_map_id, label, geometry_kind, x, y, radius, points, icon, color, from_world_day, to_world_day, sort_order]) =>
      insert('map_markers', {
        marker_id, map_id, layer_id, place_id, child_map_id, label, geometry_kind, x, y, radius, points,
        icon, color, from_world_day, to_world_day,
        notes: L === 'es' ? 'Marcador de demostración editable.' : 'Editable demo marker.',
        sort_order, created_at: AT, updated_at: AT,
      })
    );
    [
      [`${PREFIX}travel-foot`, L === 'es' ? 'A pie' : 'On foot', 28, 'km', 'walk', 0],
      [`${PREFIX}travel-horse`, L === 'es' ? 'Caballo de sal' : 'Salt horse', 65, 'km', 'horse', 1],
      [`${PREFIX}travel-sail`, L === 'es' ? 'Vela de corriente' : 'Current sail', 180, 'km', 'sail', 2],
      [`${PREFIX}travel-whale`, L === 'es' ? 'Ballena de brasa' : 'Ember whale', 300, 'km', 'sparkles', 3],
    ].forEach(([mode_id, name, distance_per_day, unit, icon, sort_order]) =>
      insert('map_travel_modes', { mode_id, name, distance_per_day, unit, icon, sort_order, created_at: AT, updated_at: AT })
    );

    // Encyclopedia-native lore and the missing-entry workflow.
    for (const [index, article] of ARTICLES.entries()) {
      insert('world_articles', {
        article_id: article.id, title: article.title[L], title_key: normalizeTitle(article.title[L]),
        category: article.category, summary: resolveDemoLinks(article.summary[L]),
        body: resolveDemoLinks(article.body[L]), body_proposed: null, body_proposed_at: null,
        aka: article.aka[L], origin: index === ARTICLES.length - 1 ? 'ai_proposal' : 'author',
        spoiler: article.id.endsWith('thirdmoon') ? 1 : 0, sort_title: null,
        notes: L === 'es' ? 'Artículo de demostración conectado al resto del mundo.' : 'Demo article connected to the rest of the world.',
        created_at: PREVIOUS_AT, updated_at: AT,
      });
      demoImage('article', article.id, article.title[L], index % 2 === 0 ? '#6d28d9' : '#0f766e', '✧');
    }
    [
      [`${PREFIX}proposal-buried`, L === 'es' ? 'Ciudad Sepultada' : 'Buried City', 'place', L === 'es' ? 'La menciona la Brújula de ceniza y no existe todavía como lugar.' : 'The Ash Compass mentions it, but it does not exist as a place yet.', 'unresolved_link', .98, 'pending', null],
      [`${PREFIX}proposal-blacktide`, L === 'es' ? 'Marea Negra' : 'Black Tide', 'event', L === 'es' ? 'Aparece en varias fichas y merece una entrada propia.' : 'It appears in several sheets and deserves its own entry.', 'frequency', .79, 'pending', null],
      [`${PREFIX}proposal-lighthouse`, L === 'es' ? 'Maestros del Faro' : 'Lighthouse Masters', 'organization', L === 'es' ? 'Propuesta ya aceptada, conservada para demostrar el historial.' : 'Accepted proposal retained to demonstrate history.', 'frequency', .91, 'accepted', `${PREFIX}article-keepers`],
      [`${PREFIX}proposal-rumour`, L === 'es' ? 'Rey de la Espuma' : 'Foam King', 'other', L === 'es' ? 'Rumor descartado que no debe volver a proponerse.' : 'Dismissed rumour that must not be proposed again.', 'frequency', .42, 'dismissed', null],
    ].forEach(([proposal_id, term, category, rationale, source, confidence, status, article_id]) =>
      insert('world_entry_proposals', {
        proposal_id, term, term_key: normalizeTitle(String(term)), category, rationale,
        suggested_summary: rationale,
        evidence: JSON.stringify([{ key: `article:${PREFIX}article-compass`, title: ARTICLES[5].title[L], snippet: rationale }]),
        source, confidence, status, article_id, created_at: AT, updated_at: AT,
      })
    );

    // Conflicts and arcs share the same engine and scenes. The corpus includes every
    // status, scope, party side and beat vocabulary so both boards show meaningful lanes.
    const threads = [
      [`${PREFIX}thread-succession`, 'conflict', L === 'es' ? 'La sucesión del Faro' : 'The Lighthouse succession', L === 'es' ? 'Ilyra reclama el derecho a decidir el destino del Faro frente al Consejo de Ceniza.' : 'Ilyra claims the right to decide the Lighthouse’s fate against the Ash Council.', L === 'es' ? 'La legitimidad de Orthea y quién controla la luz.' : 'Orthea’s legitimacy and who controls the light.', 'external', 'open', null],
      [`${PREFIX}thread-blockade`, 'conflict', L === 'es' ? 'El bloqueo de las Seis Velas' : 'The Six Sails blockade', L === 'es' ? 'El Gremio cierra el puerto para exigir la liberación de Cael.' : 'The Guild closes the harbour to demand Cael’s release.', L === 'es' ? 'Alimentos, evacuación y apoyo popular.' : 'Food, evacuation and public support.', 'external', 'resolved', L === 'es' ? 'Tarek abre una ruta civil y el bloqueo se levanta.' : 'Tarek opens a civilian route and the blockade ends.'],
      [`${PREFIX}thread-blacktide`, 'conflict', L === 'es' ? 'La próxima Marea Negra' : 'The coming Black Tide', L === 'es' ? 'Las placas del Mar de Vidrio convergen antes de lo previsto.' : 'The plates of the Glass Sea are converging ahead of schedule.', L === 'es' ? 'Toda la costa baja de Orthea.' : 'All of lowland Orthea.', 'background', 'open', null],
      [`${PREFIX}thread-oldwar`, 'conflict', L === 'es' ? 'La guerra de los Tejedores' : 'The Weavers’ War', L === 'es' ? 'Conflicto histórico conservado como contexto.' : 'Historical conflict kept as context.', L === 'es' ? 'El control de los Telares Solares.' : 'Control of the Solar Looms.', 'external', 'archived', L === 'es' ? 'Los telares quedaron bajo custodia compartida.' : 'The looms entered shared custody.'],
      [`${PREFIX}arc-ilyra`, 'arc', L === 'es' ? 'Ilyra aprende a soltar el mapa' : 'Ilyra learns to release the map', L === 'es' ? 'Del control absoluto a la confianza compartida.' : 'From absolute control to shared trust.', null, 'external', 'open', null],
      [`${PREFIX}arc-tarek`, 'arc', L === 'es' ? 'Tarek elige un bando' : 'Tarek chooses a side', L === 'es' ? 'La neutralidad del comandante se vuelve complicidad y después decisión.' : 'The commander’s neutrality becomes complicity and then choice.', null, 'external', 'open', null],
      [`${PREFIX}arc-sena`, 'arc', L === 'es' ? 'Sena reclama el Archivo' : 'Sena claims the Archive', L === 'es' ? 'De aprendiz útil a custodie de una memoria pública.' : 'From useful apprentice to keeper of a public memory.', null, 'external', 'resolved', L === 'es' ? 'Abre el Archivo de Bajamar a toda la ciudad.' : 'Opens the Low-Tide Archive to the whole city.'],
    ] as const;
    for (const [thread_id, kind, titleValue, pitch, stakes, scope, status, outcome] of threads) {
      insert('world_threads', {
        thread_id, kind, title: titleValue, title_key: normalizeTitle(titleValue),
        pitch: resolveDemoLinks(pitch), stakes: stakes ? resolveDemoLinks(stakes) : null,
        scope, status, outcome, origin: 'author', created_at: AT, updated_at: AT,
      });
    }
    [
      [`${PREFIX}thread-succession`, 'character', `${PREFIX}char-ilyra`, 'wants'],
      [`${PREFIX}thread-succession`, 'group', `${PREFIX}group-council`, 'opposes'],
      [`${PREFIX}thread-succession`, 'character', `${PREFIX}char-elan`, 'caught'],
      [`${PREFIX}thread-blockade`, 'group', `${PREFIX}group-sails`, 'wants'],
      [`${PREFIX}thread-blockade`, 'group', `${PREFIX}group-guard`, 'opposes'],
      [`${PREFIX}thread-blacktide`, 'group', `${PREFIX}group-tideborn`, 'caught'],
      [`${PREFIX}thread-oldwar`, 'group', `${PREFIX}group-venn`, 'wants'],
      [`${PREFIX}thread-oldwar`, 'group', `${PREFIX}group-council`, 'opposes'],
      [`${PREFIX}arc-ilyra`, 'character', `${PREFIX}char-ilyra`, 'subject'],
      [`${PREFIX}arc-tarek`, 'character', `${PREFIX}char-tarek`, 'subject'],
      [`${PREFIX}arc-sena`, 'character', `${PREFIX}char-sena`, 'subject'],
    ].forEach(([thread_id, party_kind, party_id, side]) =>
      insert('thread_parties', { thread_id, party_kind, party_id, side, created_at: AT, updated_at: AT })
    );

    // Rules: physical/costly/social, a scoped rule, an exception, tentative and retired
    // states, plus a secret rule. All are normal author data; there are no AI proposals.
    const rules = [
      [`${PREFIX}rule-shadow`, L === 'es' ? 'Toda luz deja sombra' : 'Every light casts a shadow', L === 'es' ? 'Usar el Flujo desplaza una cantidad equivalente de luz, calor o memoria.' : 'Using Flux displaces an equivalent amount of light, heat or memory.', L === 'es' ? 'La deuda aparece antes del siguiente amanecer.' : 'The debt appears before the next dawn.', L === 'es' ? 'La luz natural no cuenta hasta ser almacenada.' : 'Natural light does not count until stored.', 'physical', null, `${PREFIX}article-flux`, 'world', null, null, null, 'canon', null],
      [`${PREFIX}rule-true-name`, L === 'es' ? 'Un nombre verdadero obliga una vez' : 'A true name compels once', L === 'es' ? 'Pronunciar el nombre verdadero de un ser de vidrio permite darle una sola orden.' : 'Speaking a glass being’s true name allows one command.', L === 'es' ? 'Quien lo pronuncia pierde para siempre ese nombre de su memoria.' : 'The speaker permanently loses that name from memory.', L === 'es' ? 'No funciona sobre una copia ni a través de una grabación.' : 'It does not work on a copy or through a recording.', 'costly', null, `${PREFIX}article-flux`, 'world', null, null, null, 'canon', `${PREFIX}secret-name`],
      [`${PREFIX}rule-nara-exception`, L === 'es' ? 'La memoria heredada conserva el nombre' : 'Inherited memory preserves the name', L === 'es' ? 'Un nombre recibido por memoria de marea vuelve a quien lo entregó, no a quien lo pronuncia.' : 'A name received through tide memory returns to its giver, not its speaker.', L === 'es' ? 'La persona donante olvida una memoria adicional.' : 'The donor forgets one additional memory.', L === 'es' ? 'Solo los Veyari pueden transmitirlo.' : 'Only Veyari can transmit it.', 'costly', `${PREFIX}rule-true-name`, `${PREFIX}article-tidecant`, 'group', `${PREFIX}group-veyari`, null, null, 'canon', `${PREFIX}secret-name`],
      [`${PREFIX}rule-gates`, L === 'es' ? 'Las puertas obedecen al sello' : 'The gates obey the seal', L === 'es' ? 'Las barreras solares de Lúmina solo se abren ante un sello registrado.' : 'Lumina’s solar barriers open only to a registered seal.', L === 'es' ? 'Forzar una barrera quema el sello utilizado.' : 'Forcing a barrier burns the seal used.', L === 'es' ? 'No alcanza a túneles anteriores al Hundimiento.' : 'Does not reach tunnels predating the Sinking.', 'social', null, `${PREFIX}article-looms`, 'place', `${PREFIX}place-lumina`, 131950, null, 'canon', null],
      [`${PREFIX}rule-sanctuary`, L === 'es' ? 'Ningún arma en Isla Nácar' : 'No weapon on Nacre Island', L === 'es' ? 'Toda persona que pisa el santuario entrega sus armas a la marea.' : 'Everyone entering the sanctuary gives their weapons to the tide.', L === 'es' ? 'Romper el rito expulsa a la tripulación durante seis mareas.' : 'Breaking the rite exiles the crew for six tides.', L === 'es' ? 'Las herramientas y prótesis no se consideran armas salvo intención declarada.' : 'Tools and prostheses are not weapons unless declared as such.', 'social', null, `${PREFIX}article-firstlight`, 'place', `${PREFIX}place-nacre`, null, null, 'canon', null],
      [`${PREFIX}rule-thirdmoon`, L === 'es' ? 'La Tercera Luna no proyecta sombra' : 'The Third Moon casts no shadow', L === 'es' ? 'Su luz no interactúa con materia ordinaria.' : 'Its light does not interact with ordinary matter.', null, L === 'es' ? 'La observación todavía no es concluyente.' : 'Observation is not yet conclusive.', 'physical', null, `${PREFIX}article-thirdmoon`, 'world', null, null, null, 'tentative', null],
      [`${PREFIX}rule-oldtax`, L === 'es' ? 'Diezmo de lámpara' : 'Lamp tithe', L === 'es' ? 'Cada hogar entregaba una décima parte de su aceite al Faro.' : 'Every household gave one tenth of its oil to the Lighthouse.', L === 'es' ? 'Multa y pérdida temporal de luz.' : 'A fine and temporary loss of light.', L === 'es' ? 'Fue abolido después del Hundimiento.' : 'Abolished after the Sinking.', 'social', null, `${PREFIX}article-firstlight`, 'world', null, null, 131950, 'retired', null],
    ] as const;
    for (const [rule_id, titleValue, statement, cost, limits, hardness, parent_rule_id, article_id, scope_kind, scope_id, from_world_day, to_world_day, status, secret_id] of rules) {
      insert('world_rules', {
        rule_id, title: titleValue, title_key: normalizeTitle(titleValue),
        statement: resolveDemoLinks(statement), cost: cost ? resolveDemoLinks(cost) : null,
        limits: resolveDemoLinks(limits), hardness, parent_rule_id, article_id, scope_kind,
        scope_id, from_world_day, to_world_day, status, secret_id,
        proposed_text: null, proposed_at: null, created_at: AT, updated_at: AT,
      });
    }

    const beats = [
      ['conflict', `${PREFIX}thread-succession`, `${PREFIX}scene-arrival`, 'raise', null, 'character', `${PREFIX}char-ilyra`, null],
      ['conflict', `${PREFIX}thread-succession`, `${PREFIX}scene-gate`, 'turn', L === 'es' ? 'Tarek deja pasar a Ilyra.' : 'Tarek lets Ilyra pass.', 'character', `${PREFIX}char-ilyra`, null],
      ['conflict', `${PREFIX}thread-succession`, `${PREFIX}scene-coup`, 'raise', null, 'group', `${PREFIX}group-council`, null],
      ['conflict', `${PREFIX}thread-succession`, `${PREFIX}scene-heart`, 'resolve', L === 'es' ? 'Ilyra rechaza gobernar sola.' : 'Ilyra refuses to rule alone.', 'character', `${PREFIX}char-ilyra`, null],
      ['conflict', `${PREFIX}thread-blockade`, `${PREFIX}scene-gate`, 'raise', null, 'group', `${PREFIX}group-sails`, null],
      ['conflict', `${PREFIX}thread-blockade`, `${PREFIX}scene-coup`, 'ease', null, 'character', `${PREFIX}char-tarek`, null],
      ['conflict', `${PREFIX}thread-blockade`, `${PREFIX}scene-heart`, 'resolve', null, 'group', `${PREFIX}group-sails`, null],
      ['conflict', `${PREFIX}thread-blacktide`, `${PREFIX}scene-island`, 'raise', null, null, null, null],
      ['conflict', `${PREFIX}thread-blacktide`, `${PREFIX}scene-heart`, 'turn', L === 'es' ? 'El Corazón altera la dirección de la marea.' : 'The Heart changes the tide’s direction.', null, null, null],
      ['arc', `${PREFIX}arc-ilyra`, `${PREFIX}scene-arrival`, 'step', L === 'es' ? 'Contrata a Cael pero oculta el mapa.' : 'Hires Cael but hides the map.', null, null, null],
      ['arc', `${PREFIX}arc-ilyra`, `${PREFIX}scene-island`, 'turn', L === 'es' ? 'Comparte el nombre verdadero con Sena.' : 'Shares the true name with Sena.', null, null, null],
      ['arc', `${PREFIX}arc-ilyra`, `${PREFIX}scene-heart`, 'turn', L === 'es' ? 'Entrega la decisión al grupo.' : 'Hands the decision to the group.', null, null, null],
      ['arc', `${PREFIX}arc-tarek`, `${PREFIX}scene-gate`, 'turn', L === 'es' ? 'Falsifica la primera orden.' : 'Forges his first order.', null, null, null],
      ['arc', `${PREFIX}arc-tarek`, `${PREFIX}scene-coup`, 'turn', L === 'es' ? 'Desobedece públicamente a Maelor.' : 'Publicly disobeys Maelor.', null, null, null],
      ['arc', `${PREFIX}arc-sena`, `${PREFIX}scene-archive`, 'step', L === 'es' ? 'Abre un depósito sin permiso.' : 'Opens a stack without permission.', null, null, null],
      ['arc', `${PREFIX}arc-sena`, `${PREFIX}scene-epilogue`, 'turn', L === 'es' ? 'Convierte el Archivo en institución pública.' : 'Turns the Archive into a public institution.', null, null, null],
      ['rule', `${PREFIX}rule-shadow`, `${PREFIX}scene-archive`, 'establishes', L === 'es' ? 'El eco borra el recuerdo de una canción.' : 'The echo erases the memory of a song.', 'character', `${PREFIX}char-sena`, 1],
      ['rule', `${PREFIX}rule-gates`, `${PREFIX}scene-gate`, 'breaks', L === 'es' ? 'Ilyra atraviesa la barrera con un sello falso.' : 'Ilyra crosses with a forged seal.', 'character', `${PREFIX}char-ilyra`, 0],
      ['rule', `${PREFIX}rule-sanctuary`, `${PREFIX}scene-island`, 'bends', L === 'es' ? 'La mano prismática se acepta como herramienta.' : 'The prismatic hand is accepted as a tool.', 'character', `${PREFIX}char-ilyra`, 1],
      ['rule', `${PREFIX}rule-true-name`, `${PREFIX}scene-heart`, 'breaks', L === 'es' ? 'Ilyra pronuncia Asteriel y todavía lo recuerda.' : 'Ilyra speaks Asteriel and still remembers it.', 'character', `${PREFIX}char-ilyra`, 0],
    ] as const;
    beats.forEach(([thread_kind, thread_id, scene_id, mark, beatText, subject_kind, subject_id, paid]) =>
      insert('world_beats', {
        thread_kind, thread_id, scene_id, mark, text: beatText, subject_kind, subject_id,
        paid, created_at: AT, updated_at: AT,
      })
    );

    // Open decisions: author questions, placeholder-derived questions, competing options,
    // a parked decision and an already answered one. Options are authored demo material,
    // never AI output.
    [
      [`${PREFIX}question-heart`, L === 'es' ? '¿Qué ocurre con Lúmina si el Corazón abandona la ciudad?' : 'What happens to Lumina if the Heart leaves the city?', 'scene', `${PREFIX}scene-heart`, 'summary', 'open', 'author', null, 1, null, null],
      [`${PREFIX}question-nara`, L === 'es' ? '¿Por qué Nara envió la carta nueve meses después?' : 'Why did Nara send the letter nine months later?', 'character', `${PREFIX}char-nara`, 'backstory', 'open', 'author', null, 0, null, null],
      [`${PREFIX}question-thirdmoon`, L === 'es' ? '¿La Tercera Luna es una puerta o una prisión?' : 'Is the Third Moon a door or a prison?', 'article', `${PREFIX}article-thirdmoon`, 'body', 'parked', 'author', null, 0, null, null],
      [`${PREFIX}question-sails`, L === 'es' ? '¿Quién borró la séptima ruta?' : 'Who erased the seventh route?', 'group', `${PREFIX}group-sails`, 'description', 'answered', 'author', null, 0, `${PREFIX}option-sails-aurel`, AT],
    ].forEach(([question_id, question, anchor_kind, anchor_id, anchor_field, status, origin, origin_key, blocking, chosen_option_id, answered_at]) =>
      insert('world_questions', {
        question_id, question, anchor_kind, anchor_id, anchor_field, status, origin, origin_key,
        blocking, chosen_option_id, answered_at, created_at: AT, updated_at: AT,
      })
    );
    [
      [`${PREFIX}option-heart-dark`, `${PREFIX}question-heart`, L === 'es' ? 'La terraza alta pierde luz durante un año, pero la ciudad sobrevive.' : 'The upper terrace loses light for a year, but the city survives.', L === 'es' ? 'Maelor pierde su argumento de emergencia.' : 'Maelor loses his emergency argument.', 'fill_field', null, null],
      [`${PREFIX}option-heart-flood`, `${PREFIX}question-heart`, L === 'es' ? 'El mar recupera el Barrio Hundido y obliga a evacuar la costa.' : 'The sea reclaims the Sunken Quarter and forces a coastal evacuation.', L === 'es' ? 'El final necesita una ruta de evacuación preparada.' : 'The ending needs a prepared evacuation route.', 'fill_field', null, null],
      [`${PREFIX}option-nara-memory`, `${PREFIX}question-nara`, L === 'es' ? 'La carta viajó dentro de una memoria de vidrio y solo tomó forma cuando Ilyra volvió.' : 'The letter travelled inside a glass memory and only took form when Ilyra returned.', L === 'es' ? 'Nara no controló el momento de entrega.' : 'Nara did not control the delivery time.', 'fill_field', null, null],
      [`${PREFIX}option-nara-future`, `${PREFIX}question-nara`, L === 'es' ? 'Nara escribió desde una marea futura.' : 'Nara wrote from a future tide.', L === 'es' ? 'Introduce causalidad inversa y exige una regla nueva.' : 'Introduces reverse causality and requires a new rule.', 'fill_field', null, null],
      [`${PREFIX}option-sails-aurel`, `${PREFIX}question-sails`, L === 'es' ? 'Aurel Venn la borró para impedir que el Consejo encontrara el Corazón.' : 'Aurel Venn erased it to stop the Council finding the Heart.', L === 'es' ? 'Cael fue acusado por una decisión de Aurel.' : 'Cael was blamed for Aurel’s decision.', 'none', AT, null],
    ].forEach(([option_id, question_id, optionText, implications, apply_mode, applied_at, replaced_text]) =>
      insert('world_question_options', {
        option_id, question_id, text: optionText, implications, origin: 'author', apply_mode,
        applied_at, replaced_text, created_at: AT, updated_at: AT,
      })
    );

    // Manuscript: two books, four chapters, every scene with prose, a hand-made snapshot
    // and a word diary. The uncast Nara link in scene 2 intentionally exercises the
    // manuscript continuity check.
    const manuscript = new Map<string, string>([
      [`${PREFIX}scene-prologue`, L === 'es'
        ? `# El último encendido\n\n${link('character', `${PREFIX}char-aurel`, 'Aurel')} apoyó las dos manos quemadas sobre la lente. Abajo, ${link('place', `${PREFIX}place-lumina`, 'Lúmina')} se hundía por terrazas, como una lámpara inclinada que derramara el aceite.\n\n—Toda costa es una decisión dibujada —dijo, y encendió el ${link('place', `${PREFIX}place-faro`, 'Faro')} una vez más.`
        : `# The last lighting\n\n${link('character', `${PREFIX}char-aurel`, 'Aurel')} laid both burned hands on the lens. Below, ${link('place', `${PREFIX}place-lumina`, 'Lumina')} sank terrace by terrace, like a tilted lamp spilling its oil.\n\n“Every coast is a decision drawn,” he said, and lit the ${link('place', `${PREFIX}place-faro`, 'Lighthouse')} once more.`],
      [`${PREFIX}scene-arrival`, L === 'es'
        ? `La carta olía a fondo de mar. ${link('character', `${PREFIX}char-ilyra`, 'Ilyra')} reconoció la letra de ${link('character', `${PREFIX}char-nara`, 'Nara')} antes de leer la primera palabra.\n\n${link('character', `${PREFIX}char-cael`, 'Cael')} esperó en el umbral, dejando un charco salado sobre el mármol del Consejo.\n\n—Necesito una ruta —dijo Ilyra.\n\n—Necesitas una tripulación —corrigió él.`
        : `The letter smelled of the seabed. ${link('character', `${PREFIX}char-ilyra`, 'Ilyra')} recognised ${link('character', `${PREFIX}char-nara`, 'Nara')}’s hand before reading the first word.\n\n${link('character', `${PREFIX}char-cael`, 'Cael')} waited at the threshold, leaving a salt puddle on the Council marble.\n\n“I need a route,” Ilyra said.\n\n“You need a crew,” he corrected.`],
      [`${PREFIX}scene-archive`, L === 'es'
        ? `${link('character', `${PREFIX}char-sena`, 'Sena')} introdujo la última llave. El depósito exhaló agua negra y una voz que llevaba nueve años esperando.\n\n—Si estás oyendo esto —dijo ${link('character', `${PREFIX}char-nara`, 'Nara')}, aunque su nombre no figuraba en el reparto del registro—, el Corazón ya sabe quién eres.\n\nLa mano de ${link('character', `${PREFIX}char-ilyra`, 'Ilyra')} se abrió sola. Bajo el cristal apareció una costa que ningún atlas conservaba.`
        : `${link('character', `${PREFIX}char-sena`, 'Sena')} inserted the last key. The stack breathed black water and a voice that had waited nine years.\n\n“If you can hear this,” said ${link('character', `${PREFIX}char-nara`, 'Nara')}, though her name was absent from the recorded cast, “the Heart already knows who you are.”\n\n${link('character', `${PREFIX}char-ilyra`, 'Ilyra')}’s hand opened by itself. Beneath the glass appeared a coast no atlas preserved.`],
      [`${PREFIX}scene-gate`, L === 'es'
        ? `${link('character', `${PREFIX}char-tarek`, 'Tarek')} leyó la orden dos veces. El sello era perfecto; la firma, imposible.\n\nAl otro lado de la barrera, Ilyra no pidió ayuda. Esa fue la única razón por la que él decidió dársela.\n\nCuando el vidrio ardió, el sello falso se volvió ceniza. El precio de ${link('rule', `${PREFIX}rule-gates`, 'la ley de las puertas')} había quedado a la vista.`
        : `${link('character', `${PREFIX}char-tarek`, 'Tarek')} read the order twice. The seal was perfect; the signature impossible.\n\nBeyond the barrier, Ilyra did not ask for help. That was the only reason he chose to give it.\n\nWhen the glass burned, the forged seal turned to ash. The cost of ${link('rule', `${PREFIX}rule-gates`, 'the gate law')} was visible.`],
      [`${PREFIX}scene-island`, L === 'es'
        ? `Nadie desembarcó armado en ${link('place', `${PREFIX}place-nacre`, 'Isla Nácar')}. La marea recogió espadas, pistolas y la pequeña navaja de Sena.\n\nSolo retuvo la mano de vidrio de Ilyra.\n\n—Herramienta —dictaminó ${link('character', `${PREFIX}char-vesh`, 'Vesh')}—, mientras no decida lo contrario.\n\nBajo la isla, algo enorme respondió con un canto.`
        : `Nobody landed armed on ${link('place', `${PREFIX}place-nacre`, 'Nacre Island')}. The tide collected swords, pistols and Sena’s little knife.\n\nIt kept only Ilyra’s glass hand.\n\n“A tool,” ${link('character', `${PREFIX}char-vesh`, 'Vesh')} ruled, “until it decides otherwise.”\n\nBeneath the island, something enormous answered in song.`],
      [`${PREFIX}scene-observatory`, L === 'es'
        ? `Las seis cúpulas del ${link('place', `${PREFIX}place-orla`, 'Observatorio')} giraban en direcciones distintas. Sena superpuso los registros de Nara y descubrió una órbita que no rodeaba el mundo, sino el ${link('place', `${PREFIX}place-faro`, 'Faro')}.\n\nTarek encontró una séptima palanca detrás del sello del Regente.`
        : `The ${link('place', `${PREFIX}place-orla`, 'Observatory')}’s six domes turned in different directions. Sena overlaid Nara’s records and found an orbit circling not the world but the ${link('place', `${PREFIX}place-faro`, 'Lighthouse')}.\n\nTarek found a seventh lever behind the Regent’s seal.`],
      [`${PREFIX}scene-coup`, L === 'es'
        ? `Las seis campanas sonaron a mediodía. El ${link('group', `${PREFIX}group-council`, 'Consejo')} nombró traidora a la Casa Venn y ordenó cerrar el puerto.\n\n${link('character', `${PREFIX}char-maelor`, 'Maelor')} esperó que Tarek repitiera la orden. Tarek se quitó la capa roja y la dejó sobre la mesa.`
        : `Six bells rang at noon. The ${link('group', `${PREFIX}group-council`, 'Council')} named House Venn traitorous and ordered the harbour closed.\n\n${link('character', `${PREFIX}char-maelor`, 'Maelor')} waited for Tarek to repeat the order. Tarek removed his red cloak and left it on the table.`],
      [`${PREFIX}scene-heart`, L === 'es'
        ? `El Corazón no era una máquina. Abrió un ojo del tamaño de una plaza y toda la ciudad recordó la misma pérdida.\n\nIlyra pronunció **Asteriel**. El nombre atravesó el agua, alcanzó la criatura y volvió a ella intacto. La regla decía que debía olvidarlo.\n\n—No voy a decidir sola —dijo, y abrió el mapa para todos.`
        : `The Heart was not a machine. It opened an eye the size of a square and the whole city remembered the same loss.\n\nIlyra spoke **Asteriel**. The name crossed the water, reached the creature and returned to her intact. The rule said she should forget it.\n\n“I will not decide alone,” she said, and opened the map to everyone.`],
      [`${PREFIX}scene-epilogue`, L === 'es'
        ? `El nuevo Archivo no tenía puerta principal. Sena había mandado abrir seis.\n\nEn la pared vacía dejó un espacio para el mapa que Ilyra aún no había regresado a dibujar. Mar adentro apareció una luz baja, móvil y paciente.`
        : `The new Archive had no main door. Sena had ordered six opened.\n\nOn the empty wall they left a place for the map Ilyra had not yet returned to draw. Far out at sea, a low light appeared, moving and patient.`],
    ]);
    for (const scene of SCENES) {
      const prose = manuscript.get(scene.id) ?? '';
      insert('world_scene_text', {
        scene_id: scene.id, text: prose, word_count: countWords(prose), created_at: AT, updated_at: AT,
      });
    }
    [
      [`${PREFIX}scene-prologue`, L === 'es' ? 'Libro I · La costa rota' : 'Book I · The Broken Coast', L === 'es' ? 'Las Mareas de Ceniza' : 'The Ashen Tides', 48000],
      [`${PREFIX}scene-coup`, L === 'es' ? 'Libro II · El corazón sumergido' : 'Book II · The Sunken Heart', L === 'es' ? 'Las Mareas de Ceniza' : 'The Ashen Tides', 52000],
    ].forEach(([scene_id, titleValue, subtitle, target_words]) =>
      insert('world_manuscript_starts', { scene_id, title: titleValue, subtitle, target_words, created_at: AT, updated_at: AT })
    );
    [
      [`${PREFIX}scene-prologue`, L === 'es' ? 'Prólogo' : 'Prologue', L === 'es' ? 'Toda costa es una decisión dibujada.' : 'Every coast is a decision drawn.'],
      [`${PREFIX}scene-arrival`, L === 'es' ? 'I · Cartas y mapas' : 'I · Letters and maps', null],
      [`${PREFIX}scene-island`, L === 'es' ? 'II · Lo que recuerda el mar' : 'II · What the sea remembers', null],
      [`${PREFIX}scene-coup`, L === 'es' ? 'III · Las seis campanas' : 'III · The six bells', null],
      [`${PREFIX}scene-heart`, L === 'es' ? 'IV · Asteriel' : 'IV · Asteriel', null],
      [`${PREFIX}scene-epilogue`, L === 'es' ? 'Epílogo' : 'Epilogue', null],
    ].forEach(([scene_id, titleValue, epigraph]) =>
      insert('world_chapter_breaks', { scene_id, title: titleValue, epigraph, created_at: AT, updated_at: AT })
    );
    const archiveText = manuscript.get(`${PREFIX}scene-archive`) ?? '';
    insert('world_scene_snapshots', {
      snapshot_id: `${PREFIX}snapshot-archive`, scene_id: `${PREFIX}scene-archive`,
      text: `${archiveText}\n\n${L === 'es' ? 'Versión anterior: la voz se cortaba antes de nombrar el Corazón.' : 'Earlier version: the voice cut out before naming the Heart.'}`,
      word_count: countWords(archiveText) + 11, reason: 'manual', created_at: PREVIOUS_AT,
    });
    [
      ['2000-01-01', 620],
      ['2000-01-02', 1040],
      ['2000-01-03', [...manuscript.values()].reduce((sum, value) => sum + countWords(value), 0)],
    ].forEach(([day, total_words]) =>
      insert('world_word_days', { day, total_words, created_at: AT, updated_at: AT })
    );

    // Notes are part of "Crear", not a separate academic corpus.
    insert('note_folders', {
      id: `${PREFIX}notes-root`, parent_id: null,
      name: L === 'es' ? 'Las Mareas de Ceniza' : 'The Ashen Tides',
      order_idx: 0, summary: L === 'es' ? 'Cuaderno de desarrollo del mundo demo.' : 'Development notebook for the demo world.',
      created_at: AT, updated_at: AT,
    });
    insert('note_folders', {
      id: `${PREFIX}notes-revision`, parent_id: `${PREFIX}notes-root`,
      name: L === 'es' ? 'Revisión' : 'Revision', order_idx: 0,
      summary: L === 'es' ? 'Listas de trabajo y decisiones editoriales.' : 'Worklists and editorial decisions.',
      created_at: AT, updated_at: AT,
    });
    [
      [`${PREFIX}note-premise`, `${PREFIX}notes-root`, L === 'es' ? 'Premisa y promesa' : 'Premise and promise', 0,
        L === 'es' ? '# Premisa\n\nUna cartógrafa descubre que la fuente de energía de su ciudad es una criatura cautiva y que cada recuerdo usado como combustible borra otro.\n\n## Promesa al lector\n\n- Fantasía marítima\n- Misterio familiar\n- Política de recursos\n- Magia con coste verificable' : '# Premise\n\nA cartographer discovers that her city’s energy source is a captive creature and every memory used as fuel erases another.\n\n## Reader promise\n\n- Maritime fantasy\n- Family mystery\n- Resource politics\n- Magic with a verifiable cost'],
      [`${PREFIX}note-symbols`, `${PREFIX}notes-root`, L === 'es' ? 'Motivos visuales' : 'Visual motifs', 1,
        L === 'es' ? '## Motivos\n\n- Vidrio agrietado = memoria disputada\n- Seis = orden oficial\n- Siete = ruta borrada\n- Agua dentro de edificios = pasado que regresa\n\nVincular con [[Flujo de vidrio]] y [[La Tercera Luna]].' : '## Motifs\n\n- Cracked glass = disputed memory\n- Six = official order\n- Seven = erased route\n- Water inside buildings = the past returning\n\nLink to [[Glass flux]] and [[The Third Moon]].'],
      [`${PREFIX}note-revision`, `${PREFIX}notes-revision`, L === 'es' ? 'Lista de revisión del acto I' : 'Act I revision list', 0,
        L === 'es' ? '- [x] Presentar el coste del Flujo en el Archivo\n- [x] Dar a Tarek una decisión visible\n- [ ] Aclarar cómo llegó la carta\n- [ ] Sembrar antes la orquídea de sal' : '- [x] Introduce Flux’s cost in the Archive\n- [x] Give Tarek a visible choice\n- [ ] Clarify how the letter arrived\n- [ ] Seed the salt orchid earlier'],
      [`${PREFIX}note-questions`, `${PREFIX}notes-revision`, L === 'es' ? 'Preguntas para lectores beta' : 'Beta reader questions', 1,
        L === 'es' ? '1. ¿Se entiende por qué Ilyra necesita a Cael?\n2. ¿Maelor parece convencido de su propia lógica?\n3. ¿La revelación del Corazón cambia la lectura del prólogo?\n4. ¿Qué parte de Lúmina recuerdas sin mirar el mapa?' : '1. Is it clear why Ilyra needs Cael?\n2. Does Maelor seem convinced by his own logic?\n3. Does the Heart reveal change the prologue?\n4. Which part of Lumina do you remember without checking the map?'],
    ].forEach(([id, folder_id, titleValue, order_idx, content]) =>
      insert('notes', { id, folder_id, title: titleValue, kind: 'markdown', content, source_json: null, order_idx, created_at: AT, updated_at: AT })
    );

    updateSettings({ demoMode: true });
  });
  tx();

  // Derived indexes are rebuilt after the transaction so every possible title exists
  // before a link is classified. Dates likewise derive from the final calendar.
  recomputeWorldDays();
  rebuildWorldLinks();

  // Demonstrate the exceptions ledger with a real finding generated by the same engine
  // the UI uses. If a check changes later, seeding still succeeds and simply omits the
  // example mute instead of persisting a fake fingerprint.
  const muted = runContinuityUnfiltered().find((finding) => finding.checkId === 'presence.bilocation');
  if (muted) {
    muteNotice({
      fingerprint: muted.fingerprint,
      checkId: muted.checkId,
      subjects: muted.subjects,
      headline: muted.headline.key,
      reasonCode: 'deliberate',
      reason: `${PREFIX}${locale() === 'es' ? 'ejemplo: flashback deliberado para mostrar las excepciones.' : 'example: deliberate flashback demonstrating exceptions.'}`,
    });
  }
  return true;
}

export function clearWorldbuildingDemoData(): void {
  const db = getDb();
  // A user can delete every demo character while still exploring the remaining maps,
  // articles or manuscript. The demo flag and vault type are therefore the ownership
  // guard; a single representative table would make the rest impossible to clean.
  if (!getSettings().demoMode || getActiveVault().type !== 'worldbuilding') return;

  const tx = db.transaction(() => {
    // Unowned or polymorphic rows first.
    db.prepare("DELETE FROM world_notice_mutes WHERE reason LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_links WHERE source_id LIKE 'demo-world-%' OR target_key LIKE '%:demo-world-%'").run();
    db.prepare("DELETE FROM world_entry_proposals WHERE proposal_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_question_options WHERE option_id LIKE 'demo-world-%' OR question_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_questions WHERE question_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_scene_snapshots WHERE snapshot_id LIKE 'demo-world-%' OR scene_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_manuscript_starts WHERE scene_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_chapter_breaks WHERE scene_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_scene_text WHERE scene_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_word_days WHERE day IN ('2000-01-01','2000-01-02','2000-01-03')").run();
    db.prepare("DELETE FROM world_beats WHERE thread_id LIKE 'demo-world-%' OR scene_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM thread_parties WHERE thread_id LIKE 'demo-world-%' OR party_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_threads WHERE thread_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_rules WHERE rule_id LIKE 'demo-world-%'").run();

    // Scene and map children before their owners.
    db.prepare("DELETE FROM scene_characters WHERE scene_id LIKE 'demo-world-%' OR person_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_images WHERE image_id LIKE 'demo-world-%' OR entity_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM map_markers WHERE marker_id LIKE 'demo-world-%' OR map_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM map_layers WHERE layer_id LIKE 'demo-world-%' OR map_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM map_images WHERE image_id LIKE 'demo-world-%' OR map_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_maps WHERE map_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM map_travel_modes WHERE mode_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_scenes WHERE scene_id LIKE 'demo-world-%'").run();

    // Story, collections and record-layer joins.
    db.prepare("DELETE FROM secret_knowers WHERE id LIKE 'demo-world-%' OR secret_id LIKE 'demo-world-%' OR person_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_secrets WHERE secret_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM character_affiliations WHERE affiliation_id LIKE 'demo-world-%' OR person_id LIKE 'demo-world-%' OR group_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_groups WHERE group_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM record_evidence WHERE id LIKE 'demo-world-%' OR target_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM event_participants WHERE id LIKE 'demo-world-%' OR event_id LIKE 'demo-world-%' OR person_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM event_world_dates WHERE event_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM events WHERE event_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM person_places WHERE id LIKE 'demo-world-%' OR person_id LIKE 'demo-world-%' OR place_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM relationships WHERE rel_id LIKE 'demo-world-%' OR from_person LIKE 'demo-world-%' OR to_person LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM social_relations WHERE relation_id LIKE 'demo-world-%' OR person_id LIKE 'demo-world-%' OR target_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM social_contacts WHERE contact_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM character_abilities WHERE ability_id LIKE 'demo-world-%' OR person_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM person_portraits WHERE person_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM person_names WHERE id LIKE 'demo-world-%' OR person_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM character_profiles WHERE person_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM persons WHERE person_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM place_profiles WHERE place_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM places WHERE place_id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM world_articles WHERE article_id LIKE 'demo-world-%'").run();

    db.prepare("DELETE FROM notes WHERE id LIKE 'demo-world-%'").run();
    db.prepare("DELETE FROM note_folders WHERE id LIKE 'demo-world-%'").run();

    // One calendar exists per world, so it is demo-owned as a whole.
    db.prepare('DELETE FROM world_calendar_months').run();
    db.prepare('DELETE FROM world_calendar_eras').run();
    db.prepare('DELETE FROM world_calendar').run();
    updateSettings({ demoMode: false });
  });
  tx();
}
