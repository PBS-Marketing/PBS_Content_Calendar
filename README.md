# LinkedIn Content Calendar

Paragon Brand Services' LinkedIn content calendar: posts by content pillar in weekly, calendar and list views, with the post brief, copy, approvals and performance in each entry, and Excel and PowerPoint export.

Sister tool to the Brand, Marketing, CRM and Sales Enablement Plan roadmap (Salesenablementplanner).

## Files

| File | What it is |
| --- | --- |
| `public/index.html` | The whole app. No build step. Signs in as Team (view-only) or Admin (editing); `#admin` on the URL preselects Admin. |
| `public/data/plan.json` | The starting calendar and the file to update when posts are added from outside the site. |
| `public/assets/` | The carousel PDFs the posts link to. |
| `netlify/functions/plan.mjs` | The save service at `/api/plan`, the same pattern as the Brand, Marketing, CRM and Sales Enablement Plan. Calendars live in Netlify Blobs; every save also goes to `history/`. |
| `netlify.toml`, `package.json` | Netlify publishes `public/`, bundles the function with esbuild and installs `@netlify/blobs`. |

## Hosting

Connect the repo to Netlify. Publish directory `public`, functions in `netlify/functions` (both set in `netlify.toml`). Add two environment variables: `VIEWER_PASSWORD` (the wider team) and `ADMIN_PASSWORD` (the marketing team), then trigger a deploy so they take effect. Every push to `main` redeploys.

## Signing in, view-only and admin

The hosted site asks everyone to sign in, the same as the Brand, Marketing, CRM and Sales Enablement Plan. Team (the viewer password) opens the view-only calendar: no editing, and no approver comments, performance figures or UTM data. Admin (the admin password) switches on editing and the full post detail; `#admin` on the URL preselects the Admin door. You stay signed in until you close the tab.

To change a password, edit it in Netlify's environment variables and trigger a deploy. Note that `public/data/plan.json` and the files under `public/assets/` are plain files on the site, so the sign-in doesn't cover someone fetching those paths directly.

## How saving works

In admin, Save sends the calendar to `/api/plan` with the admin password (asked for once per browser, then remembered). The service stores it in Netlify Blobs and keeps a copy under `history/`. Everyone reads the calendar from the same service, so a save shows for the next person straight away. If two admins save at once, the second is told to refresh and try again, so nothing is silently overwritten.

`public/data/plan.json` is the fallback when nothing has been saved yet. If a newer `plan.json` is pushed to the repo, the site takes it on next load and keeps any post edited or added on the site since that file was built; the next admin save stores the merged calendar.

## Exports

- **Excel workbook**: a Content calendar sheet with the same columns as the source workbook, plus Overview, Lists and a sheet matching the current view.
- **PowerPoint deck**: month pages (Calendar view) or one slide per working week (Weekly view), then one slide per pillar listing posts and performance.

Both exports build in the browser from CDN libraries (ExcelJS, PptxGenJS, html2canvas and pdf.js), so the site needs internet access to download them.
