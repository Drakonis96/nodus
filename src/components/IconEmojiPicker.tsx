import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import { Icon, ICON_NAMES } from './ui';

const EMOJIS = [
  '🎓','📚','📖','📕','📗','📘','📙','📓','📔','📒','📑','🔖','📝','✏️','🖊️','🖋️','✒️','📐','📏','🧮','🔬','🔭','🧪','🧬','🧠','💡','🔎','🗂️','📁','📂','🗃️','🗄️','📎','🖇️','📌','📍','✅','☑️','❓','❗','⚠️','⭐','🌟','✨','💫','🔥','🎯','🏆','🥇','🚀','🧭','🗺️','🌍','🌎','🌏','🏛️','🏫','🏢','🏠','⚙️','🛠️','🔧','🔑','🔒','🔓','🔗','🧩','🎨','🎭','🎬','🎵','🎧','🎤','📷','🖼️','💻','⌨️','📱','🖥️','📊','📈','📉','🗓️','📅','⏰','⌛','⏳','🕐','☀️','🌙','☁️','🌈','🌱','🌿','🍀','🌳','🌸','🌻','🌊','⛰️','⚡','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','👍','👏','🙌','🤝','👥','👤','🧑‍🎓','👩‍🎓','👨‍🎓','🧑‍🏫','👩‍🏫','👨‍🏫','⚖️','🩺','💊','🦷','🧱','🏗️','✈️','🚗','⚽','🏀','♟️','🎲','🧵','🧶','🍎','☕','🧰','📦','🛡️','♻️','➕','➖','➡️','⬅️','⬆️','⬇️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤',
] as const;

const EMOJI_SEARCH_GROUPS = [
  { keywords: 'estudio educacion education curso asignatura universidad escuela libro books notas escritura write', values: '🎓📚📖📕📗📘📙📓📔📒📑🔖📝✏️🖊️🖋️✒️📐📏🧮🧑‍🎓👩‍🎓👨‍🎓🧑‍🏫👩‍🏫👨‍🏫' },
  { keywords: 'ciencia science investigacion research laboratorio salud medicine', values: '🔬🔭🧪🧬🧠💡🔎🩺💊🦷' },
  { keywords: 'archivo file carpeta folder organizacion office caja', values: '🗂️📁📂🗃️🗄️📎🖇️📌📍📦' },
  { keywords: 'estado check alerta warning pregunta favorito estrella fuego objetivo premio', values: '✅☑️❓❗⚠️⭐🌟✨💫🔥🎯🏆🥇' },
  { keywords: 'viaje mundo mapa travel world naturaleza nature clima', values: '🚀🧭🗺️🌍🌎🌏✈️🚗☀️🌙☁️🌈🌱🌿🍀🌳🌸🌻🌊⛰️⚡' },
  { keywords: 'edificio building arquitectura casa universidad escuela', values: '🏛️🏫🏢🏠🧱🏗️' },
  { keywords: 'herramienta tool ajustes seguridad lock enlace puzzle', values: '⚙️🛠️🔧🔑🔒🔓🔗🧩🧰🛡️♻️' },
  { keywords: 'arte musica audio video foto imagen creative', values: '🎨🎭🎬🎵🎧🎤📷🖼️🧵🧶' },
  { keywords: 'tecnologia technology ordenador computer movil datos chart', values: '💻⌨️📱🖥️📊📈📉' },
  { keywords: 'tiempo calendario date time reloj', values: '🗓️📅⏰⌛⏳🕐' },
  { keywords: 'corazon heart amor color', values: '❤️🧡💛💚💙💜🖤🤍🤎' },
  { keywords: 'persona people equipo team gesto mano', values: '👍👏🙌🤝👥👤' },
  { keywords: 'deporte juego sport game', values: '⚽🏀♟️🎲' },
  { keywords: 'comida food cafe manzana', values: '🍎☕' },
  { keywords: 'flecha arrow direccion mas menos', values: '➕➖➡️⬅️⬆️⬇️' },
  { keywords: 'circulo circle color punto', values: '🔴🟠🟡🟢🔵🟣⚫⚪🟤' },
] as const;

const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export function IconEmojiPicker({ icon, emoji, onChange }: {
  icon: string;
  emoji: string;
  onChange: (value: { icon: string; emoji: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const normalizedQuery = normalize(query);
  const icons = useMemo(() => ICON_NAMES.filter((name) => normalize(name).includes(normalizedQuery)), [normalizedQuery]);
  const emojis = useMemo(() => EMOJIS.filter((value) => !normalizedQuery || value.includes(query.trim()) || EMOJI_SEARCH_GROUPS.some((group) => normalize(group.keywords).includes(normalizedQuery) && group.values.includes(value))), [normalizedQuery, query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const chooseIcon = (value: string) => { onChange({ icon: value, emoji: '' }); setOpen(false); };
  const chooseEmoji = (value: string) => { onChange({ icon, emoji: value }); setOpen(false); };

  return <>
    <button data-testid="study-create-icon-emoji" type="button" className="input mt-1 flex w-full items-center gap-2 text-left hover:border-teal-500" onClick={() => { setQuery(''); setOpen(true); }}>
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-indigo-950/30 text-sm text-indigo-300">
        {emoji || <Icon name={icon} size={14} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{emoji ? t('Emoji seleccionado') : icon || t('Seleccionar icono o emoji')}</span>
      <Icon name="chevronDown" size={13} className="text-neutral-500" />
    </button>
    {open && createPortal(
      <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-6" onClick={() => setOpen(false)}>
        <div className="card-modal flex max-h-[78vh] w-full max-w-2xl flex-col p-5" role="dialog" aria-modal="true" aria-label={t('Seleccionar icono o emoji')} onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1"><h3 className="font-semibold">{t('Seleccionar icono o emoji')}</h3><p className="mt-0.5 text-xs text-neutral-500">{t('Busca y elige un icono de Nodus o un emoji.')}</p></div>
            <button type="button" className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Cerrar')} onClick={() => setOpen(false)}><Icon name="x" /></button>
          </div>
          <label className="relative mt-4 block">
            <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input autoFocus data-testid="study-icon-search" className="input input-with-leading-icon w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar iconos…')} />
          </label>
          <div className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <section><h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t('Iconos')}</h4>
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 md:grid-cols-10">{icons.map((name) => <button key={name} type="button" title={name} aria-label={name} className={`grid aspect-square place-items-center rounded-lg border transition-colors ${!emoji && icon === name ? 'border-indigo-500 bg-indigo-950/30 text-indigo-300' : 'border-neutral-800 text-neutral-400 hover:border-indigo-700 hover:bg-neutral-800'}`} onClick={() => chooseIcon(name)}><Icon name={name} size={18} /></button>)}</div>
              {!icons.length && <p className="py-3 text-xs text-neutral-500">{t('No se encontraron iconos.')}</p>}
            </section>
            <section><h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t('Emojis')}</h4>
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 md:grid-cols-10">{emojis.map((value, index) => <button key={`${value}-${index}`} type="button" aria-label={`${t('Emoji')} ${value}`} className={`grid aspect-square place-items-center rounded-lg border text-lg transition-colors ${emoji === value ? 'border-indigo-500 bg-indigo-950/30' : 'border-neutral-800 hover:border-indigo-700 hover:bg-neutral-800'}`} onClick={() => chooseEmoji(value)}>{value}</button>)}</div>
              {!emojis.length && <p className="py-3 text-xs text-neutral-500">{t('No se encontraron emojis.')}</p>}
            </section>
          </div>
        </div>
      </div>, document.body)}
  </>;
}
