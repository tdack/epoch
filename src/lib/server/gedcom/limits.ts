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
