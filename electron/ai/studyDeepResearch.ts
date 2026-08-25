import type {
  DeepResearchOutlineSection,
  DeepResearchProgress,
  DeepResearchReport,
  DeepResearchRequest,
  ModelRef,
  PromptLanguage,
  WritingWorkshopDraft,
  WritingWorkshopMatrixRow,
  WritingWorkshopSection,
} from '@shared/types';
import type { DeepResearchApproach } from '@shared/deepResearchApproaches';
import { normalizeDeepResearchApproach } from '@shared/deepResearchApproaches';
import {
  assessDeepResearchReport,
  assessDeepResearchSection,
  qualityPasses,
  shouldAcceptQualityRevision,
  type DeepResearchQualityMode,
  type DeepResearchQualitySource,
} from '@shared/deepResearchQuality';
import type { StudySearchIndexEntry, StudySearchKind } from '@shared/studySearch';
import {
  normalizeStudyDeepResearchAudience,
  type StudyDeepResearchAudience,
} from '@shared/studyDeepResearchAudience';
import { listStudyIdeasForSources } from '../db/studyKnowledgeRepo';
import { completeJson, completeText } from './aiClient';
import { retrieveStudyAssistantEntries } from './studySearch';
import {
  approachRules,
  planApproachRetrieval,
  type ApproachRetrievalPlan,
} from './deepResearchApproaches';
import { assembleContinuousNarrative, DEEP_RESEARCH_NARRATIVE_RULES, MAX_COVERAGE_QUESTIONS } from './deepResearchCore';

export { normalizeStudyDeepResearchAudience };

/** Hard ceiling on a teacher-authored outline; the composer offers far fewer. */
export const MAX_UNIT_SECTIONS = 12;

/**
 * Appended to the planner prompt when the teacher fixed the structure. The code
 * enforces the shape regardless — this only stops the model wasting a turn proposing
 * a different one, and gets the source assignment aligned with the given titles.
 */
const FIXED_OUTLINE_RULE = 'ESTRUCTURA FIJADA POR EL DOCENTE: el campo "fixedSections" define exactamente las partes de la unidad, su número y su orden. Devuelve EXACTAMENTE esas partes, con los mismos id y en el mismo orden. No añadas, elimines ni reordenes ninguna. Cuando una parte trae "title", cópialo literalmente; cuando viene vacío, ponle tú un título. Cuando trae "focus", es una instrucción del docente sobre qué debe tratar esa parte: respétala al asignarle propósito, afirmaciones clave y fuentes.';

/** Appended to the writer prompt for a part the teacher gave an explicit steer for. */
const SECTION_FOCUS_RULE = 'El campo "teacherFocus" es una instrucción del docente sobre lo que esta parte debe tratar. Es vinculante: organiza la parte en torno a ella y no la sustituyas por otro enfoque, aunque las fuentes sugieran uno más amplio.';

interface StudyResearchSource {
  id: string;
  kind: StudySearchKind;
  sourceId: string;
  title: string;
  subtitle: string;
  location: string;
  text: string;
  token: string;
  url: string;
}

interface StudyPlanSection {
  id?: string;
  title?: string;
  purpose?: string;
  keyClaims?: string[];
  sourceIds?: string[];
  /** Unit design only: extracted ideas the planner tied to this part. */
  ideaIds?: string[];
  coverageQuestions?: string[];
}

interface StudyPlan {
  title?: string;
  abstract?: string;
  sections?: StudyPlanSection[];
}

interface StudyFinal {
  title?: string;
  abstract?: string;
  limitations?: string[];
  nextSteps?: string[];
}

interface StudyPromptPack {
  plan: string;
  write: string;
  finalize: string;
  fallbackSection: (index: number) => string;
  references: string;
  limitations: string;
}

/** Every supported Deep Research language has a native study prompt. These are
 * deliberately not translated at runtime: the model receives the pedagogical
 * contract directly in the requested language. */
export const STUDY_DEEP_RESEARCH_PROMPTS: Record<PromptLanguage, StudyPromptPack> = {
  es: {
    plan: 'Eres un profesor experto que planifica un informe de estudio basado exclusivamente en las fuentes locales suministradas. Organiza pocas secciones amplias con una progresión didáctica clara. Incluye prerrequisitos, definiciones, conexiones, ejemplos, errores frecuentes y una síntesis que ayude a comprobar la comprensión. No inventes información ni identificadores. Devuelve solo JSON con {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"]}]}.',
    write: 'Eres un profesor experto que redacta una sección de un informe de estudio usando solo las fuentes proporcionadas. Explica los conceptos complejos paso a paso, define cada término técnico la primera vez, conecta cada idea con sus prerrequisitos y consecuencias, e incluye ejemplos o analogías cuando aclaren el razonamiento. Señala matices, contradicciones y errores frecuentes. La claridad didáctica importa tanto como el rigor. No inventes datos. Cita cada afirmación sustantiva copiando exactamente uno de los enlaces permitidos. Escribe prosa continua en Markdown, con un único encabezado ## y sin microsecciones.',
    finalize: 'Cierra un informe de estudio fundamentado. Devuelve solo JSON con {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. El resumen debe explicar qué aprenderá el alumno; los siguientes pasos deben proponer formas concretas de comprobar y reforzar la comprensión.',
    fallbackSection: (index) => `Desarrollo didáctico ${index}`,
    references: 'Fuentes de estudio',
    limitations: 'Limitaciones',
  },
  en: {
    plan: 'You are an expert teacher planning a study report based exclusively on the supplied local sources. Organize a few broad sections with a clear learning progression. Include prerequisites, definitions, connections, examples, common misconceptions, and a synthesis that helps the learner check understanding. Do not invent information or identifiers. Return JSON only as {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"]}]}.',
    write: 'You are an expert teacher writing one section of a study report using only the supplied sources. Explain difficult concepts step by step, define every technical term on first use, connect each idea to its prerequisites and consequences, and use examples or analogies whenever they clarify the reasoning. Point out nuance, contradictions, and common misconceptions. Pedagogical clarity matters as much as rigor. Do not invent facts. Cite every substantive claim by copying exactly one allowed link. Write continuous Markdown prose with one ## heading and no micro-sections.',
    finalize: 'Conclude a source-grounded study report. Return JSON only as {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. The abstract must explain what the learner will understand; next steps must suggest concrete ways to check and reinforce understanding.',
    fallbackSection: (index) => `Guided development ${index}`,
    references: 'Study sources',
    limitations: 'Limitations',
  },
  fr: {
    plan: 'Tu es un enseignant expert qui planifie un rapport d’étude fondé exclusivement sur les sources locales fournies. Organise peu de grandes sections selon une progression pédagogique claire. Inclus les prérequis, définitions, liens, exemples, erreurs fréquentes et une synthèse permettant de vérifier la compréhension. N’invente aucune information ni aucun identifiant. Renvoie uniquement le JSON {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"]}]}.',
    write: 'Tu es un enseignant expert qui rédige une section d’un rapport d’étude en utilisant uniquement les sources fournies. Explique les concepts difficiles pas à pas, définis chaque terme technique lors de sa première occurrence, relie chaque idée à ses prérequis et à ses conséquences, et emploie des exemples ou analogies lorsqu’ils clarifient le raisonnement. Signale les nuances, contradictions et erreurs fréquentes. La clarté pédagogique compte autant que la rigueur. N’invente aucun fait. Cite chaque affirmation substantielle en copiant exactement un lien autorisé. Écris une prose Markdown continue avec un seul titre ## et sans micro-sections.',
    finalize: 'Conclus un rapport d’étude fondé sur les sources. Renvoie uniquement le JSON {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. Le résumé doit expliquer ce que l’élève comprendra; les étapes suivantes doivent proposer des moyens concrets de vérifier et renforcer la compréhension.',
    fallbackSection: (index) => `Développement guidé ${index}`,
    references: 'Sources d’étude',
    limitations: 'Limites',
  },
  tr: {
    plan: 'Yalnızca sağlanan yerel kaynaklara dayalı bir çalışma raporu planlayan uzman bir öğretmensin. Açık bir öğrenme ilerlemesiyle az sayıda geniş bölüm düzenle. Ön koşulları, tanımları, bağlantıları, örnekleri, yaygın yanılgıları ve öğrencinin anlayışını sınamasına yardım eden bir sentezi dahil et. Bilgi veya kimlik uydurma. Yalnızca şu biçimde JSON döndür: {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"]}]}.',
    write: 'Yalnızca sağlanan kaynakları kullanarak bir çalışma raporunun tek bölümünü yazan uzman bir öğretmensin. Zor kavramları adım adım açıkla, her teknik terimi ilk kullanımında tanımla, fikirleri ön koşulları ve sonuçlarıyla ilişkilendir ve akıl yürütmeyi netleştirdiğinde örnekler veya benzetmeler kullan. Nüansları, çelişkileri ve yaygın yanılgıları belirt. Pedagojik açıklık titizlik kadar önemlidir. Bilgi uydurma. Her önemli iddiayı izin verilen bağlantılardan birini aynen kopyalayarak kaynaklandır. Tek bir ## başlığı olan, mikro bölümler içermeyen kesintisiz Markdown düzyazısı yaz.',
    finalize: 'Kaynaklara dayalı çalışma raporunu tamamla. Yalnızca {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]} biçiminde JSON döndür. Özet öğrencinin neyi anlayacağını açıklamalı; sonraki adımlar anlayışı sınamak ve pekiştirmek için somut yollar önermelidir.',
    fallbackSection: (index) => `Yönlendirilmiş geliştirme ${index}`,
    references: 'Çalışma kaynakları',
    limitations: 'Sınırlılıklar',
  },
  de: {
    plan: 'Du bist ein erfahrener Lehrer, der einen Studienbericht ausschließlich auf Grundlage der bereitgestellten lokalen Quellen plant. Organisiere wenige umfassende Abschnitte mit einer klaren Lernprogression. Füge Voraussetzungen, Definitionen, Verbindungen, Beispiele, häufige Missverständnisse und eine Synthese ein, die dem Lernenden hilft, das eigene Verständnis zu überprüfen. Erfinde keine Informationen oder Kennungen. Gib ausschließlich JSON zurück im Format {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"]}]}.',
    write: 'Du bist ein erfahrener Lehrer, der einen Abschnitt eines Studienberichts ausschließlich anhand der bereitgestellten Quellen verfasst. Erkläre schwierige Konzepte Schritt für Schritt, definiere jeden Fachbegriff bei seiner ersten Verwendung, verknüpfe jede Idee mit ihren Voraussetzungen und Konsequenzen und verwende Beispiele oder Analogien, wenn sie die Argumentation verdeutlichen. Weise auf Nuancen, Widersprüche und häufige Missverständnisse hin. Didaktische Klarheit ist ebenso wichtig wie Genauigkeit. Erfinde keine Fakten. Belege jede inhaltliche Aussage, indem du genau einen zulässigen Link exakt kopierst. Schreibe fortlaufende Markdown-Prosa mit einer einzigen ##-Überschrift und ohne Mikroabschnitte.',
    finalize: 'Schließe einen quellenbasierten Studienbericht ab. Gib ausschließlich JSON zurück im Format {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. Die Zusammenfassung muss erklären, was der Lernende verstehen wird; die nächsten Schritte müssen konkrete Möglichkeiten vorschlagen, das Verständnis zu überprüfen und zu vertiefen.',
    fallbackSection: (index) => `Angeleitete Vertiefung ${index}`,
    references: 'Studienquellen',
    limitations: 'Einschränkungen',
  },
  pt: {
    plan: 'És um professor especialista que está a planear um relatório de estudo baseado exclusivamente nas fontes locais fornecidas. Organiza poucas secções amplas com uma progressão pedagógica clara. Inclui pré-requisitos, definições, ligações, exemplos, erros comuns e uma síntese que ajude o aluno a verificar a sua compreensão. Não inventes informação nem identificadores. Devolve apenas JSON no formato {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"]}]}.',
    write: 'És um professor especialista que está a redigir uma secção de um relatório de estudo utilizando apenas as fontes fornecidas. Explica os conceitos difíceis passo a passo, define cada termo técnico na primeira utilização, liga cada ideia aos seus pré-requisitos e consequências, e usa exemplos ou analogias sempre que esclareçam o raciocínio. Assinala nuances, contradições e erros comuns. A clareza pedagógica é tão importante como o rigor. Não inventes factos. Cita cada afirmação substancial copiando exatamente uma das ligações permitidas. Escreve prosa Markdown contínua, com um único título ## e sem micro-secções.',
    finalize: 'Conclui um relatório de estudo fundamentado nas fontes. Devolve apenas JSON no formato {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. O resumo deve explicar o que o aluno irá compreender; os passos seguintes devem propor formas concretas de verificar e reforçar a compreensão.',
    fallbackSection: (index) => `Desenvolvimento orientado ${index}`,
    references: 'Fontes de estudo',
    limitations: 'Limitações',
  },
  'pt-BR': {
    plan: 'Você é um professor especialista que está planejando um relatório de estudo baseado exclusivamente nas fontes locais fornecidas. Organize poucas seções amplas com uma progressão pedagógica clara. Inclua pré-requisitos, definições, conexões, exemplos, erros comuns e uma síntese que ajude o estudante a verificar sua compreensão. Não invente informações nem identificadores. Retorne apenas JSON no formato {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"]}]}.',
    write: 'Você é um professor especialista que está escrevendo uma seção de um relatório de estudo usando apenas as fontes fornecidas. Explique os conceitos difíceis passo a passo, defina cada termo técnico na primeira vez em que aparecer, conecte cada ideia aos seus pré-requisitos e consequências, e use exemplos ou analogias sempre que esclarecerem o raciocínio. Aponte nuances, contradições e erros comuns. A clareza pedagógica importa tanto quanto o rigor. Não invente fatos. Cite cada afirmação substancial copiando exatamente um dos links permitidos. Escreva uma prosa em Markdown contínua, com um único título ## e sem microsseções.',
    finalize: 'Conclua um relatório de estudo fundamentado nas fontes. Retorne apenas JSON no formato {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. O resumo deve explicar o que o estudante vai compreender; os próximos passos devem propor formas concretas de verificar e reforçar a compreensão.',
    fallbackSection: (index) => `Desenvolvimento guiado ${index}`,
    references: 'Fontes de estudo',
    limitations: 'Limitações',
  },
  it: {
    plan: 'Sei un docente esperto che pianifica una relazione di studio basata esclusivamente sulle fonti locali fornite. Organizza poche sezioni ampie con una progressione didattica chiara. Includi prerequisiti, definizioni, collegamenti, esempi, errori comuni e una sintesi che aiuti chi studia a verificare la propria comprensione. Non inventare informazioni o identificativi. Restituisci soltanto JSON nel formato {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"]}]}.',
    write: 'Sei un docente esperto che redige una sezione di una relazione di studio usando esclusivamente le fonti fornite. Spiega i concetti difficili passo dopo passo, definisci ogni termine tecnico al primo utilizzo, collega ogni idea ai suoi prerequisiti e alle sue conseguenze e usa esempi o analogie quando chiariscono il ragionamento. Segnala sfumature, contraddizioni ed errori comuni. La chiarezza didattica conta quanto il rigore. Non inventare fatti. Cita ogni affermazione sostanziale copiando esattamente uno dei collegamenti consentiti. Scrivi prosa Markdown continua, con un solo titolo ## e senza microsezioni.',
    finalize: 'Concludi una relazione di studio fondata sulle fonti. Restituisci soltanto JSON nel formato {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. La sintesi deve spiegare che cosa comprenderà chi studia; i passi successivi devono proporre modi concreti per verificare e consolidare la comprensione.',
    fallbackSection: (index) => `Sviluppo guidato ${index}`,
    references: 'Fonti di studio',
    limitations: 'Limiti',
  },
};

/**
 * Unit design (teaching vaults). Same machinery as the study report — one local corpus,
 * one citation contract — but the reader is the TEACHER, not the learner: the output is
 * a unit to teach from, so every section has to land as classroom material (what is
 * taught, in what order, with which activity and which evidence) rather than as an
 * explanation addressed to a student. The extracted idea network is handed to the model
 * on top of the sources, because a unit is sequenced by concept dependencies and those
 * are exactly what the graph already knows.
 */
export const TEACHING_UNIT_PROMPTS: Record<PromptLanguage, StudyPromptPack> = {
  es: {
    plan: 'Eres un docente experto que diseña una unidad didáctica a partir exclusivamente de los materiales locales y de la red de ideas ya extraída de ellos. Secuencia las partes según las dependencias entre conceptos: lo que hay que entender antes va antes. Cada parte debe poder darse en clase: qué se enseña, con qué materiales y cómo se comprueba. No inventes información, materiales ni identificadores. Devuelve solo JSON con {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"],"ideaIds":["..."]}]}.',
    write: 'Eres un docente experto que redacta una parte de una unidad didáctica usando solo los materiales proporcionados. Escribes PARA EL DOCENTE que va a dar la clase: expón el contenido con precisión, indica el orden en que conviene presentarlo, señala los prerrequisitos, los errores frecuentes del alumnado y en qué conviene detenerse, y propón al menos una actividad de aula y una forma de comprobar la comprensión, ambas apoyadas en los materiales. No inventes datos. Cita cada afirmación sustantiva copiando exactamente uno de los enlaces permitidos. Escribe prosa continua en Markdown, con un único encabezado ## y sin microsecciones.',
    finalize: 'Cierras una unidad didáctica fundamentada en materiales locales. Devuelve solo JSON con {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. El resumen debe decir qué aprenderá el alumnado y cómo se articula la unidad; las limitaciones deben señalar con honestidad qué no cubren los materiales disponibles; los siguientes pasos deben proponer evaluación, refuerzo o ampliación concretos.',
    fallbackSection: (index) => `Parte ${index} de la unidad`,
    references: 'Materiales de la unidad',
    limitations: 'Limitaciones y ajustes',
  },
  en: {
    plan: 'You are an expert teacher designing a teaching unit exclusively from the supplied local materials and the idea network already extracted from them. Sequence the parts by concept dependency: what must be understood first comes first. Every part must be teachable: what is taught, with which materials, and how it is checked. Do not invent information, materials or identifiers. Return JSON only as {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"],"ideaIds":["..."]}]}.',
    write: 'You are an expert teacher writing one part of a teaching unit using only the supplied materials. You write FOR THE TEACHER who will run the lesson: set out the content precisely, say in what order to present it, name the prerequisites, the misconceptions students usually bring and where to slow down, and propose at least one classroom activity and one way to check understanding, both grounded in the materials. Do not invent facts. Cite every substantive claim by copying exactly one allowed link. Write continuous Markdown prose with one ## heading and no micro-sections.',
    finalize: 'Conclude a teaching unit grounded in local materials. Return JSON only as {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. The abstract must say what the students will learn and how the unit holds together; the limitations must state honestly what the available materials do not cover; the next steps must propose concrete assessment, reinforcement or extension.',
    fallbackSection: (index) => `Unit part ${index}`,
    references: 'Unit materials',
    limitations: 'Limitations and adjustments',
  },
  fr: {
    plan: 'Tu es un enseignant expert qui conçoit une unité didactique exclusivement à partir des supports locaux fournis et du réseau d’idées déjà extrait de ceux-ci. Ordonne les parties selon les dépendances entre concepts: ce qu’il faut comprendre d’abord vient d’abord. Chaque partie doit pouvoir être enseignée: ce qui est enseigné, avec quels supports et comment on le vérifie. N’invente ni information, ni support, ni identifiant. Renvoie uniquement le JSON {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"],"ideaIds":["..."]}]}.',
    write: 'Tu es un enseignant expert qui rédige une partie d’une unité didactique en utilisant uniquement les supports fournis. Tu écris POUR L’ENSEIGNANT qui fera cours: expose le contenu avec précision, indique dans quel ordre le présenter, nomme les prérequis, les erreurs fréquentes des élèves et les points sur lesquels s’attarder, et propose au moins une activité de classe et un moyen de vérifier la compréhension, l’un et l’autre appuyés sur les supports. N’invente aucun fait. Cite chaque affirmation substantielle en copiant exactement un lien autorisé. Écris une prose Markdown continue avec un seul titre ## et sans micro-sections.',
    finalize: 'Conclus une unité didactique fondée sur des supports locaux. Renvoie uniquement le JSON {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. Le résumé doit dire ce que les élèves apprendront et comment l’unité s’articule; les limites doivent indiquer honnêtement ce que les supports ne couvrent pas; les étapes suivantes doivent proposer une évaluation, un renforcement ou un approfondissement concrets.',
    fallbackSection: (index) => `Partie ${index} de l’unité`,
    references: 'Supports de l’unité',
    limitations: 'Limites et ajustements',
  },
  tr: {
    plan: 'Yalnızca sağlanan yerel materyallerden ve bunlardan çıkarılmış fikir ağından bir öğretim ünitesi tasarlayan uzman bir öğretmensin. Bölümleri kavram bağımlılıklarına göre sırala: önce anlaşılması gereken önce gelir. Her bölüm derste işlenebilir olmalı: ne öğretilir, hangi materyalle ve nasıl ölçülür. Bilgi, materyal veya kimlik uydurma. Yalnızca şu biçimde JSON döndür: {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"],"ideaIds":["..."]}]}.',
    write: 'Yalnızca sağlanan materyalleri kullanarak bir öğretim ünitesinin tek bölümünü yazan uzman bir öğretmensin. DERSİ İŞLEYECEK ÖĞRETMEN İÇİN yazıyorsun: içeriği tam olarak ortaya koy, hangi sırayla sunulacağını belirt, ön koşulları, öğrencilerin sıkça getirdiği yanılgıları ve nerede yavaşlanacağını adlandır; materyallere dayalı en az bir sınıf etkinliği ve anlamayı ölçmenin bir yolunu öner. Bilgi uydurma. Her önemli iddiayı izin verilen bağlantılardan birini aynen kopyalayarak kaynaklandır. Tek bir ## başlığı olan, mikro bölümler içermeyen kesintisiz Markdown düzyazısı yaz.',
    finalize: 'Yerel materyallere dayalı bir öğretim ünitesini tamamla. Yalnızca {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]} biçiminde JSON döndür. Özet öğrencilerin ne öğreneceğini ve ünitenin nasıl kurulduğunu söylemeli; sınırlılıklar mevcut materyallerin neyi kapsamadığını dürüstçe belirtmeli; sonraki adımlar somut ölçme, pekiştirme veya derinleştirme önermelidir.',
    fallbackSection: (index) => `Ünitenin ${index}. bölümü`,
    references: 'Ünite materyalleri',
    limitations: 'Sınırlılıklar ve düzenlemeler',
  },
  de: {
    plan: 'Du bist eine erfahrene Lehrkraft, die eine Unterrichtseinheit ausschließlich aus den bereitgestellten lokalen Materialien und dem bereits daraus extrahierten Ideennetz entwirft. Ordne die Teile nach den Abhängigkeiten zwischen den Konzepten: Was zuerst verstanden werden muss, kommt zuerst. Jeder Teil muss unterrichtbar sein: was gelehrt wird, mit welchem Material und wie es überprüft wird. Erfinde keine Informationen, Materialien oder Kennungen. Gib ausschließlich JSON zurück im Format {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"],"ideaIds":["..."]}]}.',
    write: 'Du bist eine erfahrene Lehrkraft, die einen Teil einer Unterrichtseinheit ausschließlich anhand der bereitgestellten Materialien verfasst. Du schreibst FÜR DIE LEHRKRAFT, die den Unterricht hält: stelle den Inhalt präzise dar, gib an, in welcher Reihenfolge er zu präsentieren ist, benenne die Voraussetzungen, die üblichen Fehlvorstellungen der Lernenden und die Stellen, an denen man verweilen sollte, und schlage mindestens eine Unterrichtsaktivität und eine Möglichkeit zur Überprüfung des Verständnisses vor, beide auf die Materialien gestützt. Erfinde keine Fakten. Belege jede inhaltliche Aussage, indem du genau einen zulässigen Link exakt kopierst. Schreibe fortlaufende Markdown-Prosa mit einer einzigen ##-Überschrift und ohne Mikroabschnitte.',
    finalize: 'Schließe eine auf lokalen Materialien beruhende Unterrichtseinheit ab. Gib ausschließlich JSON zurück im Format {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. Die Zusammenfassung muss sagen, was die Lernenden lernen werden und wie die Einheit aufgebaut ist; die Einschränkungen müssen ehrlich benennen, was die vorhandenen Materialien nicht abdecken; die nächsten Schritte müssen konkrete Leistungsüberprüfung, Festigung oder Vertiefung vorschlagen.',
    fallbackSection: (index) => `Teil ${index} der Einheit`,
    references: 'Materialien der Einheit',
    limitations: 'Einschränkungen und Anpassungen',
  },
  pt: {
    plan: 'És um docente especialista que concebe uma unidade didática exclusivamente a partir dos materiais locais fornecidos e da rede de ideias já extraída deles. Sequencia as partes segundo as dependências entre conceitos: o que tem de ser compreendido primeiro vem primeiro. Cada parte tem de poder ser dada em aula: o que se ensina, com que materiais e como se verifica. Não inventes informação, materiais nem identificadores. Devolve apenas JSON no formato {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"],"ideaIds":["..."]}]}.',
    write: 'És um docente especialista que redige uma parte de uma unidade didática utilizando apenas os materiais fornecidos. Escreves PARA O DOCENTE que vai dar a aula: expõe o conteúdo com precisão, indica por que ordem convém apresentá-lo, nomeia os pré-requisitos, os erros frequentes dos alunos e onde convém demorar-se, e propõe pelo menos uma atividade de aula e uma forma de verificar a compreensão, ambas apoiadas nos materiais. Não inventes factos. Cita cada afirmação substancial copiando exatamente uma das ligações permitidas. Escreve prosa Markdown contínua, com um único título ## e sem micro-secções.',
    finalize: 'Conclui uma unidade didática fundamentada em materiais locais. Devolve apenas JSON no formato {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. O resumo deve dizer o que os alunos vão aprender e como a unidade se articula; as limitações devem indicar honestamente o que os materiais disponíveis não cobrem; os passos seguintes devem propor avaliação, reforço ou ampliação concretos.',
    fallbackSection: (index) => `Parte ${index} da unidade`,
    references: 'Materiais da unidade',
    limitations: 'Limitações e ajustes',
  },
  'pt-BR': {
    plan: 'Você é um docente especialista que projeta uma unidade didática exclusivamente a partir dos materiais locais fornecidos e da rede de ideias já extraída deles. Sequencie as partes segundo as dependências entre conceitos: o que precisa ser compreendido antes vem antes. Cada parte precisa ser aplicável em aula: o que se ensina, com quais materiais e como se verifica. Não invente informações, materiais nem identificadores. Retorne apenas JSON no formato {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"],"ideaIds":["..."]}]}.',
    write: 'Você é um docente especialista que escreve uma parte de uma unidade didática usando apenas os materiais fornecidos. Você escreve PARA O DOCENTE que vai dar a aula: apresente o conteúdo com precisão, indique em que ordem convém apresentá-lo, nomeie os pré-requisitos, os erros frequentes dos alunos e onde convém se deter, e proponha ao menos uma atividade de sala e uma forma de verificar a compreensão, ambas apoiadas nos materiais. Não invente fatos. Cite cada afirmação substancial copiando exatamente um dos links permitidos. Escreva prosa em Markdown contínua, com um único título ## e sem microsseções.',
    finalize: 'Conclua uma unidade didática fundamentada em materiais locais. Retorne apenas JSON no formato {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. O resumo deve dizer o que os alunos vão aprender e como a unidade se articula; as limitações devem indicar honestamente o que os materiais disponíveis não cobrem; os próximos passos devem propor avaliação, reforço ou ampliação concretos.',
    fallbackSection: (index) => `Parte ${index} da unidade`,
    references: 'Materiais da unidade',
    limitations: 'Limitações e ajustes',
  },
  it: {
    plan: 'Sei un docente esperto che progetta un’unità didattica esclusivamente a partire dai materiali locali forniti e dalla rete di idee già estratta da essi. Ordina le parti secondo le dipendenze fra i concetti: ciò che deve essere compreso prima viene prima. Ogni parte deve poter essere svolta in classe: che cosa si insegna, con quali materiali e come se ne verifica l’apprendimento. Non inventare informazioni, materiali o identificativi. Restituisci soltanto JSON nel formato {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"],"ideaIds":["..."]}]}.',
    write: 'Sei un docente esperto che redige una parte di un’unità didattica usando esclusivamente i materiali forniti. Scrivi PER IL DOCENTE che terrà la lezione: esponi il contenuto con precisione, indica l’ordine in cui conviene presentarlo, segnala i prerequisiti, gli errori comuni degli studenti e i punti sui quali soffermarsi; proponi almeno un’attività in classe e un modo per verificare la comprensione, entrambi fondati sui materiali. Non inventare fatti. Cita ogni affermazione sostanziale copiando esattamente uno dei collegamenti consentiti. Scrivi prosa Markdown continua, con un solo titolo ## e senza microsezioni.',
    finalize: 'Concludi un’unità didattica fondata sui materiali locali. Restituisci soltanto JSON nel formato {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. La sintesi deve indicare che cosa impareranno gli studenti e come si articola l’unità; i limiti devono dichiarare con onestà ciò che i materiali disponibili non coprono; i passi successivi devono proporre verifiche, consolidamento o approfondimento concreti.',
    fallbackSection: (index) => `Parte ${index} dell’unità`,
    references: 'Materiali dell’unità',
    limitations: 'Limiti e adattamenti',
  },
};

/**
 * A teaching unit can now produce either a teacher-facing plan or student-facing
 * notes. Both prompt packs are already native in every supported output language;
 * choosing here avoids mixing contradictory teacher and learner instructions.
 */
export function studyDeepResearchPromptPack(
  language: PromptLanguage,
  audience: StudyDeepResearchAudience,
  unitMode: boolean,
): StudyPromptPack {
  return unitMode && audience === 'teacher'
    ? TEACHING_UNIT_PROMPTS[language]
    : STUDY_DEEP_RESEARCH_PROMPTS[language];
}

function isPlan(value: unknown): value is StudyPlan {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as StudyPlan).sections));
}

function isFinal(value: unknown): value is StudyFinal {
  return Boolean(value && typeof value === 'object');
}

function escapeLabel(value: string): string {
  return value.replaceAll('[', '').replaceAll(']', '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Fuente';
}

function locationLabel(entry: StudySearchIndexEntry): string {
  if (entry.location.pageNumber) return `p. ${entry.location.pageNumber}`;
  if (entry.location.slideNumber) return `diap. ${entry.location.slideNumber}`;
  if (entry.location.timestampSeconds != null) {
    const minutes = Math.floor(entry.location.timestampSeconds / 60);
    const seconds = Math.floor(entry.location.timestampSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }
  return entry.subtitle;
}

function sourceUrl(entry: StudySearchIndexEntry): string {
  if (entry.kind === 'material') return `nodus://study/material/${encodeURIComponent(entry.location.materialId || entry.sourceId)}`;
  if (entry.kind === 'document') return `nodus://study/doc/${encodeURIComponent(entry.location.documentId || entry.sourceId)}`;
  return `nodus://study/recording/${encodeURIComponent(entry.location.recordingId || entry.sourceId)}${entry.location.timestampSeconds != null ? `?t=${Math.max(0, Math.floor(entry.location.timestampSeconds))}` : ''}`;
}

function buildSources(entries: StudySearchIndexEntry[], limit = 18): StudyResearchSource[] {
  const grouped = new Map<string, StudySearchIndexEntry[]>();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.sourceId}`;
    const bucket = grouped.get(key) ?? [];
    if (bucket.length < 4) bucket.push(entry);
    grouped.set(key, bucket);
  }
  return [...grouped.values()].slice(0, limit).map((chunks, index) => {
    const entry = chunks[0];
    const location = chunks.map(locationLabel).filter(Boolean).filter((value, at, all) => all.indexOf(value) === at).slice(0, 4).join(' · ');
    const url = sourceUrl(entry);
    const label = escapeLabel(`${entry.title}${location ? `, ${location}` : ''}`);
    return {
      id: `S${index + 1}`,
      kind: entry.kind,
      sourceId: entry.sourceId,
      title: entry.title,
      subtitle: entry.subtitle,
      location,
      text: chunks.map((chunk) => chunk.text.trim()).filter(Boolean).join('\n\n').slice(0, 7_000),
      token: `[${label}](${url})`,
      url,
    };
  });
}

function mergeStudySources(ordinary: StudyResearchSource[], enriched: StudyResearchSource[]): StudyResearchSource[] {
  const seen = new Set<string>();
  return [...ordinary, ...enriched]
    .filter((source) => {
      const key = `${source.kind}:${source.sourceId}`;
      return !seen.has(key) && Boolean(seen.add(key));
    })
    .slice(0, 24)
    .map((source, index) => ({ ...source, id: `S${index + 1}` }));
}

interface StudyApproachContext {
  approach: DeepResearchApproach;
  retrieval: ApproachRetrievalPlan;
  rules: ReturnType<typeof approachRules>;
}

function studyEntryKey(entry: StudySearchIndexEntry): string {
  return `${entry.kind}:${entry.sourceId}:${entry.location.pageNumber ?? ''}:${entry.location.slideNumber ?? ''}:${entry.location.timestampSeconds ?? ''}:${entry.text.slice(0, 120)}`;
}

/** Ordinary hits stay in the union. Specialized ordering only determines which
 * sources reach the existing compact 18-source prompt window. */
export function mergeStudyApproachEntries(
  ordinary: StudySearchIndexEntry[],
  supplemental: StudySearchIndexEntry[],
  approach: DeepResearchApproach,
): StudySearchIndexEntry[] {
  const seen = new Set<string>();
  // The ordinary sources are added back separately and in full by mergeStudySources.
  // Put genuinely supplemental hits first here so the enriched window cannot be
  // consumed by a second copy of the ordinary ranking.
  const ordinaryKeys = new Set(ordinary.map(studyEntryKey));
  const merged = [
    ...supplemental.filter((entry) => !ordinaryKeys.has(studyEntryKey(entry))),
    ...ordinary,
  ].filter((entry) => {
    const key = studyEntryKey(entry);
    return !seen.has(key) && Boolean(seen.add(key));
  });
  if (approach === 'chronological') {
    const dated = (entry: StudySearchIndexEntry) => /\b(?:1[5-9]|20)\d{2}\b/.test(`${entry.title} ${entry.subtitle} ${entry.text}`) ? 1 : 0;
    return [...merged].sort((a, b) => dated(b) - dated(a));
  }
  if (approach === 'conceptual') {
    const conceptual = (entry: StudySearchIndexEntry) => /\b(?:concept|defin|framework|marco|teor|construct|modelo)\w*/i.test(`${entry.title} ${entry.text}`) ? 1 : 0;
    return [...merged].sort((a, b) => conceptual(b) - conceptual(a));
  }
  if (approach === 'scholarly_debate') {
    const contested = (entry: StudySearchIndexEntry) => /\b(?:debate|disagree|contrad|controvers|discusi|conflict)\w*/i.test(`${entry.title} ${entry.text}`) ? 1 : 0;
    return [...merged].sort((a, b) => contested(b) - contested(a));
  }
  if (approach === 'literature_review' || approach === 'comparative') {
    const buckets = new Map<string, StudySearchIndexEntry[]>();
    for (const entry of merged) {
      const key = `${entry.kind}:${entry.sourceId}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(entry);
      buckets.set(key, bucket);
    }
    const balanced: StudySearchIndexEntry[] = [];
    while (buckets.size) {
      for (const [key, bucket] of [...buckets]) {
        const next = bucket.shift();
        if (next) balanced.push(next);
        if (!bucket.length) buckets.delete(key);
      }
    }
    return balanced;
  }
  return merged;
}

/**
 * The teacher's outline, cleaned. Blank slots survive on purpose — the teacher chose
 * how many parts the unit has, and only named the ones they had an opinion about.
 * Returns an empty array when there is nothing to honour, which is the signal the
 * model designs the structure itself.
 */
export function normalizeUnitOutline(raw: DeepResearchOutlineSection[] | undefined): DeepResearchOutlineSection[] {
  if (!Array.isArray(raw)) return [];
  const slots = raw.slice(0, MAX_UNIT_SECTIONS).map((slot) => ({
    title: typeof slot?.title === 'string' ? slot.title.trim().slice(0, 160) : '',
    focus: typeof slot?.focus === 'string' ? slot.focus.trim().slice(0, 600) : '',
  }));
  return slots.length ? slots : [];
}

/** Pure final presentation seam shared by Study and Teaching. Internal parts remain
 * available to retrieval and quality checks; `single` only flattens their headings. */
export function assembleStudyDraftBody(input: {
  written: string[];
  citedSourceTokens: string[];
  limitations: string[];
  referencesLabel: string;
  limitationsLabel: string;
  abstract?: string;
  structure: DeepResearchRequest['sectionLimit'];
}): string {
  if (input.structure === 'single') {
    return assembleContinuousNarrative(
      input.written,
      input.citedSourceTokens,
      input.limitations,
      input.referencesLabel,
      input.limitationsLabel,
      'Sin fuentes citadas',
      input.abstract,
    );
  }
  return [
    ...input.written,
    input.limitations.length ? `## ${input.limitationsLabel}\n\n${input.limitations.map((item) => `- ${item}`).join('\n')}` : '',
    `## ${input.referencesLabel}\n\n${input.citedSourceTokens.map((source) => `- ${source}`).join('\n')}`,
  ].filter(Boolean).join('\n\n');
}

function sectionCount(request: DeepResearchRequest, sourceCount: number, ideaCount: number, coverageCount: number): number {
  // A fixed outline wins over every heuristic: the teacher asked for exactly this many
  // parts, and quietly rounding it up to the three-section floor would deliver a unit
  // that does not match the structure they typed.
  const outline = normalizeUnitOutline(request.outline);
  if (outline.length) return outline.length;
  if (typeof request.sectionLimit === 'number' && Number.isFinite(request.sectionLimit) && request.sectionLimit > 0) {
    return Math.max(1, Math.round(request.sectionLimit));
  }
  // The structure is determined by independent evidence/concept clusters, not by
  // a desired page or word count. A sparse corpus stays compact; a richer graph can
  // justify more distinct explanatory units.
  return Math.max(3, Math.ceil(sourceCount / 4), Math.ceil(ideaCount / 5), Math.ceil(coverageCount / 3));
}

export interface ResolvedStudySection {
  id: string;
  title: string;
  purpose: string;
  /** The teacher's steer for this part. Empty unless they typed one. */
  focus: string;
  keyClaims: string[];
  coverageQuestions: string[];
  sourceIds: string[];
  ideaIds: string[];
}

/**
 * Turn whatever the planner returned into exactly `count` writable sections.
 *
 * Kept pure and exported so the contract that matters — a teacher-authored outline is
 * reproduced slot for slot, whatever the model answers — is testable without a model.
 * The planner is treated as a suggestion for everything except length and given titles.
 */
export function resolveStudySections(input: {
  planned: StudyPlanSection[];
  outline?: DeepResearchOutlineSection[];
  count: number;
  fallbackTitle: (index: number) => string;
  validSourceIds: Set<string>;
  validIdeaIds?: Set<string>;
  fallbackSourceIds: string[][];
  coverageQuestions?: string[];
}): ResolvedStudySection[] {
  const outline = normalizeUnitOutline(input.outline);
  const count = outline.length || Math.max(1, input.count);
  const ideaIdsAllowed = input.validIdeaIds ?? new Set<string>();
  const strings = (value: unknown, allowed?: Set<string>, limit = 8): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && (!allowed || allowed.has(item))).slice(0, limit)
      : [];

  const validCoverage = new Set((input.coverageQuestions ?? []).filter((question) => question.trim().length > 0));
  const resolved = Array.from({ length: count }, (_unused, index) => {
    const planned = input.planned[index] ?? {};
    const slot = outline[index];
    const sourceIds = strings(planned.sourceIds, input.validSourceIds, 12);
    return {
      id: planned.id?.trim() || `s${index + 1}`,
      title: slot?.title || planned.title?.trim() || input.fallbackTitle(index + 1),
      purpose: planned.purpose?.trim() || '',
      focus: slot?.focus ?? '',
      keyClaims: strings(planned.keyClaims),
      coverageQuestions: strings(planned.coverageQuestions, validCoverage, MAX_COVERAGE_QUESTIONS),
      sourceIds: sourceIds.length ? sourceIds : (input.fallbackSourceIds[index] ?? []),
      ideaIds: strings(planned.ideaIds, ideaIdsAllowed, 12),
    };
  });
  assignStudyCoverage(resolved, [...validCoverage]);
  return resolved;
}

function assignStudyCoverage(sections: ResolvedStudySection[], questions: string[]): void {
  const assigned = new Set(sections.flatMap((section) => section.coverageQuestions));
  for (const question of questions) {
    if (assigned.has(question) || !sections.length) continue;
    const query = studyTerms(question);
    const ranked = sections.map((section, index) => {
      const target = studyTerms(`${section.title} ${section.focus} ${section.purpose} ${section.keyClaims.join(' ')}`);
      const overlap = [...query].filter((term) => target.has(term)).length / Math.max(1, query.size);
      return { section, index, score: overlap - section.coverageQuestions.length * 0.01 };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    ranked[0].section.coverageQuestions.push(question);
    assigned.add(question);
  }
}

function studyTerms(text: string): Set<string> {
  return new Set(text.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 3));
}

function normalizeSectionMarkdown(raw: string, title: string, sources: StudyResearchSource[]): string {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const byUrl = new Map(sources.map((source) => [source.url, source]));
  let markdown = raw.trim()
    .replace(/\[(S\d+)\](?!\()/gi, (_match, id: string) => byId.get(id.toUpperCase())?.token ?? '')
    .replace(/\[([^\]]*)\]\((nodus:\/\/study\/[^)]+)\)/g, (_match, _label: string, url: string) => byUrl.get(url)?.token ?? '')
    .replace(/^#{1,6}\s+[^\n]+\n*/u, '')
    .replace(/\n{1,2}#{1,6}\s+([^\n]+)\n*/gu, (_match, label: string) => `\n\n${label.replace(/[.:;—-]+$/u, '')}. `)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (sources.length && !/nodus:\/\/study\//.test(markdown)) markdown = `${markdown}\n\n${sources[0].token}`;
  return `## ${title}\n\n${markdown}`.trim();
}

function studyQualitySources(sources: StudyResearchSource[]): DeepResearchQualitySource[] {
  return sources.map((source) => ({
    citation: source.url,
    sourceId: `${source.kind}:${source.sourceId}`,
    evidence: 'document',
  }));
}

async function reviseStudySection(input: {
  markdown: string;
  objective: string;
  language: PromptLanguage;
  audience: string;
  teacherPlan: boolean;
  section: ResolvedStudySection;
  sectionSources: StudyResearchSource[];
  quality: ReturnType<typeof assessDeepResearchSection>;
  model: ModelRef | null;
}): Promise<string> {
  const system = [
    input.teacherPlan
      ? 'Eres el editor pedagógico final de una parte de una unidad didáctica profesional.'
      : 'Eres el editor pedagógico final de un informe de estudio riguroso.',
    'Reescribe el borrador para corregir exclusivamente los problemas medidos que se indican.',
    'Conserva la extensión, el idioma, la audiencia y el propósito. Usa solo los extractos permitidos y copia sus enlaces exactos. No inventes hechos, ejemplos atribuidos ni materiales.',
    'Mejora la progresión conceptual, la explicación de mecanismos, el contraste entre fuentes, los matices y la conexión explícita con el objetivo.',
    input.teacherPlan
      ? 'Conserva las actividades y comprobaciones de comprensión, pero asegúrate de que se derivan de los materiales y de que son realizables.'
      : 'Los ejemplos o analogías deben distinguirse con claridad de los hechos documentados y no sustituir la evidencia.',
    'No acumules citas para elevar artificialmente la densidad. Cada párrafo sustantivo debe quedar respaldado y, cuando haya tres o más materiales, al menos tres párrafos deben poner dos fuentes en diálogo explícito; con dos materiales, hazlo en al menos dos párrafos. Explica la relación, no juntes enlaces.',
    ...DEEP_RESEARCH_NARRATIVE_RULES,
    'Mantén un único encabezado ##, sin microsecciones ni listas salvo necesidad pedagógica estricta. Devuelve solo el Markdown revisado.',
  ].join('\n');
  return completeText({
    system,
    user: JSON.stringify({
      objective: input.objective,
      language: input.language,
      audience: input.audience,
      section: {
        title: input.section.title,
        purpose: input.section.purpose,
        focus: input.section.focus,
        keyClaims: input.section.keyClaims,
        coverageQuestions: input.section.coverageQuestions,
      },
      detectedProblems: input.quality.issues,
      metricsBefore: input.quality.metrics,
      draft: input.markdown,
      allowedSources: input.sectionSources.map((source) => ({
        id: source.id,
        exactCitation: source.token,
        title: source.title,
        location: source.location,
        extract: source.text,
      })),
    }, null, 2),
    temperature: 0.12,
    maxTokens: 5_600,
  }, input.model);
}

export async function generateStudyDeepResearchReport(
  request: DeepResearchRequest,
  model: ModelRef | null,
  onProgress?: (progress: DeepResearchProgress) => void,
  signal?: AbortSignal,
): Promise<DeepResearchReport> {
  const emit = (progress: DeepResearchProgress) => {
    signal?.throwIfAborted();
    try { onProgress?.(progress); } catch { /* progress is best-effort */ }
  };
  const language = request.language ?? 'es';
  const unitMode = Boolean(request.unitMode);
  const approach = normalizeDeepResearchApproach(request.approach);
  // Existing study reports remain student-facing, while existing teaching-unit jobs
  // retain their historical teacher-plan behaviour.
  const audience = normalizeStudyDeepResearchAudience(
    request.audience,
    unitMode ? 'teacher' : 'students',
  );
  const teacherPlan = unitMode && audience === 'teacher';
  const prompts = studyDeepResearchPromptPack(language, audience, unitMode);
  emit({ phase: 'snapshot', message: unitMode ? 'Recuperando materiales, apuntes y transcripciones de clase…' : 'Recuperando apuntes, materiales y transcripciones relevantes…' });
  const ordinaryRetrieved = await retrieveStudyAssistantEntries(request.objective, { kinds: ['material', 'document', 'transcript'] }, [], 48);
  let approachContext: StudyApproachContext | null = null;
  let retrieved = ordinaryRetrieved;
  if (approach !== 'general') {
    const retrieval = await planApproachRetrieval({
      approach,
      variant: unitMode ? 'unit' : 'study',
      objective: request.objective,
      language,
      model,
      corpusPreview: ordinaryRetrieved.slice(0, 36).map((entry) => ({
        kind: entry.kind,
        title: entry.title,
        subtitle: entry.subtitle,
        text: entry.text.slice(0, 500),
        location: entry.location,
      })),
    });
    const supplemental = (await Promise.all(
      retrieval.probes.slice(0, 6).map((probe) => retrieveStudyAssistantEntries(
        probe,
        { kinds: ['material', 'document', 'transcript'] },
        [],
        24,
      )),
    )).flat();
    retrieved = mergeStudyApproachEntries(ordinaryRetrieved, supplemental, approach);
    approachContext = {
      approach,
      retrieval,
      rules: approachRules(approach, unitMode ? 'unit' : 'study'),
    };
  }
  const ordinarySources = buildSources(ordinaryRetrieved);
  const sources = approach === 'general'
    ? ordinarySources
    : mergeStudySources(ordinarySources, buildSources(retrieved, 24));
  if (!sources.length) {
    throw new Error(unitMode
      ? 'No hay contenido indexado suficiente en los materiales de clase para diseñar la unidad.'
      : 'No hay contenido indexado suficiente en los materiales de estudio para generar el informe.');
  }
  // A unit is sequenced by concept dependencies. Specialized Study approaches also
  // need those relationships for debates, comparisons and conceptual dependencies;
  // General Study deliberately keeps its historical text-only path.
  const knowledge = unitMode || approach !== 'general'
    ? listStudyIdeasForSources(sources.map((source) => `${source.kind}:${source.sourceId}`))
    : { ideas: [], connections: [] };
  const ideaLabels = new Map(knowledge.ideas.map((idea) => [idea.id, idea.label]));
  const ideaPayload = knowledge.ideas.map((idea) => ({ id: idea.id, type: idea.type, label: idea.label, statement: idea.statement }));
  const relationPayload = knowledge.connections
    .map((edge) => ({ from: ideaLabels.get(edge.fromId), to: ideaLabels.get(edge.toId), type: edge.type, basis: edge.basis }))
    .filter((edge) => edge.from && edge.to);
  const requestedOutline = normalizeUnitOutline(request.outline);
  const count = sectionCount(request, sources.length, knowledge.ideas.length, request.coverageQuestions?.length ?? 0);
  emit({
    phase: 'planning',
    message: requestedOutline.length
      ? `Ajustando el esquema indicado (${count} partes) a los materiales…`
      : teacherPlan
        ? `Diseñando la unidad en ${count} partes…`
        : unitMode
          ? `Preparando apuntes para el alumnado en ${count} partes…`
          : `Diseñando una explicación didáctica en ${count} secciones…`,
  });
  const sourcePayload = sources.map(({ id, kind, title, subtitle, location, text }) => ({ id, kind, title, subtitle, location, extract: text }));
  const plan = await completeJson<StudyPlan>({
    // The teacher's fixed structure is deliberately last: no approach instruction
    // can replace, reorder or ignore it.
    system: [
      prompts.plan,
      'CALIDAD DE FUENTES: asigna a cada parte de desarrollo al menos tres materiales distintos cuando existan y sean pertinentes. Evita que varias partes dependan siempre del mismo material. La diversidad nunca justifica incluir una fuente marginal.',
      'Cada afirmación clave debe poder demostrarse con los extractos asignados. Si los materiales no cubren una parte del objetivo, conviértelo en un límite explícito y no en una afirmación especulativa.',
      'COBERTURA OBLIGATORIA: asigna cada elemento de `coverageQuestions` al menos a una parte copiándolo literalmente en el campo `coverageQuestions` de esa parte. No omitas una pregunta difícil y no inventes una respuesta si las fuentes no bastan.',
      ...(approachContext?.rules.planner ?? []),
      ...(requestedOutline.length ? [FIXED_OUTLINE_RULE] : []),
    ].join('\n'),
    user: JSON.stringify({
      objective: request.objective,
      coverageQuestions: request.coverageQuestions ?? [],
      audience,
      language,
      sectionCount: count,
      ...(requestedOutline.length
        ? { fixedSections: requestedOutline.map((slot, index) => ({ id: `s${index + 1}`, position: index + 1, title: slot.title || null, focus: slot.focus || null })) }
        : {}),
      ...(ideaPayload.length ? { extractedIdeas: ideaPayload, ideaRelations: relationPayload } : {}),
      sources: sourcePayload,
      ...(approachContext ? { researchApproach: approachContext.approach, retrievalPlan: approachContext.retrieval } : {}),
    }, null, 2),
    temperature: 0.18,
    maxTokens: 4_000,
  }, isPlan, model);
  // Round-robin share-out, used for any section the planner left without sources. With
  // fewer sources than sections a slice comes out empty, so those fall back to the top
  // three rather than being written with nothing to cite.
  const topSourceIds = sources.slice(0, 3).map((source) => source.id);
  const fallbackSourceIds = Array.from({ length: count }, (_unused, index) => {
    const share = sources.filter((_source, sourceIndex) => sourceIndex % count === index).map((source) => source.id);
    return share.length ? share : topSourceIds;
  });
  const sections = resolveStudySections({
    planned: plan.sections ?? [],
    outline: request.outline,
    count,
    fallbackTitle: prompts.fallbackSection,
    validSourceIds: new Set(sources.map((source) => source.id)),
    validIdeaIds: new Set(knowledge.ideas.map((idea) => idea.id)),
    fallbackSourceIds,
    coverageQuestions: request.coverageQuestions,
  });

  const written: string[] = [];
  const outline: WritingWorkshopSection[] = [];
  const usedSourceIds = new Set<string>();
  let qualityRevisions = 0;
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const sectionSources = section.sourceIds.map((id) => sources.find((source) => source.id === id)).filter((source): source is StudyResearchSource => Boolean(source));
    sectionSources.forEach((source) => usedSourceIds.add(source.id));
    // Ideas the planner tied to this part; if it tied none, the strongest few, so a
    // section is never written blind to the concept network the rest of the unit uses.
    const sectionIdeas = (section.ideaIds.length
      ? knowledge.ideas.filter((idea) => section.ideaIds.includes(idea.id))
      : knowledge.ideas.slice(0, 8)
    ).map((idea) => ({ type: idea.type, label: idea.label, statement: idea.statement }));
    emit({
      phase: 'section',
      message: `${teacherPlan ? 'Redactando' : 'Explicando'}: ${section.title}`,
      sectionIndex: index + 1,
      sectionTotal: sections.length,
      sectionTitle: section.title,
    });
    const raw = await completeText({
      // A teacher focus is also last and therefore authoritative inside its section.
      system: [
        prompts.write,
        'La extensión la determina la evidencia y la función didáctica de esta parte. Desarrolla cada concepto, conexión, matiz o desacuerdo que aporte valor y detente cuando el valor marginal sea nulo; no persigas una cantidad de palabras/párrafos ni repitas una idea con reformulaciones.',
        'ESTÁNDAR DE CALIDAD: cada párrafo sustantivo debe conectar su afirmación con evidencia concreta. Cuando haya tres o más materiales, incluye al menos tres párrafos que pongan dos fuentes en diálogo explícito; con dos materiales, hazlo en al menos dos. Explica si convergen, discrepan o cumplen funciones distintas: juntar enlaces no cuenta como síntesis.',
        'No confundas una analogía pedagógica con un hecho documentado. Distingue lo que dicen los materiales de la explicación que construyes a partir de ellos y declara los límites del corpus.',
        ...DEEP_RESEARCH_NARRATIVE_RULES,
        ...(approachContext?.rules.writer ?? []),
        ...(section.focus ? [SECTION_FOCUS_RULE] : []),
      ].join('\n'),
      user: JSON.stringify({
        objective: request.objective,
        audience,
        language,
        section: {
          title: section.title,
          purpose: section.purpose,
          keyClaims: section.keyClaims,
          coverageQuestions: section.coverageQuestions,
          ...(section.focus ? { teacherFocus: section.focus } : {}),
        },
        ...(sectionIdeas.length ? { extractedIdeas: sectionIdeas } : {}),
        allowedSources: sectionSources.map((source) => ({ id: source.id, exactCitation: source.token, title: source.title, location: source.location, extract: source.text })),
        previousSections: written.map((markdown) => markdown.replace(/^##[^\n]+/, '').slice(0, 900)),
        ...(approachContext ? { researchApproach: approachContext.approach, retrievalPlan: approachContext.retrieval } : {}),
      }, null, 2),
      temperature: 0.25,
      maxTokens: 5_200,
    }, model);
    let markdown = normalizeSectionMarkdown(raw, section.title, sectionSources);
    const qualityMode: DeepResearchQualityMode = teacherPlan ? 'teaching' : 'study';
    const qualitySources = studyQualitySources(sectionSources);
    const beforeQuality = assessDeepResearchSection({
      markdown,
      mode: qualityMode,
      objective: request.objective,
      keyClaims: [...section.keyClaims, ...section.coverageQuestions],
      sources: qualitySources,
    });
    if (!qualityPasses(beforeQuality) || beforeQuality.score < 85 || beforeQuality.issues.length > 0) {
      try {
        const revisedRaw = await reviseStudySection({
          markdown,
          objective: request.objective,
          language,
          audience,
          teacherPlan,
          section,
          sectionSources,
          quality: beforeQuality,
          model,
        });
        const revised = normalizeSectionMarkdown(revisedRaw, section.title, sectionSources);
        const afterQuality = assessDeepResearchSection({
          markdown: revised,
          mode: qualityMode,
          objective: request.objective,
          keyClaims: [...section.keyClaims, ...section.coverageQuestions],
          sources: qualitySources,
        });
        if (shouldAcceptQualityRevision(beforeQuality, afterQuality, new Set(sectionSources.map((source) => source.url)), revised)) {
          markdown = revised;
          qualityRevisions += 1;
        }
      } catch {
        /* keep the valid first draft */
      }
    }
    written.push(markdown);
    outline.push({
      id: section.id,
      title: section.title,
      // The teacher's steer is kept in the saved outline: it is why the part reads the
      // way it does, and the reader shows it beside the section.
      purpose: [section.focus, section.purpose].filter(Boolean).join(' · '),
      keyClaims: [...section.keyClaims, ...section.coverageQuestions],
      sources: sectionSources.map((source) => source.token),
    });
  }

  emit({
    phase: 'assembling',
    message: teacherPlan
      ? 'Preparando síntesis, materiales y propuestas de evaluación…'
      : unitMode
        ? 'Preparando síntesis, fuentes y actividades de autoevaluación…'
        : 'Preparando síntesis, fuentes y actividades de comprensión…',
  });
  const firstFinal = await completeJson<StudyFinal>({
    system: [
      prompts.finalize,
      'El título y el resumen solo pueden sintetizar lo establecido en `sectionFindings`. No prometas aprendizajes, relaciones, ejemplos o certezas que el cuerpo y las fuentes usadas no desarrollen.',
      ...(approachContext?.rules.finalizer ?? []),
    ].join('\n'),
    user: JSON.stringify({
      objective: request.objective,
      audience,
      language,
      provisionalTitle: plan.title,
      sectionTitles: sections.map((section) => section.title),
      sectionFindings: sections.map((section, index) => ({ title: section.title, text: (written[index] ?? '').slice(0, 3_500) })),
      sourcesUsed: [...usedSourceIds],
      sourceEvidence: sources
        .filter((source) => usedSourceIds.has(source.id))
        .map((source) => ({ id: source.id, title: source.title, extract: source.text.slice(0, 700) })),
      ...(approachContext ? {
        researchApproach: approachContext.approach,
        retrievalPlan: approachContext.retrieval,
      } : {}),
    }, null, 2),
    temperature: 0.18,
    maxTokens: 1_800,
  }, isFinal, model).catch((): StudyFinal => ({}));
  const auditedFinal = await completeJson<StudyFinal>({
    system: [
      'Eres el control epistemológico final de un informe de estudio o unidad didáctica. Audita solo título, resumen, limitaciones y próximos pasos.',
      'Compara cada afirmación del resumen con `sectionFindings`. Estrecha o elimina cualquier concepto, relación, dominio, ejemplo, aprendizaje o certeza que el cuerpo no establezca.',
      'No introduzcas información nueva ni elimines limitaciones previas. Los próximos pasos pueden comprobar o ampliar lo aprendido, pero no presentarlo como ya demostrado.',
      'Conserva el idioma. Devuelve SOLO JSON con {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}.',
      ...(approachContext?.rules.finalizer ?? []),
    ].join('\n'),
    user: JSON.stringify({
      objective: request.objective,
      sectionFindings: sections.map((section, index) => ({ title: section.title, text: (written[index] ?? '').slice(0, 3_500) })),
      proposal: firstFinal,
    }, null, 2),
    temperature: 0,
    maxTokens: 1_800,
  }, isFinal, model).catch((): StudyFinal => firstFinal);
  const final: StudyFinal = {
    title: auditedFinal.title || firstFinal.title,
    abstract: auditedFinal.abstract || firstFinal.abstract,
    limitations: [...new Set([
      ...(Array.isArray(firstFinal.limitations) ? firstFinal.limitations : []),
      ...(Array.isArray(auditedFinal.limitations) ? auditedFinal.limitations : []),
    ])],
    nextSteps: Array.isArray(auditedFinal.nextSteps) && auditedFinal.nextSteps.length
      ? auditedFinal.nextSteps
      : firstFinal.nextSteps,
  };
  const references = sources.filter((source) => usedSourceIds.has(source.id)).map((source) => `${source.title}${source.location ? ` · ${source.location}` : ''}`);
  const limitations = Array.isArray(final.limitations) ? final.limitations.filter((value): value is string => typeof value === 'string') : [];
  const nextSteps = Array.isArray(final.nextSteps) ? final.nextSteps.filter((value): value is string => typeof value === 'string') : [];
  const singleNarrative = request.sectionLimit === 'single';
  const citedSourceTokens = sources.filter((source) => usedSourceIds.has(source.id)).map((source) => source.token);
  const body = assembleStudyDraftBody({
    written,
    citedSourceTokens,
    limitations,
    referencesLabel: prompts.references,
    limitationsLabel: prompts.limitations,
    abstract: final.abstract?.trim() || plan.abstract?.trim() || '',
    structure: request.sectionLimit,
  });
  const matrix: WritingWorkshopMatrixRow[] = sources.filter((source) => usedSourceIds.has(source.id)).map((source) => ({
    claim: source.text.replace(/\s+/g, ' ').slice(0, 240),
    role: 'support',
    sourceLabel: source.title,
    citation: source.url,
    evidence: source.location || source.subtitle,
    notes: source.kind,
  }));
  const words = body.split(/\s+/).filter(Boolean).length;
  // Which extracted ideas actually shaped the unit. Recorded on the draft so the next
  // surfaces built on top of a unit (activities, adaptations) can start from the same
  // concepts instead of re-deriving them from the prose.
  const usedIdeaIds = [...new Set(sections.flatMap((section) => section.ideaIds))];
  const qualityMode: DeepResearchQualityMode = teacherPlan ? 'teaching' : 'study';
  const qualityAssessment = assessDeepResearchReport({
    mode: qualityMode,
    objective: request.objective,
    coverageQuestions: request.coverageQuestions,
    sections: sections.map((section, index) => ({
      title: section.title,
      markdown: written[index] ?? '',
      keyClaims: [...section.keyClaims, ...section.coverageQuestions],
      sources: studyQualitySources(
        section.sourceIds.map((id) => sources.find((source) => source.id === id)).filter((source): source is StudyResearchSource => Boolean(source)),
      ),
    })),
  });
  const draft: WritingWorkshopDraft = {
    generatedAt: new Date().toISOString(),
    brief: { kind: 'deep_research', objective: request.objective, audience, tone: 'academic', language, deepResearchVersion: request.deepResearchVersion ?? 'v2' },
    selection: { ideaIds: usedIdeaIds, themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [] },
    title: final.title?.trim() || plan.title?.trim() || request.objective,
    abstract: final.abstract?.trim() || plan.abstract?.trim() || '',
    outline: singleNarrative ? [] : outline,
    draftMarkdown: body,
    matrix,
    bibliography: references,
    nextSteps,
    limitations,
    deepResearchStructure: singleNarrative ? 'single' : 'sectioned',
    qualityAssessment,
    stats: { selectedIdeas: usedIdeaIds.length, selectedThemes: 0, selectedGaps: 0, selectedContradictions: 0, selectedWorks: usedSourceIds.size, selectedPassages: 0, selectedTutorRoutes: 0, contextChars: sources.reduce((sum, source) => sum + source.text.length, 0), truncated: retrieved.length >= 48 },
  };
  const meta = {
    deepResearchVersion: request.deepResearchVersion ?? 'v2',
    structure: singleNarrative ? 'single' as const : 'sectioned' as const,
    sections: singleNarrative ? 1 : sections.length,
    words,
    pages: Math.max(1, Math.ceil(words / 450)),
    ideasCovered: usedIdeaIds.length,
    ideasConsidered: knowledge.ideas.length,
    worksCited: usedSourceIds.size,
    stoppedReason: retrieved.length >= 48 ? 'El contexto se acotó a los fragmentos más relevantes del índice de estudio.' : null,
    qualityRevisions,
    coverage: request.coverageQuestions?.length
      ? { questions: [...request.coverageQuestions], ratio: qualityAssessment.metrics.objectiveCoverage }
      : null,
  };
  emit({
    phase: 'done',
    message: teacherPlan
      ? `Unidad lista: ${singleNarrative ? 'bloque continuo' : `${sections.length} partes`} · ${usedSourceIds.size} materiales`
      : unitMode
        ? `Apuntes listos: ${singleNarrative ? 'bloque continuo' : `${sections.length} partes`} · ${usedSourceIds.size} materiales`
        : `Informe de estudio listo: ${singleNarrative ? 'bloque continuo' : `${sections.length} secciones`} · ${usedSourceIds.size} fuentes`,
    wordsSoFar: words,
    pagesSoFar: meta.pages,
  });
  return { draft, meta };
}
