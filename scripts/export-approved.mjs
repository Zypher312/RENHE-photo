import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || "photos";
const TABLE = process.env.SUPABASE_DB_TABLE || "photos";

const CLEANUP_MODE = String(process.env.CLEANUP_MODE || "none").trim().toLowerCase();
const ARGS = new Set(process.argv.slice(2));
const CLEANUP_ONLY = ARGS.has("--cleanup");

// 仅当你显式把 CLEANUP_MODE 设为 db_only / db_and_storage 才会触发清理
const cleanupDB = CLEANUP_MODE === "db_only" || CLEANUP_MODE === "db_and_storage";
const cleanupStorage = CLEANUP_MODE === "db_and_storage";

if (!SUPABASE_URL || !KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in secrets.");
}

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
  if (ext) return ext;
  return "jpg";
}

function readJsonIfExists(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

async function downloadObject(image_path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(image_path);
  if (error) throw error;
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

async function removeStorageObjects(paths) {
  // Supabase remove 有时遇到不存在会整批报错，所以做“先批量，失败则逐个”的容错
  const unique = Array.from(new Set(paths.filter(Boolean)));

  for (const batch of chunk(unique, 100)) {
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (!error) {
      console.log(`[cleanup] removed ${batch.length} storage objects (batch)`);
      continue;
    }

    // 如果批量失败（常见是夹杂 404），改为逐个删除，404 忽略
    console.log(`[cleanup] batch remove failed, fallback to single removes. reason: ${error.message || error}`);

    for (const p of batch) {
      const { error: e2 } = await supabase.storage.from(BUCKET).remove([p]);
      if (!e2) {
        console.log(`[cleanup] removed: ${p}`);
        continue;
      }
      const code = e2.statusCode || e2.status || "";
      const msg = String(e2.message || e2);
      if (code === 404 || msg.toLowerCase().includes("not found")) {
        console.log(`[cleanup] already missing (ignore): ${p}`);
        continue;
      }
      throw e2;
    }
  }
}

async function deleteDbRows(ids) {
  const unique = Array.from(new Set(ids.filter(Boolean)));

  for (const batch of chunk(unique, 200)) {
    const { error } = await supabase.from(TABLE).delete().in("id", batch);
    if (error) throw error;
    console.log(`[cleanup] deleted ${batch.length} db rows (batch)`);
  }
}

async function exportApproved() {
  // 你之前加过的安全日志：不泄露 key，只打印长度/是否有换行
  console.log(`[env] url=${SUPABASE_URL ? "***" : ""}`);
  console.log(`[env] bucket="${BUCKET}" table="${TABLE}"`);
  console.log(`[env] key_len=${KEY?.length || 0} has_newline=${/\r|\n/.test(KEY || "")}`);

  const approved = await listApproved();
  console.log(`approved rows: ${approved.length}`);

  ensureDir("assets");
  ensureDir("assets/full");
  ensureDir(".tmp");

  // ✅ 只有在你开启“会删 DB”的模式下，才需要“保留旧 manifest”
  // 否则保持你原来的行为：manifest = 仅来自当前 DB 的 approved
  const keepOldManifest = cleanupDB;

  let manifest = [];
  if (keepOldManifest) {
    const existing = readJsonIfExists("assets/manifest.json");
    if (Array.isArray(existing)) manifest = existing;
  }

  const manifestMap = new Map();
  for (const item of manifest) {
    if (item && item.id) manifestMap.set(item.id, item);
  }

  const exported = [];

  for (const row of approved) {
    const imagePath = row.image_path;
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

    const entry = {
      id: row.id,
      year,
      category: row.category || "other",
      uploader_name: row.uploader_name || "",
      taken_at: row.taken_at || "",
      people: row.people || "",
      src: outFile.replace(/\\/g, "/"),
    };

    manifestMap.set(entry.id, entry);
    exported.push({ id: row.id, image_path: imagePath });
  }

  const nextManifest = Array.from(manifestMap.values());

  nextManifest.sort((a, b) => {
    if (a.year !== b.year) return String(b.year).localeCompare(String(a.year));
    return String(b.taken_at).localeCompare(String(a.taken_at));
  });

  fs.writeFileSync("assets/manifest.json", JSON.stringify(nextManifest, null, 2), "utf-8");
  console.log(`wrote assets/manifest.json (${nextManifest.length} items)`);

  // ✅ 给后续 cleanup step 用（不进 git）
  fs.writeFileSync(".tmp/exported.json", JSON.stringify(exported, null, 2), "utf-8");
  console.log(`[tmp] wrote .tmp/exported.json (${exported.length} items)`);

  if (cleanupDB || cleanupStorage) {
    console.log(`[notice] CLEANUP_MODE=${CLEANUP_MODE} -> will cleanup after git push.`);
  } else {
    console.log(`[notice] CLEANUP_MODE=${CLEANUP_MODE} -> no cleanup.`);
  }
}

async function cleanupAfterPush() {
  console.log(`[cleanup] mode=${CLEANUP_MODE}`);

  if (!cleanupDB && !cleanupStorage) {
    console.log("[cleanup] CLEANUP_MODE=none (or empty). Skip cleanup.");
    return;
  }

  const exported = readJsonIfExists(".tmp/exported.json");
  if (!Array.isArray(exported) || exported.length === 0) {
    console.log("[cleanup] no exported items found. Skip cleanup.");
    return;
  }

  const ids = exported.map((x) => x?.id).filter(Boolean);
  const paths = exported.map((x) => x?.image_path).filter(Boolean);

  console.log(`[cleanup] exported items: ids=${ids.length} paths=${paths.length}`);

  // 先删 Storage（更占空间），再删 DB
  if (cleanupStorage) {
    console.log("[cleanup] removing storage objects...");
    await removeStorageObjects(paths);
  }

  if (cleanupDB) {
    console.log("[cleanup] deleting db rows...");
    await deleteDbRows(ids);
  }

  console.log("[cleanup] done.");
}

async function main() {
  if (CLEANUP_ONLY) {
    await cleanupAfterPush();
    return;
  }
  await exportApproved();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
