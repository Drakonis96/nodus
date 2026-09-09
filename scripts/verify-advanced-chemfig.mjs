// Live adversarial evaluation for Chemistry Studio. This intentionally runs the
// real desktop chat against a caller-supplied isolated profile and paid model.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const profile = process.env.NODUS_SKILLS_PROFILE;
if (!profile || !path.basename(path.dirname(profile)).startsWith('nodus-chat-skills-qa')) {
  throw new Error('Supply NODUS_SKILLS_PROFILE inside an isolated nodus-chat-skills-qa directory.');
}

const rulesMode = process.env.NODUS_CHEMISTRY_RULES === '1';
const advancedMode = rulesMode || process.env.NODUS_CHEMISTRY_ADVANCED === '1';
const identityMode = advancedMode || process.env.NODUS_CHEMISTRY_V2 === '1';
const advancedCases = [
  { id: '01', slug: 'fischer-open-chain', identity: 'O=C[C@H](O)[C@@H](O)[C@H](O)[C@H](O)CO', depiction: 'fischer', prompt: 'Draw a Fischer projection of the exact user-supplied SMILES O=C[C@H](O)[C@@H](O)[C@H](O)[C@H](O)CO. Provide validated ChemFig export.' },
  { id: '02', slug: 'haworth-beta', identity: 'beta-D-glucopyranose', depiction: 'haworth', prompt: 'Draw the Haworth projection of beta-D-glucopyranose with validated ChemFig export.' },
  { id: '03', slug: 'haworth-alpha', identity: 'alpha-D-glucopyranose', depiction: 'haworth', prompt: 'Draw the Haworth projection of alpha-D-glucopyranose with validated ChemFig export.' },
  { id: '04', slug: 'sn2-r', identity: 'CC[C@@H](C)Br', rule: 'sn2', prompt: 'Draw the conditional SN2 mechanism for these exact user-supplied SMILES: substrate CC[C@@H](C)Br and nucleophile [OH-]. Show inversion and electron-flow arrows with validated ChemFig export.' },
  { id: '05', slug: 'sn2-s', identity: 'CC[C@H](C)Br', rule: 'sn2', prompt: 'Draw the conditional SN2 mechanism for these exact user-supplied SMILES: substrate CC[C@H](C)Br and nucleophile [I-]. Show inversion and electron-flow arrows with validated ChemFig export.' },
  { id: '06', slug: 'amide-resonance', identity: 'N,N-dimethylacetamide', rule: 'amide-resonance', prompt: 'Draw the principal resonance contributors of N,N-dimethylacetamide with electron-flow arrows and validated ChemFig export.' },
  { id: '07', slug: 'ambiguous-e2-input', expectAbstention: true, prompt: 'Draw a verified E2 mechanism for 2-bromobutane and ethoxide with anti-periplanar geometry and validated ChemFig export.' },
  { id: '08', slug: 'newman-butane', identity: 'butane', depiction: 'newman', prompt: 'Draw a verified Newman projection of butane with validated ChemFig export.' },
].map(c => ({ ...c, checks: [] }));
const ruleCases = [
  ...['anti', 'gauche', 'eclipsed'].map((conformation, i) => ({ id: String(i + 1).padStart(2, '0'), slug: `newman-${conformation}`, identity: 'CCCC', depiction: 'newman', prompt: `Draw the ${conformation} Newman projection of exact user SMILES CCCC with validated ChemFig export.` })),
  { id: '04', slug: 'newman-propane', identity: 'CCC', depiction: 'newman', prompt: 'Dibuja Newman alternada del SMILES CCC con exportación ChemFig validada.' },
  { id: '05', slug: 'e2-ethyl', identity: 'CCBr', rule: 'e2', prompt: 'Draw the conditional E2 mechanism for exact SMILES CCBr and base [OH-], including electron arrows and validated ChemFig export.' },
  { id: '06', slug: 'e2-stereo', identity: 'CC[C@@H](C)Br', rule: 'e2', prompt: 'Draw the conditional E2 mechanism for exact SMILES CC[C@@H](C)Br and base CC[O-]. Include all distinct regio/E/Z alternatives, anti geometry, electron arrows and validated ChemFig export.' },
  { id: '07', slug: 'aldol-ethanal', identity: 'CC=O', rule: 'aldol', prompt: 'Draw the aldol addition mechanism for donor SMILES CC=O, acceptor SMILES CC=O, catalyst [OH-]. Show all three steps with electron arrows and validated ChemFig export.' },
  { id: '08', slug: 'aldol-acetone', identity: 'CC(C)=O', rule: 'aldol', prompt: 'Draw the aldol addition mechanism for donor SMILES CC(C)=O, acceptor SMILES CC(C)=O, catalyst [OH-]. Show all three steps with electron arrows and validated ChemFig export.' },
  { id: '09', slug: 'diels-alder-endo', identity: 'C1=CC=CC1', rule: 'diels-alder', prompt: 'Draw the endo Diels–Alder mechanism for diene SMILES C1=CC=CC1 and dienophile SMILES O=C1OC(=O)C=C1 with electron arrows and validated ChemFig export.' },
  { id: '10', slug: 'diels-alder-exo', identity: 'C1=CC=CC1', rule: 'diels-alder', prompt: 'Draw the exo Diels–Alder mechanism for diene SMILES C1=CC=CC1 and dienophile SMILES O=C1OC(=O)C=C1 with electron arrows and validated ChemFig export.' },
  { id: '11', slug: 'diels-alder-simple', identity: 'C=CC=C', rule: 'diels-alder', prompt: 'Draw the Diels–Alder mechanism for diene SMILES C=CC=C and dienophile SMILES C=C with electron arrows and validated ChemFig export.' },
  { id: '12', slug: 'unsupported-cyclic-e2', expectAbstention: true, prompt: 'Draw the E2 mechanism of SMILES C1CCCCC1Br and base [OH-] with verified ChemFig export.' },
  { id: '13', slug: 'unsupported-newman-axis', expectAbstention: true, prompt: 'Draw Newman anti of SMILES CCCC looking along C1-C2, with verified ChemFig export.' },
  { id: '14', slug: 'unsupported-aldol-dehydration', expectAbstention: true, prompt: 'Draw aldol condensation and dehydration of SMILES CC=O with catalyst [OH-], with verified ChemFig export.' },
  { id: '15', slug: 'e2-four-alternatives', identity: 'CC[C@H](Br)CCC', rule: 'e2', prompt: 'Draw the conditional E2 mechanism for exact SMILES CC[C@H](Br)CCC and base CC[O-]. Include all distinct regio/E/Z alternatives, electron arrows and validated ChemFig export.' },
].map(c => ({ ...c, checks: [] }));
const identityNames = ['(R)-lactic acid', '(2R,3S)-2,3-dibromobutane', '(E)-1-bromo-1-chloroprop-1-ene', '(Z)-1-bromo-1-chloroprop-1-ene', 'beta-D-glucopyranose', 'alpha-D-glucopyranose', 'cholesterol', 'strychnine', 'morphine', 'paclitaxel', 'adamantane', 'cubane', 'glucose', 'lactic acid', 'but-2-ene'];
const cases = rulesMode ? ruleCases : advancedMode ? advancedCases : identityMode ? identityNames.map((name, i) => ({ id: String(i + 1).padStart(2, '0'), slug: name.replace(/[^a-z0-9]/gi, '-'), prompt: `Draw the skeletal structure of ${name}. Preserve the exact identity and all specified stereochemistry.`, checks: [], expectAbstention: i >= 12 })) : [
  {
    id: '01', slug: 'lactic-acid-r',
    prompt: 'Draw (R)-lactic acid as an explicit stereochemical Chemfig structure. Show CH3, H, OH and CO2H around the stereocentre, using one solid wedge and one hashed wedge. Return one Chemfig visual block.',
    checks: [/\\chemfig\b/, /<[:]?\[/, /CH_?3|H_3C/, /OH|HO/, /CO_?2H|C\(=O\)-OH/],
  },
  {
    id: '02', slug: 'meso-dibromobutane',
    prompt: 'Draw meso-2,3-dibromobutane in a single Chemfig block, with both stereocentres explicit and wedge/hash bonds chosen so the internal mirror symmetry and 2R,3S relationship are unambiguous. Label both bromines and all four carbon groups.',
    checks: [/\\chemfig\b/, /Br[\s\S]*Br/, /<[:]?\[/, /CH_?3|H_3C/],
  },
  {
    id: '03', slug: 'trans-decalin',
    prompt: 'Use Chemfig to draw trans-decalin as two fused cyclohexane rings. Make the two ring-junction hydrogens explicit and use wedge/dash stereochemistry to show that they are trans. Return one final Chemfig block only.',
    checks: [/\\chemfig\b/, /\*6|\?[a-z]?/i, /<[:]?\[/, /H/],
  },
  {
    id: '04', slug: 'beta-d-glucopyranose',
    prompt: 'Draw beta-D-glucopyranose in a Haworth-style six-membered ring using Chemfig. Show the ring oxygen, CH2OH, the anomeric OH and every remaining OH with correct up/down stereochemistry. Return exactly one Chemfig block.',
    checks: [/\\chemfig\b/, /\*6|\?[a-z]?/i, /CH_?2OH|HOCH_?2/, /OH/g],
  },
  {
    id: '05', slug: 'ez-alkene-pair',
    prompt: 'In one Chemfig visual block, draw both (E)- and (Z)-1-bromo-1-chloroprop-1-ene side by side and label each isomer. The relative alkene substituent geometry must be visibly different and chemically correct.',
    checks: [/(?:\\chemfig\b[\s\S]*){2}/, /Br[\s\S]*Br/, /Cl[\s\S]*Cl/, /\bE\b|\{E\}/i, /\bZ\b|\{Z\}/i],
  },
  {
    id: '06', slug: 'sn2-inversion',
    prompt: 'Create one Chemfig reaction mechanism for hydroxide attacking (R)-2-bromobutane by SN2. Show the curved arrow from an oxygen lone pair to C2, the C-Br bond-breaking arrow, backside attack, and the inverted alcohol product. Use schemestart/schemestop and one final Chemfig block.',
    checks: [/\\schemestart\b/, /\\schemestop\b/, /\\arrow\b/, /\\chemmove\b/, /Br/, /OH|HO/, /<[:]?\[/],
  },
  {
    id: '07', slug: 'e2-antiperiplanar',
    prompt: 'Create a complete Chemfig E2 mechanism for 2-bromobutane with ethoxide. Depict the anti-periplanar beta-H and C-Br bonds, and include all three curved arrows: base to H, C-H to C=C, and C-Br to Br. Show the major E-2-butene product in one schemestart/schemestop block.',
    checks: [/\\schemestart\b/, /\\schemestop\b/, /\\chemmove\b/, /Br/, /=/, /EtO|OEt|CH_3CH_2O/],
  },
  {
    id: '08', slug: 'amide-resonance',
    prompt: 'Use one Chemfig block to draw the two principal resonance contributors of N,N-dimethylacetamide, including the charge-separated contributor, formal charges, and a resonance arrow. Do not use a reaction arrow.',
    checks: [/(?:\\chemfig\b[\s\S]*){2}|\\schemestart\b/, /\\arrow\s*\{<->\}|\\leftrightarrow|<->/, /\+/, /-/],
  },
  {
    id: '09', slug: 'diels-alder-endo',
    prompt: 'Draw a stereospecific Chemfig reaction of cyclopentadiene with maleic anhydride to give the endo norbornene anhydride adduct. Preserve both carbonyls and show the endo bridge stereochemistry with wedge/hash bonds. Use one reaction scheme block.',
    checks: [/\\schemestart\b/, /\\schemestop\b/, /\\arrow\b/, /=(?:\[[^\]]*\])?O[\s\S]*=(?:\[[^\]]*\])?O/, /[<>][:]?\[/],
  },
  {
    id: '10', slug: 'aldol-mechanism',
    prompt: 'In one Chemfig block, show the base-catalysed aldol addition of two acetaldehyde molecules through the enolate and tetrahedral alkoxide to 3-hydroxybutanal. Include the essential curved electron-flow arrows and formal charges in a readable reaction sequence.',
    checks: [/\\schemestart\b/, /\\schemestop\b/, /\\chemmove\b/, /-/i, /OH|HO/],
  },
  {
    id: '11', slug: 'nitration-mechanism',
    prompt: 'Use a single Chemfig block to draw electrophilic aromatic nitration of benzene: generation or use of NO2+, attack to the sigma complex, three resonance contributors of the arenium ion, deprotonation, and nitrobenzene. Include curved arrows and formal charges.',
    checks: [/\\schemestart\b/, /\\schemestop\b/, /\\chemmove\b/, /NO_?2/, /\+/, /\*6/],
  },
  {
    id: '12', slug: 'fischer-glucose',
    prompt: 'Draw the complete Fischer projection of D-glucose using Chemfig: CHO at the top, CH2OH at the bottom, four stereocentres, and the OH sequence right-left-right-right from C2 to C5. Return one final Chemfig block.',
    checks: [/\\chemfig\b/, /CHO/, /CH_?2OH/, /OH[\s\S]*OH[\s\S]*OH[\s\S]*OH/],
  },
];

const selectors = (process.env.NODUS_SKILLS_SAMPLE ?? '').split(',').map(value => value.trim()).filter(Boolean);
const selectedCases = selectors.length
  ? cases.filter(item => selectors.some(value => item.id === value || item.slug.includes(value)))
  : cases;
assert.ok(selectedCases.length, 'At least one advanced Chemfig case must be selected.');
const replayResults = process.env.NODUS_CHEMISTRY_REPLAY ? JSON.parse(await fs.readFile(process.env.NODUS_CHEMISTRY_REPLAY, 'utf8')) : null;

const runName = (process.env.NODUS_CHEMFIG_RUN ?? 'run').replace(/[^a-z0-9._-]+/gi, '-');
const outputDir = path.join(root, 'artifacts/chat-skills/advanced-chemfig', runName);
await fs.mkdir(outputDir, { recursive: true });

const env = {
  ...process.env,
  NODUS_USERDATA: profile,
  NODUS_QA_ROOT: path.dirname(profile),
  NODUS_QA_DATABASE_AUDIT_LOG: path.join(profile, 'database-audit.jsonl'),
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_DISABLE_ANNOUNCEMENTS: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
};
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [root], env });
const diagnosticLines = [];
for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', chunk => {
  const value = String(chunk);
  if (/chemistry-plan|chemfig-plan|Error|error|\[ai/.test(value)) diagnosticLines.push(value);
});
await app.firstWindow();
let page;
for (let attempt = 0; attempt < 150 && !page; attempt++) {
  page = app.windows().find(window => window.url().includes('/index.html'));
  if (!page) await new Promise(resolve => setTimeout(resolve, 200));
}
assert.ok(page, 'main application window');
page.setDefaultTimeout(30_000);
const rendererErrors = [];
page.on('pageerror', error => rendererErrors.push(error.message));
const results = [];

try {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.nodus);
  await page.evaluate(reasoning => window.nodus.updateSettings({
    autoBackupEnabled: false,
    onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true,
    advancedTourComplete: true, basicsTutorialVersion: 5, firstVaultVersion: 5,
    uiLanguage: 'en', promptLanguage: 'en', reduceMotion: true, theme: 'light',
    chatReasoning: reasoning,
  }), process.env.NODUS_CHEMFIG_REASONING === 'high' ? 'high' : 'off');
  if (process.env.NODUS_CHEMFIG_EMBEDDINGS === '1') {
    await page.evaluate(() => window.nodus.updateSettings({ embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3' }));
  }
  await page.evaluate(() => {
    localStorage.setItem('nodus.lastSeenVersion', '5.3.0');
    for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07', 'nodus.toolkitBetaGuideSeen.2.4.0', 'nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA']) localStorage.setItem(key, '1');
  });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await page.setViewportSize({ width: 1512, height: 982 });
  if (await page.locator('.whats-new-backdrop').count()) await page.locator('.whats-new-backdrop').getByRole('button', { name: 'Close', exact: true }).click();
  if (await page.locator('.startup-update-backdrop').count()) await page.locator('.startup-update-backdrop').getByRole('button', { name: 'Got it', exact: true }).click();
  await page.getByTitle('Open research assistant', { exact: true }).click();

  const modelLabel = 'DeepSeek · deepseek-v4-flash';
  const modelSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'deepseek-v4-flash' }) });
  await modelSelect.selectOption({ label: modelLabel });
  assert.equal(await modelSelect.inputValue(), 'deepseek::deepseek-v4-flash', 'the direct DeepSeek provider must be selected');
  await page.evaluate(() => window.nodus.restoreChatSkills());
  const chemistrySkill = (await page.evaluate(() => window.nodus.listChatSkills())).find(skill => skill.builtin === 'chemistry');
  assert.ok(chemistrySkill?.enabled.assistant, 'Chemistry Studio must be enabled');

  for (const testCase of selectedCases) {
    const replay = replayResults?.find(r => r.id === testCase.id);
    if (replayResults && !replay) throw new Error(`Missing replay case ${testCase.id}`);
    if (!replay) {
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    const input = page.locator('textarea').first();
    await input.fill(testCase.prompt);
    await input.press('Enter');
    console.log('GENERATING', testCase.id, testCase.slug);
    await page.waitForFunction(() => !!document.querySelector('[data-testid="chat-skills-assistant"]')?.disabled, null, { timeout: 15_000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="chat-skills-assistant"]')?.disabled, null, { timeout: 360_000 });
    }

    const latest = replay ? { id: replay.conversationId } : (await page.evaluate(() => window.nodus.listConversations()))[0];
    const saved = await page.evaluate(id => window.nodus.getConversation(id), latest.id);
    const answer = saved.messages.filter(message => message.role === 'assistant').at(-1)?.content ?? '';
    const blocks = [...answer.matchAll(/```(smiles|lewis|chemfig|svg|chemistry-document)\b[^\n]*\n([\s\S]*?)```/gi)];
    const expectedKind = identityMode ? 'chemistry-document' : 'chemfig';
    const chemfigBlocks = blocks.filter(match => match[1].toLowerCase() === expectedKind);
    const source = chemfigBlocks[0]?.[2].trim() ?? '';
    const issues = [];
    if (!testCase.expectAbstention && chemfigBlocks.length !== 1) issues.push(`expected exactly one ${expectedKind} block, received ${chemfigBlocks.length}`);
    if (testCase.expectAbstention && chemfigBlocks.length) issues.push('ambiguous identity incorrectly accepted');
    if (testCase.expectAbstention && !/clarif|specif|ambigu|isomer|unsupported|not.*support|outside|scope/i.test(answer)) issues.push('no actionable clarification');
    if (blocks.some(match => match[1].toLowerCase() !== expectedKind)) issues.push('returned a competing visual format');
    if (identityMode && chemfigBlocks.length) {
      const document = JSON.parse(source);
      if (document.version !== 2 || document.status !== 'verified' || !document.species?.[0]?.references?.length) issues.push('missing structured identity evidence');
      if (document.species?.[0]?.input?.value !== (testCase.identity ?? identityNames[Number(testCase.id) - 1])) issues.push('model changed or shortened the requested identity');
      if (advancedMode) {
        if (testCase.rule ? document.mechanism?.rule !== testCase.rule : document.species[0].depiction !== testCase.depiction) issues.push('wrong mechanism or projection');
        const exported = testCase.rule ? document.mechanism?.chemfig : document.species[0].chemfig;
        if (exported?.status !== 'validated' || !exported.source) issues.push('missing validated ChemFig export');
      }
    }
    if (/\\(?:documentclass|usepackage|begin\s*\{document\}|end\s*\{document\}|begin\s*\{tikzpicture\})/.test(source)) issues.push('included a forbidden preamble or tikzpicture');
    for (const check of testCase.checks) {
      const matches = source.match(check);
      if (!matches || (check.global && matches.length < 4)) issues.push(`missing expected pattern ${check}`);
    }

    await page.getByText(saved.title, { exact: true }).first().click();
    await page.getByText(testCase.prompt, { exact: true }).waitFor();
    const screenshot = path.join(outputDir, `${testCase.id}-${testCase.slug}.png`);
    let rendered = false;
    let renderError = '';
    if (chemfigBlocks.length) {
      const card = page.getByTestId('chat-svg').last();
      const error = page.locator('.chat-visual-error').last();
      await Promise.race([
        card.waitFor({ timeout: 35_000 }).catch(() => undefined),
        error.waitFor({ timeout: 35_000 }).catch(() => undefined),
      ]);
      rendered = await card.isVisible().catch(() => false);
      if (rendered) await card.locator('img').evaluate(image => image.decode()).catch(reason => { renderError = String(reason); });
      else renderError = await error.innerText().catch(() => 'Chemfig renderer produced no card');
      if (!rendered || renderError) issues.push(`render failed: ${renderError || 'unknown error'}`);
      if (rendered) {
        const imageUrl = await card.locator('img').getAttribute('src');
        if (imageUrl?.startsWith('data:image/svg+xml;base64,')) await fs.writeFile(path.join(outputDir, `${testCase.id}-${testCase.slug}.svg`), Buffer.from(imageUrl.split(',')[1], 'base64'));
        if (advancedMode) {
          // Exercise the real click handler and Blob content without opening a
          // native save dialog or writing outside this isolated QA directory.
          const downloaded = await page.evaluate(async () => {
            const button = [...document.querySelectorAll('button')].find(b => /^(?:Descargar fragmento ChemFig contrastado|Download checked ChemFig fragment)$/.test(b.textContent ?? ''));
            if (!button) return null;
            const original = HTMLAnchorElement.prototype.click, create = URL.createObjectURL;
            let body;
            URL.createObjectURL = function (blob) { body = blob.text(); return create.call(URL, blob); };
            HTMLAnchorElement.prototype.click = function () {};
            try { button.click(); return await body; } finally { HTMLAnchorElement.prototype.click = original; URL.createObjectURL = create; }
          });
          const record = JSON.parse(source), expected = record.mechanism?.chemfig?.source ?? record.species[0].chemfig?.source;
          if (downloaded !== expected) issues.push('ChemFig download payload differs from validated persisted source');
        }
      }
    } else if (!testCase.expectAbstention) {
      issues.push('no Chemfig source to render');
    }
    await page.locator('.assistant-chat-messages, .research-chat-messages').last().scrollIntoViewIfNeeded().catch(() => undefined);
    await page.screenshot({ path: screenshot, fullPage: false });
    results.push({ id: testCase.id, slug: testCase.slug, prompt: testCase.prompt, conversationId: latest.id, answer, source, rendered, issues, screenshot });
    await fs.writeFile(path.join(outputDir, 'partial-results.json'), `${JSON.stringify(results, null, 2)}\n`);
    console.log(issues.length ? 'FAILED' : 'PASSED', testCase.id, issues.join('; '));
  }

  const passed = results.filter(result => !result.issues.length).length;
  const report = {
    format: identityMode ? 'nodus.chemistry-identity-live-evaluation' : 'nodus.advanced-chemfig-evaluation', formatVersion: 1,
    model: { provider: 'deepseek', id: 'deepseek-v4-flash', reasoning: process.env.NODUS_CHEMFIG_REASONING === 'high' ? 'high' : 'off' },
    grading: 'Source-format smoke checks only; passing does not certify chemical identity, stereochemistry, electron flow or visual legibility. Inspect the SVG and compare with an independent reference.',
    retrievalExperiment: process.env.NODUS_CHEMFIG_EMBEDDINGS === '1' ? 'existing-bge-m3-embeddings' : 'default-profile',
    skill: chemistrySkill, createdAt: new Date().toISOString(),
    summary: { total: results.length, passed, failed: results.length - passed, rendererErrors },
    results,
  };
  await fs.writeFile(path.join(outputDir, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log('SUMMARY', JSON.stringify(report.summary));
} catch (error) {
  await page.screenshot({ path: path.join(outputDir, 'failure.png') }).catch(() => undefined);
  throw error;
} finally {
  await fs.writeFile(path.join(outputDir, 'diagnostics.log'), diagnosticLines.join(''));
  await app.close();
}
