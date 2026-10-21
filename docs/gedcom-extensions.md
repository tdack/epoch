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
