// Differential test for the argument map's seed picker.
//
// The picker used to be fed by the whole ideas graph, filtered in the renderer to
// the nodes that are neither themes nor authors. It is now fed by a dedicated
// query. The two must select the same ideas and carry the same label and
// statement for each — a cheaper list that quietly drops or renames candidates
// would be a regression the user only meets when a search comes up empty.
import { buildIdeaGraph } from '../electron/graph/graphService';
import { listPickerIdeas } from '../electron/db/ideasRepo';

function time<T>(label: string, fn: () => T): T {
  const started = process.hrtime.bigint();
  const value = fn();
  console.log(`  ${label.padEnd(34)} ${(Number(process.hrtime.bigint() - started) / 1e6).toFixed(1).padStart(8)} ms`);
  return value;
}

async function main(): Promise<void> {
  const started = process.hrtime.bigint();
  const graph = await buildIdeaGraph();
  console.log(`  ${'grafo entero (lo de antes)'.padEnd(34)} ${(Number(process.hrtime.bigint() - started) / 1e6).toFixed(1).padStart(8)} ms`);
  const picker = time('listPickerIdeas (lo de ahora)', () => listPickerIdeas());

  const fromGraph = graph.nodes
    .filter((n) => n.type !== 'theme' && n.type !== 'author')
    .map((n) => `${n.id} | ${n.label} | ${n.statement ?? ''}`)
    .sort();
  const fromPicker = picker.map((i) => `${i.global_id} | ${i.label} | ${i.statement ?? ''}`).sort();

  console.log(`\n  ideas: ${fromGraph.length} (grafo) vs ${fromPicker.length} (selector)`);
  console.log(`  aristas cargadas y nunca leidas: ${graph.edges.length}`);

  const same = fromGraph.length === fromPicker.length && fromGraph.every((v, i) => v === fromPicker[i]);
  console.log(`  identicas (id + etiqueta + enunciado): ${same ? 'SI' : 'NO'}`);
  if (!same) {
    const graphOnly = fromGraph.filter((v) => !fromPicker.includes(v)).slice(0, 3);
    const pickerOnly = fromPicker.filter((v) => !fromGraph.includes(v)).slice(0, 3);
    console.error(`  solo en el grafo:    ${JSON.stringify(graphOnly)}`);
    console.error(`  solo en el selector: ${JSON.stringify(pickerOnly)}`);
    process.exit(1);
  }

  const bytes = (value: unknown) => (JSON.stringify(value)?.length ?? 0) / 1048576;
  console.log(`\n  payload IPC: ${bytes(graph).toFixed(1)} MB -> ${bytes(picker).toFixed(1)} MB`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
