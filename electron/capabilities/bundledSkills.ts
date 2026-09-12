import fs from 'node:fs';
import path from 'node:path';
import { validateManifest, validateSkillPackage } from '@shared/skillMarketplace';
import { activePluginRoot, readPluginStateV2, readStagedPackage } from './pluginStoreV2';

/** Reads author content only from an active signed package whose migrations finished. */
export function readTrustedPluginSkills(pluginId: string) {
  const state = readPluginStateV2(pluginId), root = activePluginRoot(pluginId);
  if (!state?.active || !root) return null;
  const pkg = readStagedPackage(root, state.active.digest, state.active.target);
  if (state.dataVersion < pkg.manifest.migrations.length) return null;
  const packaged = pkg.manifest.skills.map(relative => {
    const manifestPath = path.join(root, ...relative.split('/'));
    const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    if (manifest.version !== pkg.manifest.version || manifest.id !== relative.split('/')[1]) throw new Error('Bundled Skill identity/version does not match the signed package.');
    const base = path.dirname(manifestPath);
    const files = Object.fromEntries(['SKILL.md', ...manifest.tools.map(tool => tool.entry)].map(file => [file, fs.readFileSync(path.join(base, ...file.split('/')), 'utf8')]));
    return validateSkillPackage({ manifest, files });
  });
  if (new Set(packaged.map(skill => skill.manifest.id)).size !== packaged.length) throw new Error('Duplicate bundled Skill.');
  return { state, pkg, packaged };
}
