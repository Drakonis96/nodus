import type {
  AppLanguage,
  ProtectExportFooter,
  ProtectIssuedCopy,
  ProtectSourceSummary,
  ProtectTraceOptions,
  ProtectWatermark,
} from '@shared/types';
import type { ProtectPage } from './editor';
import { defaultExportFooter, disposeProtectPages } from './engine';
import { defaultWatermark } from './watermark';

export type ProtectScreen = 'home' | 'source' | 'redact' | 'watermark' | 'result' | 'verify';

export interface ProtectSessionState {
  screen: ProtectScreen;
  sourceMode: 'protect' | 'verify';
  sources: ProtectSourceSummary[];
  pages: ProtectPage[];
  currentPage: number;
  watermarkPage: number;
  resultPage: number;
  baseName: string;
  hasPdf: boolean;
  grayscale: boolean;
  format: 'image' | 'pdf';
  watermark: ProtectWatermark;
  manualSelected: number;
  footer: ProtectExportFooter;
  trace: ProtectTraceOptions;
  issuedCopies: ProtectIssuedCopy[];
  verifySource: ProtectSourceSummary | null;
}

const issuedCopies: ProtectIssuedCopy[] = [];

let state: ProtectSessionState = {
  screen: 'home',
  sourceMode: 'protect',
  sources: [],
  pages: [],
  currentPage: 0,
  watermarkPage: 0,
  resultPage: 0,
  baseName: 'documento',
  hasPdf: false,
  grayscale: false,
  format: 'image',
  watermark: defaultWatermark(),
  manualSelected: 0,
  footer: defaultExportFooter('es', 'Válido únicamente a efectos de identificación en el trámite indicado. No constituye firma, autorización contractual ni consentimiento para usos distintos.'),
  trace: { enabled: false, label: '', passphrase: '' },
  issuedCopies,
  verifySource: null,
};

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export const protectSession = {
  get(): ProtectSessionState { return state; },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  patch(patch: Partial<ProtectSessionState>): void {
    state = { ...state, ...patch, issuedCopies };
    notify();
  },
  mutate(mutator: (draft: ProtectSessionState) => void): void {
    mutator(state);
    state = { ...state, issuedCopies };
    notify();
  },
  addIssued(copy: ProtectIssuedCopy): void {
    issuedCopies.push(copy);
    state = { ...state, issuedCopies };
    notify();
  },
  resetDocument(language: AppLanguage, defaultLegalMessage: string, screen: ProtectScreen = 'source'): void {
    disposeProtectPages(state.pages);
    state = {
      screen,
      sourceMode: state.sourceMode,
      sources: [],
      pages: [],
      currentPage: 0,
      watermarkPage: 0,
      resultPage: 0,
      baseName: 'documento',
      hasPdf: false,
      grayscale: false,
      format: 'image',
      watermark: defaultWatermark(),
      manualSelected: 0,
      footer: defaultExportFooter(language, defaultLegalMessage),
      trace: { enabled: false, label: '', passphrase: '' },
      issuedCopies,
      verifySource: null,
    };
    notify();
  },
};
