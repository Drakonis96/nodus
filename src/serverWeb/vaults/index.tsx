import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import L from "leaflet";
import type { WorldMap } from "@shared/types";
import { parseHistoricalDate } from "@shared/genealogyDates";
import { computeTreeLayout } from "@shared/treeLayout";
import { buildTreeFamilies, treeFamilyLaneY } from "@shared/treeFamilies";
import { branchColorForTheme, deriveTreeKinship } from "@shared/treeKinship";
import type { View } from "../../navigation";
import { Icon } from "../../components/ui";
import { SearchableMultiSelect } from "../../components/PersonMultiSelect";
import {
  WorldMapCanvas,
  type MapFrame,
} from "../../components/world/WorldMapCanvas";
import { useIsLightTheme } from "../../hooks";
import { api } from "../api";
import { MarkdownReader } from "../readers";
import { TreeFrame, TreeFrameDefs } from "../../components/TreeFrame";
import type { JsonRecord, PageResponse } from "../types";
import { getActiveLang, t, tx } from "../i18nShim";
import { localizeContinuityText } from "@shared/uiLanguage";

export { ServerVaultManager } from "./ServerVaultManager";

/**
 * The non-academic workspaces use the same Desktop contract: a collection is a
 * table, and opening a row creates a tab containing the record's related tables.
 * This adapter deliberately stays data-driven so a published snapshot can add
 * rows without the server having to know the user's private vault contents.
 */
export type VaultSurfaceId =
  | "databases"
  | "persons"
  | "places"
  | "events"
  | "relationships"
  | "social-relations"
  | "genealogy-tree"
  | "genealogy-map"
  | "genealogy-timeline"
  | "prosopography-persons"
  | "prosopography-sources"
  | "prosopography-analysis"
  | "prosopography-networks"
  | "world-groups"
  | "world-scenes"
  | "world-articles"
  | "world-threads"
  | "world-rules"
  | "world-questions"
  | "world-map"
  | "world-manuscript"
  | "world-continuity"
  | "world-analysis"
  | "study-courses"
  | "study-materials"
  | "study-calendar"
  | "study-schedule"
  | "study-review"
  | "study-graph"
  | "study-ideas"
  | "study-plans"
  | "study-questions"
  | "teaching-exams"
  | "teaching-rubrics"
  | "teaching-groups"
  | "teaching-grades"
  | "teaching-units"
  | "archive-items"
  | "archive-repositories"
  | "archive-units"
  | "archive-excerpts"
  | "source-analyses"
  | "testimony-interviews"
  | "testimony-transcripts"
  | "testimony-codes"
  | "testimony-contrasts"
  | "testimony-participants"
  | "database-pages";

export type VaultSurfaceProps = {
  spaceId: string;
  surface: VaultSurfaceId;
  /** Active vault type disambiguates shared Desktop labels (timeline/tree/relations). */
  vaultType?: string;
  /** The route view is needed for the three Desktop facets backed by world-groups. */
  view?: View;
  initialId?: string;
  /** Resource to use for a nested dossier opened from a related table. */
  initialCollection?: string;
  onOrigin?: () => void;
  onOpenRecord?: (collection: string, id: string) => void;
};

type Column = { key: string; label: string; width?: string };
type Descriptor = {
  collection: string;
  label: string;
  icon: string;
  description: string;
  columns: Column[];
  variant?:
    | "table"
    | "timeline"
    | "tree"
    | "map"
    | "calendar"
    | "agenda"
    | "schedule"
    | "manuscript"
    | "network"
    | "study-network"
    | "study-review"
    | "analysis"
    | "gallery"
    | "exam"
    | "rubric"
    | "question-bank"
    | "characters"
    | "place-tree"
    | "world-groups"
    | "encyclopedia"
    | "testimony-interviews"
    | "testimony-codes"
    | "testimony-contrasts"
    | "conflict-board"
    | "continuity"
    | "world-rules"
    | "world-questions";
  related?: Array<{ key: string; label: string; collection?: string }>;
  /** A surface can remain visible while its source is intentionally not published. */
  published?: boolean;
  privateNotice?: string;
};

const C = (key: string, label: string, width?: string): Column => ({
  key,
  label,
  width,
});

/** Column definitions mirror the headings in the corresponding Desktop lists. */
export const VAULT_SURFACES: Record<VaultSurfaceId, Descriptor> = {
  databases: {
    collection: "databases",
    label: "Bases de datos",
    icon: "table",
    description: "Bases de datos publicadas y sus registros.",
    columns: [
      C("name", "Nombre"),
      C("description", "Descripción"),
      C("row_count", "Registros", "7rem"),
      C("updated_at", "Actualizada", "10rem"),
    ],
  },
  "database-pages": {
    collection: "database-pages",
    label: "Páginas",
    icon: "notebook",
    description: "Páginas publicadas de las bases de datos.",
    columns: [
      C("title", "Título"),
      C("content", "Contenido"),
      C("database_id", "Base de datos", "11rem"),
      C("updated_at", "Actualizada", "10rem"),
    ],
  },
  persons: {
    collection: "persons",
    label: "Personas",
    icon: "users",
    description: "Personas y sus relaciones documentadas.",
    columns: [
      C("display_name", "Nombre"),
      C("notes", "Notas"),
      C("birth_date", "Nacimiento", "9rem"),
      C("sex", "Sexo", "8rem"),
    ],
    related: [
      { key: "relationships", label: "Relaciones" },
      { key: "events", label: "Eventos" },
      { key: "places", label: "Lugares" },
    ],
  },
  places: {
    collection: "places",
    label: "Lugares",
    icon: "map",
    description: "Lugares asociados al corpus.",
    columns: [
      C("name", "Lugar"),
      C("notes", "Notas"),
      C("kind", "Tipo", "9rem"),
      C("latitude", "Latitud", "8rem"),
      C("longitude", "Longitud", "8rem"),
    ],
  },
  events: {
    collection: "events",
    label: "Línea temporal",
    icon: "clock",
    description: "Eventos ordenados del corpus.",
    columns: [
      C("label", "Evento"),
      C("notes", "Notas"),
      C("date", "Fecha", "9rem"),
      C("date_end_sort", "Fin", "9rem"),
    ],
  },
  relationships: {
    collection: "relationships",
    label: "Relaciones",
    icon: "link",
    description: "Relaciones entre personas.",
    columns: [
      C("type", "Tipo"),
      C("from_person", "Origen"),
      C("to_person", "Destino"),
      C("provenance", "Procedencia", "10rem"),
    ],
  },
  // Desktop RelationsView is a social graph (social_contacts/social_relations), not
  // kinship. Those tables are intentionally outside the publication boundary, so keep
  // the route visible with an exact privacy state instead of relabelling family edges.
  "social-relations": {
    collection: "social-relations",
    label: "Relaciones sociales",
    icon: "link",
    description: "Relaciones sociales de la bóveda.",
    published: false,
    privateNotice:
      "Las relaciones sociales no se publican en el servidor; los vínculos de parentesco están disponibles en Árbol genealógico.",
    columns: [],
  },
  "genealogy-tree": {
    collection: "relationships",
    label: "Árbol genealógico",
    icon: "tree",
    description: "Familias y vínculos de parentesco.",
    variant: "tree",
    columns: [
      C("label", "Vínculo"),
      C("from_person", "Origen"),
      C("to_person", "Destino"),
      C("type", "Tipo", "9rem"),
    ],
  },
  "genealogy-map": {
    collection: "places",
    label: "Mapa",
    icon: "map",
    description: "Lugares geolocalizados del corpus.",
    variant: "map",
    columns: [
      C("name", "Lugar"),
      C("description", "Descripción"),
      C("type", "Tipo", "9rem"),
      C("coordinates", "Coordenadas", "10rem"),
    ],
  },
  "genealogy-timeline": {
    collection: "events",
    label: "Línea temporal",
    icon: "clock",
    description: "Cronología de acontecimientos documentados.",
    variant: "timeline",
    columns: [
      C("title", "Evento"),
      C("description", "Descripción"),
      C("start_date", "Inicio", "9rem"),
      C("end_date", "Fin", "9rem"),
    ],
  },
  // Prosopography contains living-person identity resolution and sensitivity-labelled
  // statements. Its Desktop views remain visible for navigation parity, but no raw
  // prosopography rows are published by the server contract.
  "prosopography-persons": {
    collection: "persons",
    label: "Personas",
    icon: "user",
    description: "Población prosopográfica.",
    variant: "table",
    published: false,
    privateNotice:
      "La población prosopográfica es privada y no se publica en el servidor.",
    columns: [
      C("display_name", "Nombre"),
      C("notes", "Notas"),
      C("birth_date", "Nacimiento", "9rem"),
      C("sex", "Sexo", "8rem"),
    ],
  },
  "prosopography-sources": {
    collection: "archive-items",
    label: "Fuentes",
    icon: "archive",
    description: "Fuentes que sustentan la prosopografía.",
    variant: "table",
    published: false,
    privateNotice:
      "Las fuentes prosopográficas son privadas y no se publican en el servidor.",
    columns: [
      C("title", "Título"),
      C("description", "Descripción"),
      C("created_at", "Creada", "9rem"),
      C("kind", "Tipo", "9rem"),
    ],
  },
  "prosopography-analysis": {
    collection: "source-analyses",
    label: "Análisis",
    icon: "chartBar",
    description: "Análisis metodológicos.",
    variant: "analysis",
    published: false,
    privateNotice:
      "Los análisis prosopográficos son privados y no se publican en el servidor.",
    columns: [
      C("analysis_id", "Análisis"),
      C("origin_notes", "Notas"),
      C("content_form", "Forma", "10rem"),
      C("updated_at", "Actualizado", "10rem"),
    ],
  },
  "prosopography-networks": {
    collection: "relationships",
    label: "Redes",
    icon: "network",
    description: "Redes y vínculos entre personas.",
    variant: "network",
    published: false,
    privateNotice:
      "Las redes prosopográficas son privadas y no se publican en el servidor.",
    columns: [
      C("type", "Tipo"),
      C("from_person", "Origen"),
      C("to_person", "Destino"),
      C("provenance", "Procedencia", "10rem"),
    ],
  },
  "world-groups": {
    collection: "world-groups",
    label: "Grupos",
    icon: "network",
    description: "Facciones, culturas y dinastías del mundo.",
    columns: [
      C("name", "Nombre"),
      C("description", "Descripción"),
      C("kind", "Tipo", "9rem"),
      C("status", "Estado", "8rem"),
    ],
  },
  "world-scenes": {
    collection: "world-scenes",
    label: "Escenas",
    icon: "image",
    description: "Escenas y manuscritos del mundo.",
    variant: "gallery",
    columns: [
      C("title", "Título"),
      C("summary", "Resumen"),
      C("status", "Estado", "8rem"),
      C("updated_at", "Actualizada", "10rem"),
    ],
  },
  // Desktop's encyclopedia is an aggregate index (articles plus all public entities),
  // not just the native world_articles table.
  "world-articles": {
    collection: "world-entries",
    label: "Enciclopedia",
    icon: "book",
    description: "Índice de entidades publicadas del mundo.",
    columns: [
      C("title", "Entrada"),
      C("summary", "Resumen"),
      C("category", "Categoría", "10rem"),
      C("updatedAt", "Actualizado", "10rem"),
    ],
  },
  "world-threads": {
    collection: "world-threads",
    label: "Hilos narrativos",
    icon: "route",
    description: "Arcos, continuidad y conflictos.",
    columns: [
      C("title", "Título"),
      C("description", "Descripción"),
      C("type", "Tipo", "10rem"),
      C("status", "Estado", "8rem"),
    ],
  },
  "world-rules": {
    collection: "world-rules",
    label: "Reglas del mundo",
    icon: "lock",
    description: "Reglas y restricciones canónicas.",
    variant: "world-rules",
    columns: [
      C("title", "Regla"),
      C("description", "Descripción"),
      C("category", "Categoría", "10rem"),
      C("health", "Salud", "9rem"),
      C("status", "Estado", "8rem"),
    ],
  },
  "world-questions": {
    collection: "world-questions",
    label: "Preguntas abiertas",
    icon: "help",
    description: "Preguntas pendientes del mundo.",
    variant: "world-questions",
    columns: [
      C("title", "Pregunta"),
      C("description", "Contexto"),
      C("status", "Estado", "8rem"),
      C("priority", "Prioridad", "8rem"),
    ],
  },
  "world-map": {
    collection: "world-maps",
    label: "Mapas",
    icon: "map",
    description: "Cartografía e imágenes del mundo.",
    variant: "map",
    columns: [
      C("name", "Mapa"),
      C("description", "Descripción"),
      C("style", "Estilo", "9rem"),
      C("updated_at", "Actualizado", "10rem"),
    ],
  },
  "world-manuscript": {
    collection: "world-scenes",
    label: "Manuscrito",
    icon: "edit",
    description: "Escenas ordenadas y su texto.",
    variant: "manuscript",
    columns: [
      C("title", "Escena"),
      C("summary", "Resumen"),
      C("status", "Estado", "8rem"),
      C("updated_at", "Actualizada", "10rem"),
    ],
  },
  "world-continuity": {
    collection: "world-threads",
    label: "Continuidad",
    icon: "check",
    description: "Avisos estructurales sobre el mundo publicado.",
    variant: "continuity",
    columns: [
      C("headline", "Aviso"),
      C("severity", "Severidad", "10rem"),
      C("family", "Familia", "9rem"),
    ],
  },
  "world-analysis": {
    collection: "world-threads",
    label: "Conflictos",
    icon: "scale",
    description: "Quién quiere qué, contra quién y con qué coste.",
    variant: "conflict-board",
    columns: [
      C("title", "Conflicto"),
      C("description", "Descripción"),
      C("status", "Estado", "8rem"),
      C("type", "Tipo", "9rem"),
    ],
  },
  "study-courses": {
    collection: "study-courses",
    label: "Cursos y asignaturas",
    icon: "graduation",
    description: "Organización de estudio.",
    columns: [
      C("name", "Nombre"),
      C("description", "Descripción"),
      C("short_id", "Código", "8rem"),
      C("updated_at", "Actualizado", "10rem"),
    ],
  },
  "study-materials": {
    collection: "study-materials",
    label: "Materiales",
    icon: "book",
    description: "Materiales y apuntes de estudio publicados.",
    columns: [
      C("title", "Título"),
      C("description", "Descripción"),
      C("extension", "Tipo", "9rem"),
      C("read_state", "Lectura", "9rem"),
      C("updated_at", "Actualizado", "10rem"),
    ],
  },
  "study-calendar": {
    collection: "study-calendar",
    label: "Calendario",
    icon: "calendar",
    description: "Eventos y entregas de estudio.",
    variant: "calendar",
    columns: [
      C("title", "Evento"),
      C("notes", "Notas"),
      C("starts_at", "Comienza", "11rem"),
      C("ends_at", "Termina", "11rem"),
    ],
  },
  "study-schedule": {
    collection: "study-schedule",
    label: "Horarios",
    icon: "clock",
    description: "Franjas y asignaturas de la semana.",
    variant: "schedule",
    columns: [
      C("label", "Franja"),
      C("start_time", "Inicio", "8rem"),
      C("end_time", "Fin", "8rem"),
      C("section", "Sección", "9rem"),
    ],
  },
  "study-review": {
    collection: "study-review",
    label: "Revisión",
    icon: "flashcards",
    description:
      "Preguntas y tarjetas disponibles para una sesión de revisión.",
    variant: "study-review",
    columns: [
      C("prompt", "Pregunta"),
      C("item_kind", "Tipo", "10rem"),
      C("difficulty", "Dificultad", "9rem"),
      C("status", "Estado", "9rem"),
      C("updated_at", "Actualizada", "10rem"),
    ],
  },
  "study-graph": {
    collection: "study-ideas",
    label: "Grafo de estudio",
    icon: "network",
    description: "Relaciones entre ideas y temas de estudio.",
    variant: "study-network",
    columns: [
      C("label", "Idea"),
      C("statement", "Enunciado"),
      C("type", "Tipo", "9rem"),
      C("updated_at", "Actualizada", "10rem"),
    ],
  },
  "study-ideas": {
    collection: "study-ideas",
    label: "Ideas de estudio",
    icon: "bulb",
    description: "Ideas extraídas y conectadas del estudio.",
    columns: [
      C("label", "Idea"),
      C("statement", "Enunciado"),
      C("type", "Tipo", "9rem"),
      C("updated_at", "Actualizada", "10rem"),
    ],
  },
  "study-plans": {
    collection: "study-plans",
    label: "Planes y agenda",
    icon: "calendar",
    description: "Planes de estudio y bloques de trabajo.",
    columns: [
      C("title", "Plan"),
      C("description", "Descripción"),
      C("exam_at", "Fecha objetivo", "11rem"),
      C("available_minutes", "Minutos", "8rem"),
    ],
    related: [{ key: "blocks", label: "Bloques" }],
  },
  "study-questions": {
    collection: "study-questions",
    label: "Banco de preguntas",
    icon: "help",
    description: "Preguntas y tarjetas de estudio.",
    variant: "question-bank",
    columns: [
      C("prompt", "Pregunta"),
      C("question_type", "Tipo", "10rem"),
      C("difficulty", "Dificultad", "9rem"),
      C("status", "Estado", "9rem"),
      C("updated_at", "Actualizada", "10rem"),
    ],
  },
  "teaching-exams": {
    collection: "teaching-exams",
    label: "Exámenes",
    icon: "notebook",
    description: "Exámenes y preguntas publicados.",
    variant: "exam",
    columns: [
      C("title", "Título"),
      C("subject_name", "Asignatura"),
      C("short_id", "Código", "8rem"),
      C("target_question_count", "Preguntas", "8rem"),
    ],
    related: [{ key: "questions", label: "Preguntas" }],
  },
  // These are deliberately not aliases for public study/exam/rubric collections. The
  // underlying teaching groups, assessment and grade tables are permanently denied by
  // the publication contract, so the server surface stays explicit and data-free.
  "teaching-groups": {
    collection: "teaching-groups",
    label: "Grupos",
    icon: "users",
    description: "Grupos docentes.",
    privateNotice:
      "Los grupos docentes son privados y no se publican en el servidor.",
    published: false,
    columns: [
      C("name", "Grupo"),
      C("description", "Descripción"),
      C("code", "Código", "8rem"),
      C("updated_at", "Actualizado", "10rem"),
    ],
  },
  "teaching-grades": {
    collection: "teaching-grades",
    label: "Calificaciones",
    icon: "chartBar",
    description: "Calificaciones y evaluaciones.",
    privateNotice:
      "Las calificaciones son privadas y no se publican en el servidor.",
    published: false,
    variant: "analysis",
    columns: [
      C("title", "Evaluación"),
      C("description", "Descripción"),
      C("criteria", "Criterios"),
      C("updated_at", "Actualizada", "10rem"),
    ],
  },
  "teaching-units": {
    collection: "teaching-units",
    label: "Diseño de unidades",
    icon: "compass",
    description: "Unidades docentes.",
    privateNotice:
      "El diseño de unidades docente es privado y no se publica en el servidor.",
    published: false,
    variant: "analysis",
    columns: [
      C("title", "Unidad"),
      C("description", "Descripción"),
      C("status", "Estado", "8rem"),
      C("points", "Puntos", "7rem"),
    ],
  },
  "teaching-rubrics": {
    collection: "teaching-rubrics",
    label: "Rúbricas",
    icon: "table",
    description: "Rúbricas de evaluación.",
    variant: "rubric",
    columns: [
      C("title", "Título"),
      C("description", "Descripción"),
      C("criteria_count", "Criterios", "8rem"),
      C("levels_count", "Niveles", "8rem"),
      C("updated_at", "Actualizada", "10rem"),
    ],
  },
  "archive-items": {
    collection: "archive-items",
    label: "Archivo",
    icon: "archive",
    description: "Fuentes primarias publicadas.",
    columns: [
      C("title", "Título"),
      C("description", "Descripción"),
      C("folder_name", "Carpeta", "10rem"),
      C("created_at", "Creada", "9rem"),
      C("kind", "Tipo", "9rem"),
    ],
  },
  "archive-repositories": {
    collection: "archive-repositories",
    label: "Repositorios",
    icon: "archive",
    description: "Repositorios y procedencias.",
    columns: [
      C("name", "Nombre"),
      C("access_notes", "Acceso"),
      C("country_code", "País", "8rem"),
      C("updated_at", "Actualizado", "10rem"),
    ],
  },
  "archive-units": {
    collection: "archive-units",
    label: "Unidades descriptivas",
    icon: "layers",
    description: "Unidades de descripción archivística.",
    columns: [
      C("title", "Título"),
      C("scope_content", "Alcance y contenido"),
      C("level", "Nivel", "9rem"),
      C("date_display", "Fecha", "9rem"),
    ],
  },
  "archive-excerpts": {
    collection: "archive-excerpts",
    label: "Extractos",
    icon: "quote",
    description: "Extractos y fragmentos de fuentes.",
    columns: [
      C("excerpt_id", "Extracto"),
      C("quoted_text", "Texto"),
      C("item_id", "Fuente", "11rem"),
      C("locator_display", "Localizador", "10rem"),
    ],
  },
  "source-analyses": {
    collection: "source-analyses",
    label: "Análisis de fuentes",
    icon: "search",
    description: "Análisis publicados de fuentes.",
    columns: [
      C("analysis_id", "Análisis"),
      C("origin_notes", "Notas de origen"),
      C("content_form", "Forma", "10rem"),
      C("updated_at", "Actualizado", "10rem"),
    ],
  },
  "testimony-interviews": {
    collection: "testimony-interviews",
    label: "Entrevistas",
    icon: "microphone",
    description: "Entrevistas publicadas.",
    variant: "testimony-interviews",
    columns: [
      C("title", "Entrevista"),
      C("abstract", "Resumen"),
      C("conducted_at", "Fecha", "11rem"),
      C("location_text", "Lugar", "10rem"),
    ],
    related: [
      { key: "transcripts", label: "Transcripción" },
      { key: "codes", label: "Códigos" },
    ],
  },
  "testimony-transcripts": {
    collection: "testimony-transcripts",
    label: "Transcripciones",
    icon: "notebook",
    description: "Transcripciones textuales.",
    columns: [
      C("id", "Transcripción"),
      C("content_markdown", "Texto"),
      C("language", "Idioma", "8rem"),
      C("updated_at", "Actualizada", "10rem"),
    ],
  },
  "testimony-codes": {
    collection: "testimony-codes",
    label: "Códigos",
    icon: "tag",
    description: "Códigos analíticos publicados.",
    variant: "testimony-codes",
    columns: [
      C("label", "Código"),
      C("description", "Descripción"),
      C("color", "Color", "8rem"),
      C("updated_at", "Actualizado", "10rem"),
    ],
  },
  "testimony-contrasts": {
    collection: "testimony-contrasts",
    label: "Contrastes",
    icon: "scale",
    description: "Contrastes entre testimonios.",
    variant: "testimony-contrasts",
    columns: [
      C("title", "Contraste"),
      C("memo_markdown", "Memorando"),
      C("id", "Identificador", "10rem"),
      C("updated_at", "Actualizado", "10rem"),
    ],
  },
  "testimony-participants": {
    collection: "testimony-participants",
    label: "Participantes",
    icon: "users",
    description: "Participantes de entrevistas.",
    published: false,
    privateNotice:
      "Los datos de participantes se mantienen privados para proteger identidades y acuerdos de atribución.",
    columns: [
      C("person_id", "Persona"),
      C("public_name", "Nombre público"),
      C("identity_mode", "Atribución"),
      C("updated_at", "Actualizado", "10rem"),
    ],
  },
};

export const SURFACE_FOR_VIEW: Partial<Record<View, VaultSurfaceId>> = {
  databases: "databases",
  dbAnalysis: "databases",
  persons: "persons",
  characters: "persons",
  places: "places",
  timeline: "genealogy-timeline",
  relations: "relationships",
  tree: "genealogy-tree",
  map: "genealogy-map",
  factions: "world-groups",
  cultures: "world-groups",
  dynasties: "world-groups",
  scenes: "world-scenes",
  manuscript: "world-manuscript",
  encyclopedia: "world-articles",
  arcs: "world-threads",
  continuity: "world-continuity",
  conflicts: "world-analysis",
  rules: "world-rules",
  questions: "world-questions",
  studyCourses: "study-courses",
  studyLibrary: "study-materials",
  studyRecordings: "study-materials",
  studySchedule: "study-schedule",
  studyCalendar: "study-calendar",
  studyReview: "study-review",
  studyQuestions: "study-questions",
  studyIdeas: "study-ideas",
  studyGraph: "study-graph",
  teachingGroups: "teaching-groups",
  teachingExams: "teaching-exams",
  teachingRubrics: "teaching-rubrics",
  teachingGrades: "teaching-grades",
  teachingUnits: "teaching-units",
  archive: "archive-items",
  prosopPersons: "prosopography-persons",
  prosopSources: "prosopography-sources",
  prosopAnalysis: "prosopography-analysis",
  prosopNetworks: "prosopography-networks",
  testimonyInterviews: "testimony-interviews",
  testimonyParticipants: "testimony-participants",
  testimonyContrasts: "testimony-contrasts",
  prosopPopulation: "prosopography-persons",
  pages: "database-pages",
};

/** Public prosopography uses generated aggregates only. Keep the native surface
 * ids above (and their honest private descriptors) for old deep links, while the
 * Server adapter swaps in these identity-free collections at read time. */
const PROSOPOGRAPHY_PUBLIC_COLLECTIONS: Partial<
  Record<
    VaultSurfaceId,
    {
      collection: string;
      columns: Column[];
      variant?: Descriptor["variant"];
      label: string;
      description: string;
    }
  >
> = {
  "prosopography-persons": {
    collection: "prosopography-public-population",
    label: "Población",
    description:
      "Conteos agregados de la población; no se publican personas ni identidades.",
    columns: [
      C("title", "Estudio"),
      C("visible_population_count", "Casos agregados", "9rem"),
      C("included_count", "Incluidas", "8rem"),
      C("reviewed_statement_count", "Afirmaciones", "9rem"),
    ],
    variant: "table",
  },
  "prosopography-sources": {
    collection: "prosopography-public-sources",
    label: "Fuentes",
    description:
      "Tipos y cobertura de fuentes publicables, sin títulos ni citas identificables.",
    columns: [
      C("source_kind", "Tipo"),
      C("access_status", "Acceso", "9rem"),
      C("source_count", "Fuentes", "8rem"),
      C("segment_count", "Segmentos", "9rem"),
    ],
    variant: "table",
  },
  "prosopography-analysis": {
    collection: "prosopography-public-analysis",
    label: "Análisis",
    description:
      "Resultados reproducibles agregados; los casos individuales no se publican.",
    columns: [
      C("title", "Análisis"),
      C("analysis_kind", "Tipo", "9rem"),
      C("latest_population_count", "Población", "9rem"),
      C("latest_included_count", "Incluidas", "9rem"),
    ],
    variant: "analysis",
  },
  "prosopography-networks": {
    collection: "prosopography-public-networks",
    label: "Redes",
    description:
      "Métricas de red agregadas; no se publican nodos, aristas ni resolución de identidad.",
    columns: [
      C("name", "Capa"),
      C("edge_count", "Aristas", "8rem"),
      C("node_count", "Nodos", "8rem"),
      C("density", "Densidad", "8rem"),
    ],
    variant: "network",
  },
};

/** Some menu ids are shared by vault families (notably Mapa). Resolve those ids
 * with the active vault before falling back to the common catalogue. */
export function surfaceForView(
  vaultType: string | undefined,
  view: View,
): VaultSurfaceId | undefined {
  if (vaultType === "worldbuilding" && view === "map") return "world-map";
  if (
    (vaultType === "genealogy" || vaultType === "worldbuilding") &&
    view === "relations"
  )
    return "social-relations";
  return SURFACE_FOR_VIEW[view];
}

function value(input: unknown, fallback = "—"): string {
  // Fallbacks are renderer-owned UI copy; published values below must pass
  // through unchanged and are intentionally never sent to the translator.
  if (input == null || input === "") return t(fallback);
  if (
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "boolean"
  )
    return String(input);
  return Array.isArray(input)
    ? input
        .map((item) => value(item, ""))
        .filter(Boolean)
        .join(", ")
    : JSON.stringify(input);
}
function rowId(row: JsonRecord, index = 0): string {
  // Collection primary keys are not mechanically named: relationships use rel_id,
  // maps use map_id, and the records tables use place_id/event_id. Falling back to
  // the row index makes a tab look open but makes its reloadable detail URL 404.
  const candidate =
    row.id ??
    row.nodus_id ??
    row.person_id ??
    row.place_id ??
    row.event_id ??
    row.rel_id ??
    row.relationship_id ??
    row.group_id ??
    row.scene_id ??
    row.map_id ??
    row.article_id ??
    row.thread_id ??
    row.rule_id ??
    row.question_id ??
    row.interview_id ??
    row.database_id ??
    row.page_id ??
    row.mode_id ??
    row.layer_id ??
    row.marker_id ??
    // Primary-source tables retain their domain-specific keys in SQLite.
    // Falling back to the array index here made an archive row appear open while
    // its reloadable detail URL addressed a different record (or 404ed).
    row.item_id ??
    row.repository_id ??
    row.unit_id ??
    row.excerpt_id ??
    row.analysis_id;
  if (candidate != null && candidate !== "") return String(candidate);
  const discovered = Object.entries(row).find(
    ([key, value]) =>
      /(?:^id$|_id$)/.test(key) &&
      (typeof value === "string" || typeof value === "number"),
  )?.[1];
  return discovered == null ? String(index) : String(discovered);
}
function rowIdForCollection(
  collection: string,
  row: JsonRecord,
  index = 0,
): string {
  const primaryKeys: Record<string, string> = {
    persons: "person_id",
    places: "place_id",
    events: "event_id",
    relationships: "rel_id",
    "world-groups": "group_id",
    "world-scenes": "scene_id",
    "world-maps": "map_id",
    "world-articles": "article_id",
    "world-threads": "thread_id",
    "world-rules": "rule_id",
    "world-questions": "question_id",
    "archive-items": "item_id",
    "archive-repositories": "repository_id",
    "archive-units": "unit_id",
    "archive-excerpts": "excerpt_id",
    "source-analyses": "analysis_id",
  };
  if (collection === "world-entries") return value(row.key, rowId(row, index));
  if (collection === "study-review")
    return value(row.review_key, rowId(row, index));
  const preferred = row[primaryKeys[collection] ?? "id"];
  return preferred == null || preferred === ""
    ? rowId(row, index)
    : String(preferred);
}
function title(row: JsonRecord): string {
  return value(
    row.title ??
      row.name ??
      row.label ??
      row.display_name ??
      row.full_name ??
      row.person_name ??
      row.map_name ??
      row.subject ??
      row.id,
    "Sin título",
  );
}
function detailTitle(detail: JsonRecord, fallback: string): string {
  const primary = Object.values(detail).find(
    (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
  );
  const label = primary ? title(primary as JsonRecord) : title(detail);
  return label === t("Sin título") ? t(fallback) : label;
}
function pageRows(
  page: PageResponse | undefined,
  descriptor: Descriptor,
): JsonRecord[] {
  if (!page) return [];
  // Collection ids and response keys are not a mechanical pluralisation. In
  // particular study-calendar is keyed as `events`, just like the published
  // snapshot and the Desktop planner contract.
  const keys: Record<string, string> = {
    databases: "databases",
    events: "events",
    "study-calendar": "events",
    "world-groups": "groups",
    "world-maps": "maps",
    "world-scenes": "scenes",
    "world-articles": "articles",
    "world-threads": "threads",
    "world-rules": "rules",
    "world-questions": "questions",
    "study-courses": "courses",
    "study-materials": "materials",
    "study-plans": "plans",
    "study-schedule": "periods",
    "study-questions": "questions",
    "study-review": "items",
    "study-ideas": "ideas",
    "teaching-exams": "exams",
    "teaching-rubrics": "rubrics",
    "archive-items": "items",
    "archive-repositories": "repositories",
    "archive-units": "units",
    "archive-excerpts": "excerpts",
    "source-analyses": "analyses",
    "testimony-interviews": "interviews",
    "testimony-transcripts": "transcripts",
    "testimony-codes": "codes",
    "testimony-contrasts": "contrasts",
    "prosopography-public-population": "population",
    "prosopography-public-variables": "variables",
    "prosopography-public-sources": "sources",
    "prosopography-public-analysis": "analyses",
    "prosopography-public-networks": "networks",
    "database-pages": "pages",
  };
  const pieces = descriptor.collection.split("-");
  const key =
    keys[descriptor.collection] ?? (pieces[pieces.length - 1] || "items");
  const found = page[key] ?? page.items;
  return Array.isArray(found) ? (found as JsonRecord[]) : [];
}

function Loading() {
  return (
    <div
      className="grid h-48 place-items-center text-sm text-neutral-500"
      role="status"
    >
      {t("Cargando…")}
    </div>
  );
}
function DataTable({
  rows,
  columns,
  onOpen,
}: {
  rows: JsonRecord[];
  columns: Column[];
  onOpen?: (row: JsonRecord, index: number) => void;
}) {
  const template = `${columns.map((column, index) => column.width || (index === 0 ? "minmax(240px,1.4fr)" : "minmax(150px,1fr)")).join(" ")} 2rem`;
  const cell = (row: JsonRecord, column: Column, index: number): string => {
    if (column.key === "kind" && typeof row[column.key] === "string")
      return t(
        WORLD_GROUP_KIND_LABEL[String(row[column.key])] ??
          String(row[column.key]),
      );
    if (column.key === "status" && typeof row[column.key] === "string")
      return t(
        WORLD_GROUP_STATUS_LABEL[String(row[column.key])] ??
          String(row[column.key]),
      );
    return value(row[column.key], index === 0 ? title(row) : "—");
  };
  return (
    <div className="min-w-[900px]">
      <div
        className="grid h-10 items-center border-b border-neutral-200 px-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800"
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((column) => (
          <span key={column.key} className="truncate">
            {t(column.label)}
          </span>
        ))}
        <span />
      </div>
      {rows.map((row, rowIndex) => (
        <button
          key={`${rowId(row, rowIndex)}-${rowIndex}`}
          data-testid="vault-data-row"
          className="grid min-h-[64px] w-full items-center border-b border-neutral-100 px-4 py-2 text-left text-xs transition-colors hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/55"
          style={{ gridTemplateColumns: template }}
          onClick={() => onOpen?.(row, rowIndex)}
        >
          {columns.map((column, columnIndex) => (
            <span
              key={column.key}
              className={`${columnIndex === 0 ? "font-medium text-neutral-900 dark:text-neutral-200" : "text-neutral-500"} min-w-0 pr-3 line-clamp-2`}
            >
              {cell(row, column, columnIndex)}
            </span>
          ))}
          {onOpen && (
            <Icon name="chevronRight" size={14} className="text-neutral-400" />
          )}
        </button>
      ))}
    </div>
  );
}

function NestedTable({
  label,
  value: nested,
  onOpen,
}: {
  label: string;
  value: unknown;
  onOpen?: (row: JsonRecord) => void;
}) {
  if (!Array.isArray(nested) || nested.length === 0)
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-800">
        {t("No hay")} {t(label).toLocaleLowerCase(getActiveLang())} {t("publicados")}.
      </div>
    );
  const rows = nested.filter((entry): entry is JsonRecord =>
    Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
  );
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    .filter((key) =>
      rows.some((row) => row[key] != null && typeof row[key] !== "object"),
    )
    .slice(0, 5);
  const cols = keys.length
    ? keys.map((key, index) =>
        C(
          key,
          key.replace(/_/g, " "),
          index === 0 ? "minmax(190px,1.4fr)" : undefined,
        ),
      )
    : [C("id", "ID")];
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {t(label)}
      </h3>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <DataTable
          rows={rows}
          columns={cols}
          onOpen={onOpen ? (row) => onOpen(row) : undefined}
        />
      </div>
    </section>
  );
}

/** Response keys are human-friendly (`calendar`, `plans`, `transcripts`) while
 * detail endpoints use the canonical REST collection. Keep this mapping explicit:
 * pluralising a response key produced URLs such as `/calendar/:id`, which do not
 * exist and silently broke every nested study/testimony/archive tab. */
function nestedCollection(parent: string, key: string): string | null {
  const byParent: Record<string, Record<string, string>> = {
    persons: {
      relationships: "relationships",
      events: "events",
      places: "places",
    },
    places: { persons: "persons", events: "events" },
    events: { participants: "persons", place: "places" },
    relationships: { from: "persons", to: "persons" },
    "study-courses": {
      subjects: "study-subjects",
      calendar: "study-calendar",
      plans: "study-plans",
    },
    "study-materials": {
      placements: "study-materials",
      versions: "study-materials",
      annotations: "study-materials",
    },
    "study-questions": { versions: "study-questions" },
    "study-plans": { blocks: "study-plans" },
    "teaching-exams": { questions: "teaching-exams" },
    "testimony-interviews": {
      transcripts: "testimony-transcripts",
      codes: "testimony-codes",
    },
    "archive-items": {
      excerpts: "archive-excerpts",
      analysis: "source-analyses",
      units: "archive-units",
      repository: "archive-repositories",
    },
    databases: { views: "databases" },
  };
  return byParent[parent]?.[key] ?? null;
}

function SurfaceEmpty({ label }: { label: string }) {
  return (
    <div className="grid min-h-48 place-items-center p-8 text-sm text-neutral-500">
      {t("No hay")} {t(label).toLocaleLowerCase(getActiveLang())} {t("publicados")}.
    </div>
  );
}

function PrivateSurface({ label, notice }: { label: string; notice?: string }) {
  return (
    <div
      className="grid min-h-48 place-items-center p-8 text-center text-sm text-neutral-500"
      data-testid="vault-private-surface"
    >
      <div>
        <Icon name="lock" size={24} className="mx-auto mb-3 text-neutral-400" />
        <strong className="block text-neutral-700 dark:text-neutral-300">
          {t(label)}
        </strong>
        <p className="mt-2 max-w-md text-xs leading-5">
          {notice ||
            t("Esta superficie es privada y no contiene datos publicados.")}
        </p>
      </div>
    </div>
  );
}

const WORLD_GROUP_VIEWS: Partial<
  Record<View, { label: string; icon: string; kinds: string[] }>
> = {
  factions: {
    label: "Facciones",
    icon: "network",
    kinds: ["faction", "order", "religion"],
  },
  cultures: {
    label: "Culturas",
    icon: "languages",
    kinds: ["culture", "species", "language"],
  },
  dynasties: { label: "Dinastías", icon: "shield", kinds: ["house"] },
};

const WORLD_GROUP_KIND_LABEL: Record<string, string> = {
  faction: "Facción",
  culture: "Cultura",
  religion: "Religión",
  house: "Casa",
  order: "Orden",
  species: "Especie",
  language: "Lengua",
};
const WORLD_GROUP_STATUS_LABEL: Record<string, string> = {
  active: "Activa",
  extinct: "Extinta",
  dormant: "Latente",
};

function TimelineCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const [selectedPersonIds, setSelectedPersonIds] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const personOptions = useMemo(() => {
    const people = new Map<string, string>();
    rows.forEach((row) => {
      const participants = Array.isArray(row.participants)
        ? row.participants
        : [];
      participants.forEach((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
        const participant = raw as JsonRecord;
        const id = String(participant.personId ?? participant.person_id ?? "");
        if (id)
          people.set(
            id,
            value(participant.displayName ?? participant.display_name, id),
          );
      });
    });
    return [...people.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);
  const typeOptions = useMemo(
    () =>
      [
        ...new Set(
          rows.map((row) => String(row.type ?? "other")).filter(Boolean),
        ),
      ]
        .sort()
        .map((id) => ({ id, label: id })),
    [rows],
  );
  const ordered = useMemo(
    () =>
      rows
        .filter((row) => {
          const participants = Array.isArray(row.participants)
            ? row.participants
            : [];
          const personIds = participants.flatMap((raw) =>
            raw && typeof raw === "object" && !Array.isArray(raw)
              ? [
                  String(
                    (raw as JsonRecord).personId ??
                      (raw as JsonRecord).person_id ??
                      "",
                  ),
                ]
              : [],
          );
          const matchesPerson =
            selectedPersonIds.length === 0 ||
            personIds.some((id) => selectedPersonIds.includes(id));
          const matchesType =
            selectedTypes.length === 0 ||
            selectedTypes.includes(String(row.type ?? "other"));
          return matchesPerson && matchesType;
        })
        .sort((a, b) => {
          const yearA = Number(a.worldYear ?? a.world_year);
          const yearB = Number(b.worldYear ?? b.world_year);
          if (Number.isFinite(yearA) && Number.isFinite(yearB)) {
            const yearOrder = yearA - yearB;
            if (yearOrder) return yearOrder;
            const orderA = Number(a.worldOrder ?? a.world_order ?? 0);
            const orderB = Number(b.worldOrder ?? b.world_order ?? 0);
            if (
              Number.isFinite(orderA) &&
              Number.isFinite(orderB) &&
              orderA !== orderB
            )
              return orderA - orderB;
          }
          return String(
            a.date_sort ?? a.start_date ?? a.starts_at ?? a.date ?? "",
          ).localeCompare(
            String(b.date_sort ?? b.start_date ?? b.starts_at ?? b.date ?? ""),
          );
        }),
    [rows, selectedPersonIds, selectedTypes],
  );
  return (
    <div className="mx-auto max-w-4xl p-5" data-testid="vault-timeline">
      <header className="mb-4 flex items-center gap-3">
        <Icon name="clock" size={22} className="text-amber-500" />
        <h2 className="text-xl font-semibold">{t("Línea temporal")}</h2>
        <span className="ml-auto text-xs text-neutral-500">
          {ordered.length} {t("eventos")}
        </span>
      </header>
      <div className="mb-5 grid max-w-3xl gap-2 sm:grid-cols-2">
        <SearchableMultiSelect
          options={personOptions}
          selectedIds={selectedPersonIds}
          onChange={setSelectedPersonIds}
          placeholder={t("Todas las personas")}
          searchPlaceholder={t("Buscar persona…")}
          testId="timeline-person-filter"
        />
        <SearchableMultiSelect
          options={typeOptions}
          selectedIds={selectedTypes}
          onChange={setSelectedTypes}
          placeholder={t("Todos los tipos")}
          searchPlaceholder={t("Buscar tipo de evento…")}
          testId="timeline-type-filter"
        />
      </div>
      {ordered.length ? (
        <ol className="relative ml-3 space-y-4 border-l border-amber-700/40 pb-2">
          {ordered.map((row, index) => {
            const participants = Array.isArray(row.participants)
              ? row.participants.filter((raw): raw is JsonRecord =>
                  Boolean(
                    raw && typeof raw === "object" && !Array.isArray(raw),
                  ),
                )
              : [];
            return (
              <li
                key={`${rowId(row, index)}`}
                className="relative ml-6"
                data-testid="timeline-event-card"
              >
                <span className="absolute -left-[31px] top-6 h-3.5 w-3.5 rounded-full bg-amber-500 ring-4 ring-white dark:ring-neutral-950" />
                <article className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900/35 dark:hover:border-amber-800/60">
                  <button
                    onClick={() => onOpen(row, rows.indexOf(row))}
                    className="group flex w-full items-start gap-4 p-4 text-left"
                    aria-label={t("Ver detalles del evento")}
                  >
                    <time className="min-w-[6.5rem] rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-center text-xs font-semibold text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300">
                      {value(
                        row.world_year ??
                          row.date ??
                          row.start_date ??
                          row.starts_at,
                        t("sin fecha"),
                      )}
                    </time>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">
                        {value(row.type, t("otro"))}
                      </span>
                      <span className="mt-0.5 block text-sm text-neutral-700 dark:text-neutral-300">
                        {title(row)}
                      </span>
                      {Boolean(row.place_name) && (
                        <span className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
                          <Icon name="map" size={12} />
                          {value(row.place_name)}
                        </span>
                      )}
                      {Boolean(row.notes || row.description) && (
                        <span className="mt-2 line-clamp-2 block text-xs leading-5 text-neutral-500">
                          {value(row.notes ?? row.description)}
                        </span>
                      )}
                    </span>
                    <Icon
                      name="chevronRight"
                      size={15}
                      className="mt-2 shrink-0 text-neutral-500"
                    />
                  </button>
                  {participants.length > 0 && (
                    <div className="flex flex-wrap gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800/80">
                      {participants.map((participant, participantIndex) => (
                        <span
                          key={`${value(participant.personId ?? participant.person_id)}:${participantIndex}`}
                          className="flex max-w-full items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-900"
                        >
                          <Icon
                            name="user"
                            size={12}
                            className="text-neutral-500"
                          />
                          <span className="truncate font-medium">
                            {value(
                              participant.displayName ??
                                participant.display_name,
                              t("Persona"),
                            )}
                          </span>
                          <span className="text-[10px] text-neutral-500">
                            {value(participant.role, t("otro"))}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              </li>
            );
          })}
        </ol>
      ) : (
        <SurfaceEmpty label={descriptor.label} />
      )}
    </div>
  );
}

function _TreeCatalog({
  rows,
  persons,
  descriptor,
  onOpen,
  onOpenPerson,
}: {
  rows: JsonRecord[];
  persons: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
  onOpenPerson?: (person: JsonRecord) => void;
}) {
  const personNames = new Map(
    persons.map((person) => [
      String(person.person_id ?? person.id),
      title(person),
    ]),
  );
  const displayPerson = (id: unknown, fallback = "Persona"): string =>
    value(
      id == null ? undefined : (personNames.get(String(id)) ?? id),
      fallback,
    );
  const levels = new Map<string, Array<{ row: JsonRecord; index: number }>>();
  rows
    .filter((row) => String(row.type ?? "parent") === "parent")
    .forEach((row, index) => {
      const parent = String(row.from_person ?? row.parent_id ?? "Raíz");
      const list = levels.get(parent) ?? [];
      list.push({ row, index });
      levels.set(parent, list);
    });
  const connected = new Set(
    rows
      .flatMap((row) => [row.from_person, row.to_person])
      .filter(Boolean)
      .map(String),
  );
  const otherRows = rows.filter((row) => String(row.type ?? "") !== "parent");
  const isolated = persons.filter(
    (person) => !connected.has(String(person.person_id ?? person.id)),
  );
  return (
    <div className="min-h-0 overflow-auto p-5" data-testid="vault-tree">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Icon name="tree" size={14} />
          <span>
            {persons.length || connected.size} {t("personas")} · {rows.length}{" "}
            {t("vínculos publicados")}
          </span>
        </div>
        {levels.size
          ? [...levels.entries()].map(([parent, children]) => (
              <section
                key={parent}
                className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-[color-mix(in_srgb,var(--vault-accent,#6366f1)_15%,transparent)] text-[var(--vault-accent,#818cf8)]">
                    <Icon name="user" size={14} />
                  </span>
                  <span className="truncate">
                    {displayPerson(parent, t("Raíz"))}
                  </span>
                </div>
                <div className="ml-4 mt-3 border-l border-neutral-200 pl-5 dark:border-neutral-800">
                  <div className="flex flex-wrap gap-2">
                    {children.map(({ row, index }) => (
                      <button
                        key={`${rowId(row, index)}`}
                        onClick={() => onOpen(row, index)}
                        className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-left text-xs hover:border-indigo-300 dark:border-neutral-800 dark:bg-neutral-900/45 dark:hover:border-indigo-800"
                      >
                        <Icon
                          name="user"
                          size={12}
                          className="text-indigo-500"
                        />
                        <span>
                          <strong className="block">
                            {displayPerson(row.to_person ?? row.child_id)}
                          </strong>
                          <span className="text-[10px] text-neutral-500">
                            {value(
                              row.label ?? row.subtype ?? row.type,
                              t("Vínculo"),
                            )}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            ))
          : null}
        {otherRows.length > 0 && (
          <section className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("Otros vínculos familiares")}
            </h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {otherRows.map((row, index) => (
                <button
                  key={`${rowId(row, index)}`}
                  onClick={() => onOpen(row, index)}
                  className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-left text-xs hover:border-indigo-300 dark:border-neutral-800 dark:bg-neutral-900/45 dark:hover:border-indigo-800"
                >
                  <Icon name="link" size={12} className="text-indigo-500" />
                  <span className="truncate">
                    {displayPerson(row.from_person)} →{" "}
                    {displayPerson(row.to_person)}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-neutral-500">
                    {value(row.label ?? row.subtype ?? row.type, t("Vínculo"))}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {isolated.length > 0 && (
          <section className="rounded-xl border border-dashed border-neutral-300 p-3 dark:border-neutral-800">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("Personas sin vínculos")}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {isolated.map((person, index) => (
                <button
                  key={String(person.person_id ?? person.id ?? index)}
                  onClick={() => onOpenPerson?.(person)}
                  className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs hover:border-indigo-300 dark:border-neutral-800 dark:bg-neutral-900/45"
                >
                  <Icon name="user" size={12} className="text-indigo-500" />
                  {title(person)}
                </button>
              ))}
            </div>
          </section>
        )}
        {!levels.size && !otherRows.length && !isolated.length && (
          <SurfaceEmpty label={descriptor.label} />
        )}
      </div>
    </div>
  );
}

/** Read-only SVG tree. Layout and edge semantics intentionally use the same pure
 * geometry shared by Desktop TreeView; only the publication-safe rendering differs
 * (the server never edits or persists the snapshot). */
function PublishedTreeCatalog({
  rows,
  persons,
  spaceId,
  onOpenPerson,
}: {
  rows: JsonRecord[];
  persons: JsonRecord[];
  spaceId: string;
  onOpenPerson?: (person: JsonRecord) => void;
}) {
  const light = useIsLightTheme();
  const ids = persons
    .map((person) => String(person.person_id ?? person.id))
    .filter(Boolean);
  const byId = useMemo(
    () =>
      new Map(
        persons.map((person) => [
          String(person.person_id ?? person.id),
          person,
        ]),
      ),
    [persons],
  );
  const [focus, setFocus] = useState(ids[0] ?? "");
  const [orientation, setOrientation] = useState<
    "ancestors_top" | "ancestors_bottom"
  >("ancestors_top");
  const [zoom, setZoom] = useState(1);
  const [search, setSearch] = useState("");
  const [paternalColor, setPaternalColor] = useState("#2563eb");
  const [maternalColor, setMaternalColor] = useState("#dc2626");
  const [paternalVisible, setPaternalVisible] = useState(true);
  const [maternalVisible, setMaternalVisible] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (!focus || !byId.has(focus)) setFocus(ids[0] ?? "");
  }, [byId, focus, ids]);

  const parentEdges = useMemo(
    () =>
      rows.flatMap((row) => {
        const parent = String(row.from_person ?? "");
        const child = String(row.to_person ?? "");
        return row.type === "parent" && parent && child
          ? [{ parent, child }]
          : [];
      }),
    [rows],
  );
  const spouseEdges = useMemo(
    () =>
      rows.flatMap((row) => {
        const a = String(row.from_person ?? "");
        const b = String(row.to_person ?? "");
        return row.type === "spouse" && a && b ? [{ a, b }] : [];
      }),
    [rows],
  );
  const siblingEdges = useMemo(
    () =>
      rows.flatMap((row) => {
        const a = String(row.from_person ?? "");
        const b = String(row.to_person ?? "");
        return row.type === "sibling" && a && b ? [{ a, b }] : [];
      }),
    [rows],
  );
  const treePersons = useMemo(
    () =>
      persons.map((person) => ({
        id: String(person.person_id ?? person.id),
        sex: value(person.sex, "unknown"),
        birthYear: parseHistoricalDate(value(person.birth_date, "")).year,
      })),
    [persons],
  );
  const kinship = useMemo(
    () =>
      deriveTreeKinship({
        focusId: focus,
        parentEdges,
        spouseEdges,
        siblingEdges,
        persons: treePersons,
      }),
    [focus, parentEdges, siblingEdges, spouseEdges, treePersons],
  );
  const visiblePersonIds = useMemo(
    () =>
      new Set(
        treePersons.flatMap((person) => {
          const branch = kinship.get(person.id)?.branch ?? "neutral";
          if (branch === "paternal" && !paternalVisible) return [];
          if (branch === "maternal" && !maternalVisible) return [];
          return [person.id];
        }),
      ),
    [kinship, maternalVisible, paternalVisible, treePersons],
  );
  const visibleTreePersons = useMemo(
    () => treePersons.filter((person) => visiblePersonIds.has(person.id)),
    [treePersons, visiblePersonIds],
  );
  const visibleParentEdges = useMemo(
    () =>
      parentEdges.filter(
        (edge) =>
          visiblePersonIds.has(edge.parent) && visiblePersonIds.has(edge.child),
      ),
    [parentEdges, visiblePersonIds],
  );
  const visibleSpouseEdges = useMemo(
    () =>
      spouseEdges.filter(
        (edge) => visiblePersonIds.has(edge.a) && visiblePersonIds.has(edge.b),
      ),
    [spouseEdges, visiblePersonIds],
  );
  const visibleSiblingEdges = useMemo(
    () =>
      siblingEdges.filter(
        (edge) => visiblePersonIds.has(edge.a) && visiblePersonIds.has(edge.b),
      ),
    [siblingEdges, visiblePersonIds],
  );
  const layout = useMemo(
    () =>
      computeTreeLayout({
        focusId: focus,
        persons: visibleTreePersons,
        parentEdges: visibleParentEdges,
        spouseEdges: visibleSpouseEdges,
        siblingEdges: visibleSiblingEdges,
        nodeWidth: 128,
        nodeHeight: 176,
        hGap: 52,
        vGap: 52,
        orientation,
        branchByPerson: Object.fromEntries(
          [...kinship].map(([id, context]) => [id, context.branch]),
        ),
      }),
    [
      focus,
      kinship,
      orientation,
      visibleParentEdges,
      visibleSiblingEdges,
      visibleSpouseEdges,
      visibleTreePersons,
    ],
  );
  const positions = useMemo(
    () => new Map(layout.nodes.map((node) => [node.personId, node])),
    [layout.nodes],
  );
  const families = useMemo(
    () => buildTreeFamilies(parentEdges, layout.nodes),
    [layout.nodes, parentEdges],
  );
  const visibleIds = useMemo(
    () => new Set(layout.nodes.map((node) => node.personId)),
    [layout.nodes],
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const isMatch = (id: string) =>
    !normalizedSearch ||
    value(title(byId.get(id) ?? {}), "")
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  const pad = 40;
  const nodeW = 128;
  const nodeH = 176;
  const frameW = 100;
  const frameH = 116;
  const width = Math.max(760, layout.width + pad * 2);
  const height = Math.max(260, layout.height + pad * 2);
  const setFocusAndCenter = (id: string) => {
    setFocus(id);
    window.setTimeout(() => {
      const viewport = viewportRef.current;
      const node = viewport?.querySelector<SVGGElement>(
        `[data-tree-person-id="${CSS.escape(id)}"]`,
      );
      if (!viewport || !node) return;
      const a = viewport.getBoundingClientRect();
      const b = node.getBoundingClientRect();
      viewport.scrollBy({
        left: b.left + b.width / 2 - (a.left + a.width / 2),
        top: b.top + b.height / 2 - (a.top + a.height / 2),
        behavior: "smooth",
      });
    }, 0);
  };
  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !viewportRef.current) return;
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewportRef.current.scrollLeft,
      top: viewportRef.current.scrollTop,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const viewport = viewportRef.current;
    if (!pan || !viewport) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 4) return;
    pan.moved = true;
    suppressClick.current = true;
    viewport.scrollLeft = pan.left - dx;
    viewport.scrollTop = pan.top - dy;
    event.preventDefault();
  };
  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    const moved = panRef.current.moved;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (moved)
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
  };
  const portrait = (person: JsonRecord, _side: "left" | "right" | "none") => {
    const raw = person.portrait;
    const record =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as JsonRecord)
        : null;
    const hash = String(record?.thumbHash ?? record?.hash ?? "");
    return hash ? (
      <img
        src={api.assetUrl(spaceId, hash)}
        alt=""
        draggable={false}
        className="h-full w-full object-cover"
      />
    ) : (
      <div className="grid h-full w-full place-items-center bg-neutral-800 text-neutral-400">
        <Icon name="user" size={32} />
      </div>
    );
  };
  const branchColor = (id: string) => {
    const branch = kinship.get(id)?.branch ?? "neutral";
    return branch === "paternal"
      ? branchColorForTheme(paternalColor, kinship.get(id)?.tone ?? 0, light)
      : branch === "maternal"
        ? branchColorForTheme(maternalColor, kinship.get(id)?.tone ?? 0, light)
        : light
          ? "#a16207"
          : "#facc15";
  };
  return (
    <div className="min-h-0 overflow-auto p-5" data-testid="vault-tree">
      <div className="mx-auto max-w-7xl space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
          <Icon name="tree" size={14} />
          <span>
            {persons.length} {t("personas")} · {rows.length}{" "}
            {t("vínculos publicados")}
          </span>
          <label className="flex items-center gap-2">
            {t("Centrar en")}
            <select
              data-testid="tree-focus-person"
              className="input h-9 max-w-48 text-xs"
              value={focus}
              onChange={(event) => setFocusAndCenter(event.target.value)}
            >
              {persons.map((person) => {
                const id = String(person.person_id ?? person.id);
                return (
                  <option key={id} value={id}>
                    {title(person)}
                  </option>
                );
              })}
            </select>
          </label>
          <div className="relative min-w-44 flex-1">
            <Icon
              name="search"
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
            />
            <input
              data-testid="tree-search-input"
              role="searchbox"
              aria-label={t("Buscar personas en el árbol")}
              className="input input-with-leading-icon h-9 w-full text-xs"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Buscar en el árbol…")}
            />
          </div>
          <button
            className="btn btn-ghost h-9 border border-neutral-200 px-2 text-xs dark:border-neutral-700"
            data-testid="tree-orientation"
            onClick={() =>
              setOrientation((current) =>
                current === "ancestors_top"
                  ? "ancestors_bottom"
                  : "ancestors_top",
              )
            }
          >
            <Icon
              name={orientation === "ancestors_top" ? "arrowUp" : "arrowDown"}
              size={13}
            />
            {orientation === "ancestors_top"
              ? t("Ascendientes arriba")
              : t("Ascendientes abajo")}
          </button>
          <div
            className="flex items-center gap-2"
            data-testid="tree-branch-color-controls"
          >
            <label
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 ${paternalVisible ? "border-neutral-200 dark:border-neutral-700" : "opacity-50"}`}
            >
              <input
                type="color"
                value={paternalColor}
                onChange={(event) => setPaternalColor(event.target.value)}
                aria-label={t("Color de la rama paterna")}
                data-testid="tree-paternal-color"
              />
              <span>{t("Paterna")}</span>
              <button
                type="button"
                aria-pressed={paternalVisible}
                aria-label={
                  paternalVisible
                    ? t("Ocultar rama paterna")
                    : t("Mostrar rama paterna")
                }
                data-testid="tree-paternal-visibility"
                onClick={() => setPaternalVisible((current) => !current)}
              >
                <Icon name={paternalVisible ? "eye" : "eyeOff"} size={13} />
              </button>
            </label>
            <label
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 ${maternalVisible ? "border-neutral-200 dark:border-neutral-700" : "opacity-50"}`}
            >
              <input
                type="color"
                value={maternalColor}
                onChange={(event) => setMaternalColor(event.target.value)}
                aria-label={t("Color de la rama materna")}
                data-testid="tree-maternal-color"
              />
              <span>{t("Materna")}</span>
              <button
                type="button"
                aria-pressed={maternalVisible}
                aria-label={
                  maternalVisible
                    ? t("Ocultar rama materna")
                    : t("Mostrar rama materna")
                }
                data-testid="tree-maternal-visibility"
                onClick={() => setMaternalVisible((current) => !current)}
              >
                <Icon name={maternalVisible ? "eye" : "eyeOff"} size={13} />
              </button>
            </label>
          </div>
          <button
            className="btn btn-ghost h-9 px-2"
            aria-label={t("Alejar")}
            onClick={() => setZoom((current) => Math.max(0.4, current - 0.15))}
          >
            −
          </button>
          <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button
            className="btn btn-ghost h-9 px-2"
            aria-label={t("Acercar")}
            onClick={() => setZoom((current) => Math.min(2, current + 0.15))}
          >
            +
          </button>
        </div>
        <div
          ref={viewportRef}
          className="min-h-[28rem] overflow-auto rounded-2xl border border-neutral-200 bg-neutral-950/40 p-4 dark:border-neutral-800"
          data-testid="tree-pan-viewport"
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onClickCapture={(event) => {
            if (suppressClick.current) {
              event.preventDefault();
              event.stopPropagation();
              suppressClick.current = false;
            }
          }}
        >
          <svg
            width={width * zoom}
            height={height * zoom}
            viewBox={`0 0 ${width} ${height}`}
            className="select-none"
            role="img"
            aria-label={t("Árbol genealógico publicado")}
            data-testid="tree-svg"
          >
            <TreeFrameDefs />
            {families.map((family) => {
              const parents = family.parentIds
                .map((id) => positions.get(id))
                .filter(Boolean);
              const children = family.childIds
                .map((id) => positions.get(id))
                .filter(Boolean);
              if (!parents.length || !children.length) return null;
              const parentY =
                orientation === "ancestors_top"
                  ? Math.max(...parents.map((node) => node!.y)) + pad + frameH
                  : Math.min(...parents.map((node) => node!.y)) + pad;
              const childY =
                orientation === "ancestors_top"
                  ? Math.min(...children.map((node) => node!.y)) + pad
                  : Math.max(...children.map((node) => node!.y)) + pad + frameH;
              const anchorX =
                parents.length > 1
                  ? parents.reduce(
                      (sum, node) => sum + node!.x + pad + nodeW / 2,
                      0,
                    ) / parents.length
                  : parents[0]!.x + pad + nodeW / 2;
              const laneY = treeFamilyLaneY(family, layout.nodes, nodeH, pad);
              const points = children.map((node) => ({
                x: node!.x + pad + nodeW / 2,
                y: childY,
              }));
              const path = [
                `M ${anchorX} ${parentY} V ${laneY}`,
                `M ${Math.min(anchorX, ...points.map((point) => point.x))} ${laneY} H ${Math.max(anchorX, ...points.map((point) => point.x))}`,
                ...points.map((point) => `M ${point.x} ${laneY} V ${point.y}`),
              ].join(" ");
              const familyColor = branchColor(
                family.childIds[0] ?? family.parentIds[0] ?? "",
              );
              return (
                <path
                  key={family.id}
                  data-tree-family={family.id}
                  d={path}
                  fill="none"
                  stroke={familyColor}
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                />
              );
            })}
            {layout.edges
              .filter((edge) => edge.kind !== "parent")
              .map((edge, index) => {
                const a = positions.get(edge.from);
                const b = positions.get(edge.to);
                if (!a || !b) return null;
                const from = a.x < b.x ? a.x + pad + nodeW : a.x + pad;
                const to = a.x < b.x ? b.x + pad : b.x + pad + nodeW;
                return (
                  <line
                    key={`${edge.kind}-${index}`}
                    data-tree-edge-kind={edge.kind}
                    x1={from}
                    y1={a.y + pad + frameH / 2}
                    x2={to}
                    y2={b.y + pad + frameH / 2}
                    className={
                      edge.kind === "spouse"
                        ? "stroke-amber-700"
                        : "stroke-slate-400"
                    }
                    strokeWidth="2"
                    strokeDasharray={edge.kind === "spouse" ? "3 4" : "7 4"}
                  />
                );
              })}
            {layout.nodes
              .filter((node) => visibleIds.has(node.personId))
              .map((node) => {
                const person = byId.get(node.personId);
                if (!person) return null;
                const match = isMatch(node.personId);
                const x = node.x + pad;
                const y = node.y + pad;
                return (
                  <g
                    key={node.personId}
                    data-tree-person-id={node.personId}
                    data-tree-branch={
                      kinship.get(node.personId)?.branch ?? "neutral"
                    }
                    data-testid="tree-person-node"
                    opacity={match ? 1 : 0.22}
                    style={{ cursor: "pointer" }}
                    onDoubleClick={() => setFocusAndCenter(node.personId)}
                  >
                    <title>{title(person)}</title>
                    <TreeFrame
                      x={x + (nodeW - frameW) / 2}
                      y={y}
                      w={frameW}
                      h={frameH}
                      frame="oak"
                      sex={value(person.sex, "unknown")}
                      portrait={portrait(person, node.coupleSide)}
                    />
                    <text
                      x={x + nodeW / 2}
                      y={y + frameH + 18}
                      textAnchor="middle"
                      className="fill-neutral-800 text-[13px] font-semibold dark:fill-neutral-100"
                      stroke="currentColor"
                      strokeOpacity=".35"
                      paintOrder="stroke"
                    >
                      {title(person).length > 16
                        ? `${title(person).slice(0, 15)}…`
                        : title(person)}
                    </text>
                    <text
                      x={x + nodeW / 2}
                      y={y + frameH + 38}
                      textAnchor="middle"
                      className="fill-neutral-500 text-[10px]"
                    >
                      {value(person.birth_date, "")}
                    </text>
                    <foreignObject
                      x={x + 4}
                      y={y + frameH + 45}
                      width={nodeW - 8}
                      height={24}
                    >
                      <button
                        className="w-full truncate rounded px-1 text-[10px] text-indigo-600 hover:bg-indigo-100 dark:hover:bg-indigo-950"
                        onClick={() => {
                          if (!suppressClick.current) onOpenPerson?.(person);
                        }}
                      >
                        {t("Abrir ficha")}
                      </button>
                    </foreignObject>
                  </g>
                );
              })}
          </svg>
        </div>
      </div>
    </div>
  );
}

function WorldMapCatalog({
  rows,
  spaceId,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  spaceId: string;
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  return (
    <div className="min-h-0 overflow-auto p-5" data-testid="vault-world-maps">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.length ? (
          rows.map((row, index) => {
            const image =
              row.image &&
              typeof row.image === "object" &&
              !Array.isArray(row.image)
                ? (row.image as JsonRecord)
                : null;
            const hash = String(image?.thumbHash ?? image?.hash ?? "");
            return (
              <button
                key={`${rowId(row, index)}`}
                onClick={() => onOpen(row, index)}
                className="group overflow-hidden rounded-2xl border border-neutral-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg dark:border-neutral-800 dark:bg-neutral-900/45 dark:hover:border-indigo-800"
                data-testid="world-map-card"
              >
                <div className="relative grid h-40 place-items-center overflow-hidden bg-gradient-to-br from-indigo-100 via-violet-100 to-sky-100 text-indigo-500 dark:from-indigo-950/60 dark:via-violet-950/40 dark:to-sky-950/40">
                  {hash ? (
                    <img
                      src={api.assetUrl(spaceId, hash)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Icon name="map" size={30} />
                  )}
                  <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                    {value(row.kind, "Mapa")}
                  </span>
                </div>
                <div className="p-3">
                  <strong className="block truncate text-sm">
                    {title(row)}
                  </strong>
                  <span className="mt-1 block line-clamp-2 text-xs text-neutral-500">
                    {value(
                      row.parent_map_id
                        ? "Mapa anidado"
                        : row.place_id
                          ? "Mapa de un lugar"
                          : row.notes,
                      descriptor.description,
                    )}
                  </span>
                </div>
              </button>
            );
          })
        ) : (
          <SurfaceEmpty label={descriptor.label} />
        )}
      </div>
    </div>
  );
}

function MapCatalog({
  rows,
  spaceId,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  spaceId: string;
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  if (descriptor.collection === "world-maps")
    return (
      <WorldMapCatalog
        rows={rows}
        spaceId={spaceId}
        descriptor={descriptor}
        onOpen={onOpen}
      />
    );
  const positions = rows.flatMap((row, index) => {
    const raw = row.coordinates ?? row.location;
    const object =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as JsonRecord)
        : undefined;
    const array = Array.isArray(raw) ? raw : undefined;
    const numbers =
      typeof raw === "string"
        ? (raw.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [])
        : [];
    const lat = Number(
      row.latitude ??
        row.lat ??
        object?.latitude ??
        object?.lat ??
        array?.[0] ??
        numbers[0],
    );
    const lon = Number(
      row.longitude ??
        row.lon ??
        object?.longitude ??
        object?.lon ??
        array?.[1] ??
        numbers[1],
    );
    // A missing coordinate is missing data, not an invitation to place a marker.
    // This matters especially for world-maps: that collection describes canvases,
    // not geographic points.
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    )
      return [];
    return [
      {
        row,
        index,
        left: Math.max(4, Math.min(96, ((lon + 180) / 360) * 100)),
        top: Math.max(6, Math.min(94, ((90 - lat) / 180) * 100)),
      },
    ];
  });
  return (
    <div
      className="grid min-h-0 gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_18rem]"
      data-testid="vault-map"
    >
      <div className="relative min-h-[27rem] overflow-hidden rounded-2xl border border-neutral-200 bg-sky-50 dark:border-neutral-800 dark:bg-slate-950">
        <div className="absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(100,116,139,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(100,116,139,.12)_1px,transparent_1px)] [background-size:42px_42px]" />
        <div className="absolute inset-[14%_8%] rounded-[45%] border border-emerald-300/60 bg-emerald-100/60 dark:border-emerald-900 dark:bg-emerald-950/40" />
        {positions.map(({ row, index, left, top }) => (
          <button
            key={`${rowId(row, index)}`}
            data-testid="vault-map-marker"
            className="absolute z-10 grid h-9 min-w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-indigo-600 px-2 text-[10px] font-semibold text-white shadow-lg transition-transform hover:scale-110 dark:border-neutral-950"
            style={{ left: `${left}%`, top: `${top}%` }}
            title={title(row)}
            onClick={() => onOpen(row, index)}
          >
            <Icon name="mapPin" size={14} />
          </button>
        ))}
        {!positions.length && (
          <p className="absolute inset-0 grid place-items-center p-8 text-center text-xs text-neutral-500">
            {t("No hay coordenadas publicadas; no se muestran marcadores.")}
          </p>
        )}
      </div>
      <aside className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {descriptor.label}
        </h2>
        {rows.length ? (
          rows.map((row, index) => (
            <button
              key={`${rowId(row, index)}`}
              onClick={() => onOpen(row, index)}
              className="flex w-full items-start gap-2 rounded-lg border border-neutral-200 p-2.5 text-left text-xs hover:border-indigo-300 dark:border-neutral-800 dark:hover:border-indigo-800"
            >
              <Icon
                name={descriptor.collection === "world-maps" ? "map" : "mapPin"}
                size={13}
                className="mt-0.5 shrink-0 text-indigo-500"
              />
              <span className="min-w-0">
                <strong className="block truncate">{title(row)}</strong>
                <span className="mt-0.5 block line-clamp-2 text-[10px] text-neutral-500">
                  {value(row.description ?? row.summary, t("Sin descripción"))}
                </span>
              </span>
            </button>
          ))
        ) : (
          <SurfaceEmpty label={descriptor.label} />
        )}
      </aside>
    </div>
  );
}

type StudyCalendarMode = "month" | "week" | "year";
const STUDY_CALENDAR_TYPES: Record<
  string,
  { label: string; className: string; dot: string }
> = {
  exam: {
    label: "Examen",
    className:
      "border-red-300 bg-red-100 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
    dot: "bg-red-500",
  },
  assignment: {
    label: "Entrega",
    className:
      "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
    dot: "bg-amber-500",
  },
  class: {
    label: "Clase",
    className:
      "border-indigo-300 bg-indigo-100 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-100",
    dot: "bg-indigo-500",
  },
  session: {
    label: "Sesión de estudio",
    className:
      "border-teal-300 bg-teal-100 text-teal-900 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-100",
    dot: "bg-teal-500",
  },
};
function localCalendarDate(row: JsonRecord): Date | null {
  const raw = row.starts_at ?? row.start_date ?? row.date;
  if (!raw) return null;
  const date = new Date(String(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}
function calendarDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function startOfCalendarDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}
function mondayCalendar(date: Date): Date {
  const next = startOfCalendarDay(date);
  next.setDate(next.getDate() - ((next.getDay() + 6) % 7));
  return next;
}
function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
function calendarMonthDays(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  return Array.from({ length: 42 }, (_, index) =>
    addCalendarDays(mondayCalendar(first), index),
  );
}
function calendarType(row: JsonRecord): {
  label: string;
  className: string;
  dot: string;
} {
  return (
    STUDY_CALENDAR_TYPES[String(row.event_type ?? row.type ?? "session")] ??
    STUDY_CALENDAR_TYPES.session
  );
}
function calendarDateLabel(date: Date, mode: StudyCalendarMode): string {
  return mode === "year"
    ? String(date.getFullYear())
    : mode === "week"
      ? `${date.toLocaleDateString(getActiveLang(), { day: "numeric", month: "short" })} – ${addCalendarDays(date, 6).toLocaleDateString(getActiveLang(), { day: "numeric", month: "short", year: "numeric" })}`
      : date.toLocaleDateString(getActiveLang(), { month: "long", year: "numeric" });
}
function calendarWeekdayLabel(date: Date, narrow = false): string {
  return date.toLocaleDateString(getActiveLang(), {
    weekday: narrow ? "narrow" : "short",
  });
}

/** Calendar replica for published events. It keeps Desktop's month/week/year navigation;
 * create/edit/reminder controls are intentionally omitted because the source snapshot is
 * immutable, while every visible event remains a real published row. */
function CalendarCatalog({
  rows,
  spaceId,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  spaceId: string;
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const [mode, setMode] = useState<StudyCalendarMode>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [agenda, setAgenda] = useState<JsonRecord | null>(null);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const indexed = useMemo(
    () =>
      rows
        .map((row, index) => ({ row, index, date: localCalendarDate(row) }))
        .filter(
          (entry): entry is { row: JsonRecord; index: number; date: Date } =>
            Boolean(entry.date),
        ),
    [rows],
  );
  const byDay = useMemo(() => {
    const result = new Map<string, Array<{ row: JsonRecord; index: number }>>();
    indexed.forEach(({ row, index, date }) => {
      const list = result.get(calendarDayKey(date)) ?? [];
      list.push({ row, index });
      result.set(calendarDayKey(date), list);
    });
    return result;
  }, [indexed]);
  useEffect(() => {
    if (!agendaOpen || agenda) return;
    let alive = true;
    setAgendaLoading(true);
    api
      .studyAgenda(spaceId, { limit: "200" })
      .then((next) => {
        if (alive) setAgenda(next);
      })
      .catch(() => {
        if (alive)
          setAgenda({
            error: t("No se ha podido cargar la agenda publicada."),
          });
      })
      .finally(() => {
        if (alive) setAgendaLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [agenda, agendaOpen, spaceId]);
  const agendaItems = useMemo(() => {
    if (!agenda) return [];
    const events = Array.isArray(agenda.events)
      ? (agenda.events as JsonRecord[])
      : [];
    const blocks = Array.isArray(agenda.blocks)
      ? (agenda.blocks as JsonRecord[])
      : [];
    return [
      ...events.map((row) => ({ row, kind: "Evento" })),
      ...blocks.map((row) => ({ row, kind: "Bloque de estudio" })),
    ].sort((a, b) =>
      String(a.row.starts_at ?? "").localeCompare(
        String(b.row.starts_at ?? ""),
      ),
    );
  }, [agenda]);
  const move = (amount: number) =>
    setCursor((current) => {
      const next = new Date(current);
      if (mode === "month") next.setMonth(next.getMonth() + amount);
      else if (mode === "week") next.setDate(next.getDate() + amount * 7);
      else next.setFullYear(next.getFullYear() + amount);
      return next;
    });
  const renderEvent = ({ row, index }: { row: JsonRecord; index: number }) => {
    const type = calendarType(row);
    const date = localCalendarDate(row);
    const time =
      date && row.all_day !== 1 && row.all_day !== true
        ? date.toLocaleTimeString(getActiveLang(), {
            hour: "2-digit",
            minute: "2-digit",
          })
        : t("Todo el día");
    return (
      <button
        key={`${rowId(row, index)}`}
        data-testid="study-calendar-event-bar"
        onClick={() => onOpen(row, index)}
        title={title(row)}
        className={`flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[10px] font-medium shadow-sm hover:brightness-95 ${type.className}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${type.dot}`} />
        <span className="truncate">
          <span className="mr-1 text-[9px] opacity-70">{time}</span>
          {title(row)}
        </span>
      </button>
    );
  };
  const monthDays = calendarMonthDays(cursor);
  const weekDays = Array.from({ length: 7 }, (_, index) =>
    addCalendarDays(mondayCalendar(cursor), index),
  );
  return (
    <div className="min-h-0 overflow-auto p-5" data-testid="vault-calendar">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost h-8 w-8 p-0"
            aria-label={t("Anterior")}
            onClick={() => move(-1)}
          >
            <Icon name="chevronLeft" size={14} />
          </button>
          <button
            className="btn btn-ghost h-8 px-3 text-xs"
            onClick={() => setCursor(new Date())}
          >
            {t("Hoy")}
          </button>
          <button
            className="btn btn-ghost h-8 w-8 p-0"
            aria-label={t("Siguiente")}
            onClick={() => move(1)}
          >
            <Icon name="chevronRight" size={14} />
          </button>
        </div>
        <h2 className="ml-2 text-base font-semibold capitalize">
          {calendarDateLabel(cursor, mode)}
        </h2>
        <div className="ml-auto inline-flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
          {(["month", "week", "year"] as StudyCalendarMode[]).map((item) => (
            <button
              key={item}
              data-testid={`study-calendar-view-${item}`}
              className={`rounded-md px-3 py-1.5 text-xs ${mode === item ? "bg-teal-600 text-white" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"}`}
              onClick={() => setMode(item)}
            >
              {item === "month"
                ? t("Mes")
                : item === "week"
                  ? t("Semana")
                  : t("Año")}
            </button>
          ))}
          <button
            data-testid="study-calendar-agenda"
            className={`ml-1 rounded-md px-3 py-1.5 text-xs ${agendaOpen ? "bg-teal-600 text-white" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"}`}
            onClick={() => setAgendaOpen((value) => !value)}
          >
            {t("Agenda")}
          </button>
        </div>
      </header>
      {agendaOpen && (
        <section className="mb-4 space-y-3" data-testid="study-agenda">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">
                {t("Agenda de estudio")}
              </h3>
              <p className="text-xs text-neutral-500">
                {t("Eventos y bloques publicados, ordenados por fecha.")}
              </p>
            </div>
            <span className="text-[10px] text-neutral-500">
              {t("Solo lectura")}
            </span>
          </div>
          {agendaLoading ? (
            <Loading />
          ) : agenda?.error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {value(agenda.error)}
            </p>
          ) : agendaItems.length ? (
            <div className="space-y-2">
              {agendaItems.map(({ row, kind }, index) => (
                <button
                  key={`${kind}:${rowId(row, index)}`}
                  className="flex w-full items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-left hover:border-teal-300 dark:border-neutral-800 dark:bg-neutral-900/40"
                  onClick={() =>
                    kind === "Evento" && onOpen(row, rows.indexOf(row))
                  }
                >
                  <time className="w-28 shrink-0 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                    {value(row.starts_at, "Sin fecha")}
                  </time>
                  <span className="min-w-0">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                      {t(kind)}
                    </span>
                    <strong className="mt-1 block text-sm">{title(row)}</strong>
                    <span className="mt-1 block text-xs text-neutral-500">
                      {value(row.description ?? row.notes, "")}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <SurfaceEmpty label="Agenda" />
          )}
        </section>
      )}
      {
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-neutral-500">
          {Object.entries(STUDY_CALENDAR_TYPES).map(([key, type]) => (
            <span key={key} className="inline-flex items-center gap-1">
              <i className={`h-1.5 w-1.5 rounded-full ${type.dot}`} />
              {t(type.label)}
            </span>
          ))}
          <span className="ml-auto">
            {tx("{n} eventos publicados · solo lectura", { n: indexed.length })}
          </span>
        </div>
      }
      {mode === "month" && (
        <div
          className="min-w-[760px] overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
          data-testid="study-calendar-month-grid"
        >
          <div className="grid grid-cols-7 border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
            {monthDays.slice(0, 7).map((date) => (
              <div
                key={date.toISOString()}
                className="px-2 py-2 text-center text-[10px] font-semibold uppercase text-neutral-500"
              >
                {calendarWeekdayLabel(date)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((date) => {
              const entries = byDay.get(calendarDayKey(date)) ?? [];
              return (
                <section
                  key={date.toISOString()}
                  className={`min-h-28 border-b border-r border-neutral-200 p-1.5 dark:border-neutral-800 ${date.getMonth() !== cursor.getMonth() ? "bg-neutral-50 text-neutral-400 dark:bg-neutral-950/40 dark:text-neutral-600" : ""}`}
                  data-testid="study-calendar-month-day"
                >
                  <span
                    className={`mb-1 grid h-6 w-6 place-items-center rounded-full text-xs ${calendarDayKey(date) === calendarDayKey(new Date()) ? "bg-teal-600 text-white" : ""}`}
                  >
                    {date.getDate()}
                  </span>
                  <div className="space-y-1">
                    {entries.slice(0, 4).map(renderEvent)}
                    {entries.length > 4 && (
                      <span className="block px-1 text-[9px] text-neutral-500">
                        +{entries.length - 4} más
                      </span>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
      {mode === "week" && (
        <div
          className="grid min-w-[900px] grid-cols-7 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
          data-testid="study-calendar-week-grid"
        >
          {weekDays.map((date) => (
            <section
              key={date.toISOString()}
              className="min-h-[30rem] border-r border-neutral-200 p-2 last:border-r-0 dark:border-neutral-800"
            >
              <header className="mb-2 border-b border-neutral-200 pb-2 text-center dark:border-neutral-800">
                <span className="block text-[10px] uppercase text-neutral-500">
                  {calendarWeekdayLabel(date)}
                </span>
                <strong className="text-sm">{date.getDate()}</strong>
              </header>
              <div className="space-y-2">
                {(byDay.get(calendarDayKey(date)) ?? []).map(renderEvent)}
              </div>
            </section>
          ))}
        </div>
      )}
      {mode === "year" && (
        <div
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          data-testid="study-calendar-year-grid"
        >
          {Array.from({ length: 12 }, (_, month) => {
            const monthDate = new Date(cursor.getFullYear(), month, 1);
            const monthEntries = indexed.filter(
              ({ date }) =>
                date.getFullYear() === monthDate.getFullYear() &&
                date.getMonth() === month,
            );
            return (
              <section
                key={monthDate.toISOString()}
                className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950"
              >
                <button
                  className="mb-2 font-semibold capitalize hover:text-teal-600"
                  onClick={() => {
                    setCursor(monthDate);
                    setMode("month");
                  }}
                >
                  {monthDate.toLocaleDateString(getActiveLang(), { month: "long" })}
                </button>
                <div className="grid grid-cols-7 gap-1 text-[9px] text-neutral-500">
                  {calendarMonthDays(monthDate).slice(0, 7).map((date) => (
                    <span key={date.toISOString()} className="text-center">
                      {calendarWeekdayLabel(date, true)}
                    </span>
                  ))}
                  {calendarMonthDays(monthDate).map((date) => (
                    <span
                      key={date.toISOString()}
                      className={`grid h-6 place-items-center rounded ${date.getMonth() !== month ? "opacity-30" : ""}`}
                    >
                      {date.getDate()}
                      {(byDay.get(calendarDayKey(date)) ?? []).length > 0 && (
                        <i className="absolute h-1 w-1 rounded-full bg-teal-500" />
                      )}
                    </span>
                  ))}
                </div>
                <span className="mt-2 block text-[10px] text-neutral-500">
                  {tx("{n} eventos", { n: monthEntries.length })}
                </span>
              </section>
            );
          })}
        </div>
      )}
      {!rows.length && <SurfaceEmpty label={descriptor.label} />}
    </div>
  );
}

function AgendaCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const sorted = [...rows].sort((a, b) =>
    String(a.starts_at ?? "").localeCompare(String(b.starts_at ?? "")),
  );
  return (
    <div
      className="mx-auto grid max-w-5xl gap-5 p-5 lg:grid-cols-[12rem_minmax(0,1fr)]"
      data-testid="vault-agenda"
    >
      <aside className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {t("Esta semana")}
        </h2>
        <div className="mt-3 space-y-2">
          {["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"].map(
            (day, index) => (
              <div
                key={day}
                className="flex items-center justify-between rounded-lg bg-neutral-50 px-2 py-2 text-xs dark:bg-neutral-900/50"
              >
                <span>{t(day)}</span>
                <span className="text-neutral-500">
                  {
                    sorted.filter(
                      (row) =>
                        new Date(String(row.starts_at ?? "")).getDay() ===
                        index + 1,
                    ).length
                  }
                </span>
              </div>
            ),
          )}
        </div>
      </aside>
      <div className="space-y-2">
        {sorted.length ? (
          sorted.map((row, index) => (
            <button
              key={`${rowId(row, index)}`}
              onClick={() => onOpen(row, index)}
              className="flex w-full items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-left hover:border-indigo-300 dark:border-neutral-800 dark:bg-neutral-900/35 dark:hover:border-indigo-800"
            >
              <time className="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                {value(row.starts_at, t("Sin fecha"))}
              </time>
              <span className="min-w-0">
                <strong className="block text-sm">{title(row)}</strong>
                <span className="mt-1 block text-xs text-neutral-500">
                  {value(row.description, descriptor.description)}
                </span>
              </span>
            </button>
          ))
        ) : (
          <SurfaceEmpty label={descriptor.label} />
        )}
      </div>
    </div>
  );
}

function ScheduleCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  const labels: Record<string, string> = {
    monday: t("Lunes"),
    tuesday: t("Martes"),
    wednesday: t("Miércoles"),
    thursday: t("Jueves"),
    friday: t("Viernes"),
  };
  const years = [
    ...new Map(
      rows.map((row) => [
        String(row.academic_year_id ?? "none"),
        value(
          row.academic_year_label,
          row.academic_year_id
            ? String(row.academic_year_id)
            : t("Sin curso académico"),
        ),
      ]),
    ).entries(),
  ];
  const [year, setYear] = useState(years[0]?.[0] ?? "none");
  const visibleRows = rows.filter(
    (row) => String(row.academic_year_id ?? "none") === year,
  );
  const dayColors = jsonObject(visibleRows[0]?.day_colors);
  const readable = (color: string) => {
    const hex = color.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((offset) =>
      Number.parseInt(hex.slice(offset, offset + 2), 16),
    );
    return Number.isFinite(r) && (r * 299 + g * 587 + b * 114) / 1000 > 150
      ? "#171717"
      : "#fff";
  };
  return (
    <div className="min-h-0 overflow-auto p-5" data-testid="vault-schedule">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <Icon name="clock" size={14} className="text-teal-500" />
        <span>
          {visibleRows.length} {t("franjas publicadas")}
        </span>
        {years.length > 1 && (
          <label className="ml-auto flex items-center gap-2">
            {t("Curso académico")}
            <select
              className="input h-8 text-xs"
              data-testid="study-schedule-academic-year"
              value={year}
              onChange={(event) => setYear(event.target.value)}
            >
              {years.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className={years.length > 1 ? "" : "ml-auto"}>
          {t("Solo lectura · los cambios se realizan en Desktop")}
        </span>
      </div>
      <div className="grid min-w-[900px] grid-cols-[12rem_repeat(5,minmax(130px,1fr))] rounded-xl border border-neutral-200 dark:border-neutral-800">
        <div className="border-b border-r border-neutral-200 bg-neutral-50 p-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50">
          {t("Franja horaria")}
        </div>
        {days.map((day) => {
          const color =
            typeof dayColors[day] === "string" ? String(dayColors[day]) : "";
          return (
            <div
              key={day}
              className="border-b border-r border-neutral-200 p-3 text-center text-xs font-semibold dark:border-neutral-800"
              style={
                color
                  ? { backgroundColor: color, color: readable(color) }
                  : undefined
              }
            >
              {labels[day]}
            </div>
          );
        })}
        {visibleRows.map((period, index) => (
          <div key={`period-row:${rowId(period, index)}`} className="contents">
            <button
              onClick={() => onOpen(period, rows.indexOf(period))}
              className="border-b border-r border-neutral-200 p-3 text-left text-xs dark:border-neutral-800"
            >
              <strong className="block">
                {value(period.label, t("Franja"))}
              </strong>
              <span className="mt-1 block text-[10px] text-neutral-500">
                {value(period.start_time)}–{value(period.end_time)}
              </span>
            </button>
            {days.map((day) => {
              const cell = Array.isArray(period.cells)
                ? (period.cells as JsonRecord[]).find(
                    (entry) => String(entry.day) === day,
                  )
                : undefined;
              return (
                <div
                  key={`${rowId(period, index)}:${day}`}
                  className="min-h-20 border-b border-r border-neutral-200 p-2 dark:border-neutral-800"
                >
                  {cell ? (
                    <button
                      className="h-full w-full rounded-lg border border-teal-300/70 bg-teal-50 p-2 text-left text-[11px] dark:border-teal-900 dark:bg-teal-950/30"
                      onClick={() => onOpen(period, rows.indexOf(period))}
                    >
                      <strong className="block line-clamp-2">
                        {value(
                          cell.activity_title ?? cell.subject_name,
                          t("Asignatura"),
                        )}
                      </strong>
                    </button>
                  ) : (
                    <span className="grid h-full place-items-center text-[10px] text-neutral-400">
                      —
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {!visibleRows.length && (
          <div className="col-span-6 p-8">
            <SurfaceEmpty label={descriptor.label} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Study's graph is a real node/edge canvas, not the generic relation list used by
 * genealogy. The layout is deterministic (and therefore stable across reloads), while
 * every label and edge comes from the published study_ideas/study_idea_edges snapshot. */
function StudyNetworkCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [edgeFilter, setEdgeFilter] = useState("all");
  const [zoom, setZoom] = useState(1);
  const normalized = useMemo(
    () =>
      rows.map((row, index) => ({
        row,
        index,
        id: String(row.id ?? row.idea_id ?? row.global_id ?? index),
        label: value(row.label ?? row.title ?? row.name, "Idea"),
        type: String(row.type ?? "concept"),
        statement: value(row.statement, ""),
      })),
    [rows],
  );
  const filtered = useMemo(
    () =>
      normalized.filter(
        (entry) =>
          (typeFilter === "all" || entry.type === typeFilter) &&
          (!search.trim() ||
            `${entry.label} ${entry.statement}`
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase())),
      ),
    [normalized, search, typeFilter],
  );
  const selectedIds = new Set(filtered.map((entry) => entry.id));
  const nodes = filtered.map((entry) => ({ ...entry, kind: "idea" as const }));
  const edgeSet = new Set<string>();
  const edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
  }> = [];
  filtered.forEach(({ row, id }) => {
    const candidates = Array.isArray(row.edges) ? row.edges : [];
    candidates.forEach((raw, edgeIndex) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      const edge = raw as JsonRecord;
      const source = String(edge.from_id ?? edge.source ?? id);
      const target = String(edge.to_id ?? edge.target ?? id);
      const type = String(edge.type ?? edge.relation_type ?? "related");
      if (
        !selectedIds.has(source) ||
        !selectedIds.has(target) ||
        (edgeFilter !== "all" && type !== edgeFilter)
      )
        return;
      const key = `${String(edge.id ?? `${source}:${target}:${type}:${edgeIndex}`)}:${source}:${target}`;
      if (edgeSet.has(key)) return;
      edgeSet.add(key);
      edges.push({ id: key, source, target, type });
    });
  });
  const typeValues = [...new Set(normalized.map((entry) => entry.type))].sort();
  const edgeValues = [...new Set(edges.map((edge) => edge.type))].sort();
  const positions = new Map<string, { x: number; y: number }>();
  const width = 960;
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(nodes.length, 1))));
  const height = Math.max(560, Math.ceil(nodes.length / columns) * 125 + 100);
  nodes.forEach((node, index) =>
    positions.set(node.id, {
      x:
        100 +
        (index % columns) * Math.min(190, (width - 180) / Math.max(columns, 1)),
      y: 90 + Math.floor(index / columns) * 125,
    }),
  );
  return (
    <div className="min-h-0 overflow-auto p-5" data-testid="study-graph-view">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
          />
          <input
            data-testid="study-graph-search"
            className="input input-with-leading-icon w-full text-xs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("Buscar ideas…")}
          />
        </div>
        <select
          data-testid="study-graph-type"
          className="input h-9 text-xs"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="all">{t("Todos los tipos")}</option>
          {typeValues.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          data-testid="study-graph-edge-type"
          className="input h-9 text-xs"
          value={edgeFilter}
          onChange={(event) => setEdgeFilter(event.target.value)}
        >
          <option value="all">{t("Todas las relaciones")}</option>
          {edgeValues.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <button
          className="btn btn-ghost h-9 px-2"
          aria-label={t("Alejar")}
          onClick={() => setZoom((current) => Math.max(0.6, current - 0.1))}
        >
          −
        </button>
        <span className="text-xs text-neutral-500">
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="btn btn-ghost h-9 px-2"
          aria-label={t("Acercar")}
          onClick={() => setZoom((current) => Math.min(1.8, current + 0.1))}
        >
          +
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[10px] text-neutral-500">
        <span className="inline-flex items-center gap-1">
          <i className="h-2 w-2 rounded-full bg-teal-500" />
          {t("Ideas")}
        </span>
        <span>
          {nodes.length} {t("nodos")} · {edges.length}{" "}
          {t("relaciones publicadas")}
        </span>
        <span className="ml-auto">{t("El grafo es de solo lectura")}</span>
      </div>
      {nodes.length ? (
        <div className="overflow-auto rounded-2xl border border-neutral-200 bg-indigo-50/40 dark:border-neutral-800 dark:bg-indigo-950/15">
          <svg
            width={width * zoom}
            height={height * zoom}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={t("Grafo de estudio publicado")}
            data-testid="study-graph-svg"
          >
            <defs>
              <marker
                id="study-graph-arrow"
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6 z" className="fill-indigo-400" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const source = positions.get(edge.source);
              const target = positions.get(edge.target);
              return source && target ? (
                <line
                  key={edge.id}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  className="stroke-indigo-300 dark:stroke-indigo-700"
                  strokeWidth="1.5"
                  markerEnd="url(#study-graph-arrow)"
                />
              ) : null;
            })}
            {nodes.map((node) => {
              const point = positions.get(node.id);
              if (!point) return null;
              const rowIndex = normalized.findIndex(
                (entry) => entry.id === node.id,
              );
              return (
                <g
                  key={node.id}
                  transform={`translate(${point.x},${point.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`Abrir ${node.label}`}
                  data-testid="study-graph-node"
                  onClick={() =>
                    rowIndex >= 0 &&
                    onOpen(normalized[rowIndex].row, normalized[rowIndex].index)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (rowIndex >= 0)
                        onOpen(
                          normalized[rowIndex].row,
                          normalized[rowIndex].index,
                        );
                    }
                  }}
                >
                  <title>{node.label}</title>
                  <circle
                    r="31"
                    className="fill-white stroke-teal-500 shadow-sm dark:fill-neutral-900"
                    strokeWidth="2"
                  />
                  <text
                    textAnchor="middle"
                    y="-2"
                    className="fill-neutral-800 text-[10px] font-semibold dark:fill-neutral-100"
                  >
                    {node.label.length > 17
                      ? `${node.label.slice(0, 16)}…`
                      : node.label}
                  </text>
                  <text
                    textAnchor="middle"
                    y="13"
                    className="fill-neutral-500 text-[8px]"
                  >
                    {node.type}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <SurfaceEmpty label={descriptor.label} />
      )}
    </div>
  );
}

function NetworkCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  if (descriptor.collection === "prosopography-public-networks") {
    return (
      <div className="min-h-0 overflow-auto p-5" data-testid="vault-network">
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <article className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">
              {t("Capas publicadas")}
            </span>
            <strong className="mt-1 block text-2xl">{rows.length}</strong>
          </article>
          <article className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">
              {t("Aristas agregadas")}
            </span>
            <strong className="mt-1 block text-2xl">
              {rows.reduce(
                (sum, row) => sum + (Number(row.edge_count) || 0),
                0,
              )}
            </strong>
          </article>
          <article className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">
              {t("Nodos agregados")}
            </span>
            <strong className="mt-1 block text-2xl">
              {rows.reduce(
                (sum, row) => sum + (Number(row.node_count) || 0),
                0,
              )}
            </strong>
          </article>
        </div>
        <p className="mb-4 rounded-xl border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-800">
          {t(
            "La red se publica como métricas agregadas. Los nodos, aristas y cualquier resolución de identidad permanecen en Desktop.",
          )}
        </p>
        {rows.length ? (
          <DataTable rows={rows} columns={descriptor.columns} onOpen={onOpen} />
        ) : (
          <SurfaceEmpty label={descriptor.label} />
        )}
      </div>
    );
  }
  const nodes = new Map<string, number>();
  rows.forEach((row) => {
    const edges = Array.isArray(row.edges)
      ? (row.edges as JsonRecord[])
      : [row];
    edges.forEach((edge) => {
      [
        edge.from_person,
        edge.to_person,
        edge.from_id,
        edge.to_id,
        edge.prompt,
        edge.label,
        row.label,
      ]
        .filter(Boolean)
        .forEach((key) => {
          const id = String(key);
          if (!nodes.has(id)) nodes.set(id, nodes.size);
        });
    });
  });
  return (
    <div
      className="grid min-h-0 gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_20rem]"
      data-testid="vault-network"
    >
      <div className="relative min-h-[28rem] overflow-hidden rounded-2xl border border-neutral-200 bg-indigo-50/60 dark:border-neutral-800 dark:bg-indigo-950/15">
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_center,rgba(99,102,241,.35)_1px,transparent_1px)] [background-size:24px_24px]" />
        {[...nodes.entries()].map(([node, index]) => (
          <span
            key={node}
            className="absolute grid h-10 min-w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-indigo-300 bg-white px-2 text-[10px] font-medium shadow-sm dark:border-indigo-800 dark:bg-neutral-900"
            style={{
              left: `${12 + ((index * 47) % 76)}%`,
              top: `${16 + ((index * 67) % 68)}%`,
            }}
            title={node}
          >
            {node.length > 14 ? `${node.slice(0, 13)}…` : node}
          </span>
        ))}
      </div>
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {descriptor.label}
        </h2>
        {rows.length ? (
          rows.map((row, index) => (
            <button
              key={`${rowId(row, index)}`}
              onClick={() => onOpen(row, index)}
              className="flex w-full items-start gap-2 rounded-lg border border-neutral-200 p-2.5 text-left text-xs hover:border-indigo-300 dark:border-neutral-800 dark:hover:border-indigo-800"
            >
              <Icon
                name="link"
                size={13}
                className="mt-0.5 shrink-0 text-indigo-500"
              />
              <span className="min-w-0">
                <strong className="block truncate">
                  {value(row.label ?? row.type, t("Relación"))}
                </strong>
                <span className="mt-0.5 block truncate text-[10px] text-neutral-500">
                  {value(row.from_person ?? row.from_id, "—")} →{" "}
                  {value(row.to_person ?? row.to_id, "—")}
                </span>
              </span>
            </button>
          ))
        ) : (
          <SurfaceEmpty label={descriptor.label} />
        )}
      </div>
    </div>
  );
}

function AnalysisCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const statuses = rows.reduce<Record<string, number>>((counts, row) => {
    const key = String(row.status ?? row.type ?? "Publicado");
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return (
    <div className="min-h-0 overflow-auto p-5" data-testid="vault-analysis">
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">
            {t("Registros")}
          </span>
          <strong className="mt-1 block text-2xl">{rows.length}</strong>
        </article>
        {Object.entries(statuses)
          .slice(0, 3)
          .map(([key, count]) => (
            <article
              key={key}
              className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                {key}
              </span>
              <strong className="mt-1 block text-2xl">{count}</strong>
            </article>
          ))}
      </div>
      {rows.length ? (
        <DataTable rows={rows} columns={descriptor.columns} onOpen={onOpen} />
      ) : (
        <SurfaceEmpty label={descriptor.label} />
      )}
    </div>
  );
}

/** Read-only counterpart of Desktop ConflictsView: the board is the primary reading and
 * the ordinary list remains available for opening a thread dossier. `board` is a server
 * projection over the same published people, parties and beats; it is never persisted. */
function ConflictBoardCatalog({
  rows,
  descriptor,
  board,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  board?: unknown;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const [tab, setTab] = useState<"board" | "list">("board");
  const model =
    board && typeof board === "object" && !Array.isArray(board)
      ? (board as JsonRecord)
      : {};
  const castRows = Array.isArray(model.rows)
    ? (model.rows as JsonRecord[])
    : [];
  const columns = Array.isArray(model.columns)
    ? (model.columns as JsonRecord[])
    : [];
  return (
    <div className="min-h-0 overflow-auto p-4" data-testid="conflicts-board">
      <div
        className="mb-4 flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800"
        data-testid="conflicts-tabs"
      >
        <button
          data-testid="conflicts-tab-board"
          className={`rounded-t-lg px-3 py-1.5 text-xs ${tab === "board" ? "bg-neutral-100 font-medium dark:bg-neutral-900" : "text-neutral-500"}`}
          onClick={() => setTab("board")}
        >
          {t("Tablero")}
        </button>
        <button
          data-testid="conflicts-tab-list"
          className={`rounded-t-lg px-3 py-1.5 text-xs ${tab === "list" ? "bg-neutral-100 font-medium dark:bg-neutral-900" : "text-neutral-500"}`}
          onClick={() => setTab("list")}
        >
          {t("Lista")}
        </button>
        <span className="ml-auto text-[10px] text-neutral-500">
          {rows.length} {t("conflictos publicados · solo lectura")}
        </span>
      </div>
      {tab === "list" ? (
        <DataTable rows={rows} columns={descriptor.columns} onOpen={onOpen} />
      ) : castRows.length && columns.length ? (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="min-w-[720px] w-full text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white p-2 text-left text-[10px] uppercase tracking-wider text-neutral-500 dark:bg-neutral-950">
                  {t("Reparto")}
                </th>
                {columns.map((column) => (
                  <th
                    key={String(column.threadId ?? column.thread_id)}
                    className="p-2 text-left text-[10px] font-normal text-neutral-500"
                  >
                    <span className="block max-w-32 truncate">
                      {value(column.title, "Conflicto")}
                    </span>
                  </th>
                ))}
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                  {t("Quiere")}
                </th>
              </tr>
            </thead>
            <tbody>
              {castRows.map((entry, rowIndex) => {
                const person = jsonObject(entry.person);
                const cells = Array.isArray(entry.cells) ? entry.cells : [];
                return (
                  <tr
                    key={String(
                      person.personId ?? person.person_id ?? rowIndex,
                    )}
                    data-testid="conflicts-board-row"
                    data-stakes={String(entry.stakes ?? 0)}
                  >
                    <th className="sticky left-0 z-10 bg-white p-2 text-left font-normal dark:bg-neutral-950">
                      <span className="block max-w-40 truncate">
                        {value(
                          person.displayName ?? person.display_name,
                          "Persona",
                        )}
                      </span>
                      <span className="block text-[10px] text-neutral-500">
                        {value(person.sceneCount, "0")} {t("escenas")}
                      </span>
                    </th>
                    {columns.map((column, index) => (
                      <td
                        key={`${String(column.threadId ?? column.thread_id)}:${index}`}
                        className="border-t border-neutral-200 p-1 text-center dark:border-neutral-900"
                      >
                        {cells[index] ? (
                          <span className="rounded bg-indigo-100 px-1 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                            {value(cells[index])}
                          </span>
                        ) : (
                          <span className="text-neutral-300">·</span>
                        )}
                      </td>
                    ))}
                    <td className="max-w-48 border-t border-neutral-200 p-2 text-[11px] text-neutral-500 dark:border-neutral-900">
                      <span className="line-clamp-1">
                        {value(person.arcWant, "—")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <SurfaceEmpty label="Conflictos" />
      )}
    </div>
  );
}

function WorldRulesCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const [hardness, setHardness] = useState("all");
  const [status, setStatus] = useState("all");
  const [health, setHealth] = useState("all");
  const values = (key: string) =>
    [
      ...new Set(rows.map((row) => String(row[key] ?? "")).filter(Boolean)),
    ].sort();
  const filtered = rows.filter(
    (row) =>
      (hardness === "all" || String(row.hardness ?? "") === hardness) &&
      (status === "all" || String(row.status ?? "") === status) &&
      (health === "all" ||
        String(row.health ?? row.rule_health ?? "untested") === health),
  );
  const facets: Array<{
    label: string;
    selected: string;
    setter: (value: string) => void;
    options: string[];
  }> = [
    {
      label: "Dureza",
      selected: hardness,
      setter: setHardness,
      options: values("hardness"),
    },
    {
      label: "Estado",
      selected: status,
      setter: setStatus,
      options: values("status"),
    },
    {
      label: "Salud",
      selected: health,
      setter: setHealth,
      options: values("health"),
    },
  ];
  return (
    <div
      className="min-h-0 overflow-auto p-4"
      data-testid="world-rules-catalog"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 p-3 text-xs dark:border-neutral-800">
        <span className="font-semibold text-neutral-500">{t("Facetas")}</span>
        {facets.map(({ label, selected, setter, options }) => (
          <label
            key={label}
            className="flex items-center gap-1 text-neutral-500"
          >
            {t(label)}
            <select
              className="input h-8 text-xs"
              value={selected}
              onChange={(event) => setter(event.target.value)}
            >
              <option value="all">{t("Todos")}</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ))}
        <span className="ml-auto text-neutral-500">
          {filtered.length} / {rows.length} {t("reglas")}
        </span>
      </div>
      {filtered.length ? (
        <DataTable
          rows={filtered}
          columns={descriptor.columns}
          onOpen={onOpen}
        />
      ) : (
        <SurfaceEmpty label={descriptor.label} />
      )}
    </div>
  );
}

function WorldQuestionsCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const [settled, setSettled] = useState(false);
  const [origin, setOrigin] = useState("all");
  const [blocking, setBlocking] = useState("all");
  const filtered = rows
    .filter((row) =>
      settled
        ? String(row.status) !== "open"
        : String(row.status ?? "open") === "open",
    )
    .filter((row) => origin === "all" || String(row.origin) === origin)
    .filter(
      (row) =>
        blocking === "all" ||
        (blocking === "yes"
          ? row.blocking === true || row.blocking === 1 || row.blocking === "1"
          : row.blocking !== true &&
            row.blocking !== 1 &&
            row.blocking !== "1"),
    );
  return (
    <div
      className="min-h-0 overflow-auto p-4"
      data-testid="world-questions-catalog"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          data-testid="questions-settled-toggle"
          className="btn btn-ghost h-8 border border-neutral-300 px-2 text-xs dark:border-neutral-700"
          onClick={() => setSettled((value) => !value)}
        >
          {settled ? t("Volver a lo que falta") : t("Decisiones tomadas")}
        </button>
        <select
          aria-label={t("Origen")}
          className="input h-8 text-xs"
          value={origin}
          onChange={(event) => setOrigin(event.target.value)}
        >
          <option value="all">{t("Todos los orígenes")}</option>
          <option value="author">{t("Preguntadas por ti")}</option>
          <option value="placeholder">{t("Huecos de prosa")}</option>
        </select>
        <select
          aria-label={t("Bloqueo")}
          className="input h-8 text-xs"
          value={blocking}
          onChange={(event) => setBlocking(event.target.value)}
        >
          <option value="all">{t("Cualquier urgencia")}</option>
          <option value="yes">{t("Me bloquea")}</option>
          <option value="no">{t("Puede esperar")}</option>
        </select>
        <span className="ml-auto text-xs text-neutral-500">
          {filtered.length} / {rows.length} {t("preguntas")}
        </span>
      </div>
      {filtered.length ? (
        <DataTable
          rows={filtered}
          columns={descriptor.columns}
          onOpen={onOpen}
        />
      ) : (
        <SurfaceEmpty label={settled ? "decisiones" : descriptor.label} />
      )}
    </div>
  );
}

function ContinuityCatalog({
  rows,
  descriptor,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
}) {
  return (
    <div className="min-h-0 overflow-auto p-4" data-testid="continuity-catalog">
      <div className="mb-4 rounded-xl border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-800">
        {t(
          "Avisos derivados del snapshot publicado. No se recalculan ni se silencian desde el servidor.",
        )}
      </div>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <article
              key={String(row.fingerprint ?? index)}
              className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
              data-testid="continuity-row"
            >
              <div className="flex items-start gap-2">
                <Icon
                  name={
                    String(row.severity) === "contradiction" ? "alert" : "info"
                  }
                  size={14}
                  className="mt-0.5 text-amber-500"
                />
                <div className="min-w-0">
                  <strong className="block text-sm">
                    {localizeContinuityText(row.headlineKey, row.headlineParams as { count?: number; subjects?: string[] } | undefined, getActiveLang()) ?? value(row.headline, "Aviso")}
                  </strong>
                  <span className="mt-1 block text-[10px] uppercase tracking-wider text-neutral-500">
                    {value(row.severity)} · {value(row.family)}
                  </span>
                  {row.detail != null && (
                    <p className="mt-1 text-xs text-neutral-500">
                      {localizeContinuityText(row.detailKey, row.detailParams as { count?: number; subjects?: string[] } | undefined, getActiveLang()) ?? value(row.detail)}
                    </p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <SurfaceEmpty label={descriptor.label} />
      )}
    </div>
  );
}

/**
 * Read-only testimony catalogue. The Desktop interview list is organised by saved
 * questions and facets, not just by a bare table. Recreate that navigation locally
 * over the published page; the filter values are metadata and never participant
 * identities. Audio remains an explicit unavailable state in the dossier.
 */
function TestimonyInterviewCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const [savedView, setSavedView] = useState("all");
  const [collection, setCollection] = useState("");
  const [language, setLanguage] = useState("");
  const viewRows = useMemo(
    () =>
      rows
        .filter((row) => {
          const workflow = String(
            row.workflow_status ?? row.status ?? "",
          ).toLowerCase();
          if (savedView === "transcribe") return workflow.includes("transcri");
          if (savedView === "review")
            return workflow.includes("review") || workflow.includes("pending");
          if (savedView === "published")
            return (
              workflow.includes("publish") ||
              workflow === "complete" ||
              workflow === "completed"
            );
          return true;
        })
        .filter(
          (row) =>
            !collection ||
            String(row.collection_label ?? row.collection ?? "") === collection,
        )
        .filter((row) => !language || String(row.language ?? "") === language),
    [collection, language, rows, savedView],
  );
  const collections = useMemo(
    () =>
      [
        ...new Set(
          rows
            .map((row) => String(row.collection_label ?? row.collection ?? ""))
            .filter(Boolean),
        ),
      ].sort(),
    [rows],
  );
  const languages = useMemo(
    () =>
      [
        ...new Set(
          rows.map((row) => String(row.language ?? "")).filter(Boolean),
        ),
      ].sort(),
    [rows],
  );
  return (
    <div
      className="min-h-0 overflow-auto p-4"
      data-testid="testimony-interview-catalog"
    >
      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        data-testid="testimony-saved-views"
      >
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          {t("Vistas guardadas")}
        </span>
        {[
          ["all", "Todas"],
          ["transcribe", "Por transcribir"],
          ["review", "En revisión"],
          ["published", "Publicadas"],
        ].map(([id, label]) => (
          <button
            key={id}
            data-testid={`testimony-saved-view-${id}`}
            className={`rounded-lg px-2.5 py-1.5 text-xs ${savedView === id ? "bg-cyan-600 text-white" : "border border-neutral-200 text-neutral-500 dark:border-neutral-800"}`}
            onClick={() => setSavedView(id)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div
        className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 p-3 text-xs dark:border-neutral-800"
        data-testid="testimony-facets"
      >
        <span className="font-semibold text-neutral-500">{t("Facetas")}</span>
        <select
          aria-label={t("Colección")}
          className="input h-8 text-xs"
          value={collection}
          onChange={(event) => setCollection(event.target.value)}
        >
          <option value="">{t("Todas las colecciones")}</option>
          {collections.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          aria-label={t("Idioma")}
          className="input h-8 text-xs"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          <option value="">{t("Todos los idiomas")}</option>
          {languages.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <span className="ml-auto text-neutral-500">
          {viewRows.length} / {rows.length} {t("entrevistas")}
        </span>
      </div>
      {viewRows.length ? (
        <DataTable
          rows={viewRows}
          columns={descriptor.columns}
          onOpen={onOpen}
        />
      ) : (
        <SurfaceEmpty label={descriptor.label} />
      )}
    </div>
  );
}

function TestimonyCodeCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const colors = [
    ...new Set(rows.map((row) => String(row.color ?? "")).filter(Boolean)),
  ].sort();
  const [color, setColor] = useState("");
  const filtered = color
    ? rows.filter((row) => String(row.color ?? "") === color)
    : rows;
  return (
    <div
      className="min-h-0 overflow-auto p-4"
      data-testid="testimony-code-catalog"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-neutral-500">
          {t("Faceta de color")}
        </span>
        <select
          aria-label={t("Color del código")}
          className="input h-8 text-xs"
          value={color}
          onChange={(event) => setColor(event.target.value)}
        >
          <option value="">{t("Todos")}</option>
          {colors.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-neutral-500">
          {filtered.length} {t("códigos publicados")}
        </span>
      </div>
      {filtered.length ? (
        <DataTable
          rows={filtered}
          columns={descriptor.columns}
          onOpen={onOpen}
        />
      ) : (
        <SurfaceEmpty label={descriptor.label} />
      )}
    </div>
  );
}

function TestimonyContrastCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const [mode, setMode] = useState<"parallel" | "theme" | "matrix">("parallel");
  return (
    <div
      className="min-h-0 overflow-auto p-4"
      data-testid="testimony-contrast-catalog"
    >
      <div
        className="mb-4 flex items-center gap-1"
        data-testid="testimony-contrast-modes"
      >
        <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          {t("Vista")}
        </span>
        {[
          ["parallel", "Paralelo"],
          ["theme", "Por tema"],
          ["matrix", "Matriz"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`rounded-lg px-2.5 py-1.5 text-xs ${mode === id ? "bg-cyan-600 text-white" : "border border-neutral-200 text-neutral-500 dark:border-neutral-800"}`}
            onClick={() => setMode(id as typeof mode)}
          >
            {t(label)}
          </button>
        ))}
        <span className="ml-auto text-xs text-neutral-500">
          {rows.length} {t("contrastes guardados")}
        </span>
      </div>
      {mode === "matrix" && (
        <p className="mb-3 rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-800">
          {t(
            "La matriz publicada conserva fragmentos y posiciones; las identidades de participantes permanecen ocultas.",
          )}
        </p>
      )}
      {rows.length ? (
        <DataTable rows={rows} columns={descriptor.columns} onOpen={onOpen} />
      ) : (
        <SurfaceEmpty label={descriptor.label} />
      )}
    </div>
  );
}

/** The manuscript is a spine, not a generic scene gallery. The published list carries
 * chapter/book markers and word counts; prose remains behind the scene dossier endpoint. */
function ManuscriptCatalogRich({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const ordered = [...rows].sort(
    (a, b) =>
      (Number(a.narrative_order) || 0) - (Number(b.narrative_order) || 0),
  );
  const words = ordered.reduce(
    (sum, row) =>
      sum + (Number(row.manuscript_word_count ?? row.word_count) || 0),
    0,
  );
  const written = ordered.filter(
    (row) => String(row.status) === "written",
  ).length;
  const books = new Map<
    string,
    Map<string, Array<{ row: JsonRecord; index: number }>>
  >();
  ordered.forEach((row, index) => {
    const book = jsonObject(row.book);
    const chapter = jsonObject(row.chapter);
    const bookKey = String(book.title ?? "Manuscrito");
    const chapterKey = String(chapter.title ?? "Sin capítulo");
    const chapters =
      books.get(bookKey) ??
      new Map<string, Array<{ row: JsonRecord; index: number }>>();
    chapters.set(chapterKey, [
      ...(chapters.get(chapterKey) ?? []),
      { row, index },
    ]);
    books.set(bookKey, chapters);
  });
  return (
    <div
      className="grid min-h-0 gap-4 p-5 lg:grid-cols-[18rem_minmax(0,1fr)]"
      data-testid="vault-manuscript"
    >
      <aside
        className="min-h-0 overflow-auto rounded-xl border border-neutral-200 p-2 dark:border-neutral-800"
        data-testid="manuscript-spine"
      >
        <div className="border-b border-neutral-200 px-2 pb-2 dark:border-neutral-800">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Manuscrito")}
          </h2>
          <p className="mt-1 text-[10px] text-neutral-500">
            {words.toLocaleString()} {t("palabras")} · {ordered.length}{" "}
            {t("escenas")}
          </p>
        </div>
        {ordered.length ? (
          [...books.entries()].map(([bookTitle, chapters]) => (
            <section key={bookTitle} className="mt-3">
              <h3 className="border-b border-neutral-200 px-2 pb-1 text-[11px] font-semibold text-indigo-600 dark:border-neutral-800 dark:text-indigo-300">
                {bookTitle}
              </h3>
              {[...chapters.entries()].map(([chapterTitle, scenes]) => (
                <section key={`${bookTitle}:${chapterTitle}`} className="mt-2">
                  <h4 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    {chapterTitle}
                    <span className="ml-1 font-normal">
                      {scenes
                        .reduce(
                          (sum, entry) =>
                            sum +
                            (Number(
                              entry.row.manuscript_word_count ??
                                entry.row.word_count,
                            ) || 0),
                          0,
                        )
                        .toLocaleString()}
                    </span>
                  </h4>
                  <ul className="space-y-0.5">
                    {scenes.map(({ row, index }) => (
                      <li key={`${rowId(row, index)}`}>
                        <button
                          onClick={() => onOpen(row, index)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900"
                        >
                          <span className="w-5 shrink-0 text-center text-[10px] text-neutral-400">
                            {value(row.narrative_order, "—")}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {title(row)}
                          </span>
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${String(row.status) === "written" ? "bg-emerald-500" : String(row.status) === "draft" ? "bg-amber-500" : "bg-neutral-400"}`}
                            title={value(row.status, "Esbozo")}
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </section>
          ))
        ) : (
          <SurfaceEmpty label={descriptor.label} />
        )}
      </aside>
      <article className="min-h-0 overflow-auto rounded-xl border border-neutral-200 p-6 dark:border-neutral-800">
        <div className="mx-auto max-w-3xl">
          <header className="border-b border-neutral-200 pb-5 dark:border-neutral-800">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-500">
              {t("Escritura")}
            </p>
            <h2 className="mt-2 text-2xl font-semibold">{t("Manuscrito")}</h2>
            <p className="mt-2 text-sm text-neutral-500">
              {words.toLocaleString()} {t("palabras")} · {written} {t("de")}{" "}
              {ordered.length} {t("escenas escritas")}
            </p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-900">
              <span
                className="block h-full rounded-full bg-emerald-500"
                style={{
                  width: `${ordered.length ? (written / ordered.length) * 100 : 0}%`,
                }}
              />
            </div>
          </header>
          <div className="mt-6 space-y-3">
            <p className="text-sm leading-6 text-neutral-500">
              {t(
                "Selecciona una escena en la espina para abrir su texto, latidos, reparto y continuidad publicados.",
              )}
            </p>
            {ordered.slice(0, 3).map((row, index) => (
              <button
                key={`${rowId(row, index)}`}
                onClick={() => onOpen(row, index)}
                className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 p-4 text-left hover:border-indigo-300 dark:border-neutral-800 dark:hover:border-indigo-800"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-600/10 text-xs text-indigo-500">
                  {value(row.narrative_order, "—")}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">
                    {title(row)}
                  </strong>
                  <span className="mt-1 block text-xs text-neutral-500">
                    {value(row.summary, "Sin resumen")} ·{" "}
                    {Number(row.manuscript_word_count ?? row.word_count) || 0}{" "}
                    {t("palabras")}
                  </span>
                </span>
                <Icon
                  name="chevronRight"
                  size={14}
                  className="text-neutral-400"
                />
              </button>
            ))}
          </div>
        </div>
      </article>
    </div>
  );
}

function PublishedMapMarkerLayer({
  leaflet,
  frame,
  markers,
  layers,
  onOpenRecord,
}: {
  leaflet: L.Map;
  frame: MapFrame;
  markers: JsonRecord[];
  layers: JsonRecord[];
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  useEffect(() => {
    const group = L.layerGroup().addTo(leaflet);
    for (const marker of markers) {
      const x = Number(marker.x);
      const y = Number(marker.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const label = value(
        marker.label ?? marker.place_name ?? marker.child_map_name,
        "Marcador",
      );
      const layer = layers.find(
        (candidate) =>
          String(candidate.layer_id ?? "") === String(marker.layer_id ?? ""),
      );
      const color = value(marker.color ?? layer?.color, "#6366f1").replace(
        /[<>'"]+/g,
        "",
      );
      const point = frame.toCanvas({ x, y }) as unknown as L.LatLngExpression;
      const geometryKind = value(marker.geometry_kind, "point");
      const rawPoints = marker.points;
      let points: Array<{ x: number; y: number }> = [];
      if (Array.isArray(rawPoints))
        points = rawPoints.flatMap((entry) =>
          Array.isArray(entry) && entry.length >= 2
            ? [{ x: Number(entry[0]), y: Number(entry[1]) }]
            : [],
        );
      else if (typeof rawPoints === "string") {
        try {
          const parsed = JSON.parse(rawPoints) as unknown;
          if (Array.isArray(parsed))
            points = parsed.flatMap((entry) =>
              Array.isArray(entry) && entry.length >= 2
                ? [{ x: Number(entry[0]), y: Number(entry[1]) }]
                : [],
            );
        } catch {
          points = [];
        }
      }
      const style = { color, weight: 2, fillColor: color, fillOpacity: 0.14 };
      let shape: L.Layer | null = null;
      if (geometryKind === "circle" && Number.isFinite(Number(marker.radius)))
        shape = L.circle(point, {
          ...style,
          radius: Number(marker.radius) * frame.width,
        });
      else if (geometryKind === "polygon" && points.length >= 3)
        shape = L.polygon(
          points.map((entry) => frame.toCanvas(entry)) as L.LatLngExpression[],
          style,
        );
      else if (geometryKind === "path" && points.length >= 2)
        shape = L.polyline(
          points.map((entry) => frame.toCanvas(entry)) as L.LatLngExpression[],
          { color, weight: 3 },
        );
      if (shape) {
        shape.on("click", (event) => {
          L.DomEvent.stop(event);
          const placeId = String(marker.place_id ?? "");
          if (placeId) onOpenRecord?.("places", placeId);
        });
        shape.bindTooltip(label, { direction: "top" }).addTo(group);
      }
      const pin = L.marker(
        frame.toCanvas({ x, y }) as unknown as L.LatLngExpression,
        {
          icon: L.divIcon({
            className: "world-map-pin",
            html: `<span class="world-map-pin-dot" style="--pin:${color}"></span>${label ? `<span class="world-map-pin-label">${label.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character)}</span>` : ""}`,
            iconSize: [0, 0],
          }),
          keyboard: true,
          title: label,
        },
      );
      const placeId = String(marker.place_id ?? "");
      if (placeId) pin.on("click", () => onOpenRecord?.("places", placeId));
      const childMapId = String(marker.child_map_id ?? "");
      if (childMapId)
        pin.on("dblclick", (event) => {
          L.DomEvent.stop(event);
          onOpenRecord?.("world-maps", childMapId);
        });
      pin.bindTooltip(label, { direction: "top", offset: [0, -8] });
      pin.addTo(group);
    }
    return () => {
      group.remove();
    };
  }, [frame, layers, leaflet, markers, onOpenRecord]);
  return null;
}

/**
 * Read-only Server wrapper around the exact Desktop map stage. The publication API
 * already exposes the native normalized marker coordinates and original canvas size,
 * so reusing WorldMapCanvas preserves its CRS.Simple projection, y-axis conversion,
 * pan/zoom bounds and image fit instead of approximating them with CSS percentages.
 */
function WorldMapDetailLeaflet({
  detail,
  spaceId,
  onOpenRecord,
}: {
  detail: JsonRecord;
  spaceId: string;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [day, setDay] = useState<number | null>(null);
  const map = (
    detail.map && typeof detail.map === "object" ? detail.map : detail
  ) as JsonRecord;
  const image =
    detail.image && typeof detail.image === "object"
      ? (detail.image as JsonRecord)
      : null;
  const hash = String(image?.hash ?? image?.thumbHash ?? "");
  const numberOrNull = (raw: unknown) => {
    if (raw == null || raw === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const positiveDimension = (raw: unknown, fallback: number) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const dto = {
    mapId: String(map.map_id ?? map.id ?? ""),
    name: value(map.name, "Mapa"),
    kind: String(map.kind ?? "other"),
    placeId: map.place_id == null ? null : String(map.place_id),
    placeName: map.place_name == null ? null : String(map.place_name),
    parentMapId: map.parent_map_id == null ? null : String(map.parent_map_id),
    parentX0: numberOrNull(map.parent_x0),
    parentY0: numberOrNull(map.parent_y0),
    parentX1: numberOrNull(map.parent_x1),
    parentY1: numberOrNull(map.parent_y1),
    imageId: map.image_id == null ? null : String(map.image_id),
    widthPx: positiveDimension(map.width_px ?? image?.width, 1600),
    heightPx: positiveDimension(map.height_px ?? image?.height, 900),
    scaleX0: numberOrNull(map.scale_x0),
    scaleY0: numberOrNull(map.scale_y0),
    scaleX1: numberOrNull(map.scale_x1),
    scaleY1: numberOrNull(map.scale_y1),
    scaleDistance: numberOrNull(map.scale_distance),
    scaleUnit: map.scale_unit == null ? null : String(map.scale_unit),
    projection: map.projection === "globe" ? "globe" : "flat",
    planetRadius: numberOrNull(map.planet_radius),
    planetRadiusUnit:
      map.planet_radius_unit == null ? null : String(map.planet_radius_unit),
    fromWorldDay: numberOrNull(map.from_world_day),
    toWorldDay: numberOrNull(map.to_world_day),
    visualSeed: map.visual_seed == null ? null : String(map.visual_seed),
    style: map.style == null ? null : String(map.style),
    modelLabels:
      map.model_labels === true ||
      map.model_labels === 1 ||
      map.model_labels === "1",
    notes: map.notes == null ? null : String(map.notes),
    sortOrder: Number(map.sort_order) || 0,
    createdAt: String(map.created_at ?? ""),
    updatedAt: String(map.updated_at ?? ""),
  } as WorldMap;
  const layers = Array.isArray(detail.layers)
    ? (detail.layers as JsonRecord[])
    : [];
  const markers = Array.isArray(detail.markers)
    ? (detail.markers as JsonRecord[])
    : [];
  const sceneDays = Array.isArray(detail.sceneDays)
    ? (detail.sceneDays as JsonRecord[])
    : [];
  const scenes = Array.isArray(detail.scenes)
    ? (detail.scenes as JsonRecord[])
    : [];
  const dayValues = sceneDays
    .map((row) => Number(row.world_day ?? row.day))
    .filter(Number.isFinite);
  const minDay = dayValues.length ? Math.min(...dayValues) : 0;
  const maxDay = dayValues.length ? Math.max(...dayValues) : 0;
  const datedScenes =
    day == null
      ? scenes
      : scenes.filter((scene) =>
          sceneDays.some(
            (entry) =>
              String(entry.scene_id) === String(scene.scene_id) &&
              Number(entry.world_day ?? entry.day) === day,
          ),
        );
  const visibleMarkers = markers.filter((marker) => {
    const layer = layers.find(
      (candidate) =>
        String(candidate.layer_id ?? "") === String(marker.layer_id ?? ""),
    );
    const defaultHidden =
      layer != null &&
      (layer.visible === false || layer.visible === 0 || layer.visible === "0");
    if (defaultHidden !== hiddenLayers.has(String(marker.layer_id ?? "")))
      return false;
    if (day == null) return true;
    const from = numberOrNull(marker.from_world_day);
    const to = numberOrNull(marker.to_world_day);
    return (from == null || from <= day) && (to == null || to >= day);
  });

  return (
    <div className="space-y-4" data-testid="world-map-detail">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">
          {value(map.kind, "Mapa")} · {markers.length} marcadores
        </span>
        <div className="ml-auto flex flex-wrap gap-1">
          {layers.map((layer) => {
            const id = String(layer.layer_id ?? "");
            const defaultHidden =
              layer.visible === false ||
              layer.visible === 0 ||
              layer.visible === "0";
            const hidden = defaultHidden !== hiddenLayers.has(id);
            return (
              <button
                key={id}
                aria-pressed={!hidden}
                className={`rounded-full border px-2 py-1 text-[10px] ${hidden ? "border-neutral-300 text-neutral-400" : "border-indigo-300 text-indigo-600 dark:border-indigo-800 dark:text-indigo-300"}`}
                onClick={() =>
                  setHiddenLayers((current) => {
                    const next = new Set(current);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
              >
                {value(layer.name, "Capa")}
              </button>
            );
          })}
        </div>
      </div>
      <div className="h-[min(68vh,46rem)] min-h-[28rem] overflow-hidden rounded-2xl border border-neutral-200 bg-slate-100 dark:border-neutral-800 dark:bg-slate-950">
        <WorldMapCanvas
          map={dto}
          imageUrl={hash ? api.assetUrl(spaceId, hash) : null}
          fitKey={dto.mapId}
        >
          {({ leaflet, frame }) => (
            <PublishedMapMarkerLayer
              leaflet={leaflet}
              frame={frame}
              markers={visibleMarkers}
              layers={layers}
              onOpenRecord={onOpenRecord}
            />
          )}
        </WorldMapCanvas>
      </div>
      {dayValues.length > 0 && (
        <label
          className="flex items-center gap-3 text-xs text-neutral-500"
          data-testid="world-map-time-control"
        >
          {t("Día")} {day ?? minDay}
          <input
            type="range"
            min={minDay}
            max={maxDay}
            value={day ?? minDay}
            onChange={(event) => setDay(Number(event.target.value))}
            className="flex-1"
          />
          <button
            className="btn btn-ghost h-7 px-2 text-[10px]"
            onClick={() => setDay(null)}
          >
            {t("Todo")}
          </button>
        </label>
      )}
      {datedScenes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {datedScenes.slice(0, 8).map((scene, index) => (
            <button
              key={String(scene.scene_id ?? index)}
              className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600 hover:bg-indigo-100 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-indigo-950"
              onClick={() =>
                onOpenRecord?.("world-scenes", String(scene.scene_id))
              }
            >
              {title(scene)}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-xs text-neutral-500">
        <span>{value(map.notes, "Sin notas")}</span>
        <span className="ml-auto">
          {Array.isArray(detail.ancestry)
            ? `${(detail.ancestry as JsonRecord[]).length} niveles`
            : ""}
        </span>
      </div>
    </div>
  );
}

function EncyclopediaDetail({
  detail,
  onOpenRecord,
}: {
  detail: JsonRecord;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  const entry = (
    detail.entry && typeof detail.entry === "object" ? detail.entry : {}
  ) as JsonRecord;
  const openNodusLink = (href: string) => {
    const match =
      /^nodus:\/\/world\/(article|character|place|group|scene|rule|conflict|map)\/(.+)$/.exec(
        href,
      );
    if (match)
      onOpenRecord?.(
        "world-entries",
        `${match[1]}:${decodeURIComponent(match[2])}`,
      );
  };
  return (
    <article className="space-y-5" data-testid="encyclopedia-reader">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            {value(entry.kind, "Entrada")}
          </span>
          {Boolean(entry.category) && (
            <span className="text-xs text-neutral-500">
              {value(entry.category)}
            </span>
          )}
        </div>
        <h2 className="mt-2 text-2xl font-semibold">{title(entry)}</h2>
        {Array.isArray(entry.aliases) && entry.aliases.length > 0 && (
          <p className="mt-1 text-xs text-neutral-500">
            {t("También")}: {value(entry.aliases)}
          </p>
        )}
      </header>
      <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <MarkdownReader
          value={value(
            detail.body,
            "No hay texto publicado para esta entrada.",
          )}
          onNodusLink={openNodusLink}
        />
      </div>
      {Array.isArray(detail.facts) && detail.facts.length > 0 && (
        <dl className="grid gap-2 sm:grid-cols-2">
          {(detail.facts as JsonRecord[]).map((fact, index) => (
            <div
              key={String(fact.label ?? index)}
              className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <dt className="text-[10px] uppercase tracking-wider text-neutral-500">
                {value(fact.label)}
              </dt>
              <dd className="mt-1 text-xs">{value(fact.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}

function SceneDetail({
  detail,
  spaceId,
  onOpenRecord,
}: {
  detail: JsonRecord;
  spaceId: string;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  const scene = (
    detail.scene && typeof detail.scene === "object" ? detail.scene : {}
  ) as JsonRecord;
  const sceneText =
    detail.text && typeof detail.text === "object"
      ? (detail.text as JsonRecord)
      : null;
  const beats = Array.isArray(detail.beats)
    ? (detail.beats as JsonRecord[])
    : [];
  const place = jsonObject(detail.place);
  const cast = Array.isArray(detail.cast) ? (detail.cast as JsonRecord[]) : [];
  const images = Array.isArray(detail.images)
    ? (detail.images as JsonRecord[])
    : [];
  const coverAsset = images[0]
    ? jsonObject((images[0] as JsonRecord).asset)
    : {};
  const hash = String(coverAsset.hash ?? coverAsset.thumbHash ?? "");
  return (
    <article className="space-y-5" data-testid="scene-dossier">
      {hash && (
        <img
          src={api.assetUrl(spaceId, hash)}
          alt=""
          className="max-h-72 w-full rounded-xl border border-neutral-200 object-cover dark:border-neutral-800"
        />
      )}
      <header>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
          {value(scene.status, "Escena")}
        </span>
        <h2 className="mt-2 text-2xl font-semibold">{title(scene)}</h2>
        <p className="mt-1 text-sm text-neutral-500">
          {[
            scene.world_year,
            place.name,
            scene.narrative_order != null
              ? `${t("Orden")} ${scene.narrative_order}`
              : null,
          ]
            .filter(Boolean)
            .map(String)
            .join(" · ")}
        </p>
        <p className="mt-2 text-sm text-neutral-500">
          {value(scene.summary, "Sin resumen")}
        </p>
      </header>
      {cast.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Reparto")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {cast.map((appearance, index) => {
              const person = jsonObject(appearance.person);
              return (
                <button
                  key={String(appearance.id ?? index)}
                  className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs hover:border-indigo-300 dark:border-neutral-800"
                  onClick={() =>
                    onOpenRecord?.("persons", String(appearance.person_id))
                  }
                >
                  {title(person)}
                  {appearance.role ? ` · ${value(appearance.role)}` : ""}
                </button>
              );
            })}
          </div>
        </section>
      )}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <MarkdownReader
          value={value(
            sceneText?.content_markdown ?? sceneText?.body ?? scene.summary,
            "No hay texto publicado para esta escena.",
          )}
        />
      </div>
      {beats.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Latidos, reglas e hilos")}
          </h3>
          <div className="space-y-2">
            {beats.map((beat, index) => (
              <div
                key={String(beat.beat_id ?? beat.id ?? index)}
                className="rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-800"
              >
                <strong>
                  {value(
                    beat.title ?? beat.label ?? beat.mark,
                    `Beat ${index + 1}`,
                  )}
                </strong>
                <p className="mt-1 text-neutral-500">
                  {value(beat.description ?? beat.notes ?? beat.text, "")}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

function GalleryCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  return (
    <div className="min-h-0 overflow-auto p-5" data-testid="vault-gallery">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.length ? (
          rows.map((row, index) => (
            <button
              key={`${rowId(row, index)}`}
              onClick={() => onOpen(row, index)}
              className="group overflow-hidden rounded-2xl border border-neutral-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg dark:border-neutral-800 dark:bg-neutral-900/45 dark:hover:border-indigo-800"
            >
              <div className="grid h-32 place-items-center bg-gradient-to-br from-indigo-100 via-violet-100 to-sky-100 text-indigo-500 dark:from-indigo-950/60 dark:via-violet-950/40 dark:to-sky-950/40">
                <Icon name="image" size={30} />
              </div>
              <div className="p-3">
                <strong className="block truncate text-sm">{title(row)}</strong>
                <span className="mt-1 block line-clamp-2 text-xs text-neutral-500">
                  {value(
                    row.summary ?? row.description,
                    descriptor.description,
                  )}
                </span>
                <span className="mt-3 block text-[10px] uppercase tracking-wider text-neutral-400">
                  {value(row.status, "Borrador")}
                </span>
              </div>
            </button>
          ))
        ) : (
          <SurfaceEmpty label={descriptor.label} />
        )}
      </div>
    </div>
  );
}

const WORLD_ENTRY_ICON: Record<string, string> = {
  article: "book",
  character: "users",
  place: "map",
  group: "network",
  scene: "image",
  map: "map",
  conflict: "scale",
  rule: "lock",
};

/** Desktop CharactersView is a visual cast browser, never a raw persons table. */
function CharacterCatalog({
  rows,
  spaceId,
  onOpen,
}: {
  rows: JsonRecord[];
  spaceId: string;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const roleLabels: Record<string, string> = {
    protagonist: "Protagonista",
    antagonist: "Antagonista",
    secondary: "Secundario",
    supporting: "Reparto",
    minor: "Menor",
  };
  const statusLabels: Record<string, string> = {
    alive: "Con vida",
    dead: "Fallecido",
    missing: "Desaparecido",
    unknown: "Estado desconocido",
  };
  return (
    <div className="min-h-0 overflow-auto p-4" data-testid="characters-grid">
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
        {rows.map((row, index) => {
          const portrait = jsonObject(row.portrait);
          const hash = String(portrait.hash ?? portrait.thumbHash ?? "");
          const role = String(row.narrative_role ?? row.role ?? "");
          const status = String(row.life_status ?? row.status ?? "unknown");
          const epithet =
            (row.epithet ?? row.species)
              ? value(row.epithet ?? row.species)
              : t(statusLabels[status] ?? "Estado desconocido");
          const faded = status === "dead" || status === "missing";
          const hasCharacterMetadata = Boolean(row.species || row.birth_date);
          return (
            <li key={rowId(row, index)}>
              <button
                data-testid="character-card"
                onClick={() => onOpen(row, index)}
                title={title(row)}
                className="group w-full overflow-hidden rounded-lg border border-neutral-200 bg-white text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50/30 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-indigo-700/60 dark:bg-indigo-950/20"
              >
                <div
                  className={`relative aspect-square overflow-hidden bg-neutral-100 dark:bg-neutral-900 ${faded ? "opacity-60" : ""}`}
                >
                  {hash ? (
                    <img
                      src={api.assetUrl(spaceId, hash)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="grid h-full place-items-center text-neutral-400 dark:text-neutral-700">
                      <Icon name="user" size={40} />
                    </span>
                  )}
                  {role && (
                    <span className="absolute right-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                      {roleLabels[role] ? t(roleLabels[role]) : role}
                    </span>
                  )}
                </div>
                <span className="block p-2">
                  <strong className="block truncate text-sm font-medium">
                    {title(row)}
                  </strong>
                  <span className="block truncate text-[11px] text-neutral-500">
                    {epithet}
                  </span>
                  {hasCharacterMetadata && (
                    <span className="mt-0.5 block truncate text-[10px] text-neutral-400">
                      {[row.species, row.birth_date]
                        .filter(Boolean)
                        .map(String)
                        .join(" · ")}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Desktop PlacesView preserves containment; flattening it loses the world's geography. */
function PlaceTreeCatalog({
  rows,
  onOpen,
}: {
  rows: JsonRecord[];
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const indexed = rows.map((row, index) => ({
    row,
    index,
    id: String(row.place_id ?? row.id ?? ""),
    parent: String(row.parent_id ?? ""),
  }));
  const ids = new Set(indexed.map((entry) => entry.id));
  const children = new Map<string, typeof indexed>();
  indexed.forEach((entry) => {
    const parent = entry.parent && ids.has(entry.parent) ? entry.parent : "";
    children.set(parent, [...(children.get(parent) ?? []), entry]);
  });
  const render = (
    parent: string,
    depth: number,
    seen: Set<string>,
  ): ReactNode =>
    (children.get(parent) ?? []).map((entry) => {
      if (!entry.id || seen.has(entry.id)) return null;
      const nested = render(entry.id, depth + 1, new Set(seen).add(entry.id));
      return (
        <li key={entry.id} className="relative">
          <button
            data-testid="world-place-row"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
            style={{ paddingLeft: `${0.5 + depth * 1.4}rem` }}
            onClick={() => onOpen(entry.row, entry.index)}
          >
            {depth > 0 && (
              <span className="h-px w-3 shrink-0 bg-neutral-300 dark:bg-neutral-700" />
            )}
            <Icon
              name="mapPin"
              size={13}
              className="shrink-0 text-indigo-500"
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              {title(entry.row)}
            </span>
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-neutral-500">
              {value(entry.row.kind, "Lugar")}
            </span>
            <Icon name="chevronRight" size={12} className="text-neutral-400" />
          </button>
          {nested && <ul>{nested}</ul>}
        </li>
      );
    });
  return (
    <div className="min-h-0 overflow-auto p-4" data-testid="places-tree">
      <ul className="mx-auto max-w-5xl space-y-0.5">
        {render("", 0, new Set())}
      </ul>
    </div>
  );
}

function WorldGroupCatalog({
  rows,
  onOpen,
}: {
  rows: JsonRecord[];
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  return (
    <div className="min-h-0 overflow-auto p-4" data-testid="world-groups-grid">
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
        {rows.map((row, index) => (
          <li key={rowId(row, index)}>
            <button
              className="group flex min-h-36 w-full flex-col rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:border-indigo-400 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-indigo-700"
              onClick={() => onOpen(row, index)}
            >
              <span className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
                <Icon
                  name={
                    String(row.kind).includes("dynasty")
                      ? "shield"
                      : String(row.kind).includes("culture")
                        ? "languages"
                        : "network"
                  }
                  size={17}
                />
              </span>
              <strong className="truncate text-sm">{title(row)}</strong>
              <span className="mt-1 line-clamp-2 text-[11px] text-neutral-500">
                {value(row.summary ?? row.description, "Sin descripción")}
              </span>
              <span className="mt-auto pt-3 text-[10px] uppercase tracking-wider text-neutral-400">
                {[row.kind, row.status].filter(Boolean).map(String).join(" · ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EncyclopediaCatalog({
  rows,
  onOpen,
}: {
  rows: JsonRecord[];
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const indexed = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => title(a.row).localeCompare(title(b.row)));
  const buckets = new Map<string, typeof indexed>();
  indexed.forEach((entry) => {
    const letter = title(entry.row)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .charAt(0)
      .toUpperCase();
    const key = /[A-Z]/.test(letter) ? letter : "#";
    buckets.set(key, [...(buckets.get(key) ?? []), entry]);
  });
  return (
    <div className="min-h-0 overflow-auto p-4" data-testid="encyclopedia-grid">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-3 flex flex-wrap gap-0.5">
          {[...buckets.keys()].sort().map((letter) => (
            <a
              key={letter}
              href={`#server-encyclopedia-${letter}`}
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-indigo-700 dark:hover:bg-neutral-800 dark:hover:text-indigo-300"
            >
              {letter}
            </a>
          ))}
        </nav>
        {[...buckets.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([letter, entries]) => (
            <section key={letter}>
              <h2
                id={`server-encyclopedia-${letter}`}
                className="sticky top-0 z-10 mb-1 bg-white/95 py-1 text-xs font-semibold uppercase tracking-wider text-neutral-500 backdrop-blur dark:bg-neutral-950/95"
              >
                {letter}
              </h2>
              <ul className="mb-3 space-y-1">
                {entries.map(({ row, index }) => (
                  <li key={rowIdForCollection("world-entries", row, index)}>
                    <button
                      data-testid="encyclopedia-entry"
                      data-entry-kind={value(row.kind)}
                      onClick={() => onOpen(row, index)}
                      className="flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left hover:border-indigo-300 hover:bg-indigo-50/40 dark:hover:border-indigo-700/60 dark:hover:bg-indigo-950/20"
                    >
                      <Icon
                        name={WORLD_ENTRY_ICON[String(row.kind)] ?? "book"}
                        size={14}
                        className="mt-0.5 shrink-0 text-neutral-500"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <strong className="truncate text-sm font-normal">
                            {title(row)}
                          </strong>
                          {Boolean(row.stub) && (
                            <span className="shrink-0 rounded bg-neutral-100 px-1 text-[9px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-800">
                              {t("Sin desarrollar")}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 line-clamp-1 block text-[11px] text-neutral-500">
                          {value(row.summary ?? row.aliases, "")}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </div>
  );
}

function NarrativeSceneCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: JsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const [status, setStatus] = useState("all");
  const statuses = [
    ...new Set(rows.map((row) => String(row.status ?? "")).filter(Boolean)),
  ];
  const visible = rows
    .filter((row) => status === "all" || String(row.status ?? "") === status)
    .sort((a, b) =>
      String(a.narrative_order ?? a.updated_at ?? "").localeCompare(
        String(b.narrative_order ?? b.updated_at ?? ""),
      ),
    );
  return (
    <div className="min-h-0 overflow-auto p-5" data-testid="vault-scenes">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Icon name="image" size={14} className="text-indigo-500" />
        <span className="text-xs text-neutral-500">
          {visible.length} {t("escenas narrativas")}
        </span>
        <select
          className="input ml-auto h-8 text-xs"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">{t("Todos los estados")}</option>
          {statuses.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        {visible.length ? (
          visible.map((row, index) => (
            <button
              key={`${rowId(row, index)}`}
              className="flex w-full items-start gap-4 rounded-xl border border-neutral-200 bg-white p-4 text-left hover:border-indigo-300 dark:border-neutral-800 dark:bg-neutral-900/35 dark:hover:border-indigo-800"
              onClick={() => onOpen(row, index)}
            >
              <span className="w-12 shrink-0 text-center text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                {value(row.narrative_order ?? row.scene_number, "—")}
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-sm">{title(row)}</strong>
                <span className="mt-1 block line-clamp-2 text-xs leading-5 text-neutral-500">
                  {value(row.summary, "Sin resumen")}
                </span>
                <span className="mt-2 inline-flex gap-2 text-[10px] uppercase tracking-wider text-neutral-400">
                  {value(row.status, "Sin estado")}{" "}
                  {row.place_id ? `· ${value(row.place_id)}` : ""}
                </span>
              </span>
              <Icon
                name="chevronRight"
                size={14}
                className="mt-1 text-neutral-400"
              />
            </button>
          ))
        ) : (
          <SurfaceEmpty label={descriptor.label} />
        )}
      </div>
    </div>
  );
}

function jsonObject(input: unknown): JsonRecord {
  if (input && typeof input === "object" && !Array.isArray(input))
    return input as JsonRecord;
  if (typeof input !== "string" || !input.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : {};
  } catch {
    return {};
  }
}

function jsonArray(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (typeof input !== "string" || !input.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The Desktop exam history is a card grid, not a technical database table. */
function ExamCatalog({
  rows,
  onOpen,
}: {
  rows: JsonRecord[];
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  return (
    <div className="min-h-0 overflow-auto p-5" data-testid="vault-exams">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.length ? (
          rows.map((row, index) => {
            const header = jsonObject(row.header_json ?? row.header);
            const examTitle = value(
              row.title ?? header.examTitle,
              t("Examen sin título"),
            );
            const subject = value(
              row.subject_name ?? header.subjectName,
              t("Sin asignatura"),
            );
            const questionCount =
              row.target_question_count ?? header.targetQuestionCount;
            return (
              <article
                key={`${rowId(row, index)}`}
                className="rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-indigo-300 dark:border-neutral-800 dark:bg-neutral-900/35 dark:hover:border-indigo-800"
                data-testid="exam-card"
              >
                <button
                  className="block w-full text-left"
                  onClick={() => onOpen(row, index)}
                >
                  <span className="block truncate text-sm font-semibold">
                    {examTitle}
                  </span>
                  <span className="mt-1 block truncate text-xs text-neutral-500">
                    {subject}
                  </span>
                  <span className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-neutral-500">
                    <span>{value(row.short_id ?? row.shortId, "")}</span>
                    {questionCount != null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {value(questionCount)} {t("preguntas")}
                        </span>
                      </>
                    )}
                  </span>
                </button>
              </article>
            );
          })
        ) : (
          <SurfaceEmpty label="Exámenes" />
        )}
      </div>
    </div>
  );
}

/** Desktop's rubric history is a concise table; counts are human-readable, never JSON. */
function RubricCatalog({
  rows,
  onOpen,
}: {
  rows: JsonRecord[];
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  return (
    <div className="min-h-0 overflow-auto p-5" data-testid="vault-rubrics">
      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <div className="grid min-w-[700px] grid-cols-[minmax(240px,1.5fr)_minmax(150px,1fr)_7rem_7rem_10rem] border-b border-neutral-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
          <span>{t("Rúbrica")}</span>
          <span>{t("Descripción")}</span>
          <span>{t("Criterios")}</span>
          <span>{t("Niveles")}</span>
          <span>{t("Actualizada")}</span>
        </div>
        {rows.length ? (
          rows.map((row, index) => {
            const definition = jsonObject(row.criteria_json ?? row.criteria);
            const criteria = Array.isArray(definition.criteria)
              ? definition.criteria
              : jsonArray(row.criteria_json ?? row.criteria);
            const levels = Array.isArray(definition.levels)
              ? definition.levels
              : jsonArray(row.levels_json ?? row.levels);
            return (
              <button
                key={`${rowId(row, index)}`}
                className="grid min-h-[64px] w-full grid-cols-[minmax(240px,1.5fr)_minmax(150px,1fr)_7rem_7rem_10rem] items-center border-b border-neutral-100 px-4 py-2 text-left text-xs transition-colors hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/55"
                onClick={() => onOpen(row, index)}
                data-testid="rubric-card"
              >
                <span className="min-w-0 pr-3">
                  <strong className="block truncate font-medium">
                    {title(row)}
                  </strong>
                  <span className="mt-1 block truncate text-[10px] text-neutral-500">
                    {value(row.subject_name, "Sin asignatura")}
                  </span>
                </span>
                <span className="line-clamp-2 pr-3 text-neutral-500">
                  {value(row.description, "Sin descripción")}
                </span>
                <span className="text-neutral-500">
                  {value(row.criteria_count ?? criteria.length, "—")}
                </span>
                <span className="text-neutral-500">
                  {value(row.levels_count ?? levels.length, "—")}
                </span>
                <span className="text-neutral-500">
                  {value(row.updated_at ?? row.updatedAt, "—")}
                </span>
              </button>
            );
          })
        ) : (
          <div className="p-8">
            <SurfaceEmpty label="Rúbricas" />
          </div>
        )}
      </div>
    </div>
  );
}

function ExamDetail({
  detail,
}: {
  detail: JsonRecord & { points?: string | number };
}) {
  const exam = jsonObject(detail.exam ?? detail) as JsonRecord & {
    target_question_count?: string | number;
    language?: string;
    title?: string;
    subject_name?: string;
    course_name?: string;
  };
  const header = jsonObject(exam.header_json ?? exam.header) as JsonRecord & {
    durationMinutes?: string | number;
    examTitle?: string;
    subjectName?: string;
  };
  const questions = Array.isArray(detail.questions)
    ? detail.questions.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const subject =
    jsonObject(detail.subject).name ?? exam.subject_name ?? header.subjectName;
  const course = value(jsonObject(detail.course).name ?? exam.course_name, "");
  return (
    <article className="space-y-5" data-testid="exam-detail">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">
          {t("Evaluación")}
        </p>
        <h2 className="mt-1 text-xl font-semibold">
          {value(exam.title ?? header.examTitle, t("Examen sin título"))}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {value(subject, t("Sin asignatura"))}
          {course ? ` · ${course}` : ""} · {value(exam.language, "es")}
        </p>
      </header>
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Preguntas", questions.length || exam.target_question_count],
          ["Puntuación", detail.points],
          [
            "Duración",
            header.durationMinutes ? `${header.durationMinutes} min` : null,
          ],
        ].map(([label, item]) => (
          <div
            key={t(String(label))}
            className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <span className="block text-[10px] uppercase tracking-wider text-neutral-500">
              {t(String(label))}
            </span>
            <strong className="mt-1 block text-lg">{value(item, "—")}</strong>
          </div>
        ))}
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {t("Preguntas publicadas")}
        </h3>
        {questions.length ? (
          questions.map((question, index) => (
            <div
              key={String(question.id ?? index)}
              className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/35"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-indigo-600/15 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-6">
                    {value(question.prompt, t("Sin enunciado"))}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-wider text-neutral-500">
                    <span>{value(question.type, t("Pregunta"))}</span>
                    <span>·</span>
                    <span>
                      {value(question.points, "0")} {t("puntos")}
                    </span>
                  </div>
                  {jsonArray(question.options_json ?? question.options).length >
                    0 && (
                    <ul className="mt-3 space-y-1 text-xs text-neutral-500">
                      {jsonArray(question.options_json ?? question.options).map(
                        (option, optionIndex) => (
                          <li key={optionIndex}>
                            {typeof option === "object" && option
                              ? value(
                                  (option as JsonRecord).text,
                                  t(`Opción ${optionIndex + 1}`),
                                )
                              : value(option, t(`Opción ${optionIndex + 1}`))}
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-800">
            {t("No hay preguntas publicadas.")}
          </p>
        )}
      </section>
    </article>
  );
}

function RubricDetail({ detail }: { detail: JsonRecord }) {
  const rubric = jsonObject(detail.rubric ?? detail);
  const definition = jsonObject(rubric.criteria_json ?? rubric.criteria);
  const criteria = (
    Array.isArray(rubric.criteria)
      ? rubric.criteria
      : Array.isArray(definition.criteria)
        ? definition.criteria
        : jsonArray(rubric.criteria_json)
  ).filter((entry): entry is JsonRecord =>
    Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
  );
  const levels = (
    Array.isArray(rubric.levels)
      ? rubric.levels
      : Array.isArray(definition.levels)
        ? definition.levels
        : jsonArray(rubric.levels_json)
  ).filter((entry): entry is JsonRecord =>
    Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
  );
  return (
    <article className="space-y-5" data-testid="rubric-detail">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">
          {t("Evaluación")}
        </p>
        <h2 className="mt-1 text-xl font-semibold">{title(rubric)}</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {value(rubric.description, t("Rúbrica de evaluación"))} ·{" "}
          {value(rubric.language, "es")}
        </p>
      </header>
      <div className="flex flex-wrap gap-2 text-xs text-neutral-500">
        <span className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
          {criteria.length} {t("criterios")}
        </span>
        <span className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
          {levels.length} {t("niveles")}
        </span>
        <span className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
          {t("Máximo")} {value(rubric.scale_max ?? rubric.scaleMax, "—")}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <table className="min-w-[620px] w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[10px] uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
              <th className="px-3 py-3">{t("Criterio")}</th>
              {levels.map((level, index) => (
                <th key={String(level.id ?? index)} className="px-3 py-3">
                  {value(level.label, t(`Nivel ${index + 1}`))}
                  <span className="ml-1 normal-case">
                    ({value(level.score, "—")})
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {criteria.map((criterion, index) => (
              <tr
                key={String(criterion.id ?? index)}
                className="border-b border-neutral-100 dark:border-neutral-900"
              >
                <th className="px-3 py-3 text-left font-medium">
                  {value(criterion.name, t(`Criterio ${index + 1}`))}
                  <span className="mt-1 block font-normal text-neutral-500">
                    {value(criterion.description, "")}
                  </span>
                </th>
                {levels.map((level, levelIndex) => (
                  <td
                    key={String(level.id ?? levelIndex)}
                    className="px-3 py-3 text-neutral-500"
                  >
                    {value(
                      jsonObject(criterion.cells)[String(level.id ?? "")],
                      "—",
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

/** A published study document/material keeps the Desktop library's readable
 * hierarchy without pretending that a Server copy can edit or import files. */
function StudyMaterialDetail({ detail }: { detail: JsonRecord }) {
  const document = jsonObject(detail.document ?? detail.material ?? detail);
  const text = value(
    document.content_markdown ??
      document.contentMarkdown ??
      document.description,
    "",
  );
  const tags = jsonArray(detail.tags)
    .filter((entry) => typeof entry === "string")
    .map(String);
  const placements = Array.isArray(detail.placements)
    ? detail.placements.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const isDocument = detail.document != null;
  return (
    <article className="space-y-5" data-testid="study-material-detail">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">
          {t(isDocument ? "Apunte publicado" : "Material de estudio")}
        </p>
        <h2 className="mt-1 text-xl font-semibold">{title(document)}</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {value(document.short_id ?? document.shortId, "")}
          {document.kind ? ` · ${value(document.kind)}` : ""}
        </p>
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/35">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Contenido publicado")}
          </h3>
          {text ? (
            <MarkdownReader value={text} />
          ) : (
            <p className="text-sm text-neutral-500">
              {t(
                "Este material sólo tiene metadatos publicados; el archivo original permanece en Desktop.",
              )}
            </p>
          )}
        </section>
        <aside className="space-y-4">
          <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("Estado")}
            </h3>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-neutral-500">{t("Lectura")}</dt>
                <dd>
                  {value(
                    document.read_state ?? document.readState,
                    t("Pendiente"),
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-neutral-500">{t("Tipo")}</dt>
                <dd>
                  {value(
                    document.extension ??
                      document.preview_kind ??
                      document.kind,
                    t("Documento"),
                  )}
                </dd>
              </div>
            </dl>
          </section>
          {tags.length > 0 && (
            <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Etiquetas")}
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] dark:bg-neutral-800"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          )}
          {placements.length > 0 && (
            <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Ubicaciones")}
              </h3>
              <div className="mt-2 space-y-1 text-xs text-neutral-500">
                {placements.map((placement, index) => (
                  <p key={String(placement.id ?? index)}>
                    {value(
                      placement.course_id ??
                        placement.subject_id ??
                        placement.topic_id,
                      t("Ubicación publicada"),
                    )}
                  </p>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </article>
  );
}

const STUDY_QUESTION_TYPE_LABEL: Record<string, string> = {
  short: "Respuesta breve",
  essay: "Desarrollo",
  definition: "Definición",
  relation: "Relación",
  comparison: "Comparación",
  commentary: "Comentario",
  case: "Caso práctico",
  true_false: "Verdadero / falso",
  single_choice: "Elección simple",
  multiple_choice: "Respuesta múltiple",
  fill_blank: "Completar",
  ordering: "Ordenar",
  matching: "Relacionar columnas",
};
const STUDY_QUESTION_STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  problematic: "Problemática",
  discarded: "Descartada",
};
const STUDY_QUESTION_DIFFICULTY_LABEL: Record<string, string> = {
  easy: "Fácil",
  medium: "Media",
  hard: "Difícil",
  mixed: "Mixta",
};
type LooseJsonRecord = JsonRecord & Record<string, any>;

/**
 * Read-only review workspace. Desktop's review wizard can mutate cards and its SRS
 * tables are private by publication policy. The Web therefore keeps the complete
 * chooser/reveal/rating interaction, but stores the temporary ratings locally and labels
 * them as browser-only instead of presenting fabricated mastery or due dates.
 */
function StudyReviewCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: LooseJsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  const [kind, setKind] = useState<"all" | "flashcard" | "question">("all");
  const [count, setCount] = useState(10);
  const [session, setSession] = useState<number[] | null>(null);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      setRatings(
        JSON.parse(
          localStorage.getItem("nodus.server.studyReview.ratings") ?? "{}",
        ) as Record<string, number>,
      );
    } catch {
      setRatings({});
    }
  }, []);
  const filtered = useMemo(
    () =>
      rows.filter((row) => kind === "all" || String(row.item_kind) === kind),
    [kind, rows],
  );
  const start = () => {
    const selected = filtered
      .slice(0, Math.max(1, Math.min(40, count)))
      .map((row) => rows.indexOf(row))
      .filter((index) => index >= 0);
    if (selected.length) {
      setSession(selected);
      setPosition(0);
      setRevealed(false);
    }
  };
  const finishRating = (rating: number) => {
    if (!session) return;
    const row = rows[session[position]];
    const key = String(row.review_key ?? row.id ?? session[position]);
    const next = { ...ratings, [key]: rating };
    setRatings(next);
    localStorage.setItem(
      "nodus.server.studyReview.ratings",
      JSON.stringify(next),
    );
    if (position + 1 >= session.length) setSession(null);
    else {
      setPosition((value) => value + 1);
      setRevealed(false);
    }
  };
  const current = session ? rows[session[position]] : null;
  const currentAnswer = current
    ? (jsonObject(current.answer).text ?? current.back ?? current.answer_text)
    : null;
  const sessionLength = session?.length || 1;
  if (!session)
    return (
      <div
        className="min-h-0 overflow-auto p-5"
        data-testid="study-review-catalog"
      >
        <SurfaceEmpty label={descriptor.label} />
      </div>
    );
  if (current)
    return (
      <div
        className="min-h-0 overflow-auto p-5"
        data-testid="study-review-session"
      >
        <div className="mx-auto max-w-2xl">
          <div className="mb-3 flex items-center gap-2 text-xs text-neutral-500">
            <span>
              {position + 1} / {sessionLength}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div
                className="h-full bg-teal-500"
                style={{ width: `${((position + 1) / sessionLength) * 100}%` }}
              />
            </div>
            <button
              className="btn btn-ghost h-8 px-2 text-xs"
              onClick={() => setSession(null)}
            >
              {t("Salir")}
            </button>
          </div>
          <button
            className="min-h-80 w-full rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900/45"
            onClick={() => setRevealed(true)}
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">
              {t(current.item_kind === "flashcard" ? "Anverso" : "Pregunta")}
            </span>
            <p className="mt-4 text-xl leading-8">
              {value(current.front ?? current.prompt, t("Sin enunciado"))}
            </p>
            {!revealed ? (
              <p className="mt-10 text-xs text-neutral-500">
                {t("Pulsa para mostrar la respuesta")}
              </p>
            ) : (
              <>
                <div className="mx-auto my-7 h-px max-w-sm bg-neutral-200 dark:bg-neutral-800" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
                  {t("Respuesta")}
                </span>
                <p className="mt-4 whitespace-pre-wrap text-lg leading-7 text-emerald-700 dark:text-emerald-300">
                  {value(currentAnswer, t("No hay respuesta publicada."))}
                </p>
              </>
            )}
          </button>
          {revealed && (
            <div className="mt-4 grid grid-cols-4 gap-2">
              {[
                ["Otra vez", 1],
                ["Difícil", 3],
                ["Bien", 4],
                ["Fácil", 5],
              ].map(([label, rating]) => (
                <button
                  key={String(rating)}
                  data-testid={`study-review-rate-${rating}`}
                  className="rounded-xl border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                  onClick={() => finishRating(Number(rating))}
                >
                  {t(String(label))}
                </button>
              ))}
            </div>
          )}
          <p className="mt-4 text-center text-[10px] text-neutral-500">
            {t(
              "Las valoraciones de esta sesión se guardan solo en este navegador; el SRS del Desktop es privado.",
            )}
          </p>
        </div>
      </div>
    );
  return (
    <div
      className="min-h-0 overflow-auto p-5"
      data-testid="study-review-catalog"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
          {(["all", "flashcard", "question"] as const).map((item) => (
            <button
              key={item}
              className={`rounded-md px-3 py-1.5 text-xs ${kind === item ? "bg-teal-600 text-white" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"}`}
              onClick={() => setKind(item)}
            >
              {item === "all"
                ? t("Todo")
                : item === "flashcard"
                  ? t("Flashcards")
                  : t("Preguntas")}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-neutral-500">
          {t("Elementos")}
          <input
            className="input h-8 w-16 text-xs"
            type="number"
            min={1}
            max={40}
            value={count}
            onChange={(event) =>
              setCount(
                Math.max(1, Math.min(40, Number(event.target.value) || 1)),
              )
            }
          />
        </label>
        <button
          data-testid="study-review-start"
          className="btn btn-primary h-8 px-3 text-xs"
          disabled={!filtered.length}
          onClick={start}
        >
          <Icon name="play" size={13} />
          {t("Comenzar revisión")}
        </button>
      </div>
      <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50/70 p-3 text-xs text-teal-900 dark:border-teal-900 dark:bg-teal-950/20 dark:text-teal-200">
        <strong>
          {filtered.length} {t("elementos disponibles")}
        </strong>
        <span className="ml-2 text-teal-800/70 dark:text-teal-300/70">
          {t(
            "El historial SRS y las fechas de próxima revisión no se publican.",
          )}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <div className="grid min-w-[780px] grid-cols-[minmax(260px,1.6fr)_10rem_9rem_9rem_10rem] border-b border-neutral-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
          <span>{t("Pregunta / anverso")}</span>
          <span>{t("Tipo")}</span>
          <span>{t("Dificultad")}</span>
          <span>{t("Estado")}</span>
          <span>{t("Actualizada")}</span>
        </div>
        {filtered.length ? (
          filtered.map((row, index) => {
            const isCard = row.item_kind === "flashcard";
            const key = String(row.review_key ?? row.id ?? index);
            return (
              <button
                key={key}
                data-testid="study-review-row"
                className="grid min-h-[68px] w-full min-w-[780px] grid-cols-[minmax(260px,1.6fr)_10rem_9rem_9rem_10rem] items-center border-b border-neutral-100 px-4 py-2 text-left text-xs transition-colors hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/55"
                onClick={() => onOpen(row, rows.indexOf(row))}
              >
                <span className="min-w-0 pr-3">
                  <strong className="block line-clamp-2 font-medium text-neutral-900 dark:text-neutral-200">
                    {value(row.front ?? row.prompt, t("Sin enunciado"))}
                  </strong>
                  <span className="mt-1 block truncate text-[10px] text-neutral-500">
                    {value(row.subject_name ?? row.source_title, "")}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 text-neutral-500">
                  <Icon name={isCard ? "flashcards" : "help"} size={12} />
                  {isCard
                    ? t("Flashcard")
                    : t(
                        STUDY_QUESTION_TYPE_LABEL[
                          String(row.question_type ?? row.type ?? "")
                        ] ?? "Pregunta",
                      )}
                </span>
                <span className="text-neutral-500">
                  {STUDY_QUESTION_DIFFICULTY_LABEL[String(row.difficulty ?? "")]
                    ? t(
                        STUDY_QUESTION_DIFFICULTY_LABEL[
                          String(row.difficulty ?? "")
                        ],
                      )
                    : value(row.difficulty, "—")}
                </span>
                <span>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] ${ratings[key] ? "bg-indigo-600/10 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "bg-teal-600/10 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"}`}
                  >
                    {ratings[key]
                      ? `${t("Valorada")} · ${ratings[key]}`
                      : t("Disponible")}
                  </span>
                </span>
                <span className="text-neutral-500">
                  {value(row.updated_at ?? row.created_at, "—")}
                </span>
              </button>
            );
          })
        ) : (
          <div className="p-8">
            <SurfaceEmpty label={descriptor.label} />
          </div>
        )}
      </div>
    </div>
  );
}

/** The Desktop bank is a readable assessment table. Do not leak answer_json or
 * other persistence fields into the catalogue: those are implementation details,
 * and the answer belongs in the opened question sheet. */
function StudyQuestionCatalog({
  rows,
  descriptor,
  onOpen,
}: {
  rows: LooseJsonRecord[];
  descriptor: Descriptor;
  onOpen: (row: JsonRecord, index: number) => void;
}) {
  return (
    <div
      className="min-h-0 overflow-auto p-5"
      data-testid="study-question-bank-catalog"
    >
      <div className="mb-3 flex items-center gap-2 text-xs text-neutral-500">
        <Icon name="help" size={14} className="text-teal-500" />
        <span>
          {rows.length}{" "}
          {t(
            descriptor.collection === "study-questions" &&
              descriptor.label === "Revisión"
              ? "preguntas disponibles"
              : "preguntas publicadas",
          )}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <div className="grid min-w-[780px] grid-cols-[minmax(260px,1.6fr)_minmax(130px,1fr)_8rem_9rem_10rem] border-b border-neutral-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
          <span>{t("Pregunta")}</span>
          <span>{t("Tipo")}</span>
          <span>{t("Dificultad")}</span>
          <span>{t("Estado")}</span>
          <span>{t("Actualizada")}</span>
        </div>
        {rows.length ? (
          rows.map((row, index) => (
            <button
              key={`${rowId(row, index)}`}
              data-testid="study-question-row"
              className="grid min-h-[68px] w-full min-w-[780px] grid-cols-[minmax(260px,1.6fr)_minmax(130px,1fr)_8rem_9rem_10rem] items-center border-b border-neutral-100 px-4 py-2 text-left text-xs transition-colors hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/55"
              onClick={() => onOpen(row, index)}
            >
              <span className="min-w-0 pr-3">
                <strong className="block line-clamp-2 font-medium text-neutral-900 dark:text-neutral-200">
                  {value(row.prompt, t("Pregunta sin enunciado"))}
                </strong>
                {Boolean(row.subject_name || row.source_title) && (
                  <span className="mt-1 block truncate text-[10px] text-neutral-500">
                    {value(row.subject_name ?? row.source_title)}
                  </span>
                )}
              </span>
              <span className="pr-3 text-neutral-500">
                {STUDY_QUESTION_TYPE_LABEL[
                  String(row.question_type ?? row.type ?? "")
                ]
                  ? t(
                      STUDY_QUESTION_TYPE_LABEL[
                        String(row.question_type ?? row.type ?? "")
                      ],
                    )
                  : value(row.question_type ?? row.type, "Pregunta")}
              </span>
              <span className="text-neutral-500">
                {STUDY_QUESTION_DIFFICULTY_LABEL[String(row.difficulty ?? "")]
                  ? t(
                      STUDY_QUESTION_DIFFICULTY_LABEL[
                        String(row.difficulty ?? "")
                      ],
                    )
                  : value(row.difficulty, "—")}
              </span>
              <span>
                <span className="rounded-full bg-teal-600/10 px-2 py-1 text-[10px] text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                  {STUDY_QUESTION_STATUS_LABEL[String(row.status ?? "")]
                    ? t(STUDY_QUESTION_STATUS_LABEL[String(row.status ?? "")])
                    : value(row.status, "Sin estado")}
                </span>
              </span>
              <span className="text-neutral-500">
                {value(row.updated_at ?? row.updatedAt ?? row.created_at, "—")}
              </span>
            </button>
          ))
        ) : (
          <div className="p-8">
            <SurfaceEmpty label={descriptor.label} />
          </div>
        )}
      </div>
    </div>
  );
}

function StudyQuestionDetail({ detail }: { detail: LooseJsonRecord }) {
  const question = jsonObject(detail.question ?? detail) as JsonRecord & {
    explanation?: string;
  };
  const answer = jsonObject(question.answer_json ?? question.answer);
  const options = jsonArray(question.options_json ?? question.options);
  const source = jsonObject(
    question.source_json ?? question.source,
  ) as JsonRecord & { title?: string; excerpt?: string };
  const tags = jsonArray(question.tags_json ?? question.tags)
    .map(String)
    .filter(Boolean);
  return (
    <article className="space-y-5" data-testid="study-question-detail">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">
          {t("Pregunta publicada")}
        </p>
        <h2 className="mt-1 text-xl font-semibold">
          {value(question.prompt, t("Pregunta sin enunciado"))}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {STUDY_QUESTION_TYPE_LABEL[
            String(question.question_type ?? question.type ?? "")
          ]
            ? t(
                STUDY_QUESTION_TYPE_LABEL[
                  String(question.question_type ?? question.type ?? "")
                ],
              )
            : value(question.question_type ?? question.type, "Pregunta")}{" "}
          ·{" "}
          {STUDY_QUESTION_DIFFICULTY_LABEL[String(question.difficulty ?? "")]
            ? t(
                STUDY_QUESTION_DIFFICULTY_LABEL[
                  String(question.difficulty ?? "")
                ],
              )
            : value(question.difficulty, "Sin dificultad")}
        </p>
      </header>
      <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/35">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {t("Respuesta y explicación")}
        </h3>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
          {value(
            answer.text ?? answer.value ?? question.answer,
            t("No hay respuesta publicada."),
          )}
        </p>
        {Boolean(question.explanation) && (
          <p className="mt-4 border-t border-neutral-200 pt-4 text-sm leading-6 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            {value(question.explanation)}
          </p>
        )}
      </section>
      {options.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Opciones")}
          </h3>
          <ol className="space-y-2">
            {options.map((option, index) => {
              const record =
                option && typeof option === "object" && !Array.isArray(option)
                  ? (option as JsonRecord)
                  : {};
              return (
                <li
                  key={index}
                  className="rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
                >
                  {value(
                    record.text ?? record.label ?? option,
                    `${t("Opción")} ${index + 1}`,
                  )}
                  {record.correct === true && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-teal-600 dark:text-teal-300">
                      {t("Correcta")}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {Boolean(source.title || source.excerpt) && (
        <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Fuente")}
          </h3>
          <p className="mt-2 text-sm">
            {value(source.title, t("Fuente publicada"))}
          </p>
          {Boolean(source.excerpt) && (
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              {value(source.excerpt)}
            </p>
          )}
        </section>
      )}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] dark:bg-neutral-800"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function StudyReviewDetail({ detail }: { detail: LooseJsonRecord }) {
  if (detail.question) return <StudyQuestionDetail detail={detail} />;
  const card = jsonObject(detail.card ?? detail) as LooseJsonRecord;
  const tags = jsonArray(card.tags_json ?? card.tags)
    .map(String)
    .filter(Boolean);
  return (
    <article className="space-y-5" data-testid="study-flashcard-detail">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">
          {t("Flashcard publicada")}
        </p>
        <h2 className="mt-1 text-xl font-semibold">
          {value(card.front, t("Flashcard sin anverso"))}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {value(card.short_id ?? card.id, "")} ·{" "}
          {STUDY_QUESTION_DIFFICULTY_LABEL[String(card.difficulty ?? "")]
            ? t(STUDY_QUESTION_DIFFICULTY_LABEL[String(card.difficulty ?? "")])
            : value(card.difficulty, "Sin dificultad")}
        </p>
      </header>
      <section className="rounded-2xl border border-neutral-200 bg-white p-7 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900/45">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">
          {t("Anverso")}
        </p>
        <h3 className="mt-4 text-xl font-semibold leading-8">
          {value(card.front, t("Sin anverso"))}
        </h3>
        <div className="mx-auto my-6 h-px max-w-md bg-neutral-200 dark:bg-neutral-800" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
          {t("Reverso")}
        </p>
        <p className="mt-4 whitespace-pre-wrap text-lg leading-7 text-emerald-700 dark:text-emerald-300">
          {value(card.back, t("Sin reverso publicado."))}
        </p>
        {Boolean(card.hint) && (
          <p className="mt-5 text-sm text-neutral-500">
            {t("Pista")}: {value(card.hint)}
          </p>
        )}
      </section>
      {Boolean(card.source_excerpt) && (
        <blockquote className="rounded-xl border border-neutral-200 border-l-4 border-l-teal-500 bg-neutral-50 p-4 text-sm leading-6 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/30 dark:text-neutral-400">
          {value(card.source_excerpt)}
        </blockquote>
      )}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] dark:bg-neutral-800"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <p className="rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-800">
        {t(
          "El historial de repaso, dominio y próxima revisión permanece privado en Desktop.",
        )}
      </p>
    </article>
  );
}

/** Read-only counterpart of the Desktop primary-source dossier. Binary files
 * and local paths are deliberately absent, but provenance, excerpts and
 * critical analysis remain navigable and citable. */
// Kept as a compatibility renderer for older deep links; current routes use the richer dossier.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ArchiveItemDetail({ detail }: { detail: JsonRecord }) {
  const item = jsonObject(detail.item ?? detail);
  const repository = jsonObject(detail.repository);
  const units = Array.isArray(detail.units)
    ? detail.units.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const excerpts = Array.isArray(detail.excerpts)
    ? detail.excerpts.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const analysis = jsonObject(detail.analysis);
  const tags = Array.isArray(detail.tags)
    ? detail.tags.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  return (
    <article className="space-y-5" data-testid="archive-item-dossier">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
          {t("Fuente primaria")}
        </p>
        <h2 className="mt-1 text-xl font-semibold">{title(item)}</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {value(
            repository.name ?? item.repository_name,
            "Procedencia por completar",
          )}{" "}
          ·{" "}
          {value(item.created_at ?? item.date_display, "Fecha no documentada")}
        </p>
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section className="space-y-4">
          <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/35">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("Descripción")}
            </h3>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
              {value(
                item.description ?? item.notes,
                "No hay descripción publicada.",
              )}
            </p>
          </section>
          {excerpts.length > 0 && (
            <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Extractos citables")}
              </h3>
              <div className="mt-3 space-y-3">
                {excerpts.map((excerpt, index) => (
                  <blockquote
                    key={String(excerpt.excerpt_id ?? index)}
                    className="border-l-2 border-indigo-400 pl-3 text-sm leading-6"
                  >
                    <p>{value(excerpt.quoted_text, "Sin texto")}</p>
                    <cite className="mt-1 block text-[10px] not-italic text-neutral-500">
                      {value(
                        excerpt.locator_display,
                        "Localizador no indicado",
                      )}
                    </cite>
                  </blockquote>
                ))}
              </div>
            </section>
          )}
          {Object.keys(analysis).length > 0 && (
            <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Análisis de fuente")}
              </h3>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                {value(
                  analysis.origin_notes ?? analysis.content,
                  "Análisis publicado",
                )}
              </p>
            </section>
          )}
        </section>
        <aside className="space-y-4">
          <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("Procedencia")}
            </h3>
            <dl className="mt-3 space-y-2 text-xs">
              <div>
                <dt className="text-neutral-500">{t("Repositorio")}</dt>
                <dd className="mt-1">{value(repository.name, "—")}</dd>
              </div>
              {units.map((unit, index) => (
                <div key={String(unit.unit_id ?? index)}>
                  <dt className="text-neutral-500">
                    {value(unit.level, "Unidad")}
                  </dt>
                  <dd className="mt-1">
                    {value(unit.title ?? unit.scope_content, "—")}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          {tags.length > 0 && (
            <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Etiquetas")}
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag, index) => (
                  <span
                    key={String(tag.id ?? tag.tag ?? index)}
                    className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] dark:bg-neutral-800"
                  >
                    {value(tag.tag ?? tag.label, "Etiqueta")}
                  </span>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </article>
  );
}

/** Full read-only primary-source dossier. It keeps Desktop's seven-tab information
 * architecture while making the publication boundary explicit: text and citations may
 * travel, but local file bytes, paths, authors and private notes never do. */
function ArchiveItemDetailRich({
  detail,
  onOpenRecord: _onOpenRecord,
}: {
  detail: JsonRecord;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  const item = jsonObject(detail.item ?? detail);
  const profile = jsonObject(detail.profile);
  const repository = jsonObject(detail.repository);
  const units = Array.isArray(detail.units)
    ? detail.units.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const excerpts = Array.isArray(detail.excerpts)
    ? detail.excerpts.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const versions = Array.isArray(detail.textVersions)
    ? detail.textVersions.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const evidence = Array.isArray(detail.evidence)
    ? detail.evidence.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const tags = Array.isArray(detail.tags)
    ? detail.tags.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const analysis = jsonObject(detail.analysis);
  // Notes remain a data concern of Desktop; this published dossier does not
  // expose the private tab or controls in its navigation.
  const tabs = [
    "source",
    "description",
    "text",
    "evidence",
    "analysis",
    "history",
  ] as const;
  const labels: Record<string, string> = {
    source: "Fuente",
    description: "Descripción",
    text: "Texto",
    evidence: "Evidencias",
    analysis: "Análisis",
    history: "Historial",
  };
  const [tab, setTab] = useState<(typeof tabs)[number]>("source");
  const [versionId, setVersionId] = useState(
    String(versions[0]?.text_version_id ?? ""),
  );
  const version =
    versions.find((entry) => String(entry.text_version_id) === versionId) ??
    versions[0];
  const segments = Array.isArray(version?.segments)
    ? (version.segments as JsonRecord[])
    : [];
  const card = (content: ReactNode) => (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/35">
      {content}
    </section>
  );
  return (
    <article className="space-y-5" data-testid="archive-item-dossier-rich">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
            <Icon name="archive" size={16} />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
              {t("Fuente primaria")}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{title(item)}</h2>
          </div>
          <span className="ml-auto rounded-full bg-neutral-100 px-2 py-1 text-[10px] uppercase tracking-wider text-neutral-500 dark:bg-neutral-800">
            {value(profile.access_status, "Acceso no indicado")}
          </span>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          {value(
            repository.name ?? item.repository_name,
            "Procedencia por completar",
          )}{" "}
          ·{" "}
          {value(item.created_at ?? item.date_display, "Fecha no documentada")}
        </p>
      </header>
      <nav
        className="flex overflow-x-auto border-b border-neutral-200 dark:border-neutral-800"
        role="tablist"
        aria-label={t("Secciones de la fuente")}
      >
        {tabs.map((candidate) => (
          <button
            key={candidate}
            role="tab"
            aria-selected={tab === candidate}
            className={`shrink-0 border-b-2 px-3 py-2 text-xs font-medium ${tab === candidate ? "border-indigo-600 text-indigo-700 dark:border-indigo-300 dark:text-indigo-200" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
            onClick={() => setTab(candidate)}
          >
            {t(labels[candidate])}
          </button>
        ))}
      </nav>
      {tab === "source" && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
          {card(
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Descripción de la fuente")}
              </h3>
              <p className="mt-3 text-sm leading-6">
                {value(
                  item.description ?? item.notes,
                  "No hay descripción publicada.",
                )}
              </p>
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  ["Tipo", item.kind],
                  ["Nombre de archivo", item.file_name],
                  ["Tamaño", item.bytes ? `${value(item.bytes)} bytes` : null],
                  ["Hash", item.content_hash],
                  ["Procesamiento", profile.processing_status],
                ].map(([label, entry]) => (
                  <div
                    key={t(String(label))}
                    className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
                  >
                    <dt className="text-[10px] uppercase tracking-wider text-neutral-500">
                      {t(String(label))}
                    </dt>
                    <dd className="mt-1 break-words text-xs">{value(entry)}</dd>
                  </div>
                ))}
              </dl>
            </>,
          )}
          {card(
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Procedencia")}
              </h3>
              <dl className="mt-3 space-y-3 text-xs">
                <div>
                  <dt className="text-neutral-500">{t("Repositorio")}</dt>
                  <dd className="mt-1">{value(repository.name, "—")}</dd>
                </div>
                {units.map((unit, index) => (
                  <div key={String(unit.unit_id ?? index)}>
                    <dt className="text-neutral-500">
                      {value(unit.level, "Unidad")}
                    </dt>
                    <dd className="mt-1">
                      {value(unit.title ?? unit.scope_content, "—")}
                    </dd>
                  </div>
                ))}
              </dl>
              {tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {tags.map((tag, index) => (
                    <span
                      key={String(tag.id ?? tag.tag ?? index)}
                      className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] dark:bg-neutral-800"
                    >
                      {value(tag.tag ?? tag.label, "Etiqueta")}
                    </span>
                  ))}
                </div>
              )}
            </>,
          )}
        </div>
      )}
      {tab === "description" && (
        <div className="grid gap-5 lg:grid-cols-2">
          {card(
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Descripción")}
              </h3>
              <div className="mt-3 text-sm leading-6">
                <MarkdownReader
                  value={value(
                    item.description ?? item.notes,
                    "No hay descripción publicada.",
                  )}
                />
              </div>
            </>,
          )}
          {card(
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Condiciones")}
              </h3>
              <dl className="mt-3 space-y-3 text-xs">
                <div>
                  <dt className="text-neutral-500">{t("Derechos")}</dt>
                  <dd className="mt-1">
                    {value(profile.rights_statement, "No indicados")}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500">{t("Reproducción")}</dt>
                  <dd className="mt-1">
                    {value(profile.reproduction_conditions, "No indicadas")}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500">{t("Sensibilidad")}</dt>
                  <dd className="mt-1">
                    {value(profile.sensitivity, "Normal")}
                  </dd>
                </div>
              </dl>
            </>,
          )}
        </div>
      )}
      {tab === "text" && (
        <div className="space-y-4">
          {card(
            <>
              {versions.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      {t("Versiones de texto")}
                    </h3>
                    <select
                      className="input ml-auto h-8 text-xs"
                      value={versionId}
                      onChange={(event) => setVersionId(event.target.value)}
                    >
                      {versions.map((entry, index) => (
                        <option
                          key={String(entry.text_version_id ?? index)}
                          value={String(entry.text_version_id)}
                        >
                          {value(entry.kind, "Texto")} ·{" "}
                          {value(entry.language_code, "—")} ·{" "}
                          {value(entry.status, "sin estado")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-5 text-sm leading-7 dark:border-neutral-800 dark:bg-neutral-950">
                    <MarkdownReader
                      value={value(
                        version?.content,
                        "Esta versión no tiene contenido publicado.",
                      )}
                    />
                  </div>
                  {segments.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {segments.map((segment, index) => (
                        <div
                          key={String(segment.segment_id ?? index)}
                          className="rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-800"
                        >
                          <span className="mr-2 font-semibold text-neutral-500">
                            {value(
                              segment.page_label ?? segment.sequence_no,
                              "—",
                            )}
                          </span>
                          {value(segment.content)}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-neutral-500">
                  {t("No hay versiones de texto publicadas.")}
                </p>
              )}
            </>,
          )}
        </div>
      )}
      {tab === "evidence" && (
        <div className="space-y-4">
          {card(
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Extractos citables")}
              </h3>
              <div className="mt-3 space-y-3">
                {excerpts.length ? (
                  excerpts.map((excerpt, index) => (
                    <blockquote
                      key={String(excerpt.excerpt_id ?? index)}
                      className="border-l-2 border-indigo-400 pl-3 text-sm leading-6"
                    >
                      <p>{value(excerpt.quoted_text, "Sin texto")}</p>
                      <cite className="mt-1 block text-[10px] not-italic text-neutral-500">
                        {value(
                          excerpt.locator_display,
                          "Localizador no indicado",
                        )}{" "}
                        · {value(excerpt.review_status, "Sin revisar")}
                      </cite>
                    </blockquote>
                  ))
                ) : (
                  <p className="text-sm text-neutral-500">
                    {t("No hay extractos publicados.")}
                  </p>
                )}
              </div>
            </>,
          )}
          {card(
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Evidencias vinculadas")}
              </h3>
              <div className="mt-3 space-y-2">
                {evidence.length ? (
                  evidence.map((entry, index) => (
                    <div
                      key={String(entry.id ?? index)}
                      className="rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-800"
                    >
                      <p>{value(entry.quote, "Sin cita")}</p>
                      <span className="text-[10px] text-neutral-500">
                        {value(entry.location, "Localización no indicada")} ·{" "}
                        {value(entry.evidence_role, "supports")}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-neutral-500">
                    {t("No hay evidencias publicadas.")}
                  </p>
                )}
              </div>
            </>,
          )}
        </div>
      )}
      {tab === "analysis" && (
        <div className="space-y-4">
          {card(
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Análisis crítico")}
              </h3>
              {Object.keys(analysis).length ? (
                <dl className="mt-3 space-y-3 text-sm leading-6">
                  {[
                    ["Propósito y público", analysis.purpose_audience],
                    ["Forma", analysis.content_form],
                    ["Perspectiva y sesgos", analysis.perspective_bias],
                    ["Silencios y límites", analysis.silences_limits],
                    ["Autenticidad", analysis.authenticity_notes],
                    ["Corroboración", analysis.corroboration],
                    ["Preguntas", analysis.questions],
                  ]
                    .filter(([, entry]) => entry)
                    .map(([label, entry]) => (
                      <div key={t(String(label))}>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                          {t(String(label))}
                        </dt>
                        <dd className="mt-1 whitespace-pre-wrap">
                          {value(entry)}
                        </dd>
                      </div>
                    ))}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-neutral-500">
                  {t("No hay análisis publicado.")}
                </p>
              )}
            </>,
          )}
        </div>
      )}
      {tab === "history" && (
        <div className="space-y-4">
          {card(
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Historial de procesamiento")}
              </h3>
              <p className="mt-3 text-sm leading-6">
                {t(
                  "El historial local, los autores de cambios y las rutas de archivo permanecen privados. Sólo se muestra el estado publicado actual.",
                )}
              </p>
              <p className="mt-3 text-xs text-neutral-500">
                {t("Actualizada")}: {value(item.updated_at, "—")}
              </p>
            </>,
          )}
        </div>
      )}
    </article>
  );
}

/** Testimony dossier without media, contact or participant data. The text
 * transcript and coding layers are sufficient for a published reader and keep
 * the same overview → transcript → codes hierarchy as Desktop. */
function TestimonyInterviewDetail({
  detail,
  onOpenRecord,
}: {
  detail: JsonRecord;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  const interview = jsonObject(detail.interview ?? detail);
  const transcripts = Array.isArray(detail.transcripts)
    ? detail.transcripts.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const annotations = Array.isArray(detail.annotations)
    ? detail.annotations.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const codes = Array.isArray(detail.codes)
    ? detail.codes.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  return (
    <article className="space-y-5" data-testid="testimony-interview-dossier">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
          {t("Entrevista publicada")}
        </p>
        <h2 className="mt-1 text-xl font-semibold">{title(interview)}</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {value(
            interview.conducted_at ?? interview.date,
            "Fecha no documentada",
          )}{" "}
          ·{" "}
          {value(
            interview.location_text ?? interview.location,
            "Lugar no indicado",
          )}
        </p>
      </header>
      <section
        className="flex items-start gap-3 rounded-xl border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-800"
        data-testid="testimony-media-state"
      >
        <Icon name="lock" size={15} className="mt-0.5 shrink-0" />
        <p>
          <strong className="text-neutral-700 dark:text-neutral-300">
            {t("Grabación no publicada")}
          </strong>
          <span className="mt-1 block">
            {t(
              "El audio, rutas y metadatos de contacto permanecen en Desktop para respetar acuerdos de atribución.",
            )}
          </span>
        </p>
      </section>
      {Boolean(interview.abstract) && (
        <section className="rounded-xl border border-neutral-200 bg-white p-5 text-sm leading-6 dark:border-neutral-800 dark:bg-neutral-900/35">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Resumen")}
          </h3>
          <p>{value(interview.abstract)}</p>
        </section>
      )}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {t("Transcripción publicada · lector")}
        </h3>
        {transcripts.length ? (
          transcripts.map((transcript, index) => {
            const transcriptId = String(
              transcript.id ?? transcript.transcript_id ?? "",
            );
            const content = (
              <>
                <MarkdownReader
                  value={value(
                    transcript.content_markdown ?? transcript.content,
                    "",
                  )}
                />
                <p className="mt-3 text-[10px] uppercase tracking-wider text-neutral-500">
                  {value(transcript.language, "Idioma no indicado")}
                </p>
              </>
            );
            return transcriptId && onOpenRecord ? (
              <button
                type="button"
                key={transcriptId}
                className="block w-full rounded-xl border border-neutral-200 bg-white p-5 text-left transition hover:border-indigo-300 dark:border-neutral-800 dark:bg-neutral-900/35 dark:hover:border-indigo-800"
                onClick={() =>
                  onOpenRecord("testimony-transcripts", transcriptId)
                }
              >
                {content}
                <span className="mt-3 block text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
                  {t("Abrir lector completo →")}
                </span>
              </button>
            ) : (
              <section
                key={String(transcript.id ?? index)}
                className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/35"
              >
                {content}
              </section>
            );
          })
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-800">
            {t("No hay transcripción publicada.")}
          </p>
        )}
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Códigos")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {codes.length ? (
              codes.map((code, index) => (
                <span
                  key={String(code.id ?? index)}
                  className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-800"
                >
                  {value(code.label, "Código")}
                </span>
              ))
            ) : (
              <span className="text-xs text-neutral-500">
                {t("No hay códigos publicados.")}
              </span>
            )}
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Anotaciones")}
          </h3>
          <div className="space-y-2">
            {annotations.length ? (
              annotations.map((annotation, index) => (
                <blockquote
                  key={String(annotation.id ?? index)}
                  className="border-l-2 border-teal-400 pl-3 text-xs leading-5"
                >
                  <p>
                    {value(
                      annotation.quote_snapshot ?? annotation.quote,
                      "Fragmento",
                    )}
                  </p>
                  <cite className="block text-[10px] text-neutral-500">
                    {value(annotation.memo, "")}
                  </cite>
                </blockquote>
              ))
            ) : (
              <span className="text-xs text-neutral-500">
                {t("No hay anotaciones publicadas.")}
              </span>
            )}
          </div>
        </section>
      </div>
    </article>
  );
}

function TestimonyContrastDetail({ detail }: { detail: JsonRecord }) {
  const contrast = jsonObject(detail.contrast ?? detail);
  const annotations = Array.isArray(detail.annotations)
    ? detail.annotations.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  return (
    <article className="space-y-5" data-testid="testimony-contrast-detail">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
          {t("Contraste publicado")}
        </p>
        <h2 className="mt-1 text-xl font-semibold">{title(contrast)}</h2>
      </header>
      {Boolean(contrast.memo_markdown) && (
        <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <MarkdownReader value={value(contrast.memo_markdown)} />
        </section>
      )}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {t("Fragmentos comparados")}
        </h3>
        {annotations.length ? (
          annotations.map((annotation, index) => (
            <blockquote
              key={String(annotation.id ?? index)}
              className="rounded-xl border border-neutral-200 bg-white p-4 text-sm leading-6 dark:border-neutral-800 dark:bg-neutral-900/35"
            >
              <p>
                {value(
                  annotation.quote_snapshot ?? annotation.quote,
                  "Fragmento no publicado",
                )}
              </p>
              <cite className="mt-1 block text-[10px] text-neutral-500">
                {value(annotation.memo, "")}
              </cite>
            </blockquote>
          ))
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-800">
            {t("No hay fragmentos publicados.")}
          </p>
        )}
      </section>
    </article>
  );
}

function TestimonyTranscriptDetail({ detail }: { detail: JsonRecord }) {
  const transcript = jsonObject(detail.transcript ?? detail);
  const segments = Array.isArray(detail.segments)
    ? detail.segments.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const annotations = Array.isArray(detail.annotations)
    ? detail.annotations.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  return (
    <article className="space-y-5" data-testid="testimony-transcript-detail">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
          {t("Transcripción publicada")}
        </p>
        <h2 className="mt-1 text-xl font-semibold">
          {value(transcript.short_id ?? transcript.id, "Transcripción")}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {value(transcript.language, "Idioma no indicado")} ·{" "}
          {value(transcript.kind, "Versión publicada")}
        </p>
      </header>
      <section
        className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/35"
        data-testid="testimony-reader"
      >
        <div className="mb-3 flex items-center justify-between border-b border-neutral-200 pb-2 text-[10px] uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
          <span>{t("Lector de transcripción")}</span>
          <span>{t("Solo lectura")}</span>
        </div>
        <MarkdownReader
          value={value(transcript.content_markdown ?? transcript.content, "")}
        />
      </section>
      {segments.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Segmentos temporales")}
          </h3>
          {segments.map((segment, index) => (
            <div
              key={String(segment.id ?? index)}
              className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
            >
              <span className="mr-2 text-[10px] font-semibold text-neutral-500">
                {value(segment.t_start, "0")}–{value(segment.t_end, "0")}
              </span>
              {value(segment.text, "Segmento sin texto")}
            </div>
          ))}
        </section>
      )}
      {annotations.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Anotaciones publicadas")}
          </h3>
          {annotations.map((annotation, index) => (
            <blockquote
              key={String(annotation.id ?? index)}
              className="border-l-2 border-teal-400 pl-3 text-xs"
            >
              <p>{value(annotation.quote_snapshot, "Fragmento")}</p>
              <cite className="text-[10px] text-neutral-500">
                {value(annotation.memo, "")}
              </cite>
            </blockquote>
          ))}
        </section>
      )}
    </article>
  );
}

function DatabasePageDetail({ detail }: { detail: JsonRecord }) {
  const page = jsonObject(detail.page ?? detail);
  const blocks = Array.isArray(detail.blocks)
    ? detail.blocks.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const content = value(page.content ?? page.content_markdown ?? page.body, "");
  const links = Array.isArray(detail.links)
    ? detail.links.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const comments = Array.isArray(detail.comments)
    ? detail.comments.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const blockText = (block: JsonRecord): string => {
    const parsed = jsonObject(block.content_json ?? block.content);
    return value(
      parsed.text ??
        parsed.rich_text ??
        parsed.markdown ??
        block.normalized_text ??
        block.text ??
        block.value,
      "Bloque publicado",
    );
  };
  return (
    <article className="space-y-5" data-testid="database-page-detail">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
          {t("Página publicada")}
        </p>
        <h2 className="mt-1 text-xl font-semibold">{title(page)}</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {t("Contenido de página · solo lectura")}
        </p>
      </header>
      <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/35">
        {content ? (
          <MarkdownReader value={content} />
        ) : blocks.length ? (
          <div className="space-y-3">
            {blocks.map((block, index) => (
              <div
                key={String(block.id ?? index)}
                className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
              >
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  {value(block.type, "Bloque")}
                </span>
                <MarkdownReader value={blockText(block)} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">
            {t("Esta página no tiene contenido publicado.")}
          </p>
        )}
      </section>
      {links.length > 0 && (
        <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Enlaces publicados")}
          </h3>
          <div className="mt-2 space-y-2">
            {links.map((link, index) => (
              <div
                key={String(link.id ?? index)}
                className="text-xs text-neutral-600 dark:text-neutral-400"
              >
                {value(
                  link.label ?? link.target_page_id ?? link.target_block_id,
                  "Página enlazada",
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {comments.length > 0 && (
        <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Comentarios publicados")}
          </h3>
          <div className="mt-2 space-y-2">
            {comments.map((comment, index) => (
              <p
                key={String(comment.id ?? index)}
                className="text-sm whitespace-pre-wrap"
              >
                {value(comment.body, "Comentario")}
              </p>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

function PublishedRecordHeader({
  eyebrow,
  record,
  icon = "archive",
}: {
  eyebrow: string;
  record: JsonRecord;
  icon?: string;
}) {
  return (
    <header className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
          {t(eyebrow)}
        </p>
        <h2 className="mt-1 text-xl font-semibold">{title(record)}</h2>
      </div>
    </header>
  );
}

function PublishedArchiveRepositoryDetail({
  detail,
  onOpenRecord,
}: {
  detail: JsonRecord;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  const repository = jsonObject(detail.repository ?? detail);
  const units = jsonArray(detail.units).map(jsonObject);
  const items = jsonArray(detail.items).map(jsonObject);
  const repositoryId = String(repository.repository_id ?? "");
  return (
    <article className="space-y-5" data-testid="archive-repository-detail">
      <PublishedRecordHeader
        eyebrow="Repositorio publicado"
        record={repository}
      />
      <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/35">
        <dl className="grid gap-3 sm:grid-cols-2 text-xs">
          <div>
            <dt className="text-neutral-500">{t("País")}</dt>
            <dd className="mt-1">{value(repository.country_code, "—")}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">{t("Acceso")}</dt>
            <dd className="mt-1">
              {value(repository.access_notes, "No indicado")}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">{t("Identificador")}</dt>
            <dd className="mt-1 break-all">{value(repositoryId)}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">{t("Actualización")}</dt>
            <dd className="mt-1">{value(repository.updated_at, "—")}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {t("Unidades descriptivas")}
        </h3>
        {units.length ? (
          <div className="space-y-2">
            {units.map((unit, index) => (
              <button
                key={String(unit.unit_id ?? index)}
                className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 p-3 text-left hover:border-indigo-300 dark:border-neutral-800 dark:hover:border-indigo-800"
                onClick={() =>
                  onOpenRecord?.("archive-units", String(unit.unit_id))
                }
              >
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm">{title(unit)}</strong>
                  <span className="text-xs text-neutral-500">
                    {value(unit.level, "Unidad")} ·{" "}
                    {value(unit.scope_content, "Sin alcance")}
                  </span>
                </span>
                <Icon
                  name="chevronRight"
                  size={13}
                  className="text-neutral-400"
                />
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-800">
            {t("No hay unidades publicadas.")}
          </p>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {t("Fuentes vinculadas")}
        </h3>
        {items.length ? (
          <div className="space-y-2">
            {items.map((item, index) => (
              <button
                key={String(item.item_id ?? index)}
                className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 p-3 text-left hover:border-indigo-300 dark:border-neutral-800 dark:hover:border-indigo-800"
                onClick={() =>
                  onOpenRecord?.("archive-items", String(item.item_id))
                }
              >
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm">{title(item)}</strong>
                  <span className="text-xs text-neutral-500">
                    {value(item.kind, "Documento")}
                  </span>
                </span>
                <Icon
                  name="chevronRight"
                  size={13}
                  className="text-neutral-400"
                />
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-800">
            {t("No hay fuentes vinculadas.")}
          </p>
        )}
      </section>
    </article>
  );
}

function PublishedArchiveUnitDetail({
  detail,
  onOpenRecord,
}: {
  detail: JsonRecord;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  const unit = jsonObject(detail.unit ?? detail);
  const repository = jsonObject(detail.repository);
  const items = jsonArray(detail.items).map(jsonObject);
  return (
    <article className="space-y-5" data-testid="archive-unit-detail">
      <PublishedRecordHeader
        eyebrow="Unidad descriptiva publicada"
        record={unit}
      />
      <section className="rounded-xl border border-neutral-200 bg-white p-5 text-sm leading-6 dark:border-neutral-800 dark:bg-neutral-900/35">
        <dl className="grid gap-3 sm:grid-cols-2 text-xs">
          <div>
            <dt className="text-neutral-500">{t("Nivel")}</dt>
            <dd className="mt-1">{value(unit.level, "—")}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">{t("Fecha")}</dt>
            <dd className="mt-1">{value(unit.date_display, "—")}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-neutral-500">{t("Alcance y contenido")}</dt>
            <dd className="mt-1 whitespace-pre-wrap">
              {value(unit.scope_content ?? unit.description, "No indicado")}
            </dd>
          </div>
        </dl>
      </section>
      {Boolean(repository.name) && (
        <button
          className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 p-4 text-left hover:border-indigo-300 dark:border-neutral-800 dark:hover:border-indigo-800"
          onClick={() =>
            onOpenRecord?.(
              "archive-repositories",
              String(repository.repository_id),
            )
          }
        >
          <Icon name="archive" size={16} className="text-indigo-500" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] uppercase tracking-wider text-neutral-500">
              {t("Repositorio")}
            </span>
            <strong className="block text-sm">{title(repository)}</strong>
          </span>
          <Icon name="chevronRight" size={13} className="text-neutral-400" />
        </button>
      )}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {t("Fuentes descritas")}
        </h3>
        {items.length ? (
          <div className="space-y-2">
            {items.map((item, index) => (
              <button
                key={String(item.item_id ?? index)}
                className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 p-3 text-left hover:border-indigo-300 dark:border-neutral-800"
                onClick={() =>
                  onOpenRecord?.("archive-items", String(item.item_id))
                }
              >
                <strong className="min-w-0 flex-1 truncate text-sm">
                  {title(item)}
                </strong>
                <Icon
                  name="chevronRight"
                  size={13}
                  className="text-neutral-400"
                />
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-800">
            {t("No hay fuentes vinculadas.")}
          </p>
        )}
      </section>
    </article>
  );
}

function PublishedArchiveExcerptDetail({
  detail,
  onOpenRecord,
}: {
  detail: JsonRecord;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  const excerpt = jsonObject(detail.excerpt ?? detail);
  const item = jsonObject(detail.item);
  return (
    <article className="space-y-5" data-testid="archive-excerpt-detail">
      <PublishedRecordHeader
        eyebrow="Extracto publicado"
        record={excerpt}
        icon="quote"
      />
      <blockquote className="rounded-2xl border border-indigo-200 border-l-4 border-l-indigo-500 bg-indigo-50/50 p-6 text-base leading-8 dark:border-indigo-900 dark:bg-indigo-950/20">
        <p>
          {value(
            excerpt.quoted_text ?? excerpt.quote ?? excerpt.text,
            "No hay texto publicado.",
          )}
        </p>
        <cite className="mt-3 block text-xs not-italic text-neutral-500">
          {value(
            excerpt.locator_display ?? excerpt.locator,
            "Localizador no indicado",
          )}
        </cite>
      </blockquote>
      {Boolean(item.item_id) && (
        <button
          className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 p-4 text-left hover:border-indigo-300 dark:border-neutral-800"
          onClick={() => onOpenRecord?.("archive-items", String(item.item_id))}
        >
          <Icon name="archive" size={16} className="text-indigo-500" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] uppercase tracking-wider text-neutral-500">
              {t("Fuente")}
            </span>
            <strong className="block truncate text-sm">{title(item)}</strong>
          </span>
          <Icon name="chevronRight" size={13} className="text-neutral-400" />
        </button>
      )}
    </article>
  );
}

function PublishedSourceAnalysisDetail({
  detail,
  onOpenRecord,
}: {
  detail: JsonRecord;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  const analysis = jsonObject(detail.analysis ?? detail);
  const item = jsonObject(detail.item);
  const fields = [
    ["Propósito y origen", analysis.origin_notes],
    ["Forma", analysis.content_form],
    ["Perspectiva y sesgos", analysis.perspective_bias],
    ["Silencios y límites", analysis.silences_limits],
    ["Autenticidad", analysis.authenticity_notes],
    ["Corroboración", analysis.corroboration],
    ["Preguntas", analysis.questions],
  ].filter(([, content]) => content != null && content !== "");
  return (
    <article className="space-y-5" data-testid="source-analysis-detail">
      <PublishedRecordHeader
        eyebrow="Análisis de fuente publicado"
        record={analysis}
        icon="search"
      />
      <div className="space-y-3">
        {fields.length ? (
          fields.map(([label, content]) => (
            <section
              key={t(String(label))}
              className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/35"
            >
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                {t(String(label))}
              </h3>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-6">
                <MarkdownReader value={value(content)} />
              </div>
            </section>
          ))
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-800">
            {t("No hay contenido narrativo publicado.")}
          </p>
        )}
      </div>
      {Boolean(item.item_id) && (
        <button
          className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 p-4 text-left hover:border-indigo-300 dark:border-neutral-800"
          onClick={() => onOpenRecord?.("archive-items", String(item.item_id))}
        >
          <Icon name="archive" size={16} className="text-indigo-500" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] uppercase tracking-wider text-neutral-500">
              {t("Fuente analizada")}
            </span>
            <strong className="block truncate text-sm">{title(item)}</strong>
          </span>
          <Icon name="chevronRight" size={13} className="text-neutral-400" />
        </button>
      )}
    </article>
  );
}

function PublishedTestimonyCodeDetail({ detail }: { detail: JsonRecord }) {
  const code = jsonObject(detail.code ?? detail);
  const annotations = jsonArray(detail.annotations).map(jsonObject);
  return (
    <article className="space-y-5" data-testid="testimony-code-detail">
      <PublishedRecordHeader
        eyebrow="Código de testimonio publicado"
        record={code}
        icon="tag"
      />
      <section className="rounded-xl border border-neutral-200 bg-white p-5 text-sm leading-6 dark:border-neutral-800 dark:bg-neutral-900/35">
        <p>
          {value(
            code.description ?? code.notes,
            "No hay descripción publicada.",
          )}
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
          <div>
            <dt className="text-neutral-500">{t("Etiqueta normalizada")}</dt>
            <dd className="mt-1">
              {value(code.normalized_label, title(code))}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">{t("Color")}</dt>
            <dd className="mt-1">{value(code.color, "—")}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {t("Fragmentos anotados")}
        </h3>
        {annotations.length ? (
          <div className="space-y-2">
            {annotations.map((annotation, index) => (
              <blockquote
                key={String(annotation.id ?? index)}
                className="rounded-xl border border-neutral-200 bg-white p-4 text-sm leading-6 dark:border-neutral-800 dark:bg-neutral-900/35"
              >
                <p>
                  {value(
                    annotation.quote_snapshot ?? annotation.quote,
                    "Fragmento",
                  )}
                </p>
                <cite className="mt-1 block text-xs not-italic text-neutral-500">
                  {value(annotation.memo, "")}
                </cite>
              </blockquote>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-800">
            {t("No hay fragmentos publicados.")}
          </p>
        )}
      </section>
    </article>
  );
}

function PersonDetail({
  detail,
  spaceId,
  onOpenRecord,
}: {
  detail: JsonRecord;
  spaceId: string;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  const person = jsonObject(detail.person) as JsonRecord & {
    person_id?: string;
    birth_date?: string;
    death_date?: string;
    sex?: string;
    notes?: string;
    portrait?: unknown;
  };
  const names = Array.isArray(detail.names)
    ? detail.names.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const relationships = Array.isArray(detail.relationships)
    ? detail.relationships.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const related = Array.isArray(detail.relatedPersons)
    ? detail.relatedPersons.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const places = Array.isArray(detail.places)
    ? detail.places.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const events = Array.isArray(detail.events)
    ? detail.events.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const portrait = jsonObject(person.portrait ?? detail.portrait);
  const portraitHash = String(portrait.thumbHash ?? portrait.hash ?? "");
  const personId = String(person.person_id ?? "");
  const relationLabel: Record<string, string> = {
    parent: "Progenitor/a",
    child: "Hijo/a",
    spouse: "Cónyuge",
    sibling: "Hermano/a",
  };
  const relatedById = new Map(
    related.map((entry) => [String(entry.person_id), entry]),
  );
  const life = [person.birth_date, person.death_date]
    .filter(Boolean)
    .map(String)
    .join(" – ");
  return (
    <article className="space-y-5" data-testid="person-dossier">
      <header className="flex items-center gap-4">
        {portraitHash ? (
          <img
            src={api.assetUrl(spaceId, portraitHash)}
            alt=""
            className="h-20 w-20 rounded-2xl object-cover"
          />
        ) : (
          <span className="grid h-20 w-20 place-items-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
            <Icon name="user" size={30} />
          </span>
        )}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-500">
            {t("Ficha de persona")}
          </p>
          <h2 className="mt-1 text-2xl font-semibold">{title(person)}</h2>
          <p className="mt-1 text-xs text-neutral-500">
            {life || t("Fechas no documentadas")}
            {person.sex ? ` · ${value(person.sex)}` : ""}
          </p>
        </div>
      </header>
      {person.notes && (
        <section className="rounded-xl border border-neutral-200 bg-white p-4 text-sm leading-6 dark:border-neutral-800 dark:bg-neutral-900/35">
          <MarkdownReader value={value(person.notes)} />
        </section>
      )}
      {names.length > 1 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Nombres documentados")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {names.map((name, index) => (
              <span
                key={String(name.id ?? index)}
                className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs dark:bg-neutral-900"
              >
                {value(name.name)}
              </span>
            ))}
          </div>
        </section>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Relaciones familiares")}
          </h3>
          <div className="space-y-2">
            {relationships.length ? (
              relationships.map((relationship, index) => {
                const otherId =
                  String(relationship.from_person) === personId
                    ? String(relationship.to_person ?? "")
                    : String(relationship.from_person ?? "");
                const other = relatedById.get(otherId);
                return (
                  <button
                    key={String(relationship.rel_id ?? index)}
                    className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 p-3 text-left hover:border-indigo-300 dark:border-neutral-800 dark:hover:border-indigo-800"
                    onClick={() =>
                      otherId && onOpenRecord?.("persons", otherId)
                    }
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-600/10 text-indigo-500">
                      <Icon name="users" size={15} />
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-sm">
                        {other ? title(other) : t("Persona relacionada")}
                      </strong>
                      <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                        {relationLabel[String(relationship.type)] ??
                          value(relationship.type, "Relación")}
                      </span>
                    </span>
                    <Icon
                      name="chevronRight"
                      size={13}
                      className="ml-auto text-neutral-400"
                    />
                  </button>
                );
              })
            ) : (
              <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-800">
                {t("No hay relaciones publicadas.")}
              </p>
            )}
          </div>
        </section>
        <section className="space-y-5">
          {places.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Lugares")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {places.map((place, index) => (
                  <button
                    key={String(place.place_id ?? index)}
                    className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs hover:border-indigo-300 dark:border-neutral-800"
                    onClick={() =>
                      onOpenRecord?.("places", String(place.place_id))
                    }
                  >
                    {title(place)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {events.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t("Acontecimientos")}
              </h3>
              <div className="space-y-2">
                {events.map((event, index) => (
                  <button
                    key={String(event.event_id ?? index)}
                    className="block w-full rounded-lg border border-neutral-200 p-3 text-left text-xs dark:border-neutral-800"
                    onClick={() =>
                      onOpenRecord?.("events", String(event.event_id))
                    }
                  >
                    <strong>{title(event)}</strong>
                    <span className="ml-2 text-neutral-500">
                      {value(event.date ?? event.start_date, "")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </article>
  );
}

function WorldCharacterDetail({
  detail,
  spaceId,
  onOpenRecord,
}: {
  detail: JsonRecord;
  spaceId: string;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  const person = jsonObject(detail.person);
  const abilities = Array.isArray(detail.abilities)
    ? (detail.abilities as Array<
        JsonRecord & { cost?: string; limits?: string }
      >)
    : [];
  const affiliations = Array.isArray(detail.affiliations)
    ? (detail.affiliations as JsonRecord[])
    : [];
  const scenes = Array.isArray(detail.scenes)
    ? (detail.scenes as JsonRecord[])
    : [];
  const secrets = Array.isArray(detail.secrets)
    ? (detail.secrets as JsonRecord[])
    : [];
  const images = Array.isArray(detail.images)
    ? (detail.images as JsonRecord[])
    : [];
  const prose = [
    ["Apariencia", person.appearance],
    ["Personalidad", person.personality],
    ["Trasfondo", person.backstory],
  ].filter((entry) => Boolean(entry[1]));
  const arc = [
    ["Deseo", person.arc_want],
    ["Necesidad", person.arc_need],
    ["Falla", person.arc_flaw],
    ["Mentira", person.arc_lie],
    ["Herida", person.arc_wound],
  ].filter((entry) => Boolean(entry[1]));
  return (
    <div className="space-y-6" data-testid="character-dossier">
      <PersonDetail
        detail={detail}
        spaceId={spaceId}
        onOpenRecord={onOpenRecord}
      />
      {images.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Galería")}
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {images.map((image, index) => {
              const asset = jsonObject(image.asset);
              const hash = String(asset.thumbHash ?? asset.hash ?? "");
              return hash ? (
                <figure
                  key={String(image.image_id ?? index)}
                  className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800"
                >
                  <img
                    src={api.assetUrl(spaceId, hash)}
                    alt=""
                    className="aspect-square w-full object-cover"
                  />
                  <figcaption className="truncate p-2 text-[10px] text-neutral-500">
                    {value(image.label ?? image.kind, t("Imagen"))}
                  </figcaption>
                </figure>
              ) : null;
            })}
          </div>
        </section>
      )}
      {prose.length > 0 && (
        <section className="grid gap-3 lg:grid-cols-3">
          {prose.map(([label, content]) => (
            <article
              key={t(String(label))}
              className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                {t(String(label))}
              </h3>
              <div className="mt-2 text-sm leading-6">
                <MarkdownReader value={value(content)} />
              </div>
            </article>
          ))}
        </section>
      )}
      {arc.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Arco narrativo")}
          </h3>
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {arc.map(([label, content]) => (
              <div
                key={t(String(label))}
                className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <dt className="text-[10px] uppercase tracking-wider text-neutral-500">
                  {t(String(label))}
                </dt>
                <dd className="mt-1 text-xs">{value(content)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {abilities.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Capacidades y límites")}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {abilities.map((ability, index) => (
              <article
                key={String(ability.ability_id ?? index)}
                className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <strong className="text-sm">{title(ability)}</strong>
                <p className="mt-1 text-xs text-neutral-500">
                  {value(ability.description, "")}
                </p>
                {Boolean(ability.cost) && (
                  <p className="mt-2 text-[10px]">
                    <span className="font-semibold uppercase text-neutral-500">
                      {t("Coste")} ·{" "}
                    </span>
                    {value(ability.cost)}
                  </p>
                )}
                {Boolean(ability.limits) && (
                  <p className="mt-1 text-[10px]">
                    <span className="font-semibold uppercase text-neutral-500">
                      {t("Límite")} ·{" "}
                    </span>
                    {value(ability.limits)}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {affiliations.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("Facciones, culturas y dinastías")}
            </h3>
            <div className="space-y-2">
              {affiliations.map((affiliation, index) => {
                const group = jsonObject(affiliation.group);
                return (
                  <button
                    key={String(affiliation.affiliation_id ?? index)}
                    className="flex w-full items-center gap-2 rounded-xl border border-neutral-200 p-3 text-left dark:border-neutral-800"
                    onClick={() =>
                      onOpenRecord?.(
                        "world-groups",
                        String(affiliation.group_id),
                      )
                    }
                  >
                    <Icon
                      name="network"
                      size={14}
                      className="text-indigo-500"
                    />
                    <span>
                      <strong className="block text-sm">{title(group)}</strong>
                      <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                        {value(affiliation.rank, t("Miembro"))}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {scenes.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("Escenas")}
            </h3>
            <div className="space-y-2">
              {scenes.map((scene, index) => (
                <button
                  key={String(scene.scene_id ?? index)}
                  className="block w-full rounded-xl border border-neutral-200 p-3 text-left dark:border-neutral-800"
                  onClick={() =>
                    onOpenRecord?.("world-scenes", String(scene.scene_id))
                  }
                >
                  <strong className="block text-sm">{title(scene)}</strong>
                  <span className="text-[10px] text-neutral-500">
                    {value(scene.summary, "")}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      {secrets.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Secretos conocidos")}
          </h3>
          <div className="space-y-2">
            {secrets.map((secret, index) => (
              <article
                key={String(secret.secret_id ?? index)}
                className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-900 dark:bg-amber-950/10"
              >
                <strong className="text-sm">{title(secret)}</strong>
                <p className="mt-1 text-xs text-neutral-500">
                  {value(secret.content ?? secret.notes, "")}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function WorldPlaceDetail({
  detail,
  spaceId,
  onOpenRecord,
}: {
  detail: JsonRecord;
  spaceId: string;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  const place = jsonObject(detail.place);
  const profile = jsonObject(detail.profile);
  const parent = jsonObject(detail.parent);
  const children = Array.isArray(detail.children)
    ? (detail.children as JsonRecord[])
    : [];
  const persons = Array.isArray(detail.persons)
    ? (detail.persons as JsonRecord[])
    : [];
  const events = Array.isArray(detail.events)
    ? (detail.events as JsonRecord[])
    : [];
  const images = Array.isArray(detail.images)
    ? (detail.images as JsonRecord[])
    : [];
  const cover = images[0];
  const asset = cover ? jsonObject(cover.asset) : {};
  const hash = String(asset.hash ?? asset.thumbHash ?? "");
  return (
    <article className="space-y-5" data-testid="place-sheet">
      {hash && (
        <img
          src={api.assetUrl(spaceId, hash)}
          alt=""
          className="max-h-72 w-full rounded-xl border border-neutral-200 object-cover dark:border-neutral-800"
        />
      )}
      <header>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Icon name="mapPin" size={14} />
          <span>
            {value(place.kind, "Lugar")}
            {parent.name ? ` · ${value(parent.name)}` : ""}
          </span>
        </div>
        <h2 className="mt-2 text-2xl font-semibold">{title(place)}</h2>
      </header>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            {t("Apariencia")}
          </h3>
          <div className="mt-2 text-sm leading-6">
            <MarkdownReader
              value={value(profile.appearance, t("No documentada."))}
            />
          </div>
        </section>
        <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            {t("Atmósfera")}
          </h3>
          <div className="mt-2 text-sm leading-6">
            <MarkdownReader
              value={value(profile.atmosphere, t("No documentada."))}
            />
          </div>
        </section>
        <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            {t("Historia")}
          </h3>
          <div className="mt-2 text-sm leading-6">
            <MarkdownReader
              value={value(
                profile.history ?? place.notes,
                t("No documentada."),
              )}
            />
          </div>
        </section>
      </div>
      {children.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Lugares contenidos")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {children.map((child, index) => (
              <button
                key={String(child.place_id ?? index)}
                className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs hover:border-indigo-300 dark:border-neutral-800"
                onClick={() => onOpenRecord?.("places", String(child.place_id))}
              >
                {title(child)}
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {persons.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("Habitantes y personas vinculadas")}
            </h3>
            <div className="space-y-2">
              {persons.map((person, index) => (
                <button
                  key={String(person.person_id ?? index)}
                  className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 p-3 text-left hover:border-indigo-300 dark:border-neutral-800"
                  onClick={() =>
                    onOpenRecord?.("persons", String(person.person_id))
                  }
                >
                  <Icon name="user" size={14} className="text-indigo-500" />
                  <strong className="text-sm">{title(person)}</strong>
                  <Icon
                    name="chevronRight"
                    size={12}
                    className="ml-auto text-neutral-400"
                  />
                </button>
              ))}
            </div>
          </section>
        )}
        {events.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("Acontecimientos")}
            </h3>
            <div className="space-y-2">
              {events.map((event, index) => (
                <button
                  key={String(event.event_id ?? index)}
                  className="block w-full rounded-xl border border-neutral-200 p-3 text-left text-xs dark:border-neutral-800"
                  onClick={() =>
                    onOpenRecord?.("events", String(event.event_id))
                  }
                >
                  <strong>{title(event)}</strong>
                  <span className="ml-2 text-neutral-500">
                    {value(event.date ?? event.start_date, "")}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </article>
  );
}

function WorldGroupDetail({
  detail,
  spaceId,
  onOpenRecord,
}: {
  detail: JsonRecord;
  spaceId: string;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  const group = jsonObject(detail.group);
  const seat = jsonObject(detail.seat) as JsonRecord & {
    name?: string;
    place_id?: string;
  };
  const members = Array.isArray(detail.members)
    ? (detail.members as JsonRecord[])
    : [];
  const affiliations = Array.isArray(detail.affiliations)
    ? (detail.affiliations as JsonRecord[])
    : [];
  const images = Array.isArray(detail.images)
    ? (detail.images as JsonRecord[])
    : [];
  const coverAsset = images[0]
    ? jsonObject((images[0] as JsonRecord).asset)
    : {};
  const hash = String(coverAsset.hash ?? coverAsset.thumbHash ?? "");
  const affiliationByPerson = new Map(
    affiliations.map((entry) => [String(entry.person_id), entry]),
  );
  return (
    <article className="space-y-5" data-testid="world-group-sheet">
      {hash && (
        <img
          src={api.assetUrl(spaceId, hash)}
          alt=""
          className="max-h-72 w-full rounded-xl border border-neutral-200 object-cover dark:border-neutral-800"
        />
      )}
      <header>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
          {value(group.kind, t("Grupo"))} ·{" "}
          {value(group.status, t("Sin estado"))}
        </span>
        <h2 className="mt-2 text-2xl font-semibold">{title(group)}</h2>
        {seat.name && (
          <button
            className="mt-1 text-xs text-indigo-600 hover:underline dark:text-indigo-300"
            onClick={() => onOpenRecord?.("places", String(seat.place_id))}
          >
            <Icon name="mapPin" size={12} className="mr-1 inline" />
            {value(seat.name)}
          </button>
        )}
      </header>
      <section className="rounded-xl border border-neutral-200 bg-white p-5 text-sm leading-6 dark:border-neutral-800 dark:bg-neutral-900">
        <MarkdownReader
          value={value(
            group.description ?? group.summary,
            t("No hay descripción publicada."),
          )}
        />
      </section>
      {members.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Miembros")}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {members.map((person, index) => {
              const affiliation = affiliationByPerson.get(
                String(person.person_id),
              );
              return (
                <button
                  key={String(person.person_id ?? index)}
                  className="flex items-center gap-3 rounded-xl border border-neutral-200 p-3 text-left hover:border-indigo-300 dark:border-neutral-800"
                  onClick={() =>
                    onOpenRecord?.("persons", String(person.person_id))
                  }
                >
                  <Icon name="user" size={14} className="text-indigo-500" />
                  <span>
                    <strong className="block text-sm">{title(person)}</strong>
                    <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                      {value(affiliation?.rank, t("Miembro"))}
                    </span>
                  </span>
                  <Icon
                    name="chevronRight"
                    size={12}
                    className="ml-auto text-neutral-400"
                  />
                </button>
              );
            })}
          </div>
        </section>
      )}
    </article>
  );
}

function SpecializedCatalog({
  variant,
  rows,
  spaceId,
  descriptor,
  persons = [],
  board,
  onOpen,
  onOpenPerson,
}: {
  variant: NonNullable<Descriptor["variant"]>;
  rows: JsonRecord[];
  spaceId: string;
  descriptor: Descriptor;
  persons?: JsonRecord[];
  board?: unknown;
  onOpen: (row: JsonRecord, index: number) => void;
  onOpenPerson?: (person: JsonRecord) => void;
}) {
  if (variant === "characters")
    return <CharacterCatalog rows={rows} spaceId={spaceId} onOpen={onOpen} />;
  if (variant === "place-tree")
    return <PlaceTreeCatalog rows={rows} onOpen={onOpen} />;
  if (variant === "world-groups")
    return <WorldGroupCatalog rows={rows} onOpen={onOpen} />;
  if (variant === "encyclopedia")
    return <EncyclopediaCatalog rows={rows} onOpen={onOpen} />;
  if (variant === "timeline")
    return (
      <TimelineCatalog rows={rows} descriptor={descriptor} onOpen={onOpen} />
    );
  if (variant === "tree")
    return (
      <PublishedTreeCatalog
        rows={rows}
        persons={persons}
        spaceId={spaceId}
        onOpenPerson={onOpenPerson}
      />
    );
  if (variant === "map")
    return (
      <MapCatalog
        rows={rows}
        spaceId={spaceId}
        descriptor={descriptor}
        onOpen={onOpen}
      />
    );
  if (variant === "calendar")
    return (
      <CalendarCatalog
        rows={rows}
        spaceId={spaceId}
        descriptor={descriptor}
        onOpen={onOpen}
      />
    );
  if (variant === "agenda")
    return (
      <AgendaCatalog rows={rows} descriptor={descriptor} onOpen={onOpen} />
    );
  if (variant === "schedule")
    return (
      <ScheduleCatalog rows={rows} descriptor={descriptor} onOpen={onOpen} />
    );
  if (variant === "study-network")
    return (
      <StudyNetworkCatalog
        rows={rows}
        descriptor={descriptor}
        onOpen={onOpen}
      />
    );
  if (variant === "study-review")
    return (
      <StudyReviewCatalog rows={rows} descriptor={descriptor} onOpen={onOpen} />
    );
  if (variant === "network")
    return (
      <NetworkCatalog rows={rows} descriptor={descriptor} onOpen={onOpen} />
    );
  if (variant === "analysis")
    return (
      <AnalysisCatalog rows={rows} descriptor={descriptor} onOpen={onOpen} />
    );
  if (variant === "conflict-board")
    return (
      <ConflictBoardCatalog
        rows={rows}
        descriptor={descriptor}
        board={board}
        onOpen={onOpen}
      />
    );
  if (variant === "continuity")
    return <ContinuityCatalog rows={rows} descriptor={descriptor} />;
  if (variant === "world-rules")
    return (
      <WorldRulesCatalog rows={rows} descriptor={descriptor} onOpen={onOpen} />
    );
  if (variant === "world-questions")
    return (
      <WorldQuestionsCatalog
        rows={rows}
        descriptor={descriptor}
        onOpen={onOpen}
      />
    );
  if (variant === "manuscript")
    return (
      <ManuscriptCatalogRich
        rows={rows}
        descriptor={descriptor}
        onOpen={onOpen}
      />
    );
  if (variant === "exam") return <ExamCatalog rows={rows} onOpen={onOpen} />;
  if (variant === "rubric")
    return <RubricCatalog rows={rows} onOpen={onOpen} />;
  if (variant === "question-bank")
    return (
      <StudyQuestionCatalog
        rows={rows}
        descriptor={descriptor}
        onOpen={onOpen}
      />
    );
  if (variant === "testimony-interviews")
    return (
      <TestimonyInterviewCatalog
        rows={rows}
        descriptor={descriptor}
        onOpen={onOpen}
      />
    );
  if (variant === "testimony-codes")
    return (
      <TestimonyCodeCatalog
        rows={rows}
        descriptor={descriptor}
        onOpen={onOpen}
      />
    );
  if (variant === "testimony-contrasts")
    return (
      <TestimonyContrastCatalog
        rows={rows}
        descriptor={descriptor}
        onOpen={onOpen}
      />
    );
  if (variant === "gallery")
    return descriptor.collection === "world-scenes" ? (
      <NarrativeSceneCatalog
        rows={rows}
        descriptor={descriptor}
        onOpen={onOpen}
      />
    ) : (
      <GalleryCatalog rows={rows} descriptor={descriptor} onOpen={onOpen} />
    );
  return <DataTable rows={rows} columns={descriptor.columns} onOpen={onOpen} />;
}

// Kept as a compatibility renderer for older deep links; current routes use the richer reader.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DatabaseDetail({
  detail,
  descriptor,
  onOpen,
}: {
  detail: JsonRecord;
  descriptor: Descriptor;
  onOpen: (collection: string, id: string) => void;
}) {
  const database = (
    detail.database && typeof detail.database === "object"
      ? detail.database
      : detail
  ) as JsonRecord;
  const columns = Array.isArray(detail.columns)
    ? (detail.columns as JsonRecord[])
    : [];
  const rows = Array.isArray(detail.rows) ? (detail.rows as JsonRecord[]) : [];
  const cells = Array.isArray(detail.cells)
    ? (detail.cells as JsonRecord[])
    : [];
  const cellMap = new Map(
    cells.map((cell) => [`${cell.row_id}:${cell.column_id}`, cell.value]),
  );
  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold">{title(database)}</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {value(database.description, descriptor.description)}
        </p>
      </header>
      <div className="overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
              {columns.map((column) => (
                <th
                  key={String(column.id)}
                  className="whitespace-nowrap px-3 py-3"
                >
                  {value(column.name ?? column.label, "Columna")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={rowId(row, index)}
                className="border-b border-neutral-100 dark:border-neutral-900"
              >
                {columns.map((column) => (
                  <td
                    key={String(column.id)}
                    className="max-w-64 truncate px-3 py-3 text-neutral-600 dark:text-neutral-400"
                  >
                    {value(
                      cellMap.get(`${row.id}:${column.id}`) ??
                        row[String(column.id)],
                      "—",
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <NestedTable
        label="Vistas"
        value={detail.views}
        onOpen={(row) => {
          const id = rowId(row);
          if (id) onOpen("databases", id);
        }}
      />
    </div>
  );
}

/** Published database reader. The Desktop database has private editing controls;
 * the server keeps the same grid/read context and only renders snapshot-safe values
 * plus image assets whose hashes were explicitly published. */
function DatabaseDetailRich({
  detail,
  descriptor,
  spaceId,
}: {
  detail: JsonRecord;
  descriptor: Descriptor;
  spaceId: string;
}) {
  const database = jsonObject(detail.database ?? detail);
  const columns = Array.isArray(detail.columns)
    ? detail.columns.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const rows = Array.isArray(detail.rows)
    ? detail.rows.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const cells = Array.isArray(detail.cells)
    ? detail.cells.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const relations = Array.isArray(detail.relations)
    ? detail.relations.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const options = Array.isArray(detail.options)
    ? detail.options.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const attachments = Array.isArray(detail.attachments)
    ? detail.attachments.filter((entry): entry is JsonRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
    : [];
  const cellMap = new Map(
    cells.map((cell) => [
      `${cell.row_id}:${cell.column_id}`,
      cell.value ??
        cell.value_text ??
        cell.raw_value ??
        cell.display_value ??
        cell.value_json,
    ]),
  );
  const relationMap = new Map<string, string[]>();
  relations.forEach((relation) => {
    const key = `${relation.row_id}:${relation.column_id}`;
    relationMap.set(
      key,
      [
        ...(relationMap.get(key) ?? []),
        String(
          relation.last_known_label ??
            relation.target_label ??
            relation.target_id ??
            "",
        ),
      ].filter(Boolean),
    );
  });
  const optionMap = new Map(
    options.map((option) => [
      `${option.column_id}:${option.id}`,
      option.label ?? option.name,
    ]),
  );
  const attachmentsByCell = new Map<string, JsonRecord[]>();
  attachments.forEach((attachment) => {
    const key = `${attachment.row_id}:${attachment.column_id}`;
    attachmentsByCell.set(key, [
      ...(attachmentsByCell.get(key) ?? []),
      attachment,
    ]);
  });
  const rowValue = (row: JsonRecord, column: JsonRecord) => {
    const key = `${row.id}:${column.id}`;
    const related = relationMap.get(key);
    if (related?.length) return related.join(", ");
    const raw =
      cellMap.get(key) ??
      row[String(column.id)] ??
      row[String(column.key ?? "")];
    return optionMap.get(`${column.id}:${String(raw)}`) ?? raw;
  };
  return (
    <article className="space-y-5" data-testid="database-reader">
      <header>
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
            <Icon name="table" size={17} />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
              {t("Base de datos publicada")}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{title(database)}</h2>
          </div>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          {value(database.description, descriptor.description)} · {rows.length}
          {detail.total != null ? ` de ${value(detail.total)}` : ""}{" "}
          {t("registros")}
        </p>
      </header>
      <div className="overflow-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/35">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
              {columns.map((column, index) => (
                <th
                  key={String(column.id ?? index)}
                  className="min-w-40 whitespace-nowrap px-4 py-3"
                >
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    {value(column.name ?? column.label, t("Columna"))}
                  </span>
                  {Boolean(column.type) && (
                    <span className="mt-1 block text-[10px] font-normal normal-case text-neutral-400">
                      {value(column.type)}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, rowIndex) => (
                <tr
                  key={rowId(row, rowIndex)}
                  className="border-b border-neutral-100 align-top dark:border-neutral-900"
                >
                  {columns.map((column, columnIndex) => {
                    const key = `${row.id}:${column.id}`;
                    const rowAttachments = attachmentsByCell.get(key) ?? [];
                    const raw = rowValue(row, column);
                    return (
                      <td
                        key={String(column.id ?? columnIndex)}
                        className="max-w-72 px-4 py-3 text-neutral-700 dark:text-neutral-300"
                      >
                        {rowAttachments.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {rowAttachments.map(
                              (attachment, attachmentIndex) => {
                                const hash = String(
                                  attachment.thumbHash ?? attachment.hash ?? "",
                                );
                                return (
                                  <figure
                                    key={String(
                                      attachment.id ??
                                        attachment.attachment_id ??
                                        attachmentIndex,
                                    )}
                                    className="w-20 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800"
                                  >
                                    {hash ? (
                                      <img
                                        src={api.assetUrl(spaceId, hash)}
                                        alt=""
                                        className="h-14 w-full object-cover"
                                      />
                                    ) : (
                                      <div className="grid h-14 place-items-center bg-neutral-100 text-[10px] text-neutral-500 dark:bg-neutral-950">
                                        {t("Adjunto")}
                                      </div>
                                    )}
                                    <figcaption className="truncate px-1.5 py-1 text-[10px] text-neutral-500">
                                      {value(
                                        attachment.file_name ?? attachment.name,
                                        t("Imagen publicada"),
                                      )}
                                    </figcaption>
                                  </figure>
                                );
                              },
                            )}
                          </div>
                        ) : (
                          <span className="whitespace-pre-wrap">
                            {value(raw, "—")}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={Math.max(1, columns.length)}
                  className="px-4 py-10 text-center text-sm text-neutral-500"
                >
                  {t("No hay registros publicados.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {Boolean(detail.hasMore) && (
        <p className="rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-800">
          {t(
            "Hay más registros publicados. Usa la paginación de la vista para continuar.",
          )}
        </p>
      )}
      <NestedTable label="Vistas publicadas" value={detail.views} />
    </article>
  );
}

function Detail({
  descriptor,
  detail,
  spaceId,
  onOpenRecord,
}: {
  descriptor: Descriptor;
  detail: JsonRecord;
  spaceId: string;
  onOpenRecord?: (collection: string, id: string) => void;
}) {
  if (
    detail.person &&
    typeof detail.person === "object" &&
    Object.hasOwn(detail.person, "life_status")
  )
    return (
      <WorldCharacterDetail
        detail={detail}
        spaceId={spaceId}
        onOpenRecord={onOpenRecord}
      />
    );
  if (detail.person && typeof detail.person === "object")
    return (
      <PersonDetail
        detail={detail}
        spaceId={spaceId}
        onOpenRecord={onOpenRecord}
      />
    );
  if (
    descriptor.collection === "places" &&
    detail.place &&
    typeof detail.place === "object"
  )
    return (
      <WorldPlaceDetail
        detail={detail}
        spaceId={spaceId}
        onOpenRecord={onOpenRecord}
      />
    );
  if (descriptor.collection === "world-groups")
    return (
      <WorldGroupDetail
        detail={detail}
        spaceId={spaceId}
        onOpenRecord={onOpenRecord}
      />
    );
  if (descriptor.collection === "databases")
    return (
      <DatabaseDetailRich
        detail={detail}
        descriptor={descriptor}
        spaceId={spaceId}
      />
    );
  if (descriptor.collection === "database-pages")
    return <DatabasePageDetail detail={detail} />;
  if (descriptor.collection === "study-materials")
    return <StudyMaterialDetail detail={detail} />;
  if (descriptor.collection === "study-questions")
    return <StudyQuestionDetail detail={detail} />;
  if (descriptor.collection === "study-review")
    return <StudyReviewDetail detail={detail as LooseJsonRecord} />;
  if (descriptor.collection === "teaching-exams")
    return <ExamDetail detail={detail} />;
  if (descriptor.collection === "teaching-rubrics")
    return <RubricDetail detail={detail} />;
  if (descriptor.collection === "archive-items")
    return (
      <ArchiveItemDetailRich detail={detail} onOpenRecord={onOpenRecord} />
    );
  if (descriptor.collection === "archive-repositories")
    return (
      <PublishedArchiveRepositoryDetail
        detail={detail}
        onOpenRecord={onOpenRecord}
      />
    );
  if (descriptor.collection === "archive-units")
    return (
      <PublishedArchiveUnitDetail detail={detail} onOpenRecord={onOpenRecord} />
    );
  if (descriptor.collection === "archive-excerpts")
    return (
      <PublishedArchiveExcerptDetail
        detail={detail}
        onOpenRecord={onOpenRecord}
      />
    );
  if (descriptor.collection === "source-analyses")
    return (
      <PublishedSourceAnalysisDetail
        detail={detail}
        onOpenRecord={onOpenRecord}
      />
    );
  if (descriptor.collection === "testimony-interviews")
    return (
      <TestimonyInterviewDetail detail={detail} onOpenRecord={onOpenRecord} />
    );
  if (descriptor.collection === "testimony-contrasts")
    return <TestimonyContrastDetail detail={detail} />;
  if (descriptor.collection === "testimony-transcripts")
    return <TestimonyTranscriptDetail detail={detail} />;
  if (descriptor.collection === "testimony-codes")
    return <PublishedTestimonyCodeDetail detail={detail} />;
  if (descriptor.collection === "world-maps")
    return (
      <WorldMapDetailLeaflet
        detail={detail}
        spaceId={spaceId}
        onOpenRecord={onOpenRecord}
      />
    );
  if (descriptor.collection === "world-entries")
    return <EncyclopediaDetail detail={detail} onOpenRecord={onOpenRecord} />;
  if (descriptor.collection === "world-scenes")
    return (
      <SceneDetail
        detail={detail}
        spaceId={spaceId}
        onOpenRecord={onOpenRecord}
      />
    );
  const primaryKey =
    descriptor.collection === "persons"
      ? "person"
      : descriptor.collection === "teaching-exams"
        ? "exam"
        : descriptor.collection === "study-plans"
          ? "plan"
          : descriptor.collection.replace(/s$/, "").replace(/^world-/, "");
  const primary = (
    detail[primaryKey] && typeof detail[primaryKey] === "object"
      ? detail[primaryKey]
      : Object.values(detail).find(
          (entry) =>
            entry && typeof entry === "object" && !Array.isArray(entry),
        )
  ) as JsonRecord | undefined;
  const entries = primary || detail;
  const related = Object.entries(detail).filter(
    ([key, nested]) => key !== primaryKey && Array.isArray(nested),
  );
  const scalar = Object.entries(entries).filter(
    ([, item]) => item != null && typeof item !== "object",
  );
  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold">{title(entries)}</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {value(
            entries.description ?? entries.summary,
            descriptor.description,
          )}
        </p>
      </header>
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800">
        <dl className="grid grid-cols-[minmax(130px,.35fr)_minmax(0,.65fr)]">
          {scalar.map(([key, item]) => (
            <div key={key} className="contents">
              <dt className="border-b border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50">
                {key.replace(/_/g, " ")}
              </dt>
              <dd className="border-b border-neutral-200 px-3 py-2.5 text-xs text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
                {value(item)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="space-y-5">
        {related.map(([key, nested]) => {
          const collection = nestedCollection(descriptor.collection, key);
          return (
            <NestedTable
              key={key}
              label={key.replace(/_/g, " ")}
              value={nested}
              onOpen={
                collection && onOpenRecord
                  ? (row) => {
                      const id = rowId(row);
                      if (id) onOpenRecord(collection, id);
                    }
                  : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}

/** Desktop-like table/detail workspace shared by every non-academic vault family. */
export function VaultSurfaceView({
  spaceId,
  surface,
  vaultType,
  view,
  initialId,
  initialCollection,
  onOrigin,
  onOpenRecord,
}: VaultSurfaceProps) {
  const baseDescriptor = VAULT_SURFACES[surface];
  const publicProsopography =
    vaultType === "prosopography"
      ? PROSOPOGRAPHY_PUBLIC_COLLECTIONS[surface]
      : undefined;
  const groupView =
    surface === "world-groups" && view ? WORLD_GROUP_VIEWS[view] : undefined;
  const [aggregateAvailable, setAggregateAvailable] = useState(false);
  const descriptor = useMemo(() => {
    if (publicProsopography && aggregateAvailable)
      return {
        ...baseDescriptor,
        collection: publicProsopography.collection,
        label: publicProsopography.label,
        description: publicProsopography.description,
        columns: publicProsopography.columns,
        variant: publicProsopography.variant,
        published: true,
      };
    if (groupView)
      return {
        ...baseDescriptor,
        label: groupView.label,
        icon: groupView.icon,
        variant: "world-groups" as const,
      };
    if (view === "characters")
      return {
        ...baseDescriptor,
        label: "Personajes",
        icon: "users",
        description: "Elenco publicado del mundo.",
        variant: "characters" as const,
      };
    if (view === "places")
      return {
        ...baseDescriptor,
        label: "Lugares",
        icon: "map",
        description: "Jerarquía publicada de lugares del mundo.",
        variant: "place-tree" as const,
      };
    if (view === "encyclopedia")
      return {
        ...baseDescriptor,
        label: "Enciclopedia",
        icon: "book",
        description: "Índice alfabético del mundo publicado.",
        variant: "encyclopedia" as const,
      };
    // A shared data surface must still speak the exact vocabulary of the route that
    // opened it. Desktop labels these workbenches by purpose, not by their backing table.
    // Genealogy and worldbuilding intentionally use different labels for the same
    // published events/relationships collections.
    if (view === "timeline")
      return {
        ...baseDescriptor,
        label: vaultType === "worldbuilding" ? "Cronología" : "Línea temporal",
      };
    if (view === "map") return { ...baseDescriptor, label: "Mapa" };
    if (view === "relations")
      return {
        ...baseDescriptor,
        label:
          vaultType === "worldbuilding" ? "Relaciones" : "Relaciones sociales",
      };
    if (view === "tree")
      return {
        ...baseDescriptor,
        label: vaultType === "genealogy" ? "Árbol genealógico" : "Familias",
      };
    if (view === "conflicts") return { ...baseDescriptor, label: "Conflictos" };
    if (view === "arcs")
      return { ...baseDescriptor, label: "Arcos narrativos" };
    // Recordings share the study-material metadata projection, but keep the
    // Desktop route's own title so two visible sections do not collapse into a
    // generic "Materiales" tab. Audio bytes remain private.
    if (view === "studyRecordings")
      return {
        ...baseDescriptor,
        label: "Grabaciones",
        icon: "microphone",
        description:
          "Grabaciones disponibles como metadatos; el audio no se publica.",
      };
    return baseDescriptor;
  }, [
    aggregateAvailable,
    baseDescriptor,
    groupView,
    publicProsopography,
    vaultType,
    view,
  ]);
  // Keep the server catalogue in the same locale as the shell.  Values from the
  // published snapshot are never translated; only the schema's UI vocabulary is.
  const localizedDescriptor = useMemo(
    () => ({
      ...descriptor,
      label: t(descriptor.label),
      description: t(descriptor.description),
      privateNotice: descriptor.privateNotice
        ? t(descriptor.privateNotice)
        : descriptor.privateNotice,
      // Keep schema labels in their source language until the renderer sees
      // them. Passing already-localized labels here would make DataTable's
      // t() lookup miss every non-English locale on the second pass.
      columns: descriptor.columns,
      related: descriptor.related,
    }),
    [descriptor],
  );
  // A dossier opened from a related record keeps the parent view in the URL,
  // but its collection (and therefore its tab icon/label) is the nested one.
  // Resolve that presentation independently from the catalogue descriptor.
  const detailDescriptor = useMemo(() => {
    if (!initialCollection) return descriptor;
    const nested = Object.values(VAULT_SURFACES).find(
      (candidate) => candidate.collection === initialCollection,
    );
    return nested
      ? { ...nested }
      : { ...descriptor, collection: initialCollection };
  }, [descriptor, initialCollection]);
  const [page, setPage] = useState<PageResponse>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [openTabs, setOpenTabs] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [activeId, setActiveId] = useState<string | null>(initialId || null);
  const [detail, setDetail] = useState<JsonRecord>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [treePersons, setTreePersons] = useState<JsonRecord[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    if (descriptor.published === false && !publicProsopography) {
      setPage({ items: [], total: 0 });
      setLoading(false);
      return;
    }
    try {
      const params: Record<string, string> = { limit: "200" };
      if (query.trim()) params.q = query.trim();
      // The Desktop workbenches share a backing table, but their projections are
      // intentionally different: arcs, conflicts and continuity must not render
      // each other's rows or silently fall back to a generic list.
      if (surface === "world-analysis") {
        params.kind = "conflict";
        params.surface = "conflicts";
      } else if (surface === "world-continuity") params.surface = "continuity";
      else if (surface === "world-threads") params.kind = "arc";
      const next = await api.collection(
        spaceId,
        publicProsopography && !aggregateAvailable
          ? publicProsopography.collection
          : descriptor.collection,
        params,
      );
      if (publicProsopography && !aggregateAvailable) {
        if ((next.total ?? 0) > 0) setAggregateAvailable(true);
        else setPage({ items: [], total: 0 });
      } else setPage(next);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [
    aggregateAvailable,
    descriptor.collection,
    publicProsopography,
    query,
    spaceId,
    surface,
  ]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);
  useEffect(() => {
    if (surface !== "genealogy-tree") {
      setTreePersons([]);
      return;
    }
    let alive = true;
    api
      .collection(spaceId, "persons", { limit: "200" })
      .then((response) => {
        if (alive) setTreePersons(pageRows(response, VAULT_SURFACES.persons));
      })
      .catch(() => {
        if (alive) setTreePersons([]);
      });
    return () => {
      alive = false;
    };
  }, [spaceId, surface]);
  useEffect(() => {
    if (!activeId || descriptor.published === false) {
      setDetail(undefined);
      setDetailLoading(false);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    setError(undefined);
    api
      .detail(spaceId, initialCollection || descriptor.collection, activeId)
      .then((next) => {
        if (alive) setDetail(next);
      })
      .catch((cause) => {
        if (alive) setError(cause);
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeId, descriptor.collection, initialCollection, spaceId]);
  useEffect(() => {
    if (!activeId || !detail) return;
    const label = detailTitle(detail, localizedDescriptor.label);
    setOpenTabs((tabs) => {
      const existing = tabs.find((tab) => tab.id === activeId);
      if (existing?.label === label) return tabs;
      if (existing)
        return tabs.map((tab) =>
          tab.id === activeId ? { ...tab, label } : tab,
        );
      return [...tabs, { id: activeId, label }];
    });
  }, [activeId, detail, detailDescriptor.label]);
  const rows =
    descriptor.published === false
      ? []
      : pageRows(page, descriptor).filter(
          (row) => !groupView || groupView.kinds.includes(String(row.kind)),
        );
  const visibleRows = useMemo(
    () =>
      query.trim()
        ? rows.filter((row) =>
            Object.values(row).some(
              (item) =>
                typeof item !== "object" &&
                value(item, "")
                  .toLocaleLowerCase()
                  .includes(query.trim().toLocaleLowerCase()),
            ),
          )
        : rows,
    [query, rows],
  );
  const open = (row: JsonRecord, index: number) => {
    // Encyclopedia rows are a projection across several tables. Their native ids
    // are only unique inside each source table, so the published detail contract
    // addresses them by `kind:id` (the `key` returned by the API).
    const id = rowIdForCollection(descriptor.collection, row, index);
    const label = title(row);
    setOpenTabs((tabs) =>
      tabs.some((tab) => tab.id === id) ? tabs : [...tabs, { id, label }],
    );
    setActiveId(id);
    onOpenRecord?.(descriptor.collection, id);
  };
  const close = (id: string) => {
    setOpenTabs((tabs) => tabs.filter((tab) => tab.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setDetail(undefined);
    }
  };
  const showCatalog = () => {
    setActiveId(null);
    setDetail(undefined);
    onOrigin?.();
  };
  if (!descriptor) return null;
  const privateSurface = descriptor.published === false;
  const treeHasRows = surface === "genealogy-tree" && treePersons.length > 0;
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid={`vault-surface-${surface}`}
    >
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--vault-accent,#6366f1)_15%,transparent)] text-[var(--vault-accent,#818cf8)]">
            <Icon name={descriptor.icon} size={18} />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-semibold">
              {localizedDescriptor.label}
            </h1>
            <p className="text-[11px] text-neutral-500">
              {privateSurface
                ? t("Datos privados; no se muestran en el servidor")
                : `${groupView ? rows.length : (page?.total ?? rows.length)} ${t("registros publicados")}`}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 items-end gap-1 overflow-x-auto">
          <button
            className={`flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs ${!activeId ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900" : "border-transparent text-neutral-500"}`}
            onClick={showCatalog}
          >
            <Icon name="table" size={13} />
            {localizedDescriptor.label}
          </button>
          {openTabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex h-9 shrink-0 items-center rounded-t-lg border border-b-0 ${activeId === tab.id ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900" : "border-transparent text-neutral-500"}`}
            >
              <button
                className="flex h-full max-w-64 items-center gap-2 px-3 text-xs"
                onClick={() => setActiveId(tab.id)}
              >
                <Icon name={detailDescriptor.icon} size={13} />
                <span className="truncate">{tab.label}</span>
              </button>
              <button
                className="mr-1 grid h-6 w-6 items-center justify-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-800"
                aria-label={`${t("Cerrar")} ${tab.label}`}
                onClick={() => close(tab.id)}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
      </header>
      {privateSurface ? (
        <PrivateSurface
          label={localizedDescriptor.label}
          notice={localizedDescriptor.privateNotice}
        />
      ) : activeId ? (
        <main className="min-h-0 flex-1 overflow-auto p-5">
          <div className="mx-auto max-w-7xl">
            {detailLoading ? (
              <Loading />
            ) : error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {t("No se ha podido cargar el registro.")}
              </p>
            ) : detail ? (
              <Detail
                descriptor={{
                  ...detailDescriptor,
                  label: t(detailDescriptor.label),
                  description: t(detailDescriptor.description),
                }}
                detail={detail}
                spaceId={spaceId}
                onOpenRecord={onOpenRecord}
              />
            ) : null}
          </div>
        </main>
      ) : (
        <>
          <div className="shrink-0 border-b border-neutral-200 p-3 dark:border-neutral-800">
            <div className="relative">
              <Icon
                name="search"
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
              />
              <input
                className="input input-with-leading-icon w-full"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`${t("Buscar en")} ${localizedDescriptor.label.toLocaleLowerCase(getActiveLang())}…`}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {error ? (
              <p className="m-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {t("No se ha podido cargar esta vista.")}
              </p>
            ) : loading ? (
              <Loading />
            ) : visibleRows.length || treeHasRows ? (
              <SpecializedCatalog
                variant={descriptor.variant || "table"}
                rows={visibleRows}
                spaceId={spaceId}
                descriptor={localizedDescriptor}
                persons={treePersons}
                board={page?.board}
                onOpen={open}
                onOpenPerson={(person) => {
                  const id = rowId(person);
                  if (id) onOpenRecord?.("persons", id);
                }}
              />
            ) : (
              <SurfaceEmpty label={localizedDescriptor.label} />
            )}
          </div>
          <footer className="flex h-10 shrink-0 items-center border-t border-neutral-200 px-3 text-xs text-neutral-500">
            {visibleRows.length} /{" "}
            {groupView ? rows.length : (page?.total ?? rows.length)}
          </footer>
        </>
      )}
    </div>
  );
}

export default VaultSurfaceView;
