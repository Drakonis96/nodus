/** What the renderer needs to know about capabilities, and nothing more.
 *
 *  Types only: every payload here has already been validated in the main process, so the
 *  interface renders what it is given instead of re-deciding whether it is safe. */
import type { ArtifactTypeManifestV1 } from '../packages/capability-api/src/artifacts';
import type { CapabilityChatContractV2 } from '../packages/capability-api/src/chat';
import type { CapabilityCatalogV2 } from '../packages/capability-api/src/catalog';
import type { SettingsFieldV1, SettingsManifestV1, SettingsStateV1, SettingsSubmissionV1 } from '../packages/capability-api/src/settings';
import type { ViewDocumentV1, ViewNode, ViewSpan, ViewTone } from '../packages/capability-api/src/views';
import type { JsonSchema } from '../packages/capability-api/src/json';

export type { ArtifactTypeManifestV1, CapabilityCatalogV2, SettingsFieldV1, SettingsManifestV1, SettingsStateV1, SettingsSubmissionV1, ViewDocumentV1, ViewNode, ViewSpan, ViewTone };

export interface CapabilityProviderSummary {
  id: string;
  version: string;
  description: string;
  source: 'core' | 'plugin';
  plugin?: { id: string; version: string; digest: string };
  tools: Array<{ id: string; description: string; metered: boolean }>;
  artifacts: ArtifactTypeManifestV1[];
  chat?: { priority: number; pendingLabel: CapabilityChatContractV2['pendingLabel'] };
  hasSettings: boolean;
}

export interface InstalledCapabilityPlugin {
  id: string;
  source: { id: string; path: string; commit: string };
  trust: { publisher: string; keyId: string; verified: true };
  active?: { version: string; digest: string; target: string; installedAt: string };
  previous?: { version: string; digest: string; target: string; installedAt: string };
  pending?: { version: string; digest: string; target: string; installedAt: string; reason: string };
  status: 'ready' | 'degraded' | 'pending-permissions' | 'pending-migration' | 'failed';
  autoUpdate: boolean;
  rollbackAvailable: boolean;
  dataVersion: number;
}

export interface CapabilityRegistryPayload {
  revision: number;
  providers: CapabilityProviderSummary[];
  problems: Array<{ pluginId: string; detail: string }>;
}

export interface CapabilityListPayload extends CapabilityRegistryPayload {
  plugins: InstalledCapabilityPlugin[];
  catalog: { sourceId: string; url: string; commit: string; fetchedAt: string; catalog: CapabilityCatalogV2 } | null;
}

export interface ArtifactSidecarSummary {
  source: string;
  capabilityId: string;
  plugin: { id: string; version: string; digest: string };
  artifactType: string;
  artifactVersion: number;
  summary: string;
  modelVisibility: 'none' | 'projection';
  sha256: string;
  bytes: number;
  createdAt: string;
}

export type ArtifactRenderResult =
  | { available: true; sidecar: ArtifactSidecarSummary; view: ViewDocumentV1 }
  | { available: false; reason: 'missing' }
  | { available: false; reason: 'no-provider' | 'unreadable'; sidecar: ArtifactSidecarSummary };

export interface CapabilitySettingsPayload { manifest: SettingsManifestV1; state: SettingsStateV1 }

export interface CapabilityHealthPayload { status: 'ready' | 'degraded' | 'needs-setup' | 'needs-migration'; detail?: Record<string, string>; dataVersion: number }

/** A tool's input schema reaches the renderer as data it only displays. */
export type CapabilityToolSchema = JsonSchema;
