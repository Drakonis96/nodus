import {
  intersectRibbonBounds,
  pointerAnchor,
  selectionRibbonOffset,
  selectionRibbonPosition,
  viewportRibbonBounds,
} from '../../selectionRibbonPosition';

/**
 * Keeps Milkdown's selection toolbar above the pointer that made the selection,
 * and out of the way until the pointer is released.
 *
 * Milkdown places the toolbar with floating-ui against the bounding box of the
 * whole selection, and shows it on every selection change, so dragging over a
 * paragraph makes it follow the growing box from the first click.
 *
 * floating-ui owns `left`/`top` and rewrites them on every recompute — writing
 * them here only starts a tug of war it wins. The correction lives in the
 * element's transform instead, recomputed from wherever floating-ui last left
 * it, and bounded by the editor column so a toolbar nearly as wide as the text
 * is not pushed under its own edge.
 *
 * A selection made with the keyboard keeps the original placement: there is no
 * pointer to follow, and the caret is already inside the selection box.
 */
export function anchorToolbarToPointer(root: HTMLElement, toolbar: HTMLElement): () => void {
  let pointer: { x: number; y: number } | null = null;
  let offset = { x: 0, y: 0 };
  let frame = 0;
  let dragging = false;

  const write = (property: 'visibility' | 'transform', value: string) => {
    // Writing an unchanged value is still a mutation this observer would answer.
    if (toolbar.style[property] !== value) toolbar.style[property] = value;
  };

  const place = () => {
    // Visibility rather than the theme's display toggle: a hidden toolbar still
    // has to be measured to be placed, and it is placed the moment the pointer
    // comes back up.
    write('visibility', dragging ? 'hidden' : '');
    if (dragging || !pointer || toolbar.dataset.show !== 'true') return;
    const rect = toolbar.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const column = toolbar.offsetParent instanceof HTMLElement ? toolbar.offsetParent.getBoundingClientRect() : null;
    const bounds = column
      ? intersectRibbonBounds(viewportRibbonBounds(), { left: column.left, top: column.top, right: column.right, bottom: column.bottom })
      : viewportRibbonBounds();
    const target = selectionRibbonPosition(pointerAnchor(pointer.x, pointer.y), rect, bounds);
    const next = selectionRibbonOffset(offset, rect, target);
    if (Math.abs(next.x - offset.x) < 0.5 && Math.abs(next.y - offset.y) < 0.5) return;
    offset = next;
    write('transform', `translate(${next.x}px, ${next.y}px)`);
  };

  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  };

  const insideToolbar = (event: Event) => event.target instanceof Node && toolbar.contains(event.target);

  const onPointerDown = (event: PointerEvent) => {
    // A click on the toolbar is not a new selection; following it would walk
    // the toolbar away from the text under the writer's own cursor.
    if (insideToolbar(event) || !(event.target instanceof Node) || !root.contains(event.target)) return;
    dragging = true;
    pointer = null;
    schedule();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging || insideToolbar(event)) return;
    dragging = false;
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  };

  const onKeyDown = () => {
    dragging = false;
    pointer = null;
    offset = { x: 0, y: 0 };
    write('transform', '');
    schedule();
  };

  const observer = new MutationObserver(schedule);
  observer.observe(toolbar, { attributes: true, attributeFilter: ['style', 'data-show'] });
  // The release is watched on the document: a selection dragged past the editor
  // still ends when the button comes up, wherever the pointer happens to be.
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
  root.addEventListener('keydown', onKeyDown);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerUp, true);
    root.removeEventListener('keydown', onKeyDown);
    toolbar.style.visibility = '';
    toolbar.style.transform = '';
  };
}
