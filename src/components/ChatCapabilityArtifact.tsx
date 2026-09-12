import { useEffect, useState } from 'react';
import type { ArtifactRenderResult } from '@shared/capabilities';
import { CapabilityView } from './CapabilityView';
import { Icon } from './ui';
import { t, getActiveLang } from '../i18n';

/** A stored capability result, resolved when the message is shown.
 *
 *  The reply itself carries only a reference, so what is rendered here comes from the
 *  package that produced it. When that package is gone the result does not vanish from
 *  the conversation: it keeps its summary, says who made it, and offers to bring the
 *  provider back. */

interface Reference { source: string; capabilityId: string; plugin: { id: string; version: string }; summary: string }

export function ChatCapabilityArtifact({ source }: { source: string }) {
  const [reference, setReference] = useState<Reference | null>(null);
  const [result, setResult] = useState<ArtifactRenderResult | null>(null);
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    let parsed: Reference;
    try {
      parsed = JSON.parse(source);
      if (!parsed?.source || !parsed.capabilityId) throw new Error('invalid reference');
    } catch { setError(t('El resultado de la capability no se pudo leer.')); return; }
    setReference(parsed);
    let active = true;
    setError('');
    void window.nodus.renderCapabilityArtifact(parsed.source, getActiveLang())
      .then(value => { if (active) setResult(value); })
      .catch(value => { if (active) setError(value instanceof Error ? value.message : String(value)); });
    return () => { active = false; };
  }, [source]);

  if (error) return <div className="chat-visual-error" role="alert">{error}</div>;
  if (!reference) return null;

  const owner = /^nodus-artifact:\/\/chat\/([a-f0-9]{64})\//.exec(reference.source)?.[1];
  const head = <span className="chat-visual-head">
    <span className="chat-visual-kind"><Icon name="sparkles" size={13} />{reference.capabilityId}</span>
    <span className="chat-visual-original">{reference.plugin.id} {reference.plugin.version}</span>
  </span>;

  if (!result) return <div className="chat-visual-pending" role="status">
    <Icon name="sparkles" size={22} /><div><b>{reference.plugin.id}</b><span>{t('Cargando…')}</span></div>
  </div>;

  if (result.available) {
    return <section className="chat-visual chat-capability-result">{head}<CapabilityView view={result.view} owner={owner} /></section>;
  }

  const reinstall = async () => {
    setInstalling(true);
    setError('');
    try {
      await window.nodus.installCapabilityPlugin(reference.plugin.id, false);
      setResult(await window.nodus.renderCapabilityArtifact(reference.source, getActiveLang()));
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setInstalling(false); }
  };

  return <section className="chat-visual chat-capability-result chat-capability-orphan">
    {head}
    <p className="capability-view-summary">{reference.summary}</p>
    {result.reason === 'no-provider' && <>
      <p className="capability-view-note">{t('Este resultado lo produjo un paquete que ya no está instalado.')}</p>
      <button type="button" className="chat-skill-primary" disabled={installing} onClick={() => void reinstall()}>
        <Icon name="download" size={15} />{installing ? t('Instalando…') : t('Reinstalar el paquete')}
      </button>
    </>}
    {result.reason === 'unreadable' && <p className="capability-view-note" role="alert">{t('El contenido guardado ya no coincide con su huella y no se puede mostrar.')}</p>}
    {result.reason === 'missing' && <p className="capability-view-note" role="alert">{t('El contenido guardado ya no está disponible.')}</p>}
  </section>;
}
