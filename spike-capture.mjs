import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { AutoProcessor, AutoModelForAudioFrameClassification, env } from '@huggingface/transformers';
env.allowLocalModels = false;
const id = 'onnx-community/pyannote-segmentation-3.0';
const model = await AutoModelForAudioFrameClassification.from_pretrained(id, { dtype: 'fp32' });
const processor = await AutoProcessor.from_pretrained(id);
const out = {};
for (const file of process.argv.slice(2)) {
  const raw = execFileSync('ffmpeg', ['-v','quiet','-i',file,'-f','f32le','-ac','1','-ar','16000','pipe:1'], { maxBuffer: 1<<28 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength/4);
  const inputs = await processor(samples);
  const { logits } = await model(inputs);
  const spans = processor.post_process_speaker_diarization(logits, samples.length)[0]
    .map(s => ({ start: Number(s.start.toFixed(3)), end: Number(s.end.toFixed(3)), label: model.config.id2label[s.id] ?? String(s.id), confidence: Number(s.confidence.toFixed(3)) }));
  out[file.split('/').pop()] = spans;
  console.log(file.split('/').pop(), spans.length, 'tramos');
}
fs.writeFileSync('scripts/fixtures/testimony-diarization-spans.json', JSON.stringify(out, null, 1) + '\n');
