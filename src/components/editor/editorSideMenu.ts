import type { FloatingUIOptions } from '@blocknote/react';

/** Position block controls from the rendered first line, including document spacing. */
export const editorSideMenuOptions: FloatingUIOptions = {
  // Closing snapshots contain inert HTML; block controls must disappear at once
  // during scrolling rather than leaving a briefly clickable-looking duplicate.
  useTransitionStatusProps: { duration: 0 },
  useTransitionStylesProps: { duration: 0 },
  useFloatingOptions: {
    middleware: [{
      name: 'nodusFirstLine',
      fn({ elements, rects, y }) {
        const reference = elements.reference instanceof Element
          ? elements.reference
          : elements.reference.contextElement;
        if (!reference) return {};
        const content = reference.matches('.bn-block-content')
          ? reference
          : reference.querySelector<HTMLElement>('.bn-block-content');
        if (!content) return {};

        const type = content.getAttribute('data-content-type');
        const media = ['image', 'video', 'audio', 'file'].includes(type ?? '');
        const inline = media ? null : content.querySelector<HTMLElement>(
          type === 'table' ? 'td p, th p' : '.bn-inline-content',
        );
        const firstLine = inline ?? content.querySelector<HTMLElement>('.bn-add-file-button');
        if (firstLine) {
          const box = firstLine.getBoundingClientRect();
          const style = getComputedStyle(firstLine);
          const lineHeight = inline
            ? (Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2)
            : box.height;
          const center = box.top + lineHeight / 2;
          return { y: y + center - reference.getBoundingClientRect().top - rects.floating.height / 2 };
        }

        // Keep BlockNote's offsets for media without a text line (never center on the whole asset).
        return { y: y + (type === 'audio' ? 15 : type === 'file' ? 4 : 0) };
      },
    }],
  },
};
