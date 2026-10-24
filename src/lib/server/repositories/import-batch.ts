import type { BatchItem } from 'drizzle-orm/batch';

/** What a GEDCOM import's writers share while they build its writes. */
export interface ImportBatch {
	/**
	 * Every write of the import, in order. The caller runs them as one D1 batch, which is one
	 * transaction, so a replace import that fails part way leaves the old tree as it was.
	 */
	writes: Array<BatchItem<'sqlite'>>;
	/**
	 * The tree holds nothing the writers could meet: it is new, or a replace import clears it in the
	 * same batch. Its rows are not read then, because the clearing has not run yet.
	 */
	isTreeEmpty: boolean;
}
