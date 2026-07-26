// Subtitle tables for this deck.
//
// English is NOT listed here: it is the spoken language and is read straight from
// shots.mjs, so the script and its subtitles cannot drift apart. Every other
// language needs one entry per shot id.
//
// Adding a language: add it to LANGUAGES and give it a full table below. A missing
// key falls back to English, which reads as a bug in the finished file.

export const LANGUAGES = [
  { code: 'en', label: 'English', youtube: 'en' },
  { code: 'es', label: 'Español', youtube: 'es' },
];

export const CAPTIONS = {
  es: {
    'welcome': 'Una frase que dice de qué va este vídeo.',
    'example-highlight': 'Una frase sobre algo en pantalla, con un aro alrededor.',
    'example-act': 'Una frase sobre algo que se está haciendo, mientras se hace.',
    'example-modal': 'Una frase sobre un diálogo, el único caso en que la cámara se acerca.',
    'recap': 'Una frase de cierre que deja clara la idea.',
  },
};
