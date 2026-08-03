// Server-render entry for the basic-mode server panel.
//
// Sibling of connected-vaults-entry.tsx, and for the same reason: scripts/test-local-server-panel.mjs
// has to render the component in Node and assert on the markup, because a regular expression over
// the source cannot tell working JSX from JSX that throws on its first prop.
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalServerPanel, type LocalServerPanelProps } from '../src/components/LocalServerPanel';

type Handlers =
  | 'onStart' | 'onStop' | 'onChooseAccess' | 'onTailscaleServe' | 'onConnectVault'
  | 'onKeepAwake' | 'onLidServing' | 'onCopy' | 'onOpenExternal';

export function renderPanel(props: Omit<LocalServerPanelProps, Handlers>): string {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <LocalServerPanel
      {...props}
      onStart={noop}
      onStop={noop}
      onChooseAccess={noop}
      onTailscaleServe={noop}
      onConnectVault={noop}
      onKeepAwake={noop}
      onLidServing={noop}
      onCopy={noop}
      onOpenExternal={noop}
    />
  );
}
