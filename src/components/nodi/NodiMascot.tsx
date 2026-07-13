import type { AppSettings } from '@shared/types';
import { NodiCompanion } from './NodiCompanion';

/** In-window mascot: renders the interactive Nodi companion anchored bottom-right of
 *  the app. Hidden when Nodi is disabled or living in its own always-on-top window. */
export function NodiMascot({ settings }: { settings: AppSettings }) {
  if (!settings.mascotEnabled || settings.mascotAlwaysOnTop) return null;
  return <NodiCompanion context="app" costumes={settings.mascotVaultCostumes} />;
}
