import type { DetectedCapture, DetectorLabels, PageSnapshot } from './detector';

export function detectCaptureCandidates(snapshot: PageSnapshot, labels?: DetectorLabels, limit?: number): DetectedCapture[];
