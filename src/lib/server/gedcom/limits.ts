/**
 * How large an import may be. The upload is the file as sent (a GEDZip is compressed, so this is
 * the archive's size); the dataset is the GEDCOM text once any archive is unpacked. Both are capped
 * because the import holds the whole dataset in the isolate, and a small archive can expand far.
 */

/** The largest uploaded import file, as sent. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/** The largest GEDCOM dataset, once unpacked. */
export const MAX_DATASET_BYTES = 50 * 1024 * 1024;

/**
 * The most bytes a staged dataset can occupy in R2. It is staged as a JavaScript string, and a UTF-16
 * code unit encodes to at most three UTF-8 bytes (a surrogate pair is four bytes for two units).
 */
export const MAX_STAGED_BYTES = MAX_DATASET_BYTES * 3;

/**
 * The most bytes one tree may have staged for queued imports at once. A staged file is removed when
 * its import runs, so this bounds the backlog a single tree can hold in R2 while the queue drains.
 */
export const MAX_STAGED_BYTES_PER_TREE = 100 * 1024 * 1024;

/**
 * How long a staged import can still be waiting for its queue message: the queue's default message
 * retention. An older staged object has no live message (the consumer crashed or ran out of
 * retries), so it stops counting against its tree's cap instead of blocking imports for good.
 */
export const STAGED_IMPORT_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * The largest `.gdz` upload, as sent. A tree's media may total `MAX_TREE_MEDIA_BYTES`, and the
 * dataset rides beside it, so an archive that carries a full tree is no larger than their sum. The
 * archive lives in R2 and is read by range, so unlike `MAX_IMPORT_BYTES` this does not bound memory.
 * The 2 GiB is `MAX_TREE_MEDIA_BYTES` written out: this file is also compiled by the setup tool,
 * whose module settings cannot follow the import. A test pins the two together.
 */
export const MAX_GEDZIP_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 + MAX_DATASET_BYTES;

/**
 * The most bytes an archive's entries may declare in total once inflated. Media is mostly already
 * compressed, so the honest total sits near the upload size; double it leaves room for text-heavy
 * archives and still refuses a directory that promises terabytes. Declared sizes are the
 * archive's own claim, so this is a first refusal; the per-entry stream check enforces it.
 */
export const MAX_GEDZIP_UNCOMPRESSED_BYTES = MAX_GEDZIP_UPLOAD_BYTES * 2;

/** The most entries a `.gdz` may list. Folders count; it is below zip's own 65,535 limit. */
export const MAX_GEDZIP_ENTRIES = 50_000;

/**
 * The largest central directory read into memory. 50,000 entries at a few hundred bytes each fit
 * easily; the cap exists because a name may be 65,535 bytes and the directory's size is declared.
 */
export const MAX_GEDZIP_DIRECTORY_BYTES = 16 * 1024 * 1024;

/**
 * An entry may expand to at most this many output bytes per stored byte. Deflate itself cannot pass
 * about 1032:1, so this sits just under that and refuses only the most extreme zip bombs.
 */
export const MAX_GEDZIP_EXPANSION_RATIO = 1_000;

/**
 * Output below this size is exempt from the ratio check: a small run of zeros legitimately
 * compresses past the ratio, and a few hundred kilobytes cannot hurt.
 */
export const GEDZIP_RATIO_FLOOR_BYTES = 1024 * 1024;
