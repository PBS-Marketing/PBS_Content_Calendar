// File service for the LinkedIn content calendar: the images, PDFs and videos attached to posts.
// Files live on their own in Netlify Blobs, never inside the calendar, so the calendar stays small.
//
// GET  /api/asset/<id>          -> the file. Needs the file pass (a cookie set at sign-in) or the password header.
//                                  Answers Range requests, so video plays and seeks, and PDFs load page by page.
// GET  /api/asset/<id>?meta=1   -> { exists, size, type }: lets the page skip an upload the store already has
// PUT  /api/asset/<id>?part=0&parts=1   body = the file (or one slice of it)
//                                  Headers: x-password, x-asset-type, x-asset-name (URI-encoded)
//                                  <id> is the SHA-256 of the whole file; the service checks it.
//                                  Files over 3 MB are sent in slices (part 0..parts-1, in order) and joined here.
//
// Who can upload: Admin, images, PDFs and MP4/WebM video up to 15 MB.
//                 Team (post requests), PNG, JPG or PDF up to 3.5 MB.

import {
  json, env, roleFor, hasPass, assetStore, sha256, validId, assetUrl, allowedType, toArrayBuffer,
  ASSET_MAX, ASSET_MAX_VIEWER, PART_MAX,
} from "../lib/shared.mjs";

export const config = { path: "/api/asset/:id" };

const RANGE_STEP = 4 * 1024 * 1024; // most of a file sent in answer to one Range request
const MAX_PARTS = Math.ceil(ASSET_MAX / (1024 * 1024)); // slices can be as small as 1 MB

function streamOf(bytes) {
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

export default async (req, context) => {
  if (!env("ADMIN_PASSWORD")) return json({ error: "not_configured" }, 503);
  const url = new URL(req.url);
  const id = (context && context.params && context.params.id) || url.pathname.split("/").filter(Boolean)[2] || "";
  if (!validId(id)) return json({ error: "bad_request" }, 400);
  const role = roleFor(req.headers.get("x-password") || req.headers.get("x-admin-password") || "");
  const store = assetStore();

  if (req.method === "GET" || req.method === "HEAD") {
    if (!role && !hasPass(req)) return json({ error: "sign_in_required" }, 401);
    const info = await store.getMetadata(id);
    if (url.searchParams.has("meta")) {
      return info ? json({ exists: true, size: info.metadata.size || 0, type: info.metadata.type || "" }) : json({ exists: false });
    }
    if (!info) return json({ error: "not_found" }, 404);
    const meta = info.metadata || {};
    const type = meta.type || "application/octet-stream";
    const headers = {
      "content-type": type,
      "accept-ranges": "bytes",
      // The id is the file's own hash, so a given address can never change: the browser can keep it for good.
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline; filename*=UTF-8''" + encodeURIComponent(meta.name || "file"),
    };
    // Anything that isn't a PDF is only ever shown inside the calendar page, so lock it down if opened directly.
    if (type !== "application/pdf") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

    const total = Number(meta.size) || 0;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
    if (range && total && (range[1] || range[2])) {
      let start, end;
      if (range[1] === "") { start = Math.max(0, total - Number(range[2])); end = total - 1; }
      else { start = Number(range[1]); end = range[2] === "" ? total - 1 : Math.min(Number(range[2]), total - 1); }
      if (start >= total || start > end) return new Response(null, { status: 416, headers: { "content-range": "bytes */" + total } });
      end = Math.min(end, start + RANGE_STEP - 1);
      headers["content-range"] = "bytes " + start + "-" + end + "/" + total;
      headers["content-length"] = String(end - start + 1);
      if (req.method === "HEAD") return new Response(null, { status: 206, headers });
      const buf = await store.get(id, { type: "arrayBuffer" });
      if (!buf) return json({ error: "not_found" }, 404);
      return new Response(streamOf(new Uint8Array(buf, start, end - start + 1)), { status: 206, headers });
    }
    if (total) headers["content-length"] = String(total);
    if (req.method === "HEAD") return new Response(null, { status: 200, headers });
    const body = await store.get(id, { type: "stream" });
    if (!body) return json({ error: "not_found" }, 404);
    return new Response(body, { status: 200, headers });
  }

  if (req.method === "PUT") {
    if (!role) return json({ error: "sign_in_required" }, 401);
    const type = String(req.headers.get("x-asset-type") || "").toLowerCase().slice(0, 100);
    let name = "file"; try { name = decodeURIComponent(req.headers.get("x-asset-name") || "file").slice(0, 200); } catch (e) {}
    if (!allowedType(type, role)) return json({ error: "unsupported_type" }, 415);
    const max = role === "admin" ? ASSET_MAX : ASSET_MAX_VIEWER;
    const part = Number(url.searchParams.get("part") || 0), parts = Number(url.searchParams.get("parts") || 1);
    if (!Number.isInteger(part) || !Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS || part < 0 || part >= parts) return json({ error: "bad_request" }, 400);

    const have = await store.getMetadata(id);
    if (have) return json({ ok: true, id, src: assetUrl(id), size: have.metadata.size || 0, existed: true });

    const chunk = Buffer.from(await req.arrayBuffer());
    if (!chunk.length) return json({ error: "bad_request" }, 400);
    if (chunk.length > PART_MAX) return json({ error: "part_too_large" }, 413);

    let bytes = chunk;
    if (parts > 1) {
      if (part < parts - 1) { await store.set("parts/" + id + "/" + part, toArrayBuffer(chunk)); return json({ ok: true, part }); }
      // Last slice: join the file back together
      const pieces = []; let size = chunk.length;
      for (let i = 0; i < parts - 1; i++) {
        const p = await store.get("parts/" + id + "/" + i, { type: "arrayBuffer" });
        if (!p) return json({ error: "missing_part", part: i }, 409);
        size += p.byteLength; if (size > max) break;
        pieces.push(Buffer.from(p));
      }
      if (size <= max) { pieces.push(chunk); bytes = Buffer.concat(pieces); }
      for (let i = 0; i < parts - 1; i++) { try { await store.delete("parts/" + id + "/" + i); } catch (e) {} }
      if (size > max) return json({ error: "too_large", max }, 413);
    }
    if (bytes.length > max) return json({ error: "too_large", max }, 413);
    if (sha256(bytes) !== id) return json({ error: "checksum_mismatch" }, 400);
    await store.set(id, toArrayBuffer(bytes), { metadata: { type, name, size: bytes.length, added: new Date().toISOString() } });
    return json({ ok: true, id, src: assetUrl(id), size: bytes.length });
  }

  return json({ error: "method_not_allowed" }, 405);
};
