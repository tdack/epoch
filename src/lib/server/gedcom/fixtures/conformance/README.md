# GEDCOM 7.0 conformance fixtures

Official FamilySearch GEDCOM 7.0 example files, used as a conformance corpus for the
GEDCOM 7 parser, serializer and GEDZIP handling. **They are not committed.** Run
`npm run gedcom:conformance` to download them into `files/` (gitignored). The script pins
every file to one upstream commit and checks its SHA-256, so each run reads the same bytes.
Tests that need these files skip when `files/` is missing.

## Source

- Repository: <https://github.com/FamilySearch/GEDCOM.io>
- Path: `testfiles/gedcom70/` (the `testfiles/gedcom71/` set is out of scope and not copied)
- Commit: `c52d510324ecf961b3632834e7948afb771513e6` (committed 2026-10-24)
- Download: `https://raw.githubusercontent.com/FamilySearch/GEDCOM.io/c52d510324ecf961b3632834e7948afb771513e6/testfiles/gedcom70/<name>`
- Published index of these files: <https://gedcom.io/tools/#example-familysearch-gedcom-70-files>

## Licence

The GEDCOM.io repository has no LICENSE file, and GitHub reports no licence for it.
The licence of these test files is therefore not stated by the source.

For reference, the GEDCOM specification repository
(<https://github.com/FamilySearch/GEDCOM>, commit `633ebf8512dad123c41e9568b15845efb6a8b4b2`)
is licensed under Apache-2.0. That licence covers the specification, not these files, and is
not assumed to apply to them. That is why they are fetched rather than committed: this
repository is published, and it does not redistribute them.

## Files

Paths are relative to `files/`. The `maximal70/` subdirectory mirrors the upstream subdirectory of the same name. It holds a
second copy of `maximal70.gdz`, which differs from the top-level one (see the table).

| File | Size (bytes) | Exercises |
| --- | ---: | --- |
| `age.ged` | 2355 | `AGE` payloads: zero forms with and without `<`, `>` and `<` ranges, `PHRASE`, unbounded values with no range restriction. |
| `date.ged` | 52099 | `DATE` payloads across calendars (Gregorian, Julian, `BCE`), periods, ranges, approximations and calculated dates. Eight `INDI` records. |
| `escapes.ged` | 733 | `@` escaping: only a leading `@` in a line or `CONT` value is doubled, and `SNOTE` values with internal `@` characters. |
| `extension-record.ged` | 357 | An extension `_LOC` record referenced by pointer from `BIRT`/`PLAC`. |
| `extensions.ged` | 3405 | `SCHMA` extension tags: documented and undocumented records, structures, enumerations, calendars, months and pointers, including shared tag names. |
| `filename-1.ged` | 1798 | `FILE` payloads: RFC 8089 `file:` URIs, RFC 3986 relative paths, percent escapes, web URLs with query and fragment, non-ASCII URLs, and reserved names (`gedcom.ged`, `MANIFEST.MF`, `META-INF/`). Note there is no `filename-*.gdz` upstream. |
| `lang.ged` | 2119 | `LANG` payloads: every language tag from the 5.5.1 specification, plus a `SCHMA` mapping for `_PHRASE`. |
| `long-url.ged` | 1016 | A `WWW` value on one very long line, to test long-line parsing. |
| `maximal70.ged` | 14282 | Kitchen sink: all standard tags in many positions, all standard enumeration values, `TRAN`, `SLGS`, `UID`, `SCHMA`, multiple `SOUR` forms and `PHRASE`/`AGE` payloads. |
| `maximal70.gdz` | 82778 | GEDZIP with `gedcom.ged` and media under `media/` (JPEG with a non-ASCII name, OGG audio, MP3, WebVTT transcript) plus a nested `path/to/file1`. Used for `OBJE` file handling. |
| `maximal70/maximal70.gdz` | 82900 | Second GEDZIP from upstream with the same media. Its `gedcom.ged` differs: adds `ADDR` `ADR1`-`ADR3`, `HEAD.DATA`, `LDS` `STAT` values and `ADR1`-`ADR3` on repositories and submitters. |
| `maximal70-lds.ged` | 1262 | `maximal70-tree1` plus LDS ordinance structures: `BAPL`, `CONL`, `ENDL`, `INIL`, `SLGC`, `SLGS`, `TEMP`. |
| `maximal70-memories1.ged` | 1092 | `maximal70-tree1` plus multimedia: `INDI.OBJE`, `OBJE` records, `OBJE.FILE` and `OBJE.FILE.FORM`. |
| `maximal70-memories2.ged` | 1188 | `maximal70-memories1` plus `FAM.OBJE`, event-level `OBJE` and `SOUR.OBJE`. |
| `maximal70-tree1.ged` | 891 | `minimal70` plus core individual and family events, names, `FAMC`/`FAMS`, `HUSB`/`WIFE`/`CHIL`, `SOUR` with `PAGE`, and `@VOID@` in `CHIL`/`FAMS`. |
| `maximal70-tree2.ged` | 2353 | `maximal70-tree1` plus many individual and family attribute and event structures, and `EVEN`/`NAME`/`NOTE` sources. |
| `minimal70.ged` | 32 | Smallest legal 7.0 file: `HEAD`, `GEDC`/`VERS 7.0`, `TRLR`. |
| `minimal70.gdz` | 157 | Smallest legal GEDZIP 7.0: one `gedcom.ged` entry holding the minimal header and trailer. |
| `notes-1.ged` | 390 | `NOTE` and `SNOTE`: single-use, dual-use and cyclic shared note records, plus inline notes. |
| `obje-1.ged` | 425 | `OBJE` records with several `FILE`/`FORM`/`MEDI` entries, shared pointers and `TITL`. |
| `remarriage1.ged` | 388 | One couple who marry, divorce and remarry, stored as a single `FAM` with repeated `MARR`/`DIV`. |
| `remarriage2.ged` | 447 | The same couple stored as separate `FAM` records. |
| `same-sex-marriage.ged` | 173 | Two `SEX M` spouses in a `FAM` with `HUSB` and `WIFE`. |
| `voidptr.ged` | 292 | `@VOID@` pointers in `FAMS`, `FAMC` and `CHIL`. |
| `warnings70.ged` | 1284 | Constructs that are legal in 7.0 but may warn: `EXID`, `SLGS` `STAT` values, `BAPL`/`CONL`/`INIL`, `REPO`, `SUBM`, `_EXT` with `DATE FROM`/`TO`. |
| `xref.ged` | 405 | Cross-reference identifier formats: unnumbered `INDI`, `@I@`, `@1@`, `@_@`, `@0XFFFFFFFF@`, and a very long identifier. |

## GEDZIP entries

`unzip -l` on each `.gdz`:

- `minimal70.gdz`: `gedcom.ged` (39 bytes)
- `maximal70.gdz`: `gedcom.ged` (15112), `media/` (directory), `media/CharlotteBront??.jpg` (79000),
  `media/derived.oga` (210), `media/original.mp3` (625), `media/transcript.vtt` (35),
  `path/` (directory), `path/to/` (directory), `path/to/file1` (28)
- `maximal70/maximal70.gdz`: the same media entries as above, and `gedcom.ged` (15906)

The `??` in the JPEG name is how `unzip -l` displays a non-ASCII byte in the archive entry name.

## Not found upstream

- `filename-*.gdz`: upstream has only `filename-1.ged`.
- `same-sex-marriage` and `voidptr`, `lang`, `age` and `escapes` are present as `.ged` only.
- `maximal70-lds` is present as `.ged` only.
- `*.gdz` for the remarriage, notes, obje and xref sets: none exist upstream.
