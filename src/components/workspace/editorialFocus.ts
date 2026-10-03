import { useEffect, useRef, useState } from 'react';

export const EDITORIAL_FOCUS_EVENT = 'nodus:editorial-focus';
export const EDITORIAL_NAV_EVENT = 'nodus:editorial-navigation';

/** Focus belongs to the open editor, never to the user's saved sidebar settings. */
export function useEditorialFocus(focus: boolean, onChange: (active: boolean) => void) {
  const change = useRef(onChange);
  change.current = onChange;
  const enteredAt = useRef(0);
  const leaveFullscreen = async () => {
    // macOS finishes its native Space transition after the DOM promise resolves.
    // Queue a rapid second click until that transition can accept an exit.
    const remaining = 1000 - (Date.now() - enteredAt.current);
    if (remaining > 0) await new Promise(resolve => window.setTimeout(resolve, remaining));
    if (document.fullscreenElement) await document.exitFullscreen();
  };
  const [navigationOpen, setNavigationOpen] = useState(false);
  useEffect(() => {
    setNavigationOpen(false);
    window.dispatchEvent(new CustomEvent(EDITORIAL_FOCUS_EVENT, { detail: { active: focus } }));
    if (!focus) return;
    const leave = () => { if (!document.fullscreenElement) change.current(false); };
    document.addEventListener('fullscreenchange', leave);
    return () => {
      document.removeEventListener('fullscreenchange', leave);
      window.dispatchEvent(new CustomEvent(EDITORIAL_FOCUS_EVENT, { detail: { active: false } }));
      if (document.fullscreenElement) void leaveFullscreen().catch(() => undefined);
    };
  }, [focus]);
  return {
    navigationOpen,
    toggleNavigation() {
      const open = !navigationOpen;
      setNavigationOpen(open);
      window.dispatchEvent(new CustomEvent(EDITORIAL_NAV_EVENT, { detail: { open } }));
    },
    async toggleFocus() {
      if (focus) {
        await leaveFullscreen();
        change.current(false);
      } else {
        enteredAt.current = Date.now();
        await document.documentElement.requestFullscreen();
        change.current(true);
      }
    },
  };
}

export function useEditorialShellFocus() {
  const [active, setActive] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  useEffect(() => {
    const focus = (event: Event) => {
      setActive(Boolean((event as CustomEvent).detail?.active));
      setNavigationOpen(false);
    };
    const navigation = (event: Event) => setNavigationOpen(Boolean((event as CustomEvent).detail?.open));
    window.addEventListener(EDITORIAL_FOCUS_EVENT, focus);
    window.addEventListener(EDITORIAL_NAV_EVENT, navigation);
    return () => {
      window.removeEventListener(EDITORIAL_FOCUS_EVENT, focus);
      window.removeEventListener(EDITORIAL_NAV_EVENT, navigation);
    };
  }, []);
  return { active, navigationOpen };
}
