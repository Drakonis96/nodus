import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('Nodi owns an independent persisted model and chat history', async () => {
  const [types, settings, prefs, store, ipc, preload] = await Promise.all([
    read('shared/types.ts'),
    read('electron/db/settingsRepo.ts'),
    read('electron/db/appPrefs.ts'),
    read('electron/nodiConversations.ts'),
    read('electron/ipc.ts'),
    read('electron/preload.ts'),
  ]);
  assert.match(types, /nodiModel: ModelRef \| null/);
  assert.match(settings, /nodiModel: null/);
  assert.match(prefs, /'nodiModel'/);
  assert.match(store, /nodi-chat-history\.json/);
  assert.match(store, /MAX_CONVERSATIONS/);
  for (const contract of ['listNodiConversations', 'getNodiConversation', 'saveNodiConversation', 'deleteNodiConversation', 'clearNodiConversations']) {
    assert.match(types, new RegExp(contract));
    assert.match(ipc, new RegExp(contract));
    assert.match(preload, new RegExp(contract));
  }
});

test('Nodi context is explicit, bounded and rejects invented product claims', async () => {
  const [backend, documentation, app] = await Promise.all([
    read('electron/ai/nodiChat.ts'),
    read('shared/nodiDocumentation.ts'),
    read('src/App.tsx'),
  ]);
  for (const context of ['documentation', 'current_view', 'vault', 'all_vaults']) assert.match(backend, new RegExp(`'${context}'`));
  assert.match(backend, /MAX_TOTAL_CONTEXT_CHARS = 55_000/);
  assert.match(backend, /buildNodiResearchContext/);
  assert.match(backend, /buildNodiAllVaultsContext/);
  assert.match(backend, /Tu prioridad absoluta es la fiabilidad/);
  assert.match(backend, /No puedo verificarlo con las fuentes seleccionadas/);
  assert.match(backend, /termina con «Base:»/);
  assert.match(backend, /temperature: 0\.2/);
  assert.match(documentation, /Roadmap está en la parte superior derecha/);
  assert.match(documentation, /NODUS_ROADMAP/);
  assert.match(documentation, /Vault de docencia/);
  assert.match(documentation, /Tipos no disponibles todavía/);
  assert.match(app, /data-nodi-view=\{view\}/);
  assert.match(app, /setNodiViewContext/);
  assert.match(app, /slice\(0, 12_000\)/);
  assert.match(backend, /retrieveStudyAssistantEntries/);
  assert.match(backend, /relevant_materials/);
});

test('Nodi and the genealogy assistant receive tags relative to the persisted tree focus', async () => {
  const [nodi, assistant, genealogy] = await Promise.all([
    read('electron/ai/nodiChat.ts'),
    read('electron/ai/researchAssistant.ts'),
    read('electron/ai/genealogyChatContext.ts'),
  ]);
  assert.match(genealogy, /getSettings\(\)\.treeFocusPersonId/);
  assert.match(genealogy, /deriveTreeKinship/);
  assert.match(genealogy, /persona_central/);
  assert.match(genealogy, /parentesco_tag/);
  assert.match(genealogy, /parentesco_con_persona_central/);
  assert.match(nodi, /parentesco_con_persona_central/);
  assert.match(nodi, /buildGenealogyContext/);
  assert.match(assistant, /parentesco_con_persona_central/);
  assert.match(assistant, /buildGenealogyContext/);
});

test('Nodi chat keeps model selection inside settings and exposes deletable history and dedicated scrollbars', async () => {
  const [component, css, settings, picker, globalCss] = await Promise.all([
    read('src/components/nodi/NodiCompanion.tsx'),
    read('src/components/nodi/companion.css'),
    read('src/views/Settings.tsx'),
    read('src/components/ModelPicker.tsx'),
    read('src/index.css'),
  ]);
  for (const tool of ['history', 'contexts', 'settings']) assert.match(component, new RegExp(`'${tool}'`));
  assert.doesNotMatch(component, /chatTool === 'model'/);
  assert.doesNotMatch(component, /setChatTool\(\(tool\) => tool === 'model'/);
  assert.match(component, /<Markdown content=\{m\.content\} verify=\{false\}/);
  assert.match(component, /listNodiConversations/);
  assert.match(component, /saveNodiConversation/);
  assert.match(component, /nodiOpenSettings/);
  assert.match(component, /Inventario transversal con conteos y elementos relevantes de cada vault/);
  assert.match(component, /nodi-history-delete/);
  assert.match(component, /setDeleteConfirmation\(\{ kind: 'all' \}\)/);
  assert.match(component, /clearNodiConversations\(\)/);
  assert.match(component, /role="dialog" aria-modal="true"/);
  assert.match(component, /<ModelPicker[^>]* menu /);
  assert.match(css, /nodi-chat-msgs::-webkit-scrollbar/);
  assert.match(css, /nodi-chat-input::-webkit-scrollbar/);
  assert.match(css, /\.nodi-msg \.md table/);
  assert.match(css, /\.nodi-history-delete:hover/);
  assert.match(css, /\.nodi-confirm-overlay/);
  assert.match(css, /\.nodi-chat-tool \.model-picker-trigger/);
  assert.match(settings, /settings\.nodiModel/);
  assert.match(settings, /settings\.nodiModel[^\n]* compact menu/);
  assert.match(picker, /if \(menu\)/);
  assert.match(picker, /model-picker-options/);
  assert.match(globalCss, /\.model-picker-trigger/);
  assert.match(globalCss, /background-repeat: no-repeat/);
});

test('Nodi closes its eyes and centrifuges contracted limbs while thinking', async () => {
  const [component, figure, css] = await Promise.all([
    read('src/components/nodi/NodiCompanion.tsx'),
    read('src/components/nodi/Nodi.tsx'),
    read('src/components/nodi/nodi.css'),
  ]);
  assert.match(component, /streaming \? 'thinking'/, 'the live chat activates the thinking state');
  for (const limb of ['thinking-arm-l', 'thinking-arm-r', 'thinking-leg-l', 'thinking-leg-r']) assert.match(figure, new RegExp(limb));
  assert.match(css, /data-state="thinking"[^}]*\.eyes-open[^}]*display:\s*none/s);
  assert.match(css, /data-state="thinking"[^}]*\.eyes-sleep[^}]*display:\s*inline/s);
  assert.match(css, /animation:\s*nodi-centrifuge/);
  assert.match(css, /animation-play-state:\s*paused/, 'the rotor freezes at its current angle while fading back to rest');
  assert.match(css, /data-state="thinking"[^}]*\.limbs[^}]*scale\(\.7\)/s, 'normal limbs contract during the crossfade');
});

test('floating Nodi dismisses every open surface on an outside click or window blur', async () => {
  const [component, mascot, ipc, preload, types] = await Promise.all([
    read('src/components/nodi/NodiCompanion.tsx'),
    read('electron/mascotWindow.ts'),
    read('electron/ipc.ts'),
    read('electron/preload.ts'),
    read('shared/types.ts'),
  ]);
  assert.match(component, /const hasOpenSurface = menuOpen \|\| helpOpen \|\| panel !== 'none' \|\| contextMenuOpen \|\| closing/);
  assert.match(component, /nodiSetExpanded\(true\)/, 'the transparent overlay captures outside clicks while expanded');
  assert.match(component, /onNodiDismiss\(closeAll\)/, 'a native window dismissal closes menu, chat and help together');
  assert.match(mascot, /win\.on\('blur'/, 'clicking another application dismisses the overlay');
  assert.match(mascot, /webContents\.send\('nodi:dismiss'\)/);
  assert.match(ipc, /nodi:setExpanded/);
  assert.match(ipc, /setIgnoreMouseEvents\(!expanded/);
  assert.match(preload, /onNodiDismiss/);
  assert.match(types, /onNodiDismiss\(cb: \(\) => void\)/);
});

test('Nodi drags in absolute screen space and closes through an animated context action', async () => {
  const [component, figure, figureCss, companionCss, mascot, ipc, preload, types, english, app] = await Promise.all([
    read('src/components/nodi/NodiCompanion.tsx'),
    read('src/components/nodi/Nodi.tsx'),
    read('src/components/nodi/nodi.css'),
    read('src/components/nodi/companion.css'),
    read('electron/mascotWindow.ts'),
    read('electron/ipc.ts'),
    read('electron/preload.ts'),
    read('shared/types.ts'),
    read('src/i18n.en.ts'),
    read('src/App.tsx'),
  ]);
  assert.match(component, /e\.screenX - origin\.screenX/);
  assert.match(component, /e\.screenY - origin\.screenY/);
  assert.doesNotMatch(component, /e\.movement[XY]/, 'native-window movement must not distort the drag delta');
  for (const contract of ['nodiBeginWindowDrag', 'nodiDragWindow', 'nodiEndWindowDrag']) {
    assert.match(component, new RegExp(contract));
    assert.match(preload, new RegExp(contract));
    assert.match(types, new RegExp(contract));
  }
  assert.match(ipc, /nodi:windowDrag:begin/);
  assert.match(ipc, /nodi:windowDrag:move/);
  assert.match(mascot, /COMPACT_WIDTH = FIGURE_WIDTH \+ MARGIN \* 2/);
  assert.match(mascot, /placeWindowAroundNodi/);
  assert.match(mascot, /screen\.getDisplayNearestPoint/);
  assert.match(types, /horizontal: 'left' \| 'right'/);
  assert.match(component, /onContextMenu=\{onFigureContextMenu\}/);
  assert.match(component, /t\('Cerrar mascota'\)/);
  assert.match(component, /updateSettings\(\{ mascotEnabled: false \}\)/);
  assert.match(app, /onSettingsChanged\(\(\) => \{ void reloadSettings\(\); \}\)/, 'the main window unmounts Nodi after an overlay-originated settings change');
  assert.match(component, /closing \? 'closing'/);
  assert.match(figure, /closing-accessory-smoke/);
  assert.match(figure, /closing-body-smoke/);
  for (const animation of ['nodi-close-limb', 'nodi-close-accessory', 'nodi-close-face', 'nodi-close-core', 'nodi-close-smoke']) {
    assert.match(figureCss, new RegExp(animation));
  }
  assert.match(companionCss, /\.nodi-context-menu/);
  assert.match(companionCss, /\.nodi-anchor\.open-right/);
  assert.match(companionCss, /\.nodi-anchor\.open-down/);
  assert.match(english, /'Cerrar mascota': 'Close mascot'/);
});

test('Nodi receives aggregated, rate-limited lifecycle notifications', async () => {
  const [notifications, queue, embeddings, passages, component] = await Promise.all([
    read('electron/notifications.ts'),
    read('electron/pipeline/scanQueue.ts'),
    read('electron/ai/embeddingPipeline.ts'),
    read('electron/ai/passageEmbeddingPipeline.ts'),
    read('src/components/nodi/NodiCompanion.tsx'),
  ]);
  assert.match(notifications, /DEFAULT_COOLDOWN_MS/);
  assert.match(notifications, /dedupeKey/);
  assert.match(notifications, /lastEmitted/);
  assert.match(queue, /Cola de análisis completada/);
  assert.match(queue, /Nuevas conexiones en tu bóveda/);
  assert.match(queue, /Nodi ha encontrado relaciones semánticas/);
  assert.match(queue, /notifiedTerminalIds/);
  assert.match(embeddings, /Embeddings de ideas completados/);
  assert.match(passages, /Índice de textos completado/);
  assert.match(component, /onNotificationsChanged/);
  assert.match(component, /nodi-ntf-dot/);
  assert.match(component, /latestNotificationId/);
  assert.match(component, /setCelebrate\(true\)/);
});
