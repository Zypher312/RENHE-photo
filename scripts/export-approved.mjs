import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// =====================
// Config / Env
// =====================
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const BUCKET = (process.env.SUPABASE_BUCKET || 'photos').trim();
const TABLE = (process.env.SUPABASE_DB_TABLE || 'photos').trim();

// Cleanup controls (optional)
const CLEANUP_MODE = (process.env.CLEANUP_MODE || '').trim().toLowerCase(); // none|table|storage|both
const CLEANUP_DRY_RUN = (() => {
  const v = String(process.env.CLEANUP_DRY_RUN || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'y';
})();

const ARGS = new Set(process.argv.slice(2));
const DO_CLEANUP_ONLY = ARGS.has('--cleanup-only');
const DO_CLEANUP = ARGS.has('--cleanup') || DO_CLEANUP_ONLY;
const DO_EXPORT = !DO_CLEANUP_ONLY;
const DO_REBUILD_MANIFEST = ARGS.has('--rebuild-manifest') || DO_EXPORT;

// Repo paths
const ASSETS_FULL_DIR = path.join('assets', 'full');
const ASSETS_META_DIR = path.join('assets', 'meta');
const MANIFEST_PATH = path.join('assets', 'manifest.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function ensureDirForFile(filePath) {
  ensureDir(path.dirname(filePath));
}

function safeSlug(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'other';
}

function inferYear(row) {
  if (row?.year) return row.year;
  if (row?.taken_at) return new Date(row.taken_at).getFullYear();
  return new Date().getFullYear();
}

function getExtFromPath(p) {
  const ext = path.extname(p || '').toLowerCase().replace('.', '');
  return ext || 'jpg';
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const txt = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, obj) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    const items = fs.readdirSync(cur, { withFileTypes: true });
    for (const it of items) {
      const full = path.join(cur, it.name);
      if (it.isDirectory()) stack.push(full);
      else if (it.isFile()) out.push(full);
    }
  }
  return out;
}

function buildDestForRow(row) {
  const year = String(inferYear(row));
  const categorySlug = safeSlug(row?.category || 'other');
  const ext = getExtFromPath(row?.image_path);
  const dest = path.join(ASSETS_FULL_DIR, year, categorySlug, `${row.id}.${ext}`);
  const destRel = toPosix(dest);
  return { year, categorySlug, ext, dest, destRel };
}

function parseAssetPath(filePath) {
  // filePath like: assets/full/<year>/<categorySlug>/<id>.<ext>
  const rel = toPosix(filePath);
  const parts = rel.split('/');
  const fullIdx = parts.indexOf('full');
  const year = parts[fullIdx + 1] || '';
  const categorySlug = parts[fullIdx + 2] || 'other';
  const filename = parts[parts.length - 1] || '';
  const id = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;
  return { id, year, categorySlug, rel };
}

function rebuildManifestFromAssets() {
  ensureDir(ASSETS_META_DIR);

  const oldManifest = readJson(MANIFEST_PATH, []);
  const oldOrder = Array.isArray(oldManifest) ? oldManifest.map(x => x?.id).filter(Boolean) : [];
  const oldById = new Map();
  if (Array.isArray(oldManifest)) {
    for (const item of oldManifest) {
      if (item?.id) oldById.set(item.id, item);
    }
  }

  // Scan assets/full for all images
  const files = walkFiles(ASSETS_FULL_DIR);
  const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  const byId = new Map();

  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!allowed.has(ext)) continue;

    const { id, year, categorySlug, rel } = parseAssetPath(f);
    if (!id) continue;

    const metaPath = path.join(ASSETS_META_DIR, `${id}.json`);
    const meta = readJson(metaPath, null);

    const base = oldById.get(id) || {};
    const entry = {
      id,
      year: String((meta && meta.year) || year || base.year || ''),
      category: (meta && meta.category) || base.category || categorySlug || 'other',
      uploader_name: (meta && meta.uploader_name) || base.uploader_name || '',
      taken_at: (meta && meta.taken_at) || base.taken_at || '',
      people: (meta && meta.people) || base.people || '',
      src: (meta && meta.src) || base.src || rel,
    };

    // 以 assets/full 扫描到的路径为准（避免 meta/src 老了）
    entry.src = rel;

    byId.set(id, entry);
  }

  // Keep old order first, then append new ones (stable output)
  const result = [];
  const used = new Set();

  for (const id of oldOrder) {
    if (byId.has(id)) {
      result.push(byId.get(id));
      used.add(id);
    }
  }

  const rest = [];
  for (const [id, entry] of byId.entries()) {
    if (!used.has(id)) rest.push(entry);
  }

  // Deterministic append order
  rest.sort((a, b) => {
    const ay = Number(a.year) || 0;
    const by = Number(b.year) || 0;
    if (ay !== by) return by - ay; // newer year first
    const ac = String(a.category || '');
    const bc = String(b.category || '');
    if (ac !== bc) return ac.localeCompare(bc, 'zh-Hans-CN');
    return String(a.id).localeCompare(String(b.id));
  });

  result.push(...rest);

  ensureDirForFile(MANIFEST_PATH);
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log(`[manifest] rebuilt from assets/full: ${result.length} items -> ${MANIFEST_PATH}`);
}

// =====================
// Supabase helpers
// =====================
function mustHaveSupabase() {
  if (!SUPABASE_URL || !KEY) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
}

function createSupabaseClient() {
  // service_role key: no need to persist session
  return createClient(SUPABASE_URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function listApproved(supabase) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id,image_path,uploader_name,taken_at,people,category,year,status')
    .eq('status', 'approved')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function downloadObjectSigned(supabase, objectPath) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(objectPath, 60);
  if (error) throw error;

  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

async function cleanupApprovedFromSupabase(supabase) {
  const mode = (CLEANUP_MODE || '').trim().toLowerCase();
  if (!mode || mode === 'none') {
    console.log('[cleanup] CLEANUP_MODE is empty/none. Skip cleanup.');
    return;
  }
  if (!['table', 'storage', 'both'].includes(mode)) {
    console.log(`[cleanup] Invalid CLEANUP_MODE="${mode}". Use: none|table|storage|both. Skip cleanup.`);
    return;
  }

  const approved = await listApproved(supabase);
  if (!approved.length) {
    console.log('[cleanup] No approved rows. Nothing to do.');
    return;
  }

  let candidates = 0;
  let storageDeleted = 0;
  let tableDeleted = 0;

  for (const row of approved) {
    const { dest } = buildDestForRow(row);
    if (!fs.existsSync(dest)) continue; // not exported into repo yet

    candidates += 1;

    const objectPath = row.image_path;
    if (!objectPath) {
      console.log(`[cleanup] id=${row.id} missing image_path, skip storage delete.`);
    }

    if (CLEANUP_DRY_RUN) {
      console.log(`[cleanup][dry-run] would delete: id=${row.id} mode=${mode} storagePath=${objectPath || '(none)'}`);
      continue;
    }

    // 1) storage
    if ((mode === 'storage' || mode === 'both') && objectPath) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([objectPath]);
      if (rmErr) {
        console.log(`[cleanup][storage] FAILED id=${row.id} path=${objectPath} err=${rmErr.message}`);
      } else {
        storageDeleted += 1;
        console.log(`[cleanup][storage] OK id=${row.id} path=${objectPath}`);
      }
    }

    // 2) table
    if (mode === 'table' || mode === 'both') {
      const { error: delErr } = await supabase.from(TABLE).delete().eq('id', row.id);
      if (delErr) {
        console.log(`[cleanup][table] FAILED id=${row.id} err=${delErr.message}`);
      } else {
        tableDeleted += 1;
        console.log(`[cleanup][table] OK id=${row.id}`);
      }
    }
  }

  console.log(
    `[cleanup] candidates=${candidates}, storageDeleted=${storageDeleted}, tableDeleted=${tableDeleted}, dryRun=${CLEANUP_DRY_RUN}`
  );
}

// =====================
// Main
// =====================
async function main() {
  // Always ensure folders (manifest can be rebuilt without Supabase)
  ensureDir(ASSETS_FULL_DIR);
  ensureDir(ASSETS_META_DIR);
  ensureDirForFile(MANIFEST_PATH);

  // 1) Export (from Supabase) -> assets/full + assets/meta
  if (DO_EXPORT) {
    mustHaveSupabase();
    const supabase = createSupabaseClient();

    const approved = await listApproved(supabase);
    console.log(`Found ${approved.length} approved photos`);

    for (const row of approved) {
      if (!row?.id) continue;
      if (!row?.image_path) {
        console.log(`Skip id=${row.id}: missing image_path`);
        continue;
      }

      const { year, categorySlug, dest, destRel } = buildDestForRow(row);

      // Always write/update meta (even if file already exists)
      const metaPath = path.join(ASSETS_META_DIR, `${row.id}.json`);
      const meta = {
        id: row.id,
        year: String(year),
        category: row.category || categorySlug || 'other',
        category_slug: categorySlug,
        uploader_name: row.uploader_name || '',
        taken_at: row.taken_at || '',
        people: row.people || '',
        src: destRel,
        source_image_path: row.image_path || '',
      };
      writeJson(metaPath, meta);

      // Download only if not exists
      if (fs.existsSync(dest)) {
        console.log(`Skip existing file: ${destRel}`);
        continue;
      }

      console.log(`Downloading ${row.image_path} -> ${destRel}`);
      ensureDirForFile(dest);
      const buf = await downloadObjectSigned(supabase, row.image_path);
      fs.writeFileSync(dest, buf);
    }
  }

  // 2) Rebuild manifest from assets/full (+ assets/meta)
  if (DO_REBUILD_MANIFEST) {
    rebuildManifestFromAssets();
  }

  // 3) Cleanup (optional)
  if (DO_CLEANUP) {
    mustHaveSupabase();
    const supabase = createSupabaseClient();
    await cleanupApprovedFromSupabase(supabase);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

