import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, ModalBackdrop } from '../ui';
import { t, tx } from '../../i18n';
import { useDrift } from './DriftProvider';
import { MAX_DRIFT_PRESETS, type DriftPreset, type DriftPresetIcon } from './driftState';

export const DRIFT_PRESET_ICON_OPTIONS: Array<{ icon: DriftPresetIcon; label: string }> = [
  { icon: 'drift', label: 'Nodus Drift' }, { icon: 'bookOpen', label: 'Lectura' }, { icon: 'moon', label: 'Noche' },
  { icon: 'cloudRain', label: 'Lluvia' }, { icon: 'wind', label: 'Viento' }, { icon: 'flame', label: 'Fuego' },
  { icon: 'coffee', label: 'Cafetería' }, { icon: 'waves', label: 'Olas' }, { icon: 'star', label: 'Favorito' },
];

export function DriftPresets({ onEdit, onApplied }: { onEdit: (preset: DriftPreset) => void; onApplied: () => void }) {
  const drift = useDrift();
  return <section className="drift-presets" aria-label={t('Predefinidos')}>
    <p className="drift-presets-hint">{t('Los predefinidos guardan los sonidos y sus volúmenes. Al cargarlos, la mezcla queda en pausa.')}</p>
    {drift.presets.length === 0 ? <p data-testid="drift-presets-empty" className="drift-empty">{t('Crea una mezcla y guárdala para recuperarla aquí.')}</p>
      : <ul className="drift-grid drift-preset-grid">{drift.presets.map((preset) => <li key={preset.id} className="drift-sound-card drift-preset-card" data-testid={`drift-preset-${preset.id}`}>
        <button type="button" className="drift-sound-toggle" data-testid={`drift-preset-load-${preset.id}`} aria-label={tx('Cargar {name}', { name: preset.name })}
          onClick={() => { drift.applyPreset(preset.id); onApplied(); }}>
          <Icon name={preset.icon} size={30} className="drift-sound-icon" /><strong className="drift-sound-name">{preset.name}</strong>
          <span className="drift-status">{tx('{n} sonidos', { n: preset.selection.length })}</span>
        </button>
        <div className="drift-preset-actions">
          <button type="button" data-testid={`drift-preset-edit-${preset.id}`} aria-label={tx('Editar {name}', { name: preset.name })} onClick={() => onEdit(preset)}><Icon name="edit" size={14} />{t('Editar')}</button>
          <button type="button" data-testid={`drift-preset-delete-${preset.id}`} aria-label={tx('Eliminar {name}', { name: preset.name })} onClick={() => drift.deletePreset(preset.id)}><Icon name="trash" size={14} />{t('Eliminar')}</button>
        </div>
      </li>)}</ul>}
  </section>;
}

export function DriftPresetEditor({ preset, onClose }: { preset?: DriftPreset; onClose: () => void }) {
  const drift = useDrift();
  const [name, setName] = useState(preset?.name ?? '');
  const [icon, setIcon] = useState<DriftPresetIcon>(preset?.icon ?? 'drift');
  const formRef = useRef<HTMLFormElement>(null);
  const atLimit = !preset && drift.presets.length >= MAX_DRIFT_PRESETS;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    formRef.current?.querySelector('input')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const keyboard = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const elements = [...(formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input') ?? [])];
    const first = elements[0]; const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return <ModalBackdrop onClose={onClose}>
    <form ref={formRef} role="dialog" aria-modal="true" aria-labelledby="drift-preset-editor-title" className="drift-preset-editor" data-testid="drift-preset-editor" onKeyDown={keyboard}
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || atLimit || (!preset && !drift.selection.length)) return;
        if (preset) drift.editPreset(preset.id, name, icon); else drift.savePreset(name, icon);
        drift.setFilter('presets'); onClose();
      }}>
      <header><h2 id="drift-preset-editor-title">{preset ? t('Editar predefinido') : t('Guardar predefinido')}</h2>
        <button type="button" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" size={17} /></button></header>
      <label>{t('Nombre del predefinido')}<input data-testid="drift-preset-name" required maxLength={80} value={name} onChange={(event) => setName(event.currentTarget.value)} /></label>
      <fieldset><legend>{t('Icono del predefinido')}</legend><div className="drift-preset-icons">{DRIFT_PRESET_ICON_OPTIONS.map((option) =>
        <button key={option.icon} type="button" data-testid={`drift-preset-icon-${option.icon}`} aria-label={t(option.label)} title={t(option.label)} aria-pressed={icon === option.icon} onClick={() => setIcon(option.icon)}><Icon name={option.icon} size={23} /></button>)}</div></fieldset>
      <p>{preset ? t('Editar el nombre o el icono no cambia los sonidos guardados.') : t('Se guardarán los sonidos seleccionados y el volumen de cada uno, incluido el volumen general.')}</p>
      {atLimit && <p role="status">{tx('Puedes guardar hasta {max} predefinidos.', { max: MAX_DRIFT_PRESETS })}</p>}
      <footer><button type="button" onClick={onClose}>{t('Cancelar')}</button><button type="submit" data-testid="drift-preset-submit" disabled={!name.trim() || atLimit || (!preset && !drift.selection.length)}>{preset ? t('Guardar cambios') : t('Guardar predefinido')}</button></footer>
    </form>
  </ModalBackdrop>;
}
