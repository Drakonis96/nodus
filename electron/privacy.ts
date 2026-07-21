import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  shell,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
} from 'electron';

export function privacyPolicyPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'legal', 'PRIVACY.md')
    : path.join(app.getAppPath(), 'PRIVACY.md');
}

export async function openPrivacyPolicy(): Promise<void> {
  const target = privacyPolicyPath();
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
}

/**
 * The single entry point every importer uses to open a native file/folder
 * picker. File imports are processed locally and no longer show an in-app
 * privacy modal; centralising the picker here keeps that guarantee auditable
 * (see scripts/test-privacy-compliance.mjs).
 */
export async function showImportOpenDialog(
  parentOrOptions: BrowserWindow | OpenDialogOptions,
  maybeOptions?: OpenDialogOptions,
): Promise<OpenDialogReturnValue> {
  const parent = maybeOptions ? parentOrOptions as BrowserWindow | undefined : undefined;
  const options = maybeOptions ?? parentOrOptions as OpenDialogOptions;
  return parent
    ? dialog.showOpenDialog(parent, options)
    : dialog.showOpenDialog(options);
}
