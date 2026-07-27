import type { PromptLanguage } from './types';

/**
 * The two pedagogical products exposed by Deep Research in a teaching vault.
 * Keep these values language-neutral: they are persisted with the saved brief and
 * may be reused after the UI language changes.
 */
export type StudyDeepResearchAudience = 'teacher' | 'students';

export interface StudyDeepResearchAudiencePrompt {
  plan: string;
  write: string;
  finalize: string;
}

export function normalizeStudyDeepResearchAudience(value: string | undefined): StudyDeepResearchAudience {
  return value === 'teacher' ? 'teacher' : 'students';
}

/**
 * Native prompt directives layered over the common source-grounded study prompt.
 * The common prompt protects citations and accuracy; this layer changes the actual
 * product so a teacher plan never masquerades as student-facing notes (or vice versa).
 */
export const STUDY_DEEP_RESEARCH_AUDIENCE_PROMPTS: Record<
  PromptLanguage,
  Record<StudyDeepResearchAudience, StudyDeepResearchAudiencePrompt>
> = {
  es: {
    teacher: {
      plan: 'El público objetivo es el DOCENTE. Diseña una unidad o lección utilizable para preparar la enseñanza: objetivos de aprendizaje, prerrequisitos, secuencia y temporalización, explicación docente, actividades, comprobaciones de comprensión, errores previsibles, recursos y evaluación o cierre. No redactes apuntes dirigidos al alumnado.',
      write: 'Redacta para el DOCENTE, con decisiones y orientaciones accionables para impartir la lección. Explica qué enseñar, en qué orden, cómo presentarlo, qué actividad realizar y cómo comprobar el aprendizaje. No te dirijas al alumnado ni conviertas la sección en un manual de estudio.',
      finalize: 'El resumen debe describir el diseño docente resultante. Los siguientes pasos deben ayudar a preparar, adaptar, impartir y evaluar la lección.',
    },
    students: {
      plan: 'El público objetivo es el ALUMNADO. Crea apuntes autosuficientes y listos para entregar: qué se aprenderá, explicación progresiva, definiciones claras, ejemplos, conexiones, errores frecuentes, síntesis y preguntas breves de autoevaluación. No incluyas instrucciones privadas para el docente ni temporalización de clase.',
      write: 'Redacta directamente para el ALUMNADO como apuntes claros y listos para entregar. Usa un tono explicativo, accesible y respetuoso; desarrolla las ideas paso a paso, incorpora ejemplos y ayudas para recordar y termina cada gran bloque reforzando lo esencial. No hables de lo que «el docente debe hacer».',
      finalize: 'El resumen debe explicar al alumnado qué comprenderá. Los siguientes pasos deben proponer repaso y autoevaluación que pueda realizar sin instrucciones privadas del docente.',
    },
  },
  en: {
    teacher: {
      plan: 'The target audience is the TEACHER. Design a usable unit or lesson for instructional preparation: learning objectives, prerequisites, sequence and timing, teacher explanation, activities, checks for understanding, likely misconceptions, resources, and assessment or closure. Do not write student-facing notes.',
      write: 'Write for the TEACHER, with actionable decisions and guidance for delivering the lesson. Explain what to teach, in what order, how to present it, which activity to run, and how to check learning. Do not address students or turn the section into a study handout.',
      finalize: 'The abstract must describe the resulting teacher plan. Next steps must help prepare, adapt, deliver, and assess the lesson.',
    },
    students: {
      plan: 'The target audience is STUDENTS. Create self-contained, ready-to-share notes: what will be learned, progressive explanation, clear definitions, examples, connections, common misconceptions, a synthesis, and short self-check questions. Do not include private teacher instructions or classroom timing.',
      write: 'Write directly for STUDENTS as clear notes that are ready to share. Use an explanatory, accessible, respectful tone; develop ideas step by step, include examples and memory aids, and reinforce the essentials at the end of each major block. Do not discuss what “the teacher should do”.',
      finalize: 'The abstract must tell students what they will understand. Next steps must suggest review and self-assessment they can complete without private teacher instructions.',
    },
  },
  fr: {
    teacher: {
      plan: 'Le public cible est l’ENSEIGNANT. Conçois une unité ou une leçon utilisable pour préparer l’enseignement : objectifs d’apprentissage, prérequis, progression et durée, explication de l’enseignant, activités, vérification de la compréhension, erreurs prévisibles, ressources et évaluation ou conclusion. Ne rédige pas de notes destinées aux élèves.',
      write: 'Rédige pour l’ENSEIGNANT, avec des décisions et des conseils concrets pour donner la leçon. Explique quoi enseigner, dans quel ordre, comment le présenter, quelle activité mener et comment vérifier les apprentissages. Ne t’adresse pas aux élèves et ne transforme pas la section en fiche d’étude.',
      finalize: 'Le résumé doit décrire la conception pédagogique obtenue. Les étapes suivantes doivent aider à préparer, adapter, donner et évaluer la leçon.',
    },
    students: {
      plan: 'Le public cible est les ÉLÈVES. Crée des notes autonomes prêtes à distribuer : objectifs d’apprentissage, explication progressive, définitions claires, exemples, liens, erreurs fréquentes, synthèse et courtes questions d’autoévaluation. N’inclus ni consignes privées pour l’enseignant ni minutage de classe.',
      write: 'Rédige directement pour les ÉLÈVES sous forme de notes claires prêtes à distribuer. Adopte un ton explicatif, accessible et respectueux ; développe les idées pas à pas, ajoute des exemples et des moyens mnémotechniques, puis renforce l’essentiel à la fin de chaque grande partie. Ne parle pas de ce que « l’enseignant doit faire ».',
      finalize: 'Le résumé doit expliquer aux élèves ce qu’ils comprendront. Les étapes suivantes doivent proposer des activités de révision et d’autoévaluation réalisables sans consignes privées de l’enseignant.',
    },
  },
  de: {
    teacher: {
      plan: 'Die Zielgruppe ist die LEHRKRAFT. Entwirf eine unmittelbar nutzbare Unterrichtseinheit oder Stunde: Lernziele, Voraussetzungen, Ablauf und Zeitplanung, Erklärungen der Lehrkraft, Aktivitäten, Verständnisprüfungen, erwartbare Fehlvorstellungen, Materialien sowie Bewertung oder Abschluss. Verfasse keine Lernunterlagen für Schülerinnen und Schüler.',
      write: 'Schreibe für die LEHRKRAFT und gib konkrete, umsetzbare Hinweise für die Durchführung. Erkläre, was in welcher Reihenfolge vermittelt wird, wie es präsentiert wird, welche Aktivität folgt und wie der Lernerfolg geprüft wird. Sprich die Lernenden nicht direkt an und verfasse kein Lernskript.',
      finalize: 'Die Zusammenfassung muss den entstandenen Unterrichtsentwurf beschreiben. Die nächsten Schritte sollen bei Vorbereitung, Anpassung, Durchführung und Bewertung helfen.',
    },
    students: {
      plan: 'Die Zielgruppe sind SCHÜLERINNEN UND SCHÜLER. Erstelle eigenständige, direkt ausgebbare Lernunterlagen: Lernziele, schrittweise Erklärung, klare Definitionen, Beispiele, Zusammenhänge, häufige Fehlvorstellungen, Zusammenfassung und kurze Fragen zur Selbstkontrolle. Nenne weder interne Hinweise für Lehrkräfte noch einen Stundenzeitplan.',
      write: 'Schreibe direkt für SCHÜLERINNEN UND SCHÜLER als klare, ausgabefertige Lernunterlage. Verwende einen verständlichen, respektvollen Ton, entwickle die Gedanken Schritt für Schritt, ergänze Beispiele und Merkhilfen und sichere am Ende jedes größeren Abschnitts das Wesentliche. Schreibe nicht darüber, was „die Lehrkraft tun soll“.',
      finalize: 'Die Zusammenfassung muss den Lernenden erklären, was sie verstehen werden. Die nächsten Schritte sollen Wiederholung und Selbstkontrolle ohne interne Hinweise für Lehrkräfte ermöglichen.',
    },
  },
  pt: {
    teacher: {
      plan: 'O público-alvo é o DOCENTE. Concebe uma unidade ou aula pronta para preparar o ensino: objetivos de aprendizagem, pré-requisitos, sequência e tempo, explicação do docente, atividades, verificação da compreensão, erros previsíveis, recursos e avaliação ou encerramento. Não redijas apontamentos dirigidos aos alunos.',
      write: 'Redige para o DOCENTE, com decisões e orientações acionáveis para dar a aula. Explica o que ensinar, por que ordem, como apresentar, que atividade realizar e como verificar a aprendizagem. Não te dirijas aos alunos nem transformes a secção num manual de estudo.',
      finalize: 'O resumo deve descrever o plano docente resultante. Os passos seguintes devem ajudar a preparar, adaptar, dar e avaliar a aula.',
    },
    students: {
      plan: 'O público-alvo são os ALUNOS. Cria apontamentos autónomos e prontos a entregar: o que será aprendido, explicação progressiva, definições claras, exemplos, ligações, erros frequentes, síntese e perguntas breves de autoavaliação. Não incluas instruções privadas para o docente nem temporização da aula.',
      write: 'Redige diretamente para os ALUNOS como apontamentos claros e prontos a entregar. Usa um tom explicativo, acessível e respeitador; desenvolve as ideias passo a passo, inclui exemplos e auxiliares de memória e reforça o essencial no fim de cada bloco principal. Não fales do que «o docente deve fazer».',
      finalize: 'O resumo deve explicar aos alunos o que irão compreender. Os passos seguintes devem propor revisão e autoavaliação que possam realizar sem instruções privadas do docente.',
    },
  },
  'pt-BR': {
    teacher: {
      plan: 'O público-alvo é o DOCENTE. Planeje uma unidade ou aula pronta para preparar o ensino: objetivos de aprendizagem, pré-requisitos, sequência e tempo, explicação do docente, atividades, verificação da compreensão, erros previsíveis, recursos e avaliação ou encerramento. Não escreva material dirigido aos estudantes.',
      write: 'Escreva para o DOCENTE, com decisões e orientações práticas para ministrar a aula. Explique o que ensinar, em que ordem, como apresentar, qual atividade realizar e como verificar a aprendizagem. Não se dirija aos estudantes nem transforme a seção em uma apostila.',
      finalize: 'O resumo deve descrever o planejamento docente resultante. Os próximos passos devem ajudar a preparar, adaptar, ministrar e avaliar a aula.',
    },
    students: {
      plan: 'O público-alvo são os ESTUDANTES. Crie material autônomo e pronto para entregar: o que será aprendido, explicação progressiva, definições claras, exemplos, conexões, erros frequentes, síntese e perguntas breves de autoavaliação. Não inclua instruções privadas para o docente nem cronograma de aula.',
      write: 'Escreva diretamente para os ESTUDANTES como material claro e pronto para entregar. Use um tom explicativo, acessível e respeitoso; desenvolva as ideias passo a passo, inclua exemplos e recursos de memorização e reforce o essencial ao final de cada bloco principal. Não fale sobre o que “o docente deve fazer”.',
      finalize: 'O resumo deve explicar aos estudantes o que compreenderão. Os próximos passos devem propor revisão e autoavaliação que possam realizar sem instruções privadas do docente.',
    },
  },
  tr: {
    teacher: {
      plan: 'Hedef kitle ÖĞRETMENDİR. Öğretim hazırlığında doğrudan kullanılabilecek bir ünite veya ders tasarla: öğrenme hedefleri, ön koşullar, sıra ve süre, öğretmen açıklaması, etkinlikler, anlamayı kontrol etme, olası kavram yanılgıları, kaynaklar ve değerlendirme ya da kapanış. Öğrenciye yönelik ders notları yazma.',
      write: 'Dersi uygulamaya yönelik somut kararlar ve yönlendirmelerle ÖĞRETMEN için yaz. Neyin hangi sırayla öğretileceğini, nasıl sunulacağını, hangi etkinliğin yapılacağını ve öğrenmenin nasıl kontrol edileceğini açıkla. Öğrencilere doğrudan hitap etme ve bölümü çalışma notuna dönüştürme.',
      finalize: 'Özet, ortaya çıkan öğretmen planını açıklamalıdır. Sonraki adımlar dersin hazırlanmasına, uyarlanmasına, uygulanmasına ve değerlendirilmesine yardımcı olmalıdır.',
    },
    students: {
      plan: 'Hedef kitle ÖĞRENCİLERDİR. Doğrudan paylaşılabilecek, kendi kendine yeterli ders notları hazırla: öğrenilecekler, aşamalı açıklama, açık tanımlar, örnekler, bağlantılar, yaygın kavram yanılgıları, özet ve kısa öz değerlendirme soruları. Öğretmene özel talimatlar veya ders zamanlaması ekleme.',
      write: 'Açık ve paylaşılmaya hazır ders notları olarak doğrudan ÖĞRENCİLER için yaz. Açıklayıcı, erişilebilir ve saygılı bir ton kullan; fikirleri adım adım geliştir, örnekler ve hatırlama araçları ekle ve her ana bölümün sonunda temel noktaları pekiştir. “Öğretmenin ne yapması gerektiğinden” söz etme.',
      finalize: 'Özet, öğrencilere neyi anlayacaklarını açıklamalıdır. Sonraki adımlar, öğretmene özel talimatlar olmadan yapabilecekleri tekrar ve öz değerlendirme çalışmalarını önermelidir.',
    },
  },
};
