import type { AppSettings, ModelRef } from './types';

export const SERVER_PROFILE_PREFERENCES_VERSION: 1;
export const SERVER_PROFILE_MODEL_FIELDS: readonly string[];

export type ServerProfilePreferences = {
  schemaVersion: 1;
  appearance: {
    theme: AppSettings['theme']; uiLanguage: AppSettings['uiLanguage']; promptLanguage: AppSettings['promptLanguage'];
    animationSpeed: number; interfaceScale: number; accessibleFont: boolean; highContrast: boolean;
    reduceMotion: boolean; readingFocusMode: boolean;
    mascot: { enabled: boolean; scale: number; vaultCostumes: boolean; style: AppSettings['mascotStyle']; orbColorMode: AppSettings['mascotOrbColorMode']; orbColor: string };
  };
  ai: {
    favorites: ModelRef[]; modelSettingsMode: AppSettings['modelSettingsMode']; modelSettingsVersion: number;
    models: Record<string, ModelRef | null>; chatReasoning: AppSettings['chatReasoning'];
    codexReasoningEfforts: Record<string, string>; preferFastOpenRouter: boolean;
    providerFreeTier: Record<string, boolean>;
    image: { provider: string; model: string; quality: string; style: string };
    audio: { provider: string; voice: string; speed: number };
    studyPolicy: { enabled: boolean; privacyMode: AppSettings['studyAiPrivacyMode']; confirmExternal: boolean; monthlyBudgetUsd: number; budgetWarningPercent: number; maxInputChars: number; maxOutputTokens: number; temperature: number; retryCount: number; studentPseudonyms: boolean };
  };
  workspace: { sidebarOrder: string[]; sidebarHidden: string[]; sidebarCustomized: boolean; concurrency: number; deepContextMode: AppSettings['deepContextMode']; standardChunkWords: number; longChunkWords: number };
};

export class ServerProfilePreferenceError extends Error { code: string }
export function extractServerProfilePreferences(settings: AppSettings): ServerProfilePreferences;
export function sanitizeServerProfilePreferences(value: unknown): ServerProfilePreferences;
export function aiPreferencesFromServerProfile(profile: ServerProfilePreferences, supportedProviders?: readonly string[]): Record<string, unknown>;
