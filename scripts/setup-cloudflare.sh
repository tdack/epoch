#!/usr/bin/env bash
set -euo pipefail

echo "======================================================="
echo "  Family Genealogy Repository - Initial Provisioning    "
echo "======================================================="

# 1. Prompt for User Inputs
read -p "Enter project name [epoch-genealogy]: " APP_NAME
APP_NAME=${APP_NAME:-epoch-genealogy}

read -p "Enter Cloudflare Account ID: " CF_ACCOUNT_ID
if [ -z "$CF_ACCOUNT_ID" ]; then
    echo "Error: Account ID is required."
    exit 1
fi

echo "Select Environment: [1] Development  [2] Production"
read -p "Choice (1/2): " ENV_CHOICE
if [ "$ENV_CHOICE" == "2" ]; then
    ENV_NAME="production"
else
    ENV_NAME="development"
fi

DB_NAME="${APP_NAME}-${ENV_NAME}-db"
BUCKET_NAME="${APP_NAME}-${ENV_NAME}-media"
QUEUE_NAME="${APP_NAME}-${ENV_NAME}-import-queue"
WORKFLOW_NAME="${APP_NAME}-${ENV_NAME}-export-workflow"

echo "-------------------------------------------------------"
echo "Provisioning Cloudflare resources for ${APP_NAME} (${ENV_NAME})..."
echo "-------------------------------------------------------"

# 2. Authenticate & Create Resources via Wrangler CLI
echo "Creating D1 Database..."
D1_OUTPUT=$(npx wrangler d1 create "$DB_NAME" --json)
DB_ID=$(echo "$D1_OUTPUT" | grep -o '"database_id": "[^"]*' | cut -d'"' -f4)

echo "Creating R2 Storage Bucket..."
npx wrangler r2 bucket create "$BUCKET_NAME" || true

echo "Creating Queue..."
npx wrangler queues create "$QUEUE_NAME" || true

# 3. Inject bindings into wrangler.jsonc
cat <<EOF > wrangler.jsonc
{
  "\$schema": "node_modules/wrangler/config-schema.json",
  "name": "${APP_NAME}",
  "compatibility_date": "2026-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "main": ".svelte-kit/cloudflare/_worker.js",
  "assets": {
    "directory": ".svelte-kit/cloudflare",
    "binding": "ASSETS"
  },
  "account_id": "${CF_ACCOUNT_ID}",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "${DB_NAME}",
      "database_id": "${DB_ID}"
    }
  ],
  "r2_buckets": [
    {
      "binding": "MEDIA_BUCKET",
      "bucket_name": "${BUCKET_NAME}"
    }
  ],
  "queues": {
    "producers": [
      {
        "binding": "GEDCOM_IMPORT_QUEUE",
        "queue": "${QUEUE_NAME}"
      }
    ],
    "consumers": [
      {
        "queue": "${QUEUE_NAME}",
        "max_batch_size": 10,
        "max_batch_timeout": 30
      }
    ]
  },
  "workflows": [
    {
      "name": "${WORKFLOW_NAME}",
      "binding": "GEDCOM_EXPORT_WORKFLOW",
      "class_name": "GedcomExportWorkflow"
    }
  ]
}
EOF

# 4. Create App Types (app.d.ts)
cat <<EOF > src/app.d.ts
declare global {
    namespace App {
        interface Platform {
            env: {
                DB: D1Database;
                MEDIA_BUCKET: R2Bucket;
                GEDCOM_IMPORT_QUEUE: Queue<any>;
                GEDCOM_EXPORT_WORKFLOW: Workflow;
                CF_IMAGES_TOKEN?: string;
                CF_ACCOUNT_ID?: string;
            };
            context: ExecutionContext;
            caches: CacheStorage;
        }
    }
}

export {};
EOF

# 5. Execute DB Migrations & Initial Deploy
echo "Applying database migrations..."
npx drizzle-kit generate
MIGRATION_FILE=$(ls -t ./drizzle/*.sql | head -n 1)
npx wrangler d1 execute "$DB_NAME" --remote --file="$MIGRATION_FILE"

echo "Deploying initial build to Cloudflare..."
npm run build
npx wrangler deploy workers/entry.ts

echo "======================================================="
echo " Setup complete! Project successfully deployed.        "
echo "======================================================="
