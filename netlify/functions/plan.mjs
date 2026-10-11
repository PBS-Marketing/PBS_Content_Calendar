// Save service for the LinkedIn content calendar. Same pattern as the Brand, Marketing, CRM and Sales Enablement Plan.
// GET  /api/plan  -> the latest saved plan (anyone can read)
// GET  /api/plan?history=1 / ?restore=<key> -> earlier saves (admin password required)
// POST /api/plan  -> checks the admin password (used by the sign-in box)
// PUT  /api/plan  -> saves a new version of the plan (admin password required)
//
// The admin password is set in Netlify: Site configuration > Environment variables > ADMIN_PASSWORD
// Calendars are stored in Netlify Blobs. Every save is also kept in history/ as a backup.

import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";

export const config = { path: "/api/plan" };

const MAX_BYTES = 5_500_000; // posts can carry embedded images

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function env(name) {
  try { if (typeof Netlify !== "undefined" && Netlify.env) return Netlify.env.get(name); } catch (e) {}
  return process.env[name];
}

function samePassword(given, expected) {
  const a = createHash("sha256").update(String(given)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function validPlan(p) {
  return p && typeof p === "object"
    && Array.isArray(p.pillars) && Array.isArray(p.items);
}

export default async (req) => {
  const store = getStore({ name: "linkedin-calendar", consistency: "strong" });

  const url = new URL(req.url);
  const wantsHistory = url.searchParams.has("history"), restoreKey = url.searchParams.get("restore");

  if (req.method === "GET" && !wantsHistory && !restoreKey) {
    const rec = await store.get("plan", { type: "json" });
    return json(rec ? { plan: rec.plan, version: rec.version, savedAt: rec.savedAt } : { plan: null, version: null });
  }

  const expected = env("ADMIN_PASSWORD");
  if (!expected) return json({ error: "not_configured" }, 503);
  if (!samePassword(req.headers.get("x-admin-password") || "", expected)) return json({ error: "wrong_password" }, 401);

  // Admin only: list earlier saves, newest first, or fetch one to restore
  if (req.method === "GET" && wantsHistory) {
    const { blobs } = await store.list({ prefix: "history/" });
    const keys = blobs.map(b => b.key).sort().reverse().slice(0, 40);
    const saves = [];
    for (const key of keys) {
      const rec = await store.get(key, { type: "json" });
      if (rec && rec.plan) saves.push({ key, savedAt: rec.savedAt, pillars: (rec.plan.pillars || []).length, items: (rec.plan.items || []).length });
    }
    return json({ saves });
  }
  if (req.method === "GET" && restoreKey) {
    if (!restoreKey.startsWith("history/")) return json({ error: "bad_request" }, 400);
    const rec = await store.get(restoreKey, { type: "json" });
    return rec ? json({ plan: rec.plan, savedAt: rec.savedAt }) : json({ error: "not_found" }, 404);
  }

  if (req.method === "POST") return json({ ok: true });

  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: "too_large" }, 413);
    let body;
    try { body = JSON.parse(text); } catch (e) { return json({ error: "bad_request" }, 400); }
    if (!validPlan(body.plan)) return json({ error: "bad_request" }, 400);

    const current = await store.get("plan", { type: "json" });
    if (current && body.baseVersion !== current.version) {
      return json({ error: "conflict", version: current.version }, 409);
    }
    const savedAt = new Date().toISOString();
    const version = Date.now().toString(36) + randomBytes(3).toString("hex");
    const plan = Object.assign({}, body.plan, { savedAt }); delete plan.basedOn;
    const record = { plan, version, savedAt };
    await store.setJSON("plan", record);
    await store.setJSON("history/" + savedAt, record);
    return json({ ok: true, version, savedAt });
  }

  return json({ error: "method_not_allowed" }, 405);
};
