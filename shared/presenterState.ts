// PDF Presenter — the runtime state shared by the audience window, the presenter
// window and (later) the mobile remote, plus a pure reducer over it. Electron-free
// so the transitions are unit-tested directly (scripts/test-presenter-state.mjs);
// the main process holds one instance as the canonical state and relays each
// applied action to the other windows.

export interface SlideZoom {
  /** 1 = no zoom; clamped to [1, 5]. */
  scale: number;
  /** Transform origin as a percentage of the slide box. */
  originX: number;
  originY: number;
}

/** The live annotation tools, shared by the presenter, audience and mobile remote. */
export type ToolName = 'flashlight' | 'draw' | 'pointer' | 'zoom';

export interface ToolSizes {
  flashlight: number;
  draw: number;
  pointer: number;
  zoom: number;
}

/** A live tool-overlay update. Coordinates are percentages of the slide box; the
 *  fields used depend on `tool` (draw uses `action`/`color`/`lineWidth`, the lens
 *  uses none beyond x/y, etc.). Streamed, never stored in the canonical state. */
export interface ToolData {
  tool: ToolName;
  x?: number;
  y?: number;
  /** Flashlight radius as a percentage. */
  r?: number;
  /** Pointer/zoom-lens diameter in px. */
  size?: number;
  action?: 'start' | 'move' | 'end' | 'clear';
  color?: string;
  lineWidth?: number;
}

export interface PresenterRuntimeState {
  presenting: boolean;
  pdfId: string | null;
  currentSlide: number;
  /** 0 until a window has loaded the PDF and reported its page count. */
  totalSlides: number;
  blackScreen: boolean;
  slideZoom: SlideZoom;
  timerSeconds: number;
  timerRunning: boolean;
  /** Active annotation tool, or null. */
  toolMode: ToolName | null;
  /** Draw colour. */
  toolColor: string;
  /** Per-tool size (flashlight/draw radius or width, pointer/zoom diameter). */
  toolSizes: ToolSizes;
  /** Magnifier zoom factor (1.5–3). */
  zoomFactor: number;
  /** Whether the current slide's YouTube overlay is playing. */
  videoPlaying: boolean;
}

export type PresenterAction =
  | { type: 'navigate'; slide: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'setTotal'; total: number }
  | { type: 'blackScreen'; enabled?: boolean }
  | { type: 'slideZoom'; data: SlideZoom }
  | { type: 'timerSync'; timerSeconds: number; timerRunning: boolean }
  | { type: 'timerToggle'; timerSeconds?: number }
  | { type: 'timerReset' }
  | { type: 'setTool'; tool: ToolName | null }
  | { type: 'setToolSize'; tool: ToolName; size: number }
  | { type: 'setToolColor'; color: string }
  | { type: 'setZoomFactor'; factor: number }
  | { type: 'videoToggle' }
  // Streamed updates — the reducer leaves state untouched; windows act on them.
  | { type: 'toolData'; data: ToolData }
  | { type: 'clearDraw' }
  | { type: 'videoSeek'; time: number };

export const NO_ZOOM: SlideZoom = { scale: 1, originX: 50, originY: 50 };
export const DEFAULT_TOOL_SIZES: ToolSizes = { flashlight: 15, draw: 4, pointer: 20, zoom: 200 };
export const DEFAULT_TOOL_COLOR = '#ef4444';

export function initialPresenterState(): PresenterRuntimeState {
  return {
    presenting: false,
    pdfId: null,
    currentSlide: 1,
    totalSlides: 0,
    blackScreen: false,
    slideZoom: { ...NO_ZOOM },
    timerSeconds: 0,
    timerRunning: false,
    toolMode: null,
    toolColor: DEFAULT_TOOL_COLOR,
    toolSizes: { ...DEFAULT_TOOL_SIZES },
    zoomFactor: 2,
    videoPlaying: false,
  };
}

/** Begin presenting a deck at a starting slide (clamped once the total is known). */
export function beginPresentation(pdfId: string, startSlide = 1, totalSlides = 0): PresenterRuntimeState {
  const base = initialPresenterState();
  return {
    ...base,
    presenting: true,
    pdfId,
    totalSlides,
    currentSlide: clampSlide(startSlide, totalSlides),
  };
}

function clampSlide(slide: number, total: number): number {
  const n = Number.isFinite(slide) ? Math.round(slide) : 1;
  const hi = total > 0 ? total : Number.MAX_SAFE_INTEGER;
  return Math.min(Math.max(n, 1), hi);
}

function clampZoom(z: SlideZoom): SlideZoom {
  const scale = Math.min(Math.max(z?.scale ?? 1, 1), 5);
  if (scale <= 1) return { ...NO_ZOOM };
  return {
    scale,
    originX: Math.min(Math.max(z.originX ?? 50, 0), 100),
    originY: Math.min(Math.max(z.originY ?? 50, 0), 100),
  };
}

export function presenterReducer(state: PresenterRuntimeState, action: PresenterAction): PresenterRuntimeState {
  switch (action.type) {
    case 'navigate': {
      const slide = clampSlide(action.slide, state.totalSlides);
      if (slide === state.currentSlide) return { ...state, slideZoom: { ...NO_ZOOM } };
      return { ...state, currentSlide: slide, slideZoom: { ...NO_ZOOM }, videoPlaying: false };
    }
    case 'next': {
      if (state.totalSlides > 0 && state.currentSlide >= state.totalSlides) return state;
      return { ...state, currentSlide: state.currentSlide + 1, slideZoom: { ...NO_ZOOM }, videoPlaying: false };
    }
    case 'prev': {
      if (state.currentSlide <= 1) return state;
      return { ...state, currentSlide: state.currentSlide - 1, slideZoom: { ...NO_ZOOM }, videoPlaying: false };
    }
    case 'setTotal': {
      const total = Math.max(0, Math.round(action.total) || 0);
      return { ...state, totalSlides: total, currentSlide: clampSlide(state.currentSlide, total) };
    }
    case 'blackScreen':
      return { ...state, blackScreen: action.enabled ?? !state.blackScreen };
    case 'slideZoom':
      return { ...state, slideZoom: clampZoom(action.data) };
    case 'timerSync':
      return { ...state, timerSeconds: Math.max(0, action.timerSeconds | 0), timerRunning: !!action.timerRunning };
    case 'timerToggle':
      return {
        ...state,
        timerSeconds: action.timerSeconds !== undefined ? Math.max(0, action.timerSeconds | 0) : state.timerSeconds,
        timerRunning: !state.timerRunning,
      };
    case 'timerReset':
      return { ...state, timerSeconds: 0 };
    case 'setTool':
      return { ...state, toolMode: action.tool };
    case 'setToolSize':
      return { ...state, toolSizes: { ...state.toolSizes, [action.tool]: Math.max(1, action.size | 0) } };
    case 'setToolColor':
      return { ...state, toolColor: action.color };
    case 'setZoomFactor':
      return { ...state, zoomFactor: Math.min(Math.max(action.factor, 1), 4) };
    case 'videoToggle':
      return { ...state, videoPlaying: !state.videoPlaying };
    case 'toolData':
    case 'clearDraw':
    case 'videoSeek':
      // Streamed to the windows for painting/seeking; no canonical state change.
      return state;
    default:
      return state;
  }
}
