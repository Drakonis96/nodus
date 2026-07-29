# Start and close cards

Real examples, taken from the MCP tutorial.

| File | What is it? |
|---|---|
| `title.html` / `title.png` | Opening card, **5 s**: Nodus N centered and below the title |
| `end.html` / `end.png` | Closing card, **8 s**: clear adaptation of the mark closure |

`engine/cards.mjs` generates them for each build in `.tutorial-out/<deck>/cards/`. The HTML is
rendered on a 1280×720 scenario scaled from a 1920×1080 model (if the window is lower than the
screen, the scaling is cut off).

## How to change them

The HTML is embedded in `engine/cards.mjs`. To test without assembling the entire video, open the
`title.html` from the last build in a browser, adjust it as needed, and transfer the change
to the generator.

The **title** is not played here: it comes out of `TITLE`, in the `shots.mjs` of each deck, so that
each video carries its own without duplicating the model.

## YouTube Thumbnail

It is a frame from the opening card of the assembled video:

```bash
ffmpeg -ss 2 -i .tutorial-out/<deck>/nodus-tutorial-<deck>-en-final.mp4 -frames:v 1 -q:v 2 -y miniatura.jpg
```
