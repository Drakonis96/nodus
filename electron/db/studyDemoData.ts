import { getDb } from './database';
import { getSettings, updateSettings } from './settingsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';

const ID = {
  course: 'demo-study-course-biology',
  subjectCell: 'demo-study-subject-cell',
  subjectEco: 'demo-study-subject-ecology',
  topicMembrane: 'demo-study-topic-membrane',
  topicEcosystem: 'demo-study-topic-ecosystem',
  documentCell: 'demo-study-doc-cell',
  documentEco: 'demo-study-doc-ecosystem',
  placementCell: 'demo-study-placement-cell',
  placementEco: 'demo-study-placement-ecosystem',
  tagExam: 'demo-study-tag-exam',
  docTag: 'demo-study-doc-tag',
  template: 'demo-study-template-cornell',
  question: 'demo-study-question-membrane',
  questionVersion: 'demo-study-question-version-membrane',
  assessment: 'demo-study-assessment-cell',
  assessmentItem: 'demo-study-assessment-item-cell',
  flashcard: 'demo-study-flashcard-membrane',
  plan: 'demo-study-plan-final',
  block: 'demo-study-block-review',
  event: 'demo-study-event-exam',
  goal: 'demo-study-goal-weekly',
} as const;

function count(table: string): number {
  return Number((getDb().prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number }).value);
}

/** Only an entirely empty vault can be replaced by sample study content. */
export function hasStudyDemoBlockingData(): boolean {
  return [
    'study_courses', 'study_subjects', 'study_topics', 'study_docs', 'study_materials',
    'study_recordings', 'study_questions', 'works', 'ideas', 'persons', 'notes', 'db_databases',
  ].some((table) => count(table) > 0);
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

    const insertTopic = db.prepare(`INSERT INTO study_topics
      (id,short_id,subject_id,parent_id,name,description,color,icon,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    insertTopic.run(ID.topicMembrane, 'TOP-DEMO1', ID.subjectCell, null, 'Membrana plasmática', 'Transporte, composición y señalización.', '#14b8a6', 'layers', 1, 0, createdAt, updatedAt);
    insertTopic.run(ID.topicEcosystem, 'TOP-DEMO2', ID.subjectEco, null, 'Flujo de energía', 'Niveles tróficos y productividad.', '#22c55e', 'sun', 0, 0, createdAt, updatedAt);

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

    const insertPlacement = db.prepare(`INSERT INTO study_placements
      (id,short_id,document_id,course_id,subject_id,topic_id,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    insertPlacement.run(ID.placementCell, 'PLC-DEMO1', ID.documentCell, ID.course, ID.subjectCell, ID.topicMembrane, 0, createdAt, updatedAt);
    insertPlacement.run(ID.placementEco, 'PLC-DEMO2', ID.documentEco, ID.course, ID.subjectEco, ID.topicEcosystem, 0, createdAt, updatedAt);

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

    db.prepare(`INSERT INTO study_flashcards
      (id,short_id,card_type,front,back,hint,tags_json,course_id,subject_id,topic_id,document_id,question_id,source_excerpt,difficulty,favorite,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID.flashcard, 'FLC-DEMO1', 'front_back', '¿Qué hace el transporte activo?', 'Mueve solutos contra gradiente y requiere energía.', 'Piensa en la dirección del gradiente.', JSON.stringify(['membrana']), ID.course, ID.subjectCell, ID.topicMembrane, ID.documentCell, ID.question, 'El transporte activo mueve solutos contra gradiente.', 'easy', 1, 0, createdAt, updatedAt);
    db.prepare(`INSERT INTO study_srs_state
      (card_id,ease_factor,interval_days,due_at,repetitions,lapses,mastered,excluded,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(ID.flashcard, 2.5, 0, updatedAt, 0, 0, 0, 0, updatedAt);

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

    updateSettings({ demoMode: true, studyTourComplete: false });
  })();
  return true;
}

export function clearStudyDemoData(): void {
  const db = getDb();
  const hasRows = Number((db.prepare("SELECT COUNT(*) value FROM study_courses WHERE id LIKE 'demo-study-%'").get() as { value: number }).value) > 0;
  if (!hasRows && !getSettings().demoMode) return;
  db.transaction(() => {
    db.exec(`
      DELETE FROM study_study_sessions WHERE id LIKE 'demo-study-%';
      DELETE FROM study_goals WHERE id LIKE 'demo-study-%';
      DELETE FROM study_calendar_events WHERE id LIKE 'demo-study-%';
      DELETE FROM study_plan_blocks WHERE id LIKE 'demo-study-%';
      DELETE FROM study_plans WHERE id LIKE 'demo-study-%';
      DELETE FROM study_reviews WHERE id LIKE 'demo-study-%';
      DELETE FROM study_flashcards WHERE id LIKE 'demo-study-%';
      DELETE FROM study_assessments WHERE id LIKE 'demo-study-%';
      DELETE FROM study_questions WHERE id LIKE 'demo-study-%';
      DELETE FROM study_doc_tags WHERE id LIKE 'demo-study-%';
      DELETE FROM study_placements WHERE id LIKE 'demo-study-%';
      DELETE FROM study_docs WHERE id LIKE 'demo-study-%';
      DELETE FROM study_templates WHERE id LIKE 'demo-study-%';
      DELETE FROM study_tags WHERE id LIKE 'demo-study-%';
      DELETE FROM study_topics WHERE id LIKE 'demo-study-%';
      DELETE FROM study_subjects WHERE id LIKE 'demo-study-%';
      DELETE FROM study_courses WHERE id LIKE 'demo-study-%';
    `);
  })();
}
