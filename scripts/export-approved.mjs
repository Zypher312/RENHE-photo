import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

/**
 * Env (required)
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Env (optional)
 * - SUPABASE_BUCKET (default: photos)
 * - SUPABASE_DB_TABLE (default: photos)
 *
 * Cleanup (optional)
 * - CLEANUP_MODE: none | db_only | db_and_storage
 * - CLEANUP_DRY_RUN: true/false (default: true)
 *
 * CLI:
 * - node scripts/export-approved.mjs                -> export only (default)
 * - node scripts/export-approved.mjs --cleanup      -> export then cleanup (optional)
 * - node scripts/export-approved.mjs --cleanup-only -> cleanup only (uses assets/manifest.json)
 */

const args = new Set(process.argv.slice(2));
const DO_CLEANUP = args.has("--cleanup") || args.has("--cleanup-only");
const CLEANUP_ONLY = args.has("--cleanup-only");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const BUCKET = (process.env.SUPABASE_BUCKET || "photos").trim();
const TABLE = (process.env.SUPABASE_DB_TABLE || "photos").trim();

function parseBool(v, defaultValue = false) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return defaultValue;
  return ["1", "true", "yes", "y", "on"].includes(s);
}

const CLEANUP_MODE = (process.env.CLEANUP_MODE || "none").trim().toLowerCase();
const CLEANUP_DRY_RUN = parseBool(process.env.CLEANUP_DRY_RUN, true); // 默认 dry-run 更安全

if (!SUPABASE_URL || !KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in secrets.");
}

// 安全打印（不泄露 key 内容）
console.log("[env] url=", SUPABASE_URL);
console.log("[env] bucket=", JSON.stringify(BUCKET), "table=", JSON.stringify(TABLE));
console.log("[env] key_len=", KEY.length, "has_newline=", KEY.includes("\n"));

const supabase = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeSlug(s) {
  return (
    String(s || "other")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/(^-|-$)/g, "") || "other"
  );
}

function guessYear(row) {
  if (row.year) return String(row.year);
  if (row.taken_at) {
    const d = new Date(row.taken_at);
    if (!Number.isNaN(d.getTime())) return String(d.getFullYear());
  }
  return "unknown";
}

function getExtFromPath(p) {
  const ext = path.extname(p || "").toLowerCase().replace(".", "");
  return ext || "jpg";
}

async function listApproved() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("id,image_path,uploader_name,taken_at,people,category,year,status,created_at")
    .eq("status", "approved")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

// 维持你原本的下载方式：storage.download
async function downloadObject(image_path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(image_path);
  if (error) throw error;
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

function readManifestSafe() {
  const p = "assets/manifest.json";
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isObjectNotFoundError(e) {
  const msg = String(e?.message || "").toLowerCase();
  const code = String(e?.statusCode || e?.status || "").toLowerCase();
  return msg.includes("not found") || msg.includes("object not found") || code === "404";
}

async function cleanupFromManifest() {
  if (!DO_CLEANUP) return;

  console.log("[cleanup] mode=", CLEANUP_MODE, "dry_run=", CLEANUP_DRY_RUN);

  const allowed = new Set(["none", "db_only", "db_and_storage"]);
  if (!allowed.has(CLEANUP_MODE)) {
    throw new Error(`Invalid CLEANUP_MODE="${CLEANUP_MODE}". Use: none | db_only | db_and_storage`);
  }
  if (CLEANUP_MODE === "none") {
    console.log("[cleanup] CLEANUP_MODE is 'none'. Skip cleanup.");
    return;
  }

  const manifest = readManifestSafe();
  if (!manifest.length) {
    console.log("[cleanup] manifest is empty. Skip cleanup.");
    return;
  }

  // 只清理“manifest里且本地确实存在文件”的条目（安全）
  const exported = manifest.filter((m) => m?.id && m?.src && fs.existsSync(m.src));
  const ids = [...new Set(exported.map((m) => String(m.id)))];

  console.log("[cleanup] manifest items=", manifest.length, "exported(existing files)=", ids.length);

  if (!ids.length) {
    console.log("[cleanup] No exported items found on disk. Skip cleanup.");
    return;
  }

  // 只处理 DB 里仍为 approved 的行
  const rows = [];
  for (const part of chunk(ids, 200)) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("id,image_path,status")
      .in("id", part)
      .eq("status", "approved");
    if (error) throw error;
    rows.push(...(data || []));
  }

  console.log("[cleanup] approved rows found in DB=", rows.length);
  if (!rows.length) {
    console.log("[cleanup] Nothing to cleanup in DB.");
    return;
  }

  const paths = rows.map((r) => (r.image_path || "").trim()).filter(Boolean);

  // 1) 删 Storage（可选）
  if (CLEANUP_MODE === "db_and_storage") {
    console.log("[cleanup] storage objects to remove=", paths.length);

    if (CLEANUP_DRY_RUN) {
      console.log("[cleanup] DRY_RUN=true, skip storage.remove()");
    } else {
      for (const part of chunk(paths, 100)) {
        try {
          const { error } = await supabase.storage.from(BUCKET).remove(part);
          if (error) {
            if (isObjectNotFoundError(error)) {
              console.log("[cleanup] storage: object not found (ignored)");
            } else {
              throw error;
            }
          }
        } catch (e) {
          if (isObjectNotFoundError(e)) {
            console.log("[cleanup] storage: object not found (ignored)");
          } else {
            throw e;
          }
        }
      }
      console.log("[cleanup] storage cleanup done.");
    }
  }

  // 2) 删 DB
  console.log("[cleanup] db rows to remove=", rows.length);

  if (CLEANUP_DRY_RUN) {
    console.log("[cleanup] DRY_RUN=true, skip DB delete()");
    return;
  }

  for (const part of chunk(rows.map((r) => r.id), 200)) {
    const { error } = await supabase.from(TABLE).delete().in("id", part);
    if (error) throw error;
  }

  console.log("[cleanup] db cleanup done.");
}

async function exportApproved() {
  const approved = await listApproved();
  console.log(`approved rows: ${approved.length}`);

  ensureDir("assets");
  ensureDir("assets/full");

  const manifest = [];

  for (const row of approved) {
    const imagePath = (row.image_path || "").trim();
    if (!imagePath) continue;

    const year = guessYear(row);
    const categorySlug = safeSlug(row.category || "other");
    const ext = getExtFromPath(imagePath);

    const outDir = path.join("assets", "full", year, categorySlug);
    ensureDir(outDir);
    const outFile = path.join(outDir, `${row.id}.${ext}`);

    if (!fs.existsSync(outFile)) {
      console.log(`download: ${imagePath} -> ${outFile}`);
      const buf = await downloadObject(imagePath);
      fs.writeFileSync(outFile, buf);
    } else {
      console.log(`skip existing: ${outFile}`);
    }

    manifest.push({
      id: row.id,
      year,
      category: row.category || "other",
      uploader_name: row.uploader_name || "",
      taken_at: row.taken_at || "",
      people: row.people || "",
      src: outFile.replace(/\\/g, "/"),
    });
  }

  manifest.sort((a, b) => {
    if (a.year !== b.year) return String(b.year).localeCompare(String(a.year));
    return String(b.taken_at).localeCompare(String(a.taken_at));
  });

  fs.writeFileSync("assets/manifest.json", JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`wrote assets/manifest.json (${manifest.length} items)`);
}

async function main() {
  if (!CLEANUP_ONLY) {
    await exportApproved();
  } else {
    console.log("[mode] cleanup-only (skip export)");
  }

  await cleanupFromManifest();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
