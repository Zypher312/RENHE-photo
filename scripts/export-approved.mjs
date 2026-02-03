import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const BUCKET = (process.env.SUPABASE_BUCKET || "photos").trim();
const TABLE = (process.env.SUPABASE_DB_TABLE || "photos").trim();

if (!SUPABASE_URL || !KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in secrets.");
}

// ✅ 安全检查（不泄露 key 内容）
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

// ✅ 改：用 signed url + fetch 下载（比 storage.download 更稳）
async function downloadObjectSigned(image_path) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(image_path, 60); // 60 秒有效

  if (error) throw error;
  if (!data?.signedUrl) throw new Error("createSignedUrl returned empty signedUrl");

  const res = await fetch(data.signedUrl);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `fetch signedUrl failed: ${res.status} ${res.statusText} :: ${txt.slice(0, 200)}`
    );
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function main() {
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
      const buf = await downloadObjectSigned(imagePath);
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
