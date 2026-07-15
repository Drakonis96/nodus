import { motion } from 'framer-motion';
import { useState } from 'react';
import type {
  RecoveryFolderInspection,
  RecoverySetupResult,
  RecoveryStatus,
} from '@shared/types';
import { Icon } from '../components/ui';
import { Nodi } from '../components/nodi/Nodi';

type Mode = 'create' | 'restore';

export function RecoverySetupWizard({
  status,
  language,
  onComplete,
}: {
  status: RecoveryStatus;
  language: 'es' | 'en';
  onComplete: () => void | Promise<void>;
}) {
  const es = language !== 'en';
  const [mode, setMode] = useState<Mode>('create');
  const [folder, setFolder] = useState<RecoveryFolderInspection | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryKeyCopied, setRecoveryKeyCopied] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecoverySetupResult | null>(null);

  const snapshots = folder?.snapshots ?? [];
  const effectiveSnapshot = selectedSnapshot || snapshots[0]?.fileName || '';
  const canSubmit = mode === 'create'
    ? folder?.kind === 'empty' && password.trim().length >= 8 && password === confirmPassword
    : folder?.kind === 'recovery' && Boolean(effectiveSnapshot) && password.trim().length >= 8;

  const chooseFolder = async () => {
    const picked = await window.nodus.chooseRecoveryFolder(mode, language);
    if (!picked) return;
    setFolder(picked);
    setSelectedSnapshot(picked.snapshots[0]?.fileName ?? '');
    setResult(null);
  };

  const submit = async () => {
    if (!folder || !canSubmit) return;
    setBusy(true);
    setResult(null);
    try {
      const next = mode === 'create'
        ? await window.nodus.initializeRecoveryFolder(folder.path, password, language)
        : await window.nodus.restoreRecoverySnapshot(folder.path, effectiveSnapshot, password, language);
      setResult(next);
    } finally {
      setBusy(false);
    }
  };

  if (result?.ok) {
    return (
      <div className="recovery-cinema" data-testid="recovery-setup-success">
        <div className="recovery-aurora" aria-hidden="true" />
        <motion.main className="recovery-card recovery-success" initial={{ opacity: 0, y: 24, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
          <Nodi state="celebrating" height={220} />
          <div>
            <span className="recovery-kicker"><Icon name="check" size={14} /> {es ? 'RECUPERACIÓN ACTIVADA' : 'RECOVERY ENABLED'}</span>
            <h1>{mode === 'create' ? (es ? 'Tus datos ya están protegidos' : 'Your data is now protected') : (es ? 'Tus datos se han recuperado' : 'Your data has been restored')}</h1>
            <p>{result.message}</p>
            {result.snapshot && <div className="recovery-summary"><b>{result.snapshot.vaultCount} {es ? 'bóveda(s)' : 'vault(s)'}</b><span>{new Date(result.snapshot.date).toLocaleString()}</span><span>{formatBytes(result.snapshot.bytes)}</span></div>}
            {result.recoveryKey && (
              <div className="recovery-key" data-testid="recovery-key">
                <div><b>{es ? 'Clave de recuperación independiente' : 'Independent recovery key'}</b><small>{es ? 'Permite recuperar tus copias aunque olvides la contraseña.' : 'Restores your snapshots even if you forget the password.'}</small></div>
                <code>{result.recoveryKey}</code>
                <button
                  className="btn btn-ghost"
                  onClick={() => void navigator.clipboard.writeText(result.recoveryKey ?? '').then(() => setRecoveryKeyCopied(true))}
                >
                  <Icon name={recoveryKeyCopied ? 'check' : 'copy'} />
                  {recoveryKeyCopied ? (es ? 'Copiada' : 'Copied') : (es ? 'Copiar clave' : 'Copy key')}
                </button>
              </div>
            )}
            <p className="recovery-warning">{es ? 'Guarda el kit fuera de este dispositivo. Podrás restaurar con la contraseña o con la clave de recuperación.' : 'Store the kit away from this device. You can restore with the password or the recovery key.'}</p>
            <div className="recovery-actions"><button className="btn btn-ghost" onClick={() => void window.nodus.saveBackupRecoveryKit()}><Icon name="download" />{es ? 'Guardar kit de recuperación' : 'Save recovery kit'}</button><button className="btn btn-primary" data-testid="recovery-setup-complete" onClick={() => void onComplete()}>{es ? 'Continuar a Nodus' : 'Continue to Nodus'}<Icon name="chevronRight" /></button></div>
          </div>
        </motion.main>
      </div>
    );
  }

  return (
    <div className="recovery-cinema" data-testid="recovery-setup-wizard">
      <div className="recovery-aurora" aria-hidden="true" />
      <motion.main className="recovery-card" initial={{ opacity: 0, y: 28, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
        <aside className="recovery-hero">
          <Nodi state={busy ? 'loading' : status.previousInstallation ? 'discovering' : 'waving'} height={235} />
          <span className="recovery-kicker"><Icon name="archive" size={14} /> NODUS · {es ? 'PROTECCIÓN DE DATOS' : 'DATA PROTECTION'}</span>
          <h1>{status.previousInstallation ? (es ? 'Hemos detectado una instalación anterior' : 'We detected an existing installation') : (es ? 'Elige dónde proteger Nodus' : 'Choose where to protect Nodus')}</h1>
          <p>{status.previousInstallation
            ? (es ? 'Tus bóvedas actuales no se moverán ni se modificarán. Crearemos una primera copia cifrada y verificada antes de activar la recuperación.' : 'Your current vaults will not be moved or modified. We will create and verify a first encrypted snapshot before enabling recovery.')
            : (es ? 'Configura una carpeta segura antes de empezar. Tus bóvedas seguirán trabajando localmente y Nodus guardará aquí copias recuperables.' : 'Configure a safe folder before you start. Your vaults keep working locally and Nodus stores recoverable snapshots here.')}</p>
          <div className="recovery-safety"><Icon name="lock" /><span>{es ? 'La base de datos activa nunca se abre directamente desde Google Drive o Dropbox: así evitamos conflictos y corrupción.' : 'The live database is never opened directly from Google Drive or Dropbox, preventing conflicts and corruption.'}</span></div>
        </aside>

        <section className="recovery-form">
          <div className="recovery-mode-tabs">
            <button className={mode === 'create' ? 'active' : ''} onClick={() => { setMode('create'); setFolder(null); setResult(null); }}><Icon name="lock" />{status.previousInstallation ? (es ? 'Migrar y proteger este equipo' : 'Protect this computer') : (es ? 'Crear carpeta segura' : 'Create safe folder')}</button>
            <button className={mode === 'restore' ? 'active' : ''} onClick={() => { setMode('restore'); setFolder(null); setResult(null); }}><Icon name="upload" />{es ? 'Recuperar otro equipo' : 'Restore another computer'}</button>
          </div>

          <div className="recovery-block">
            <div><b>{mode === 'create' ? (es ? '1. Selecciona una carpeta vacía' : '1. Select an empty folder') : (es ? '1. Selecciona la carpeta existente' : '1. Select the existing folder')}</b><p>{mode === 'create'
              ? (es ? 'Puede ser una carpeta local o una carpeta sincronizada por Google Drive, Dropbox, iCloud u otro servicio. Debe estar vacía.' : 'It may be local or synchronized by Google Drive, Dropbox, iCloud or another service. It must be empty.')
              : (es ? 'Busca la carpeta que contiene nodus-recovery.json y sus copias.' : 'Choose the folder containing nodus-recovery.json and its snapshots.')}</p></div>
            <button className="btn btn-ghost recovery-folder-button" onClick={() => void chooseFolder()}><Icon name="folder" />{es ? 'Elegir carpeta' : 'Choose folder'}</button>
            {folder && <div className={`recovery-folder-result ${folder.kind}`}><Icon name={folder.kind === 'empty' || folder.kind === 'recovery' ? 'check' : 'alert'} /><span><b>{folder.path}</b><small>{folder.message}</small></span></div>}
          </div>

          {mode === 'create' && (
            <div className="recovery-block recovery-all-data">
              <Icon name="lock" />
              <div><b>{es ? '2. Todo Nodus quedará protegido' : '2. All of Nodus will be protected'}</b><p>{es ? 'Sin selecciones ni exclusiones: todas las bóvedas, documentos, preferencias, historiales, medios y claves API se incluirán automáticamente.' : 'No selections or exclusions: every vault, document, preference, history, media file and API key is included automatically.'}</p></div>
            </div>
          )}

          {mode === 'restore' && folder?.kind === 'recovery' && snapshots.length > 0 && <div className="recovery-block"><div><b>{es ? '2. Elige una copia' : '2. Choose a snapshot'}</b><p>{es ? 'La más reciente aparece seleccionada. Puedes recuperar una versión anterior.' : 'The newest snapshot is selected. You may restore an older version.'}</p></div><select className="input w-full" value={effectiveSnapshot} onChange={(event) => setSelectedSnapshot(event.target.value)}>{snapshots.map((snapshot) => <option key={snapshot.fileName} value={snapshot.fileName}>{new Date(snapshot.date).toLocaleString()} · {snapshot.vaultCount} vault(s) · {formatBytes(snapshot.bytes)} · Nodus {snapshot.appVersion}</option>)}</select></div>}

          <div className="recovery-block">
            <div><b>{mode === 'create' ? (es ? '3. Crea una contraseña maestra' : '3. Create a master password') : (es ? '3. Introduce una credencial' : '3. Enter a credential')}</b><p>{mode === 'create'
              ? (es ? 'Protege tus copias junto con una clave de recuperación independiente. Debe tener al menos 8 caracteres.' : 'It protects your snapshots alongside an independent recovery key. Use at least 8 characters.')
              : (es ? 'Puedes usar la contraseña maestra o la clave de recuperación de tu kit.' : 'Use either the master password or the recovery key from your kit.')}</p></div>
            <PasswordField
              value={password}
              onChange={setPassword}
              visible={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
              placeholder={mode === 'restore' ? (es ? 'Contraseña o clave de recuperación' : 'Password or recovery key') : (es ? 'Contraseña maestra' : 'Master password')}
              language={language}
            />
            {mode === 'create' && <PasswordField value={confirmPassword} onChange={setConfirmPassword} visible={showPassword} onToggle={() => setShowPassword((value) => !value)} placeholder={es ? 'Repite la contraseña' : 'Repeat password'} language={language} />}
            {mode === 'create' && confirmPassword && password !== confirmPassword && <small className="text-red-400">{es ? 'Las contraseñas no coinciden.' : 'Passwords do not match.'}</small>}
          </div>

          {result && !result.ok && <div className="recovery-error"><Icon name="alert" />{result.message}</div>}
          <footer className="recovery-footer"><span><Icon name="lock" />{es ? 'AES-256-GCM · instantáneas SQLite consistentes · hashes de integridad' : 'AES-256-GCM · consistent SQLite snapshots · integrity hashes'}</span><button className="btn btn-primary" disabled={!canSubmit || busy} onClick={() => void submit()}>{busy ? (es ? 'Verificando y guardando…' : 'Verifying and saving…') : mode === 'create' ? (es ? 'Crear primera copia segura' : 'Create first safe snapshot') : (es ? 'Verificar y recuperar' : 'Verify and restore')}<Icon name={busy ? 'sync' : 'chevronRight'} className={busy ? 'animate-spin' : ''} /></button></footer>
        </section>
      </motion.main>
    </div>
  );
}

function PasswordField({ value, onChange, visible, onToggle, placeholder, language }: {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  placeholder: string;
  language: 'es' | 'en';
}) {
  return <div className="recovery-password-field"><input className="input w-full" type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /><button type="button" onClick={onToggle} aria-label={visible ? (language === 'en' ? 'Hide password' : 'Ocultar contraseña') : (language === 'en' ? 'Show password' : 'Mostrar contraseña')} title={visible ? (language === 'en' ? 'Hide password' : 'Ocultar contraseña') : (language === 'en' ? 'Show password' : 'Mostrar contraseña')}><Icon name={visible ? 'eyeOff' : 'eye'} /></button></div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
