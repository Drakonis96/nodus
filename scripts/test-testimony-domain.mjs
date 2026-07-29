// El contrato de dominio del vault de Testimonios (fase 0 del plan).
//
// Estas pruebas no comprueban una pantalla: comprueban las tres reglas que sostienen
// todo el vertical y que, si se rompen, lo hacen en silencio meses después —
//   1. flujo, acuerdo y acceso son dimensiones INDEPENDIENTES;
//   2. una cita nunca se mueve sola;
//   3. una restricción cierra de verdad los canales de salida.

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-testimony-domain-'));
async function bundle(file, name) {
  const out = path.join(outDir, name);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${out}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(out);
}

const T = await bundle('shared/testimonies.ts', 'testimonies.cjs');
const A = await bundle('shared/testimonyAccess.ts', 'testimonyAccess.cjs');
const L = await bundle('shared/testimonyDeepLinks.ts', 'testimonyDeepLinks.cjs');
const LB = await bundle('shared/testimonyLabels.ts', 'testimonyLabels.cjs');

test.after(() => rm(outDir, { recursive: true, force: true }));

// ── 1. Flujo de trabajo ──────────────────────────────────────────────────────

test('el flujo admite el camino normal y también volver atrás', () => {
  assert.equal(T.canTransition('preparation', 'scheduled'), true);
  assert.equal(T.canTransition('recorded', 'transcribing'), true);
  assert.equal(T.canTransition('narrator_review', 'completed'), true);
  // Volver atrás es legítimo: el narrador pide revisar algo ya cerrado.
  assert.equal(T.canTransition('completed', 'reviewing'), true);
  // Quedarse igual nunca es un error.
  for (const status of T.INTERVIEW_WORKFLOW_STATUSES) {
    assert.equal(T.canTransition(status, status), true, status);
  }
});

test('archivada solo sale desarchivando', () => {
  assert.deepEqual(T.suggestedTransitions('archived'), ['completed']);
  assert.equal(T.canTransition('archived', 'transcribing'), false);
  assert.equal(T.canTransition('archived', 'recorded'), false);
});

test('Nodus propone estados, no los impone', () => {
  assert.equal(T.proposedStatusAfter('preparation', 'master_added'), 'recorded');
  assert.equal(T.proposedStatusAfter('scheduled', 'master_added'), 'recorded');
  // Importar un audio en una entrevista ya terminada no la devuelve a «Grabada».
  assert.equal(T.proposedStatusAfter('completed', 'master_added'), null);
  assert.equal(T.proposedStatusAfter('transcribing', 'transcription_ready'), 'reviewing');
  assert.equal(T.proposedStatusAfter('narrator_review', 'narrator_approved'), 'completed');
});

test('cerrada no es lo mismo que sin trabajo pendiente en otras dimensiones', () => {
  assert.equal(T.isClosedStatus('completed'), true);
  assert.equal(T.isClosedStatus('reviewing'), false);
  // Y una completada puede seguir teniendo el acuerdo pendiente: son ejes distintos.
  const decision = A.evaluateAccess(
    { ...A.pendingAccessContext(), accessLevel: 'open' },
    'accessExport'
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'agreement_pending');
});

// ── 2. Transcripciones ───────────────────────────────────────────────────────

test('el literal y la aprobada son inmutables', () => {
  assert.equal(T.isEditableTranscriptKind('machine_literal'), false);
  assert.equal(T.isEditableTranscriptKind('approved'), false);
  assert.equal(T.isEditableTranscriptKind('corrected'), true);
  assert.equal(T.isEditableTranscriptKind('reviewed'), true);
});

test('una aprobada se reabre derivando, nunca editando', () => {
  assert.equal(T.canDeriveTranscript('approved', 'reviewed'), true);
  assert.equal(T.canDeriveTranscript('machine_literal', 'corrected'), true);
  // Solo una revisada puede aprobarse: aprobar el literal saltaría el proceso entero.
  assert.equal(T.canDeriveTranscript('machine_literal', 'approved'), false);
  assert.equal(T.canDeriveTranscript('corrected', 'approved'), false);
  assert.equal(T.canDeriveTranscript('reviewed', 'approved'), true);
});

test('citar prefiere lo aprobado y deja el literal como último recurso', () => {
  const list = [
    { id: 'a', kind: 'machine_literal', status: 'ready', versionNo: 1 },
    { id: 'b', kind: 'corrected', status: 'ready', versionNo: 1 },
    { id: 'c', kind: 'reviewed', status: 'ready', versionNo: 2 },
  ];
  assert.equal(T.preferredTranscript(list).id, 'c');
  assert.equal(T.preferredTranscript([...list, { id: 'd', kind: 'approved', status: 'ready', versionNo: 1 }]).id, 'd');
  // Una versión en curso no se cita.
  assert.equal(T.preferredTranscript([{ id: 'x', kind: 'approved', status: 'processing', versionNo: 1 }]), null);
  // Con varias del mismo tipo gana la versión más alta.
  assert.equal(
    T.preferredTranscript([
      { id: 'v1', kind: 'reviewed', status: 'ready', versionNo: 1 },
      { id: 'v3', kind: 'reviewed', status: 'ready', versionNo: 3 },
    ]).id,
    'v3'
  );
});

// ── 3. Códigos ───────────────────────────────────────────────────────────────

test('la normalización impide códigos gemelos', () => {
  assert.equal(T.sameCode('Posguerra', 'posguerra'), true);
  assert.equal(T.sameCode('  Post-guerra ', 'post guerra'), true);
  assert.equal(T.sameCode('Emigración', 'emigracion'), true);
  assert.equal(T.sameCode('Hambruna', 'Hambre'), false);
});

test('las sugerencias priorizan lo que empieza igual y, a igualdad, lo más usado', () => {
  const codes = [
    { label: 'Hambre', usageCount: 2 },
    { label: 'Hambruna de 1946', usageCount: 9 },
    { label: 'Memoria del hambre', usageCount: 40 },
  ];
  const ranked = T.rankCodeSuggestions(codes, 'hambr');
  assert.deepEqual(ranked.map((c) => c.label), ['Hambruna de 1946', 'Hambre', 'Memoria del hambre']);
  // Sin consulta, manda el uso.
  assert.equal(T.rankCodeSuggestions(codes, '')[0].label, 'Memoria del hambre');
});

test('una etiqueta vacía o solo puntuación no es un código', () => {
  assert.equal(T.isValidCodeLabel('  '), false);
  assert.equal(T.isValidCodeLabel('---'), false);
  assert.equal(T.isValidCodeLabel('Exilio'), true);
});

// ── 4. La cita nunca se mueve sola ───────────────────────────────────────────

const SEGMENTS = [
  { id: 's1', tStart: 0, tEnd: 12, text: 'Mi padre se marchó en el cuarenta y siete.' },
  { id: 's2', tStart: 12, tEnd: 25, text: 'Nunca volvimos a saber de él hasta muchos años después.' },
  { id: 's3', tStart: 300, tEnd: 312, text: 'Mi padre se marchó en el cuarenta y siete.' },
];

test('un fragmento se reancla cuando su texto sigue en el mismo tramo', () => {
  const result = T.remapAnnotation(
    { tStart: 1, tEnd: 10, quoteSnapshot: 'se marchó en el cuarenta y siete' },
    SEGMENTS
  );
  assert.equal(result.status, 'valid');
  assert.equal(result.segmentId, 's1');
});

test('la misma frase dicha en otro momento NO es la misma cita', () => {
  // La versión nueva reescribió el arranque, pero la misma frase aparece cinco minutos
  // después (s3). Reanclar ahí produciría una cita textualmente idéntica y FALSA: la
  // persona dijo eso, sí, pero no en ese punto de la entrevista. Debe pedir revisión.
  const rewritten = [
    { id: 'n1', tStart: 0, tEnd: 12, text: 'Mi padre emigró en mil novecientos cuarenta y siete.' },
    { id: 'n2', tStart: 12, tEnd: 25, text: 'Nunca volvimos a saber de él hasta muchos años después.' },
    { id: 'n3', tStart: 300, tEnd: 312, text: 'Mi padre se marchó en el cuarenta y siete.' },
  ];
  const result = T.remapAnnotation(
    { tStart: 1, tEnd: 10, quoteSnapshot: 'se marchó en el cuarenta y siete' },
    rewritten
  );
  assert.equal(result.status, 'needs_review');
  assert.equal(result.segmentId, null);
  // Y conserva los tiempos originales para que el usuario pueda ir a mirar.
  assert.equal(result.tStart, 1);
  assert.equal(result.tEnd, 10);
});

test('una cita que cruza el corte de dos segmentos se reancla al tramo completo', () => {
  const result = T.remapAnnotation(
    { tStart: 5, tEnd: 20, quoteSnapshot: 'cuarenta y siete. Nunca volvimos a saber de él' },
    SEGMENTS
  );
  assert.equal(result.status, 'valid');
  assert.equal(result.tStart, 0);
  assert.equal(result.tEnd, 25);
});

test('sin segmentos cercanos, needs_review; nunca un tramo lejano', () => {
  const result = T.remapAnnotation(
    { tStart: 900, tEnd: 910, quoteSnapshot: 'Mi padre se marchó' },
    SEGMENTS
  );
  assert.equal(result.status, 'needs_review');
});

// ── 5. Tiempos y citas ───────────────────────────────────────────────────────

test('los códigos de tiempo van y vuelven', () => {
  assert.equal(T.formatTimecode(0), '00:00:00');
  assert.equal(T.formatTimecode(751), '00:12:31');
  assert.equal(T.formatTimecode(3671.9), '01:01:11');
  assert.equal(T.parseTimecode('00:12:31'), 751);
  assert.equal(T.parseTimecode('12:31'), 751);
  assert.equal(T.parseTimecode('1:01:11'), 3671);
  assert.equal(T.parseTimecode('00:75:00'), null);
  assert.equal(T.parseTimecode('no es un tiempo'), null);
});

test('la cita humana lleva narrador, entrevistador, fecha, tramo y bóveda', () => {
  const citation = T.formatCitation({
    displayName: 'Carmen R.',
    interviewerName: 'Jorge P.',
    dateText: '28 de julio de 2026',
    tStart: 751,
    tEnd: 788,
    vaultName: 'Memoria del valle',
  });
  assert.equal(
    citation,
    'Carmen R., entrevista por Jorge P., 28 de julio de 2026, 00:12:31–00:13:08, Bóveda «Memoria del valle».'
  );
});

test('el nombre mostrado obedece siempre al más restrictivo de los dos ejes', () => {
  const identified = { workingName: 'Carmen Ruiz', publicName: 'Carmen R.', identityMode: 'identified' };
  assert.equal(T.displayNameFor(identified, 'real_name'), 'Carmen Ruiz');
  // El acuerdo puede rebajar lo que el perfil permite.
  assert.equal(T.displayNameFor(identified, 'public_name'), 'Carmen R.');
  assert.equal(T.displayNameFor(identified, 'anonymous'), 'Carmen R.');
  // Y el perfil puede rebajar lo que el acuerdo permite.
  const anonymous = { workingName: 'Carmen Ruiz', publicName: '', identityMode: 'anonymous' };
  assert.equal(T.displayNameFor(anonymous, 'real_name'), 'Narrador anónimo');
  assert.equal(A.effectiveAttribution('anonymous', 'real_name'), 'anonymous');
  assert.equal(A.effectiveAttribution('pseudonym', 'real_name'), 'public_name');
  assert.equal(A.effectiveAttribution('identified', 'real_name'), 'real_name');
});

test('el título propuesto degrada bien cuando falta un dato', () => {
  assert.equal(T.proposeInterviewTitle('Carmen R.', '12/03/2026'), 'Entrevista a Carmen R. — 12/03/2026');
  assert.equal(T.proposeInterviewTitle('Carmen R.', null), 'Entrevista a Carmen R.');
  assert.equal(T.proposeInterviewTitle(null, null), 'Entrevista sin título');
});

// ── 6. La puerta de acceso ───────────────────────────────────────────────────

const NOW = new Date('2026-07-28T12:00:00Z');
const documented = (over = {}) => ({
  agreementStatus: 'documented',
  accessLevel: 'open',
  attributionMode: 'real_name',
  embargoUntil: undefined,
  documentedUses: ['research', 'publication', 'ai_processing'],
  ...over,
});

test('la búsqueda local nunca se bloquea: el investigador custodia lo que ve', () => {
  for (const status of ['pending', 'documented', 'update_required', 'withdrawn']) {
    assert.equal(A.isAllowed(documented({ agreementStatus: status }), 'localSearch', { now: NOW }), true, status);
  }
});

test('un acuerdo retirado cierra todas las salidas', () => {
  const withdrawn = documented({ agreementStatus: 'withdrawn' });
  for (const channel of A.ACCESS_CHANNELS) {
    const decision = A.evaluateAccess(withdrawn, channel, { now: NOW });
    if (channel === 'localSearch') {
      assert.equal(decision.allowed, true);
    } else {
      assert.equal(decision.allowed, false, channel);
      assert.equal(decision.reason, 'agreement_withdrawn', channel);
    }
  }
});

test('sin uso de IA documentado, la IA local tampoco entra', () => {
  const decision = A.evaluateAccess(documented({ documentedUses: ['research'] }), 'localAi', { now: NOW });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'ai_not_documented');
  assert.equal(A.isAllowed(documented(), 'localAi', { now: NOW }), true);
});

test('el proveedor externo exige acuerdo, ajuste del vault y confirmación', () => {
  const ctx = documented({ documentedUses: ['research', 'ai_processing', 'external_processing'] });
  // Por omisión el vault los tiene desactivados.
  assert.equal(A.evaluateAccess(ctx, 'externalAi', { now: NOW }).reason, 'vault_external_disabled');
  const policy = { allowExternalProviders: true };
  const ok = A.evaluateAccess(ctx, 'externalAi', { now: NOW, policy });
  assert.equal(ok.allowed, true);
  assert.equal(ok.requiresConfirmation, true, 'el audio o el texto salen del equipo: se confirma cada vez');
  // El ajuste del equipo no abre lo que el acuerdo cierra.
  const sinUso = documented({ documentedUses: ['research', 'ai_processing'] });
  assert.equal(A.evaluateAccess(sinUso, 'externalAi', { now: NOW, policy }).reason, 'external_not_documented');
  // Ni lo que el nivel de acceso cierra.
  const privada = documented({ accessLevel: 'private', documentedUses: ['external_processing'] });
  assert.equal(A.evaluateAccess(privada, 'externalTranscription', { now: NOW, policy }).reason, 'access_private');
});

test('un embargo sin fecha no vence solo', () => {
  const ctx = documented({ accessLevel: 'embargoed', embargoUntil: null });
  assert.equal(A.isEmbargoActive(null, NOW), true);
  assert.equal(A.evaluateAccess(ctx, 'accessExport', { now: NOW }).reason, 'embargo_active');
  // Dentro de veinte años sigue activo: solo una decisión manual lo levanta.
  assert.equal(A.isEmbargoActive(null, new Date('2046-01-01T00:00:00Z')), true);
});

test('un embargo con fecha bloquea antes y deja de bloquear después', () => {
  const ctx = documented({ accessLevel: 'embargoed', embargoUntil: '2030-01-01T00:00:00Z' });
  assert.equal(A.evaluateAccess(ctx, 'accessExport', { now: NOW }).reason, 'embargo_active');
  assert.equal(A.evaluateAccess(ctx, 'accessExport', { now: new Date('2031-01-01T00:00:00Z') }).allowed, true);
  assert.equal(A.daysUntilEmbargoEnds('2026-08-07T12:00:00Z', NOW), 10);
});

test('un embargo protege del público, no del propio narrador', () => {
  const ctx = documented({ accessLevel: 'embargoed', embargoUntil: null });
  assert.equal(A.isAllowed(ctx, 'reviewExport', { now: NOW }), true);
  assert.equal(A.isAllowed(ctx, 'accessExport', { now: NOW }), false);
});

test('restringida no sale en el paquete de consulta pero sí en el de preservación', () => {
  const ctx = documented({ accessLevel: 'restricted' });
  assert.equal(A.evaluateAccess(ctx, 'accessExport', { now: NOW }).reason, 'access_restricted');
  const preservation = A.evaluateAccess(ctx, 'preservationExport', { now: NOW });
  assert.equal(preservation.allowed, true);
  assert.equal(preservation.requiresConfirmation, true);
});

test('el paquete de consulta exige un uso de difusión documentado', () => {
  const solo = documented({ documentedUses: ['research'] });
  assert.equal(A.evaluateAccess(solo, 'accessExport', { now: NOW }).reason, 'use_not_documented');
  assert.equal(A.isAllowed(documented({ documentedUses: ['publication'] }), 'accessExport', { now: NOW }), true);
});

test('un seudónimo permite salir, pero marcado', () => {
  const ctx = documented({ attributionMode: 'public_name' });
  const decision = A.evaluateAccess(ctx, 'accessExport', { now: NOW });
  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresPseudonymization, true);
});

test('el hueco entre crear una entrevista y documentar su acuerdo es restrictivo', () => {
  const ctx = A.pendingAccessContext();
  assert.equal(ctx.accessLevel, 'private');
  assert.equal(A.isAllowed(ctx, 'localAi'), false);
  assert.equal(A.isAllowed(ctx, 'accessExport'), false);
  assert.equal(A.isAllowed(ctx, 'localSearch'), true);
  // Guardar en el archivo lo que aún no tiene acuerdo es exactamente lo que hay que hacer.
  assert.equal(A.isAllowed(ctx, 'preservationExport'), true);
});

// ── 7. Enlaces profundos ─────────────────────────────────────────────────────

test('un enlace de fragmento va y vuelve entero', () => {
  const link = {
    target: 'interview',
    id: 'int_7',
    sessionId: 'ses_1',
    transcriptId: 'trn_3',
    annotationId: 'ann_9',
    t: 531.24,
  };
  const url = L.buildTestimonyLink(link);
  assert.match(url, /^nodus:\/\/testimonios\/interview\/int_7\?/);
  const parsed = L.parseTestimonyLink(url);
  assert.equal(parsed.target, 'interview');
  assert.equal(parsed.id, 'int_7');
  assert.equal(parsed.sessionId, 'ses_1');
  assert.equal(parsed.transcriptId, 'trn_3');
  assert.equal(parsed.annotationId, 'ann_9');
  assert.equal(parsed.t, 531.2, 'los segundos se redondean a décimas');
});

test('un enlace ajeno o mal formado no se abre', () => {
  assert.equal(L.parseTestimonyLink('nodus://world/character/prs_7'), null);
  assert.equal(L.parseTestimonyLink('https://example.com'), null);
  assert.equal(L.parseTestimonyLink('nodus://testimonios/interview/'), null);
  assert.equal(L.parseTestimonyLink('nodus://testimonios/desconocido/1'), null);
});

test('los identificadores raros sobreviven al viaje', () => {
  const url = L.buildTestimonyLink({ target: 'participant', id: 'prs/con espacio & signo' });
  assert.equal(L.parseTestimonyLink(url).id, 'prs/con espacio & signo');
});

test('exportar una nota degrada los enlaces a su etiqueta', () => {
  const md = `Ver ${L.testimonyLinkMarkdown('Abrir fragmento', { target: 'interview', id: 'int_1', t: 12 })} y nada más.`;
  assert.equal(L.extractTestimonyLinks(md).length, 1);
  assert.equal(L.stripTestimonyLinks(md), 'Ver Abrir fragmento y nada más.');
});

// ── 8. Vistas guardadas y etiquetas ──────────────────────────────────────────

test('las siete vistas de fábrica existen y son coherentes', () => {
  const ids = T.DEFAULT_INTERVIEW_VIEWS.map((v) => v.id);
  assert.deepEqual(ids, ['all', 'upcoming', 'pending-transcription', 'reviewing', 'narrator', 'completed', 'restricted']);
  for (const view of T.DEFAULT_INTERVIEW_VIEWS) {
    for (const status of view.filters.workflowStatus ?? []) {
      assert.ok(T.INTERVIEW_WORKFLOW_STATUSES.includes(status), `${view.id}: ${status}`);
    }
    for (const level of view.filters.accessLevel ?? []) {
      assert.ok(T.ACCESS_LEVELS.includes(level), `${view.id}: ${level}`);
    }
  }
});

test('cada valor del dominio tiene etiqueta: ninguna pantalla puede quedar en blanco', () => {
  const pairs = [
    [T.INTERVIEW_WORKFLOW_STATUSES, LB.WORKFLOW_STATUS_LABEL, 'workflow'],
    [T.AGREEMENT_STATUSES, LB.AGREEMENT_STATUS_LABEL, 'agreement'],
    [T.ACCESS_LEVELS, LB.ACCESS_LEVEL_LABEL, 'access'],
    [T.ACCESS_LEVELS, LB.ACCESS_LEVEL_HINT, 'access hint'],
    [T.ATTRIBUTION_MODES, LB.ATTRIBUTION_MODE_LABEL, 'attribution'],
    [T.NARRATOR_REVIEW_STATUSES, LB.NARRATOR_REVIEW_STATUS_LABEL, 'narrator review'],
    [T.DOCUMENTED_USES, LB.DOCUMENTED_USE_LABEL, 'uses'],
    [T.INTERVIEW_KINDS, LB.INTERVIEW_KIND_LABEL, 'kind'],
    [T.INTERVIEW_MODES, LB.INTERVIEW_MODE_LABEL, 'mode'],
    [T.PARTICIPANT_ROLES, LB.PARTICIPANT_ROLE_LABEL, 'role'],
    [T.IDENTITY_MODES, LB.IDENTITY_MODE_LABEL, 'identity'],
    [T.SESSION_STATUSES, LB.SESSION_STATUS_LABEL, 'session'],
    [T.MEDIA_KINDS, LB.MEDIA_KIND_LABEL, 'media kind'],
    [T.MEDIA_ROLES, LB.MEDIA_ROLE_LABEL, 'media role'],
    [T.TRANSCRIPT_KINDS, LB.TRANSCRIPT_KIND_LABEL, 'transcript kind'],
    [T.TRANSCRIPT_KINDS, LB.TRANSCRIPT_KIND_HINT, 'transcript hint'],
    [T.TRANSCRIPT_STATUSES, LB.TRANSCRIPT_STATUS_LABEL, 'transcript status'],
    [T.ANNOTATION_KINDS, LB.ANNOTATION_KIND_LABEL, 'annotation'],
    [T.CODE_KINDS, LB.CODE_KIND_LABEL, 'code kind'],
    [A.ACCESS_CHANNELS, LB.ACCESS_CHANNEL_LABEL, 'channel'],
  ];
  for (const [values, table, name] of pairs) {
    for (const value of values) {
      assert.ok(table[value], `${name}: falta etiqueta para ${value}`);
    }
  }
  // Y todos los motivos de denegación se explican al usuario.
  for (const reason of Object.keys(LB.ACCESS_DENIAL_LABEL)) {
    assert.ok(LB.ACCESS_DENIAL_LABEL[reason].length > 10, reason);
  }
  for (const kind of Object.keys(LB.ALERT_LABEL)) {
    assert.ok(LB.ALERT_HINT[kind], `falta la explicación de la alerta ${kind}`);
  }
});

test('los identificadores cortos van y vuelven', () => {
  assert.equal(T.formatShortId('INT', 1), 'INT-0001');
  assert.equal(T.formatShortId('ANN', 12345), 'ANN-12345');
  assert.deepEqual(T.parseShortId('int-0007'), { prefix: 'INT', sequence: 7 });
  assert.equal(T.parseShortId('XXX-0001'), null);
});

test('los usos documentados sobreviven a un JSON corrupto', () => {
  assert.deepEqual(T.parseDocumentedUses('["research","inventado"]'), ['research']);
  assert.deepEqual(T.parseDocumentedUses('no es json'), []);
  assert.deepEqual(T.parseDocumentedUses(null), []);
  assert.equal(T.serializeDocumentedUses(['research', 'research', 'teaching']), '["research","teaching"]');
});

test('la duración se lee de un vistazo', () => {
  assert.equal(T.formatDuration(null), '—');
  assert.equal(T.formatDuration(38), '38 s');
  assert.equal(T.formatDuration(2820), '47 min');
  assert.equal(T.formatDuration(4320), '1 h 12 min');
  assert.equal(T.formatDuration(7200), '2 h');
});
