/**
 * Descriptor for the published ORD reaction-index artifact.
 *
 * The index is built offline (see tools/reaction-index) and published as a GitHub Release asset;
 * it is far too large to ship inside the application or a capability package (about 263 MB across
 * the six files below), so it is downloaded on demand and verified by size + SHA-256.
 *
 * Pin exactly one revision of one build. The `sha256` values come straight from the build's
 * manifest.json and are the authority for integrity; `bytes` is an early size guard. When a new
 * index is published, bump `version` and replace every entry together.
 */

export interface ReactionIndexFile {
  /** File name inside the index directory, e.g. `exact.tsv.zst`. */
  name: string;
  /** Exact size in bytes, from the build manifest. */
  bytes: number;
  /** Lowercase hex SHA-256, from the build manifest. */
  sha256: string;
}

export interface ReactionIndexRelease {
  id: string;
  /** Release version of the artifact as a whole. */
  version: string;
  /** On-disk artifact format version (`manifest.json` `version`). */
  formatVersion: number;
  /** Open Reaction Database revision the index was built from. */
  revision: string;
  /** Base `.../releases/download/<tag>` URL, or null until the artifact is published. */
  releaseUrl: string | null;
  licence: string;
  citation: string;
  files: readonly ReactionIndexFile[];
}

/**
 * `releaseUrl` is intentionally null: the artifact has not been published to a release yet. The
 * service then only reports `published: false` unless a developer override points at a local build
 * (`NODUS_REACTION_INDEX_DIR`). Fill this in when the release exists.
 */
export const REACTION_INDEX: ReactionIndexRelease = {
  id: 'ord-reaction-index',
  version: '1.0.0',
  formatVersion: 3,
  revision: '93475c46949f9218e1dfb6624096025135db2add',
  releaseUrl: null,
  licence: 'CC-BY-SA-4.0',
  citation: 'Kearnes et al., J. Am. Chem. Soc. 2021, 143 (45), 18820-18826, doi:10.1021/jacs.1c09820',
  files: [
    { name: 'exact.tsv.zst', bytes: 54456029, sha256: 'e33a5863d9e35e0b3d436b3991d30317fc6ed387242a92aa59c57e6f378ef238' },
    { name: 'templates.tsv.zst', bytes: 29091076, sha256: 'e5f48b93e887802ae2de703687c4cc6e73b25c6e809900b2d9983332c078172f' },
    { name: 'products.tsv.zst', bytes: 35884037, sha256: '348d2471384b4f1c7b3772caa5e6e4eb0c39cafcaf54a960e71ded77b08793e9' },
    { name: 'reaction-smiles.tsv.zst', bytes: 62211963, sha256: '2de7c5949193207618e2eeb8d75a3efd349d6fdce1aff28d62afda00ceebfe45' },
    { name: 'reactions.faiss.zst', bytes: 56399151, sha256: '92ea4d92a2566ff3ef3e792f9bcb0fe22ba8b31c4063366418e7b78d9bd34c5d' },
    { name: 'reaction-keys.txt.zst', bytes: 25188968, sha256: 'b18fae699932ed917859e7689ed7696245fbde726c5826ac9eec2018de1a7b9a' },
  ],
};

export type ReactionIndexSource = 'release' | 'override' | 'none';

export interface ReactionIndexFileStatus {
  name: string;
  bytes: number;
  downloadedBytes: number;
  received: boolean;
}

export interface ReactionIndexStatus {
  version: string;
  revision: string;
  /** A complete, size+SHA-256-verified index is present on disk and usable. */
  available: boolean;
  /** A release URL is configured for this build (false until the artifact is published). */
  published: boolean;
  source: ReactionIndexSource;
  /** Absolute directory holding the index files, when available or partway downloaded. */
  path: string | null;
  totalBytes: number;
  downloadedBytes: number;
  downloading: boolean;
  /** 0..1 across all files. */
  progress: number;
  files: ReactionIndexFileStatus[];
}

export function reactionIndexTotalBytes(release: ReactionIndexRelease = REACTION_INDEX): number {
  return release.files.reduce((sum, file) => sum + file.bytes, 0);
}
