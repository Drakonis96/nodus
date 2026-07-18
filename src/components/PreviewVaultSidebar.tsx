import type { VaultType } from '@shared/types';
import { t } from '../i18n';
import { Icon } from './ui';

interface PreviewItem { label: string; icon: string }
interface PreviewGroup { label: string; items: PreviewItem[] }

// Teaching ('docencia') graduated from a preview shell into a real workspace (it
// reuses the study organisation surfaces), so worldbuilding is the only remaining
// preview type rendered here.
const WORLDBUILDING_GROUPS: PreviewGroup[] = [
  { label: 'Explorar', items: [
    { label: 'Enciclopedia', icon: 'book' }, { label: 'Personajes', icon: 'users' },
    { label: 'Lugares', icon: 'map' }, { label: 'Facciones', icon: 'network' },
    { label: 'Culturas', icon: 'languages' }, { label: 'Cronología', icon: 'clock' },
    { label: 'Mapa', icon: 'map' }, { label: 'Relaciones', icon: 'network' },
  ] },
  { label: 'Analizar', items: [
    { label: 'Chat del mundo', icon: 'chat' }, { label: 'Grafo del mundo', icon: 'layers' },
    { label: 'Reglas del mundo', icon: 'lock' }, { label: 'Conflictos', icon: 'scale' },
    { label: 'Arcos narrativos', icon: 'route' }, { label: 'Consistencia', icon: 'check' },
    { label: 'Preguntas abiertas', icon: 'help' },
  ] },
  { label: 'Crear', items: [
    { label: 'Notas', icon: 'notebook' }, { label: 'Escenas', icon: 'image' },
    { label: 'Tramas', icon: 'route' }, { label: 'Manuscritos', icon: 'edit' },
  ] },
];

export function PreviewVaultSidebar({ type }: { type: VaultType }) {
  const groups = WORLDBUILDING_GROUPS;
  const item = (entry: PreviewItem, key: string) => <button key={key} type="button" disabled aria-disabled="true" title={t('Disponible próximamente')} className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-600 opacity-70"><Icon name={entry.icon} className="opacity-70" />{t(entry.label)}</button>;
  return <div data-testid={`preview-vault-sidebar-${type}`} className="flex flex-col gap-1">
    {item({ label: 'Inicio', icon: 'home' }, 'home')}
    {groups.map((group) => <section key={group.label} className="mt-2 flex flex-col gap-1"><h2 className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t(group.label)}</h2>{group.items.map((entry) => item(entry, `${group.label}-${entry.label}`))}</section>)}
    <div className="mt-2">{item({ label: 'Ajustes', icon: 'settings' }, 'settings')}</div>
  </div>;
}
