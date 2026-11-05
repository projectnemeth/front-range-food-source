# Pilot handoff checklist

## Prepared locally

- Staff check-in and packing-station views, fictional-data demo, and print recovery controls.
- Read-only Sheet adapter mapped to the supplied workbook's headers.
- Explicit pickup-tab selection; no assumption that the last dated tab is the upcoming pickup.
- Coordinator review for repeated IDs; source data remains unchanged.
- Coordinator setup checklist, pickup-tab activation, import preview, and read-only service-status checks.
- Separate working-sheet storage for arrivals, reviews, and immutable print-job snapshots.
- 83 passing automated tests with mocked Google/PrintNode services and an in-memory DOM.
- Automatic print follow-up on the iPad (pinned Label problem alert) for running without a packing screen.
- Demo checked in a headless browser at iPad and phone sizes.

## Still required before real pickup

1. Select the laptop and printer; record OS, printer model, label dimensions, and DPI.
2. Test the printer from the laptop, then through PrintNode. Keep the laptop awake and online.
3. Create the standalone Apps Script project and separate working spreadsheet; copy the six deployment files and configure the script properties using README instructions.
4. Identify the correct pickup tab and coordinator accounts and church iPads. The included October configuration is disabled historical reference data.
5. Preview/import the event, review repeated IDs and missing fields, and verify allowed/denied coordinator accounts, enroll each staff browser, and test unpaired access denial and revocation.
6. Print and measure a full arrival label (two-line name, #number, ORANGE box, vehicle) on the real stock. Run the fictional physical label tests and the 10-household mobile rehearsal before printing real registrations. Include a dropped connection, paper-out condition, and two iPads checking in the same household.
7. Close/reopen each iPad browser to verify authorization persists without volunteer sign-in. Confirm accents/long names, copy count, label grouping, arrival visibility at packing, and restart recovery.
8. Agree the retention period and archive process for working records and print-service history.

## Demo rehearsal without hardware

Open `Index.html` in a browser. Use fictional households only. Try a normal check-in, then switch to Packing station. Change the demo outcome to a timeout and practice reviewing the affected household before reprinting. The second Maria Garcia entry includes a fictional repeated-ID review case: choose a response and supply a reason, then check it in.

The demo cannot print, access the live sheet, or retain changes after reload. Automated DOM tests are not browser visual verification. Native browser QA remains unavailable in this session because the Mac is locked; check iPad layout and interaction during deployment.
