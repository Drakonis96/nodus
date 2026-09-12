import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatSkill } from '@shared/chatSkills';
import { installVerifiedPlugin, listInstalledPluginsV2, readPluginStateV2, type InstallOutcome } from './pluginStoreV2';

/** The 5.3.1 → 5.3.2 migration: three disciplines leave the application and become
 *  packages, without the user losing what they had.
 *
 *  The hard part is not installing anything. It is that a profile can be in many states —
 *  a built-in left alone, edited, deleted, disabled, duplicated by a downloaded copy, or
 *  depended on by a skill the user wrote — and each of those means something different
 *  about what should happen. Getting it wrong silently turns a working skill off, or
 *  restores something the user deliberately removed. */

export type MigrationPhase =
  | 'detected' | 'package-verified' | 'package-staged' | 'data-snapshotted'
  | 'data-migrated' | 'plugin-activated' | 'skill-adopted' | 'verified' | 'complete';

export const MIGRATION_PHASES: readonly MigrationPhase[] = [
  'detected', 'package-verified', 'package-staged', 'data-snapshotted',
  'data-migrated', 'plugin-activated', 'skill-adopted', 'verified', 'complete',
];

export interface MigrationJournalEntry {
  pluginId: string;
  phase: MigrationPhase;
  /** Why the package was wanted, so a later reader can tell a decision from an accident. */
  reason: MigrationReason;
  /** The local skill ids this package takes over. */
  skillIds: string[];
  updatedAt: string;
  failure?: string;
  attempts: number;
}

export interface MigrationJournal {
  schemaVersion: 1;
  startedAt: string;
  entries: MigrationJournalEntry[];
}

export type MigrationReason =
  | 'builtin-enabled'
  | 'downloaded-copy-enabled'
  | 'custom-skill-depends'
  | 'implicit-legacy-chemistry';

/** Which built-in becomes which package. */
export const MIGRATION_MAP: ReadonlyArray<{ builtin: string; skillId: string; pluginId: string; capabilityId: string }> = [
  { builtin: 'chemistry', skillId: 'builtin-chemistry', pluginId: 'chemistry-studio', capabilityId: 'nodus:chemistry' },
  { builtin: 'legal', skillId: 'builtin-legal', pluginId: 'legalize', capabilityId: 'nodus:legal' },
  { builtin: 'genomics', skillId: 'builtin-genomics', pluginId: 'alphagenome', capabilityId: 'nodus:genomics' },
];

const journalPath = () => path.join(app.getPath('userData'), 'profile-migrations', '5.3.2-capabilities.json');

export function readMigrationJournal(): MigrationJournal | null {
  try {
    const value = JSON.parse(fs.readFileSync(journalPath(), 'utf8')) as MigrationJournal;
    return value.schemaVersion === 1 && Array.isArray(value.entries) ? value : null;
  } catch { return null; }
}

/** The journal holds decisions and phases, never a credential and never a key: a file
 *  that records what happened must not become a second place a secret lives. */
export function writeMigrationJournal(journal: MigrationJournal): MigrationJournal {
  const target = journalPath();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, target);
  return journal;
}

export function recordPhase(pluginId: string, phase: MigrationPhase, extra: Partial<MigrationJournalEntry> = {}): MigrationJournal {
  const journal = readMigrationJournal() ?? { schemaVersion: 1 as const, startedAt: new Date().toISOString(), entries: [] };
  const existing = journal.entries.find(entry => entry.pluginId === pluginId);
  const next: MigrationJournalEntry = {
    pluginId,
    reason: extra.reason ?? existing?.reason ?? 'builtin-enabled',
    skillIds: extra.skillIds ?? existing?.skillIds ?? [],
    attempts: extra.attempts ?? existing?.attempts ?? 0,
    ...(extra.failure !== undefined ? { failure: extra.failure } : existing?.failure ? { failure: existing.failure } : {}),
    phase,
    updatedAt: new Date().toISOString(),
  };
  journal.entries = existing
    ? journal.entries.map(entry => entry.pluginId === pluginId ? next : entry)
    : [...journal.entries, next];
  return writeMigrationJournal(journal);
}

export interface MigrationTarget {
  pluginId: string;
  capabilityId: string;
  reason: MigrationReason;
  /** Local skills that will be adopted by this package. */
  skills: ChatSkill[];
}

/** Decides what a profile actually needs, from what is in it.
 *
 *  Four things earn a package. Everything else deliberately does not: a default left
 *  untouched, a default the user deleted, and a default the user turned off all mean the
 *  same thing here — nobody asked for this — and installing anyway would be the
 *  migration overruling a decision the user already made. */
export function detectMigrationTargets(skills: readonly ChatSkill[], options: { preLibraryProfile: boolean }): MigrationTarget[] {
  const targets: MigrationTarget[] = [];

  for (const entry of MIGRATION_MAP) {
    const adopted: ChatSkill[] = [];
    let reason: MigrationReason | undefined;

    const builtin = skills.find(skill => skill.builtin === entry.builtin);
    if (builtin && (builtin.enabled.assistant || builtin.enabled.nodi)) {
      reason = 'builtin-enabled';
      adopted.push(builtin);
    }

    // A copy downloaded from the official catalogue is the same package by another route.
    for (const skill of skills) {
      if (skill.builtin || !(skill.enabled.assistant || skill.enabled.nodi)) continue;
      if (skill.origin?.packageId !== entry.pluginId && skill.origin?.packageId !== entry.builtin) continue;
      reason ??= 'downloaded-copy-enabled';
      adopted.push(skill);
    }

    // A skill the user wrote that needs this capability has to keep working.
    const dependants = skills.filter(skill => !skill.builtin
      && (skill.enabled.assistant || skill.enabled.nodi)
      && (skill.capabilities ?? []).some(capability => capability === entry.capabilityId || capability === entry.builtin));
    if (dependants.length) reason ??= 'custom-skill-depends';

    // A profile from before the library existed had chemistry on by the behaviour of the
    // time. That is a real prior state, not an absence, so it is honoured — and it is a
    // fact recorded before any default was written, never the mere absence of a file a
    // clean install also lacks.
    if (options.preLibraryProfile && entry.builtin === 'chemistry') reason ??= 'implicit-legacy-chemistry';

    if (reason) targets.push({ pluginId: entry.pluginId, capabilityId: entry.capabilityId, reason, skills: adopted });
  }
  return targets;
}

export interface AdoptedSkill {
  skill: ChatSkill;
  /** Differences from the 5.3.1 baseline, kept as overlays rather than discarded. */
  overlay?: { name?: string; description?: string; instructions?: string };
  /** A user edit that cannot be expressed as an overlay survives as its own skill. */
  preserved?: ChatSkill;
}

/** Turns a built-in into a package-provided skill without losing the user's work.
 *
 *  The identity is kept — same local id, same position, same per-surface flags — so a
 *  conversation that referred to it still does. What the user changed becomes an overlay
 *  on the package's text. When an edit cannot be expressed that way, the edited copy is
 *  kept as a disabled personal skill rather than thrown away: the user's words are not
 *  the migration's to delete. */
export function adoptSkill(existing: ChatSkill, baseline: { name: string; description: string; instructions: string }, packaged: { name: string; description: string; instructions: string; version: string; plugin: { id: string; version: string; digest: string } }): AdoptedSkill {
  const overlay: { name?: string; description?: string; instructions?: string } = {};
  if (existing.name !== baseline.name) overlay.name = existing.name;
  if (existing.description !== baseline.description) overlay.description = existing.description;
  if (existing.instructions !== baseline.instructions) overlay.instructions = existing.instructions;

  const skill: ChatSkill = {
    ...existing,
    name: overlay.name ?? packaged.name,
    description: overlay.description ?? packaged.description,
    instructions: overlay.instructions ?? packaged.instructions,
    version: packaged.version,
    plugin: packaged.plugin,
    ...(Object.keys(overlay).length ? { overrides: { ...overlay } } : {}),
  };
  // `builtin` is what made this skill part of the application. It has to go, or the next
  // release would restore a default over a package-provided skill.
  delete (skill as { builtin?: string }).builtin;

  return { skill, ...(Object.keys(overlay).length ? { overlay } : {}) };
}

/** Two identical adoptions of the same package are one skill, not two. A profile that
 *  held both the built-in and a downloaded copy of it is the common case. */
export function consolidate(adopted: readonly AdoptedSkill[]): { skills: ChatSkill[]; preserved: ChatSkill[] } {
  const skills: ChatSkill[] = [];
  const preserved: ChatSkill[] = [];
  for (const entry of adopted) {
    const twin = skills.find(candidate => candidate.plugin?.id === entry.skill.plugin?.id);
    if (!twin) { skills.push(entry.skill); continue; }
    const identical = twin.instructions === entry.skill.instructions
      && twin.name === entry.skill.name
      && twin.description === entry.skill.description;
    if (identical) {
      // Keep the more permissive activation: turning a surface off is a decision, and the
      // consolidated skill should not be less enabled than either copy was.
      twin.enabled = { assistant: twin.enabled.assistant || entry.skill.enabled.assistant, nodi: twin.enabled.nodi || entry.skill.enabled.nodi };
      continue;
    }
    // Different text under the same package: the extra copy becomes a personal skill,
    // switched off, so nothing the user wrote is lost and nothing runs unasked.
    const { plugin, overrides, ...rest } = entry.skill;
    void plugin; void overrides;
    preserved.push({ ...rest, enabled: { assistant: false, nodi: false }, author: 'local', capabilities: entry.skill.capabilities ?? [] });
  }
  return { skills, preserved };
}

export interface BootstrapPackage {
  pluginId: string;
  archivePath: string;
  releaseManifestPath: string;
  signaturePath: string;
}

/** Packages shipped inside the application so the migration works with no network.
 *
 *  They are inert: nothing is registered, extracted or loaded on a clean install, and only
 *  the package the detection actually asked for is ever opened. They are verified exactly
 *  like a download — the signature is not skipped because the bytes arrived with the app. */
export function bootstrapPackages(): BootstrapPackage[] {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'capability-bootstrap')
    : path.join(app.getAppPath(), 'build', 'capability-bootstrap');
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(entry => {
        const dir = path.join(root, entry.name);
        const archive = fs.readdirSync(dir).find(name => name.endsWith('.nodus-plugin'));
        const manifest = path.join(dir, 'release-manifest.json');
        const signature = path.join(dir, 'release-manifest.sig');
        if (!archive || !fs.existsSync(manifest) || !fs.existsSync(signature)) return [];
        return [{ pluginId: entry.name, archivePath: path.join(dir, archive), releaseManifestPath: manifest, signaturePath: signature }];
      });
  } catch { return []; }
}

export interface MigrationInstaller {
  /** Fetches and installs from the catalogue. Absent or failing means offline. */
  online?: (pluginId: string) => Promise<InstallOutcome>;
}

/** Installs one package, preferring the copy that came with the application.
 *
 *  Offline first is deliberate: an update that only works with a working connection would
 *  turn three disciplines off for anyone who upgraded on a train. The network is the
 *  fallback, and it points at the pinned release rather than at whatever is newest. */
export async function installForMigration(pluginId: string, installer: MigrationInstaller = {}): Promise<InstallOutcome> {
  const bundled = bootstrapPackages().find(entry => entry.pluginId === pluginId);
  if (bundled) {
    try {
      return installVerifiedPlugin({
        archive: fs.readFileSync(bundled.archivePath),
        releaseManifestBytes: fs.readFileSync(bundled.releaseManifestPath),
        signature: fs.readFileSync(bundled.signaturePath),
        source: { id: 'nodusresearch/nodus-research-skill-marketplace', path: `plugins/${pluginId}`, commit: '' },
      }, { approvePermissions: true });
    } catch (error) {
      if (!installer.online) throw error;
    }
  }
  if (!installer.online) throw new Error(`${pluginId} is not bundled with this build and no catalogue is available.`);
  return installer.online(pluginId);
}

/** What is left to do, so a failed migration can be retried without redoing the rest. */
export function pendingMigrations(): MigrationJournalEntry[] {
  const journal = readMigrationJournal();
  if (!journal) return [];
  return journal.entries.filter(entry => entry.phase !== 'complete');
}

/** True once every package a profile needed is installed and recorded complete. */
export function migrationSettled(): boolean {
  const journal = readMigrationJournal();
  if (!journal) return true;
  return journal.entries.every(entry => entry.phase === 'complete'
    || readPluginStateV2(entry.pluginId)?.status === 'ready' && listInstalledPluginsV2().some(state => state.id === entry.pluginId));
}

export interface MigrationContext {
  /** The library as it stands, and how to write it back. */
  readSkills: () => ChatSkill[];
  writeSkills: (skills: ChatSkill[]) => void;
  /** The 5.3.1 text each built-in shipped with, so a user edit can be told from a default. */
  baseline: (builtin: string) => { name: string; description: string; instructions: string } | undefined;
  /** The package's own skill text, read from what was installed. */
  packaged: (pluginId: string) => { id: string; name: string; description: string; instructions: string; version: string; digest: string } | undefined;
  /** Disciplinary data the built-in left in the profile, handed to the package's migration. */
  legacyData: (pluginId: string) => unknown;
  /** Runs the package's own data migration inside its worker. */
  migrateData: (pluginId: string, legacy: unknown) => Promise<void>;
  installer?: MigrationInstaller;
  /** Whether this profile was in use before skills had a library. */
  preLibraryProfile: boolean;
}

export interface MigrationOutcome {
  installed: string[];
  adopted: string[];
  preserved: string[];
  failed: Array<{ pluginId: string; phase: MigrationPhase; detail: string }>;
}

/** The whole 5.3.1 → 5.3.2 move, phase by phase and resumable.
 *
 *  Each phase is idempotent and recorded before the next begins, so a crash anywhere
 *  resumes rather than restarts — and a failure leaves the skill with the activation the
 *  user chose, the previous data untouched, and something to retry. A migration that
 *  cannot finish must not become a silent deactivation. */
export async function runCapabilityMigration(context: MigrationContext): Promise<MigrationOutcome> {
  const outcome: MigrationOutcome = { installed: [], adopted: [], preserved: [], failed: [] };
  const targets = detectMigrationTargets(context.readSkills(), { preLibraryProfile: context.preLibraryProfile });
  if (!targets.length) return outcome;

  for (const target of targets) {
    const journalled = readMigrationJournal()?.entries.find(entry => entry.pluginId === target.pluginId);
    if (journalled?.phase === 'complete') continue;
    let phase: MigrationPhase = 'detected';
    recordPhase(target.pluginId, phase, {
      reason: target.reason,
      skillIds: target.skills.map(skill => skill.id),
      attempts: (journalled?.attempts ?? 0) + 1,
    });

    try {
      // Already installed from an earlier attempt: the phases below are idempotent, so
      // resuming skips the work rather than repeating it.
      if (readPluginStateV2(target.pluginId)?.active) {
        recordPhase(target.pluginId, phase = 'plugin-activated');
      } else {
        recordPhase(target.pluginId, phase = 'package-verified');
        const installed = await installForMigration(target.pluginId, context.installer);
        recordPhase(target.pluginId, phase = 'package-staged');
        if (!installed.activated) throw new Error(`${target.pluginId} was staged but not activated (${installed.state.status}).`);
        outcome.installed.push(target.pluginId);
        recordPhase(target.pluginId, phase = 'plugin-activated');
      }

      recordPhase(target.pluginId, phase = 'data-snapshotted');
      const legacy = context.legacyData(target.pluginId);
      await context.migrateData(target.pluginId, legacy);
      recordPhase(target.pluginId, phase = 'data-migrated');

      const packaged = context.packaged(target.pluginId);
      if (!packaged) throw new Error(`${target.pluginId} supplies no skill to adopt.`);
      const adopted: AdoptedSkill[] = [];
      for (const skill of target.skills) {
        const baseline = skill.builtin ? context.baseline(skill.builtin) : { name: skill.name, description: skill.description, instructions: skill.instructions };
        adopted.push(adoptSkill(skill, baseline ?? { name: packaged.name, description: packaged.description, instructions: packaged.instructions }, {
          name: packaged.name, description: packaged.description, instructions: packaged.instructions,
          version: packaged.version, plugin: { id: packaged.id, version: packaged.version, digest: packaged.digest },
        }));
      }
      const { skills: consolidated, preserved } = consolidate(adopted);
      const replaced = new Set(target.skills.map(skill => skill.id));
      const library = context.readSkills();
      // Position is kept by replacing in place: a skill that moves in the list looks to
      // the user like a different skill.
      const next: ChatSkill[] = [];
      let inserted = false;
      for (const skill of library) {
        if (!replaced.has(skill.id)) { next.push(skill); continue; }
        if (inserted) continue;
        next.push(...consolidated);
        inserted = true;
      }
      context.writeSkills([...next, ...preserved]);
      outcome.adopted.push(...consolidated.map(skill => skill.id));
      outcome.preserved.push(...preserved.map(skill => skill.id));
      recordPhase(target.pluginId, phase = 'skill-adopted');

      const state = readPluginStateV2(target.pluginId);
      if (state?.status !== 'ready') throw new Error(`${target.pluginId} is ${state?.status ?? 'missing'} after activation.`);
      recordPhase(target.pluginId, phase = 'verified');
      recordPhase(target.pluginId, 'complete', { failure: undefined });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      recordPhase(target.pluginId, phase, { failure: detail });
      outcome.failed.push({ pluginId: target.pluginId, phase, detail });
    }
  }
  return outcome;
}

/** The skill text a package supplies, read from the version that is actually installed. */
export function pinnedPluginSkill(pluginId: string): { id: string; name: string; description: string; instructions: string; version: string; digest: string } | undefined {
  const state = readPluginStateV2(pluginId);
  if (!state?.active) return undefined;
  const root = path.join(app.getPath('userData'), 'plugins', 'installed', pluginId, 'versions', `${state.active.version}-${state.active.digest}`);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')) as { skills: string[] };
    const relative = manifest.skills[0];
    const skill = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')) as { name: string; description: string; version: string };
    const instructions = fs.readFileSync(path.join(root, path.dirname(relative), 'SKILL.md'), 'utf8');
    return { id: pluginId, name: skill.name, description: skill.description, instructions, version: skill.version, digest: state.active.digest };
  } catch { return undefined; }
}
