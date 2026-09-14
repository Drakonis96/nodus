// What may not travel inside a notarized macOS build.
//
// Apple's notary service does not treat an archive found inside a submitted app as opaque
// data. It opens it and applies the same rules to what is inside: every Mach-O file must
// carry a Developer ID signature with a secure timestamp. A `.nodus-plugin` is a zip, so a
// capability package sitting in Contents/Resources is not a payload to the notary — it is
// more code to check, and code nothing in this repository can sign, because the bytes are
// pinned by digest against a manifest the publisher signed.
//
// Chemistry Studio 2.2.0 vendored `tar-fs`, which carries `bare-fs`, `bare-path` and
// `bare-url`. Those ship prebuilt binaries for every platform the Bare runtime supports,
// macOS and iOS included. Under Node they are never loaded — `tar-fs` resolves the Bare
// variants only under the `bare` runtime condition — but the notary does not care whether
// code runs, only whether it is signed. That is what rejected the first v5.4.0 macOS
// builds: fifteen unsigned Mach-O files, five each in three packages nothing ever opens.
//
// Chemistry Studio 2.2.1 stops vendoring them, so nothing is withheld today. This stays as
// the check that keeps it that way: no package reaches a macOS build carrying native code
// that no release here can sign, and a build says so by name rather than dying in the
// notary twenty minutes later.
//
// Nothing here signs anything, and nothing here hides anything. It answers one question,
// cheaply and before the expensive build: would this archive fail notarization?
import AdmZip from 'adm-zip';

// Mach-O thin binaries (32- and 64-bit) and universal "fat" binaries, in both byte orders.
const MACH_O_MAGIC = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

// 0xCAFEBABE is also the magic of a Java class file, which the notary has no opinion
// about. The extension is the only thing that separates them without parsing the header,
// and mistaking a class file for a binary would withhold a package for no reason.
const isJavaClass = (name) => name.toLowerCase().endsWith('.class');

/** Every entry in a `.nodus-plugin` archive that a notarization run would reject. */
export function machOEntries(archive) {
  const zip = new AdmZip(archive);
  const found = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || entry.header.size < 4 || isJavaClass(entry.entryName)) continue;
    let bytes;
    try { bytes = entry.getData(); } catch { continue; }
    if (bytes.length >= 4 && MACH_O_MAGIC.has(bytes.readUInt32BE(0))) found.push(entry.entryName);
  }
  return found;
}

/** What stops a package being bundled, for the platform this build is for.
 *
 *  Only macOS is notarized, and only macOS refuses a build over what an archive contains.
 *  Windows and Linux carry the package exactly as published, so the offline migration they
 *  promise stays whole; the foreign prebuilds are as inert there as they are here. */
export function unnotarizablePayload(archive, platform = process.platform) {
  return platform === 'darwin' ? machOEntries(archive) : [];
}
