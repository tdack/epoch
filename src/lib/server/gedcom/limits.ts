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
