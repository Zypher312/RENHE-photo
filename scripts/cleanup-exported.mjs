import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || "photos";
const TABLE = process.env.SUPABASE_DB_TABLE || "photos";

const MODE = (process.env.CLEANUP_MODE || "none").trim(); // none/db_only/db_and_storage
const DRY = String(process.env.CLEANUP_DRY_RUN || "false").toLowerCase() === "true";

if (!SUPABASE_URL || !KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

if (MODE === "none") {
  console.log("cleanup: CLEANUP_MODE=none, skip");
  process.exit(0);
}

if (!fs.existsSync(".exported.json")) {
  console.log("cleanup: .exported.json not found, nothing to do");
  process.exit(0);
}

const exported = JSON.parse(fs.readFileSync(".exported.json", "utf-8") || "[]");
const items = (exported || []).filter(x => x?.id && x?.image_path);

if (items.length === 0) {
  console.log("cleanup: exported list empty, skip");
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// 安全：只允许删 uploads/ 下的对象（避免误删其他目录）
function safeObjectPath(p) {
  return typeof p === "string" && p.startsWith("uploads/");
}

async function main() {
  console.log(`cleanup: mode=${MODE} dry_run=${DRY} items=${items.length}`);

  const ids = items.map(x => x.id);
  const paths = items.map(x => x.image_path).filter(safeObjectPath);

  if (MODE === "db_and_storage") {
    console.log(`cleanup: storage paths eligible=${paths.length}/${items.length}`);
    for (const group of chunk(paths, 200)) {
      if (DRY) {
        console.log("[dry-run] would remove storage:", group);
        continue;
      }
      const { error } = await supabase.storage.from(BUCKET).remove(group);
      if (error) console.error("storage remove error:", error.message);
    }
  }

  if (MODE === "db_only" || MODE === "db_and_storage") {
    for (const group of chunk(ids, 200)) {
      if (DRY) {
        console.log("[dry-run] would delete rows:", group);
        continue;
      }
      const { error } = await supabase.from(TABLE).delete().in("id", group);
      if (error) console.error("db delete error:", error.message);
    }
  }

  console.log("cleanup: done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
