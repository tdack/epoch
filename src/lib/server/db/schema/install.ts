import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Who this install belongs to. Written by the setup tool after migrations (tools/setup), or once by
// `/setup` on a button install after the visitor proves they control the Worker's account (ADR-082).
// Never by signing in: then the first visitor would become the owner, which is what ADR-015
// removed. One row is expected; with none there is no owner and only members and invitees get in
// (ADR-034).
export const installMeta = sqliteTable('install_meta', {
	installId: text('install_id').primaryKey(),
	// Compared lower-cased with the address Access asserts; the setup tool stores it lower-cased.
	ownerEmail: text('owner_email').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
	// What `./setup subdomains` made on the zone, as JSON (ADR-057). The app never reads it: it is
	// kept here, not only in the setup manifest, so a fresh clone can still find and remove the
	// record and the exclusion routes, which carry no marker of their own.
	subdomains: text('subdomains'),
	// The Access application `/setup` made, for a button install whose Worker carries no
	// CF_ACCESS_* vars (ADR-082). Null on an install made by `./setup`, whose vars hold them instead.
	accessTeamDomain: text('access_team_domain'),
	accessAud: text('access_aud')
});
