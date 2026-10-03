# AppImage update compatibility

Linux releases publish `Nodus-x86_64.AppImage` and
`Nodus-x86_64.AppImage.zsync`. The AppImage name deliberately omits `linux`, as
requested by the AppImage catalogue. An identical copy named
`Nodus-linux-x86_64.AppImage` keeps existing README, website and third-party
download links working. The Electron manifest points to the canonical name;
electron-updater preserves an installed file's custom, unversioned name.

The compatibility alias uploads first, followed by the canonical artifact. The
catalogue's `find-appimage.sh` treats these names as the same application and
chooses the most recently uploaded build. A retry must keep that order too.

## Build sequence

The shared release workflow runs electron-builder, verifies the Linux glibc
floor, and then runs:

```sh
sudo apt-get install --no-install-recommends -y zsync
NODUS_RELEASE_CHANNEL=latest node scripts/finalize-linux-appimage.mjs release
```

For beta releases use `NODUS_RELEASE_CHANNEL=beta`. The version comes from the
matching `<channel>-linux.yml` file and must match that channel.

The finalizer works on a temporary copy and:

1. Writes update information into the runtime's reserved `.upd_info` ELF
   section. The squashfs payload, launcher, ELF section locations and runtime
   code are preserved.
2. Removes the previous embedded Electron blockmap, generates a new one with
   the installed electron-builder implementation, and updates the manifest's
   size, SHA-512 and blockmap size, including its legacy top-level pointer.
3. Runs `zsyncmake` on the final bytes, including the new blockmap. Its download
   URL points to the immutable release tag.
4. Verifies the ELF metadata, embedded blockmap coverage, Electron hashes,
   zsync length/SHA-1/URL, and produces the compatibility alias.

An unknown runtime layout, missing blockmap or mismatched channel fails the
release before upload. Repeating the finalizer replaces the old blockmap rather
than appending another one.

The embedded stable information is:

```text
gh-releases-zsync|jorgepb96|nodus|latest|Nodus-x86_64.AppImage.zsync
```

Beta uses `latest-all`, so external updater users can move from a beta to a
newer stable release, as they can with Nodus's built-in updater. Stable always
uses `latest`, which excludes prereleases. This adds support for external
AppImageUpdate tools; it does not add another automatic download process to
Nodus.

## Verification

On x86_64 Linux with Node.js 22, installed npm dependencies, `zsync` and
`libfuse2`, run:

```sh
node --test scripts/test-appimage-updates.mjs scripts/test-release-artifact-names.mjs
node scripts/verify-appimage-updates.mjs
```

The integration check builds real stable and beta AppImages with the same
electron-builder toolset as Nodus. It asks the runtime to read update metadata,
compares extracted contents, executes the packaged launcher, checks identical
legacy aliases and repeated finalization, reconstructs an update with both the
zsync client and electron-updater's differential downloader, and checks the
real installer's preservation of a legacy filename and restart request.
Downloads use a local HTTP server with range requests. The dedicated
`AppImage update compatibility` workflow runs this on Ubuntu 22.04.

Release builds additionally check the runtime's reported update information and
compare the alias before upload; publication requires both AppImages and the
`.zsync` file. The repository's public download links intentionally continue
using the compatibility alias, so deploying the website before the first
release with the new canonical asset does not create a broken link.

References: [AppImage update specification](https://github.com/AppImage/AppImageSpec/blob/master/draft.md#update-information),
[making AppImages updateable](https://docs.appimage.org/packaging-guide/optional/updates.html).
