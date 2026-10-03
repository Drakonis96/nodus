import { t } from '../../i18n';

/** Store local attachments in the native document, asynchronously and without IPC. */
export async function uploadEditorFile(file: File): Promise<string> {
  if (file.size > 2_000_000) throw new Error(t('El archivo supera 2 MB.'));
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(t('No se pudo cargar el archivo.')));
    reader.readAsDataURL(file);
  });
}
