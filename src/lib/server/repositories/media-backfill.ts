/**
 * ADR-082, migration step 3: gives every file written before objects existed an object of its own.
 * Kept as SQL in the app's source so `scripts/backfill-media-objects.mjs` and its test run the same
 * statements. Each is one line, because D1's `exec` splits on newlines.
 *
 * Idempotent in both statements: the first skips a file whose object already exists (a run that
 * stopped between the two), the second touches only files still without one. The object takes the
 * file's id, version, timestamps and uploader, so a link (which already names that id) and a client
 * holding the file's version both keep working.
 */
export const BACKFILL_MEDIA_OBJECTS_SQL: readonly string[] = [
	"insert into media_object (id, tree_id, privacy, version, created_at, updated_at, created_by) select m.id, m.tree_id, 'auto', m.version, m.created_at, m.updated_at, m.uploaded_by from media_items m where m.object_id is null and not exists (select 1 from media_object o where o.id = m.id)",
	'update media_items set object_id = id where object_id is null'
];

/** Files still to be given an object; the script reports it before and after. */
export const COUNT_UNBACKFILLED_MEDIA_SQL =
	'select count(*) as n from media_items where object_id is null';
