// Shared by the calendar's three services (plan, submit and asset).
//
// How the calendar is stored (Netlify Blobs):
//   store "linkedin-calendar"         plan            the live calendar: text only, never a file
//                                     history/<time>  a copy of every save
//                                     security/...    the sign-in log
//   store "linkedin-calendar-assets"  <id>            one attached file (image, PDF or video)
//                                     parts/<id>/<n>  a large upload on its way in, removed once it is whole
//
// A post points at its file with assetFile.src = "/api/asset/<id>". The id is the SHA-256 of the file,
// so the same file is only ever stored once. Files never travel inside the calendar: that is what
// keeps a save small however many files are attached.

import { getStore } from "@netlify/blobs";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ASSET_PATH = "/api/asset/";
export const ASSET_MAX = 15 * 1024 * 1024;         // largest single file an admin can attach
export const ASSET_MAX_VIEWER = 3.5 * 1024 * 1024; // largest file on a post request from the view-only calendar
export const PART_MAX = 3.2 * 1024 * 1024;         // largest slice of a file in one upload request (Netlify allows 4.5 MB of binary)
export const PLAN_MAX = 5_500_000;                 // largest calendar the save service takes (Netlify allows 6 MB per request)

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ "content-type": "application/json", "cache-control": "no-store" }, headers),
  });
}

export function env(name) {
  try { if (typeof Netlify !== "undefined" && Netlify.env) return Netlify.env.get(name); } catch (e) {}
  return process.env[name];
}

function samePassword(given, expected) {
  const a = createHash("sha256").update(String(given)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

// Which version a password opens: "admin", "viewer", or null
export function roleFor(given) {
  const admin = env("ADMIN_PASSWORD"), viewer = env("VIEWER_PASSWORD");
  if (!given) return null;
  if (admin && samePassword(given, admin)) return "admin";
  if (viewer && samePassword(given, viewer)) return "viewer";
  return null;
}

export function planStore() { return getStore({ name: "linkedin-calendar", consistency: "strong" }); }
export function assetStore() { return getStore({ name: "linkedin-calendar-assets", consistency: "strong" }); }

/* ---------- the file pass ----------
   <img>, <video> and the PDF viewer can't send the password header, so signing in also sets a cookie
   that only the asset service reads. It is derived from the two passwords, so changing either
   password in Netlify ends every pass at once. */
const PASS_COOKIE = "pbs_cal_files";
function passValue() {
  return createHmac("sha256", String(env("ADMIN_PASSWORD") || "") + "\n" + String(env("VIEWER_PASSWORD") || ""))
    .update("linkedin-calendar-file-pass-v1").digest("hex");
}
export function passCookie(clear) {
  return PASS_COOKIE + "=" + (clear ? "" : passValue()) + "; Path=/api/asset; HttpOnly; Secure; SameSite=Lax" + (clear ? "; Max-Age=0" : "");
}
export function hasPass(req) {
  const m = new RegExp("(?:^|;\\s*)" + PASS_COOKIE + "=([0-9a-f]{64})").exec(req.headers.get("cookie") || "");
  if (!m || !env("ADMIN_PASSWORD")) return false;
  return timingSafeEqual(Buffer.from(m[1]), Buffer.from(passValue()));
}

/* ---------- files ---------- */
// Netlify Blobs takes an ArrayBuffer, not a Node Buffer
export const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const validId = (id) => /^[0-9a-f]{64}$/.test(String(id || ""));
export const assetUrl = (id) => ASSET_PATH + id;
export function idFromSrc(src) {
  const m = /^\/api\/asset\/([0-9a-f]{64})$/.exec(String(src || ""));
  return m ? m[1] : null;
}
export function allowedType(type, role) {
  if (role === "admin") return /^(image\/[a-z0-9.+-]+|video\/(mp4|webm)|application\/pdf)$/.test(type);
  return /^(image\/(png|jpeg)|application\/pdf)$/.test(type);
}

// Store one file. Returns its id. Storing the same file twice is free: the second call finds it there.
export async function putAsset(store, bytes, { type, name }) {
  const id = sha256(bytes);
  const have = await store.getMetadata(id);
  if (!have) {
    await store.set(id, toArrayBuffer(bytes), { metadata: { type: String(type || "application/octet-stream").slice(0, 100), name: String(name || "file").slice(0, 200), size: bytes.length, added: new Date().toISOString() } });
  }
  return id;
}

// Move any file still embedded in a calendar ("data:..." in assetFile.src) into the asset store,
// leaving a link behind. Changes the plan in place. Returns how many files it moved.
// This is what brings an old, heavy calendar down to size, and what stops one growing again.
export async function moveFilesOut(plan, store) {
  let moved = 0;
  for (const it of (plan && plan.items) || []) {
    const af = it && it.assetFile;
    if (!af || typeof af.src !== "string" || !af.src.startsWith("data:")) continue;
    const m = /^data:([^;,]+)?((?:;[^;,]+)*?)(;base64)?,/.exec(af.src.slice(0, 200));
    if (!m) continue;
    const body = af.src.slice(m[0].length);
    let bytes;
    try { bytes = m[3] ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8"); } catch (e) { continue; }
    if (!bytes.length) continue;
    const type = (m[1] || af.type || "application/octet-stream").toLowerCase();
    const id = await putAsset(store, bytes, { type, name: af.name });
    it.assetFile = Object.assign({}, af, { src: assetUrl(id), type: af.type || type, size: bytes.length, assetId: id });
    moved++;
  }
  return moved;
}

export const hasEmbeddedFiles = (plan) =>
  ((plan && plan.items) || []).some((it) => it && it.assetFile && typeof it.assetFile.src === "string" && it.assetFile.src.startsWith("data:"));
