import type { DetectedCapture, PageSnapshot } from './detector';

export function detectCaptureCandidates(snapshot: PageSnapshot, limit?: number): DetectedCapture[];
