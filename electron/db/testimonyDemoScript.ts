// El GUION de la demo de Testimonios: lo que se dice, quién lo dice y en qué idioma.
//
// Vive aparte del sembrador por una razón concreta: el audio de la demo se genera A PARTIR
// de este guion (voces sintéticas, una por persona), y si el texto viviera solo dentro de
// `testimonyDemoData.ts` la primera corrección de una frase dejaría el audio diciendo una
// cosa y la transcripción otra. Con una sola fuente, cambiar una línea obliga a regenerar
// el audio y el desajuste se nota en el acto.
//
// Cada turno declara la PERSONA que habla, no un papel: Carmen aparece en su propia
// entrevista y en la grupal, y en las dos tiene que sonar igual. Eso es justamente lo que
// hace de la demo un banco de pruebas para la detección de hablantes.

export type DemoSpeakerRole = 'interviewer' | 'narrator' | 'narrator2';

/** Las cinco personas de «Memoria del valle», sin el prefijo de la demo. */
export type DemoPerson = 'jorge' | 'carmen' | 'tomas' | 'rosario' | 'miguel';

export interface DemoTurn {
  /** El papel dentro de la entrevista, que es lo que el sembrador necesita. */
  speaker: DemoSpeakerRole;
  /** Quién habla, que es lo que el generador de audio necesita. */
  person: DemoPerson;
  es: string;
  en: string;
}

export interface DemoInterviewScript {
  key: string;
  /** `false` en la entrevista cuyo maestro se exportó y se soltó de la bóveda. */
  hasAudio: boolean;
  turns: DemoTurn[];
}

export const TESTIMONY_DEMO_SCRIPT: DemoInterviewScript[] = [
  {
    key: 'carmen',
    hasAudio: true,
    turns: [
      {
        speaker: 'interviewer', person: 'jorge',
        es: '¿Se acuerda del día en que se marchó su padre?',
        en: 'Do you remember the day your father left?',
      },
      {
        speaker: 'narrator', person: 'carmen',
        es: 'Mi padre se marchó en el cuarenta y siete. Yo tenía dieciséis años y me acuerdo del ruido del camión.',
        en: 'My father left in ’47. I was sixteen and I remember the sound of the lorry.',
      },
      {
        speaker: 'narrator', person: 'carmen',
        es: 'Nunca volvimos a saber de él hasta muchos años después. En casa no se hablaba de eso.',
        en: 'We never heard from him again until many years later. At home nobody talked about it.',
      },
      {
        speaker: 'narrator', person: 'carmen',
        es: 'Aquel invierno comimos lo que había. Mi madre hacía pan con lo que le daban en el molino.',
        en: 'That winter we ate whatever there was. My mother made bread with what they gave her at the mill.',
      },
      {
        speaker: 'interviewer', person: 'jorge',
        es: '¿Y usted siguió yendo a la escuela?',
        en: 'And did you keep going to school?',
      },
      {
        speaker: 'narrator', person: 'carmen',
        es: 'Hasta los catorce. Después ya no, porque hacía falta en casa.',
        en: 'Until I was fourteen. Not after that, because I was needed at home.',
      },
    ],
  },
  {
    key: 'tomas',
    hasAudio: true,
    turns: [
      {
        speaker: 'narrator', person: 'tomas',
        es: 'En el cincuenta y dos había cuarenta y un niños en la escuela. En el setenta y cuatro cerré con siete.',
        en: 'In ’52 there were forty-one children at the school. In ’74 I closed it with seven.',
      },
      {
        speaker: 'narrator', person: 'tomas',
        es: 'Los que se marchaban no volvían. Primero el padre, y al año siguiente la familia entera.',
        en: 'Those who left did not come back. First the father, and the following year the whole family.',
      },
      {
        speaker: 'interviewer', person: 'jorge',
        es: '¿Se hablaba en clase de por qué se iban?',
        en: 'Was it talked about in class, why they were leaving?',
      },
      {
        speaker: 'narrator', person: 'tomas',
        es: 'No. Eso no se hablaba. Se sabía, pero no se decía.',
        en: 'No. That was not talked about. Everyone knew, but nobody said it.',
      },
    ],
  },
  {
    key: 'grupal',
    hasAudio: true,
    turns: [
      {
        speaker: 'narrator', person: 'rosario',
        es: 'Entré con catorce años. Se entraba a las seis y se salía cuando el molino paraba.',
        en: 'I started at fourteen. You went in at six and left when the mill stopped.',
      },
      {
        speaker: 'narrator2', person: 'carmen',
        es: 'A mí me pagaban la mitad que a mi hermano por el mismo turno.',
        en: 'They paid me half what they paid my brother for the same shift.',
      },
      {
        speaker: 'narrator', person: 'rosario',
        es: 'En casa no se decía lo que se ganaba. Eso tampoco se hablaba.',
        en: 'At home nobody said what they earned. That was another thing you did not talk about.',
      },
    ],
  },
  {
    key: 'miguel',
    // El maestro se exportó al archivo y se soltó: la ficha, la huella y la transcripción
    // siguen, y no hay un byte de audio que generar.
    hasAudio: false,
    turns: [
      {
        speaker: 'narrator', person: 'miguel',
        es: 'Me fui en el cincuenta y siete con una maleta de cartón. Volví en el dos mil siete.',
        en: 'I left in ’57 with a cardboard suitcase. I came back in 2007.',
      },
      {
        speaker: 'narrator', person: 'miguel',
        es: 'El valle que me encontré no era el que dejé. Estaban las casas, pero no la gente.',
        en: 'The valley I found was not the one I left. The houses were there, the people were not.',
      },
      {
        speaker: 'interviewer', person: 'jorge',
        es: '¿Se arrepiente de haberse ido?',
        en: 'Do you regret leaving?',
      },
      {
        speaker: 'narrator', person: 'miguel',
        es: 'No. Aquí no había nada. Pero tampoco puedo decir que ganara.',
        en: 'No. There was nothing here. But I cannot say I came out ahead either.',
      },
    ],
  },
];

/** Un turno ya generado: dónde empieza y dónde acaba en el audio, medido, no estimado. */
export interface DemoAudioTurn {
  start: number;
  end: number;
}

export interface DemoAudioEntry {
  key: string;
  language: 'es' | 'en';
  file: string;
  mimeType: string;
  durationSeconds: number;
  sizeBytes: number;
  sha256: string;
  /** Huella de LO QUE SE DICE: delata un guion corregido sin regenerar el audio. */
  textSha256: string;
  /** Qué voz sintética presta cada persona, para que la demo pueda decirlo. */
  voices: Record<string, string>;
  turns: DemoAudioTurn[];
}

export interface DemoAudioManifest {
  generator: string;
  entries: DemoAudioEntry[];
}

export function demoScriptFor(key: string): DemoInterviewScript | null {
  return TESTIMONY_DEMO_SCRIPT.find((script) => script.key === key) ?? null;
}
