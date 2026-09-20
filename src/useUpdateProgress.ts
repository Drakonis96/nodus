import { useEffect, useRef, useState } from 'react';
import type { UpdateCheckResponse, UpdateProgressEvent } from '@shared/types';
import { pendingUpdateVersion, updateInstallBusy } from './updateStatus';

const SESSION_KEY = 'nodus.startupUpdateChecked';

function shouldCheckAtStartup(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) !== '1';
  } catch {
    return true;
  }
}

/** Subscribe before reading the snapshot; a slow snapshot must not undo a newer event. */
export function useUpdateProgress({ checkOnStartup = false } = {}) {
  const [startup] = useState(() => checkOnStartup && shouldCheckAtStartup());
  const [showStartupProgress, setShowStartupProgress] = useState(startup);
  const [update, setUpdate] = useState<UpdateProgressEvent | null>(() => startup
    ? { status: 'checking', message: '', at: new Date().toISOString() }
    : null);
  // Retain the request across StrictMode's effect replay, without checking twice.
  const startupRequest = useRef<Promise<UpdateCheckResponse> | null>(null);
  const startupEvent = useRef<UpdateProgressEvent | null>(null);
  useEffect(() => {
    let alive = true;
    let receivedEvent = false;
    const receive = (event: UpdateProgressEvent) => {
      setUpdate(event);
      if (event.status === 'not-available' || event.status === 'disabled'
        || pendingUpdateVersion(event) || updateInstallBusy(event)
        || (startupEvent.current?.status === 'error' && event.status !== 'error')) {
        // This latch never reopens for periodic or manual checks later in the session.
        setShowStartupProgress(false);
      }
      startupEvent.current = event;
    };
    const unsubscribe = window.nodus.onUpdateProgress((event) => {
      receivedEvent = true;
      if (alive) receive(event);
    });
    if (startup) {
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* Storage may be unavailable. */ }
      startupRequest.current ??= window.nodus.checkForUpdates();
      void startupRequest.current.then((result) => {
        // IPC may resolve after a newer download event: never roll progress back.
        if (alive && (!startupEvent.current || startupEvent.current.status === 'checking')) {
          receive({ ...result, at: new Date().toISOString() });
        }
      }).catch(() => {
        if (alive && (!startupEvent.current || startupEvent.current.status === 'checking')) {
          receive({ status: 'error', errorCode: 'update-check-failed', message: '', at: new Date().toISOString() });
        }
      });
    } else {
      void window.nodus.getUpdateStatus?.().then((snapshot) => {
        if (alive && !receivedEvent) setUpdate(snapshot);
      }).catch(() => { /* Keep the live subscription if the initial read fails. */ });
    }
    return () => { alive = false; unsubscribe(); };
  }, [startup]);

  useEffect(() => {
    if (!showStartupProgress || update?.status !== 'error') return;
    const timer = window.setTimeout(() => setShowStartupProgress(false), 5000);
    return () => window.clearTimeout(timer);
  }, [showStartupProgress, update?.status]);

  return [update, setUpdate, showStartupProgress] as const;
}
