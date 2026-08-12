// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import type { LibraryItemMetadata } from './libraryTypes';

export interface BrowserConnectorAttachmentCandidate {
  url: string;
  title: string;
  fileName?: string;
  mimeType?: string;
  role?: 'original' | 'supplement' | 'snapshot' | 'image' | 'dataset' | 'other';
}

export interface BrowserConnectorCaptureRequest {
  pageUrl: string;
  metadataSource: 'highwire' | 'json-ld' | 'coins' | 'dublin-core' | 'open-graph' | 'direct-file' | 'generic';
  metadata: LibraryItemMetadata;
  collectionId?: string | null;
  tags?: string[];
  attachments?: BrowserConnectorAttachmentCandidate[];
  snapshotHtml?: string;
}

export interface BrowserConnectorPendingUpload extends BrowserConnectorAttachmentCandidate {
  reason: string;
}

export interface BrowserConnectorSaveResult {
  ok: true;
  itemId: string;
  title: string;
  attachmentCount: number;
  extractionStatus: string | null;
  warnings: string[];
  pendingUploads: BrowserConnectorPendingUpload[];
}
