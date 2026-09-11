import { useEffect, useState } from 'react';
import type { CapabilityProviderSummary } from '@shared/capabilities';
import { getActiveLang } from '../i18n';

/** Which fenced blocks installed packages have claimed, and what to call them while they
 *  are still being produced.
 *
 *  The interface used to name three disciplines directly. It now asks the registry, so a
 *  package that declares a new protocol gets a correctly labelled placeholder without the
 *  application knowing anything about it. */

interface Claim { capabilityId: string; pluginId?: string; label: Record<string, string>; fences: string[] }

let claims = new Map<string, Claim>();
const listeners = new Set<() => void>();

function adopt(providers: CapabilityProviderSummary[]): void {
  const next = new Map<string, Claim>();
  for (const provider of providers) {
    if (!provider.chat) continue;
    next.set(provider.id, { capabilityId: provider.id, pluginId: provider.plugin?.id, label: provider.chat.pendingLabel, fences: provider.chat.fences });
  }
  claims = next;
  for (const listener of listeners) listener();
}

let started = false;
function start(): void {
  if (started) return;
  started = true;
  void window.nodus.listCapabilities().then(payload => adopt(payload.providers)).catch(() => undefined);
  window.nodus.onCapabilityRegistryChanged(payload => adopt(payload.providers));
}

export interface FenceClaims {
  fences: ReadonlySet<string>;
  label: (fence: string) => { title: string; pending: string } | undefined;
}

export function useCapabilityFences(): FenceClaims {
  const [, bump] = useState(0);
  useEffect(() => {
    start();
    const listener = () => bump(value => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const byFence = new Map<string, Claim>();
  for (const claim of claims.values()) for (const fence of claim.fences) byFence.set(fence, claim);
  return {
    fences: new Set(byFence.keys()),
    label: fence => {
      const claim = byFence.get(fence);
      if (!claim) return undefined;
      const locale = getActiveLang();
      return {
        title: claim.pluginId ?? claim.capabilityId,
        pending: claim.label[locale] ?? claim.label[locale.split('-')[0]] ?? claim.label.en,
      };
    },
  };
}
