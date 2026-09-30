# Nodus Drift: provenance of the audio

Everything here is a **fact that can be checked**: where each entry of the catalogue came from,
how every technical field was obtained, and what is still unknown. What is unknown is which
of the two licenses Moodist declares covers each recording, and this file says so instead of
choosing one.

## Upstream

- Repository: https://github.com/remvze/moodist
- Pinned commit: `11c0be2200116a3635880d600fd6953899cc51a3` (`feat: add music radio station player`, 2026-09-27)
- License of Moodist's **code**: MIT, copyright (c) 2023 MAZE; the text is in `MOODIST_LICENSE.txt`
- What was read: `src/data/sounds.ts` and `src/data/sounds/{nature,rain,animals,urban,places,transport,things,noise,binaural}.tsx`
  (the **active** catalogue, not the whole `public/sounds` folder), plus `README.md` and `LICENSE`
- Nothing was taken from `main`: every file was fetched at the commit above, and each download was
  compared with the size and the Git blob SHA-1 that the tree of that same commit lists for it before
  it was measured. The audio itself is **not** stored in this repository; it was only measured.

## Upstream declaration

Anchor: `#upstream-declaration`. Cited by every recording as its evidence.

Moodist's README, at the pinned commit
([section "License"](https://github.com/remvze/moodist/blob/11c0be2200116a3635880d600fd6953899cc51a3/README.md#license)),
declares this for its audio:

> Some sounds used in this project are sourced from third-party providers and **are subject to different licenses**:
>
> - Sounds licensed under the **Pixabay Content License**: [Pixabay Content License](https://pixabay.com/service/license-summary/)
> - Sounds licensed under **CC0**: [Creative Commons Zero License](https://creativecommons.org/publicdomain/zero/1.0/)

The same section says that the project itself is MIT-licensed; that is Moodist's
[`LICENSE`](https://github.com/remvze/moodist/blob/11c0be2200116a3635880d600fd6953899cc51a3/LICENSE) (copyright (c) 2023 MAZE) and it covers
its code. Moodist does **not** say which of the two audio licenses applies to which file.

What else was looked for, and found:

- The tree of that commit has no credits, attribution or notice file: the only license-like file is
  `LICENSE` (the MIT text above). Neither the README nor the catalogue modules name an author or a
  source page for any sound.
- The recordings' own metadata: 77 of the 81 files carry only an `encoder` tag (`LAME3.100`), 3 carry no tag at all (`frog`, `keyboard`, `thunder`), and one, `restaurant`, also carries `title: "Resturant Ambience"` and `artist: "Michael Shahen"`. That is a lead for whoever reviews it, not a license: it names no license and does not say who published the recording or where.

That declaration is the evidence for the recordings, and it is why they are recorded as `declared`
and not as `verified`: their license is the one Moodist declares, and nobody traced the individual
files to their original pages. The catalogue names it `LicenseRef-Moodist-declared-Pixabay-or-CC0`.
The MIT license on Moodist's code says nothing about files whose authors are third parties, and Nodus
does not use it for the audio. The decision to distribute the recordings on this basis is the
maintainer's and is recorded in `REVIEW.md#recordings`.

## What was and was not reused

| | Count | Decision |
| --- | --- | --- |
| Recordings (`.mp3`) in the active catalogue | 81 | bundled unmodified, as `declared` and approved (table below) |
| Noise WAVs (`white`, `pink`, `brown`) | 3 | **not reused**: replaced by local generators |
| Binaural WAVs (delta, theta, alpha, beta, gamma) | 5 | **not reused**: replaced by local generators |
| `alarm.mp3`, `silence.wav` | 2 | **not reused**: they sit in `public/sounds` but no entry of the catalogue references them |

Moodist's README says "84 curated ambient sounds". The active catalogue lists 89 entries (81 recordings, 3 noise files and
5 binaural presets), and `public/sounds` holds 82 `.mp3` files: the 81 above and `alarm.mp3`. Nodus does not treat
that figure as a requirement.

## How each technical field was obtained

None was typed by hand.

1. **`bytes`**: the length of the file. It equals the size the upstream tree lists for all 81 files.
2. **`sha256`**: SHA-256 of the file's bytes.
3. **`durationSeconds`**: decoded frames divided by the sample rate, rounded to the millisecond. `ffprobe` gives the sample rate
   and the channel count; `ffmpeg` decodes to 32-bit float PCM at that rate and channel count. The container's own estimate is not used.
4. **`crossfadeMs`**: from the loop seam of the decoded audio, mixed down to mono:
   - the *seam step* is |last sample - first sample| divided by the median absolute sample-to-sample step (taken every fourth frame);
   - the *edge mismatch* is the difference in dB between the RMS of the last and of the first 100 ms;
   - if the seam step is at most 4 **and** the edge mismatch is within 6 dB the loop is treated as already prepared and
     `crossfadeMs` is **0** (the decoded buffer loops natively, untouched);
   - otherwise `crossfadeMs` is min(1000, 20% of the duration in whole milliseconds): the circular crossfade of `loopBuffer.ts`.
   Result: 67 prepared loops and 14 crossfaded (`rain-on-tent`, `walk-in-snow`, `owl`, `dog-barking`, `whale`, `chickens`, `supermarket`, `keyboard`, `singing-bowl`, `tuning-radio`, `vinyl-effect`, `train`, `inside-a-train`, `submarine`). Some of these are
   events with a silent tail (a train pulling out, a singing bowl); a crossfade smooths the join, it cannot make a recording continuous.

Reproduce all of it from a checkout of the pinned commit:

```sh
node scripts/prepare-drift-assets.mjs --measure <checkout>/public/sounds
# prints one row per recording; exits 1 if a measured value differs from the catalogue
# (a file missing from the folder is reported as such, it is not counted as a difference)
```

Totals: **81 recordings, 103863687 bytes (99.05 MiB), 6126 s of audio**. The largest
file is 4.78 MiB, well under the 12 MiB limit the main process enforces.

## Recordings

Each of these is bundled unmodified. Its license is the one Moodist declares for its audio (the Pixabay
Content License or CC0), not identified per file; its distribution is approved in `REVIEW.md#recordings`.

| id | upstream path | bytes | SHA-256 | duration (s) | source | crossfade (ms) | status |
| --- | --- | ---: | --- | ---: | --- | ---: | --- |
| `light-rain` | `public/sounds/rain/light-rain.mp3` | 3775087 | `967eab5ddc2b84808a05fea757460d51461e9dc56e72a3d1490bbb58e7bc6578` | 149.865 | 2 ch · 44100 Hz | 0 | declared / approved |
| `heavy-rain` | `public/sounds/rain/heavy-rain.mp3` | 541741 | `6910161b347a4f616bc42d0b3118982c243d149fe45e55fef74c9a9e1aa08560` | 21.788 | 2 ch · 44100 Hz | 0 | declared / approved |
| `thunder` | `public/sounds/rain/thunder.mp3` | 2193449 | `c96dde1068d5c96a40ad47cccc767a88d907b3d3fdcb84819e18b81dcd6bd2bd` | 68.545 | 2 ch · 44100 Hz | 0 | declared / approved |
| `rain-on-window` | `public/sounds/rain/rain-on-window.mp3` | 838145 | `781add053a83a0a9ac2a6ee2ccc937fed24872d479830c0c98cd70ed03689fe9` | 33.143 | 2 ch · 44100 Hz | 0 | declared / approved |
| `rain-on-car-roof` | `public/sounds/rain/rain-on-car-roof.mp3` | 245005 | `5e16d3e97c97a3a130d13a1300d5ccdd3ed8b7788dc9f76262ead0e4eb8a07d7` | 10.016 | 2 ch · 44100 Hz | 0 | declared / approved |
| `rain-on-umbrella` | `public/sounds/rain/rain-on-umbrella.mp3` | 1040122 | `f31a565bdf853fbf6baba8495fdfed91f161c55756540819ee13dbbca98ab8c0` | 26.555 | 2 ch · 44100 Hz | 0 | declared / approved |
| `rain-on-tent` | `public/sounds/rain/rain-on-tent.mp3` | 1494072 | `427d0a06042c5154345ed95de49b2aebf465716766f64891e49f87c3e7cde787` | 82.571 | 2 ch · 24000 Hz | 1000 | declared / approved |
| `rain-on-leaves` | `public/sounds/rain/rain-on-leaves.mp3` | 697080 | `66669f1e4f90b94016cd3287f7c3b18fd5b76dff7939617b3ba5ec7c92b587ac` | 42.219 | 2 ch · 24000 Hz | 0 | declared / approved |
| `river` | `public/sounds/nature/river.mp3` | 3895214 | `b0360cd39425a23f7957a152ec61113226f423a9e2e08071d5f37200357e6289` | 113.427 | 2 ch · 44100 Hz | 0 | declared / approved |
| `waves` | `public/sounds/nature/waves.mp3` | 2347690 | `40c670e678b5ee19ff67a8c322490b1f7d2d53124cf9e8b07efd329138aaa8f8` | 98.661 | 2 ch · 44100 Hz | 0 | declared / approved |
| `campfire` | `public/sounds/nature/campfire.mp3` | 3245619 | `9625b15c7f6a4a2d16db937f0e1042762421f9a3ab74f60235bd63654bba13db` | 125.405 | 2 ch · 44100 Hz | 0 | declared / approved |
| `wind` | `public/sounds/nature/wind.mp3` | 1606823 | `556ec1d90038aa92f754de84d58e8973693836b1e0358834536ca7824f40c973` | 73.424 | 2 ch · 44100 Hz | 0 | declared / approved |
| `howling-wind` | `public/sounds/nature/howling-wind.mp3` | 522840 | `dd00c875c58c033d2f3b94e247d2b5a366ed529a659cc2d19e00dd84ad0e464d` | 55.945 | 2 ch · 24000 Hz | 0 | declared / approved |
| `wind-in-trees` | `public/sounds/nature/wind-in-trees.mp3` | 1294948 | `b29f775dda9789004aaceee392e124eaa35c0386d27f99b93a639185d98f6b4b` | 57.556 | 2 ch · 44100 Hz | 0 | declared / approved |
| `waterfall` | `public/sounds/nature/waterfall.mp3` | 551904 | `46d0848f5876d0f461e8439f812464742710f5f6d236baa977f382d794c60b0a` | 23.486 | 2 ch · 48000 Hz | 0 | declared / approved |
| `walk-in-snow` | `public/sounds/nature/walk-in-snow.mp3` | 925248 | `11d89616a1fff14d3c8c57efd88d8d1f66189a2105b13b22b63d886e10e8308c` | 36.667 | 2 ch · 48000 Hz | 1000 | declared / approved |
| `walk-on-leaves` | `public/sounds/nature/walk-on-leaves.mp3` | 310632 | `a7f49dc2253c7ce58399865d518f947e377fcf6e78e0d53b270c3497d4021c52` | 20.573 | 2 ch · 24000 Hz | 0 | declared / approved |
| `walk-on-gravel` | `public/sounds/nature/walk-on-gravel.mp3` | 1148568 | `0029d593b2803f035912a4695b499df60d23333e2781f848b243a0b35f5dc16e` | 70.828 | 2 ch · 24000 Hz | 0 | declared / approved |
| `droplets` | `public/sounds/nature/droplets.mp3` | 798168 | `d21f0af60663a03b477739a425ddc59be394ff60ddd1a877bff280b352a57d77` | 51.753 | 2 ch · 24000 Hz | 0 | declared / approved |
| `jungle` | `public/sounds/nature/jungle.mp3` | 4077048 | `a0ac0b48a8e28d3dde17203e386a722afafe057d1b5d1fb5d13918175a440335` | 266.696 | 2 ch · 24000 Hz | 0 | declared / approved |
| `birds` | `public/sounds/animals/birds.mp3` | 2059536 | `f9b022ed2df9f727a8e84e614b25965112dfe2bbb30cdf8c3db0442ae1eed489` | 115.119 | 2 ch · 24000 Hz | 0 | declared / approved |
| `seagulls` | `public/sounds/animals/seagulls.mp3` | 519900 | `ceae3d3a3c57e6c383c86e4a427b538379299133ba595e3b4f40e051886c13a8` | 43.475 | 1 ch · 44100 Hz | 0 | declared / approved |
| `crickets` | `public/sounds/animals/crickets.mp3` | 2841144 | `126bf1620193fa43a711d3cf6658a06f9fef5bd4eb42bf2ae48da0da1b73605c` | 172.538 | 2 ch · 24000 Hz | 0 | declared / approved |
| `wolf` | `public/sounds/animals/wolf.mp3` | 587749 | `b87652f48a9e24bd47a0bcf18b3e8f61368521148bdb384c908677a460ae56c6` | 55.371 | 1 ch · 44100 Hz | 0 | declared / approved |
| `owl` | `public/sounds/animals/owl.mp3` | 97309 | `7fcd61d5953f564930220bc2579d6071068977f92c7bf5ed6117a57112c55a82` | 12.943 | 1 ch · 44100 Hz | 1000 | declared / approved |
| `frog` | `public/sounds/animals/frog.mp3` | 1572960 | `c41fbbbfbe896a11fd19c0f8dc9185a000462239ff971625ac8eaedd05480b8c` | 78.648 | 2 ch · 24000 Hz | 0 | declared / approved |
| `dog-barking` | `public/sounds/animals/dog-barking.mp3` | 226488 | `470bd3edaf2e37f3f0c78f0779d773ae59466e4965494875f1c0f4de6bfe0604` | 16.179 | 2 ch · 24000 Hz | 1000 | declared / approved |
| `horse-gallop` | `public/sounds/animals/horse-gallop.mp3` | 169968 | `60d455c6d45732b21fdc3fdfc3c517a37d5f0248e3b7b3274939ab2177e633e6` | 9.143 | 2 ch · 24000 Hz | 0 | declared / approved |
| `cat-purring` | `public/sounds/animals/cat-purring.mp3` | 450384 | `a779a2a3fe77b08722517e2e1a4f8ecbfb59a6282a74e46f0e9244d6cfdf230e` | 38.662 | 1 ch · 48000 Hz | 0 | declared / approved |
| `crows` | `public/sounds/animals/crows.mp3` | 775776 | `d39e6732f7713152f697de53053feffe10fc911aa6b7494e01bdca2731edabf1` | 58.078 | 2 ch · 48000 Hz | 0 | declared / approved |
| `whale` | `public/sounds/animals/whale.mp3` | 360552 | `e88047b74a6566e07994454d5d6c5ab5ca400485d61d0ee74a5218184187dc17` | 30.006 | 2 ch · 48000 Hz | 1000 | declared / approved |
| `beehive` | `public/sounds/animals/beehive.mp3` | 978816 | `97a42f09b8b4bf2bb2b6eceb7f1f67a7cde599d16252140102fcf4c3af41c6a8` | 45.155 | 2 ch · 48000 Hz | 0 | declared / approved |
| `woodpecker` | `public/sounds/animals/woodpecker.mp3` | 167784 | `b2c66c84d6d9ef6d9cc6d064d2da7b9068f994d1e18080f6a62deaa786b18eaf` | 15.319 | 2 ch · 24000 Hz | 0 | declared / approved |
| `chickens` | `public/sounds/animals/chickens.mp3` | 5017248 | `c869f4c5e046d7fefca787363fbec4f466fbf2be5493954eca9ee11a67397d38` | 202.076 | 2 ch · 48000 Hz | 1000 | declared / approved |
| `cows` | `public/sounds/animals/cows.mp3` | 557928 | `a1675bfe879d428e9e0079c1ca40ab583774489c1b26894e3e0c25bd0f8516d8` | 59.699 | 2 ch · 24000 Hz | 0 | declared / approved |
| `sheep` | `public/sounds/animals/sheep.mp3` | 716640 | `e1f144b6cbbaf736c83372edbeee7aba65eba215e4789d0670eaa7dc6ad135fa` | 31.194 | 2 ch · 48000 Hz | 0 | declared / approved |
| `cafe` | `public/sounds/places/cafe.mp3` | 1776720 | `04b818f9e7c31d57c7f0d522bcf7d9f708c728f046d009953e4fbc18723a0300` | 199.095 | 2 ch · 24000 Hz | 0 | declared / approved |
| `airport` | `public/sounds/places/airport.mp3` | 4501440 | `9bb9a5d0426c1d865ea9a66d06bc81d63ef40bb418b48bc3819850b95000c9c0` | 311.61 | 2 ch · 24000 Hz | 0 | declared / approved |
| `church` | `public/sounds/places/church.mp3` | 772224 | `c71217c3b55113b057ee1d82e57b173be184d68b1e3cf53b3fcc17b8792f69ec` | 70.479 | 1 ch · 48000 Hz | 0 | declared / approved |
| `temple` | `public/sounds/places/temple.mp3` | 1558056 | `680ffbb188ac4068ab775d9da505b0dc6a1fac2e424b9f1ed6d857574f36c44c` | 91.617 | 2 ch · 24000 Hz | 0 | declared / approved |
| `construction-site` | `public/sounds/places/construction-site.mp3` | 1571208 | `51309aadc58e78d0fdba194cfbeb7dfe84fbfba430899e5df4d8b884aadf18eb` | 125.049 | 2 ch · 24000 Hz | 0 | declared / approved |
| `underwater` | `public/sounds/places/underwater.mp3` | 526008 | `addd91f799f3b77d8032c32745a0c039804502eb1c65039790dae66428e27164` | 43.249 | 2 ch · 24000 Hz | 0 | declared / approved |
| `crowded-bar` | `public/sounds/places/crowded-bar.mp3` | 855192 | `3afbd498ed30d84b5050878ed1656eebb378e69b4d9c62b15615a42ffb8fd5ab` | 58.735 | 2 ch · 24000 Hz | 0 | declared / approved |
| `night-village` | `public/sounds/places/night-village.mp3` | 2282322 | `9f012d72f5923208c223065d727a01afecc7d3253064c2e868dc658c33369f8a` | 106.417 | 2 ch · 44100 Hz | 0 | declared / approved |
| `subway-station` | `public/sounds/places/subway-station.mp3` | 2243112 | `4b749d4c6d9f9a9b09744325bc358eca80440ba98debdd1ca69a8fcc3cc6dade` | 171.03 | 2 ch · 24000 Hz | 0 | declared / approved |
| `office` | `public/sounds/places/office.mp3` | 1965408 | `32691ad3d1f0cd6175a4e648ad15c5fd354ad0e59a3ce0b246fd7cf89d9a4169` | 139.727 | 2 ch · 24000 Hz | 0 | declared / approved |
| `supermarket` | `public/sounds/places/supermarket.mp3` | 2315472 | `a33a739ef44a4794d5c0b58b93057312f85d628eac19e45fcb57c70a420f8b66` | 175.094 | 2 ch · 24000 Hz | 1000 | declared / approved |
| `carousel` | `public/sounds/places/carousel.mp3` | 2326344 | `cd1d17f381c10b3a9adb966e34786f150241c424cf279d2c98d0bba6df16e750` | 160.764 | 2 ch · 24000 Hz | 0 | declared / approved |
| `laboratory` | `public/sounds/places/laboratory.mp3` | 384384 | `bc07a653b11b7bd43959124aa5d946613735f2ad130856b43535b305a3ff09af` | 21.234 | 2 ch · 24000 Hz | 0 | declared / approved |
| `laundry-room` | `public/sounds/places/laundry-room.mp3` | 737186 | `b24f418d7d1b931312944f2383fcca0f56fe5c397b8e8571cc3ab1b27f701da4` | 32.484 | 2 ch · 44100 Hz | 0 | declared / approved |
| `restaurant` | `public/sounds/places/restaurant.mp3` | 3552736 | `e4e7c25aa81c25bcae0ef010b3fecbdf08371b8af675ecd29972d7a561ddecaa` | 170.887 | 2 ch · 48000 Hz | 0 | declared / approved |
| `library` | `public/sounds/places/library.mp3` | 3825455 | `95095ef77ed7f1d1c2550b6f39d95cde31f72b37d8023c1dfd7c22931d84fe05` | 176.528 | 2 ch · 44100 Hz | 0 | declared / approved |
| `keyboard` | `public/sounds/things/keyboard.mp3` | 388702 | `2499954ba838ce1b32b79560a2ab273209ae350bb9988490738ed2e2b23f82ae` | 12.147 | 2 ch · 44100 Hz | 1000 | declared / approved |
| `typewriter` | `public/sounds/things/typewriter.mp3` | 341160 | `0d56f3a9482e7edad9a6e58130d733883c89f36f51e1c8dd9fde7a3b5cf276b8` | 21.781 | 2 ch · 24000 Hz | 0 | declared / approved |
| `paper` | `public/sounds/things/paper.mp3` | 156480 | `6aecf96cbcb2403188c010bcdae37de74b604c494dda3097b5cc0a206f686741` | 17.209 | 2 ch · 24000 Hz | 0 | declared / approved |
| `clock` | `public/sounds/things/clock.mp3` | 90674 | `45283d30ccc1ccebab2ddb84dbaaaedf5265275c33cb7c4c8defce9451059160` | 15.94 | 1 ch · 44100 Hz | 0 | declared / approved |
| `wind-chimes` | `public/sounds/things/wind-chimes.mp3` | 2255187 | `212558c58fdb5b8f490b9c1d9b6f3c7469d025b4feff4df4014bff60d0422cf9` | 83.009 | 2 ch · 44100 Hz | 0 | declared / approved |
| `singing-bowl` | `public/sounds/things/singing-bowl.mp3` | 431808 | `9b86534b01679a113a26da201f6160d604c9408ddd6effb00e38c5be78f0192e` | 49.082 | 2 ch · 24000 Hz | 1000 | declared / approved |
| `ceiling-fan` | `public/sounds/things/ceiling-fan.mp3` | 179273 | `c2c009912df561236cc3ca2fb428384ae63f5f869d5178b0a62aabe856df86fb` | 15.593 | 1 ch · 44100 Hz | 0 | declared / approved |
| `dryer` | `public/sounds/things/dryer.mp3` | 136692 | `6d666dd1936172ac237915f5dc035d242deddd8ff1a78a765073eda18f8e3e2f` | 28.025 | 1 ch · 16000 Hz | 0 | declared / approved |
| `slide-projector` | `public/sounds/things/slide-projector.mp3` | 1888392 | `f87b98c4d5f1d5979679a870928700baa03c78a52785eaa25941373c16f0f5f2` | 142.884 | 2 ch · 24000 Hz | 0 | declared / approved |
| `boiling-water` | `public/sounds/things/boiling-water.mp3` | 526603 | `9c2e35cbd002c0b13aa82301781878654c6fe651325de8be971721ccb95128a1` | 18.498 | 2 ch · 44100 Hz | 0 | declared / approved |
| `bubbles` | `public/sounds/things/bubbles.mp3` | 102912 | `96f743156f8f9402f1fa7341415d3d9a4bc09316fe94e27c07ce45d211a18c5b` | 6.39 | 1 ch · 48000 Hz | 0 | declared / approved |
| `tuning-radio` | `public/sounds/things/tuning-radio.mp3` | 769551 | `2ed7619d3a98c5298728a7e3fc60971cadf0a573b7f1ce46d11a8d69e53becd6` | 70.23 | 1 ch · 44100 Hz | 1000 | declared / approved |
| `morse-code` | `public/sounds/things/morse-code.mp3` | 228312 | `a00a81bbbcafdcdb2196054941827ecf9d2075ff7459f5794e6b6acabc979b10` | 75.388 | 1 ch · 8000 Hz | 0 | declared / approved |
| `washing-machine` | `public/sounds/things/washing-machine.mp3` | 191760 | `f468aaf120141cb618085d33aba190e81f8e85ba6efe5f292ff0a920edabf955` | 22.53 | 2 ch · 24000 Hz | 0 | declared / approved |
| `vinyl-effect` | `public/sounds/things/vinyl-effect.mp3` | 1556698 | `037f7a6ac2a78c1378381048b40049b4960801a4f1e2a209991a64f8744fa46d` | 65.901 | 2 ch · 44100 Hz | 1000 | declared / approved |
| `windshield-wipers` | `public/sounds/things/windshield-wipers.mp3` | 207528 | `858490d7480c62728d976b2aee26193c282f5f0aace7a1bf3001994b7f02d93f` | 15.124 | 2 ch · 24000 Hz | 0 | declared / approved |
| `train` | `public/sounds/transport/train.mp3` | 1277043 | `ee81ed9e0ce6bfc14ce21209615e6f7156384c8213f8c80b5fae3665005ef788` | 61.063 | 2 ch · 44100 Hz | 1000 | declared / approved |
| `inside-a-train` | `public/sounds/transport/inside-a-train.mp3` | 1441920 | `8689c8f151910752fd94fce9c78ce6d48a4d6653c25f966f056f34e6ef448459` | 66.504 | 2 ch · 48000 Hz | 1000 | declared / approved |
| `airplane` | `public/sounds/transport/airplane.mp3` | 840264 | `170fcd68d60ebe89ac26425a0c38c437b70071cc4919419bbb0cbc92a3cb5af8` | 60.032 | 2 ch · 24000 Hz | 0 | declared / approved |
| `submarine` | `public/sounds/transport/submarine.mp3` | 696408 | `739e7ae10aa770522b0007482813f8961567fda8cf2941fce46acfe00fdd18e8` | 46.032 | 2 ch · 24000 Hz | 1000 | declared / approved |
| `sailboat` | `public/sounds/transport/sailboat.mp3` | 2186472 | `8701ec1f21561d53c006cf2af4dd540a1b952ed56da4315d382c70a8c01d120f` | 160.521 | 2 ch · 24000 Hz | 0 | declared / approved |
| `rowing-boat` | `public/sounds/transport/rowing-boat.mp3` | 597072 | `c4347ae2fa806079198c96c13937e17be7a084c976d566846e322aeefece84d1` | 25.535 | 2 ch · 44100 Hz | 0 | declared / approved |
| `highway` | `public/sounds/urban/highway.mp3` | 1671552 | `3de274910ddffa6b1ebfce67875aff87b4b7a4c662e49fbb822e5e39458006b5` | 132.503 | 2 ch · 24000 Hz | 0 | declared / approved |
| `road` | `public/sounds/urban/road.mp3` | 1548480 | `df23f3692a02823fe000966d9d0a38c76094958ab26f11e76448c09d41875cd8` | 102.353 | 2 ch · 24000 Hz | 0 | declared / approved |
| `ambulance-siren` | `public/sounds/urban/ambulance-siren.mp3` | 337224 | `5ba2cefd6677e97be596117771a8394ebdb51905530b72578b5913675033e2a4` | 22.589 | 2 ch · 24000 Hz | 0 | declared / approved |
| `busy-street` | `public/sounds/urban/busy-street.mp3` | 2328744 | `3f819591a58f280683ab934e9c6a1b90c58531ec5920826e9d887668a0f757e2` | 175.356 | 2 ch · 24000 Hz | 0 | declared / approved |
| `crowd` | `public/sounds/urban/crowd.mp3` | 610200 | `720313446ff6dd117f271bcb5082d3d78a038dd284fe9d3e3a4ceb158bcaeafa` | 72.563 | 2 ch · 24000 Hz | 0 | declared / approved |
| `traffic` | `public/sounds/urban/traffic.mp3` | 452324 | `3fa2fe742335124d0226f4ba4a9cb86bbc08e1d82d9b3ef6971cff74035cd61f` | 39.89 | 1 ch · 44100 Hz | 0 | declared / approved |
| `fireworks` | `public/sounds/urban/fireworks.mp3` | 581400 | `5436e6e89037d5ccf10a27fdb9164566bf68d4628c3537bcac32e8853989e514` | 34.495 | 2 ch · 24000 Hz | 0 | declared / approved |

## Generators

Computed on the listener's machine by Nodus's own code; no audio is read for them (see `REVIEW.md#first-party-generators`).

| id | what it is | license | status |
| --- | --- | --- | --- |
| `white-noise` | white noise | AGPL-3.0-only | verified / approved |
| `pink-noise` | pink noise | AGPL-3.0-only | verified / approved |
| `brown-noise` | brown noise | AGPL-3.0-only | verified / approved |
| `binaural-delta` | binaural, carrier 100 Hz, beat 2 Hz (ears at 99 and 101 Hz) | AGPL-3.0-only | verified / approved |
| `binaural-theta` | binaural, carrier 100 Hz, beat 5 Hz (ears at 97.5 and 102.5 Hz) | AGPL-3.0-only | verified / approved |
| `binaural-alpha` | binaural, carrier 100 Hz, beat 10 Hz (ears at 95 and 105 Hz) | AGPL-3.0-only | verified / approved |
| `binaural-beta` | binaural, carrier 100 Hz, beat 20 Hz (ears at 90 and 110 Hz) | AGPL-3.0-only | verified / approved |
| `binaural-gamma` | binaural, carrier 100 Hz, beat 40 Hz (ears at 80 and 120 Hz) | AGPL-3.0-only | verified / approved |

## What this record does not claim

- Which of the two declared licenses covers a given recording.
- That the terms of either license, read for a given file, allow every use: they have to be read at the links above.
- That the recordings are original to Moodist, or that Moodist's maintainers hold rights in them.
- That embedding a file in an installer, or not offering an export button, changes any of the above.

The identifiers, English labels and relative paths in the catalogue are facts read from MIT-licensed data
files and are attributed in `THIRD_PARTY_NOTICES.md`; no Moodist source code is used.
