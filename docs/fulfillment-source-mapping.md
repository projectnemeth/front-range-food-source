# Phase Two source mapping and preflight

## Verified item-request source — November 18, 2026

The user supplied the operational **2025 Food Bank Order Form(Responses)** workbook, distinct from the copy inspected previously. Its `2025` tab has 39 grid columns and a frozen header row; workbook timezone is America/Boise. The tab name is not a pickup event. The metadata row capacity is not a response count. Only metadata, A1:AM1 headers, and bounded S2:V8, X2:AB8, and AG2:AG8 request cells were inspected read-only. No household names, contact fields, or identity columns were read. No individual response records were saved in the repository. The committed JSON contains only source headers; tests use fictional households and synthetic requests.

| Columns | Meaning and review treatment |
| --- | --- |
| A–C | Timestamp, Food Bank ID, initial household name; preserve text, including leading zeroes; do not assume uniqueness |
| D–I | Address, county, email, phone, language, ethnicity; excluded from this packing review output |
| J–N | Original household size, adult/senior/child counts and child ages; preserve for review without independently calculating allocations |
| O–R | Gluten and vegan answers and counts; retain all four raw cells |
| S–V | Infant count, baby requests, formula details, diaper/pull-up size; preserve together |
| W | Specific request details; preserve whole cell |
| X–AA | ROW 2, ROW 3 SNACKS, Column 25, ROW 5; dry candidates only, subject to item-specific review |
| AB | Fresh/refrigerated requests; after arrival, including ambient produce |
| AC–AD | Pickup commitment wording/answers; preserve, but do not infer a pickup date |
| AE–AF | Later household size and name fields; preserve alongside earlier answers and flag disagreement |
| AG | Frozen meat/meals requests; after arrival |
| AH–AM | Blank headers; nonempty data must be flagged and retained for review |

J and AE have the same household-size header. Mapping is positional with an explicit duplicate-header acknowledgment at both positions, so a newly introduced duplicate still blocks. Trailing whitespace is normalized only in headers. All source response text is preserved in the review fields.

The bounded sample demonstrates that cells contain multiple choices and labels with internal commas (for example, prepared meal labels), and may contain free-text additions. **Do not split request cells on commas.** The review adapter retains whole cells; a future choice decoder requires a verified option catalog or explicit coordinator interpretation. It does not assign quantity one to checked categories, turn household counts into allocations, or assume source ROW labels are approved shelf codes.

The user confirmed on November 18: distributions occur on the first and third Saturdays; the form opens the Monday following the prior distribution and closes the Tuesday before the next distribution. Column A assigns responses to that ordering window. The review adapter now suggests a pickup date from US-formatted timestamps, including optional AM/PM, using calendar dates rather than the host timezone. Opening/closing dates are inclusive only for candidate routing: timestamps on either boundary date require review of actual clock times. Outside-window and invalid/unsupported timestamp values are flagged; no record is automatically released. The observed source timezone is America/Boise. No live timestamp values were read to certify timestamp formatting. Holiday changes and actual form opening/closing times remain event review checks.

The user also confirmed quantities depend on household size and current stock: scarce items yield smaller portions and plentiful items larger portions, proportionate to family size. This is an event-specific allocation policy, not a fixed quantity per checkbox. Before release, a coordinator must approve the available distributable units, unit/package sizes, eligible households, rounding/minimum/cap rules and final per-household quantities. This milestone deliberately does not invent the numeric formula or reserve stock. Conflicting household-size answers must be resolved first. Shelf locations and source-choice decoding also remain unapproved. Cross-workbook identity also requires explicit reviewed linkage to the existing check-in source: the response workbook is different from the label workbook, and names or Food Bank ID alone are not safe join keys.

## Response review adapter

`reviewFormResponses` validates the exact observed layout before extracting records. Input contains `snapshot: {sheetTitle, columnCount, headers}` plus `rows: [{rowNumber, cells}]`. Cells are formatted strings or nulls; readers must request text values to preserve identifiers and avoid implicit timestamp conversion. Use at most 50 rows and the complete 39-column layout per slice. Row numbers are diagnostic locators only; a partial slice cannot establish global identity uniqueness, event completeness, source deletion, or an authoritative latest response.

```sh
npm run fulfillment:review-source -- /absolute/path/to/response-review.json
```

The command accepts up to 1 MB of local JSON, emits a structured review report, and has no network/database access. Exit 0 means a review report was produced for matching headers, not that the rows can be imported. Exit 1 means layout mismatch (no records extracted); exit 2 means invalid input. Preserve the output in an appropriate private location: it contains household labels and original request instructions. Do not commit real review reports. Structured contact columns are excluded; free text is preserved verbatim and may itself contain personal information.

Every record remains `importReady: false`, with event, allocation and identity review required. `pickupWindow` provides the candidate date and window or an explicit timestamp/outside-window issue; it does not create or activate an event. Missing names/IDs/timestamps, conflicting earlier/later names or household sizes, repeated IDs within the slice, empty item requests, and values under unlabeled columns receive explicit flags. Requests are not converted to normalized manifests yet. The adapter is not attached to the staff UI, live Google reader, or manual manifest import API. Fresh/refrigerated and frozen source cells are marked after-arrival; other category cells are only advance-dry candidates pending item review.

## Earlier source discovery — November 17

The check-in workbook and an accessible response-file copy contained household headers but no food-selection headers. The exact operational source above resolves that source-discovery gap. Those earlier workbooks are not substitutes for the item-request source. No source cells, sharing, pilot configuration, or runtime settings were changed. Source IDs remain outside this repository. See [check-in mapping](pickup-labels/source-sheet-mapping.md) for separate check-in identity observations.

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

The checker trims header whitespace, rejects positional drift, wrong tabs, changed grid width, unacknowledged duplicate headers, duplicate mappings, missing required roles, and unreviewed named columns. It produces a normalized header fingerprint for later comparison. Inputs are bounded to 256 KB. Exit status is 0 for matching layout, 1 for blocked layout, or 2 for malformed/oversized input. Error output does not echo uploaded values.

**`importReady` is always false.** A layout match proves only that the provided header snapshot matches the provided mapping. The tool does not read Google, connect to Firebase, produce manifests, change events, or certify mappings as approved. It is a local diagnostic foundation for the future reader, not an enforced gate on the existing manually normalized JSON import route. The live reader must call this check and validate data/provenance before offering an import preview.

## Remaining mapping work

With the actual source now identified:

1. Inspect metadata, headers, and only the bounded noncontact response fields needed to understand selection encoding.
2. Establish pickup-event selection and stable response identity. ID# duplicates and changed submissions require explicit review; row numbers are not durable identities.
3. Preserve every food, household-supply, baby-supply, dietary, and free-text request. Define dispositions for unmapped or unavailable choices instead of silently omitting them.
4. Obtain approved quantities/units and shelf locations. Header or checkbox presence alone does not imply quantity one.
5. Separate storage from preparation timing: dry shelf-stable goods may be prepacked; produce, refrigerated, frozen and other perishables wait until check-in, including ambient produce.
6. Use an explicit read-only service integration and reviewed preview/apply; never configure a latest-tab shortcut or modify the label pilot during source discovery.

Source-change reconciliation for orders with physical work, deletion detection from complete trusted snapshots, and the arrival bridge remain separate unfinished milestones.
