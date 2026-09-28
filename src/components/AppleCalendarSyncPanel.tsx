import { useEffect, useState } from 'react';
import type { AppleCalendarDestination, AppleCalendarSyncStatus } from '@shared/appleCalendar';
import { t } from '../i18n';
import { Icon } from './ui';

function calendarError(error: unknown): string {
  const code = String(error instanceof Error ? error.message : error);
  if (code.includes('APPLE_CALENDAR_PERMISSION')) return t('Permite el acceso completo a Calendarios en los ajustes de privacidad de macOS.');
  if (code.includes('APPLE_CALENDAR_DESTINATION')) return t('El calendario ya no está disponible. Elige otro calendario de Apple.');
  if (code.includes('APPLE_CALENDAR_CONFLICT')) return t('Un evento de Apple ha cambiado de propietario o tiene invitados. Revisa el calendario antes de reintentar.');
  if (code.includes('APPLE_CALENDAR_STATE')) return t('No se puede leer o guardar la configuración. La sincronización está detenida para evitar duplicados.');
  if (code.includes('APPLE_CALENDAR_USAGE_DESCRIPTION') || code.includes('APPLE_CALENDAR_UNAVAILABLE')) return t('Esta integración requiere la aplicación Nodus compilada para macOS.');
  if (code.includes('APPLE_CALENDAR_VAULT')) return t('La bóveda no está disponible. Los eventos de Apple se conservan.');
  return t('No se ha podido sincronizar con Apple Calendar. Nodus volverá a intentarlo automáticamente.');
}

export function AppleCalendarSyncPanel() {
  const [status, setStatus] = useState<AppleCalendarSyncStatus | null>(null);
  const [calendars, setCalendars] = useState<AppleCalendarDestination[] | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await window.nodus.getAppleCalendarSyncStatus?.();
        if (active && next) setStatus(next);
      } catch { /* The server web client does not expose native calendars. */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const choose = async () => {
    setBusy(true); setError('');
    try {
      const items = await window.nodus.listAppleCalendarDestinations();
      setCalendars(items);
      setSelected(items.some((item) => item.id === status?.calendarId) ? status!.calendarId! : '');
    } catch (cause) { setError(calendarError(cause)); }
    finally { setBusy(false); }
  };
  const configure = async (enabled: boolean) => {
    setBusy(true); setError('');
    try {
      setStatus(await window.nodus.configureAppleCalendarSync({ enabled, calendarId: selected || status?.calendarId || undefined }));
      setCalendars(null);
    } catch (cause) { setError(calendarError(cause)); }
    finally { setBusy(false); }
  };
  if (!status?.available) return null;
  const issue = error || (status.error ? calendarError(status.error) : '');
  return <details className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 text-xs dark:border-neutral-800 dark:bg-neutral-900/50" data-testid="apple-calendar-sync">
    <summary className="cursor-pointer px-3 py-2">
      <span className="ml-1 font-medium">Apple Calendar</span>
      <span className={`ml-2 ${issue ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-500'}`} role="status">
        {issue ? t('Requiere atención') : !status.enabled ? t('Desactivado') : status.phase === 'syncing' ? t('Sincronizando…') : t('Sincronización automática')}
      </span>
    </summary>
    <div className="space-y-3 border-t border-neutral-200 p-3 dark:border-neutral-800">
      <p>{t('Envía los eventos de esta bóveda a Apple Calendar, incluidos los existentes, y mantiene sus cambios y eliminaciones mientras Nodus está abierto. Los cambios hechos en Apple no se importan a Nodus.')}</p>
      <p className="text-neutral-500">{t('Elige iCloud para compartirlos entre tus dispositivos Apple. Los calendarios locales solo se guardan en este Mac. La actualización de iCloud depende de Apple y de la conexión.')}</p>
      {status.calendarName && <p className="font-medium">{status.calendarName}</p>}
      {issue && <p className="text-amber-700 dark:text-amber-400" role="alert">{issue}</p>}
      {calendars && (calendars.length ? <label className="block max-w-lg">
        <span className="mb-1 block">{t('Calendario de destino')}</span>
        <select className="input w-full" value={selected} onChange={(event) => setSelected(event.target.value)} data-testid="apple-calendar-destination">
          <option value="">{t('Selecciona un calendario')}</option>
          {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.title} · {calendar.source}</option>)}
        </select>
      </label> : <p>{t('No hay calendarios de iCloud o locales con permiso de escritura. Añade uno en la aplicación Calendario de Apple.')}</p>)}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost h-8" disabled={busy} onClick={() => void choose()}><Icon name="calendar" size={14} />{t('Elegir calendario de Apple')}</button>
        {calendars && calendars.length > 0 && <button className="btn btn-primary h-8" disabled={busy || !selected} onClick={() => void configure(true)}>{t('Activar sincronización')}</button>}
        {status.enabled && <button className="btn btn-ghost h-8" disabled={busy} onClick={() => void configure(false)}>{t('Desactivar sincronización')}</button>}
      </div>
      <p className="text-neutral-500">{t('Al desactivar la sincronización se conservan los eventos ya enviados a Apple.')}</p>
    </div>
  </details>;
}
