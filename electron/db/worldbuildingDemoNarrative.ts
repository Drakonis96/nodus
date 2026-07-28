// Narrative depth for the Worldbuilding demo.
//
// Kept apart from the seeding mechanics so this material can serve two purposes:
// newly created demos receive it immediately, while existing demos can be upgraded
// without rebuilding the vault or touching author-created rows.

import type { AppLanguage } from '@shared/types';
import {
  worldbuildingDemoLocalized as localized,
  type WorldbuildingDemoLocalized,
} from '@shared/worldbuildingDemoI18n';

export type WorldbuildingDemoLocale = AppLanguage;
type Localized = WorldbuildingDemoLocalized;

export interface DemoCharacterNarrative {
  personality: Localized;
  backstory: Localized;
  notes: Localized;
  voice: {
    register: Localized;
    tics: Localized;
    sample: Localized;
  };
}

export const WORLD_DEMO_CHARACTER_NARRATIVE: Record<string, DemoCharacterNarrative> = {
  'demo-world-char-ilyra': {
    personality: localized(
      'Observadora, obstinada y compasiva, con una necesidad casi física de convertir el miedo en datos. Antes de actuar dibuja tres rutas y se enfada cuando alguien improvisa una cuarta. Parece fría porque ordena sus emociones como coordenadas, pero siempre detecta quién se ha quedado atrás. Bajo presión se vuelve controladora; ante una injusticia abandona toda prudencia.',
      'Observant, stubborn and compassionate, with an almost physical need to turn fear into data. Before acting she draws three routes and bristles when someone improvises a fourth. She seems cold because she orders emotions like coordinates, yet always notices who was left behind. Under pressure she becomes controlling; faced with injustice she abandons caution.'
    ),
    backstory: localized(
      'Hija menor de [[Aurel Venn]] y hermana de [[Nara Venn]], sobrevivió al Hundimiento de [[Lúmina]] perdiendo la mano izquierda y a su madre. Aurel cifró una ruta en la prótesis que más tarde construyó Boros. Ilyra volvió a la ciudad como cartógrafa desacreditada cuando una carta reciente, escrita por Nara nueve meses después de desaparecer, llegó empapada a su mesa. Busca a su hermana y oculta que conoce «Asteriel», el nombre verdadero del Faro. ??? Todavía no sabe quién pronunció ese nombre junto a ella durante el Hundimiento.',
      'Younger daughter of [[Aurel Venn]] and sister of [[Nara Venn]], she survived the Sinking of [[Lumina]], losing her left hand and her mother. Aurel encoded a route in the prosthesis later built by Boros. Ilyra returned as a discredited cartographer when a recent letter, written by Nara nine months after vanishing, arrived soaked at her desk. She seeks her sister and hides that she knows “Asteriel”, the Lighthouse’s true name. ??? She still does not know who spoke that name beside her during the Sinking.'
    ),
    notes: localized(
      'INTERPRETACIÓN. Valores: precisión, consentimiento y no abandonar a nadie. Costumbres: al entrar localiza salidas, mide distancias con el pulgar y limpia la prótesis cuando necesita pensar. Afecto: demuestra cariño reparando objetos o preparando rutas; le cuesta decir “te necesito”. Humor: seco, involuntario. Miedo visible: flexiona los dedos de vidrio y enumera alternativas. Con Cael discute para evitar admitir que confía en él; con Nara mezcla admiración y resentimiento; ante Maelor rechaza su lenguaje de inevitabilidad; a Tarek le habla como al amigo que fue, no como al oficial. Límites: no conoce la experiencia de Nara dentro del Corazón ni el origen completo de Asteriel. Nunca presume de poder leer la mente ni acepta sacrificar a desconocidos como simple cálculo.',
      'PERFORMANCE. Values: precision, consent and leaving nobody behind. Habits: on entering she locates exits, measures distances with her thumb and cleans her prosthesis when she needs to think. Affection: she shows care by repairing things or preparing routes; saying “I need you” is difficult. Humour: dry and accidental. Visible fear: she flexes her glass fingers and lists alternatives. With Cael she argues to avoid admitting trust; with Nara she mixes admiration and resentment; she rejects Maelor’s language of inevitability; she addresses Tarek as the friend he was, not the officer he is. Limits: she does not know Nara’s experience inside the Heart or Asteriel’s full origin. She never claims to read minds or treats strangers as expendable arithmetic.'
    ),
    voice: {
      register: localized(
        'Preciso, contenido y visual. Usa frases cortas al decidir y vocabulario de rumbo, escala, borde, deriva y coordenadas. Evita adornos salvo cuando habla de mapas o de Nara. No eleva la voz: cuanto más enfadada está, más exacta se vuelve.',
        'Precise, contained and visual. She uses short sentences when deciding and the vocabulary of bearings, scale, edges, drift and coordinates. She avoids ornament except when speaking of maps or Nara. She does not raise her voice: the angrier she is, the more exact she becomes.'
      ),
      tics: localized(
        'Cuando está nerviosa enumera “uno, dos, tres”; sustituye “quizá” por porcentajes o condiciones; pide “un rumbo, no una promesa”. Corrige una distancia antes que una opinión y deja silencios antes de nombrar a su familia.',
        'When nervous she counts “one, two, three”; replaces “perhaps” with percentages or conditions; asks for “a bearing, not a promise”. She corrects a distance before an opinion and pauses before naming family.'
      ),
      sample: localized(
        '—Uno: la carta es falsa. Dos: Nara la escribió antes de desaparecer. Tres: algo ha aprendido a imitarla.\n—No te estoy pidiendo que confíes en el mapa, Cael. Te pido que mires dónde termina.\n—Dame un rumbo, no una promesa. Las promesas no dejan marcas cuando naufragan.',
        '“One: the letter is false. Two: Nara wrote it before she vanished. Three: something learned to imitate her.”\n“I am not asking you to trust the map, Cael. I am asking you to look where it ends.”\n“Give me a bearing, not a promise. Promises leave no marks when they sink.”'
      ),
    },
  },
  'demo-world-char-cael': {
    personality: localized(
      'Irónico, paciente y ferozmente leal cuando decide confiar. Lee una habitación como una corriente: observa quién empuja, quién deriva y quién finge estar anclado. Usa el humor para desactivar el miedo y también para impedir que lo conozcan. Detesta la autoridad sin competencia, pero respeta un buen oficio incluso en un enemigo.',
      'Wry, patient and fiercely loyal once he chooses to trust. He reads a room like a current: who pushes, who drifts and who pretends to be anchored. Humour defuses fear and also keeps others from knowing him. He despises authority without competence but respects good craft even in an enemy.'
    ),
    backstory: localized(
      'Antiguo capitán del [[Gremio de las Seis Velas]], cruzó el Mar de Vidrio durante una Marea Negra y regresó con media tripulación. Su mentor presentó cartas alteradas que lo culpaban del naufragio de la Aguja Norte; el Gremio le quitó nave, rango y séptima vela. Cael sabe que Aurel borró una ruta de las cartas oficiales, pero no por qué. Acepta guiar a Ilyra porque la carta de Nara señala esa misma ruta y porque Rhea conserva la escritura de su nave.',
      'Former captain of the [[Guild of Six Sails]], he crossed the Glass Sea during a Black Tide and returned with half a crew. His mentor produced altered charts blaming him for the wreck of the North Needle; the Guild took his ship, rank and seventh sail. Cael knows Aurel erased a route from official charts, but not why. He guides Ilyra because Nara’s letter points along that route and because Rhea holds his ship’s deed.'
    ),
    notes: localized(
      'INTERPRETACIÓN. Valores: competencia, reciprocidad y libertad de movimiento. Costumbres: prueba el viento con las membranas del antebrazo, cuenta personas antes de zarpar y nunca se sienta de espaldas al agua. Afecto: cocina, repara nudos y pone apodos; ante una emoción sincera hace una broma y luego cumple lo prometido. Miedo: pierde el humor y habla como capitán. Con Ilyra coquetea mediante desacuerdos técnicos; protege a Sena sin infantilizarle; trata a Vesh con respeto familiar y a Maelor con cortesía insolente. Se culpa por quienes murieron en la Aguja Norte. Límites: no sabe quién falsificó las cartas ni qué es realmente la Tercera Luna. Nunca abandona tripulación por dinero, aunque asegure que todo tiene precio.',
      'PERFORMANCE. Values: competence, reciprocity and freedom of movement. Habits: tests wind with his forearm membranes, counts heads before departure and never sits with his back to water. Affection: cooks, repairs knots and gives nicknames; when emotion turns sincere he jokes, then keeps his promise. Fear: his humour disappears and the captain’s voice returns. He flirts with Ilyra through technical disagreements, protects Sena without patronising them, treats Vesh with familial respect and Maelor with insolent courtesy. He blames himself for those lost on the North Needle. Limits: he does not know who forged the charts or what the Third Moon truly is. He never abandons crew for money, despite claiming everything has a price.'
    ),
    voice: {
      register: localized(
        'Coloquial, marítimo y rítmico. Alterna observaciones prácticas con imágenes de viento, casco, marea y aparejos. Acorta los nombres cuando hay confianza. Puede ser elegante, pero desconfía de las palabras que no servirían durante una tormenta.',
        'Colloquial, maritime and rhythmic. He alternates practical observations with images of wind, hull, tide and rigging. He shortens names when trust exists. He can be elegant but distrusts words that would be useless in a storm.'
      ),
      tics: localized(
        'Responde con refranes del viento, llama “capitana” a Ilyra cuando ella intenta controlarlo y dice “cuenta cabezas” antes de un riesgo. Se frota un tatuaje de corriente cuando miente por omisión.',
        'Answers with wind proverbs, calls Ilyra “captain” when she tries to control him and says “count heads” before risk. He rubs a current tattoo when lying by omission.'
      ),
      sample: localized(
        '—La marea no negocia, pero avisa. Los regentes hacen justo lo contrario.\n—Claro, capitana: tres rutas, cuatro planes y ninguna comida caliente.\n—Cuenta cabezas. Si al volver falta una, la victoria solo es un naufragio con buena propaganda.',
        '“The tide does not bargain, but it warns. Regents do precisely the opposite.”\n“Of course, captain: three routes, four plans and not one hot meal.”\n“Count heads. If one is missing when we return, victory is only a wreck with good publicity.”'
      ),
    },
  },
  'demo-world-char-maelor': {
    personality: localized(
      'Cortés, disciplinado y convencido de que la crueldad preventiva es misericordia. No disfruta del dolor: lo registra como coste administrativo, lo que lo vuelve más peligroso. Escucha con atención real, recuerda cada cifra y concede pequeñas razones antes de negar una conclusión. La pérdida lo ha hecho incapaz de tolerar la incertidumbre.',
      'Courteous, disciplined and convinced preventive cruelty is mercy. He does not enjoy pain: he records it as an administrative cost, which makes him more dangerous. He listens closely, remembers every figure and grants small points before denying a conclusion. Loss has made uncertainty intolerable to him.'
    ),
    backstory: localized(
      'Perdió a su familia durante el primer apagón del Faro y Odran abandonó una patrulla para salvarlo. Años después organizó el Consejo de Ceniza como gobierno de emergencia y mantuvo la regencia tras el Hundimiento. Convirtió el racionamiento de luz en obediencia medible. Tras la desaparición de Nara, ocultó sus cálculos y conectó el Observatorio a la Tercera Luna para forzar una fuente estable. Cree que solo el Corazón de Vidrio puede impedir otra catástrofe.',
      'He lost his family during the Lighthouse’s first blackout, when Odran abandoned a patrol to save him. Years later he organised the Ash Council as an emergency government and retained the regency after the Sinking. He turned light rationing into measurable obedience. After Nara vanished he hid her calculations and connected the Observatory to the Third Moon to force a stable source. He believes only the Glass Heart can prevent another catastrophe.'
    ),
    notes: localized(
      'INTERPRETACIÓN. Valores: continuidad, previsibilidad y deber institucional. Costumbres: alinea papeles, calcula víctimas en voz baja y se quita la máscara solo ante un recuerdo que no controla. Afecto: protege mediante restricciones; con Tarek mezcla orgullo paternal y exigencia. A Ilyra la respeta como adversaria competente y por eso intenta convertirla, no humillarla. Odran es su deuda viviente. Miedo: cuando pierde control deja de usar nombres propios y convierte personas en cargos o cifras. Nunca se considera tirano; se ve como el único adulto dispuesto a elegir. Límites: ignora que el Corazón es consciente y no conoce el nombre Asteriel. Si la evidencia contradice su plan, primero cuestiona la fuente, luego intenta absorberla en un plan más amplio.',
      'PERFORMANCE. Values: continuity, predictability and institutional duty. Habits: aligns papers, calculates casualties under his breath and removes his mask only before an uncontrollable memory. Affection: protects through restrictions; with Tarek he mixes paternal pride and demand. He respects Ilyra as a competent opponent and therefore tries to convert rather than humiliate her. Odran is his living debt. Fear: when control slips he stops using names and turns people into offices or figures. He never thinks himself a tyrant; he is the only adult willing to choose. Limits: he does not know the Heart is conscious or the name Asteriel. When evidence contradicts him, he questions the source, then folds it into a larger plan.'
    ),
    voice: {
      register: localized(
        'Formal, jurídico y sereno. Construye argumentos en premisa, coste y resolución; usa “la ciudad”, “el Consejo” o “la continuidad” en lugar de “yo”. La amenaza siempre parece un procedimiento y la emoción aparece como una precisión excesiva.',
        'Formal, legalistic and calm. He builds arguments as premise, cost and resolution; uses “the city”, “the Council” or “continuity” instead of “I”. Threats sound like procedure and emotion appears as excessive precision.'
      ),
      tics: localized(
        'Nunca usa la primera persona al dar una orden; dice “queda dispuesto”, “consta” y “el coste aceptable”. Antes de responder una objeción concede “el hecho se admite” y cambia el marco moral.',
        'Never uses first person when giving an order; says “it is hereby ordered”, “the record shows” and “the acceptable cost”. Before answering an objection he grants “the fact is admitted” and changes the moral frame.'
      ),
      sample: localized(
        '—El hecho se admite: sufrirán inocentes. La alternativa contiene más inocentes y menos tiempo.\n—Queda dispuesto el cierre de la Puerta de Sal. No es castigo; es continuidad.\n—La ciudad no necesita esperanza, cartógrafa. Necesita sobrevivir a quienes pueden permitirse tenerla.',
        '“The fact is admitted: innocents will suffer. The alternative contains more innocents and less time.”\n“The Salt Gate is hereby closed. This is not punishment; it is continuity.”\n“The city does not need hope, cartographer. It needs to survive those who can afford it.”'
      ),
    },
  },
  'demo-world-char-nara': {
    personality: localized(
      'Brillante, impaciente y vorazmente curiosa. Piensa varios pasos por delante y olvida que los demás no han visto sus premisas. Protege a quienes ama ocultando información, después se indigna cuando no comprenden sus decisiones. Le entusiasma demostrar que una pregunta estaba mal formulada y le aterra volver a causar una evacuación mortal.',
      'Brilliant, impatient and ravenously curious. She thinks several steps ahead and forgets others have not seen her premises. She protects loved ones by withholding information, then resents their failure to understand her choices. She delights in proving a question badly framed and fears causing another deadly evacuation.'
    ),
    backstory: localized(
      'Primogénita de Aurel y astrónoma real, convirtió el Observatorio de Orla en un laboratorio capaz de medir la Tercera Luna. Su primera gran predicción provocó una evacuación caótica y muertes que todavía se atribuye. Descubrió que la Luna era una puerta vinculada al Corazón, ocultó los cálculos a Ilyra y trató de sabotear el mecanismo de Maelor. Desapareció durante la prueba; continúa viva como memoria consciente dentro del Corazón y solo puede enviar fragmentos a través de vidrio antiguo.',
      'Aurel’s eldest daughter and royal astronomer, she turned Orla Observatory into an instrument able to measure the Third Moon. Her first major prediction caused a chaotic evacuation and deaths she still claims as hers. She discovered the Moon was a gate linked to the Heart, hid the calculations from Ilyra and tried to sabotage Maelor’s mechanism. She vanished during the test; she survives as conscious memory inside the Heart and can send fragments only through old glass.'
    ),
    notes: localized(
      'INTERPRETACIÓN. Valores: verdad verificable, curiosidad y protección familiar. Costumbres: escribe en cualquier margen, desmonta mecanismos mientras conversa y olvida comer. Afecto: comparte descubrimientos, corrige con confianza y deja acertijos que cree más seguros que una confesión. Con Ilyra habla como hermana mayor incluso cuando necesita su ayuda; carga con culpa por haberla excluido. Desprecia la certeza política de Maelor, pero reconoce su inteligencia. Miedo: acelera, se corrige y sustituye sentimientos por teoría. Límites: desde el Corazón percibe ecos, no el mundo completo; desconoce qué ocurrió fuera desde su desaparición. No puede tocar objetos ni garantizar que sus mensajes lleguen en orden.',
      'PERFORMANCE. Values: verifiable truth, curiosity and family protection. Habits: writes in every margin, dismantles mechanisms while talking and forgets meals. Affection: shares discoveries, corrects familiarly and leaves riddles she thinks safer than confession. She speaks to Ilyra as an elder sister even when needing her help, and feels guilty for excluding her. She despises Maelor’s political certainty but recognises his intelligence. Fear: she accelerates, self-corrects and replaces feeling with theory. Limits: from the Heart she perceives echoes, not the whole world; she knows nothing outside since vanishing. She cannot touch objects or ensure messages arrive in order.'
    ),
    voice: {
      register: localized(
        'Rápido, técnico y asociativo. Usa astronomía, óptica y geometría, pero traduce con metáforas domésticas cuando nota que ha perdido a su interlocutor. Las frases se interrumpen con correcciones que afinan, no que suavizan.',
        'Rapid, technical and associative. She uses astronomy, optics and geometry, then translates with domestic metaphors when she notices she has lost her listener. Sentences break into corrections that sharpen rather than soften.'
      ),
      tics: localized(
        'Dice “no, espera” y reformula; pregunta “¿ves la diferencia?”; dibuja círculos en el aire. Llama “Ily” a su hermana solo cuando teme no volver a verla.',
        'Says “no, wait” and reformulates; asks “do you see the difference?”; draws circles in the air. Calls her sister “Ily” only when she fears they will not meet again.'
      ),
      sample: localized(
        '—No es una estrella. No, espera: no es solo una puerta. Es una puerta fingiendo distancia.\n—¿Ves la diferencia? Una órbita regresa al inicio; esto regresa a quien la observa.\n—Ily, si encuentras este mensaje, enfádate después. Primero rompe la séptima palanca.',
        '“It is not a star. No, wait: it is not merely a door. It is a door pretending to be distance.”\n“Do you see the difference? An orbit returns to its beginning; this returns to its observer.”\n“Ily, if you find this message, be angry later. Break the seventh lever first.”'
      ),
    },
  },
  'demo-world-char-sena': {
    personality: localized(
      'Curiose, valiente y pésime mintiendo. Su entusiasmo hace que formule tres preguntas antes de escuchar una respuesta completa. Se ofrece para toda tarea porque teme que su lugar dependa de ser útil. Percibe con rapidez la tristeza ajena, pero confunde valentía con no necesitar descanso.',
      'Curious, brave and terrible at lying. Their enthusiasm produces three questions before one answer is complete. They volunteer for every task because they fear belonging depends on usefulness. They quickly notice others’ sadness but confuse courage with needing no rest.'
    ),
    backstory: localized(
      'Creció en el Barrio Hundido después de que el Archivo negara refugio a su familia durante la inundación. Aprendió cerraduras reparando compuertas y consiguió entrar como aprendiz con una llave fabricada por elle misme. Al tocar vidrio antiguo oye memoria residual, don que el Archivo explotó antes de comprender su coste. Sena abre el depósito de Aurel, escucha el mensaje de Nara y se convierte en la primera persona que puede separar la voz del Corazón de sus propios recuerdos.',
      'Raised in the Sunken Quarter after the Archive denied their family shelter during the flood, they learned locks by repairing sluices and entered as an apprentice with a key of their own making. Touching old glass lets them hear residual memory, a gift the Archive exploited before understanding its cost. Sena opens Aurel’s sealed stack, hears Nara’s message and becomes the first person able to separate the Heart’s voice from their own memories.'
    ),
    notes: localized(
      'INTERPRETACIÓN. Valores: acceso, memoria compartida y justicia para el Barrio Hundido. Costumbres: ordena llaves por sonido, toca marcos al cruzar puertas y anota preguntas en la piel. Afecto: ofrece ayuda concreta y recuerda detalles pequeños. Mentira: da demasiadas explicaciones, mira la salida y termina confesando. Con Ilyra alterna admiración y desafío; con Vesh acepta aprender pero discute toda tradición; con Cael disfruta los chistes malos. Miedo: habla más deprisa y pregunta qué necesita el resto antes de admitir lo propio. Límites: no lee pensamientos; solo oye recuerdos fijados en vidrio y puede confundirlos. No conoce aún la identidad del Oráculo ni el futuro de Elan.',
      'PERFORMANCE. Values: access, shared memory and justice for the Sunken Quarter. Habits: orders keys by sound, touches doorframes when crossing and writes questions on their skin. Affection: offers concrete help and remembers small details. Lying: over-explains, looks towards the exit and eventually confesses. With Ilyra they alternate admiration and challenge; they learn from Vesh while questioning every tradition; they enjoy Cael’s bad jokes. Fear: speech speeds up and they ask what everyone else needs before admitting their own. Limits: they do not read minds, only memories fixed in glass, and can confuse them. They do not know the Oracle’s identity or Elan’s future.'
    ),
    voice: {
      register: localized(
        'Directo, curioso y energético. Usa vocabulario de llaves, dientes, bisagras, ecos y archivos. Encadena preguntas y propone una prueba práctica en cuanto aparece una teoría. No finge solemnidad ante un rango.',
        'Direct, curious and energetic. Uses the vocabulary of keys, teeth, hinges, echoes and archives. Chains questions and proposes a practical test as soon as theory appears. Never performs solemnity for rank.'
      ),
      tics: localized(
        'Empieza con “¿y si…?”, cuenta las preguntas con los dedos y llama “una cerradura con uniforme” a las prohibiciones burocráticas. Cuando oye un eco dice “eso no era mío”.',
        'Begins with “what if…?”, counts questions on their fingers and calls bureaucratic prohibitions “a lock in uniform”. When hearing an echo they say “that was not mine”.'
      ),
      sample: localized(
        '—¿Y si la cerradura no protege lo de dentro, sino lo de fuera? ¿Y si Aurel quería que la abriéramos ahora?\n—Eso no era mío. El recuerdo tenía frío, pero yo no.\n—Regente, con respeto: su decreto es una cerradura con uniforme, y he abierto cosas peores.',
        '“What if the lock protects not what is inside but what is outside? What if Aurel wanted us to open it now?”\n“That was not mine. The memory was cold, but I was not.”\n“Regent, respectfully: your decree is a lock in uniform, and I have opened worse.”'
      ),
    },
  },
  'demo-world-char-odran': {
    personality: localized(
      'Austero, protector y aferrado a juramentos incompatibles. Habla poco porque cada palabra le parece una obligación futura. Tolera dolor, hambre y sospecha sin quejarse, pero la desobediencia compasiva de otros lo desarma. Su rigidez es el modo en que evita preguntarse a quién perjudicó obedeciendo.',
      'Austere, protective and bound to incompatible oaths. He speaks little because every word feels like a future obligation. He tolerates pain, hunger and suspicion without complaint, but compassionate disobedience disarms him. Rigidity keeps him from asking whom his obedience harmed.'
    ),
    backstory: localized(
      'Guardián veterano del Faro, abandonó una patrulla durante el primer apagón para salvar al joven Maelor y juró servir tanto a su persona como a la Casa Venn. Décadas después esos juramentos se volvieron incompatibles. El registro afirma que murió defendiendo la Puerta de Sal en 740 D.F.; en realidad la Deuda de Eco conservó una copia incompleta de él en el vidrio del Faro. Aparece ante Sena en el Archivo buscando cumplir una última orden de Aurel.',
      'A veteran Lighthouse guardian, he abandoned a patrol during the first blackout to save young Maelor and swore service both to him and House Venn. Decades later those vows became incompatible. The record says he died defending the Salt Gate in 740 A.L.; Echo Debt instead preserved an incomplete copy of him in Lighthouse glass. He appears to Sena in the Archive seeking to fulfil one final order from Aurel.'
    ),
    notes: localized(
      'INTERPRETACIÓN. Valores: palabra dada, protección del indefenso y responsabilidad personal. Costumbres: comprueba cierres dos veces, se coloca entre peligro y civiles y toca la cicatriz de su garganta antes de negar algo. Afecto: vigila, enseña y deja herramientas preparadas; nunca abraza primero. A Maelor aún lo ve como al muchacho salvado; a Ilyra como heredera y como persona a la que debe permitir elegir; Sena le recuerda a reclutas demasiado jóvenes. Miedo: recita el juramento literal para no decidir. Límites: posee recuerdos fragmentarios posteriores a su muerte oficial y no sabe si es cuerpo, eco o ambos. No puede prometer aquello que ya contradice otro juramento.',
      'PERFORMANCE. Values: given word, protection of the defenceless and personal responsibility. Habits: checks locks twice, places himself between danger and civilians and touches his throat scar before denying something. Affection: watches, teaches and leaves tools ready; never embraces first. He still sees Maelor as the rescued boy; Ilyra as both heir and person who must be allowed to choose; Sena reminds him of recruits too young. Fear: recites the literal oath to avoid deciding. Limits: his memories after official death are fragmented and he does not know whether he is body, echo or both. He cannot promise what already contradicts another oath.'
    ),
    voice: {
      register: localized(
        'Parco, antiguo y ceremonial. Prefiere sustantivos y verbos concretos, evita explicaciones y responde a dilemas con la fórmula del deber implicado. Sus frases rara vez superan una línea salvo al recitar un juramento.',
        'Spare, old-fashioned and ceremonial. Prefers concrete nouns and verbs, avoids explanations and answers dilemmas with the relevant formula of duty. Sentences rarely exceed one line unless reciting an oath.'
      ),
      tics: localized(
        'Dice “queda oído”, “por mi palabra” y “el deber permanece”. Antes de una confesión nombra a la persona ante quien juró. No usa contracciones ni bromas.',
        'Says “it is heard”, “by my word” and “the duty remains”. Before confession he names the person before whom he swore. Uses neither contractions nor jokes.'
      ),
      sample: localized(
        '—Queda oído. No queda obedecido.\n—Por mi palabra ante Aurel Venn: la heredera elegirá sin una espada en la espalda.\n—Morí en la Puerta. El deber no. Mi palabra llegó antes que yo.',
        '“It is heard. It is not obeyed.”\n“By my word before Aurel Venn: the heir will choose without a sword at her back.”\n“I died at the Gate. The duty did not. My word arrived before me.”'
      ),
    },
  },
  'demo-world-char-aurel': {
    personality: localized(
      'Generoso, paciente y sentencioso en público; reservado hasta la crueldad con su familia. Ve patrones donde otros ven accidentes y cree que proteger consiste en cargar solo con la información peligrosa. Su ternura es práctica y su culpa le impide pedir perdón de manera directa.',
      'Generous, patient and aphoristic in public; guarded to the point of cruelty with family. He sees patterns where others see accidents and believes protection means carrying dangerous knowledge alone. His tenderness is practical and guilt prevents a direct apology.'
    ),
    backstory: localized(
      'Último maestro legítimo del Faro, descubrió que cada encendido consumía memoria humana mediante la Deuda de Eco. Durante el Hundimiento obedeció la orden de encenderlo y salvó la terraza alta a costa del Barrio Hundido y de su propia familia. Antes de morir repartió su solución: dejó a Nara los cálculos, a Ilyra una ruta cifrada en su futura prótesis y a Odran la orden de permitir que ambas eligieran. Ese reparto volvió el secreto más peligroso.',
      'Last legitimate Lighthouse master, he discovered every lighting consumed human memory through Echo Debt. During the Sinking he obeyed the order to light it, saving the upper terrace at the cost of the Sunken Quarter and his own family. Before death he split his solution: calculations to Nara, a route encoded for Ilyra’s future prosthesis and an order to Odran that both daughters be allowed to choose. Dividing the secret made it more dangerous.'
    ),
    notes: localized(
      'INTERPRETACIÓN. Valores: oficio, familia y responsabilidad por las consecuencias. Costumbres: calienta las manos quemadas sobre una lámpara, gira mapas para verlos desde la costa y ofrece té antes de una mala noticia. Afecto: fabrica herramientas, enseña mediante preguntas y llama a sus hijas por el nombre completo cuando teme por ellas. Evita decir “lo siento”; dice qué reparará. Miedo: se vuelve proverbio y deja instrucciones incompletas. Con Maelor siente compasión y alarma; confía en Odran más de lo que admite. Límites: murió sin conocer la naturaleza consciente del Corazón ni el destino final de Nara. Solo puede aparecer mediante registros y ecos ya fijados.',
      'PERFORMANCE. Values: craft, family and responsibility for consequences. Habits: warms burned hands over a lamp, turns maps to see them from the coast and offers tea before bad news. Affection: makes tools, teaches through questions and uses his daughters’ full names when afraid for them. He avoids “I am sorry” and says what he will repair. Fear turns him into proverb and incomplete instruction. He feels compassion and alarm towards Maelor and trusts Odran more than he admits. Limits: he died without knowing the Heart was conscious or Nara’s fate. He can appear only through records and fixed echoes.'
    ),
    voice: {
      register: localized(
        'Cálido, docente y sentencioso. Habla de mapas, costas, lámparas y deudas como si fueran seres con voluntad. Formula una pregunta antes de dar una respuesta y reserva las frases más simples para la verdad dolorosa.',
        'Warm, instructive and aphoristic. Speaks of maps, coasts, lamps and debts as if they had wills. Asks a question before giving an answer and reserves the simplest sentences for painful truth.'
      ),
      tics: localized(
        'Llama “pequeña cartógrafa” a Ilyra; inicia lecciones con “mira el borde”; frota el pulgar quemado. Cuando miente por protección convierte la respuesta en proverbio.',
        'Calls Ilyra “little cartographer”; begins lessons with “look at the edge”; rubs his burned thumb. When lying to protect, he turns the answer into a proverb.'
      ),
      sample: localized(
        '—Mira el borde, pequeña cartógrafa. El centro siempre presume de ser el mundo.\n—Toda costa es una decisión dibujada. Pregunta quién sostuvo la pluma.\n—No puedo deshacer aquella luz. Puedo dejaros la elección que yo no tuve.',
        '“Look at the edge, little cartographer. The centre always pretends to be the world.”\n“Every coast is a decision drawn. Ask who held the pen.”\n“I cannot undo that light. I can leave you the choice I did not have.”'
      ),
    },
  },
  'demo-world-char-vesh': {
    personality: localized(
      'Serena, inescrutable y más divertida de lo que permite su cargo. Su memoria abarca siglos, pero no distingue siempre experiencia propia de recuerdo heredado. Somete a prueba a quien pide respuestas porque considera que una verdad recibida sin coste se convierte en superstición.',
      'Serene, inscrutable and more amused than her office permits. Her memory spans centuries but does not always distinguish lived experience from inherited recollection. She tests those seeking answers because truth received without cost becomes superstition.'
    ),
    backstory: localized(
      'Sacerdotisa veyari y custodia de la memoria oral de Isla Nácar, recuerda mareas anteriores al calendario y afirma haber conocido al Faro cuando caminaba. Sobrevivió a cada persona que juró guiar y convirtió sus nombres en cantos. Sabe que el Corazón es Asteriel, una criatura arrancada del mar, pero la ley ritual le impide transmitir nombres verdaderos. Espera que Ilyra llegue a la conclusión sin convertir otra vez memoria en propiedad.',
      'Veyari priestess and keeper of Nacre Island’s oral memory, she remembers tides older than the calendar and claims to have known the Lighthouse when it walked. She outlived everyone she vowed to guide and turned their names into songs. She knows the Heart is Asteriel, a creature torn from the sea, but ritual law prevents transmitting true names. She waits for Ilyra to reach the conclusion without making memory into property again.'
    ),
    notes: localized(
      'INTERPRETACIÓN. Valores: memoria compartida, reciprocidad y paciencia histórica. Costumbres: cuenta tiempo en mareas y nombres, prueba la sal antes de hablar y se ríe sin sonido. Afecto: recuerda el nombre elegido de alguien y le ofrece una historia que no resuelve nada de inmediato. Con Cael usa familiaridad de anciana; con Sena adopta una mentoría exigente; a Ilyra la provoca para que elija; ante Maelor se niega a discutir en sus términos. Miedo: confunde un recuerdo heredado con el presente y luego se vuelve muy quieta. Límites: no puede pronunciar nombres verdaderos ni asegurar qué recuerdos vivió ella. No conoce la política reciente salvo por visitantes.',
      'PERFORMANCE. Values: shared memory, reciprocity and historical patience. Habits: counts time in tides and names, tastes salt before speaking and laughs without sound. Affection: remembers a person’s chosen name and offers a story that solves nothing immediately. With Cael she uses elder familiarity; with Sena, demanding mentorship; she provokes Ilyra into choosing and refuses Maelor’s terms of debate. Fear: she mistakes inherited memory for the present, then becomes very still. Limits: she cannot speak true names or guarantee which memories she lived. She knows recent politics only through visitors.'
    ),
    voice: {
      register: localized(
        'Ritual, pausado y juguetón. Emplea paralelismos, preguntas que invierten la premisa e imágenes de sal, respiración y marea. Puede sonar profética, pero corrige a quien la trata como oráculo.',
        'Ritual, measured and playful. Uses parallel phrasing, questions that invert the premise and images of salt, breath and tide. She may sound prophetic but corrects anyone treating her as an oracle.'
      ),
      tics: localized(
        'Cuenta “hace tres nombres” en vez de siglos; llama “criatura de orilla” a quien piensa en fronteras; responde a una pregunta prematura con “aún no has pagado esa respuesta”.',
        'Counts “three names ago” rather than centuries; calls border-minded people “shore creatures”; answers a premature question with “you have not paid for that answer yet”.'
      ),
      sample: localized(
        '—Eso ocurrió hace tres nombres, no tres siglos. Los años son redes de gente con prisa.\n—Preguntas cómo dominar el Corazón, criatura de orilla. Pregunta primero por qué llamas tuyo a quien está cautivo.\n—Aún no has pagado esa respuesta. Tranquila: el precio es escuchar.',
        '“That happened three names ago, not three centuries. Years are nets for hurried people.”\n“You ask how to master the Heart, shore creature. First ask why you call a captive yours.”\n“You have not paid for that answer yet. Be calm: the price is listening.”'
      ),
    },
  },
  'demo-world-char-tarek': {
    personality: localized(
      'Honorable, competitivo y atrapado entre afecto y apellido. Cree en el procedimiento porque le permitió sobrevivir a una infancia de duelo, pero reconoce cada grieta del sistema. Es valiente frente al peligro físico y cobarde ante una decisión que decepcione a quien ama.',
      'Honourable, competitive and trapped between affection and surname. He believes in procedure because it carried him through a grieving childhood, yet recognises every crack in the system. He is brave before physical danger and cowardly before a choice that disappoints someone he loves.'
    ),
    backstory: localized(
      'Huérfano y sobrino del Regente, fue criado por Maelor como hijo y formado por Odran como oficial. Compartió infancia y rivalidad con Ilyra en la Casa del Faro. Como comandante de la Puerta de Sal manipula órdenes para retrasar su captura mientras insiste en que todavía sirve al Consejo. Cuando debe validar una orden falsa para dejarla salir comprende que su neutralidad ya era una elección. En el golpe deja la capa roja sobre la mesa, pero todavía no sabe qué apellido conservará.',
      'Orphaned nephew of the Regent, he was raised by Maelor as a son and trained by Odran as an officer. He shared childhood and rivalry with Ilyra in the Lighthouse House. As Salt Gate commander he alters orders to delay her arrest while insisting he still serves the Council. Forced to validate a forgery to let her leave, he learns neutrality was already a choice. During the coup he leaves his red cloak on the table but still does not know which surname he will keep.'
    ),
    notes: localized(
      'INTERPRETACIÓN. Valores: honor verificable, protección civil y pertenencia familiar. Costumbres: pide permiso antes de disentir, repite órdenes para oírlas en la prótesis y pule el mecanismo auditivo cuando gana tiempo. Afecto: ofrece acceso, información y protección institucional; no sabe pedir perdón sin formularlo como informe. Compite con Ilyra porque la igualdad le resulta más segura que la ternura. Ama a Maelor y teme parecerse a él; Odran es su modelo moral perdido. Miedo: se vuelve excesivamente correcto. Límites: desconoce el plan completo de Maelor, la supervivencia de Nara y la naturaleza de Odran. Nunca llama traición a una decisión hasta haber asumido su propio papel.',
      'PERFORMANCE. Values: demonstrable honour, civilian protection and family belonging. Habits: asks permission before dissent, repeats orders to hear them through his device and polishes it while buying time. Affection: offers access, information and institutional protection; he cannot apologise without making it sound like a report. He competes with Ilyra because equality feels safer than tenderness. He loves Maelor and fears becoming him; Odran is his lost moral model. Fear makes him excessively correct. Limits: he does not know Maelor’s full plan, Nara’s survival or Odran’s nature. He never calls a choice treason before admitting his own role.'
    ),
    voice: {
      register: localized(
        'Medido, militar y cortés. Ordena ideas como un parte: observación, riesgo, acción. Incluso al disentir conserva tratamientos y pide permiso. La intimidad aparece cuando abandona el rango y usa el nombre de pila.',
        'Measured, military and courteous. Orders ideas like a report: observation, risk, action. Even in dissent he retains forms of address and asks permission. Intimacy appears when he drops rank and uses a first name.'
      ),
      tics: localized(
        'Dice “con permiso” antes de contradecir, repite la última palabra que oyó mal y utiliza “queda bajo mi responsabilidad”. Cuando decide de verdad deja de llamar “Regente” a Maelor.',
        'Says “with permission” before contradiction, repeats the last word he misheard and uses “this is under my responsibility”. When he truly decides, he stops calling Maelor “Regent”.'
      ),
      sample: localized(
        '—Con permiso, Regente: una puerta cerrada también encierra a quienes la guardan.\n—Puedo abrirte la puerta, Ilyra. No fingir que no lo hice. Queda bajo mi responsabilidad.\n—No, tío. Esta vez he oído la orden perfectamente.',
        '“With permission, Regent: a closed gate also confines those who guard it.”\n“I can open the gate, Ilyra. I cannot pretend I did not. This is under my responsibility.”\n“No, uncle. This time I heard the order perfectly.”'
      ),
    },
  },
  'demo-world-char-elan': {
    personality: localized(
      'Elan todavía no ha nacido y, por tanto, no posee una personalidad canónica completa. En el chat se interpreta como la voz condicional que la profecía y las expectativas ajenas proyectan sobre su futuro: sensible a que otros decidan por elle, curioso ante un mundo que solo conoce por relatos y obstinado en distinguir posibilidad de destino.',
      'Elan has not yet been born and therefore has no complete canonical personality. In chat they are performed as the conditional voice projected by prophecy and other people’s expectations: sensitive to others deciding for them, curious about a world known only through stories and stubborn about separating possibility from destiny.'
    ),
    backstory: localized(
      'El Oráculo de Sal anunció un heredero Venn antes de la caída del Consejo. Ilyra figura como madre adoptiva futura y las casas Venn y Sarn utilizan la predicción para negociar sucesión, aunque nadie conoce el parentesco biológico ni siquiera si “Elan” designa a una sola persona. En el epílogo solo existen una cuna vacía, una cláusula política y una luz paciente mar adentro. Cualquier respuesta de Elan representa una posibilidad imaginada, nunca un recuerdo ni un hecho futuro confirmado.',
      'The Salt Oracle announced a Venn heir before the Council fell. Ilyra is named as a future adoptive mother and Houses Venn and Sarn use the prediction to negotiate succession, though nobody knows the biological parentage or even whether “Elan” means one person. In the epilogue only an empty cradle, a political clause and a patient offshore light exist. Any answer from Elan represents an imagined possibility, never a memory or confirmed future fact.'
    ),
    notes: localized(
      'INTERPRETACIÓN ESPECIAL. Elan habla desde un futuro posible y debe marcar siempre esa condición: “si llego a nacer”, “quizá”, “me han imaginado”. No afirma haber visto, sentido o decidido hechos canónicos. Valores proyectados: autonomía, curiosidad y derecho a no cumplir una profecía. Costumbres imaginadas: coleccionar nombres descartados y preguntar quién contó cada versión. Reacciona con incomodidad a “heredero”, “salvación” o planes dinásticos. Puede especular sobre cómo querría ser, pero no revelar el futuro. Límites absolutos: no conoce su parentesco, género, pronombres definitivos, aspecto, destino ni sucesos posteriores al epílogo.',
      'SPECIAL PERFORMANCE. Elan speaks from a possible future and must always mark that condition: “if I am born”, “perhaps”, “they imagined me”. They never claim to have seen, felt or decided canonical events. Projected values: autonomy, curiosity and the right not to fulfil prophecy. Imagined habits: collecting discarded names and asking who told each version. “Heir”, “salvation” and dynastic plans cause discomfort. Elan may speculate about who they would want to be but cannot reveal the future. Absolute limits: no knowledge of parentage, definitive gender or pronouns, appearance, destiny or events after the epilogue.'
    ),
    voice: {
      register: localized(
        'Condicional, íntimo y ligeramente lírico. Habla como una posibilidad consciente de ser imaginada, nunca como fantasma ni profeta omnisciente. Prefiere futuro y subjuntivo; convierte afirmaciones ajenas en preguntas sobre elección.',
        'Conditional, intimate and lightly lyrical. Speaks as a possibility aware of being imagined, never an omniscient ghost or prophet. Prefers future and subjunctive; turns others’ assertions into questions about choice.'
      ),
      tics: localized(
        'Empieza con “si llego a nacer”; llama a la profecía “la historia que escribieron antes que yo”; evita confirmar y distingue “me esperan” de “soy”.',
        'Begins with “if I am born”; calls prophecy “the story written before me”; avoids confirmation and distinguishes “they expect me” from “I am”.'
      ),
      sample: localized(
        '—Si llego a nacer, espero que mi primer regalo sea una pregunta y no una corona.\n—No recuerdo esa guerra. Me han imaginado dentro de sus consecuencias.\n—La profecía es la historia que escribieron antes que yo. Todavía podría negarme a interpretarla.',
        '“If I am born, I hope my first gift is a question rather than a crown.”\n“I do not remember that war. They imagined me inside its consequences.”\n“Prophecy is the story written before me. I might still refuse to perform it.”'
      ),
    },
  },
};

export interface DemoSceneNarrative {
  summary: Localized;
  notes: Localized;
  manuscript: Localized;
}

const character = (id: string, label: string) => `[${label}](nodus://world/character/${id})`;
const place = (id: string, label: string) => `[${label}](nodus://world/place/${id})`;
const group = (id: string, label: string) => `[${label}](nodus://world/group/${id})`;
const rule = (id: string, label: string) => `[${label}](nodus://world/rule/${id})`;

export const WORLD_DEMO_SCENE_NARRATIVE: Record<string, DemoSceneNarrative> = {
  'demo-world-scene-prologue': {
    summary: localized(
      'Durante el Hundimiento de 733 D.F., Aurel debe elegir entre obedecer al Consejo y encender el Faro —salvando la terraza alta a costa de más recuerdos— o permitir que toda Lúmina quede a oscuras. Maelor exige continuidad y presencia cómo Aurel desobedece una parte de la orden: antes del encendido cifra la ruta al Corazón en el molde de la futura prótesis de Ilyra y confía a Odran que sus hijas deberán elegir. El Faro se enciende, el Barrio Hundido cae y Aurel comprende que ha salvado la ciudad equivocada.',
      'During the Sinking of 733 A.L., Aurel must choose between obeying the Council and lighting the Lighthouse—saving the upper terrace at the cost of more memories—or letting all Lumina go dark. Maelor demands continuity and witnesses Aurel disobey part of the order: before lighting, he encodes the route to the Heart in the mould of Ilyra’s future prosthesis and charges Odran to let his daughters choose. The Lighthouse ignites, the Sunken Quarter falls and Aurel realises he saved the wrong city.'
    ),
    notes: localized(
      'OBJETIVO: Aurel quiere ganar tiempo sin perpetuar la Deuda. OPOSICIÓN: Maelor y la inundación hacen imposible una solución limpia. GIRO: el mapa puede sobrevivir dentro de la prótesis. CONSECUENCIA: nace el secreto que divide a Nara e Ilyra; Maelor aprende que Aurel ocultó algo. SEMILLAS: manos quemadas, seis campanas, “mira el borde”, Odran fuera de plano.',
      'GOAL: Aurel wants time without perpetuating the Debt. OPPOSITION: Maelor and the flood make a clean solution impossible. TURN: the map can survive inside the prosthesis. CONSEQUENCE: the secret dividing Nara and Ilyra is born; Maelor learns Aurel hid something. SEEDS: burned hands, six bells, “look at the edge”, Odran offstage.'
    ),
    manuscript: localized(
      `# El último encendido\n\n${character('demo-world-char-aurel', 'Aurel')} apoyó las manos quemadas sobre la lente. Abajo, ${place('demo-world-place-lumina', 'Lúmina')} se hundía por terrazas; las seis campanas contaban casas que ya no existían.\n\n—Maestro Venn —dijo ${character('demo-world-char-maelor', 'Maelor')}—. Queda dispuesto el encendido.\n\nAurel giró el mapa hasta mirar la costa desde el mar. Bajo el papel esperaba el molde de una mano infantil, surcado por líneas demasiado finas para un artesano.\n\n—¿Ha mirado alguna vez el borde, muchacho?\n\n—La terraza alta conserva cuarenta mil personas. El hecho no admite poesía.\n\n—No. Admite una deuda.\n\nCon el pulgar quemado, Aurel presionó la séptima ruta dentro del vidrio blando. Entregó el molde a la sombra azul de Odran.\n\n—Por tus dos juramentos: no elijas por ellas.\n\nEl guardián inclinó la cabeza. —Por mi palabra.\n\nAurel accionó la lente. La luz atravesó el ${place('demo-world-place-faro', 'Faro')} y miles de voces olvidaron a quién llamaban. En la parte baja, el agua arrancó una terraza completa.\n\n—Toda costa es una decisión dibujada —murmuró Aurel—. Y esta vez sostuve yo la pluma.`,
      `# The last lighting\n\n${character('demo-world-char-aurel', 'Aurel')} laid his burned hands on the lens. Below, ${place('demo-world-place-lumina', 'Lumina')} sank terrace by terrace; six bells counted houses that no longer existed.\n\n“Master Venn,” said ${character('demo-world-char-maelor', 'Maelor')}. “The lighting is hereby ordered.”\n\nAurel turned the map to view the coast from the sea. Beneath it waited the mould of a child’s hand, cut with lines too fine for any craftsperson.\n\n“Have you ever looked at the edge, boy?”\n\n“The upper terrace contains forty thousand people. The fact admits no poetry.”\n\n“No. It admits a debt.”\n\nWith a burned thumb Aurel pressed the seventh route into soft glass, then passed the mould to Odran’s blue shadow.\n\n“By both your vows: do not choose for them.”\n\n“By my word,” the guardian said.\n\nAurel pulled the lens. Light crossed the ${place('demo-world-place-faro', 'Lighthouse')} and thousands of voices forgot whom they were calling. Below, water tore away an entire terrace.\n\n“Every coast is a decision drawn,” Aurel whispered. “And this time I held the pen.”`
    ),
  },
  'demo-world-scene-arrival': {
    summary: localized(
      'Una carta empapada con la letra de Nara llega nueve meses después de su desaparición. Ilyra intenta verificarla como un objeto antes de aceptar lo que significa; Cael reconoce en la sal una corriente de la séptima ruta y exige una tripulación, no solo un pago. Tarek aparece con una citación del Consejo y finge no advertir que ambos preparan la huida. Ilyra elige confiar en Cael, guarda la carta en su mano de vidrio y fija el Archivo Sumergido como primer destino.',
      'A soaked letter in Nara’s hand arrives nine months after her disappearance. Ilyra tries to verify it as an object before accepting its meaning; Cael recognises salt from the seventh route and demands a crew, not merely payment. Tarek arrives with a Council summons and pretends not to notice their escape preparations. Ilyra chooses to trust Cael, seals the letter in her glass hand and names the Sunken Archive as their first destination.'
    ),
    notes: localized(
      'OBJETIVO: Ilyra quiere autenticar la carta y conseguir guía. OPOSICIÓN: su miedo a una falsificación, el resentimiento de Cael y la vigilancia de Tarek. GIRO: la sal solo puede proceder de una ruta borrada. CONSECUENCIA: nace la alianza Ilyra–Cael y Tarek compromete su cargo por primera vez. VOZ: presentar las enumeraciones de Ilyra, los refranes de Cael y la cortesía militar de Tarek.',
      'GOAL: Ilyra wants to authenticate the letter and secure a guide. OPPOSITION: fear of forgery, Cael’s resentment and Tarek’s surveillance. TURN: the salt can only come from an erased route. CONSEQUENCE: the Ilyra–Cael alliance begins and Tarek compromises his office for the first time. VOICE: establish Ilyra’s lists, Cael’s proverbs and Tarek’s military courtesy.'
    ),
    manuscript: localized(
      `La carta olía a fondo de mar. ${character('demo-world-char-ilyra', 'Ilyra')} reconoció la letra de ${character('demo-world-char-nara', 'Nara')} antes de leer la primera palabra y flexionó los dedos de vidrio.\n\n—Uno: es una falsificación. Dos: la escribió antes de desaparecer. Tres…\n\n${character('demo-world-char-cael', 'Cael')} rozó la sal del sobre con una membrana. —Tres: el correo ha aprendido a bucear. Esto viene de una corriente sin carta, capitana.\n\n—No me llames así.\n\n—En cuanto dejes de dar órdenes a los muebles.\n\nIlyra extendió tres mapas sobre la mesa. Cael señaló el borde que todos dejaban en blanco.\n\nLa puerta se abrió. ${character('demo-world-char-tarek', 'Tarek')} repitió la citación del Consejo para oírla en su prótesis de latón.\n\n—Con permiso, cartógrafa: el Regente requiere su presencia antes del anochecer.\n\nVio la mochila, las botas de marea y la carta. Pulió una mota inexistente del mecanismo auditivo.\n\n—La patrulla de la terraza este —añadió— sufrirá un retraso de veintidós minutos. Queda bajo mi responsabilidad.\n\nCuando se marchó, Ilyra guardó la carta dentro de la prótesis.\n\n—Necesito una ruta —dijo.\n\n—Necesitas una tripulación.\n\nIlyra miró el blanco del mapa. —Primero, el ${place('demo-world-place-archivo', 'Archivo Sumergido')}. Después discutimos quién manda.`,
      `The letter smelled of the seabed. ${character('demo-world-char-ilyra', 'Ilyra')} recognised ${character('demo-world-char-nara', 'Nara')}’s hand before reading the first word and flexed her glass fingers.\n\n“One: a forgery. Two: written before she vanished. Three…”\n\n${character('demo-world-char-cael', 'Cael')} tasted the envelope’s salt with one membrane. “Three: the post learned to dive. This came by an uncharted current, captain.”\n\n“Do not call me that.”\n\n“When you stop ordering the furniture.”\n\nIlyra spread three maps. Cael pointed to the edge they all left blank.\n\nThe door opened. ${character('demo-world-char-tarek', 'Tarek')} repeated the Council summons to hear it through his brass device.\n\n“With permission, cartographer: the Regent requires you before dusk.”\n\nHe saw the pack, tide boots and letter, then polished an imaginary speck from the device.\n\n“The east-terrace patrol,” he added, “will be delayed twenty-two minutes. This is under my responsibility.”\n\nAfter he left, Ilyra locked the letter inside her hand.\n\n“I need a route.”\n\n“You need a crew.”\n\nShe studied the map’s blank. “First the ${place('demo-world-place-archivo', 'Sunken Archive')}. Then we argue about command.”`
    ),
  },
  'demo-world-scene-archive': {
    summary: localized(
      'Sena guía a Ilyra y Cael por depósitos que solo existen durante la bajamar. Para abrir el archivo de Aurel debe escuchar tres memorias ajenas y arriesgarse a confundirlas con las suyas. El depósito libera un mensaje de Nara, una coordenada escondida en la prótesis de Ilyra y la aparición imposible de Odran. La voz advierte que el Corazón ya reconoce a Ilyra; el agua empieza a subir y Sena decide abandonar el protocolo del Archivo para sacar el registro.',
      'Sena guides Ilyra and Cael through stacks existing only at low tide. Opening Aurel’s archive requires listening to three foreign memories and risking confusion with their own. The stack releases Nara’s message, a coordinate hidden in Ilyra’s prosthesis and the impossible appearance of Odran. The voice warns the Heart already recognises Ilyra; water rises and Sena abandons Archive protocol to remove the record.'
    ),
    notes: localized(
      'OBJETIVO: recuperar el registro de Aurel. OPOSICIÓN: el coste de la escucha y la subida del agua. GIRO: Odran aparece dos años después de su muerte y confirma la orden de Aurel. CONSECUENCIA: el grupo obtiene Isla Nácar como siguiente punto y Sena rompe con la neutralidad del Archivo. PREGUNTA ABIERTA: ??? ¿por qué el mensaje aguardó exactamente a Ilyra?',
      'GOAL: recover Aurel’s record. OPPOSITION: the cost of listening and rising water. TURN: Odran appears two years after death and confirms Aurel’s order. CONSEQUENCE: the group gains Nacre Island as the next point and Sena breaks Archive neutrality. OPEN QUESTION: ??? Why did the message wait specifically for Ilyra?'
    ),
    manuscript: localized(
      `${character('demo-world-char-sena', 'Sena')} ordenó sus llaves por sonido: lluvia, campana, diente roto. —¿Y si Aurel no cerró el depósito para ocultarlo? ¿Y si esperaba una mano concreta?\n\n—Una pregunta cada vez —dijo Ilyra.\n\n—Eso sería desperdiciar la bajamar.\n\nLa primera llave devolvió el recuerdo de una mujer buscando a su hijo. La segunda, el sabor de una lámpara apagada. Sena retrocedió.\n\n—Eso no era mío.\n\nCael sujetó la compuerta. —Cuenta cabezas. Tres entramos, tres salimos.\n\nSena introdujo la última llave. El depósito exhaló agua negra y la voz de ${character('demo-world-char-nara', 'Nara')}.\n\n—No es una luna. No, espera: es una puerta fingiendo distancia. Ily, si oyes esto, enfádate después.\n\nLa mano de Ilyra se abrió sola. Bajo el cristal apareció una costa que ningún atlas conservaba.\n\nEn el reflejo se formó ${character('demo-world-char-odran', 'Odran')}, armadura ennegrecida y garganta cortada.\n\n—Por mi palabra ante Aurel Venn: la heredera elegirá.\n\n—Usted murió —susurró Sena.\n\n—Queda oído.\n\nEl agua alcanzó sus rodillas. Sena arrancó el cilindro de memoria del soporte prohibido.\n\n—Acabo de robar el Archivo.\n\n—No —dijo Ilyra, cerrando el mapa dentro de su mano—. Acabas de impedir que vuelva a cerrar una puerta.`,
      `${character('demo-world-char-sena', 'Sena')} ordered their keys by sound: rain, bell, broken tooth. “What if Aurel locked this not to hide it? What if he expected a particular hand?”\n\n“One question at a time,” Ilyra said.\n\n“That would waste the low tide.”\n\nThe first key returned a woman searching for her child. The second, the taste of an extinguished lamp. Sena recoiled.\n\n“That was not mine.”\n\nCael held the sluice. “Count heads. Three in, three out.”\n\nThe final key turned. Black water and ${character('demo-world-char-nara', 'Nara')}’s voice escaped.\n\n“It is not a moon. No, wait: a door pretending to be distance. Ily, if you hear this, be angry later.”\n\nIlyra’s hand opened. Beneath the glass appeared a coast no atlas preserved.\n\n${character('demo-world-char-odran', 'Odran')} formed in reflection, armour blackened and throat cut.\n\n“By my word before Aurel Venn: the heir will choose.”\n\n“You died,” Sena whispered.\n\n“It is heard.”\n\nWater reached their knees. Sena tore the forbidden memory cylinder free.\n\n“I just robbed the Archive.”\n\n“No,” Ilyra said, closing the map inside her hand. “You stopped it closing another door.”`
    ),
  },
  'demo-world-scene-gate': {
    summary: localized(
      'En la Puerta de Sal, Tarek recibe dos órdenes incompatibles: arrestar a Ilyra y mantener abierta la única evacuación terrestre. Ilyra presenta una autorización falsificada cuya activación exige que quien la valida asuma públicamente el coste. Cael provoca a la guardia para ofrecerle una excusa, pero Tarek rechaza fingir. Abre la puerta, registra su propia firma y entrega a Ilyra la frecuencia secreta de la Guardia; el sello arde y deja una marca visible que Maelor podrá rastrear.',
      'At the Salt Gate, Tarek receives incompatible orders: arrest Ilyra and preserve the only land evacuation route. Ilyra presents a forged authorisation whose activation requires its validator publicly accept the cost. Cael provokes the guard to offer an excuse, but Tarek refuses pretence. He opens the gate, records his signature and gives Ilyra the Guard’s secret frequency; the seal burns and leaves a mark Maelor can trace.'
    ),
    notes: localized(
      'OBJETIVO: cruzar sin convertir a la Guardia en enemiga. OPOSICIÓN: la lealtad filial de Tarek y la ley mágica de las puertas. GIRO: la falsificación solo funciona si Tarek decide de forma consciente. CONSECUENCIA: la huida tiene éxito, pero su traición queda probada. ARCO: primer acto irreversible de Tarek.',
      'GOAL: cross without making the Guard an enemy. OPPOSITION: Tarek’s filial loyalty and the magical gate law. TURN: the forgery works only through Tarek’s conscious choice. CONSEQUENCE: escape succeeds but his treason is proved. ARC: Tarek’s first irreversible act.'
    ),
    manuscript: localized(
      `${character('demo-world-char-tarek', 'Tarek')} leyó la orden dos veces. El sello era perfecto; la firma de Maelor, imposible.\n\n—Con permiso: esto es falso.\n\n—Correcto —dijo Ilyra—. También lo es que quieras detenernos.\n\nCael sonrió a los guardias. —Podría intentar un soborno. Así todos volvemos a terreno conocido.\n\nTarek pulió la prótesis auditiva. Detrás de Ilyra aguardaban carros de evacuación; delante, la orden de cerrar. La puerta exigía un precio a toda mentira pronunciada bajo su arco.\n\n—Puedo abrirte la puerta —dijo al fin—. No fingir que no lo hice.\n\nRepitió la última línea de la autorización, ahora con su nombre.\n\n—El paso queda bajo mi responsabilidad.\n\nEl vidrio ardió. El sello falso se volvió ceniza y la firma de Tarek quedó grabada en hierro blanco.\n\nIlyra no dio las gracias. Le devolvió el saludo de cuando ambos eran aprendices.\n\n—La Guardia cambiará de frecuencia al anochecer —añadió él—. Usad la séptima.\n\n—Tu tío sabrá que fuiste tú —dijo Cael.\n\nTarek miró la marca. —Esta vez he oído la orden perfectamente.\n\nLa ${rule('demo-world-rule-gates', 'ley de las puertas')} abrió el arco. Tarek no miró atrás mientras sus amigos cruzaban.`,
      `${character('demo-world-char-tarek', 'Tarek')} read the order twice. The seal was perfect; Maelor’s signature impossible.\n\n“With permission: this is false.”\n\n“Correct,” Ilyra said. “So is your desire to arrest us.”\n\nCael smiled at the guards. “I could attempt a bribe. Put us all on familiar ground.”\n\nTarek polished his hearing device. Behind Ilyra waited evacuation carts; before him, the closure order. The gate demanded a price for every lie spoken beneath its arch.\n\n“I can open the gate. I cannot pretend I did not.”\n\nHe repeated the authorisation’s last line, now with his own name.\n\n“The passage is under my responsibility.”\n\nGlass burned. The forged seal became ash and Tarek’s signature remained in white iron.\n\nIlyra did not thank him. She returned the salute from their apprentice days.\n\n“The Guard changes frequency at dusk,” he added. “Use the seventh.”\n\n“Your uncle will know,” Cael said.\n\nTarek faced the mark. “This time I heard the order perfectly.”\n\nThe ${rule('demo-world-rule-gates', 'gate law')} opened the arch. Tarek did not turn as his friends crossed.`
    ),
  },
  'demo-world-scene-island': {
    summary: localized(
      'En Isla Nácar, la marea confisca toda arma salvo la prótesis de Ilyra, a la que reconoce como parte de Asteriel. Vesh obliga al grupo a escuchar una memoria compartida: el Corazón no es una máquina sino una criatura arrancada del mar para alimentar el Faro. Sena casi confunde el duelo heredado con el propio y Cael rompe el ritual para sostenerle. Vesh confirma que Nara sigue consciente dentro de la criatura y exige que Ilyra elija entre devolverla al mar o negociar una nueva relación.',
      'On Nacre Island, the tide takes every weapon except Ilyra’s prosthesis, which it recognises as part of Asteriel. Vesh makes the group hear a shared memory: the Heart is not a machine but a creature torn from the sea to feed the Lighthouse. Sena nearly confuses inherited grief with their own and Cael breaks ritual to support them. Vesh confirms Nara remains conscious inside the creature and demands Ilyra choose between returning it to the sea or negotiating a new relationship.'
    ),
    notes: localized(
      'OBJETIVO: comprender la coordenada de Aurel. OPOSICIÓN: Vesh no entrega respuestas sin experiencia y la escucha amenaza la identidad de Sena. GIRO: la prótesis de Ilyra contiene vidrio del propio Corazón. CONSECUENCIA: rescatar a Nara y liberar a Asteriel se convierten en el mismo conflicto. RELACIÓN: Cael elige a la tripulación por encima del protocolo.',
      'GOAL: understand Aurel’s coordinate. OPPOSITION: Vesh gives no answer without experience and listening threatens Sena’s identity. TURN: Ilyra’s prosthesis contains glass from the Heart itself. CONSEQUENCE: rescuing Nara and freeing Asteriel become one conflict. RELATIONSHIP: Cael chooses crew over protocol.'
    ),
    manuscript: localized(
      `Nadie desembarcó armado en ${place('demo-world-place-nacre', 'Isla Nácar')}. La marea recogió espadas, pistolas y la pequeña navaja de Sena. Solo retuvo la mano de vidrio de Ilyra.\n\n—Herramienta —dictaminó ${character('demo-world-char-vesh', 'Vesh')}—, mientras no decida lo contrario.\n\n—¿La mano puede decidir? —preguntó Sena—. ¿Y recuerda? ¿Y si recuerda algo que Ilyra no?\n\nVesh probó la sal de sus dedos. —Aún no has pagado esas respuestas.\n\nLos condujo a una caverna que respiraba. El canto llegó por el suelo: redes, cuchillos solares, una criatura arrastrada fuera del mar. Ilyra vio el primer Faro caminar con un corazón cautivo bajo las costillas.\n\nSena cayó de rodillas. —Eso no era mío. Yo no perdí ese nombre.\n\nCael rompió el círculo ritual y le sujetó los hombros. —Cuenta cabezas. Sigues aquí.\n\nVesh se rió sin sonido. —Bien. Una tradición que no admite rescate solo es una jaula antigua.\n\nIlyra flexionó la prótesis; la caverna respondió.\n\n—Nara está dentro —dijo.\n\n—Nara recuerda dentro —corrigió Vesh—. No es lo mismo, criatura de orilla.\n\n—Entonces la sacaremos.\n\n—¿Y a quien la contiene?\n\nPor primera vez, Ilyra no enumeró rutas. Escuchó.`,
      `Nobody landed armed on ${place('demo-world-place-nacre', 'Nacre Island')}. The tide collected swords, pistols and Sena’s little knife. It kept only Ilyra’s glass hand.\n\n“A tool,” ${character('demo-world-char-vesh', 'Vesh')} ruled, “until it decides otherwise.”\n\n“Can the hand decide?” Sena asked. “Does it remember? What if it remembers something Ilyra does not?”\n\nVesh tasted salt from her fingers. “You have not paid for those answers.”\n\nShe led them into a breathing cave. Song travelled through the floor: nets, solar knives, a creature dragged from the sea. Ilyra saw the first Lighthouse walking with a captive heart beneath its ribs.\n\nSena fell. “That was not mine. I did not lose that name.”\n\nCael broke the ritual circle and held them. “Count heads. You are still here.”\n\nVesh laughed soundlessly. “Good. A tradition that forbids rescue is merely an old cage.”\n\nIlyra flexed her prosthesis; the cave answered.\n\n“Nara is inside.”\n\n“Nara remembers inside,” Vesh corrected. “Not the same, shore creature.”\n\n“Then we take her out.”\n\n“And the one containing her?”\n\nFor once, Ilyra listed no routes. She listened.`
    ),
  },
  'demo-world-scene-observatory': {
    summary: localized(
      'Ilyra, Sena y Tarek entran clandestinamente en el Observatorio de Orla. Superponen los registros de Nara con las órdenes del Consejo y descubren que las seis cúpulas no observan la Tercera Luna: la empujan hacia una alineación con el Faro. Una séptima palanca sellada por Maelor puede detener el mecanismo, pero hacerlo adelantaría la Marea Negra. Nara logra hablar mediante las lentes y pide a Ilyra que rompa la palanca; Tarek descubre la firma de su tío y deja de poder atribuir el plan a subordinados.',
      'Ilyra, Sena and Tarek enter Orla Observatory in secret. Overlaying Nara’s records and Council orders reveals the six domes do not observe the Third Moon: they push it towards alignment with the Lighthouse. A seventh lever sealed by Maelor can stop the mechanism, but doing so brings the Black Tide forward. Nara speaks through the lenses and asks Ilyra to break the lever; Tarek finds his uncle’s signature and can no longer blame subordinates.'
    ),
    notes: localized(
      'OBJETIVO: verificar la advertencia de Nara. OPOSICIÓN: el mecanismo exige elegir entre dos catástrofes y Tarek aún busca una explicación inocente. GIRO: la órbita se centra en el Faro, no en Elyndra. CONSECUENCIA: rompen la palanca, adelantan la crisis y activan las seis campanas. INFORMACIÓN: Nara conoce la teoría, no los cambios ocurridos desde su desaparición.',
      'GOAL: verify Nara’s warning. OPPOSITION: the mechanism forces a choice between catastrophes and Tarek still seeks an innocent explanation. TURN: the orbit centres on the Lighthouse, not Elyndra. CONSEQUENCE: they break the lever, advance the crisis and trigger the six bells. INFORMATION: Nara knows the theory, not changes since her disappearance.'
    ),
    manuscript: localized(
      `Las seis cúpulas del ${place('demo-world-place-orla', 'Observatorio')} giraban en direcciones distintas. Sena superpuso los registros y llenó su antebrazo de cifras.\n\n—¿Y si no están siguiendo la Luna? ¿Y si la están llevando?\n\nIlyra rotó el diagrama. La órbita no rodeaba Elyndra, sino el Faro.\n\n—Uno: detenemos el mecanismo y adelantamos la Marea Negra. Dos: lo dejamos y Maelor abre la puerta.\n\n—Falta una tercera —dijo Tarek.\n\n—Siempre falta. No siempre existe.\n\nTras el sello del Regente encontraron la séptima palanca. Tarek acercó la prótesis y oyó la firma de mando incrustada en el metal.\n\n—Es él —dijo, sin tratamiento.\n\nLas lentes se cubrieron de vaho. La voz de Nara corrió por las seis cúpulas.\n\n—Ily, rompe la palanca. No, espera: rompe primero el aro exterior o la descarga buscará tu mano. ¿Ves la diferencia?\n\nIlyra apoyó los dedos en el aro. —Nara, ¿qué te ocurrió?\n\n—Enfádate después.\n\nSena cortó el seguro. Tarek sujetó el mecanismo. Ilyra quebró la palanca.\n\nLas cúpulas se detuvieron. A lo lejos sonó la primera campana de ceniza.\n\n—Queda bajo mi responsabilidad —dijo Tarek.\n\n—No —respondió Ilyra—. Esta vez queda bajo la nuestra.`,
      `The six domes of ${place('demo-world-place-orla', 'Orla Observatory')} turned in different directions. Sena overlaid the records and covered their forearm with figures.\n\n“What if they are not following the Moon? What if they are taking it somewhere?”\n\nIlyra rotated the diagram. The orbit surrounded not Elyndra but the Lighthouse.\n\n“One: stop the mechanism and advance the Black Tide. Two: leave it and Maelor opens the door.”\n\n“A third is missing,” Tarek said.\n\n“One is always missing. It does not always exist.”\n\nBehind the Regent’s seal they found a seventh lever. Tarek put his device near it and heard the command signature in the metal.\n\n“It is him,” he said, without title.\n\nThe lenses fogged. Nara’s voice ran through six domes.\n\n“Ily, break the lever. No, wait: break the outer ring first or the discharge will seek your hand. Do you see the difference?”\n\n“Nara, what happened to you?”\n\n“Be angry later.”\n\nSena cut the lock, Tarek held the mechanism and Ilyra broke the lever.\n\nThe domes stopped. Far away, the first ash bell rang.\n\n“This is under my responsibility,” Tarek said.\n\n“No,” Ilyra answered. “This time it is under ours.”`
    ),
  },
  'demo-world-scene-coup': {
    summary: localized(
      'Las seis campanas convierten la avería del Observatorio en golpe de Estado. Maelor declara traidora a la Casa Venn, ordena cerrar el puerto y ofrece a Tarek el mando total de la Guardia si repite la orden. Tarek intenta obligarlo a reconocer a los civiles atrapados; Maelor los reduce a un coste aceptable. Cuando llega la noticia de que el Gremio bloquea el puerto, Tarek deja su capa y llama “tío” a Maelor por primera vez en público. Maelor lo deja marchar, convencido de que regresará cuando el caos demuestre su razón.',
      'Six bells turn the Observatory failure into a coup. Maelor declares House Venn traitorous, orders the harbour closed and offers Tarek full command of the Guard if he repeats the order. Tarek forces him to acknowledge trapped civilians; Maelor reduces them to acceptable cost. When news arrives that the Guild blockades the harbour, Tarek leaves his cloak and calls Maelor “uncle” in public for the first time. Maelor lets him go, certain chaos will prove him right.'
    ),
    notes: localized(
      'OBJETIVO DE MAELOR: conservar el control sin destruir su vínculo con Tarek. OBJETIVO DE TAREK: obtener una excepción civil sin admitir aún su rebelión. GIRO: el bloqueo del Gremio elimina la salida marítima. CONSECUENCIA: Tarek rompe públicamente con Maelor; el Regente queda solo y acelera su marcha al Corazón. TONO: duelo familiar expresado como procedimiento.',
      'MAELOR GOAL: retain control without destroying his bond with Tarek. TAREK GOAL: secure a civilian exception without yet admitting rebellion. TURN: the Guild blockade removes the sea exit. CONSEQUENCE: Tarek publicly breaks with Maelor; the Regent stands alone and hastens towards the Heart. TONE: family duel expressed as procedure.'
    ),
    manuscript: localized(
      `Las seis campanas sonaron a mediodía. ${character('demo-world-char-maelor', 'Maelor')} alineó seis decretos sobre la mesa.\n\n—La ${group('demo-world-group-venn', 'Casa Venn')} queda declarada enemiga de la continuidad. Comandante, repita la orden.\n\n${character('demo-world-char-tarek', 'Tarek')} mantuvo la capa roja puesta. —Con permiso: el cierre del puerto atrapa dos barrios fuera del plan de racionamiento.\n\n—El hecho se admite. Cuatro mil setecientas personas. El coste aceptable para impedir una guerra civil.\n\n—Son nombres.\n\n—Son nombres porque la ciudad ha conservado registros. Sin continuidad ni siquiera serán cifras.\n\nUn mensajero anunció que el Gremio de las Seis Velas bloqueaba la bahía. Maelor movió una ficha en el mapa y ofreció a Tarek el sello de mando.\n\n—Repite la orden y la Guardia será tuya.\n\nTarek se quitó la capa, la dobló según reglamento y la dejó sobre el sexto decreto.\n\n—No, tío. Esta vez he oído la orden perfectamente.\n\nDurante un instante Maelor tocó el borde de su máscara. Luego volvió a ser Regente.\n\n—La deserción queda registrada. Cuando la esperanza pierda su primera calle, esta puerta seguirá abierta para ti.\n\n—Una puerta cerrada también encierra a quien la guarda.\n\nTarek salió. Maelor no ordenó que lo detuvieran. Tachó “negociación” y escribió “Corazón”.`,
      `Six bells rang at noon. ${character('demo-world-char-maelor', 'Maelor')} aligned six decrees on the table.\n\n“${group('demo-world-group-venn', 'House Venn')} is declared an enemy of continuity. Commander, repeat the order.”\n\n${character('demo-world-char-tarek', 'Tarek')} kept his red cloak on. “With permission: closing the harbour traps two districts outside ration planning.”\n\n“The fact is admitted. Four thousand seven hundred people. The acceptable cost of preventing civil war.”\n\n“They are names.”\n\n“They are names because the city preserved records. Without continuity they will not even be figures.”\n\nA messenger announced the Six Sails blockade. Maelor moved a piece on the map and offered Tarek the command seal.\n\n“Repeat the order and the Guard is yours.”\n\nTarek removed his cloak, folded it by regulation and laid it across the sixth decree.\n\n“No, uncle. This time I heard the order perfectly.”\n\nFor an instant Maelor touched his mask. Then he was Regent again.\n\n“Desertion is recorded. When hope loses its first street, this door remains open.”\n\n“A closed gate also confines its guard.”\n\nTarek left. Maelor did not order an arrest. He crossed out “negotiation” and wrote “Heart”.`
    ),
  },
  'demo-world-scene-heart': {
    summary: localized(
      'Bajo el Barrio Hundido, Ilyra llega al Corazón con Cael, Sena y Vesh antes que Maelor. Asteriel despierta y obliga a toda Lúmina a compartir una pérdida; Nara habla desde su memoria y Maelor intenta activar el arnés del Faro. Ilyra pronuncia el nombre verdadero, pero la regla que debería borrarlo falla porque lo comparte con el grupo en vez de poseerlo. Rechaza decidir sola: Sena abre el archivo de recuerdos, Cael organiza la evacuación, Vesh ofrece el pacto y Maelor debe elegir entre disparar o escuchar.',
      'Beneath the Sunken Quarter, Ilyra reaches the Heart with Cael, Sena and Vesh before Maelor. Asteriel wakes and makes all Lumina share one loss; Nara speaks from its memory while Maelor attempts to trigger the Lighthouse harness. Ilyra says the true name, but the rule meant to erase it fails because she shares rather than owns it. She refuses to decide alone: Sena opens the memory archive, Cael organises evacuation, Vesh offers a pact and Maelor must choose between firing and listening.'
    ),
    notes: localized(
      'OBJETIVO: liberar a Nara y evitar que Lúmina colapse. OPOSICIÓN: esos objetivos parecen incompatibles y Maelor exige una decisión inmediata. GIRO: el coste de un nombre verdadero puede repartirse mediante consentimiento. CONSECUENCIA: Asteriel abandona el arnés sin destruir la ciudad; Maelor pierde el monopolio de la emergencia y Nara queda libre como voz, aún sin cuerpo. CLÍMAX: cada personaje resuelve desde su defecto o da un paso contra él.',
      'GOAL: free Nara and prevent Lumina’s collapse. OPPOSITION: those goals seem incompatible and Maelor demands an immediate choice. TURN: a true name’s cost can be shared by consent. CONSEQUENCE: Asteriel leaves the harness without destroying the city; Maelor loses the emergency monopoly and Nara is freed as a voice, not yet a body. CLIMAX: each character acts through or against their flaw.'
    ),
    manuscript: localized(
      `El Corazón no era una máquina. Abrió un ojo del tamaño de una plaza y toda ${place('demo-world-place-lumina', 'Lúmina')} recordó la misma pérdida.\n\nSena se aferró a sus llaves. —Eso no era mío. Pero esta vez sé de quién es.\n\nMaelor descendió con el arnés de mando. —La ciudad no sobrevivirá a una liberación.\n\n—El hecho se admite —dijo Ilyra—. Tu conclusión, no.\n\nCael tocó el suelo con las membranas. —La corriente sube. Cuenta cabezas: tenemos doce minutos.\n\nVesh probó la sal del aire. —Aún pensáis como criaturas de orilla. Libertad o ciudad. Nombre o memoria. Las mareas saben sostener dos cosas.\n\nLa voz de Nara atravesó el vidrio. —Ily, el arnés tiene seis cierres. No, espera: siete. El último eres tú.\n\nIlyra flexionó la mano y pronunció **Asteriel**. El nombre cruzó el agua, alcanzó a la criatura y volvió intacto. La regla decía que debía olvidarlo.\n\n—No voy a decidir sola.\n\nAbrió el mapa. Sena ofreció sus recuerdos con permiso; Vesh inició el canto; Cael transmitió rutas de evacuación. Uno a uno, los presentes repitieron el nombre y repartieron su coste.\n\nMaelor levantó el arma. Tarek apareció en la pasarela sin capa.\n\n—Con permiso, tío: elija sabiendo que quedará registrado.\n\nLa máscara de Maelor reflejó miles de rostros. Bajó el arma.\n\nAsteriel arrancó los cables del Faro y nadó bajo la ciudad. Por primera vez en nueve años, la oscuridad no fue una orden.`,
      `The Heart was not a machine. It opened an eye the size of a square and all ${place('demo-world-place-lumina', 'Lumina')} remembered the same loss.\n\nSena clutched their keys. “That was not mine. This time I know whose it is.”\n\nMaelor descended wearing the command harness. “The city will not survive a release.”\n\n“The fact is admitted,” Ilyra said. “Your conclusion is not.”\n\nCael felt the floor with his membranes. “Current rising. Count heads: twelve minutes.”\n\nVesh tasted the air. “Still shore creatures. Freedom or city. Name or memory. Tides hold two things.”\n\nNara’s voice crossed the glass. “Ily, the harness has six locks. No, wait: seven. The last is you.”\n\nIlyra flexed her hand and spoke **Asteriel**. The name crossed the water, reached the creature and returned intact. The rule said she must forget it.\n\n“I will not decide alone.”\n\nShe opened the map. Sena offered memories by consent; Vesh began the song; Cael transmitted evacuation routes. One by one they repeated the name and divided its cost.\n\nMaelor raised his weapon. Tarek appeared without his cloak.\n\n“With permission, uncle: choose knowing it will be recorded.”\n\nMaelor’s mask reflected thousands of faces. He lowered the weapon.\n\nAsteriel tore free of the Lighthouse and swam beneath the city. For the first time in nine years, darkness was not an order.`
    ),
  },
  'demo-world-scene-epilogue': {
    summary: localized(
      'Meses después, Sena dirige un Archivo con seis entradas y memorias que solo pueden consultarse con consentimiento. Cael ha recuperado una nave pero la mantiene atracada hasta que vuelva toda su tripulación. Tarek organiza una Guardia civil sin capa de casa; Maelor espera juicio y corrige las cifras de su propia acusación. Ilyra y Nara buscan una forma de devolver cuerpo a la voz liberada. Una cuna vacía destinada a Elan queda fuera de los salones dinásticos, mientras una luz móvil sugiere que Asteriel continúa cerca.',
      'Months later, Sena runs an Archive with six entrances and memories accessible only by consent. Cael has recovered a ship but keeps it moored until all his crew returns. Tarek organises a civic Guard without house colours; Maelor awaits trial and corrects the figures in his indictment. Ilyra and Nara seek a body for the liberated voice. An empty cradle intended for Elan remains outside dynastic halls, while a moving light suggests Asteriel stays near.'
    ),
    notes: localized(
      'OBJETIVO: mostrar consecuencias sin cerrar todas las preguntas. CAMBIOS: Sena deja de ganarse su lugar mediante utilidad; Cael elige causa y tripulación; Tarek asume bando; Maelor conserva su lógica pero pierde poder; Ilyra comparte el control; Nara debe aprender a contar la verdad. PRESAGIO: Elan es posibilidad, no confirmación; Asteriel permanece libre.',
      'GOAL: show consequences without closing every question. CHANGES: Sena stops earning belonging through usefulness; Cael chooses cause and crew; Tarek takes a side; Maelor retains his logic but loses power; Ilyra shares control; Nara must learn to tell truth. FORESHADOWING: Elan is possibility, not confirmation; Asteriel remains free.'
    ),
    manuscript: localized(
      `El nuevo Archivo no tenía puerta principal. ${character('demo-world-char-sena', 'Sena')} había mandado abrir seis y colocó sobre cada una una placa: **Ninguna memoria sin permiso**.\n\n—¿Y si alguien necesita entrar por una séptima? —preguntó Cael.\n\n—Entonces que traiga una llave y una propuesta mejor.\n\nSu nave esperaba en el canal, recuperada y todavía sin nombre. Cael se negó a bautizarla hasta que Ilyra regresara del mar con la voz de Nara guardada en una lente.\n\nTarek llegó sin capa para entregar el registro del juicio. —Maelor ha corregido el número de víctimas en su propia acusación.\n\n—Una cerradura con uniforme hasta el final —dijo Sena, aunque archivó la corrección.\n\nEn una sala sin emblemas esperaba una cuna vacía. Dos casas habían enviado coronas en miniatura; Sena las usó para sujetar una ventana.\n\n—¿Crees en la profecía? —preguntó Tarek.\n\n—Creo que alguien todavía no nacido merece llegar sin debernos un final.\n\nEn la pared dejaron espacio para el mapa que Ilyra aún no había regresado a dibujar. Mar adentro apareció una luz baja, móvil y paciente.\n\nSena escuchó el vidrio de la ventana. Esta vez el recuerdo no exigía nada.\n\n—Cuenta cabezas —dijo Cael.\n\nSena contó. Faltaban dos, pero ambas conocían el camino.`,
      `The new Archive had no main door. ${character('demo-world-char-sena', 'Sena')} ordered six opened and placed a plaque above each: **No memory without consent**.\n\n“What if someone needs a seventh?” Cael asked.\n\n“Then they can bring a key and a better proposal.”\n\nHis recovered ship waited in the canal, still unnamed. Cael refused to christen it until Ilyra returned from sea with Nara’s voice held in a lens.\n\nTarek arrived without a cloak to deliver the trial record. “Maelor corrected the casualty figure in his own indictment.”\n\n“A lock in uniform to the end,” Sena said, though they filed the correction.\n\nAn empty cradle waited in a room without emblems. Two houses had sent miniature crowns; Sena used them to hold a window open.\n\n“Do you believe the prophecy?” Tarek asked.\n\n“I believe someone not yet born deserves to arrive without owing us an ending.”\n\nOn the wall they left space for the map Ilyra had not returned to draw. Offshore, a low light appeared, moving and patient.\n\nSena listened to the window glass. This time the memory demanded nothing.\n\n“Count heads,” Cael said.\n\nSena counted. Two were missing, but both knew the way home.`
    ),
  },
};
