import type { D1Database } from '@cloudflare/workers-types';

/**
 * Migration statements representing all migrations applied in sequence.
 * Used for in-memory and local test harnesses.
 */
const BASELINE_MIGRATION = [
  `CREATE TABLE IF NOT EXISTS \`trees\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`name\` text NOT NULL,
    \`description\` text,
    \`version\` integer DEFAULT 1 NOT NULL,
    \`created_at\` integer,
    \`updated_at\` integer
  );`,
  `CREATE TABLE IF NOT EXISTS \`users\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`access_sub\` text NOT NULL,
    \`email\` text NOT NULL,
    \`name\` text,
    \`created_at\` integer,
    \`updated_at\` integer
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`users_access_sub_unique\` ON \`users\` (\`access_sub\`);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_users_access_sub\` ON \`users\` (\`access_sub\`);`,
  `CREATE INDEX IF NOT EXISTS \`idx_users_email\` ON \`users\` (\`email\`);`,
  `CREATE TABLE IF NOT EXISTS \`tree_memberships\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`tree_id\` text NOT NULL,
    \`user_id\` text NOT NULL,
    \`role\` text DEFAULT 'viewer' NOT NULL,
    \`created_at\` integer,
    \`updated_at\` integer,
    FOREIGN KEY (\`tree_id\`) REFERENCES \`trees\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_tree_user\` ON \`tree_memberships\` (\`tree_id\`,\`user_id\`);`,
  `CREATE INDEX IF NOT EXISTS \`idx_membership_user\` ON \`tree_memberships\` (\`user_id\`);`,
  `CREATE TABLE IF NOT EXISTS \`individuals\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`tree_id\` text NOT NULL,
    \`xref_id\` text,
    \`given_name\` text,
    \`surname\` text,
    \`sex\` text DEFAULT 'U',
    \`version\` integer DEFAULT 1 NOT NULL,
    \`created_at\` integer,
    \`updated_at\` integer,
    FOREIGN KEY (\`tree_id\`) REFERENCES \`trees\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`,
  `CREATE INDEX IF NOT EXISTS \`idx_ind_tree\` ON \`individuals\` (\`tree_id\`);`,
  `CREATE INDEX IF NOT EXISTS \`idx_ind_xref\` ON \`individuals\` (\`tree_id\`, \`xref_id\`);`,
  `CREATE TABLE IF NOT EXISTS \`families\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`tree_id\` text NOT NULL,
    \`xref_id\` text,
    \`husband_id\` text,
    \`wife_id\` text,
    \`version\` integer DEFAULT 1 NOT NULL,
    \`created_at\` integer,
    \`updated_at\` integer,
    FOREIGN KEY (\`tree_id\`) REFERENCES \`trees\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`husband_id\`) REFERENCES \`individuals\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`wife_id\`) REFERENCES \`individuals\`(\`id\`) ON UPDATE no action ON DELETE set null
  );`,
  `CREATE INDEX IF NOT EXISTS \`idx_fam_tree\` ON \`families\` (\`tree_id\`);`,
  `CREATE INDEX IF NOT EXISTS \`idx_fam_husband\` ON \`families\` (\`husband_id\`);`,
  `CREATE INDEX IF NOT EXISTS \`idx_fam_wife\` ON \`families\` (\`wife_id\`);`,
  `CREATE TABLE IF NOT EXISTS \`family_children\` (
    \`family_id\` text NOT NULL,
    \`child_id\` text NOT NULL,
    \`pedigree\` text DEFAULT 'birth',
    FOREIGN KEY (\`family_id\`) REFERENCES \`families\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`child_id\`) REFERENCES \`individuals\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`,
  `CREATE INDEX IF NOT EXISTS \`idx_fam_child\` ON \`family_children\` (\`family_id\`,\`child_id\`);`,
  `CREATE INDEX IF NOT EXISTS \`idx_child\` ON \`family_children\` (\`child_id\`);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_uq_fam_child\` ON \`family_children\` (\`family_id\`, \`child_id\`);`,
  `CREATE TABLE IF NOT EXISTS \`events\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`tree_id\` text NOT NULL,
    \`entity_type\` text NOT NULL,
    \`entity_id\` text NOT NULL,
    \`type\` text NOT NULL,
    \`date_raw\` text,
    \`date_sort\` text,
    \`place\` text,
    \`description\` text,
    \`version\` integer DEFAULT 1 NOT NULL,
    \`created_at\` integer,
    \`updated_at\` integer,
    FOREIGN KEY (\`tree_id\`) REFERENCES \`trees\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`,
  `CREATE INDEX IF NOT EXISTS \`idx_event_entity\` ON \`events\` (\`entity_type\`,\`entity_id\`);`,
  `CREATE INDEX IF NOT EXISTS \`idx_event_tree\` ON \`events\` (\`tree_id\`);`,
  `CREATE TABLE IF NOT EXISTS \`media_items\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`tree_id\` text NOT NULL,
    \`entity_id\` text NOT NULL,
    \`r2_object_key\` text NOT NULL,
    \`cf_image_id\` text,
    \`title\` text,
    \`mime_type\` text NOT NULL,
    \`created_at\` integer,
    FOREIGN KEY (\`tree_id\`) REFERENCES \`trees\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`,
  `CREATE INDEX IF NOT EXISTS \`idx_media_entity\` ON \`media_items\` (\`entity_id\`);`,
  `CREATE INDEX IF NOT EXISTS \`idx_media_tree\` ON \`media_items\` (\`tree_id\`);`,
  `CREATE TABLE IF NOT EXISTS \`unions\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`tree_id\` text NOT NULL,
    \`status\` text DEFAULT 'active' NOT NULL,
    \`version\` integer DEFAULT 1 NOT NULL,
    \`created_at\` integer,
    \`updated_at\` integer,
    FOREIGN KEY (\`tree_id\`) REFERENCES \`trees\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`,
  `CREATE INDEX IF NOT EXISTS \`idx_union_tree\` ON \`unions\` (\`tree_id\`);`,
  `CREATE TABLE IF NOT EXISTS \`union_partners\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`union_id\` text NOT NULL,
    \`person_id\` text NOT NULL,
    \`order\` integer DEFAULT 0 NOT NULL,
    \`created_at\` integer,
    FOREIGN KEY (\`union_id\`) REFERENCES \`unions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`person_id\`) REFERENCES \`individuals\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`,
  `CREATE INDEX IF NOT EXISTS \`idx_union_partner_union\` ON \`union_partners\` (\`union_id\`);`,
  `CREATE INDEX IF NOT EXISTS \`idx_union_partner_person\` ON \`union_partners\` (\`person_id\`);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_uq_union_person\` ON \`union_partners\` (\`union_id\`,\`person_id\`);`,
  `CREATE TABLE IF NOT EXISTS \`parent_child\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`tree_id\` text NOT NULL,
    \`parent_id\` text NOT NULL,
    \`child_id\` text NOT NULL,
    \`type\` text DEFAULT 'unknown' NOT NULL,
    \`status\` text DEFAULT 'active' NOT NULL,
    \`union_id\` text,
    \`version\` integer DEFAULT 1 NOT NULL,
    \`created_at\` integer,
    \`updated_at\` integer,
    FOREIGN KEY (\`tree_id\`) REFERENCES \`trees\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`individuals\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`child_id\`) REFERENCES \`individuals\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`union_id\`) REFERENCES \`unions\`(\`id\`) ON UPDATE no action ON DELETE set null
  );`,
  `CREATE INDEX IF NOT EXISTS \`idx_parent_child_tree\` ON \`parent_child\` (\`tree_id\`);`,
  `CREATE INDEX IF NOT EXISTS \`idx_parent_child_parent\` ON \`parent_child\` (\`parent_id\`);`,
  `CREATE INDEX IF NOT EXISTS \`idx_parent_child_child\` ON \`parent_child\` (\`child_id\`);`,
  `CREATE INDEX IF NOT EXISTS \`idx_parent_child_union\` ON \`parent_child\` (\`union_id\`);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`idx_uq_parent_child_type\` ON \`parent_child\` (\`parent_id\`,\`child_id\`,\`type\`);`,
  `CREATE TABLE IF NOT EXISTS \`person_names\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`person_id\` text NOT NULL,
    \`type\` text DEFAULT 'birth' NOT NULL,
    \`given_name\` text,
    \`surname\` text,
    \`name_prefix\` text,
    \`name_suffix\` text,
    \`is_preferred\` integer DEFAULT false NOT NULL,
    \`order\` integer DEFAULT 0 NOT NULL,
    \`created_at\` integer,
    \`updated_at\` integer,
    FOREIGN KEY (\`person_id\`) REFERENCES \`individuals\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`,
  `CREATE INDEX IF NOT EXISTS \`idx_person_name_person\` ON \`person_names\` (\`person_id\`);`,
  `CREATE TABLE IF NOT EXISTS \`gedcom_preserved\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`tree_id\` text NOT NULL,
    \`owner_xref\` text,
    \`lines\` text NOT NULL,
    \`order\` integer DEFAULT 0 NOT NULL,
    \`created_at\` integer,
    FOREIGN KEY (\`tree_id\`) REFERENCES \`trees\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`,
  `CREATE INDEX IF NOT EXISTS \`idx_preserved_tree\` ON \`gedcom_preserved\` (\`tree_id\`);`,
  `CREATE INDEX IF NOT EXISTS \`idx_preserved_owner\` ON \`gedcom_preserved\` (\`tree_id\`, \`owner_xref\`);`
];

let initPromise: Promise<void> | null = null;

export async function ensureDbSchema(d1: D1Database): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const batch = BASELINE_MIGRATION.map((sql) => d1.prepare(sql));
      await d1.batch(batch);
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}
