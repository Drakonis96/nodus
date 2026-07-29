# Background music

The four tutorials use **a single theme in loop**, with input and output cast and lateral
compression, so that the voice always goes ahead.

## Where to look

`engine/cards.mjs` resolves it in this order:

1. `NODUS_TUTORIAL_MUSIC=/ruta/al/tema.mp3`
2. the first audio file **in this folder**
3. `~/Desktop/Quiet Dashboard Glow.mp3`, where the first videos took it

If none is found, assemble the video **without music** and report it in the console instead of failing.

## Why audio is not in the repository

This repository is public and the theme used so far is a personal file of the author, without a
license declared for redistribution. Adding it here would be to publish it.

Leave your theme in this folder (it is ignored by git) or point to it with `NODUS_TUTORIAL_MUSIC`.
If you choose a free-licensed track at any time, this is your site and just remove it from the
`.gitignore` next door.

## How it mixes

The parameters are in `engine/cards.mjs` and should not be touched by eye:

- `MUSIC_GAIN = 0.16` — the bed, far below the voice.
- `sidechaincompress` — music automatically yields when there is narration.
- `acrossfade` — the loop is chained to itself, without audible cutting.
- Input and output funds at the ends of the video.

The original order was clear: *"low and stable, without unusual changes and without overlap of voice
under any circumstances".* Any change must continue to fulfill it.

## Duration

It doesn't matter that the theme is shorter than the video: it repeats in loop and is cut to the
exact duration of the assembly.
