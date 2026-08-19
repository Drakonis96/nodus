# How to add a post

This file is the template. It is **not** listed in `posts.json`, so it never
appears on the blog. Copy it to write a real post.

## The two steps

1. **Write the file.** Copy this file to `site/blog/posts/<slug>.md`, where
   `<slug>` is kebab-case and will become the URL: `blog/post.html?p=<slug>`.
   Do not put a level-1 heading in it — the title comes from `posts.json`, and
   the page prints it for you. Start at `##`.

2. **List it.** Add an entry to the `posts` array in `site/blog/posts.json`:

```json
{
  "slug": "nodus-vs-notebooklm",
  "title": "Nodus and NotebookLM are not the same tool",
  "date": "2026-08-20",
  "tags": ["Comparisons", "AI"],
  "summary": "Both read your sources. Only one of them keeps the evidence, runs offline, and is still yours next year.",
  "reading": 8,
  "cover": "media/nodus-vs-notebooklm.png",
  "coverAlt": "Real alt text describing the image."
}
```

`reading` is optional; leave it out and the page estimates it from the file.
Set `"draft": true` to keep a post out of the index and the RSS feed while you
are still writing it.

`cover` is optional too. It is a path relative to `site/blog/`, so a file in
`site/blog/media/` is written `media/<file>.png`. The same image is used as the
card thumbnail on the index (cropped to 16:9) and, uncropped, above the post.
Always give it a `coverAlt`.

## What Markdown is supported

Headings from `##` down, **bold**, *italic*, `inline code`, links, images,
blockquotes, unordered and ordered lists, horizontal rules, tables, and fenced
code blocks:

```bash
npm run dev
```

> A blockquote reads like this. Use it for a quotation, not for emphasis.

| Column | Column |
| ------ | ------ |
| Cell   | Cell   |

Images live in `site/blog/media/` and are referenced relatively:
`![Alt text](media/example.png)`. Always write real alt text.

## Planned posts

The first three, once they are written:

- Nodus compared with NotebookLM
- Using Nodus alongside Zotero
- Nodus as an alternative to Obsidian for source-based work
