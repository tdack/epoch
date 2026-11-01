# GEDCOM 7 alignment and GEDZIP media: phased plan

Drafted 2026-10-31. This plan delivers two backlog items: "GEDZIP import and export with media"
(ADR-074, draft) and "Media records" (`OBJE`). It also closes the 7.0 gaps that ADR-036 left open on
purpose. Work is done by subagents. An orchestrator (Opus, in the main session) runs them, reviews
what they return and merges it. When an item lands, record it in `backlog.md`, the ADRs and
`architecture.md`. This file only says how the work is ordered.

## Where things stand

- **Already in 7.0:** export is 7.0 by default, made valid line by line (`toGedcom7Lines`). It
  handles dates and `PHRASE`, `SNOTE`, `MIME` and `LANG` on notes, `FORM`/`MEDI`, and a `SCHMA` for
  Epoch's own tags. Import detects the version and character set. A `.gdz` is read and written,
  but only for its `gedcom.ged` (ADR-036).
- **7.0 gaps that are known and not fixed** (ADR-036, backlog "GEDCOM"):
  - An embedded 5.5.1 `OBJE` is written as it came, with no pointer record.
  - Non-standard tags with no underscore, such as `URL` and `CEME`, are written as they came.
  - An empty `FORM` stays empty.
  - `RELA` values that 7.0 has a word for still go to `ROLE OTHER`.
  - `FONE` and `ROMN` are not converted to `TRAN`.
  - The parser and serializer never mention `EXID`, `UID`, `NO`, `SDATE`, `CROP`, `INIL` or the
    record-level `CREA` and `CHAN`. They may survive as kept lines, but nothing tests that.
- **Media:** `media_items` holds one row per file, and `media_links` is many-to-many to a person,
  union or source. An import creates no file, and an export writes no `OBJE` for files the tree
  holds. Uploads are multipart forms buffered in the isolate (`MAX_MEDIA_UPLOAD_BYTES` and
  `MAX_IMPORT_BYTES` are both 25 MB). The tree cap is `MAX_TREE_MEDIA_BYTES`, 2 GiB.
- **Large imports** go through `GEDCOM_IMPORT_QUEUE` and leave no job record. Export already runs
  as a Workflow (ADR-040).

## Upload transport: chunked through the Worker, with pre-signed URLs as an option

A `.gdz` holding a tree's photos easily passes the Worker's request-body limit. That limit is
100 MB on Free and Pro, 200 MB on Business and 500 MB on Enterprise. Three ways around it:

| | Pre-signed R2 URLs (S3 API) | Chunked R2 multipart through the Worker | One raw stream (ADR-074 as drafted) |
| --- | --- | --- | --- |
| Body limit | Avoided: the browser PUTs to R2 directly | Avoided: each part is under 100 MB | **Still applies.** A raw body is still a request |
| Auth | The URL is a bearer token and skips Cloudflare Access. Keep the expiry short and choose the key on the server | Every part passes Access and `requireUpload` | Access |
| Secrets and config | An R2 S3 API token in Worker secrets, signing with `aws4fetch`, and a CORS rule on the bucket that exposes `ETag` | None. Uses the `MEDIA_BUCKET` binding | None |
| Local dev and tests | **Miniflare's R2 has no S3 endpoint,** so a real bucket is needed | Works under `getPlatformProxy` and `wrangler dev` | Works |
| Resume | Retry a part | Retry a part | Start again |
| Worker cost | None per byte | Streams each part with almost no CPU | Same |

**Recommendation:** build one upload-session API whose parts are given as URLs, and serve them from
the Worker first.

- The client calls `POST /api/uploads`, then for each part `PUT <part.url>`, then
  `POST /api/uploads/:id/complete`. It never needs to know who serves a part.
- Version 1 points `part.url` at `PUT /api/uploads/:id/parts/:n`. That route streams
  `request.body` straight into `multipartUpload.uploadPart(n, …)`, so no new secrets are needed,
  tests run locally, and Access stays in front of every byte.
- If upload speed or Worker bandwidth ever matters, `part.url` can become a pre-signed R2
  `UploadPart` URL with no change to the client. That option is task 5.5.
- R2 multipart wants every part except the last to be the same size, at least 5 MiB, with at most
  10,000 parts. A fixed `UPLOAD_PART_BYTES` of 50 MiB keeps each request well under 100 MB and
  allows archives far past 2 GiB.

The same session API replaces the 25 MB form for single media uploads too. A large scan or video
no longer needs its own path.

**Downloads need none of this.** Response bodies have no size cap. The export download keeps
streaming its segment objects through the Worker, behind Access, as ADR-040 does.

## How the subagents run

- **Models.** **Sonnet** takes anything with design judgement, byte-level formats, Workflows,
  concurrency, privacy, or changes across several layers. **Haiku** takes mechanical work with a
  precise spec: migrations, constant and mapping tables, fixtures, doc updates, and tests that
  follow a pattern the brief names. Each task's brief names its files, the ADR sections to read
  first, and what done means (tests to add, and `npm run lint` and `npm test` passing).
- **Isolation.** Every writing agent runs with `isolation: "worktree"`. Agents that run at the same
  time never share files; the task tables below give each one's files. Where two tracks would both
  touch `parser.ts`, `serializer.ts` or `gedzip.ts`, the plan either orders them or splits the
  module first.
- **Review gate.** After each task the orchestrator reads the diff and runs `/code-review` on
  anything Sonnet built that touches a format, auth or quotas. It then merges into the plan branch
  in small Conventional Commits. A phase ends only when lint, the unit tests and the Phase 0
  conformance suite all pass on the merged branch.
- **Migrations are expand-only** and ship in their own commit, before any code reads them (CLAUDE.md).

## Phase map

```
Phase 0  Spec baseline + conformance harness ─────────┐
                                                      ├─► Phase 2  Media records (OBJE) ─┬─► Phase 3  .gdz import with media
Phase 1A GEDCOM 7 dataset alignment ──────────────────┘                                  │
Phase 1B Import Workflow + upload sessions ──────────────────────────────────────────────┤
                                                                                         └─► Phase 4  .gdz export with media
                                                                       Phase 5  Hardening, e2e, docs (after 3 and 4)
```

Phases 0 and 1B start together. 1A starts once Phase 0's validator exists. Phases 3 and 4 run in
parallel because the zip reader and the zip writer are separate modules.

---

## Phase 0: Spec baseline and conformance harness

The aim is a machine check of "valid 7.0", so that every later phase is measured against it rather
than against what someone remembers of the spec.

| # | Task | Model | Files | Done when |
| --- | --- | --- | --- | --- |
| 0.1 | Pin a GEDCOM 7.0.x release from FamilySearch's GEDCOM repository and generate a typed table from its `extracted-files`: substructures and their cardinality, enumeration sets, payload types and tag URIs. Record the release in a header comment, and add `npm run gedcom:spec` to regenerate it. | Sonnet | `scripts/gedcom-spec/*`, `src/lib/server/gedcom/spec/*.ts` (generated) | The table is typed and regenerates with no diff |
| 0.2 | `validateGedcom7(text)` → `{ errors, warnings }`. It checks the tag in its context, cardinality, enumeration values, payload type (date, age, language, media type, pointer), that pointers resolve or are `@VOID@`, the xref format, the `@@` rule, that extension tags start with `_`, and that `SCHMA` covers the documented ones. | Sonnet | `src/lib/server/gedcom/validate7.ts` + test | Passes on the spec's own example files |
| 0.3 | Conformance corpus: fetch the official 7.0 test files (`minimal70`, `maximal70`, `maximal70.gdz`, `remarriage`, `same-sex-marriage`, `voidptr`, `escapes`, `age`, `lang`, the `filename-*.gdz` files and others), check their licence, and add a README naming where each came from. Add an anonymised webtrees 5.5.1 sample. | Haiku | `src/lib/server/gedcom/fixtures/conformance/*` | Fixtures committed with their source and licence |
| 0.4 | Round-trip suite: for each fixture, import, export as 7.0, validate, and run a semantic diff (records, facts, dates, pointers, kept lines) against the original. Known, documented losses go on an allowlist. This is the backlog's "Conformance corpus and a semantic diff report". | Sonnet | `src/lib/server/gedcom/conformance.test.ts`, `semantic-diff.ts` | The suite runs. Failures are expected now, and each one is listed |
| 0.5 | Gap report: run 0.4, group the failures by tag and cause, and turn them into Phase 1A's checklist. | Haiku | scratch file, then `backlog.md` | The checklist exists |
| 0.6 | Spike: measure the subrequest limit per Workflow step and per `fetch` invocation on the current plan (ADR-074's open question), and how fast R2 range reads and `DecompressionStream('deflate-raw')` run on a 50 MB entry. This decides the media batch size. | Sonnet | spike only, results into ADR-074 | Numbers recorded |

## Phase 1A: GEDCOM 7 dataset alignment

This phase runs from 0.5's checklist. The work splits along file lines, so up to three agents can
run at once.

| # | Task | Model | Files |
| --- | --- | --- | --- |
| 1A.1 | **Rewrite kept lines in `dialect.ts`.**<br>- `ASSO.RELA` → the 7.0 `ROLE` enumeration where one fits (`FATH`, `MOTH`, `GODP`, `WITN`, `CLERGY`, `FRIEND`, `NGHBR`, `OFFICIATOR`, `PARENT`, `SPOU`, `CHIL`, `NANNY`, `MULTIPLE`), keeping `OTHER` + `PHRASE` for the rest.<br>- A non-standard tag with no underscore: `URL` → `WWW`, and anything else gets an underscore prefix (`CEME` → `_CEME`). A prefixed tag that has a URI in the gedcom.io extension registry gets that URI in `SCHMA`.<br>- An empty `FORM` is inferred from the file's extension, or dropped.<br>- Import reads all of these back, so a 7.0 → 7.0 trip loses nothing. | Sonnet | `dialect.ts`, `tags.ts` + tests |
| 1A.2 | **`FONE` and `ROMN` → `TRAN` under `PLAC` and `NAME`.** Decide the `LANG` mapping (ROMN → `und-Latn`, for example). A `TYPE` with no faithful mapping becomes a documented `_FONE` or `_ROMN`. Reverse it on a 5.5.1 export. | Sonnet | `dialect.ts` (after 1A.1), `gedcom-extensions.md` |
| 1A.3 | **Header and submitter.**<br>- `HEAD` gets `GEDC.VERS 7.0`, `SOUR` with `VERS`/`NAME`, `DATE`/`TIME`, `LANG` (the tree's language) and `PLAC.FORM`.<br>- **A submitter set per tree.** A migration (expand) adds nullable `trees.submitter_name`, `submitter_email` and `submitter_www`, edited on the Tree settings page (ADR-075) by a manager or above.<br>- **Export:** 7.0 writes a `SUBM` record and `HEAD.SUBM` only when a name is set. 5.5.1 always writes one, as `Unknown` when unset, because 5.5.1 requires it.<br>- **Import:** the record `HEAD.SUBM` points to fills the setting, but only if the setting is empty, and it is then no longer kept as a root record. Other `SUBM` records stay kept, as today.<br>- `COPR` is left out unless set. | Sonnet | migration, `trees` schema and repository, Tree settings page, `serializer.ts` (header block), parser header handling + tests |
| 1A.4 | **Identifiers and record metadata.**<br>- `EXID`+`TYPE`, `UID` and `REFN` round-trip on every record kind; test them as kept lines and model only what the UI needs.<br>- Write `CHAN.DATE` (and `CREA.DATE` where the row has `created_at`) from each record's timestamps.<br>- Read an imported `CHAN` into kept lines, never into Epoch's own timestamps. | Sonnet | `export-payload.ts`, `gedcom-neutral-writer.ts`, parser record handlers |
| 1A.5 | **Fact structures.** `NO` (non-events, with `DATE`/`NOTE`/`SOUR`), `SDATE`, `TIME` under `DATE`, 7.0 `AGE` syntax (`> 10y 3m`), `HUSB`/`WIFE` `PHRASE`, `ASSO @VOID@` + `PHRASE`, `FAMC.STAT`, `ALIA`, and the LDS ordinances (`BAPL`, `CONL`, `ENDL`, `INIL`, `SLGC`, `SLGS` with `TEMP`/`STAT`). Each gets a round-trip test. Model a structure only where the UI already shows that kind of thing; otherwise keep it with a test. | Sonnet | `fact-details*.ts`, `parser.ts` fact paths |
| 1A.6 | **Pointers and escapes.** `@VOID@` is accepted wherever 7.0 allows it; xrefs written as `[A-Z0-9_]`; `@@` only at the start of a line (ADR-042). Tests built from the conformance `voidptr` and `escapes` files. | Haiku | `serializer.ts` (pointer and escape helpers), tests |
| 1A.7 | **The 5.5.1 `CONC` wrap at 255** (backlog). It is cheap once 1A.6 settles line building. Optional. | Haiku | `serializer.ts` |

1A.3, 1A.6 and 1A.7 all touch `serializer.ts`, so they run one after another. 1A.1 and 1A.2 share
`dialect.ts` and are also ordered. 1A.4 and 1A.5 run beside them.

**First findings (validator, 2026-10-31).** These came from running Epoch's 7.0 export of its own
fixtures and of the official files through `validateGedcom7`. The 0.4 round-trip suite will make
them repeatable.

- **Import fails outright** with `FOREIGN KEY constraint failed` on all five `maximal70*.ged`
  variants and on `voidptr.ged`. The likely cause is `@VOID@` or a pointer to a record kind Epoch
  does not model. This is the first 1A task, ahead of 1A.1.
- **Xrefs:** the exporter writes UUID xrefs (`@52d1e0bc-…@`), but 7.0 allows only `[A-Z0-9_]`.
  Map ids to short xrefs at export (1A.6).
- **Notes:** a 5.5.1 shared note (`0 @N1@ NOTE`, and `NOTE @N1@` pointers to it) is written as it
  came. It should become `SNOTE` (1A.1).
- **Sources:** an inline `SOUR` with text instead of a pointer, and `SOUR` under `INDI.FAMC`, which
  7.0 does not allow there (1A.1).
- **Media:** an embedded `OBJE.FILE` with no `FORM`. This one belongs to the empty-`FORM` rule
  (1A.1) and to Phase 2.
- **Pointers:** a pointer to a missing record (`@MISSING@`) is written as it came. Write `@VOID@`
  instead (1A.6).

**Gap report (round-trip suite, 2026-10-31).** `conformance.test.ts` lists every known gap in
`KNOWN_GAPS`, with the task that closes it. Five official files already round-trip with an empty
diff: `minimal70`, `notes-1`, `filename-1`, `long-url` and `same-sex-marriage`. The causes below
are the ones the list above does not already name.

**Status (1A.5 and the round-trip gaps).** `KNOWN_GAPS` is now empty: every official file
round-trips with an empty diff and no validator error. Fixed, one commit each: no invented `NAME`
or `SEX`; a `NAME` line (and an absent `TYPE`) written as the file gave it, kept as marker lines in
`gedcom_extra` (`name-value.ts`, ADR-013); a family event's payload (`Y`) as its `value`; `RESN` as
one list line in 7.0; an `AGE` with only a `PHRASE`; `PHRASE` and other sub-lines under
`HUSB`/`WIFE`/`CHIL`; repeated retained lines (five `SLGS`) no longer collapsed on import; retained
lines of a record with no XREF; extension-calendar dates written as the file gave them; and
`HEAD.SUBM` pointed at the kept submitter record. `NO`, `SDATE`, `TIME`, 7.0 `AGE` syntax, `ALIA`
and `FAMC.STAT` already held and now have tests (`roundtrip-snippets.test.ts`). The partner role
is kept too: migration 0056 adds `union_partners.gedcom_role`, so a `WIFE`-only family, two `HUSB`
lines and a `WIFE` written first all export as the file gave them; with no stored role, export falls
back to `SEX`, then to whichever role is free.

**Status (1A.4).** Done. `EXID`, `UID` and `REFN` already round-tripped as kept lines on every
record kind and now have tests (`record-metadata.test.ts`). `CHAN` (and `CREA` in 7.0) is written
from each row's own timestamps; an imported stamp is kept only where Epoch has no timestamp of its
own (`OBJE`, `SUBM`). Exports now differ between runs, so tests that compare two exports strip the
stamps first (`withoutStamps`).

- **Import crash on `date.ged`:** the D1 write fails with `fetch failed` (`ECONNRESET`), not a
  foreign-key error. The file has many repeated events, so the batch may be too large; the existing
  Windsors tests fail the same way on one machine, so this may be the local D1 and not Epoch. Check
  it with the FK failures (1A.0).
- **Invented values:** the export writes `NAME //` and `SEX U` for a person the file leaves
  without them (`age`, `escapes`, `extension-record`, `obje-1`, `remarriage1`, `remarriage2`,
  `warnings70`, `xref`). It should write nothing (1A.5).
- **Dropped header lines:** `HEAD.LANG` and `HEAD.SCHMA` are lost (`lang`, `extensions`). `SCHMA`
  belongs to 1A.1 and `LANG` to 1A.3.
- **`AGE` with only a `PHRASE`** (`age`) is dropped (1A.5).
- **`FAMC @VOID@` with `PEDI`** under a person (`extensions`) is dropped (1A.6).
- **Person-level structures lost:** `ASSO` with an extension `ROLE`, `SUBM` and an extension
  pointer structure (`_PARTY`) under a person (`extensions`). `ASSO` is 1A.5; the others are kept
  lines (1A.1).
- **Dates with an extension calendar** (`extensions`) are written as an empty `DATE` with a
  `PHRASE`. The date text should stay in the `DATE` (1A.5).
- **A record with no xref** (`0 INDI`, in `xref` and `extensions`) gets a UUID xref, which
  the validator rejects. The short-xref rule in 1A.6 covers it.

**Exit:** every conformance fixture exports with no validator errors. The round-trip diff is empty
apart from the allowlist, and every allowlisted item is written in ADR-036's "known losses".

## Phase 1B: Import Workflow and upload sessions

This phase touches different files from 1A (routes, workflows, the queue and a new `uploads`
module), so it runs in parallel with 1A.

| # | Task | Model | Files |
| --- | --- | --- | --- |
| 1B.1 | Migration (expand): add `import_job` as ADR-074 Phase 1 describes it. | Haiku | `drizzle/00xx_import_job.sql`, `schema/` |
| 1B.2 | **`GedcomImportWorkflow`** replaces the queue consumer for imports over 2 MB.<br>- The route writes the job and stages the text, then returns `202 { jobId }`.<br>- `GET /api/import/:jobId` returns the job's status.<br>- The import screen polls it.<br>- The queue stays bound until it has drained (expand-and-contract). | Sonnet | `workflows/import-workflow.ts`, `routes/api/import/**`, `workers/entry.ts`, `wrangler.jsonc` (add the Workflow, keep the queue) |
| 1B.3 | Migration (expand): add `upload_session` with these columns: `id`, `tree_id`, `purpose` (`gedzip_import` or `media`), `r2_key`, `r2_upload_id`, `part_size_bytes`, `total_bytes`, `parts_json` (part number → etag), `status`, `created_by`, `created_at`, `expires_at`. | Haiku | migration, schema |
| 1B.4 | **The upload-session service and routes.**<br>- `POST /api/uploads` checks the role, the per-user rate limit (ADR-066), the declared size against a per-purpose cap and the tree's media quota, then calls `createMultipartUpload` and returns the part URLs.<br>- `PUT …/parts/:n` checks `Content-Length` against the part size (only the last part may be shorter), then streams the body to `uploadPart` and saves the etag.<br>- `POST …/complete` and `DELETE …` (abort).<br>- Every key sits under `staging/uploads/<treeId>/`. | Sonnet | `server/services/upload-service.ts`, `repositories/upload-repository.ts`, `routes/api/uploads/**` |
| 1B.5 | **The client uploader.**<br>- It slices a `File` into `UPLOAD_PART_BYTES` parts and sends 3 at a time.<br>- It retries a part with backoff, shows progress, and can be cancelled.<br>- It can resume a session after a reload while that session is still live.<br>- It is one shared module, used by both the import screen and the Files page. | Sonnet | `src/lib/client/uploader.ts`, import and Files components |
| 1B.6 | **Cleanup.** Add an R2 lifecycle rule that aborts incomplete multipart uploads after 1 day, plus a scheduled sweep that aborts expired `upload_session` rows. Document both in development.md. | Haiku | `wrangler.jsonc` (cron), sweep job, docs |
| 1B.7 | **Single media uploads move onto sessions.** The form route stays for small files until the client no longer calls it, then it is removed. | Haiku | `routes/api/media/upload`, Files upload dialog |
| 1B.8 | Retire `GEDCOM_IMPORT_QUEUE`: remove the producer, the consumer and `import-consumer.ts`. This is its own deploy, after the queue has drained. | Haiku | `wrangler.jsonc`, `workers/entry.ts` |

**Exit:** a 300 MB test file uploads in parts locally and on staging, an import job reports
`complete` or `failed`, and an abandoned session is cleaned up.

## Phase 2: Media records (`OBJE`)

ADR-074 imports media detached first and models `OBJE` later. This plan models `OBJE` **before**
`.gdz` media import. Otherwise a real archive lands as hundreds of unowned files that someone has to
attach by hand, and the Phase 4 export has nothing to point its `OBJE` records at. The tables
already lean this way, since `media_links` is many-to-many. Phase 2 waits for 1A because both
change `parser.ts` and `serializer.ts`.

| # | Task | Model | Files |
| --- | --- | --- | --- |
| 2.1 | **New ADR (082): media records.**<br>- **Choose between two shapes:** a `media_object` record (xref, `RESN`, notes, citations, `EXID`/`UID`) with `media_items` as its files (7.0 allows several `FILE`s per `OBJE`), or one `OBJE` per `media_items` row with the extra `FILE`s kept. Recommend the record table.<br>- **Link details:** `media_links` gains `fact_id` (fact-level `OBJE`), `sort_order`, `crop` (`TOP`/`LEFT`/`HEIGHT`/`WIDTH`) and a `title` override.<br>- **Files Epoch does not hold:** a `FILE` that names an external URL or a missing local path gets a row with `status = 'unresolved'`, kept so the export writes it back.<br>- **Privacy:** a fact-level link follows its fact's owner (ADR-050 rule).<br>- **Settle ADR-074 Phase 4.** | Sonnet (orchestrator reviews) | `docs/adr/ADR-082.md` |
| 2.2 | Migrations (expand) from 2.1. These include `media_items.gedcom_path`, `media_items.status`, `media_items.sha256` and `crc32` (filled at upload, and they serve the backlog's "Checksums" item), and the new `media_links` columns. Allow `r2_object_key` to be null, or keep a placeholder for unresolved files. | Haiku | migrations, schema |
| 2.3 | **Import `OBJE`.** Records, embedded 5.5.1 `OBJE` and pointers under `INDI`, `FAM`, `SOUR`, facts and citations become media rows and links, through the mutation runner and import batch, with no bytes yet. A `FILE` resolves by `gedcom_path` against archive entries when Phase 3 supplies them; otherwise the row is unresolved. | Sonnet | `parser.ts` OBJE paths, `gedcom-neutral-writer.ts`, `media-repository.ts` |
| 2.4 | **Export `OBJE`.** 7.0 writes `OBJE` records (`FILE`, `FORM`, `MEDI`, `TITL`, `TRAN`) with pointers carrying `CROP`/`TITL`. In a `.gdz`, `FILE` is a relative, percent-encoded archive path; for a plain `.ged` it is the original path or URL. 5.5.1 writes its own `OBJE` form. Privacy-filtered as ADR-050 says. | Sonnet | `export-payload.ts`, `serializer.ts` |
| 2.5 | UI kept to a minimum: show an imported file, resolved or not, wherever linked files already show, and let the user set a link's sort order and title. Galleries stay in the backlog. | Sonnet | person, source and Files components |
| 2.6 | Compute `sha256` and `crc32` while an upload streams, so files are not read twice, and add a backfill for existing rows. | Haiku | upload-service, a backfill script |

**Exit:** `maximal70.ged`'s `OBJE` structures round-trip through the conformance suite as records
and links, with every file unresolved for now.

## Phase 3: `.gdz` import with media

| # | Task | Model | Files |
| --- | --- | --- | --- |
| 3.1 | **`zip-reader.ts`, which reads a zip stored in R2 by range.**<br>- It finds the EOCD (and the Zip64 EOCD, which it reads but caps), then the central directory, then each local header's offset.<br>- It streams one entry: R2 range → `DecompressionStream('deflate-raw')` (or stored) → a CRC32 check → `FixedLengthStream` sized from the central directory.<br>- It refuses encrypted entries, unknown methods, mismatched sizes, and any entry that expands more than a set ratio.<br>- `unpackGedzip` stays the code that reads the dataset. | Sonnet | `src/lib/server/gedcom/zip-reader.ts` + tests (fuzzed in Phase 5) |
| 3.2 | **Path rules.** Percent-decode each entry name, normalise it, and refuse `..`, absolute paths, drive letters, backslashes and duplicates. Match each `FILE` in `gedcom.ged` to an entry by the 7.0 rules (the `filename-*.gdz` fixtures). Allow only the media types Epoch already accepts; any other entry is kept as an unresolved `FILE` and counted in the job report. | Sonnet | `gedzip-paths.ts` + tests |
| 3.3 | **Workflow steps for a `.gdz` upload session.**<br>- **Dataset step:** read the central directory, inflate `gedcom.ged` under `MAX_DATASET_BYTES`, then import it (Phase 2 makes `OBJE` rows unresolved).<br>- **Media steps:** each takes a batch sized from 0.6. For each entry it streams to `media/<treeId>/<mediaId>.<ext>`, sets `status = 'resolved'`, the size and the checksums, and keeps to the quota.<br>- **Ids:** `mediaId = hash(jobId, entryPath)`, so a retried step lands on the same row.<br>- **Close:** delete the staged archive and record the counts (resolved, unresolved, skipped by type, over quota) on `import_job.result`. | Sonnet | `import-workflow.ts`, media-service |
| 3.4 | **Preview and UI.** The import preview reads only the archive's central directory and the dataset, and reports file count, total bytes, quota headroom and unresolved `FILE`s before anything is written. The import screen shows per-batch progress (ADR-074 open question; recommend yes, since the job row is already polled). | Sonnet | `import-preview.ts`, import screen |
| 3.5 | **Limits.** Add `MAX_GEDZIP_UPLOAD_BYTES` (suggested: `MAX_TREE_MEDIA_BYTES` plus `MAX_DATASET_BYTES`). Count staged bytes for upload sessions apart from `MAX_STAGED_BYTES_PER_TREE`. | Haiku | `limits.ts`, `shared/media.ts` |

## Phase 4: `.gdz` export with media

This phase runs beside Phase 3. Its zip code is a separate module, and its Workflow is the export
one.

| # | Task | Model | Files |
| --- | --- | --- | --- |
| 4.1 | **`zip-writer.ts`.** It writes stored local headers and the central directory, and the EOCD. CRC and size come from the stored `crc32` and `size_bytes`, so no data descriptor is needed; `gedcom.ged` is deflated. It also supports a segment layout, with offsets computed from segment sizes. | Sonnet | `src/lib/server/gedcom/zip-writer.ts` + tests |
| 4.2 | **Export Workflow steps** as ADR-074 Phase 3 sets out.<br>- The dataset segment writes `OBJE` records and pointers (2.4).<br>- Media segment steps copy a batch of R2 objects into one segment object under `exports/…`. Copying takes a snapshot, so a file deleted or replaced during the export cannot corrupt the archive.<br>- A tail step writes the central directory.<br>- The refusal caps are 10,000 people and 50,000 files. | Sonnet | `export-workflow.ts`, `export-instance.ts` |
| 4.3 | **Download.** `export-download.ts` streams the segments in order, with `Content-Length` set to their sum, and sets `Content-Type: application/vnd.familysearch.gedcom+zip`. It honours the existing 24-hour expiry. | Sonnet | `http/export-download.ts` |
| 4.4 | **Export menu.** "Include media" sits beside "Compress to .gdz" and shows the expected size. Unresolved `FILE`s are exported as their original references. | Haiku | export menu component |

**Exit:** Epoch → `.gdz` → Epoch loses nothing (files, links, crops and titles), and the exported
`.gdz` passes the validator and opens in at least one other 7.0 reader (Gramps 6 or a gedcom.io
tool).

## Phase 5: Hardening, end-to-end, docs

| # | Task | Model |
| --- | --- | --- |
| 5.1 | Fuzz `zip-reader`, `gedzip-paths` and the GEDCOM parser with fast-check. Cover zip bombs, overlapping entries, a lying central directory, entries over 1032:1, path traversal and deep nesting. This partly covers the backlog's "Fuzz and mutation-test the parser". | Sonnet |
| 5.2 | Authorization matrix: every upload-session route and every Workflow step re-checks the role and the tree (backlog "Authorization matrix coverage"). | Sonnet |
| 5.3 | Playwright end to end: upload `maximal70.gdz` with media through sessions, wait for the job, see the files attached, export as `.gdz` with media, and compare the entry list. It stays outside the push gate. | Sonnet |
| 5.4 | Docs:<br>- ADR-074 → Implemented, with the amendments from 2.1 and the upload transport.<br>- ADR-036's known gaps pruned.<br>- `architecture.md` resources gain the upload sessions and the import Workflow.<br>- `backlog.md` loses the closed items and gains what is left (galleries, derivatives, pre-signed mode).<br>- `gedcom-extensions.md` lists the new tags. | Haiku |
| 5.5 | (Optional) **Pre-signed part URLs** behind a setting. Sign R2 `UploadPart` URLs with `aws4fetch`, set a 15-minute expiry, and sign `Content-Length`. Needs an S3 token scoped to this bucket and a CORS rule that exposes `ETag`. The client is unchanged. | Sonnet |

## Decisions (owner, 2026-10-31)

1. **Upload transport:** chunked R2 multipart through the Worker. Pre-signed part URLs stay
   optional (5.5).
2. **Order of media records:** `OBJE` is modelled (Phase 2) before media import (Phase 3).
   This amends ADR-074's order.
3. **`SUBM` contents:** a setting per tree (1A.3). 5.5.1 requires `HEAD.SUBM` and a `SUBM` record,
   and Epoch writes neither today, so its 5.5.1 exports are not strictly valid. 7.0 makes both
   optional, so a 7.0 export writes a submitter only when the tree has one. An imported
   submitter fills the setting.
4. **Size caps:** the Workers plan is paid. Parts are 50 MiB, and a `.gdz` may be about 2.05 GB
   (`MAX_TREE_MEDIA_BYTES` plus `MAX_DATASET_BYTES`). One media file may be at most 500 MiB
   (`MAX_MEDIA_FILE_BYTES`), whether uploaded or read from a `.gdz` (decided 2026-11-01): anything
   larger is a long video, which belongs somewhere other than a family tree. A `.gdz` entry over
   the cap is skipped and reported, not imported.
