import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const BUCKET = process.env.SUPABASE_BUCKET || "photos";
const TABLE = process.env.SUPABASE_DB_TABLE || "photos";

if (!SUPABASE_URL || !KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in secrets.");
}

const supabase = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeSlug(s) {
  return String(s || "other")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "") || "other";
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

async function listApproved() {
  // 拉所有 approved；如果你的数据很多，后面可以做分页
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

async function main() {
  const approved = await listApproved();
  console.log(`approved rows: ${approved.length}`);

  ensureDir("assets");
  ensureDir("assets/full");

  const manifest = [];

  for (const row of approved) {
    const imagePath = row.image_path;
    if (!imagePath) continue;

    const year = guessYear(row);
    const categorySlug = safeSlug(row.category || "other"); // 你也可以改成 row.category_slug
    const ext = getExtFromPath(imagePath);

    // 输出文件名用 row.id 最稳（防重复）
    const outDir = path.join("assets", "full", year, categorySlug);
    ensureDir(outDir);
    const outFile = path.join(outDir, `${row.id}.${ext}`);

    // 如果已经存在就不重复下载
    if (!fs.existsSync(outFile)) {
      console.log(`download: ${imagePath} -> ${outFile}`);
      const buf = await downloadObject(imagePath);
      fs.writeFileSync(outFile, buf);
    } else {
      console.log(`skip existing: ${outFile}`);
    }

    // 写 manifest：前台只认这里
    manifest.push({
      id: row.id,
      year,
      category: row.category || "other",
      uploader_name: row.uploader_name || "",
      taken_at: row.taken_at || "",
      people: row.people || "",
      src: outFile.replace(/\\/g, "/"), // windows path -> url path
    });
  }

  // 按 year 降序、再按 taken_at 降序
  manifest.sort((a, b) => {
    if (a.year !== b.year) return String(b.year).localeCompare(String(a.year));
    return String(b.taken_at).localeCompare(String(a.taken_at));
  });

  fs.writeFileSync("assets/manifest.json", JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`wrote assets/manifest.json (${manifest.length} items)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
