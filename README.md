# Player Development Hub

A browser-based replacement for the academy **Player Database masterfile** (one Excel workbook, 11 tabs, ~1,800 players).

## What the masterfile does

The workbook tracks, for each academy program, every player's offer cycle for the coming season:

| Tier | Tabs | Tracks |
|---|---|---|
| Full Time | Girls (QAS NPLW, QST U15/U16, Standby), QST Boys | Retention/promotion decision, offer response, fee waivers, position, kit sizes |
| Emerging | Far North & Gulf, Northern, Whitsunday Coast, Central Coast, Wide Bay, Metro | Age group, hub, offer status (New / Early Retention / Review / Waitlist / Graduate / Release), letter type, response |
| Development Hub | Mt Isa, Far North Hubs, Burdekin | Prior season status, program fee paid, next season retention |

Every row also stores the parent/caregiver contacts used to send letters and follow up.

### Problems with the spreadsheet

- 11 tabs with different column names and orders for the same data (`DOB` vs `Date of Birth`, `Offer Response` vs `Response to Offer`)
- Repeated header rows, blank placeholder rows and section titles in the middle of tables
- Phone numbers stored as numbers (leading `0` lost), dates as text in some rows
- Age groups typed by hand (`Under 09 Boys`, `U9 Boys`, `U13 Boys (Born 2014)`) and sometimes wrong for the DOB
- No totals: squad sizes, response rates, outstanding fees and kit orders have to be counted manually
- No change history; edits are only traceable through comments
- One tab carries ~16,000 empty formatted columns, inflating the file to 15 MB

## What the platform does

- **Import** the existing `.xlsx` as is. Every tab is mapped to one consistent model, with phones, dates, names and age groups cleaned up. You see a per-tab preview with warnings before anything is saved. Re-importing **merges**: matching players (same name, DOB and program) are updated and the change is logged.
- **Dashboard**: totals, acceptance rate, players still to respond, fees outstanding, data issues, and offer responses by program. Every number links to the filtered list behind it.
- **Players**: one searchable table covering all programs. Filter by program, hub, age group, gender, status, letter, response and fee. Change status fields directly in the table, or select many players and change them at once. "Copy emails" puts the filtered parents' addresses on the clipboard for a BCC mail-out.
- **Player profile**: all fields, mailto/tel links, data-quality warnings, links to the same player in other programs, and a full change history.
- **Squads**: accepted, awaiting, waitlisted and declined counts per program, hub, age group and gender, shown against a target squad size.
- **Kit orders**: size totals for accepted players, a list of players with missing sizes, and an Excel export.
- **Data quality**: missing contacts, invalid emails and phones, missing DOBs, age groups that don't match the DOB, and players listed in more than one program.
- **Export**: an Excel workbook with one tab per program and the same columns on every tab, CSV, or a JSON backup with full history.
- **Undo** after every change (toast button or Ctrl/Cmd+Z). Press `/` to jump to search.

Age groups are worked out from the season year (Settings): `season - birth year`, so a player born in 2018 is U09 in 2027.

## Running it

No build step and no server-side code. Data is stored in the browser's IndexedDB on the device you use, and nothing is uploaded.

```bash
npm start            # serves on http://localhost:8080 (python3 http.server)
```

Opening `index.html` directly also works. To try it with fictional players, use **Load demo data**.

## Tests

```bash
npm install
npm test             # importer, normalisers, merge and export round-trip
```

The tests use a synthetic workbook that reproduces the masterfile's quirks with fictional people.

## Data protection

The masterfile holds personal information about minors and their parents. `.gitignore` blocks `*.xlsx`, `*.csv` and backups so real data is never committed. Keep JSON backups somewhere with controlled access, such as SharePoint.

## Limitations / next steps

- Storage is per browser and per device. For several staff editing at the same time, the `PD.store` module is the single place to swap in a shared backend (for example SharePoint Lists, Supabase or a small API). The rest of the app does not change.
- No logins or role-based access yet (needed once there is a shared backend).
- Offer letters are not generated. The data needed for a mail-merge is available through the Excel/CSV export.

## Structure

```
index.html          app shell
css/app.css         styles (light + dark)
js/model.js         lookups, normalisers, age-group and validation rules (pure, tested)
js/importer.js      masterfile -> player records, merge logic (tested)
js/exporter.js      Excel / CSV export (tested)
js/store.js         IndexedDB persistence
js/demo.js          fictional demo data
js/app.js           UI
js/vendor/          SheetJS 0.18.5 (Apache-2.0), vendored so it works offline
```
