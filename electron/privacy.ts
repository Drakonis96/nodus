import path from 'node:path';
import {
  app,
  dialog,
  shell,
  type BrowserWindow,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
} from 'electron';

type Copy = {
  title: string;
  message: string;
  detail: string;
  cancel: string;
  policy: string;
  continue: string;
};

const COPY: Record<string, Copy> = {
  es: {
    title: 'Privacidad antes de incorporar archivos',
    message: 'Seleccionar un archivo lo incorpora a Nodus de forma local; no lo sube a un servidor de Nodus.',
    detail: 'Continúa solo si estás autorizado para tratar su contenido. Si más adelante activas una función remota, esa acción puede enviar el contenido necesario al proveedor elegido bajo sus condiciones. Evita datos personales o confidenciales que no sean necesarios.',
    cancel: 'Cancelar', policy: 'Leer privacidad', continue: 'Continuar',
  },
  en: {
    title: 'Privacy before adding files',
    message: 'Selecting a file adds it to Nodus locally; it is not uploaded to a Nodus server.',
    detail: 'Continue only if you are authorised to process its contents. If you later activate a remote feature, that action may send the necessary content to your selected provider under its terms. Avoid unnecessary personal or confidential data.',
    cancel: 'Cancel', policy: 'Read privacy policy', continue: 'Continue',
  },
  fr: {
    title: 'Confidentialité avant l’ajout de fichiers',
    message: 'Le fichier sélectionné est ajouté localement à Nodus ; il n’est pas envoyé à un serveur Nodus.',
    detail: 'Continuez uniquement si vous êtes autorisé à traiter son contenu. Une fonction distante activée ultérieurement peut envoyer le contenu nécessaire au fournisseur choisi selon ses conditions. Évitez les données personnelles ou confidentielles inutiles.',
    cancel: 'Annuler', policy: 'Lire la politique', continue: 'Continuer',
  },
  de: {
    title: 'Datenschutz vor dem Hinzufügen von Dateien',
    message: 'Die ausgewählte Datei wird lokal zu Nodus hinzugefügt und nicht auf einen Nodus-Server hochgeladen.',
    detail: 'Fahren Sie nur fort, wenn Sie den Inhalt verarbeiten dürfen. Eine später aktivierte Online-Funktion kann erforderliche Inhalte gemäß den Bedingungen an den gewählten Anbieter senden. Vermeiden Sie unnötige personenbezogene oder vertrauliche Daten.',
    cancel: 'Abbrechen', policy: 'Datenschutz lesen', continue: 'Fortfahren',
  },
  pt: {
    title: 'Privacidade antes de adicionar ficheiros',
    message: 'O ficheiro selecionado é adicionado localmente ao Nodus; não é enviado para um servidor Nodus.',
    detail: 'Continue apenas se estiver autorizado a tratar o conteúdo. Uma função remota ativada posteriormente pode enviar o conteúdo necessário ao fornecedor escolhido, segundo os respetivos termos. Evite dados pessoais ou confidenciais desnecessários.',
    cancel: 'Cancelar', policy: 'Ler privacidade', continue: 'Continuar',
  },
  it: {
    title: 'Privacy prima di aggiungere file',
    message: 'Il file selezionato viene aggiunto localmente a Nodus; non viene caricato su un server Nodus.',
    detail: 'Continua solo se sei autorizzato a trattarne il contenuto. Una funzione remota attivata in seguito può inviare il contenuto necessario al fornitore scelto secondo le sue condizioni. Evita dati personali o riservati non necessari.',
    cancel: 'Annulla', policy: 'Leggi la privacy', continue: 'Continua',
  },
};

function copy(): Copy {
  const locale = app.getLocale().toLowerCase();
  if (locale.startsWith('pt')) return COPY.pt;
  return COPY[locale.split('-')[0]] ?? COPY.en;
}

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
 * Just-in-time first layer for every native file/folder picker used to ingest data.
 * Reading the full policy cancels the current picker, so no file can be selected
 * accidentally behind the document window.
 */
export async function showPrivacyAwareOpenDialog(
  parentOrOptions: BrowserWindow | OpenDialogOptions,
  maybeOptions?: OpenDialogOptions,
): Promise<OpenDialogReturnValue> {
  const parent = maybeOptions ? parentOrOptions as BrowserWindow : null;
  const options = maybeOptions ?? parentOrOptions as OpenDialogOptions;
  const c = copy();
  const box = {
    type: 'info' as const,
    title: c.title,
    message: c.message,
    detail: c.detail,
    buttons: [c.cancel, c.policy, c.continue],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const answer = parent
    ? await dialog.showMessageBox(parent, box)
    : await dialog.showMessageBox(box);
  if (answer.response === 1) {
    await openPrivacyPolicy();
    return { canceled: true, filePaths: [] };
  }
  if (answer.response !== 2) return { canceled: true, filePaths: [] };
  return parent
    ? dialog.showOpenDialog(parent, options)
    : dialog.showOpenDialog(options);
}
