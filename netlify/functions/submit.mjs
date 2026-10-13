// Post requests from the view-only calendar.
// POST /api/submit -> { pillar, date, title, objective, asset, copy, email, owner, assetFile? }
// Adds the request to the shared calendar (Netlify Blobs) as a post with status "Submitted". No password needed; nothing else can be changed this way.

import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";

export const config = { path: "/api/submit" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: "bad_request" }, 400); }
  const title = clean(body.title, 200), email = clean(body.email, 200), pillar = clean(body.pillar, 60), date = clean(body.date, 10);
  if (!title || !email || !pillar || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "bad_request" }, 400);

  const store = getStore({ name: "linkedin-calendar", consistency: "strong" });
  const current = await store.get("plan", { type: "json" });
  if (!current || !current.plan || !Array.isArray(current.plan.items)) return json({ error: "calendar_not_initialised" }, 503);
  const plan = current.plan;
  if (!(plan.pillars || []).some(p => p.id === pillar)) return json({ error: "bad_request" }, 400);

  const now = new Date().toISOString();
  const owner = clean(body.owner, 40);
  let assetFile = null;
  if (body.assetFile && typeof body.assetFile === "object") {
    const a = body.assetFile, type = clean(a.type, 60), src = typeof a.src === "string" ? a.src : "";
    const okType = /^(image\/(png|jpeg)|application\/pdf)$/.test(type);
    const okSrc = src.startsWith("data:" + type + ";base64,") && src.length <= 4_600_000; // ~3.4 MB of file
    if (!okType || !okSrc) return json({ error: "attachment_must_be_png_jpg_or_pdf_under_3mb" }, 400);
    assetFile = { name: clean(a.name, 200) || "attachment", type, size: Number(a.size) || 0, src };
  }
  const item = {
    id: "req" + Date.now().toString(36) + randomBytes(2).toString("hex"),
    date, time: "", channel: (plan.lists && plan.lists.channels && plan.lists.channels[0]) || "Brand Services",
    campaign: "", pillar, format: "", objective: clean(body.objective, 80), audience: "",
    title, copy: clean(body.copy, 6000), link: "", asset: clean(body.asset, 500),
    owner: "", approver: /jodie/i.test(owner) ? "Jodie" : "John C",
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
  const record = { plan: Object.assign({}, plan, { savedAt }), version, savedAt };
  await store.setJSON("plan", record);
  await store.setJSON("history/" + savedAt, record);
  return json({ ok: true, id: item.id });
};
