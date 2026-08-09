/**
 * An explicit source for Nodi's Current view context.
 *
 * The app shell discovers this hidden node inside the active view. Unlike its
 * ordinary innerText snapshot, the node contains the complete source document,
 * including sections that are not currently inside the reader's viewport.
 */
export function NodiViewContextSource({ title, text }: { title: string; text: string }) {
  return (
    <div
      hidden
      aria-hidden="true"
      data-nodi-context-source="document"
      data-nodi-context-title={title}
    >
      {text}
    </div>
  );
}
