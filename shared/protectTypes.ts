/**
 * Nodus Protect — shared, serialisable contracts.
 *
 * The pixel engine lives in the renderer and the file/vault boundary lives in
 * Electron main.  Keeping this module free of DOM, Node and Electron imports
 * makes the context-bridge surface explicit and prevents arbitrary filesystem
 * access from creeping into the renderer.
 */

export const PROTECT_INPUT_EXTENSIONS = [
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif',
] as const;

export type ProtectInputExtension = (typeof PROTECT_INPUT_EXTENSIONS)[number];
export type ProtectSourceKind =
  | 'disk'
  | 'zotero-attachment'
  | 'archive-item'
  | 'study-material'
  | 'database-attachment'
  | 'protect-copy';

interface VaultProtectSourceRef {
  vaultId: string;
}

export type ProtectSourceRef =
  | { kind: 'disk'; path: string }
  | ({ kind: 'zotero-attachment'; attachmentKey: string; itemKey: string } & VaultProtectSourceRef)
  | ({ kind: 'archive-item'; itemId: string } & VaultProtectSourceRef)
  | ({ kind: 'study-material'; materialId: string } & VaultProtectSourceRef)
  | ({ kind: 'database-attachment'; attachmentId: string } & VaultProtectSourceRef)
  | ({ kind: 'protect-copy'; copyId: string } & VaultProtectSourceRef);

export interface ProtectSourceSummary {
  ref: ProtectSourceRef;
  name: string;
  title: string;
  mimeType: string;
  bytes: number;
  originLabel: string;
  available: boolean;
  unavailableReason: string | null;
}

export interface ProtectFilePayload {
  ref: ProtectSourceRef;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ProtectListSourcesRequest {
  query?: string;
  limit?: number;
}

export type ProtectArtifactFormat = 'png' | 'zip' | 'pdf' | 'csv';

export interface ProtectArtifact {
  fileName: string;
  mimeType: string;
  format: ProtectArtifactFormat;
  pageCount: number;
  bytes: Uint8Array;
  sourceKind?: ProtectSourceKind | 'mixed';
  sourceLabel?: string;
}

export interface ProtectArtifactWriteResult {
  canceled: boolean;
  path: string | null;
}

export interface ProtectShareResult {
  shared: boolean;
  canceled: boolean;
  fallbackRequired: boolean;
  message: string | null;
}

export interface ProtectVaultCopySummary {
  id: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  sourceKind: ProtectSourceKind | 'mixed' | null;
  sourceLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProtectIssuedCopy {
  copyId: string;
  label: string;
  keyed: 'open' | 'passphrase';
  format: 'image' | 'pdf';
  fileName: string;
  created: string;
}

export type ProtectWatermarkPattern =
  | 'dense'
  | 'topographic'
  | 'diagonal'
  | 'mesh'
  | 'grid'
  | 'single'
  | 'manual';

export interface ProtectManualWatermarkItem {
  text: string;
  x: number;
  y: number;
  angle: number;
}

export interface ProtectWatermark {
  enabled: boolean;
  text: string;
  pattern: ProtectWatermarkPattern;
  opacity: number;
  size: number;
  color: string;
  footer: boolean;
  manual: {
    items: ProtectManualWatermarkItem[];
    randomizePerPage: boolean;
  };
}

export interface ProtectExportFooter {
  euLink: boolean;
  nationalLink: boolean;
  nationalCountry: string;
  nationalCountryCustom: boolean;
  contactEmailEnabled: boolean;
  contactEmail: string;
  phoneEnabled: boolean;
  phone: string;
  messageEnabled: boolean;
  message: string;
  messageCustom: boolean;
}

export interface ProtectTraceOptions {
  enabled: boolean;
  label: string;
  passphrase: string;
}
