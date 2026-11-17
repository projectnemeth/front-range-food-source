# Phase Two source mapping and preflight

Inspected November 17, 2026 through connected Google Sheets, read-only. Only workbook metadata and header rows were read; no household response rows were downloaded or committed. No source cells, sharing, pilot configuration, or runtime settings were changed.

## Source findings

The existing check-in source, **2025 Current Food Bank Orders**, is not yet a verified fulfillment source. Its `10/17/2026` and `11/7/2026` tabs both have 24 grid columns. B–I contain ID#, First & Last Name, Phone Number, Total in Family, Adults, Seniors, Kids, and Kid's Ages (some with trailing whitespace). October A1 is Date; November A1 is blank. J–X have no returned headers. These header reads do not establish whether unlabeled columns contain data. Neither tab provides a labeled item-selection schema. November 7 is historical as of this inspection; no tab was activated.

The user confirmed that printed item-by-item orders come from **Google Form Responses**. Search found **Copy of 2025 Food Bank Order Form(Responses)**, with one tab named `2025`, 13 grid columns, and timezone America/Boise. Its header row contains Food Bank ID, name, address, county, email, phone, language, ethnicity, household count, adult/senior/child counts, and Column 13. It has no explicit timestamp or food-selection headers. This copy is not established as the live response destination. Its name alone does not establish provenance.

The exact operational form or linked response-spreadsheet URL has been requested. Do not substitute either inspected workbook for the missing item-request source. Source IDs remain outside this repository. See the earlier [check-in mapping](pickup-labels/source-sheet-mapping.md) for identity findings; those remain check-in observations, not food-field mapping.

## Implemented read-only layout check

Run:

```sh
npm run fulfillment:preflight -- /absolute/path/to/header-review.json
```

The input is a JSON object with `snapshot` and `mapping`:

```json
{
  "snapshot": {
    "sheetTitle": "Fictional pickup",
    "columnCount": 4,
    "headers": ["Timestamp", "ID#", "Name", "Food requests"]
  },
  "mapping": {
    "version": "fictional-only-v1",
    "sheetTitle": "Fictional pickup",
    "columnCount": 4,
    "columns": [
      {"index": 0, "header": "Timestamp", "role": "responseTimestamp", "reason": "Candidate revision; not a unique identity"},
      {"index": 1, "header": "ID#", "role": "registrationId", "reason": "Duplicates require review"},
      {"index": 2, "header": "Name", "role": "householdLabel", "reason": "Packing label"},
      {"index": 3, "header": "Food requests", "role": "request", "reason": "Preserve each original request"}
    ]
  }
}
```

This example is fictional, not the real source layout. Obtain metadata and the entire header row from the selected tab; do not include response rows. Column indexes in the mapping are zero-based; issue reports use one-based column numbers. The snapshot may omit trailing blank cells, as Google Sheets does, but must declare the full grid width. Blank columns are not evidence that the corresponding data is empty; a future bounded data reader must validate that before any release.

Every named column needs a disposition: responseTimestamp, registrationId, householdLabel, request, dietary, notes, or ignore. Every mapping entry requires a reason, including ignored contact/demographic fields. Timestamp, registration, and household roles each require exactly one column; at least one request column is required. Ignore is a reviewed disposition, not automatic permission to discard request or dietary content. This tool cannot establish whether the supplied semantic roles are correct.

The checker trims header whitespace, rejects positional drift, wrong tabs, changed grid width, duplicate headers/mappings, missing required roles, and unreviewed named columns. It produces a normalized header fingerprint for later comparison. Inputs are bounded to 256 KB. Exit status is 0 for matching layout, 1 for blocked layout, or 2 for malformed/oversized input. Error output does not echo uploaded values.

**`importReady` is always false.** A layout match proves only that the provided header snapshot matches the provided mapping. The tool does not read Google, connect to Firebase, produce manifests, change events, or certify mappings as approved. It is a local diagnostic foundation for the future reader, not an enforced gate on the existing manually normalized JSON import route. The live reader must call this check and validate data/provenance before offering an import preview.

## Remaining mapping work

Once the actual source is identified:

1. Inspect metadata, headers, and only the bounded noncontact response fields needed to understand selection encoding.
2. Establish pickup-event selection and stable response identity. ID# duplicates and changed submissions require explicit review; row numbers are not durable identities.
3. Preserve every food, household-supply, baby-supply, dietary, and free-text request. Define dispositions for unmapped or unavailable choices instead of silently omitting them.
4. Obtain approved quantities/units and shelf locations. Header or checkbox presence alone does not imply quantity one.
5. Separate storage from preparation timing: dry shelf-stable goods may be prepacked; produce, refrigerated, frozen and other perishables wait until check-in, including ambient produce.
6. Use an explicit read-only service integration and reviewed preview/apply; never configure a latest-tab shortcut or modify the label pilot during source discovery.

Source-change reconciliation for orders with physical work, deletion detection from complete trusted snapshots, and the arrival bridge remain separate unfinished milestones.
