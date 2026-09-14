import { exactKeys, plainText } from './json';

/** Capability API 2.2: bounded relevance review, never a general model prompt API. */
export const VISION_LIMITS = Object.freeze({ candidates: 5, rounds: 3, inputBytes: 5 * 1024 * 1024, pixels: 16_000_000, thumbnailEdge: 768, thumbnailBytes: 512 * 1024, outputTokens: 1200, callMs: 30_000, sessionMs: 120_000 });
export interface VisionCandidateInput {
  id: string;
  metadata: { title: string; description?: string; attribution?: string };
  source: { kind: 'public'; endpointId: string; path: string } | { kind: 'generated'; bytes: Uint8Array; mimeType: string };
}
export interface PreparedVisionCandidate {
  id: string; imageId: string; metadata: VisionCandidateInput['metadata'];
  provenance: { kind: 'public' | 'generated'; source: string; sha256: string; thumbnailSha256: string; width: number; height: number };
}
export interface VisionReviewRequest { request: string; candidates: Array<{ id: string; imageId: string }> }
export interface VisionReviewResult {
  reviewId: string;
  status: 'reviewed' | 'skipped' | 'error';
  outcome: 'selected' | 'no_relevant_candidate' | 'vision_unavailable' | 'privacy_blocked' | 'limit_reached' | 'invalid_review' | 'review_failed';
  reason?: string;
  model: { provider: string; model: string } | null;
  round: number;
  remainingRounds: number;
  selected: string[];
  candidates: Array<{ id: string; imageId: string; inspected: boolean; relevance: number | null; reasoning: string; thumbnailSha256?: string }>;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
export function validateVisionCandidates(value: unknown): VisionCandidateInput[] {
  if (!Array.isArray(value) || !value.length || value.length > VISION_LIMITS.candidates || new Set(value.map(v => v?.id)).size !== value.length) throw new Error('Expected 1–5 distinct image candidates.');
  for (const candidate of value) {
    if (!record(candidate) || !exactKeys(candidate, ['id','metadata','source']) || !id(candidate.id) || !record(candidate.metadata) || !exactKeys(candidate.metadata,['title','description','attribution']) || !plainText(candidate.metadata.title,300)) throw new Error('Invalid image candidate.');
    for (const key of ['description','attribution']) if (candidate.metadata[key] !== undefined && !plainText(candidate.metadata[key],1000)) throw new Error('Invalid image metadata.');
    const s = candidate.source;
    if (!record(s)) throw new Error('Invalid image source.');
    if (s.kind === 'public') {
      if (!exactKeys(s,['kind','endpointId','path']) || !id(s.endpointId) || !plainText(s.path,2000)) throw new Error('Invalid public image source.');
    } else if (s.kind === 'generated') {
      if (!exactKeys(s,['kind','bytes','mimeType']) || !(s.bytes instanceof Uint8Array) || !s.bytes.length || s.bytes.length > VISION_LIMITS.inputBytes || !['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(String(s.mimeType))) throw new Error('Invalid generated image.');
    } else throw new Error('Private files and arbitrary URLs are not image sources.');
  }
  return value as VisionCandidateInput[];
}
export function validateVisionReviewRequest(value: unknown): VisionReviewRequest {
  if (!record(value) || !exactKeys(value,['request','candidates']) || !plainText(value.request,20000) || !Array.isArray(value.candidates) || !value.candidates.length || value.candidates.length > 5) throw new Error('Invalid image review request.');
  const candidates = value.candidates;
  if (candidates.some(c => !record(c) || !exactKeys(c,['id','imageId']) || !id(c.id) || !id(c.imageId)) || new Set(candidates.map(c=>c.id)).size !== candidates.length || new Set(candidates.map(c=>c.imageId)).size !== candidates.length) throw new Error('Invalid image review handles.');
  return value as unknown as VisionReviewRequest;
}
/** Parse only the model's scores. Inspection claims, selected IDs and receipts belong to the host. */
export function validateVisionScores(value: unknown, ids: string[]): Array<{ id: string; relevance: number; reasoning: string }> {
  if (!record(value) || !exactKeys(value,['candidates']) || !Array.isArray(value.candidates) || value.candidates.length !== ids.length) throw new Error('Invalid vision response.');
  const seen = new Set<string>();
  for (const c of value.candidates) {
    if (!record(c) || !exactKeys(c,['id','relevance','reasoning']) || typeof c.id !== 'string' || !ids.includes(c.id) || seen.has(c.id) || typeof c.relevance !== 'number' || !Number.isFinite(c.relevance) || c.relevance < 0 || c.relevance > 1 || !plainText(c.reasoning,300)) throw new Error('Invalid vision candidate score.');
    seen.add(c.id);
  }
  return value.candidates;
}

/** Structural validation only; authenticity also requires the host execution boundary.
 * Never treat arbitrary JSON that passes this validator as an authentic receipt. */
export function validateVisionReviewResult(value: unknown): VisionReviewResult {
  if (!record(value) || !exactKeys(value,['reviewId','status','outcome','reason','model','round','remainingRounds','selected','candidates']) || !id(value.reviewId) || !Number.isInteger(value.round) || Number(value.round)<0 || Number(value.round)>3 || !Number.isInteger(value.remainingRounds) || Number(value.remainingRounds)<0 || Number(value.remainingRounds)>3-Number(value.round)) throw new Error('Invalid vision receipt.');
  if (value.reason !== undefined && !plainText(value.reason,500)) throw new Error('Invalid vision receipt reason.');
  if (value.model !== null && (!record(value.model) || !exactKeys(value.model,['provider','model']) || !plainText(value.model.provider,80) || !plainText(value.model.model,200))) throw new Error('Invalid vision receipt model.');
  const outcomes: Record<string,string[]> = {reviewed:['selected','no_relevant_candidate'],skipped:['vision_unavailable','privacy_blocked','limit_reached'],error:['invalid_review','review_failed']};
  if(typeof value.status!=='string' || !outcomes[value.status]?.includes(String(value.outcome)) || !Array.isArray(value.selected) || !Array.isArray(value.candidates) || !value.candidates.length || value.candidates.length>5) throw new Error('Invalid vision receipt status.');
  const reviewed=value.status==='reviewed', seen=new Set<string>();
  for(const c of value.candidates) {
    if(!record(c) || !exactKeys(c,['id','imageId','inspected','relevance','reasoning','thumbnailSha256']) || !id(c.id) || !id(c.imageId) || seen.has(c.id) || c.inspected!==reviewed || typeof c.reasoning!=='string' || c.reasoning.length>300) throw new Error('Invalid vision receipt candidate.');
    seen.add(c.id);
    if(reviewed ? typeof c.relevance!=='number' || !Number.isFinite(c.relevance) || c.relevance<0 || c.relevance>1 || !plainText(c.reasoning,300) || typeof c.thumbnailSha256!=='string' || !/^[a-f0-9]{64}$/.test(c.thumbnailSha256) : c.relevance!==null || c.reasoning!=='' || c.thumbnailSha256!==undefined) throw new Error('Invalid vision inspection claim.');
  }
  const expected=reviewed ? value.candidates.filter(c=>c.relevance>=0.6).sort((a,b)=>b.relevance-a.relevance || a.id.localeCompare(b.id)).map(c=>c.id) : [];
  if(JSON.stringify(value.selected)!==JSON.stringify(expected) || reviewed && ((value.outcome==='selected') !== Boolean(expected.length))) throw new Error('Invalid vision selection claim.');
  return structuredClone(value) as unknown as VisionReviewResult;
}
