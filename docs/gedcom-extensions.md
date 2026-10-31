# GEDCOM extension tags

Epoch writes a few extension tags where GEDCOM has no standard way to say something. Other programs
ignore them; Epoch reads them back, so the data survives a round trip. A GEDCOM 7.0 export lists the
tags it uses in the header's `SCHMA`, with the URI of their section on this page.

Tags that other programs wrote, and that Epoch kept from an imported file, are written back as they
came. They're not listed in `SCHMA`, because Epoch doesn't know their URIs. GEDCOM 7.0 allows an
undocumented extension tag.

## `_PEDI_PARENT`

A child's pedigree towards one parent, when it differs from the pedigree towards the family. For
example, a child is born to one partner and adopted by the other. Standard `PEDI` has one value per
`FAMC`, so it can't say this.

- **Context:** under `FAMC`.
- **Payload:** a pointer to the parent's `INDI` record.
- **Substructure:** one `PEDI`, with the same values as the standard `PEDI`.

```
1 FAMC @F1@
2 _PEDI_PARENT @I2@
3 PEDI ADOPTED
```

Written in GEDCOM 5.5.1 and 7.0. See [ADR-009](adr/ADR-009.md).

## `_EPOCH_PRIVACY`

A record's explicit "public" privacy override. Standard `RESN` restricts a record; nothing marks a
record as deliberately public.

- **Context:** under `INDI`.
- **Payload:** `public`.

```
1 _EPOCH_PRIVACY public
```

Written in GEDCOM 5.5.1 and 7.0. See [ADR-015](adr/ADR-015.md).

## `_EPOCH_SEX`

Only a 5.5.1 export writes this tag. GEDCOM 5.5.1's `SEX` has no `X`, so the export writes
`SEX U` followed by `_EPOCH_SEX X`. Epoch restores `X` when `SEX` is still `U`. GEDCOM 7.0 writes
`SEX X` directly. See [ADR-010](adr/ADR-010.md).

## `_SOUR`

A citation on a child's `FAMC` link. GEDCOM 7.0 has no `SOUR` under `INDI.FAMC` (5.5.1 programs wrote
one), so a 7.0 export writes it as this extension and import reads it back as the citation it is. A
5.5.1 export writes the standard `SOUR`.

- **Context:** under `FAMC`.
- **Payload:** a pointer to a `SOUR` record.
- **Substructure:** the same as a citation: `PAGE`, `QUAY`, `DATA`, notes.

```
1 FAMC @F1@
2 _SOUR @S1@
3 PAGE 12
```

Written in GEDCOM 7.0 only.

## `_FONE` and `_ROMN`

A phonetic (`FONE`) or romanized (`ROMN`) variation of a name or place, as 5.5.1 wrote them, that has
no faithful 7.0 `TRAN`. GEDCOM 7.0 replaced both with `TRAN`, which needs a `LANG`. Epoch derives
the language from the 5.5.1 `TYPE`:

| 5.5.1                          | 7.0 `TRAN` `LANG`  |
| ------------------------------ | ------------------ |
| `ROMN`, `TYPE pinyin`          | `zh-Latn-pinyin`   |
| `ROMN`, `TYPE romanji`/`romaji` | `ja-Latn`          |
| `ROMN`, `TYPE wadegiles`       | `zh-Latn-wadegile` |
| `ROMN`, no `TYPE`              | `und-Latn`         |
| `FONE`, `TYPE hangul`          | `ko-Hang`          |
| `FONE`, `TYPE kana`            | `ja-Kana`          |

A `FONE` with no `TYPE`, and either kind with any other `TYPE`, has no language to give, so it is
written as `_FONE` or `_ROMN` with its lines unchanged. A 5.5.1 export writes all of these back as
`FONE` and `ROMN` with their `TYPE`.

- **Context:** under `NAME` or `PLAC`.
- **Payload and substructure:** as 5.5.1's `FONE` / `ROMN`, including `TYPE`.

```
1 NAME 王 /李/
2 _FONE Wang /Li/
3 TYPE other
```

Written in GEDCOM 7.0 only.

## Other kept lines

Lines kept from a 5.5.1 file that GEDCOM 7.0 has no place for are written with an underscore prefix
(`CEME` as `_CEME`), so the 7.0 file stays valid and nothing is lost. These are not listed in `SCHMA`:
Epoch did not define them and does not know their URIs. The same applies to an embedded `OBJE` (with
its own `FILE`) where 7.0 allows only a pointer: it is written whole as `_OBJE`. A `URL` becomes `WWW`
where 7.0 has `WWW`.

Other 5.5.1 structures are written in their 7.0 form rather than as extensions: `ASSO` `RELA` becomes
`ROLE` (a word 7.0 has no value for is `ROLE OTHER` with the word as its `PHRASE`), a shared `NOTE`
becomes `SNOTE`, an inline `SOUR text` becomes a pointer to a new `SOUR` record whose `TITL` is the
text, and a `FILE` with no or an empty `FORM` gets one from its extension (`application/octet-stream`
when it has none).
