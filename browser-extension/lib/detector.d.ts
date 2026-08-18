// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Types for the shared page-metadata detector.
 *
 * detector.js is imported BY TWO CONSUMERS and deliberately not duplicated: the
 * Chrome extension loads it directly as an ES module, and the Nodus Browser page
 * preload imports the same file through the bundler. Porting it to TypeScript
 * would have meant maintaining two implementations of Highwire, JSON-LD, COinS,
 * Dublin Core and OpenGraph parsing that must agree exactly — so instead the
 * file stays plain ESM (it uses no Chrome API and no DOM) and gets types here.
 */

import type { BrowserConnectorCaptureRequest } from '../../shared/browserConnector';

/** What the DOM side must gather before the pure detector can run. */
export interface PageSnapshot {
  title: string;
  url: string;
  lang: string;
  contentType: string;
  metas: { name: string; property: string; httpEquiv: string; content: string }[];
  links: { rel: string; type: string; href: string; title: string }[];
  /** Raw text of every application/ld+json script. */
  jsonLd: string[];
  /** COinS spans (`ctx_ver=...`). */
  coins: string[];
  anchors: { href: string; text: string; title: string; type: string }[];
  /** Sanitised outerHTML, or '' when the page is not HTML or is too large. */
  html: string;
}

export interface DetectedCapture extends BrowserConnectorCaptureRequest {
  /** Whether an HTML snapshot could be offered for this page. */
  snapshotAvailable: boolean;
}

/** Throws when the snapshot has no usable URL. */
export function detectCapture(snapshot: PageSnapshot): DetectedCapture;

export const DETECTED_ITEM_TYPES: string[];
