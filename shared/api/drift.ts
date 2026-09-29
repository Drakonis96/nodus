// The Nodus Drift slice of the window.nodus contract.
//
// Deliberately two methods and no more. The catalogue says what exists and whether it can
// be played; `readDriftAudio` hands back the bytes of ONE bundled recording that the
// catalogue itself authorises. There is no path, no URL, no generic file read and no way
// to name anything but a catalogued sound id. Neither method belongs to any reduced
// window bridge, and nothing here is reachable from a page or from a public server.
import type { DriftCatalogResponse } from '../drift';

export interface DriftApi {
  /**
   * The local catalogue with the availability of every entry: `available`, `missing`
   * (authorised but the file is not there) or `license-unresolved` (not authorised for
   * distribution, so never bundled). Asked once when Drift opens, and again on a retry.
   */
  getDriftCatalog(): Promise<DriftCatalogResponse>;
  /**
   * The bytes of an authorised bundled recording, verified against the catalogue.
   * Rejects for an unknown id, an unauthorised sound, a missing, empty, oversized or
   * altered file. The reason is carried as `drift-audio:<code>:` at the start of the message.
   */
  readDriftAudio(soundId: string): Promise<Uint8Array>;
}
