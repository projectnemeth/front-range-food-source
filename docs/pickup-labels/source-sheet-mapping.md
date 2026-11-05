# Verified response-sheet mapping

Inspected November 5, 2026 through the connected Google Drive account. Read-only inspection; no source cells, tabs, or permissions changed.

Source: the food bank's Google Form response workbook ("2025 Current Food Bank Orders"). Its spreadsheet ID and tab IDs are kept in the coordinator's configuration, not in this public repository.

## Observed structure

The workbook contains dated pickup tabs. The latest dated tab visible during inspection is `10/17/2026`. This is historical; do not automatically activate it as the next pickup. The `9/19/2026` tab has the same inspected header layout. The workbook timezone is America/Denver.

| Label/import field | Source column | Header after trimming whitespace |
| --- | --- | --- |
| Submission timestamp | A | Date |
| Existing identifier | B | ID# |
| Name | C | First & Last Name |
| Phone | D | Phone Number |
| Household size | E | Total in Family |
| Pickup event | Explicit coordinator-selected tab | Dated tab title |

Columns F–I contain Adults, Seniors, Kids, and Kid's Ages. Use the supplied total in column E; do not independently sum those demographic fields. Names and phone headers have trailing spaces in the inspected tabs, so mapping must trim header whitespace. Treat identifiers and phone numbers as text.

## Identity finding and implemented handling

A bounded read of A2:B1004 in the October tab found 95 populated timestamp/ID rows, no missing timestamps or IDs in that range, and two repeated-ID groups. This is structural inspection, not a review of household contacts. No real names or phone values were downloaded for this work.

**ID# alone is not a unique response identifier.** The implemented sheet adapter instead creates one held review group per spreadsheet/tab/ID combination. A coordinator must choose the correct response and record a reason before that group can check in or print. If distinct households share an ID, the coordinator must correct their source IDs rather than selecting just one household. The app does not change source cells.

Sorting rows preserves group identity. The submission timestamp participates in a candidate fingerprint, not the durable group key. Changed candidate groups invalidate previous review choices on refresh. Different dated tabs maintain separate registrations for the same ID. Arrived records removed from the source stay visible with a review warning.

## Current integration status

The connector can read the workbook, headers, and bounded timestamp/ID ranges. The local application now includes `Sheets.gs`, duplicate-review UI, and `config.sheet.example.json` with the verified mapping. The historical October tab is disabled in the example so it cannot accidentally become an active pickup.

This proves read access for the conversation's connected account; it does not deploy the app or grant its future Apps Script execution accounts access. No live registration import, source editing, account setup, or printing has occurred. Live Google execution and physical printer validation remain outstanding.
