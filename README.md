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
| `netlify/functions/submit.mjs` | Post requests from the view-only calendar, at `/api/submit`. |
| `netlify/functions/asset.mjs` | The file service at `/api/asset/<id>`: the images, PDFs and videos attached to posts. |
| `netlify/lib/shared.mjs` | Code the three services share: passwords, the file pass, and moving files out of a calendar. |
| `netlify.toml`, `package.json` | Netlify publishes `public/`, bundles the function with esbuild and installs `@netlify/blobs`. |

## Hosting

Connect the repo to Netlify. Publish directory `public`, functions in `netlify/functions` (both set in `netlify.toml`). Add two environment variables: `VIEWER_PASSWORD` (the wider team) and `ADMIN_PASSWORD` (the marketing team), then trigger a deploy so they take effect. Every push to `main` redeploys.

## Signing in, view-only and admin

The hosted site asks everyone to sign in, the same as the Brand, Marketing, CRM and Sales Enablement Plan. Team (the viewer password) opens the view-only calendar: no editing, and no approver comments, performance figures or UTM data. Admin (the admin password) switches on editing and the full post detail; `#admin` on the URL preselects the Admin door. You stay signed in until you close the tab.

To change a password, edit it in Netlify's environment variables and trigger a deploy. Note that `public/data/plan.json` and the files under `public/assets/` are plain files on the site, so the sign-in doesn't cover someone fetching those paths directly.

Every sign-in attempt is logged with its time, IP address and outcome. The sign-in screen says so. Entries go to the Netlify function log and to the store under `security/` (the newest 500 are kept); an admin can fetch the newest 100 at `/api/plan?security=1` with the admin password in the `x-password` header.

## How saving works

In admin, Save sends the calendar to `/api/plan` with the admin password (asked for once per browser, then remembered). The service stores it in Netlify Blobs and keeps a copy under `history/`. Everyone reads the calendar from the same service, so a save shows for the next person straight away. If two admins save at once, the second is told to refresh and try again, so nothing is silently overwritten.

`public/data/plan.json` is the fallback when nothing has been saved yet. If a newer `plan.json` is pushed to the repo, the site takes it on next load and keeps any post edited or added on the site since that file was built; the next admin save stores the merged calendar.

## Attached files and size

The calendar holds text only. A file attached to a post (image, PDF or video) is uploaded on its own to the file service and stored in Netlify Blobs, in a store of its own (`linkedin-calendar-assets`). The post keeps a link: `assetFile.src = "/api/asset/<id>"`, where the id is the SHA-256 of the file. The same file is only ever stored once.

Why it works this way: Netlify turns away any request to a function over 6 MB. Files used to be kept inside the calendar as base64, so every save carried every file ever attached, and in November 2026 the calendar passed the limit and stopped saving. Now a save is the text alone, about 1.5 KB a post.

| | Size |
| --- | --- |
| One attached file | Up to 15 MB (images are resized to 1600px first). Larger files are recorded by name only. |
| One file on a post request (Team) | PNG, JPG or PDF up to 3 MB |
| Six months of posts, at seven a week | About 0.3 MB of calendar, 6% of the 5.5 MB save limit |
| Five years of posts | About 3 MB, 55% of the limit |

The page warns when the calendar's text passes 70% of the limit. Until then there is nothing to archive.

Files are sent in 3 MB slices and joined by the service, and served back with Range support, so video plays and seeks. Showing a file needs a sign-in: signing in sets a cookie (the file pass) that only `/api/asset` reads, because an `<img>` or `<video>` can't send the password header. Changing either password in Netlify ends every pass. Signing out clears it.

Nothing needs migrating by hand. A calendar saved before this change has its files moved out the first time it is read, and a browser holding an older copy has them moved out when it next saves. Files are never deleted, so any earlier save can always be restored with its attachments.

## History, backup and restore

Every save is also kept under `history/`. All saves from the last 30 days are kept; older than that, the last save of each day.

**Backup** (admin, beside Sign out) downloads a zip: the live calendar, the calendar as it stands in that browser (including changes not yet saved), every attached file under `files/`, the sign-in log and the page as deployed.

**Export > Restore from a backup** takes that zip (or a calendar `.json`), puts the attached files back, then replaces the shared calendar with the one in the backup. It asks first. This also works on a brand-new site with an empty store.

## Exports

- **Excel workbook**: a Content calendar sheet with the same columns as the source workbook, plus Overview, Lists and a sheet matching the current view.
- **PowerPoint deck**: month pages (Calendar view) or one slide per working week (Weekly view), then one slide per pillar listing posts and performance.

Both exports build in the browser from CDN libraries (ExcelJS, PptxGenJS, html2canvas and pdf.js), so the site needs internet access to download them.
