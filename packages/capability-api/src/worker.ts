import type { LocalizedText } from './localized';
import type { ViewDocumentV1 } from './views';
import type { WorkerArtifactV1 } from './artifacts';
import type { ChatAstNode, FinalMutation, PrepareMutation } from './chat';
import type { SettingsActionInput, SettingsStateV1, SettingsSubmissionV1 } from './settings';

/** The interface a trusted worker module default-exports. The host calls nothing else.
 *
 *  The signature is the security boundary: this is first-party code with roughly the
 *  privilege of an application update. The separate process buys fault isolation,
 *  cancellation and hard limits — not a security sandbox, and it is not sold as one. */
export interface CapabilityWorkerV2 {
  health(context: HealthContext): Promise<HealthResult>;
  prepareChat?(input: PrepareChatInput): Promise<PrepareMutation[]>;
  invoke(input: ToolInvocationV2): Promise<WorkerInvocationResultV1>;
  finalizeChat?(input: FinalizeChatInput): Promise<FinalMutation[]>;
  renderArtifact(input: RenderArtifactInput): Promise<ViewDocumentV1>;
  projectArtifactForModel?(input: ArtifactProjectionInput): Promise<string>;
  getSettings?(): Promise<SettingsStateV1>;
  applySettings?(input: SettingsSubmissionV1): Promise<SettingsStateV1>;
  runAction?(input: SettingsActionInput): Promise<SettingsStateV1>;
  migrate?(input: MigrationInputV1): Promise<MigrationResultV1>;
  shutdown(): Promise<void>;
}

export interface HealthContext {
  nodusVersion: string;
  locale: string;
  platform: NodeJS.Platform | string;
  arch: string;
  /** Data version currently on disk, so a worker can report that it needs a migration. */
  dataVersion: number;
}

export interface HealthResult {
  status: 'ready' | 'degraded' | 'needs-setup' | 'needs-migration';
  detail?: LocalizedText;
  /** Data version this build writes. A higher number than on disk requests a migration. */
  dataVersion: number;
}

export interface ToolInvocationV2 {
  invocationId: string;
  toolId: string;
  input: unknown;
  locale: string;
  /** Present only when the invocation came from a chat reply. */
  chat?: { question?: string; nodeId?: string };
}

export interface WorkerInvocationResultV1 {
  artifacts?: WorkerArtifactV1[];
  /** Rendered directly when the tool produced no artifact worth persisting. */
  view?: ViewDocumentV1;
  notices?: ViewDocumentV1[];
}

export interface PrepareChatInput { nodes: ChatAstNode[]; question?: string; locale: string }
export interface FinalizeChatInput { nodes: ChatAstNode[]; locale: string }
export interface RenderArtifactInput { artifactType: string; artifactVersion: number; data: unknown; locale: string }
export interface ArtifactProjectionInput { artifactType: string; artifactVersion: number; data: unknown }
export interface MigrationInputV1 { fromDataVersion: number; toDataVersion: number }
export interface MigrationResultV1 { dataVersion: number; notes?: string }

/** What the host offers back. Every method is permission-gated by the capability manifest;
 *  calling one the manifest did not declare is an error, not a silent no-op. */
export interface CapabilityHostV2 {
  network: {
    fetch(endpointId: string, request: { path: string; method?: string; headers?: Record<string, string>; body?: string | Uint8Array }): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>;
    /** Streams to a temp file instead of buffering, for archives too large to hold. */
    downloadToTemp(endpointId: string, request: { path: string; method?: string; headers?: Record<string, string> }): Promise<{ status: number; path: string; bytes: number }>;
  };
  storage: {
    state: KeyValueStore;
    cache: KeyValueStore;
    temp: { dir(): Promise<string>; clear(): Promise<void> };
  };
  secrets: {
    has(id: string): Promise<boolean>;
    store(id: string, value: string): Promise<void>;
    delete(id: string): Promise<void>;
  };
  model: {
    complete(request: { system?: string; prompt: string; maxTokens?: number }): Promise<string>;
  };
  svg: {
    validate(svg: string): Promise<{ ok: boolean; errors: string[] }>;
    inspect(svg: string): Promise<{ width?: number; height?: number; elements: number }>;
    refine(request: { svg: string; instruction: string }): Promise<string>;
  };
  subworker: {
    run(request: { entry: string; input: unknown; timeoutMs: number }): Promise<unknown>;
  };
  python: {
    ensureRuntime(runtimeId: string): Promise<{ ready: boolean; detail?: string }>;
    run(request: { runtimeId: string; args: string[]; stdin?: string; secretId?: string; timeoutMs: number }): Promise<{ code: number; stdout: string; stderr: string }>;
  };
  attachments: {
    /** Stores bytes and returns the id a `download` view node refers to. */
    store(request: { bytes: Uint8Array; name: string; mimeType: string }): Promise<{ attachmentId: string; bytes: number }>;
  };
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, detail?: Record<string, string | number | boolean>): void;
  /** Aborts when the host cancels or the chat the invocation belongs to goes away. */
  readonly signal: AbortSignal;
}

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Modules export their worker through this, so the host has one shape to look for. */
export type CapabilityWorkerFactory = (host: CapabilityHostV2) => CapabilityWorkerV2 | Promise<CapabilityWorkerV2>;
