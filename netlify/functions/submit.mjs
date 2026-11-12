// Post requests from the view-only calendar.
// POST /api/submit -> { pillar, date, title, objective, asset, copy, email, owner, assetFile? }
// assetFile is { name, src: "/api/asset/<id>" }: the page uploads the file to the asset service first.
// Adds the request to the shared calendar (Netlify Blobs) as a post with status "Submitted".
// The team or admin password is required (x-password header); nothing else can be changed this way.

import { randomBytes } from "node:crypto";
import {
  json, env, roleFor, planStore, assetStore, putAsset, moveFilesOut, hasEmbeddedFiles, assetUrl, idFromSrc, allowedType, ASSET_MAX_VIEWER, PLAN_MAX,
} from "../lib/shared.mjs";

export const config = { path: "/api/submit" };

const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env("ADMIN_PASSWORD")) return json({ error: "not_configured" }, 503);
  if (!roleFor(req.headers.get("x-password") || "")) return json({ error: "sign_in_required" }, 401);
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: "bad_request" }, 400); }
  const title = clean(body.title, 200), email = clean(body.email, 200), pillar = clean(body.pillar, 60), date = clean(body.date, 10);
  if (!title || !email || !pillar || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "bad_request" }, 400);

  const store = planStore();
  const current = await store.get("plan", { type: "json" });
  if (!current || !current.plan || !Array.isArray(current.plan.items)) return json({ error: "calendar_not_initialised" }, 503);
  const plan = current.plan;
  if (!(plan.pillars || []).some(p => p.id === pillar)) return json({ error: "bad_request" }, 400);

  const now = new Date().toISOString();
  const owner = clean(body.owner, 40);
  // The attachment is stored by the asset service; the request carries only its link.
  // (A browser with an old copy of the page may still send the file itself: store it here and keep the link.)
  let assetFile = null;
  if (body.assetFile && typeof body.assetFile === "object") {
    const a = body.assetFile, src = typeof a.src === "string" ? a.src : "";
    const files = assetStore();
    const linked = idFromSrc(src);
    if (linked) {
      const info = await files.getMetadata(linked);
      if (!info || !allowedType(info.metadata.type || "", "viewer") || (info.metadata.size || 0) > ASSET_MAX_VIEWER) return json({ error: "attachment_must_be_png_jpg_or_pdf_under_3mb" }, 400);
      assetFile = { name: clean(a.name, 200) || info.metadata.name || "attachment", type: info.metadata.type, size: info.metadata.size || 0, src: assetUrl(linked), assetId: linked };
    } else {
      const type = clean(a.type, 60);
      const okSrc = src.startsWith("data:" + type + ";base64,") && src.length <= 4_600_000; // ~3.4 MB of file
      if (!allowedType(type, "viewer") || !okSrc) return json({ error: "attachment_must_be_png_jpg_or_pdf_under_3mb" }, 400);
      const bytes = Buffer.from(src.slice(src.indexOf(",") + 1), "base64");
      const id = await putAsset(files, bytes, { type, name: clean(a.name, 200) || "attachment" });
      assetFile = { name: clean(a.name, 200) || "attachment", type, size: bytes.length, src: assetUrl(id), assetId: id };
    }
  }
  const item = {
    id: "req" + Date.now().toString(36) + randomBytes(2).toString("hex"),
    date, time: "", channel: (plan.lists && plan.lists.channels && plan.lists.channels[0]) || "Brand Services",
    campaign: "", pillar, format: "", objective: clean(body.objective, 80), audience: "",
    title, copy: clean(body.copy, 6000), link: "", asset: clean(body.asset, 500),
    owner: "", approver: "",
    approverComments: "Requested by " + email + " on " + now.slice(0, 10) + (owner ? " · for " + owner : ""),
    status: "Submitted", organicPaid: "Organic", sensitive: false,
    impressions: null, engagements: null, engagementRate: null, clicks: null, followers: null,
    submittedBy: email, updatedAt: now
  };
  if (assetFile) item.assetFile = assetFile;
  plan.items.push(item);
  if (plan.lists && Array.isArray(plan.lists.statuses) && !plan.lists.statuses.includes("Submitted")) plan.lists.statuses.unshift("Submitted");
  const savedAt = now;
  const version = Date.now().toString(36) + randomBytes(3).toString("hex");
  if (hasEmbeddedFiles(plan)) await moveFilesOut(plan, assetStore()); // a calendar saved before files moved out
  const record = { plan: Object.assign({}, plan, { savedAt }), version, savedAt };
  const bytes = JSON.stringify(record.plan).length;
  if (bytes > PLAN_MAX) return json({ error: "calendar_full" }, 507);
  const summary = { savedAt, items: plan.items.length, pillars: (plan.pillars || []).length, bytes };
  await store.setJSON("plan", record, { metadata: summary });
  await store.setJSON("history/" + savedAt, record, { metadata: summary });
  return json({ ok: true, id: item.id });
};
