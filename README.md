# LinkedIn Content Calendar

Paragon Brand Services' LinkedIn content calendar: posts by content pillar in weekly, calendar and list views, with the post brief, copy, approvals and performance in each entry, and Excel and PowerPoint export.

Sister tool to the Brand, Marketing, CRM and Sales Enablement Plan roadmap (Salesenablementplanner).

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole app. No build step. |
| `data/plan.json` | The calendar: pillars, lists (channels, formats, objectives, statuses), overview, and every post. This is the file to update when the shared calendar changes. |
| `netlify.toml` | Publishes the repo root as a static site and stops the browser caching `data/plan.json`. |

## Hosting

Connect the repo to Netlify as a new site. No build command, publish directory `.`. Every push to `main` redeploys.

## How saving works on the hosted site

The hosted page reads `data/plan.json` on load. Edits made in the browser save to that browser only (local storage), so the shared calendar changes when `data/plan.json` changes in the repo:

1. Make the edits in the app.
2. Import / Export → **Plan data (JSON)** to download the calendar.
3. Replace `data/plan.json` with the download and push.

To load a fresh workbook instead, use Import / Export → **Import from Excel** on the `LinkedIn Content Calendar` workbook (the Content calendar and Lists sheets are read), then export the JSON and push it as above.

## Exports

- **Excel workbook**: a Content calendar sheet with the same columns as the source workbook, plus Overview, Lists and a sheet matching the current view.
- **PowerPoint deck**: month pages (Calendar view) or one slide per working week (Weekly view), then one slide per pillar listing posts and performance.

Both exports build in the browser from CDN libraries (SheetJS and PptxGenJS), so the site needs internet access to download them.
