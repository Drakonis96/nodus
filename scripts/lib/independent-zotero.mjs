/** A disposable Zotero 10 for isolated Research scenarios: its own profile, data directory
 * and local API port under a proven sandbox, seeded by a one-shot bootstrap extension with
 * the given records. Never the user's Zotero, never synchronised. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import AdmZip from 'adm-zip';
import { researchTestEnvironment } from '../research-isolation.mjs';

/** records: [{ title, abstract, file, sha256, collection?, creators?, date?, itemType? }];
 * `policy` is the sandbox profile already verified for `root`, and must allow `port`.
 * Without `collections`, each record gets a collection of its own. With `collections`
 * ([{ name, parent? }], parents first), a record lives in the collection it names and a
 * record without `file` has no attachment. Resolves once the seeded corpus is written. */
export async function launchIndependentZotero({ root, port, policy, records, collections: layout = null }) {
  const profile = path.join(root, 'zotero/profile');
  const data = path.join(root, 'zotero/data');
  fs.mkdirSync(path.join(profile, 'extensions'), { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  const prefs = {
    'extensions.zotero.useDataDir': true, 'extensions.zotero.dataDir': data,
    'extensions.zotero.sync.autoSync': false, 'extensions.zotero.sync.storage.enabled': false,
    'extensions.zotero.httpServer.enabled': true, 'extensions.zotero.httpServer.port': port,
    'extensions.zotero.httpServer.localAPI.enabled': true,
    'extensions.zotero.automaticScraperUpdates': false, 'extensions.zotero.firstRun2': false,
    'extensions.zotero.firstRunGuidance': false, 'app.update.enabled': false, 'app.update.auto': false,
    'extensions.update.enabled': false, 'extensions.autoDisableScopes': 0, 'extensions.enabledScopes': 15,
    'xpinstall.signatures.required': false, 'toolkit.telemetry.enabled': false,
    'datareporting.healthreport.uploadEnabled': false, 'browser.shell.checkDefaultBrowser': false,
    'extensions.zoteroMacWordIntegration.skipInstallation': true,
    'extensions.zoteroOpenOfficeIntegration.skipInstallation': true,
    'network.process.enabled': false, 'security.sandbox.content.level': 0,
    'extensions.logging.enabled': true,
    'extensions.zotero.debug.log': true,
  };
  fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
  const output = path.join(root, 'artifacts/zotero-corpus.json');
  const extensionId = 'nodus-fixture-preparer@tests.invalid';
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ manifest_version: 2, name: 'Nodus isolated fixture preparer', version: '1.0',
    applications: { zotero: { id: extensionId, update_url: 'https://tests.invalid/no-update', strict_min_version: '9.0', strict_max_version: '10.*' } } })));
  zip.addFile('bootstrap.js', Buffer.from(`
  function install() {}
  function uninstall() {}
  function shutdown() {}
  async function startup() {
    await Zotero.initializationPromise;
    try {
      if (Zotero.DataDirectory.dir !== ${JSON.stringify(data)}) throw new Error('unexpected_data_directory');
      await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
      const collections = [], items = [];
      const layout = ${JSON.stringify(layout)};
      const byName = new Map();
      for (const entry of layout ?? []) {
        const collection = new Zotero.Collection();
        collection.libraryID = Zotero.Libraries.userLibraryID;
        collection.name = entry.name;
        if (entry.parent) collection.parentID = byName.get(entry.parent).id;
        await collection.saveTx();
        byName.set(entry.name, collection);
        collections.push({ id: collection.id, key: collection.key, name: entry.name, parentKey: entry.parent ? byName.get(entry.parent).key : null });
      }
      for (const [index, record] of ${JSON.stringify(records)}.entries()) {
        let collection = layout ? byName.get(record.collection) : null;
        if (!collection) {
          collection = new Zotero.Collection();
          collection.libraryID = Zotero.Libraries.userLibraryID;
          collection.name = 'Nodus synthetic collection ' + (index + 1);
          await collection.saveTx();
          collections.push({ id: collection.id, key: collection.key });
        }
        const item = new Zotero.Item(record.itemType ?? 'report');
        item.libraryID = Zotero.Libraries.userLibraryID;
        item.setField('title', record.title);
        item.setField('abstractNote', record.abstract);
        if (record.date) item.setField('date', record.date);
        if (record.creators) item.setCreators(record.creators);
        item.setCollections([collection.id]);
        await item.saveTx();
        if (!record.file) { items.push({ id: item.id, key: item.key, version: item.version, collection: collection.key, attachment: null }); continue; }
        const attachment = await Zotero.Attachments.importFromFile({ file: record.file, parentItemID: item.id });
        await Zotero.Fulltext.indexItems([attachment.id]);
        items.push({ id: item.id, key: item.key, version: item.version, collection: collection.key, attachment: { key: attachment.key, version: attachment.version, path: await attachment.getFilePathAsync(), sha256: record.sha256 } });
      }
      await Zotero.File.putContentsAsync(${JSON.stringify(output)}, JSON.stringify({ version: Zotero.version, dataDirectory: Zotero.DataDirectory.dir, libraryID: Zotero.Libraries.userLibraryID, collections, items }));
      Zotero.getMainWindow().document.title = 'Zotero · Nodus Research · Desarrollo';
    } catch (error) { await Zotero.File.putContentsAsync(${JSON.stringify(output)}, JSON.stringify({ error: String(error) })); }
  }
  `));
  zip.writeZip(path.join(profile, 'extensions', `${extensionId}.xpi`));
  fs.writeFileSync(path.join(root, 'isolation.sb'), policy);
  const log = fs.openSync(path.join(root, 'artifacts/zotero.log'), 'w');
  const child = spawn('/usr/bin/sandbox-exec', ['-f', path.join(root, 'isolation.sb'), '/Applications/Zotero.app/Contents/MacOS/zotero', '-no-remote', '-ZoteroDebugText', '-profile', profile, '-datadir', data], {
    cwd: root, env: { ...researchTestEnvironment(root), HOME: root, MOZ_NO_REMOTE: '1', MOZ_DISABLE_CONTENT_SANDBOX: '1',
      MOZ_DISABLE_SOCKET_PROCESS_SANDBOX: '1', MOZ_DISABLE_RDD_SANDBOX: '1', MOZ_DISABLE_GMP_SANDBOX: '1', MOZ_DISABLE_GPU_SANDBOX: '1' }, stdio: ['ignore', log, log],
  });
  const stop = async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.closeSync(log);
  };
  try {
    const deadline = Date.now() + 55000;
    while (!fs.existsSync(output) && Date.now() < deadline && child.exitCode === null) await new Promise(resolve => setTimeout(resolve, 250));
    if (!fs.existsSync(output)) throw new Error(`Zotero fixture preparation did not finish; inspect ${root}/artifacts/zotero.log`);
    const corpus = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (corpus.error) throw new Error(corpus.error);
    return { corpus, child, profile, data, endpoint: `http://127.0.0.1:${port}/api`, stop };
  } catch (error) { await stop(); throw error; }
}
