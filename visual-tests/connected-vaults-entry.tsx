// Server-render entry for the connected-vaults panel.
//
// The other harnesses in this folder mount into a browser for a human to look at. This one
// exists so scripts/test-connected-vaults-panel.mjs can render the component in Node and
// assert on the markup, which is the only way to prove the JSX actually runs.
import { renderToStaticMarkup } from 'react-dom/server';
import { ConnectedVaultsPanel, type ConnectedVaultsPanelProps } from '../src/components/ConnectedVaultsPanel';

export function renderPanel(props: Omit<ConnectedVaultsPanelProps, 'onSync' | 'onDetach'>): string {
  return renderToStaticMarkup(
    <ConnectedVaultsPanel {...props} onSync={() => undefined} onDetach={() => undefined} />
  );
}
