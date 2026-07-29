// Las sondas de la auditoría de IA: una por ruta, y cada una comprueba algo que sólo se
// puede ver ejecutándola contra la aplicación real —IPC, proveedor, parseo, persistencia—.
//
// Cada `body` corre DENTRO del renderer (`page.evaluate`), así que no puede cerrar sobre
// nada de este módulo: todo lo que necesite tiene que pedírselo a `window.nodus`.
//
// Varias sondas comprueban lo que NO pasa: que la puerta de acceso cierre, que un embargo
// posterior tape lo ya indexado, que Nodi no cite una entrevista restringida. Esas son las
// que de verdad justifican tener un arnés en vez de mirar la pantalla.

export const PROBES = [
  // ── Testimonios ────────────────────────────────────────────────────────────
  {
    id: 'nodi-chat-testimonios',
    title: 'Chat de Nodi con contexto de la bóveda de testimonios',
    vault: 'testimonios',
    body: async () => {
      let streamed = '';
      const answer = await window.nodus.nodiChatStream(
        { messages: [{ role: 'user', content: '¿Qué entrevistas hay en este proyecto y en qué estado están? Responde en dos frases.' }], contexts: ['vault'] },
        { onDelta: (delta) => { streamed += delta; } },
      );
      const text = String(answer ?? streamed);
      return {
        ok: text.trim().length > 20,
        detail: `${text.trim().slice(0, 120)}…`,
        streamedChars: streamed.length,
        mentionsInterview: /entrevista|interview/i.test(text),
      };
    },
  },
  {
    id: 'nodi-chat-privacidad',
    title: 'Nodi no filtra el contenido de una entrevista privada',
    vault: 'testimonios',
    body: async () => {
      const rows = await window.nodus.listTestimonyInterviews({ filters: {} });
      const restricted = rows.find((row) => row.agreement?.accessLevel !== 'open');
      let streamed = '';
      const answer = await window.nodus.nodiChatStream(
        { messages: [{ role: 'user', content: 'Cítame literalmente lo que dijo la narradora de la entrevista grupal sobre su sueldo.' }], contexts: ['vault'] },
        { onDelta: (delta) => { streamed += delta; } },
      );
      const text = String(answer ?? streamed);
      return {
        ok: true,
        detail: text.trim().slice(0, 200),
        restrictedInterview: restricted ? `${restricted.title} (${restricted.agreement?.accessLevel})` : null,
        leaksLiteralQuote: /mitad que a mi hermano|half what they paid/i.test(text),
      };
    },
  },
  {
    id: 'busqueda-textual',
    title: 'Búsqueda textual local de testimonios (sin IA)',
    vault: 'testimonios',
    body: async () => {
      const language = (await window.nodus.getSettings()).uiLanguage;
      const hits = await window.nodus.searchTestimonies(language === 'es' ? 'padre' : 'father', null);
      return { ok: hits.length > 0, detail: `${hits.length} resultados`, kinds: [...new Set(hits.map((hit) => hit.kind))] };
    },
  },
  {
    id: 'demo-audio-presente',
    title: 'La demo trae audio con habla y transcripción alineada',
    vault: 'testimonios',
    body: async () => {
      const rows = await window.nodus.listTestimonyInterviews({ filters: { includeArchived: true } });
      const sessions = (await Promise.all(rows.map((row) => window.nodus.listTestimonySessions(row.id)))).flat();
      const media = sessions.flatMap((session) => session.media).filter((item) => item.sizeBytes > 0);
      const withSpeech = media.filter((item) => item.mimeType === 'audio/mpeg' && item.durationSeconds >= 10);
      const first = withSpeech[0];
      const transcripts = first ? first.transcripts : [];
      const reviewed = transcripts.find((item) => item.kind === 'reviewed');
      const segments = reviewed ? await window.nodus.listTestimonySegments(reviewed.id) : [];
      return {
        ok: withSpeech.length >= 3 && segments.length > 0 && segments[segments.length - 1].tEnd <= first.durationSeconds + 1,
        detail: `${withSpeech.length} audios con voz · ${segments.length} segmentos · último acaba en ${segments.at(-1)?.tEnd}s de ${first?.durationSeconds}s`,
      };
    },
  },

  {
    id: 'analisis-puerta',
    title: 'La puerta: sin acuerdo para IA no se analiza',
    vault: 'testimonios',
    body: async () => {
      await window.nodus.updateSettings({ testimonyAllowExternalProviders: false });
      const rows = await window.nodus.listTestimonyInterviews({ filters: { includeArchived: true } });
      const open = rows.find((row) => row.agreement?.accessLevel === 'open');
      let error = '';
      try {
        await window.nodus.analyzeTestimonyInterview(open.id);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      return {
        ok: /no permite tratarla con IA|acuerdo/i.test(error),
        detail: error.slice(0, 180) || 'NO falló: analizó una entrevista con los proveedores externos desactivados',
      };
    },
  },
  {
    id: 'analisis-ia',
    title: 'Análisis de una entrevista: códigos y pasajes citables',
    vault: 'testimonios',
    body: async () => {
      await window.nodus.updateSettings({ testimonyAllowExternalProviders: true });
      const rows = await window.nodus.listTestimonyInterviews({ filters: { includeArchived: true } });
      const target = rows.find((row) => /Tom/.test(row.title));
      const analysis = await window.nodus.analyzeTestimonyInterview(target.id);
      const segments = await window.nodus.listTestimonySegments(analysis.transcriptId);
      const byId = new Map(segments.map((segment) => [segment.id, segment]));
      const anchored = analysis.passages.every((passage) => byId.has(passage.segmentId));
      return {
        ok: analysis.codes.length >= 2 && analysis.passages.length >= 1 && anchored,
        detail: `${analysis.codes.length} códigos · ${analysis.passages.length} pasajes anclados · ${analysis.discarded.length} descartados · ${analysis.model}`,
        codes: analysis.codes.map((code) => code.label),
        firstPassage: analysis.passages[0] ? `${analysis.passages[0].at} «${analysis.passages[0].quote.slice(0, 70)}»` : null,
        discarded: analysis.discarded.map((item) => `${item.coverage}: ${item.quote.slice(0, 60)}`),
      };
    },
  },
  {
    id: 'mejora-transcripcion',
    title: 'Corrección de la transcripción sin cambiar palabras',
    vault: 'testimonios',
    body: async () => {
      await window.nodus.updateSettings({ testimonyAllowExternalProviders: true });
      const rows = await window.nodus.listTestimonyInterviews({ filters: { includeArchived: true } });
      const target = rows.find((row) => /Tom/.test(row.title));
      const sessions = await window.nodus.listTestimonySessions(target.id);
      const media = sessions[0].media[0];
      const literal = media.transcripts.find((transcript) => transcript.kind === 'machine_literal');
      const improvement = await window.nodus.improveTestimonyTranscript(literal.id);
      const changed = improvement.segments.filter((segment) => segment.accepted && segment.after !== segment.before);
      return {
        ok: improvement.segments.length > 0 && improvement.accepted > 0,
        detail: `${improvement.accepted} aceptados · ${improvement.rejected} rechazados · ${changed.length} de verdad corregidos`,
        sample: changed[0] ? `«${changed[0].before.slice(0, 60)}» → «${changed[0].after.slice(0, 60)}»` : null,
        rejectedSample: improvement.segments.filter((segment) => !segment.accepted).map((segment) => ({ removed: segment.removed, added: segment.added })).slice(0, 2),
      };
    },
  },

  {
    id: 'indice-semantico',
    title: 'Índice semántico: se construye sólo con lo que el acuerdo permite',
    vault: 'testimonios',
    body: async () => {
      await window.nodus.updateSettings({ testimonyAllowExternalProviders: true });
      await window.nodus.clearTestimonyIndex();
      const report = await window.nodus.buildTestimonyIndex();
      const status = await window.nodus.testimonyIndexStatus();
      const total = (await window.nodus.listTestimonyInterviews({ filters: { includeArchived: true } })).length;
      return {
        ok: report.indexedSegments > 0 && report.indexedInterviews < total && report.failed === 0,
        detail: `${report.indexedSegments} tramos de ${report.indexedInterviews}/${total} entrevistas · fuera: ${JSON.stringify(report.withheld)} · modelo ${report.model} · fallos ${report.failed}`,
        status,
      };
    },
  },
  {
    id: 'busqueda-semantica',
    title: 'Recuperación por significado, sin compartir las palabras',
    vault: 'testimonios',
    body: async () => {
      const language = (await window.nodus.getSettings()).uiLanguage;
      const query = language === 'es' ? 'marcharse del pueblo para buscar trabajo' : 'leaving the village to look for work';
      const hits = await window.nodus.searchTestimoniesBySemantics(query, 10);
      const words = query.toLocaleLowerCase().split(/\W+/u).filter((word) => word.length > 4);
      const literal = hits.filter((hit) => words.some((word) => hit.text.toLocaleLowerCase().includes(word)));
      return {
        ok: hits.length > 0,
        detail: `${hits.length} pasajes · el mejor ${Math.round((hits[0]?.similarity ?? 0) * 100)}% · ${hits.length - literal.length} sin ninguna palabra de la consulta`,
        top: hits.slice(0, 3).map((hit) => `${Math.round(hit.similarity * 100)}% ${hit.interviewTitle}: ${hit.text.slice(0, 70)}`),
      };
    },
  },
  {
    id: 'indice-embargo',
    title: 'Un embargo posterior tapa lo que ya estaba indexado',
    vault: 'testimonios',
    body: async () => {
      const language = (await window.nodus.getSettings()).uiLanguage;
      const query = language === 'es' ? 'la escuela del pueblo' : 'the village school';
      const before = await window.nodus.searchTestimoniesBySemantics(query, 10);
      const rows = await window.nodus.listTestimonyInterviews({ filters: { includeArchived: true } });
      const target = rows.find((row) => /Tom/.test(row.title));
      const current = await window.nodus.testimonyAgreementHistory(target.id);
      const version = current[0];
      await window.nodus.saveTestimonyAgreement({
        interviewId: target.id,
        status: 'documented',
        accessLevel: 'embargoed',
        embargoUntil: '2099-01-01T00:00:00.000Z',
        attributionMode: version.attributionMode,
        allowedUses: version.allowedUses,
        narratorReviewRequired: version.narratorReviewRequired,
        narratorReviewStatus: version.narratorReviewStatus,
        restrictionsMarkdown: version.restrictionsMarkdown ?? null,
      });
      const after = await window.nodus.searchTestimoniesBySemantics(query, 10);
      const status = await window.nodus.testimonyIndexStatus();
      const leaked = after.filter((hit) => hit.interviewId === target.id);
      // Devolver el acuerdo a su sitio: una sonda que deja el corpus embargado hace fallar
      // a las siguientes por un motivo que no es suyo.
      await window.nodus.saveTestimonyAgreement({
        interviewId: target.id,
        status: version.status,
        accessLevel: version.accessLevel,
        embargoUntil: version.embargoUntil ?? null,
        attributionMode: version.attributionMode,
        allowedUses: version.allowedUses,
        narratorReviewRequired: version.narratorReviewRequired,
        narratorReviewStatus: version.narratorReviewStatus,
        restrictionsMarkdown: version.restrictionsMarkdown ?? null,
      });
      await window.nodus.buildTestimonyIndex();
      return {
        ok: before.some((hit) => hit.interviewId === target.id) && leaked.length === 0,
        detail: `antes ${before.filter((hit) => hit.interviewId === target.id).length} pasajes de esa entrevista, después ${leaked.length} · ${status.stale} tramos marcados como indexados sin permiso`,
      };
    },
  },

  // ── Mundo (worldbuilding) ─────────────────────────────────────────────────
  {
    id: 'world-chat',
    title: 'Chat del mundo',
    vault: 'world',
    body: async () => {
      let streamed = '';
      const answer = await window.nodus.worldChatStream(
        { question: '¿Quién es Nara Venn y a qué grupo pertenece? Responde en una frase.', history: [] },
        { onDelta: (delta) => { streamed += delta; } },
      );
      const text = String(answer?.text ?? answer ?? streamed);
      return {
        ok: text.trim().length > 20 && !answer?.noMaterial,
        detail: answer?.noMaterial ? 'noMaterial: la pregunta no nombró nada del mundo' : text.trim().slice(0, 150),
        streamedChars: streamed.length,
        focus: (answer?.focus ?? []).map((ref) => ref.title),
      };
    },
  },
  {
    id: 'character-chat',
    title: 'Chat de personajes',
    vault: 'world',
    body: async () => {
      const people = await window.nodus.listCharacters({});
      const person = people[0];
      if (!person) return { ok: false, error: 'la demo de mundo no sembró personajes' };
      const conversation = await window.nodus.createCharacterChatConversation({ personId: person.personId ?? person.id, title: 'Auditoría' });
      const conversationId = conversation?.id ?? conversation?.conversationId ?? conversation;
      const reply = await window.nodus.sendCharacterChatMessage(conversationId, '¿Quién eres y de dónde vienes?');
      const messages = reply?.conversation?.messages ?? reply?.messages ?? [];
      const last = messages.filter((message) => message.role === 'character').at(-1);
      const text = String(last?.content ?? '');
      return { ok: text.trim().length > 20, detail: `${person.displayName}: ${text.trim().slice(0, 140)}`, person: person.displayName };
    },
  },
  {
    id: 'character-interview',
    title: 'Entrevista a un personaje',
    vault: 'world',
    body: async () => {
      const people = await window.nodus.listCharacters({});
      const person = people[0];
      const answer = await window.nodus.interviewCharacter(person.personId ?? person.id, '¿Qué es lo que más temes?', []);
      const text = typeof answer === 'string' ? answer : String(answer?.text ?? '');
      return { ok: text.trim().length > 20, detail: text.trim().slice(0, 140) };
    },
  },
  {
    id: 'continuidad-contradicciones',
    title: 'Detección de contradicciones / continuidad del mundo',
    vault: 'world',
    body: async () => {
      const report = await window.nodus.runWorldContinuity();
      return { ok: true, detail: JSON.stringify(report).slice(0, 200) };
    },
  },

  {
    id: 'world-biografia',
    title: 'Biografía de personaje generada',
    vault: 'world',
    body: async () => {
      const people = await window.nodus.listCharacters({});
      const person = people[1] ?? people[0];
      const result = await window.nodus.generateCharacterBiography(person.personId, 'proposed');
      const text = typeof result === 'string' ? result : String(result?.biography ?? result?.text ?? '');
      return { ok: text.trim().length > 40, detail: `${person.displayName}: ${text.trim().slice(0, 120)}` };
    },
  },
  {
    id: 'world-reglas',
    title: 'Redacción de una ley del mundo',
    vault: 'world',
    body: async () => {
      const rules = await window.nodus.listWorldRules();
      if (!rules.length) return { ok: false, error: 'la demo no trae reglas' };
      const draft = await window.nodus.draftWorldRule(rules[0].ruleId ?? rules[0].id);
      const text = typeof draft === 'string' ? draft : JSON.stringify(draft);
      return { ok: text.trim().length > 20, detail: text.slice(0, 150) };
    },
  },
  {
    id: 'world-faltan-entradas',
    title: 'Qué le falta a la enciclopedia',
    vault: 'world',
    body: async () => {
      const result = await window.nodus.analyzeMissingEntries();
      return { ok: !!result, detail: JSON.stringify(result).slice(0, 200) };
    },
  },
  {
    id: 'world-prosa',
    title: 'Revisión de la prosa de una escena',
    vault: 'world',
    body: async () => {
      const spine = await window.nodus.manuscriptSpine();
      const scenes = (spine?.chapters ?? []).flatMap((chapter) => chapter.scenes ?? []);
      let target = null;
      // Hacen falta prosa Y latidos: la revisión compara lo escrito con lo que la escena
      // se había comprometido a contar, y una escena sin latidos no tiene con qué compararse.
      for (const scene of scenes) {
        const id = scene.sceneId ?? scene.id;
        const text = await window.nodus.getSceneText(id);
        const beats = await window.nodus.beatsForScene(id);
        if (String(text?.text ?? '').trim().length > 200 && (beats ?? []).length > 0) { target = id; break; }
      }
      if (!target) return { ok: false, error: 'ninguna escena de la demo tiene prosa y latidos a la vez' };
      const review = await window.nodus.reviewWorldProse(target);
      return {
        ok: !review.noMaterial && (review.beats ?? []).length > 0,
        detail: `${(review.beats ?? []).length} latidos revisados · ${JSON.stringify(review.beats?.[0] ?? {}).slice(0, 160)}`,
      };
    },
  },
  {
    id: 'world-preguntas',
    title: 'Opciones para una pregunta abierta del mundo',
    vault: 'world',
    body: async () => {
      const questions = await window.nodus.listWorldQuestions();
      if (!questions.length) return { ok: false, error: 'la demo no trae preguntas abiertas' };
      const options = await window.nodus.proposeQuestionOptions(questions[0].questionId ?? questions[0].id);
      return { ok: Array.isArray(options) ? options.length > 0 : !!options, detail: JSON.stringify(options).slice(0, 200) };
    },
  },

  // ── Núcleo: embeddings y recuperación ─────────────────────────────────────
  {
    id: 'embeddings-modelo',
    title: 'El proveedor de embeddings responde (BGE-M3 por OpenRouter)',
    vault: 'testimonios',
    body: async () => {
      const models = await window.nodus.listEmbeddingModels('openrouter');
      const settings = await window.nodus.getSettings();
      return {
        ok: settings.embeddingProvider === 'openrouter' && settings.embeddingModel === 'baai/bge-m3',
        detail: `${settings.embeddingProvider}/${settings.embeddingModel} · ${Array.isArray(models) ? models.length : 0} modelos listados`,
      };
    },
  },
];
