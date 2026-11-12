// Save service for the LinkedIn content calendar. Same pattern as the Brand, Marketing, CRM and Sales Enablement Plan.
// POST /api/plan -> checks a password and says which version to show: { role: "viewer" | "admin" }
//                   Also sets the file pass, the cookie that lets the page show attached files (see asset.mjs).
// POST /api/plan?signout=1 -> clears the file pass
// GET  /api/plan  -> the latest saved plan (team or admin password required)
// GET  /api/plan?history=1 / ?restore=<key> -> earlier saves (admin password required)
// PUT  /api/plan  -> saves a new version of the plan (admin password required)
//
// Passwords are set in Netlify: Site configuration > Environment variables
//   VIEWER_PASSWORD  the wider team: view the calendar and send post requests
//   ADMIN_PASSWORD   the admin team: everything above, plus edit, save, restore and export
// The password is sent in the x-password header (x-admin-password is still accepted).
// Calendars are stored in Netlify Blobs. Every save is also kept in history/ as a backup.
//
// Size: the calendar holds text only. Attached files are stored one by one by the asset service and
// the calendar keeps a link to each. A calendar that still carries embedded files (saved before this
// change, or sent by a browser with an old copy of the page) has them moved out here, on the way in
// and on the way out, so nobody has to do anything to migrate.
//
// History: every save for the last 30 days is kept. Older than that, the last save of each day is kept.
//
// Security: every sign-in attempt (POST) is logged with time, IP address and outcome,
// to the function log and to the store under security/ (newest 500 kept).
// GET /api/plan?security=1 (admin password required) returns the newest 100 entries.

import { randomBytes } from "node:crypto";
import {
  json, env, roleFor, planStore, assetStore, passCookie, moveFilesOut, hasEmbeddedFiles, PLAN_MAX,
} from "../lib/shared.mjs";

export const config = { path: "/api/plan" };

const KEEP_ALL_DAYS = 30; // every save is kept this long; after that, one a day

function validPlan(p) {
  return p && typeof p === "object"
    && Array.isArray(p.pillars) && Array.isArray(p.items);
}

// Record one sign-in attempt: when, from which IP address, and the outcome
async function logSignIn(store, req, context, role) {
  try {
    const when = new Date().toISOString();
    const ip = (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "unknown";
    const entry = { when, ip, outcome: role || "wrong_password", agent: (req.headers.get("user-agent") || "").slice(0, 200) };
    console.log("sign-in", JSON.stringify(entry));
    await store.setJSON("security/" + when + "-" + randomBytes(2).toString("hex"), entry);
    // Keep only the newest 500 entries
    const { blobs } = await store.list({ prefix: "security/" });
    const keys = blobs.map(b => b.key).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 500))) await store.delete(k);
  } catch (e) { console.log("sign-in log failed", e && e.message); }
}

const summary = (record, bytes) => ({ savedAt: record.savedAt, items: (record.plan.items || []).length, pillars: (record.plan.pillars || []).length, bytes });

// Once a day, thin out old history: beyond KEEP_ALL_DAYS keep only the last save of each day.
// Never touches the live calendar or any attached file, and never fails a save.
async function thinHistory(store) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const last = await store.get("meta/history-thinned");
    if (last === today) return;
    await store.set("meta/history-thinned", today);
    const cutoff = new Date(Date.now() - KEEP_ALL_DAYS * 864e5).toISOString();
    const { blobs } = await store.list({ prefix: "history/" });
    const old = blobs.map(b => b.key).filter(k => /^history\/\d{4}-\d{2}-\d{2}T/.test(k) && k.slice(8) < cutoff).sort();
    const lastOfDay = new Map(); // day -> newest key that day
    for (const k of old) lastOfDay.set(k.slice(8, 18), k);
    const keep = new Set(lastOfDay.values());
    let removed = 0;
    for (const k of old) { if (keep.has(k)) continue; await store.delete(k); if (++removed >= 400) break; }
    if (removed) console.log("history thinned", removed);
  } catch (e) { console.log("history thinning failed", e && e.message); }
}

export default async (req, context) => {
  const store = planStore();

  const url = new URL(req.url);
  const wantsHistory = url.searchParams.has("history"), restoreKey = url.searchParams.get("restore");
  const wantsSecurity = url.searchParams.has("security");
  if (!env("ADMIN_PASSWORD")) return json({ error: "not_configured" }, 503);
  const role = roleFor(req.headers.get("x-password") || req.headers.get("x-admin-password") || "");

  if (req.method === "POST") {
    // Sign out: take the file pass back
    if (url.searchParams.has("signout")) return json({ ok: true }, 200, { "set-cookie": passCookie(true) });
    // Sign in: log the attempt, then tell the page which version to show
    await logSignIn(store, req, context, role);
    return role ? json({ ok: true, role }, 200, { "set-cookie": passCookie(false) }) : json({ error: "wrong_password" }, 401);
  }

  // Reading the calendar needs the team or admin password
  if (req.method === "GET" && !wantsHistory && !restoreKey && !wantsSecurity) {
    if (!role) return json({ error: "sign_in_required" }, 401);
    let rec = await store.get("plan", { type: "json" });
    if (!rec) return json({ plan: null, version: null }, 200, { "set-cookie": passCookie(false) });
    if (hasEmbeddedFiles(rec.plan)) {
      // A calendar saved before files moved out. Move them now, and keep the same version and save
      // time so nobody's unsaved work is treated as out of date.
      try {
        await moveFilesOut(rec.plan, assetStore());
        const now = await store.get("plan", { type: "json" });
        if (now && now.version === rec.version) await store.setJSON("plan", rec, { metadata: summary(rec, JSON.stringify(rec.plan).length) });
        else if (now) rec = now;
      } catch (e) { console.log("moving files out failed", e && e.message); }
    }
    const bytes = JSON.stringify(rec.plan).length;
    return json({ plan: rec.plan, version: rec.version, savedAt: rec.savedAt, bytes, limit: PLAN_MAX }, 200, { "set-cookie": passCookie(false) });
  }

  // Everything else needs the admin password
  if (role !== "admin") return json({ error: "wrong_password" }, 401);

  // Admin only: the sign-in log, newest first
  if (req.method === "GET" && wantsSecurity) {
    const { blobs } = await store.list({ prefix: "security/" });
    const keys = blobs.map(b => b.key).sort().reverse().slice(0, 100);
    const events = [];
    for (const key of keys) { const rec = await store.get(key, { type: "json" }); if (rec) events.push(rec); }
    return json({ events });
  }

  // Admin only: list earlier saves, newest first, or fetch one to restore
  if (req.method === "GET" && wantsHistory) {
    const { blobs } = await store.list({ prefix: "history/" });
    const keys = blobs.map(b => b.key).sort().reverse().slice(0, 40);
    const saves = [];
    const started = Date.now();
    for (const key of keys) {
      // Saves made since files moved out carry a summary, so listing them doesn't mean reading each one
      const info = await store.getMetadata(key);
      const m = info && info.metadata;
      if (m && m.savedAt) { saves.push({ key, savedAt: m.savedAt, pillars: m.pillars, items: m.items }); continue; }
      // Older saves can be several MB each: read them while there's time, then fall back to the date in the key
      if (Date.now() - started < 20000) {
        const rec = await store.get(key, { type: "json" });
        if (rec && rec.plan) { saves.push({ key, savedAt: rec.savedAt, pillars: (rec.plan.pillars || []).length, items: (rec.plan.items || []).length }); continue; }
      }
      saves.push({ key, savedAt: key.slice(8), pillars: null, items: null });
    }
    return json({ saves });
  }
  if (req.method === "GET" && restoreKey) {
    if (!restoreKey.startsWith("history/")) return json({ error: "bad_request" }, 400);
    const rec = await store.get(restoreKey, { type: "json" });
    if (!rec) return json({ error: "not_found" }, 404);
    // An old save may still carry embedded files: hand it back with links instead
    if (hasEmbeddedFiles(rec.plan)) { try { await moveFilesOut(rec.plan, assetStore()); } catch (e) {} }
    return json({ plan: rec.plan, savedAt: rec.savedAt });
  }

  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > PLAN_MAX) return json({ error: "too_large", bytes: text.length, limit: PLAN_MAX }, 413);
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
    // Files never go into the stored calendar, whatever the browser sent
    let moved = 0;
    if (hasEmbeddedFiles(plan)) moved = await moveFilesOut(plan, assetStore());
    const record = { plan, version, savedAt };
    const bytes = JSON.stringify(plan).length;
    await store.setJSON("plan", record, { metadata: summary(record, bytes) });
    await store.setJSON("history/" + savedAt, record, { metadata: summary(record, bytes) });
    await thinHistory(store);
    // When files were moved here, send the slimmed calendar back so the page can swap its copy
    return json(Object.assign({ ok: true, version, savedAt, bytes, limit: PLAN_MAX }, moved ? { moved, plan } : {}));
  }

  return json({ error: "method_not_allowed" }, 405);
};
