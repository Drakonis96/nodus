import { useEffect, useRef, useState } from 'react';

/** Follow external volume changes without letting a late poll undo a slider input. */
export function useDeviceVolume(active: boolean) {
  const [volume, setVolume] = useState(50);
  const [ready, setReady] = useState(false);
  const revision = useRef(0);
  const writes = useRef(0);

  useEffect(() => {
    setReady(false);
    if (!active) return;
    let cancelled = false;
    let reading = false;
    const refresh = async () => {
      if (reading || writes.current > 0) return;
      reading = true;
      const startedAt = revision.current;
      try {
        const current = await window.nodus.getBrowserDeviceVolume();
        if (!cancelled && startedAt === revision.current && writes.current === 0) {
          setVolume(Math.max(0, Math.min(100, Math.round(current))));
          setReady(true);
        }
      } catch {
        // Keep the last successful value; a transient read must not reset it to 50%.
      } finally {
        reading = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 150);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active]);

  const changeVolume = (value: number) => {
    revision.current += 1;
    writes.current += 1;
    setVolume(value);
    void window.nodus.setBrowserDeviceVolume(value)
      .catch(() => undefined)
      .finally(() => { writes.current -= 1; });
  };

  return { volume, ready, changeVolume };
}
