import type { D1Database } from '@cloudflare/workers-types';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`trees\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`name\` text NOT NULL,
    \`description\` text,
    \`created_at\` integer,
    \`updated_at\` integer
  );`,
  `CREATE TABLE IF NOT EXISTS \`individuals\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`tree_id\` text NOT NULL,
    \`given_name\` text,
    \`surname\` text,
    \`sex\` text DEFAULT 'U',
    \`created_at\` integer,
    FOREIGN KEY (\`tree_id\`) REFERENCES \`trees\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`,
  `CREATE INDEX IF NOT EXISTS \`idx_ind_tree\` ON \`individuals\` (\`tree_id\`);`,
  `CREATE TABLE IF NOT EXISTS \`families\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`tree_id\` text NOT NULL,
    \`husband_id\` text,
    \`wife_id\` text,
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
  // Migration: remove pre-existing duplicate junction rows, then enforce uniqueness
  `DELETE FROM \`family_children\` WHERE rowid NOT IN (SELECT MIN(rowid) FROM \`family_children\` GROUP BY \`family_id\`, \`child_id\`);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`uq_family_child\` ON \`family_children\` (\`family_id\`, \`child_id\`);`,
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
  `CREATE INDEX IF NOT EXISTS \`idx_media_tree\` ON \`media_items\` (\`tree_id\`);`
];

let initPromise: Promise<void> | null = null;

export async function ensureDbSchema(d1: D1Database): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const batch = SCHEMA_STATEMENTS.map((sql) => d1.prepare(sql));
      await d1.batch(batch);
    })().catch((err) => {
      // Allow retry if initialization failed
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}
