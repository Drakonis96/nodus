import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko'];

test('Tutor deterministic runtime copy follows every requested language', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'nodus-tutor-runtime-'));
  const stub = path.join(temp, 'stubs.ts');
  const outfile = path.join(temp, 'tutor.cjs');
  const stubSource = `
    export const graph = {
      nodes: [
        { id: 'idea-1', type: 'idea', label: 'First', statement: 'A', themes: [], workCount: 1, maxConfidence: 0.8, years: [2020], authors: ['Author'] },
        { id: 'idea-2', type: 'idea', label: 'Second', statement: 'B', themes: [], workCount: 1, maxConfidence: 0.7, years: [2021], authors: ['Author'] },
      ],
      edges: [{ id: 'edge-1', source: 'idea-1', target: 'idea-2', type: 'supports', confidence: 0.8, basis: 'explicit' }],
    };
    export async function buildIdeaGraph() { return graph; }
    export function aggregateGaps() { return []; }
    export function getContradictions() { return []; }
    export function getEdgeDetail() { return null; }
    export function getIdeaDetail() { return null; }
    export function getDb() { throw new Error('database should not be needed in this fixture'); }
    export function getSettings() { return { promptLanguage: 'es' }; }
    export async function completeJson(request) {
      globalThis.__tutorCalls = [...(globalThis.__tutorCalls ?? []), request];
      return { routes: [{ weight: 5, stops: [{ nodeIds: ['idea-1'] }, { nodeIds: ['idea-2'] }] }] };
    }
    export async function completeText() { return ''; }
    export async function completeTextStream() { return ''; }
  `;
  await writeFile(stub, stubSource);

  try {
    await build({
      entryPoints: [path.join(root, 'electron/ai/tutor.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
      plugins: [{
        name: 'tutor-runtime-stubs',
        setup(context) {
          context.onResolve({ filter: /^(\.\.\/db\/(database|gapsRepo|ideasRepo|settingsRepo)|\.\.\/graph\/graphService|\.\/aiClient)$/ }, () => ({ path: stub, namespace: 'tutor-stub' }));
          context.onLoad({ filter: /.*/, namespace: 'tutor-stub' }, () => ({ contents: stubSource, loader: 'ts' }));
        },
      }],
    });
    const tutor = createRequire(import.meta.url)(outfile);

    for (const language of languages) {
      const plan = await tutor.buildTutorPlan({ mode: 'overview', language });
      assert.equal(plan.routes.length, 1, `${language}: route dropped`);
      assert.equal(plan.routes[0].weightLabel, tutorLabel(language, 5), `${language}: weight label not localized`);
      assert.equal(plan.routes[0].title, tutorRoute(language), `${language}: route fallback not localized`);
      assert.equal(plan.routes[0].stops[0].title, tutorStop(language), `${language}: stop fallback not localized`);
      assert.equal(plan.overview, tutorOverview(language), `${language}: overview fallback not localized`);
      assert.equal(plan.coveredIdeas, 2, `${language}: readiness/coverage changed`);
      const request = globalThis.__tutorCalls.at(-1);
      const user = JSON.parse(request.user);
      assert.equal(user.grafo.conexiones[0].type_label, tutorRelation(language), `${language}: relation label not localized`);
      assert.equal(user.auditoria_cobertura.criterio, tutorCriterion(language), `${language}: coverage criterion not localized`);
    }
    const spanish = await tutor.buildTutorPlan({ mode: 'overview', language: 'unsupported' });
    assert.equal(spanish.routes[0].weightLabel, 'línea principal', 'invalid language must fall back to Spanish');

    for (const language of languages) {
      await assert.rejects(
        () => tutor.answerTutorStep({ route: { stops: [] }, stopIndex: 0, overview: '', history: [], language }),
        new RegExp(escapeRegExp(tutorError(language))),
        `${language}: invalid-stop error not localized`
      );
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

function tutorLabel(language, weight) {
  return {
    es: { 5: 'línea principal' }, en: { 5: 'main line' }, fr: { 5: 'ligne principale' }, de: { 5: 'Hauptlinie' },
    pt: { 5: 'linha principal' }, 'pt-BR': { 5: 'linha principal' }, it: { 5: 'linea principale' }, tr: { 5: 'ana hat' },
    'zh-Hans': { 5: '主线' }, 'zh-Hant': { 5: '主線' }, vi: { 5: 'dòng chính' }, ja: { 5: 'メインライン' },
    ru: { 5: 'главная линия' }, uk: { 5: 'головна лінія' }, ko: { 5: '주 노선' },
  }[language][weight];
}

function tutorError(language) {
  return {
    es: 'Parada de recorrido inválida.', en: 'Invalid route stop.', fr: 'Étape de parcours invalide.', de: 'Ungültige Wegstation.',
    pt: 'Paragem de percurso inválida.', 'pt-BR': 'Parada de percurso inválida.', it: 'Tappa del percorso non valida.', tr: 'Geçersiz güzergâh durağı.',
    'zh-Hans': '无效的路线站点。', 'zh-Hant': '無效的路線站點。', vi: 'Điểm dừng lộ trình không hợp lệ.', ja: '無効なルート立ち寄り地点です。',
    ru: 'Недопустимая остановка маршрута.', uk: 'Недопустима зупинка маршруту.', ko: '유효하지 않은 경로 경유지입니다.',
  }[language];
}

function tutorRoute(language) {
  return {
    es: 'Recorrido', en: 'Route', fr: 'Parcours', de: 'Weg', pt: 'Percurso', 'pt-BR': 'Percurso', it: 'Percorso', tr: 'Güzergâh',
    'zh-Hans': '路线', 'zh-Hant': '路線', vi: 'Lộ trình', ja: 'ルート', ru: 'Маршрут', uk: 'Маршрут', ko: '경로',
  }[language];
}

function tutorStop(language) {
  return {
    es: 'Parada', en: 'Stop', fr: 'Étape', de: 'Station', pt: 'Paragem', 'pt-BR': 'Parada', it: 'Tappa', tr: 'Durak',
    'zh-Hans': '站点', 'zh-Hant': '站點', vi: 'Điểm dừng', ja: '立ち寄り地点', ru: 'Остановка', uk: 'Зупинка', ko: '경유지',
  }[language];
}

function tutorOverview(language) {
  return {
    es: 'Recorrido guiado por tu grafo de ideas.', en: 'Guided route through your idea graph.', fr: "Parcours guidé dans votre graphe d'idées.",
    de: 'Geführter Weg durch Ihren Ideengraphen.', pt: 'Percurso guiado pelo seu grafo de ideias.', 'pt-BR': 'Percurso guiado pelo seu grafo de ideias.',
    it: 'Percorso guidato nel tuo grafo di idee.', tr: 'Fikir grafiğinizde rehberli güzergâh.',
    'zh-Hans': '贯穿你的观点图谱的引导路线。', 'zh-Hant': '貫穿你的觀點圖譜的引導路線。', vi: 'Lộ trình có hướng dẫn qua đồ thị ý tưởng của bạn.',
    ja: 'アイデアグラフをたどるガイド付きルート。', ru: 'Управляемый маршрут по графу ваших идей.', uk: 'Керований маршрут графом ваших ідей.', ko: '아이디어 그래프를 따라가는 안내 경로.',
  }[language];
}

function tutorRelation(language) {
  return {
    es: 'apoya', en: 'supports', fr: 'soutient', de: 'stützt', pt: 'apoia', 'pt-BR': 'apoia', it: 'supporta', tr: 'destekler',
    'zh-Hans': '支持', 'zh-Hant': '支持', vi: 'ủng hộ', ja: '支持する', ru: 'поддерживает', uk: 'підтримує', ko: '지지',
  }[language];
}

function tutorCriterion(language) {
  return {
    es: 'Si tu respuesta queda muy por debajo de este mínimo, faltarán nodos y deberás rediseñar rutas más largas antes de responder.',
    en: 'If your response falls far below this minimum, nodes will be missing and you must redesign longer routes before responding.',
    fr: 'Si votre réponse est très en dessous de ce minimum, des nœuds manqueront ; vous devez donc redessiner des parcours plus longs avant de répondre.',
    de: 'Wenn Ihre Antwort deutlich unter diesem Minimum bleibt, fehlen Knoten; entwerfen Sie vor der Antwort längere Wege neu.',
    pt: 'Se a sua resposta ficar muito abaixo deste mínimo, faltarão nós e deverá redesenhar percursos mais longos antes de responder.',
    'pt-BR': 'Se sua resposta ficar muito abaixo deste mínimo, faltarão nós e você deverá redesenhar percursos mais longos antes de responder.',
    it: 'Se la risposta è molto al di sotto di questo minimo, mancheranno nodi e dovrai ridisegnare percorsi più lunghi prima di rispondere.',
    tr: 'Yanıtınız bu minimumun çok altında kalırsa düğümler eksik kalır; yanıtlamadan önce daha uzun güzergâhları yeniden tasarlamalısınız.',
    'zh-Hans': '如果你的回答远低于这一下限，就会缺少节点，你必须在回答之前重新设计更长的路线。',
    'zh-Hant': '如果你的回答遠低於這個下限，就會缺少節點，你必須在回答之前重新設計更長的路線。',
    vi: 'Nếu câu trả lời của bạn thấp hơn nhiều so với mức tối thiểu này, các nút sẽ bị thiếu và bạn phải thiết kế lại những lộ trình dài hơn trước khi trả lời.',
    ja: '回答がこの下限を大きく下回る場合、ノードが欠落します。回答する前に、より長いルートを再設計してください。',
    ru: 'Если ваш ответ намного ниже этого минимума, узлов будет не хватать, и перед ответом вам придётся заново спроектировать более длинные маршруты.',
    uk: 'Якщо ваша відповідь значно нижча за цей мінімум, вузлів бракуватиме, і перед відповіддю вам доведеться перепроєктувати довші маршрути.',
    ko: '답변이 이 최소치보다 훨씬 짧으면 노드가 누락되므로, 답변하기 전에 더 긴 경로를 다시 설계해야 합니다.',
  }[language];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
