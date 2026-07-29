import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const repoRoot = '/Users/jorgepb96/Documents/GitHub/nodus/.claude/worktrees/navigation-evaluation-fa0128';
const { AutoProcessor, AutoModelForAudioFrameClassification, env } = await import('@huggingface/transformers');
env.allowLocalModels = false;

const file = process.argv[2];
const raw = execFileSync('ffmpeg', ['-v', 'quiet', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1'], { maxBuffer: 1 << 28 });
const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
console.log('muestras:', samples.length, `(${(samples.length / 16000).toFixed(1)}s)`);

const id = 'onnx-community/pyannote-segmentation-3.0';
const model = await AutoModelForAudioFrameClassification.from_pretrained(id, { dtype: 'fp32' });
const processor = await AutoProcessor.from_pretrained(id);
const inputs = await processor(samples);
const { logits } = await model(inputs);
const segments = processor.post_process_speaker_diarization(logits, samples.length)[0];
for (const s of segments) {
  console.log(`${s.start.toFixed(2)}–${s.end.toFixed(2)}  hablante ${s.id}  conf ${s.confidence.toFixed(2)}  ${model.config.id2label[s.id] ?? ''}`);
}
