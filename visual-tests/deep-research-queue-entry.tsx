// Server-render entry for the Deep Research queue strip, so
// scripts/test-deep-research-queue-strip.mjs can assert on the markup a report in
// flight actually produces. Rendering it is the only way to prove the JSX runs.
import { renderToStaticMarkup } from 'react-dom/server';
import { DeepResearchQueueStrip, type QueueStripItem } from '../src/components/DeepResearchQueueStrip';

export function renderStrip(active: QueueStripItem[], failed: QueueStripItem[] = [], running = true): string {
  return renderToStaticMarkup(
    <DeepResearchQueueStrip
      active={active}
      failed={failed}
      running={running}
      onRemove={() => undefined}
      onClearFinished={() => undefined}
    />
  );
}
