import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import type { AppLanguage } from '@shared/types';
import { Icon } from './ui';
import { NodiAvatar } from './nodi/NodiAvatar';
import homeShot from '../assets/mobile-teaser/01-home.webp';
import libraryShot from '../assets/mobile-teaser/02-library.webp';
import workShot from '../assets/mobile-teaser/03-work.webp';
import ideaShot from '../assets/mobile-teaser/04-idea.webp';
import searchShot from '../assets/mobile-teaser/05-search.webp';
import argumentShot from '../assets/mobile-teaser/06-argument-map.webp';
import gapsShot from '../assets/mobile-teaser/07-gaps.webp';
import deepResearchShot from '../assets/mobile-teaser/08-deep-research.webp';
import byoModelShot from '../assets/mobile-teaser/09-byo-model.webp';

/**
 * "A tease of what's coming" — the one-time look at Nodus on a phone.
 *
 * Unlike the other update tours, this one announces something that does NOT exist in
 * the app yet, so there is no tutorial version to gate it against: a fresh 3.2.4
 * install has seen no more of the mobile app than a five-year user has. It is gated on
 * the release alone plus its own sentinel, and shows exactly once.
 *
 * The screenshots are the App Store set, each carrying its English headline burnt into
 * the image. They are not re-rendered per language — the store listing they feed is
 * English only — so the interface around them says so and carries the translated label
 * for the screen being shown. The survey is a Google Form, also English only, and it is
 * the one outbound link here: nothing is sent anywhere until the user clicks it.
 *
 * Source images are 1320 x 2868 (~580 KB each); these are resampled to 420 px wide
 * WebP, which is ~20 KB each and still resolves the headline at the size the carousel
 * shows them.
 */

/** Only this release presents it. A later version must not resurrect the teaser. */
export const MOBILE_TEASER_RELEASE = '3.2.4';
const SEEN_KEY = `nodus.mobileTeaserSeen.${MOBILE_TEASER_RELEASE}`;
/**
 * The canonical form URL, NOT the forms.gle short link it was shared as.
 *
 * `forms.gle` is a Firebase Dynamic Links domain, and that service has been retired: a
 * short link that fails to resolve does not fall back to the form, it lands on Google's
 * "Invalid Dynamic Link" error page. Resolving it once here and shipping the destination
 * removes the indirection entirely — one hop, no third-party redirector, and the link
 * cannot rot separately from the form it points at.
 */
export const MOBILE_TEASER_SURVEY_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSf-wHGtAbQV3Kc0J1hgzXBpj8oV1ky9xbuyNJMQ467X7rUYBw/viewform';

/** The slide order is the App Store order: what the app is, then what it can do. */
const SHOTS: readonly { src: string; key: SlideKey }[] = [
  { src: homeShot, key: 'home' },
  { src: libraryShot, key: 'library' },
  { src: workShot, key: 'work' },
  { src: ideaShot, key: 'idea' },
  { src: searchShot, key: 'search' },
  { src: argumentShot, key: 'argument' },
  { src: gapsShot, key: 'gaps' },
  { src: deepResearchShot, key: 'deepResearch' },
  { src: byoModelShot, key: 'model' },
];

type SlideKey = 'home' | 'library' | 'work' | 'idea' | 'search' | 'argument' | 'gaps' | 'deepResearch' | 'model';

interface TeaserCopy {
  badge: string;
  title: string;
  summary: string;
  eyebrow: string;
  heading: string;
  lede: string;
  status: string;
  surveyTitle: string;
  surveyBody: string;
  surveyCta: string;
  englishNote: string;
  previous: string;
  next: string;
  finish: string;
  slides: Record<SlideKey, string>;
}

const COPY: Record<AppLanguage, TeaserCopy> = {
  es: {
    badge: 'UN ADELANTO',
    title: 'Un adelanto de lo que viene',
    summary: 'Nodus está llegando al móvil. Esto es un vistazo a la aplicación, todavía sin fecha.',
    eyebrow: 'Nodus en el móvil',
    heading: 'Tu bóveda, en el bolsillo',
    lede: 'Publicas una bóveda desde el escritorio y la lees donde estés: obras, ideas, temas y autores, con su evidencia. La lectura es de solo lectura y lo que escribas en el teléfono se queda en el teléfono.',
    status: 'Todavía no se puede descargar. Estas capturas son de una versión en desarrollo y pueden cambiar.',
    surveyTitle: '¿Te interesaría?',
    surveyBody: 'Dinos si la usarías y qué esperarías de ella. Son dos minutos y ayuda a decidir qué se construye primero.',
    surveyCta: 'Responder la encuesta',
    englishNote: 'Las capturas y la encuesta están solo en inglés.',
    previous: 'Anterior',
    next: 'Siguiente',
    finish: 'Entendido',
    slides: {
      home: 'Inicio de la bóveda',
      library: 'Biblioteca',
      work: 'Ficha de una obra',
      idea: 'Una idea y su evidencia',
      search: 'Búsqueda',
      argument: 'Mapa de argumentos',
      gaps: 'Huecos',
      deepResearch: 'Deep Research',
      model: 'Tu propio modelo',
    },
  },
  en: {
    badge: 'SNEAK PEEK',
    title: 'A tease of what’s coming',
    summary: 'Nodus is coming to mobile. Here is a look at the app, with no date yet.',
    eyebrow: 'Nodus on your phone',
    heading: 'Your vault, in your pocket',
    lede: 'Publish a vault from the desktop and read it anywhere: works, ideas, themes and authors, with the evidence behind them. Reading is read-only, and whatever you write on the phone stays on the phone.',
    status: 'It is not downloadable yet. These captures come from a build in progress and may change.',
    surveyTitle: 'Would you use it?',
    surveyBody: 'Tell us whether you would use it and what you would expect from it. It takes two minutes and it helps decide what gets built first.',
    surveyCta: 'Take the survey',
    englishNote: 'The screenshots and the survey are in English only.',
    previous: 'Back',
    next: 'Next',
    finish: 'Got it',
    slides: {
      home: 'Vault home',
      library: 'Library',
      work: 'A work in detail',
      idea: 'An idea and its evidence',
      search: 'Search',
      argument: 'Argument map',
      gaps: 'Gaps',
      deepResearch: 'Deep Research',
      model: 'Bring your own model',
    },
  },
  fr: {
    badge: 'AVANT-GOÛT',
    title: 'Un avant-goût de ce qui arrive',
    summary: 'Nodus arrive sur mobile. Voici un aperçu de l’application, sans date pour l’instant.',
    eyebrow: 'Nodus sur votre téléphone',
    heading: 'Votre coffre, dans votre poche',
    lede: 'Publiez un coffre depuis le bureau et lisez-le où que vous soyez : œuvres, idées, thèmes et auteurs, avec les preuves qui les soutiennent. La lecture est en lecture seule, et ce que vous écrivez sur le téléphone y reste.',
    status: 'L’application n’est pas encore téléchargeable. Ces captures proviennent d’une version en cours et peuvent changer.',
    surveyTitle: 'Cela vous intéresserait-il ?',
    surveyBody: 'Dites-nous si vous l’utiliseriez et ce que vous en attendriez. Deux minutes suffisent, et cela aide à décider quoi construire en premier.',
    surveyCta: 'Répondre à l’enquête',
    englishNote: 'Les captures et l’enquête sont uniquement en anglais.',
    previous: 'Précédent',
    next: 'Suivant',
    finish: 'Compris',
    slides: {
      home: 'Accueil du coffre',
      library: 'Bibliothèque',
      work: 'Une œuvre en détail',
      idea: 'Une idée et ses preuves',
      search: 'Recherche',
      argument: 'Carte des arguments',
      gaps: 'Lacunes',
      deepResearch: 'Deep Research',
      model: 'Votre propre modèle',
    },
  },
  de: {
    badge: 'VORGESCHMACK',
    title: 'Ein Vorgeschmack auf das, was kommt',
    summary: 'Nodus kommt aufs Handy. Hier ein Blick auf die App, noch ohne Datum.',
    eyebrow: 'Nodus auf dem Handy',
    heading: 'Dein Tresor, in der Hosentasche',
    lede: 'Veröffentliche einen Tresor vom Desktop aus und lies ihn überall: Werke, Ideen, Themen und Autoren, samt der Belege dahinter. Gelesen wird nur lesend, und was du auf dem Handy schreibst, bleibt auf dem Handy.',
    status: 'Herunterladen lässt sie sich noch nicht. Diese Aufnahmen stammen aus einem laufenden Build und können sich ändern.',
    surveyTitle: 'Wäre das etwas für dich?',
    surveyBody: 'Sag uns, ob du sie nutzen würdest und was du von ihr erwartest. Zwei Minuten, und es hilft zu entscheiden, was zuerst gebaut wird.',
    surveyCta: 'An der Umfrage teilnehmen',
    englishNote: 'Die Screenshots und die Umfrage sind nur auf Englisch.',
    previous: 'Zurück',
    next: 'Weiter',
    finish: 'Verstanden',
    slides: {
      home: 'Tresor-Start',
      library: 'Bibliothek',
      work: 'Ein Werk im Detail',
      idea: 'Eine Idee und ihr Beleg',
      search: 'Suche',
      argument: 'Argumentkarte',
      gaps: 'Lücken',
      deepResearch: 'Deep Research',
      model: 'Dein eigenes Modell',
    },
  },
  pt: {
    badge: 'ANTEVISÃO',
    title: 'Uma antevisão do que aí vem',
    summary: 'O Nodus está a chegar ao telemóvel. Isto é um vislumbre da aplicação, ainda sem data.',
    eyebrow: 'O Nodus no telemóvel',
    heading: 'O teu cofre, no bolso',
    lede: 'Publicas um cofre a partir do computador e lê-lo onde estiveres: obras, ideias, temas e autores, com a evidência que os sustenta. A leitura é apenas de leitura, e o que escreveres no telemóvel fica no telemóvel.',
    status: 'Ainda não está disponível para descarregar. Estas capturas vêm de uma versão em curso e podem mudar.',
    surveyTitle: 'Terias interesse?',
    surveyBody: 'Diz-nos se a usarias e o que esperarias dela. São dois minutos e ajuda a decidir o que se constrói primeiro.',
    surveyCta: 'Responder ao inquérito',
    englishNote: 'As capturas e o inquérito estão apenas em inglês.',
    previous: 'Anterior',
    next: 'Seguinte',
    finish: 'Entendido',
    slides: {
      home: 'Início do cofre',
      library: 'Biblioteca',
      work: 'Uma obra em detalhe',
      idea: 'Uma ideia e a sua evidência',
      search: 'Pesquisa',
      argument: 'Mapa de argumentos',
      gaps: 'Lacunas',
      deepResearch: 'Deep Research',
      model: 'O teu próprio modelo',
    },
  },
  'pt-BR': {
    badge: 'PRÉVIA',
    title: 'Uma prévia do que vem por aí',
    summary: 'O Nodus está chegando ao celular. Isto é uma espiada no aplicativo, ainda sem data.',
    eyebrow: 'O Nodus no celular',
    heading: 'Seu cofre, no bolso',
    lede: 'Você publica um cofre no computador e lê onde estiver: obras, ideias, temas e autores, com a evidência por trás deles. A leitura é somente leitura, e o que você escrever no celular fica no celular.',
    status: 'Ainda não dá para baixar. Estas capturas vêm de uma versão em andamento e podem mudar.',
    surveyTitle: 'Você usaria?',
    surveyBody: 'Conte se usaria e o que esperaria dele. São dois minutos e ajuda a decidir o que construir primeiro.',
    surveyCta: 'Responder à pesquisa',
    englishNote: 'As capturas e a pesquisa estão apenas em inglês.',
    previous: 'Anterior',
    next: 'Próximo',
    finish: 'Entendi',
    slides: {
      home: 'Início do cofre',
      library: 'Biblioteca',
      work: 'Uma obra em detalhe',
      idea: 'Uma ideia e sua evidência',
      search: 'Busca',
      argument: 'Mapa de argumentos',
      gaps: 'Lacunas',
      deepResearch: 'Deep Research',
      model: 'Seu próprio modelo',
    },
  },
  it: {
    badge: 'ANTEPRIMA',
    title: 'Un assaggio di quel che arriva',
    summary: 'Nodus sta arrivando sul telefono. Ecco uno sguardo all’app, ancora senza data.',
    eyebrow: 'Nodus sul telefono',
    heading: 'Il tuo deposito, in tasca',
    lede: 'Pubblichi un deposito dal computer e lo leggi ovunque: opere, idee, temi e autori, con le prove che li sostengono. La lettura è di sola lettura, e quello che scrivi sul telefono resta sul telefono.',
    status: 'Non è ancora scaricabile. Queste immagini vengono da una versione in lavorazione e possono cambiare.',
    surveyTitle: 'Ti interesserebbe?',
    surveyBody: 'Dicci se la useresti e che cosa ti aspetteresti. Bastano due minuti e aiuta a decidere che cosa costruire per primo.',
    surveyCta: 'Rispondi al sondaggio',
    englishNote: 'Le immagini e il sondaggio sono solo in inglese.',
    previous: 'Indietro',
    next: 'Avanti',
    finish: 'Ho capito',
    slides: {
      home: 'Home del deposito',
      library: 'Biblioteca',
      work: 'Un’opera in dettaglio',
      idea: 'Un’idea e la sua prova',
      search: 'Ricerca',
      argument: 'Mappa degli argomenti',
      gaps: 'Lacune',
      deepResearch: 'Deep Research',
      model: 'Il tuo modello',
    },
  },
  tr: {
    badge: 'İLK BAKIŞ',
    title: 'Gelecek olanlardan bir tat',
    summary: 'Nodus telefona geliyor. Bu, uygulamaya bir bakış, henüz tarihi yok.',
    eyebrow: 'Telefonunuzda Nodus',
    heading: 'Kasanız, cebinizde',
    lede: 'Masaüstünden bir kasa yayımlayın ve nerede olursanız olun okuyun: eserler, fikirler, temalar ve yazarlar, arkalarındaki kanıtlarla birlikte. Okuma salt okunurdur ve telefonda yazdığınız her şey telefonda kalır.',
    status: 'Henüz indirilemiyor. Bu görüntüler geliştirilmekte olan bir sürümden geliyor ve değişebilir.',
    surveyTitle: 'İlginizi çeker miydi?',
    surveyBody: 'Kullanır mıydınız ve ondan ne beklerdiniz, bize söyleyin. İki dakika sürüyor ve önce neyin yapılacağına karar vermeye yardım ediyor.',
    surveyCta: 'Ankete katılın',
    englishNote: 'Ekran görüntüleri ve anket yalnızca İngilizcedir.',
    previous: 'Geri',
    next: 'İleri',
    finish: 'Anlaşıldı',
    slides: {
      home: 'Kasa ana ekranı',
      library: 'Kütüphane',
      work: 'Bir eser ayrıntısıyla',
      idea: 'Bir fikir ve kanıtı',
      search: 'Arama',
      argument: 'Argüman haritası',
      gaps: 'Boşluklar',
      deepResearch: 'Deep Research',
      model: 'Kendi modeliniz',
    },
  },
};

function shouldPresent(): boolean {
  if (__APP_VERSION__ !== MOBILE_TEASER_RELEASE) return false;
  try { return localStorage.getItem(SEEN_KEY) !== '1'; } catch { return true; }
}

function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage unavailable: it simply shows once more */ }
}

export function MobileTeaserGuide({
  uiLanguage,
  onSettled,
}: {
  uiLanguage: AppLanguage;
  onSettled: () => void;
}) {
  const [eligible] = useState(shouldPresent);
  const [index, setIndex] = useState(0);
  const copy = COPY[uiLanguage] ?? COPY.en;

  // Wraps in both directions: a carousel that dead-ends on the last shot invites the
  // reader to think the modal is stuck rather than finished.
  const step = useCallback((delta: number) => {
    setIndex((value) => (value + delta + SHOTS.length) % SHOTS.length);
  }, []);

  useEffect(() => { if (!eligible) onSettled(); }, [eligible, onSettled]);

  useEffect(() => {
    if (!eligible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [eligible, step]);

  if (!eligible) return null;

  const finish = () => { markSeen(); onSettled(); };
  const shot = SHOTS[index];

  return <motion.div className="toolkit-guide-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .22 }}>
    <motion.section
      className="toolkit-guide-cinema mobile-teaser-guide"
      data-testid="mobile-teaser-guide"
      data-teaser-slide={index}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-teaser-title"
      initial={{ opacity: 0, y: 28, scale: .96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: .46, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <header className="toolkit-guide-hero">
        <div className="toolkit-guide-aurora" aria-hidden="true" />
        <div className="toolkit-guide-hero-copy">
          <div className="toolkit-guide-kicker"><Icon name="sparkles" size={14} /> {copy.badge}</div>
          <h2 id="mobile-teaser-title">{copy.title}</h2>
          <p>{copy.summary}</p>
        </div>
        <div className="toolkit-guide-nodi"><NodiAvatar state="discovering" height={172} /></div>
      </header>

      <div className="toolkit-guide-stage mobile-teaser-stage">
        <div className="mobile-teaser-layout">
          <figure className="mobile-teaser-frame">
            {/*
              Keyed and mounted directly, NOT wrapped in AnimatePresence. With
              `mode="wait"` the incoming shot only mounts once the outgoing one has
              finished leaving, while the caption and the dots below update on the same
              tick as the click — so every slide change opened a window where the caption
              named one screen and the image still showed the previous one. Swapping the
              element outright keeps picture and caption in step, and the fade-in still
              softens the change.
            */}
            <motion.img
              key={shot.key}
              src={shot.src}
              alt={copy.slides[shot.key]}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: .22 }}
              draggable={false}
            />
            <figcaption>{copy.slides[shot.key]}</figcaption>
            <div className="mobile-teaser-controls">
              <button type="button" aria-label={copy.previous} data-testid="mobile-teaser-prev" onClick={() => step(-1)}>
                <Icon name="chevronLeft" size={15} />
              </button>
              <div className="mobile-teaser-dots" role="tablist" aria-label={copy.eyebrow}>
                {SHOTS.map((item, dot) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={dot === index}
                    aria-label={copy.slides[item.key]}
                    className={dot === index ? 'active' : ''}
                    onClick={() => setIndex(dot)}
                  />
                ))}
              </div>
              <button type="button" aria-label={copy.next} data-testid="mobile-teaser-next" onClick={() => step(1)}>
                <Icon name="chevronRight" size={15} />
              </button>
            </div>
          </figure>

          <div className="mobile-teaser-copy">
            <div className="toolkit-guide-eyebrow"><Icon name="phone" size={15} /> {copy.eyebrow}</div>
            <h3>{copy.heading}</h3>
            <p className="toolkit-guide-summary">{copy.lede}</p>
            <div className="toolkit-guide-notice"><Icon name="clock" size={17} /><div>{copy.status}</div></div>
            <div className="mobile-teaser-survey">
              <b>{copy.surveyTitle}</b>
              <small>{copy.surveyBody}</small>
              <button
                type="button"
                className="mobile-teaser-survey-cta"
                data-testid="mobile-teaser-survey"
                onClick={() => void window.nodus.openExternal(MOBILE_TEASER_SURVEY_URL)}
              >
                <Icon name="external" size={14} /> {copy.surveyCta}
              </button>
            </div>
          </div>
        </div>
      </div>

      <footer className="toolkit-guide-footer mobile-teaser-footer">
        <span>{copy.englishNote}</span>
        <button className="primary" data-testid="mobile-teaser-complete" onClick={finish}>
          {copy.finish} <Icon name="check" size={14} />
        </button>
      </footer>
    </motion.section>
  </motion.div>;
}
