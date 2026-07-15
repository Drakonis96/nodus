import { getDb } from './database';
import { getSettings, updateSettings } from './settingsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { clearStudyAssistantDemoConversation, seedStudyAssistantDemoConversation } from '../ai/studyAssistant';

const ID = {
  course: 'demo-study-course-biology',
  subjectCell: 'demo-study-subject-cell',
  subjectEco: 'demo-study-subject-ecology',
  folderCell: 'demo-study-folder-cell',
  topicMembrane: 'demo-study-topic-membrane',
  topicEcosystem: 'demo-study-topic-ecosystem',
  documentCell: 'demo-study-doc-cell',
  documentEco: 'demo-study-doc-ecosystem',
  documentVersion: 'demo-study-doc-version-cell',
  documentAnnotation: 'demo-study-doc-annotation-cell',
  documentLink: 'demo-study-doc-link-cell-eco',
  placementCell: 'demo-study-placement-cell',
  placementEco: 'demo-study-placement-ecosystem',
  tagExam: 'demo-study-tag-exam',
  docTag: 'demo-study-doc-tag',
  template: 'demo-study-template-cornell',
  material: 'demo-study-material-membrane',
  materialPlacement: 'demo-study-material-placement',
  materialAnnotation: 'demo-study-material-annotation',
  materialLink: 'demo-study-material-link',
  materialVersion: 'demo-study-material-version',
  recording: 'demo-study-recording-cell',
  transcript: 'demo-study-transcript-cell',
  transcriptSegment: 'demo-study-transcript-segment-cell',
  audioMarker: 'demo-study-audio-marker-cell',
  question: 'demo-study-question-membrane',
  questionVersion: 'demo-study-question-version-membrane',
  assessment: 'demo-study-assessment-cell',
  assessmentItem: 'demo-study-assessment-item-cell',
  attempt: 'demo-study-attempt-cell',
  attemptAnswer: 'demo-study-attempt-answer-cell',
  flashcard: 'demo-study-flashcard-membrane',
  review: 'demo-study-review-membrane',
  mastery: 'demo-study-mastery-cell',
  plan: 'demo-study-plan-final',
  block: 'demo-study-block-review',
  event: 'demo-study-event-exam',
  goal: 'demo-study-goal-weekly',
  studySession: 'demo-study-session-cell',
  scheduleMorning: 'demo-study-schedule-morning',
  scheduleAfternoon: 'demo-study-schedule-afternoon',
  ideaMosaic: 'demo-study-idea-mosaic',
  ideaPermeability: 'demo-study-idea-permeability',
  ideaPassive: 'demo-study-idea-passive',
  ideaActive: 'demo-study-idea-active',
  ideaProducers: 'demo-study-idea-producers',
  ideaTransfer: 'demo-study-idea-transfer',
  ideaDissipation: 'demo-study-idea-dissipation',
} as const;

function demoWav(): Buffer {
  const sampleRate = 8_000; const seconds = 2; const samples = sampleRate * seconds;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) pcm.writeInt16LE(Math.round(Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 900), i * 2);
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44); return wav;
}

/** Detect an already-loaded sample workspace without treating user data as a blocker. */
export function hasStudyDemoBlockingData(): boolean {
  return Number((getDb().prepare('SELECT COUNT(*) AS value FROM study_courses WHERE id = ?').get(ID.course) as { value: number }).value) > 0;
}

export function seedStudyDemoData(): boolean {
  if (getActiveVault().type !== 'estudio' || hasStudyDemoBlockingData()) return false;
  const db = getDb();
  const now = new Date();
  const createdAt = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  const updatedAt = now.toISOString();
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString();
  const examAt = new Date(now.getTime() + 12 * 86_400_000).toISOString();
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000).toISOString();

  db.transaction(() => {
    db.prepare(`INSERT INTO study_courses
      (id,short_id,name,description,color,icon,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.course, 'CRS-DEMO1', 'Biología general', 'Curso de ejemplo local para explorar el vault de estudio.', '#0f766e', 'graduation', 1, 0, createdAt, updatedAt);

    const insertSubject = db.prepare(`INSERT INTO study_subjects
      (id,short_id,course_id,name,description,color,icon,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insertSubject.run(ID.subjectCell, 'SUB-DEMO1', ID.course, 'Biología celular', 'Estructura y función de la célula.', '#0d9488', 'microscope', 1, 0, createdAt, updatedAt);
    insertSubject.run(ID.subjectEco, 'SUB-DEMO2', ID.course, 'Ecología', 'Relaciones entre organismos y ecosistemas.', '#15803d', 'leaf', 0, 1, createdAt, updatedAt);

    db.prepare(`INSERT INTO study_folders
      (id,short_id,course_id,subject_id,name,description,color,icon,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.folderCell, 'FLD-DEMO1', ID.course, ID.subjectCell, 'Unidad 1 · La célula', 'Temas y materiales de la primera unidad.', '#0d9488', 'folder', 1, 0, createdAt, updatedAt);

    const insertTopic = db.prepare(`INSERT INTO study_topics
      (id,short_id,subject_id,folder_id,parent_id,name,description,color,icon,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insertTopic.run(ID.topicMembrane, 'TOP-DEMO1', ID.subjectCell, ID.folderCell, null, 'Membrana plasmática', 'Transporte, composición y señalización.', '#14b8a6', 'layers', 1, 0, createdAt, updatedAt);
    insertTopic.run(ID.topicEcosystem, 'TOP-DEMO2', ID.subjectEco, null, null, 'Flujo de energía', 'Niveles tróficos y productividad.', '#22c55e', 'sun', 0, 0, createdAt, updatedAt);

    const insertDocument = db.prepare(`INSERT INTO study_docs
      (id,short_id,title,kind,content_markdown,description,color,icon,favorite,pinned,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insertDocument.run(
      ID.documentCell, 'DOC-DEMO1', 'Membrana plasmática · resumen', 'apunte',
      '# Membrana plasmática\n\nLa membrana sigue el **modelo de mosaico fluido**: una bicapa de fosfolípidos con proteínas móviles.\n\n## Transporte\n\n- La difusión simple no consume ATP.\n- El transporte activo mueve solutos contra gradiente.\n- La ósmosis describe el movimiento neto de agua.\n\n> Pregunta clave: ¿qué determina la permeabilidad selectiva?',
      'Apunte de ejemplo con conceptos, lista y pregunta de repaso.', '#0f766e', 'notebook', 1, 1, 0, createdAt, updatedAt,
    );
    insertDocument.run(
      ID.documentEco, 'DOC-DEMO2', 'Flujo de energía en ecosistemas', 'manual',
      '# Flujo de energía\n\nLos productores transforman energía luminosa en energía química. En cada transferencia trófica una parte se disipa como calor.\n\n## Para repasar\n\n1. Diferencia productividad primaria bruta y neta.\n2. Explica por qué la energía no se recicla como la materia.',
      'Material breve para practicar búsqueda y planificación.', '#15803d', 'book', 0, 0, 1, createdAt, updatedAt,
    );

    db.prepare(`INSERT INTO study_doc_versions
      (id,short_id,document_id,version_no,title,content_markdown,style_json,reason,content_hash,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.documentVersion, 'DVE-DEMO1', ID.documentCell, 1, 'Membrana plasmática · resumen', '# Membrana plasmática\n\nPrimera versión del apunte: bicapa de fosfolípidos y transporte celular.', '{}', 'manual', 'demo-study-doc-cell-v1', 0, createdAt, createdAt);
    db.prepare(`INSERT INTO study_annotations
      (id,short_id,document_id,from_pos,to_pos,selected_text,comment,color,locked,pinned,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.documentAnnotation, 'ANN-DEMO1', ID.documentCell, 54, 81, 'bicapa de fosfolípidos', 'Relacionar esta estructura con la permeabilidad selectiva.', '#f59e0b', 0, 1, 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_doc_links
      (id,short_id,source_document_id,target_document_id,target_ref,target_title,link_text,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.documentLink, 'DLK-DEMO1', ID.documentCell, ID.documentEco, `study-doc://${ID.documentEco}`, 'Flujo de energía en ecosistemas', 'Comparar con flujo de energía', 0, createdAt, updatedAt);

    const insertPlacement = db.prepare(`INSERT INTO study_placements
      (id,short_id,document_id,course_id,subject_id,topic_id,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    insertPlacement.run(ID.placementCell, 'PLC-DEMO1', ID.documentCell, ID.course, ID.subjectCell, ID.topicMembrane, 0, createdAt, updatedAt);
    insertPlacement.run(ID.placementEco, 'PLC-DEMO2', ID.documentEco, ID.course, ID.subjectEco, ID.topicEcosystem, 0, createdAt, updatedAt);

    const materialText = '# Guía de laboratorio · ósmosis\n\nObjetivo: observar el movimiento de agua a través de una membrana semipermeable.\n\n## Procedimiento\n\n1. Preparar tres disoluciones con distinta concentración.\n2. Registrar la masa inicial y final.\n3. Explicar los resultados mediante el gradiente osmótico.\n';
    const materialBlob = Buffer.from(materialText, 'utf8');
    db.prepare(`INSERT INTO study_materials
      (id,short_id,title,description,file_name,mime_type,extension,content_blob,content_hash,extracted_text,extraction_status,metadata_json,bibliography_json,read_state,size_bytes,favorite,pinned,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.material, 'MAT-DEMO1', 'Guía de laboratorio · ósmosis', 'Material Markdown de ejemplo, listo para abrir, anotar y relacionar.', 'guia-osmosis.md', 'text/markdown', 'md', materialBlob, 'demo-study-material-osmosis-v1', materialText, 'ready', JSON.stringify({ author: 'Departamento de Biología', language: 'es', pages: 2 }), JSON.stringify({ type: 'manual', title: 'Guía de laboratorio · ósmosis', year: 2026 }), 'reading', materialBlob.length, 1, 1, 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_material_placements
      (id,short_id,material_id,course_id,subject_id,topic_id,folder_id,document_id,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.materialPlacement, 'MPL-DEMO1', ID.material, ID.course, ID.subjectCell, ID.topicMembrane, ID.folderCell, ID.documentCell, 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_material_annotations
      (id,short_id,material_id,from_pos,to_pos,selected_text,note,color,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.materialAnnotation, 'MAN-DEMO1', ID.material, 36, 111, 'observar el movimiento de agua a través de una membrana semipermeable', 'Idea central del experimento.', '#14b8a6', 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_material_fragment_links
      (id,short_id,material_id,annotation_id,document_id,doc_from_pos,doc_to_pos,label,source_json,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.materialLink, 'MFL-DEMO1', ID.material, ID.materialAnnotation, ID.documentCell, 270, 315, 'Ósmosis y permeabilidad', JSON.stringify({ pageNumber: 1, excerpt: 'movimiento de agua' }), 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_material_versions
      (id,short_id,material_id,version_no,file_name,mime_type,content_blob,content_hash,extracted_text,metadata_json,size_bytes,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.materialVersion, 'MVE-DEMO1', ID.material, 1, 'guia-osmosis.md', 'text/markdown', materialBlob, 'demo-study-material-osmosis-v1', materialText, JSON.stringify({ reason: 'import' }), materialBlob.length, createdAt);

    const audioBlob = demoWav();
    db.prepare(`INSERT INTO study_recordings
      (id,short_id,title,file_name,mime_type,audio_blob,content_hash,duration_seconds,size_bytes,language,course_id,subject_id,topic_id,document_id,material_id,session_label,processing_status,processing_progress,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.recording, 'REC-DEMO1', 'Clase · transporte a través de membrana', 'clase-membrana-demo.wav', 'audio/wav', audioBlob, 'demo-study-recording-cell-v1', 2, audioBlob.length, 'es', ID.course, ID.subjectCell, ID.topicMembrane, ID.documentCell, ID.material, 'Clase 3', 'ready', 1, 1, 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_transcripts
      (id,short_id,recording_id,kind,content_markdown,language,status,progress,version_no,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.transcript, 'TRN-DEMO1', ID.recording, 'literal', 'La membrana plasmática regula el intercambio con el medio. La difusión ocurre a favor del gradiente; el transporte activo requiere energía.', 'es', 'ready', 1, 1, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_transcript_segments
      (id,short_id,transcript_id,t_start,t_end,text,speaker,confidence,chapter,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.transcriptSegment, 'TSG-DEMO1', ID.transcript, 0, 2, 'La membrana regula el intercambio; el transporte activo requiere energía.', 'Profesora', 0.98, 'Transporte celular', 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_audio_markers
      (id,short_id,recording_id,t_seconds,label,note,color,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.audioMarker, 'AMK-DEMO1', ID.recording, 1, 'Concepto clave', 'Diferencia entre transporte pasivo y activo.', '#f59e0b', 0, createdAt, updatedAt);

    const insertIdea = db.prepare(`INSERT INTO study_ideas
      (id,subject_id,type,label,normalized_label,statement,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
    insertIdea.run(ID.ideaMosaic, ID.subjectCell, 'concept', 'Modelo de mosaico fluido', 'modelo de mosaico fluido', 'La membrana es una bicapa de fosfolípidos con proteínas móviles.', createdAt, updatedAt);
    insertIdea.run(ID.ideaPermeability, ID.subjectCell, 'principle', 'Permeabilidad selectiva', 'permeabilidad selectiva', 'La composición de la membrana determina qué sustancias pueden atravesarla.', createdAt, updatedAt);
    insertIdea.run(ID.ideaPassive, ID.subjectCell, 'process', 'Transporte pasivo', 'transporte pasivo', 'La difusión simple y la ósmosis ocurren sin consumo de ATP.', createdAt, updatedAt);
    insertIdea.run(ID.ideaActive, ID.subjectCell, 'process', 'Transporte activo', 'transporte activo', 'El transporte activo desplaza solutos contra gradiente y requiere energía.', createdAt, updatedAt);
    insertIdea.run(ID.ideaProducers, ID.subjectEco, 'concept', 'Productores', 'productores', 'Los productores transforman energía luminosa en energía química.', createdAt, updatedAt);
    insertIdea.run(ID.ideaTransfer, ID.subjectEco, 'process', 'Transferencia trófica', 'transferencia trofica', 'La energía química pasa entre niveles tróficos mediante la alimentación.', createdAt, updatedAt);
    insertIdea.run(ID.ideaDissipation, ID.subjectEco, 'consequence', 'Disipación de energía', 'disipacion de energia', 'En cada transferencia trófica parte de la energía se disipa como calor.', createdAt, updatedAt);

    const insertOccurrence = db.prepare(`INSERT INTO study_idea_occurrences
      (id,idea_id,source_kind,source_id,source_title,source_hash,role,confidence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const insertEvidence = db.prepare(`INSERT INTO study_idea_evidence
      (id,occurrence_id,quote,location,position,created_at) VALUES (?,?,?,?,?,?)`);
    const cellEvidence = [
      [ID.ideaMosaic, 'La membrana sigue el modelo de mosaico fluido: una bicapa de fosfolípidos con proteínas móviles.'],
      [ID.ideaPermeability, '¿qué determina la permeabilidad selectiva?'],
      [ID.ideaPassive, 'La difusión simple no consume ATP.'],
      [ID.ideaActive, 'El transporte activo mueve solutos contra gradiente.'],
    ] as const;
    for (const [ideaId, quote] of cellEvidence) {
      const occurrenceId = `${ideaId}-occurrence`; insertOccurrence.run(occurrenceId, ideaId, 'document', ID.documentCell, 'Membrana plasmática · resumen', 'demo-cell-v1', 'principal', 0.95, createdAt, updatedAt);
      insertEvidence.run(`${ideaId}-evidence`, occurrenceId, quote, 'Apunte de demostración', 0, createdAt);
    }
    const ecoEvidence = [
      [ID.ideaProducers, 'Los productores transforman energía luminosa en energía química.'],
      [ID.ideaTransfer, 'En cada transferencia trófica una parte se disipa como calor.'],
      [ID.ideaDissipation, 'En cada transferencia trófica una parte se disipa como calor.'],
    ] as const;
    for (const [ideaId, quote] of ecoEvidence) {
      const occurrenceId = `${ideaId}-occurrence`; insertOccurrence.run(occurrenceId, ideaId, 'document', ID.documentEco, 'Flujo de energía en ecosistemas', 'demo-eco-v1', 'principal', 0.94, createdAt, updatedAt);
      insertEvidence.run(`${ideaId}-evidence`, occurrenceId, quote, 'Apunte de demostración', 0, createdAt);
    }

    const insertEdge = db.prepare(`INSERT INTO study_idea_edges
      (id,subject_id,from_id,to_id,type,basis,confidence,source_kind,source_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insertEdge.run('demo-study-edge-mosaic-permeability', ID.subjectCell, ID.ideaMosaic, ID.ideaPermeability, 'supports', 'La estructura de bicapa y proteínas explica la selección de sustancias.', 0.91, 'document', ID.documentCell, createdAt, updatedAt);
    insertEdge.run('demo-study-edge-passive-active', ID.subjectCell, ID.ideaPassive, ID.ideaActive, 'contrasts', 'Se diferencian por el uso de energía y la dirección respecto al gradiente.', 0.97, 'document', ID.documentCell, createdAt, updatedAt);
    insertEdge.run('demo-study-edge-permeability-passive', ID.subjectCell, ID.ideaPermeability, ID.ideaPassive, 'applies', 'La permeabilidad condiciona qué moléculas pueden difundirse.', 0.86, 'document', ID.documentCell, createdAt, updatedAt);
    insertEdge.run('demo-study-edge-producers-transfer', ID.subjectEco, ID.ideaProducers, ID.ideaTransfer, 'causes', 'La energía fijada por productores inicia el flujo entre niveles tróficos.', 0.92, 'document', ID.documentEco, createdAt, updatedAt);
    insertEdge.run('demo-study-edge-transfer-dissipation', ID.subjectEco, ID.ideaTransfer, ID.ideaDissipation, 'causes', 'Cada transferencia energética conlleva pérdidas en forma de calor.', 0.96, 'document', ID.documentEco, createdAt, updatedAt);

    const insertKnowledgeJob = db.prepare(`INSERT INTO study_knowledge_jobs
      (subject_id,source_kind,source_id,status,phase,source_hash,updated_at) VALUES (?,?,?,?,?,?,?)`);
    insertKnowledgeJob.run(ID.subjectCell, 'document', ID.documentCell, 'done', 'done', 'demo-cell-v1', updatedAt);
    insertKnowledgeJob.run(ID.subjectEco, 'document', ID.documentEco, 'done', 'done', 'demo-eco-v1', updatedAt);

    db.prepare(`INSERT INTO study_tags
      (id,short_id,name,description,color,icon,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.tagExam, 'TAG-DEMO1', 'Examen final', 'Contenido prioritario para el examen.', '#f59e0b', 'star', 1, 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_doc_tags
      (id,short_id,document_id,tag_id,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run(ID.docTag, 'DTG-DEMO1', ID.documentCell, ID.tagExam, 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_templates
      (id,short_id,kind,name,description,content_json,color,icon,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.template, 'TPL-DEMO1', 'document', 'Apunte Cornell', 'Plantilla reutilizable de ejemplo.', JSON.stringify({ document: { title: 'Nuevo apunte Cornell', kind: 'apunte', contentMarkdown: '# Tema\n\n## Notas\n\n## Preguntas\n\n## Resumen' } }), '#0f766e', 'notebook', 1, 0, createdAt, updatedAt);

    db.prepare(`INSERT INTO study_questions
      (id,short_id,prompt,question_type,difficulty,cognitive_level,status,answer_json,options_json,explanation,tags_json,course_id,subject_id,topic_id,document_id,source_title,source_excerpt,source_location_json,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.question, 'QUE-DEMO1', '¿Qué mecanismo mueve solutos contra su gradiente de concentración?', 'single_choice', 'easy', 'understand', 'approved', JSON.stringify({ value: 'Transporte activo' }), JSON.stringify(['Difusión simple', 'Ósmosis', 'Transporte activo', 'Filtración']), 'El transporte activo consume energía para desplazar solutos contra gradiente.', JSON.stringify(['membrana', 'transporte']), ID.course, ID.subjectCell, ID.topicMembrane, ID.documentCell, 'Membrana plasmática · resumen', 'El transporte activo mueve solutos contra gradiente.', JSON.stringify({ from: 150, to: 208 }), 1, 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_question_versions
      (id,short_id,question_id,version_no,snapshot_json,reason,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(ID.questionVersion, 'QVE-DEMO1', ID.question, 1, JSON.stringify({ prompt: '¿Qué mecanismo mueve solutos contra su gradiente de concentración?' }), 'create', createdAt);

    db.prepare(`INSERT INTO study_assessments
      (id,short_id,kind,title,description,course_id,subject_id,topic_id,config_json,duration_minutes,max_attempts,favorite,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.assessment, 'ASM-DEMO1', 'test', 'Práctica de membrana', 'Test de ejemplo listo para iniciar.', ID.course, ID.subjectCell, ID.topicMembrane, JSON.stringify({ shuffle: false, feedback: 'immediate' }), 10, 0, 1, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_assessment_items
      (id,short_id,assessment_id,question_id,points,required,position,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(ID.assessmentItem, 'ASI-DEMO1', ID.assessment, ID.question, 1, 1, 0, createdAt);
    db.prepare(`INSERT INTO study_attempts
      (id,short_id,assessment_id,mode,status,score,max_score,correct_count,incorrect_count,omitted_count,duration_seconds,started_at,submitted_at,config_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.attempt, 'ATT-DEMO1', ID.assessment, 'practice', 'submitted', 1, 1, 1, 0, 0, 42, createdAt, updatedAt, JSON.stringify({ feedback: 'immediate' }), createdAt, updatedAt);
    db.prepare(`INSERT INTO study_attempt_answers
      (id,short_id,attempt_id,assessment_item_id,question_id,response_json,is_correct,points_awarded,response_ms,flagged,confidence,feedback_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.attemptAnswer, 'AAN-DEMO1', ID.attempt, ID.assessmentItem, ID.question, JSON.stringify({ value: 'Transporte activo' }), 1, 1, 42_000, 0, 4, JSON.stringify({ message: 'Correcto: requiere energía para vencer el gradiente.' }), createdAt, updatedAt);

    db.prepare(`INSERT INTO study_flashcards
      (id,short_id,card_type,front,back,hint,tags_json,course_id,subject_id,topic_id,document_id,question_id,source_excerpt,difficulty,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.flashcard, 'FLC-DEMO1', 'front_back', '¿Qué hace el transporte activo?', 'Mueve solutos contra gradiente y requiere energía.', 'Piensa en la dirección del gradiente.', JSON.stringify(['membrana']), ID.course, ID.subjectCell, ID.topicMembrane, ID.documentCell, ID.question, 'El transporte activo mueve solutos contra gradiente.', 'easy', 1, 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_srs_state
      (card_id,ease_factor,interval_days,due_at,repetitions,lapses,mastered,excluded,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(ID.flashcard, 2.6, 3, updatedAt, 1, 0, 0, 0, updatedAt);
    db.prepare(`INSERT INTO study_reviews
      (id,short_id,card_id,rating,confidence,correct,elapsed_ms,previous_interval_days,next_interval_days,scheduled_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.review, 'REV-DEMO1', ID.flashcard, 4, 4, 1, 7_500, 0, 3, createdAt, createdAt);
    db.prepare(`INSERT INTO study_mastery
      (id,short_id,scope_kind,scope_id,mastery,confidence,evidence_count,status,last_activity_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.mastery, 'MAS-DEMO1', 'subject', ID.subjectCell, 0.62, 0.78, 3, 'learning', updatedAt, updatedAt);

    db.prepare(`INSERT INTO study_plans
      (id,short_id,title,description,course_id,subject_id,exam_at,available_minutes,config_json,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.plan, 'PLN-DEMO1', 'Preparación del examen final', 'Plan local de ejemplo con una sesión y una fecha clave.', ID.course, ID.subjectCell, examAt, 180, '{}', 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_plan_blocks
      (id,short_id,plan_id,title,block_type,course_id,subject_id,topic_id,starts_at,duration_minutes,status,priority,notes,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.block, 'BLK-DEMO1', ID.plan, 'Repasar transporte de membrana', 'review', ID.course, ID.subjectCell, ID.topicMembrane, tomorrow, 30, 'planned', 2, 'Completar las tarjetas pendientes.', 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_calendar_events
      (id,short_id,title,event_type,starts_at,all_day,course_id,subject_id,notes,reminder_minutes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.event, 'EVT-DEMO1', 'Examen final de Biología', 'exam', examAt, 1, ID.course, ID.subjectCell, 'Fecha de ejemplo editable.', 1440, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_goals
      (id,short_id,title,period,target_value,current_value,unit,starts_at,ends_at,subject_id,completed,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.goal, 'GOA-DEMO1', 'Completar tres sesiones', 'weekly', 3, 1, 'sesiones', updatedAt, weekEnd, ID.subjectCell, 0, createdAt, updatedAt);

    db.prepare(`INSERT INTO study_study_sessions
      (id,short_id,plan_block_id,subject_id,topic_id,mode,planned_minutes,actual_seconds,interruptions,started_at,ended_at,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.studySession, 'SES-DEMO1', ID.block, ID.subjectCell, ID.topicMembrane, 'focus', 25, 1_380, 1, createdAt, updatedAt, 'Repaso completado; revisar ósmosis mañana.', createdAt, updatedAt);

    const insertPeriod = db.prepare('INSERT INTO study_schedule_periods (id,section,label,start_time,end_time,position) VALUES (?,?,?,?,?,?)');
    insertPeriod.run(ID.scheduleMorning, 'morning', 'Primera hora', '09:00', '10:00', 0);
    insertPeriod.run(ID.scheduleAfternoon, 'afternoon', 'Tarde', '16:00', '17:00', 0);
    const insertCell = db.prepare('INSERT INTO study_schedule_cells (day,period_id,subject_id) VALUES (?,?,?)');
    insertCell.run('monday', ID.scheduleMorning, ID.subjectCell);
    insertCell.run('wednesday', ID.scheduleMorning, ID.subjectEco);
    insertCell.run('thursday', ID.scheduleAfternoon, ID.subjectCell);

    updateSettings({ demoMode: true, studyTourComplete: false });
  })();
  seedStudyAssistantDemoConversation();
  return true;
}

export function clearStudyDemoData(): void {
  const db = getDb();
  const hasRows = Number((db.prepare("SELECT COUNT(*) value FROM study_courses WHERE id LIKE 'demo-study-%'").get() as { value: number }).value) > 0;
  if (!hasRows && !getSettings().demoMode) return;
  db.transaction(() => {
    db.exec(`
      DELETE FROM study_schedule_cells WHERE period_id LIKE 'demo-study-%';
      DELETE FROM study_schedule_periods WHERE id LIKE 'demo-study-%';
      DELETE FROM study_study_sessions WHERE id LIKE 'demo-study-%';
      DELETE FROM study_goals WHERE id LIKE 'demo-study-%';
      DELETE FROM study_calendar_events WHERE id LIKE 'demo-study-%';
      DELETE FROM study_plan_blocks WHERE id LIKE 'demo-study-%';
      DELETE FROM study_plans WHERE id LIKE 'demo-study-%';
      DELETE FROM study_reviews WHERE id LIKE 'demo-study-%';
      DELETE FROM study_mastery WHERE id LIKE 'demo-study-%';
      DELETE FROM study_flashcards WHERE id LIKE 'demo-study-%';
      DELETE FROM study_attempt_answers WHERE id LIKE 'demo-study-%';
      DELETE FROM study_attempts WHERE id LIKE 'demo-study-%';
      DELETE FROM study_assessments WHERE id LIKE 'demo-study-%';
      DELETE FROM study_questions WHERE id LIKE 'demo-study-%';
      DELETE FROM study_audio_markers WHERE id LIKE 'demo-study-%';
      DELETE FROM study_transcript_segments WHERE id LIKE 'demo-study-%';
      DELETE FROM study_transcripts WHERE id LIKE 'demo-study-%';
      DELETE FROM study_recordings WHERE id LIKE 'demo-study-%';
      DELETE FROM study_material_fragment_links WHERE id LIKE 'demo-study-%';
      DELETE FROM study_material_annotations WHERE id LIKE 'demo-study-%';
      DELETE FROM study_material_versions WHERE id LIKE 'demo-study-%';
      DELETE FROM study_material_placements WHERE id LIKE 'demo-study-%';
      DELETE FROM study_materials WHERE id LIKE 'demo-study-%';
      DELETE FROM study_doc_tags WHERE id LIKE 'demo-study-%';
      DELETE FROM study_placements WHERE id LIKE 'demo-study-%';
      DELETE FROM study_doc_links WHERE id LIKE 'demo-study-%';
      DELETE FROM study_annotations WHERE id LIKE 'demo-study-%';
      DELETE FROM study_doc_versions WHERE id LIKE 'demo-study-%';
      DELETE FROM study_docs WHERE id LIKE 'demo-study-%';
      DELETE FROM study_templates WHERE id LIKE 'demo-study-%';
      DELETE FROM study_tags WHERE id LIKE 'demo-study-%';
      DELETE FROM study_topics WHERE id LIKE 'demo-study-%';
      DELETE FROM study_folders WHERE id LIKE 'demo-study-%';
      DELETE FROM study_subjects WHERE id LIKE 'demo-study-%';
      DELETE FROM study_courses WHERE id LIKE 'demo-study-%';
    `);
  })();
  clearStudyAssistantDemoConversation();
}
