import { supabase } from "./supabaseClient.js";

/** ========= 可配置区 ========= */
const BUCKET = "photos";
const TABLE = "photos";

const MAX_MB = 50;
const MAX_BYTES = MAX_MB * 1024 * 1024;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const CATEGORY_SLUG = {
  "比赛实况": "match",
  "训练物料": "training",
  "路透花絮": "candid",
  "饭制同人": "fanart",
};

/** ========= DOM ========= */
const form = document.getElementById("uploadForm");
const btn = document.getElementById("submitBtn");
const fileInput = document.getElementById("photoInput");
const msg = document.getElementById("msg");

let log = document.getElementById("log");
if (!log) {
  log = document.createElement("pre");
  log.id = "log";
  log.style.whiteSpace = "pre-wrap";
  log.style.marginTop = "10px";
  log.style.padding = "10px 12px";
  log.style.borderRadius = "12px";
  log.style.background = "#f8fafc";
  log.style.border = "1px solid rgba(0,0,0,.08)";
  msg?.insertAdjacentElement("afterend", log);
}

/** ========= UI 辅助 ========= */
function setMsg(text, cls = "muted") {
  if (!msg) return;
  msg.className = cls; // 你 CSS 里可定义 .ok .warn .bad
  msg.textContent = text;
}

function appendLog(text) {
  if (!log) return;
  log.textContent += text + "\n";
}

function clearLog() {
  if (!log) return;
  log.textContent = "";
}

/** ========= 工具函数 ========= */
function extOkByName(filename) {
  const lower = (filename || "").toLowerCase();
  return (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp")
  );
}

function getExt(file) {
  const name = (file?.name || "").toLowerCase();
  let ext = name.includes(".") ? name.split(".").pop() : "";
  if (ext === "jpeg") ext = "jpg";
  if (ext === "jpg" || ext === "png" || ext === "webp") return ext;

  if (file?.type === "image/jpeg") return "jpg";
  if (file?.type === "image/png") return "png";
  if (file?.type === "image/webp") return "webp";

  return "";
}

function mimeFromExt(ext) {
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function newUUID() {
  return crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeSlug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "other";
}

/**
 * 解析拍摄日期：支持
 * - yyyy-mm-dd（date input）
 * - yyyy/mm/dd（你截图里就是这种）
 * - yyyy.mm.dd
 * 返回 { iso: 'YYYY-MM-DD', year: 2026 }
 */
function parseTakenAt(raw) {
  const s = String(raw || "").trim();
  // date input 通常是 2026-02-03；但你也可能拿到 2026/02/03
  const m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  // 用 UTC 构造，避免时区导致日期跑偏
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) return null;

  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { iso, year: y };
}

async function safeRemove(objectPath) {
  try {
    const rm = await supabase.storage.from(BUCKET).remove([objectPath]);
    if (rm?.error) appendLog(`   ⚠️ 回滚删除失败：${rm.error.message}`);
    else appendLog(`   🧹 已回滚删除：${objectPath}`);
  } catch (e) {
    appendLog(`   ⚠️ 回滚删除异常：${e?.message || String(e)}`);
  }
}

/** ========= 初始化提示 ========= */
setMsg("✅ 已加载，等待提交…", "ok");

/** ========= 主逻辑 ========= */
async function handleSubmit() {
  clearLog();

  if (!form || !fileInput) {
    setMsg("页面元素缺失：请检查 upload.html 是否包含 uploadForm / photoInput。", "bad");
    return;
  }

  const uploader_name = form.querySelector('[name="uploader_name"]')?.value?.trim() || "";
  const taken_at_raw = form.querySelector('[name="taken_at"]')?.value?.trim() || "";
  const people = form.querySelector('[name="people"]')?.value?.trim() || "";
  const category_cn = form.querySelector('[name="category"]')?.value || "";

  if (!uploader_name || !taken_at_raw || !category_cn) {
    setMsg("提交失败：请把必填项都填完。", "bad");
    return;
  }

  const parsed = parseTakenAt(taken_at_raw);
  if (!parsed) {
    setMsg("提交失败：拍摄日期格式不对（应为 YYYY-MM-DD 或 YYYY/MM/DD）。", "bad");
    return;
  }
  const { iso: taken_at, year } = parsed;

  const category_slug = safeSlug(CATEGORY_SLUG[category_cn] || "other");

  const files = Array.from(fileInput.files || []);
  if (files.length === 0) {
    setMsg("提交失败：请选择至少 1 张图片。", "bad");
    return;
  }

  // 文件校验
  const badFiles = files.filter((f) => {
    const typeOk = ALLOWED_TYPES.has(f.type) || extOkByName(f.name);
    const sizeOk = f.size <= MAX_BYTES;
    return !(typeOk && sizeOk);
  });

  if (badFiles.length > 0) {
    setMsg(`提交失败：有文件类型/大小不符合（jpg/png/webp，≤${MAX_MB}MB/张）`, "bad");
    appendLog("不符合的文件：");
    badFiles.forEach((f) =>
      appendLog(`- ${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB, ${f.type || "unknown"})`)
    );
    return;
  }

  // session log（可选）
  try {
    const { data } = await supabase.auth.getSession();
    appendLog(`session: ${data?.session ? "authenticated" : "anon"}`);
  } catch {
    // ignore
  }

  if (btn) btn.disabled = true;
  setMsg(`开始上传：共 ${files.length} 张…`, "warn");

  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    const uuid = newUUID();
    const ext = getExt(file);
    if (!ext) {
      failCount++;
      appendLog(`[#${i + 1}] ❌ 无法识别文件类型：${file.name}`);
      continue;
    }

    const contentType = file.type || mimeFromExt(ext);

    // ✅ 统一路径规则：uploads/year/category/uuid.ext
    const objectPath = `uploads/${year}/${category_slug}/${uuid}.${ext}`;

    appendLog(`[#${i + 1}] 上传：${file.name} -> ${objectPath}`);

    // 1) Storage 上传
    const up = await supabase.storage.from(BUCKET).upload(objectPath, file, {
      upsert: false,
      contentType,
      cacheControl: "3600",
    });

    if (up.error) {
      failCount++;
      appendLog(`   ❌ Storage 上传失败：${up.error.message}`);
      // 常见：RLS policy 未放行 uploads/ 前缀
      continue;
    }

    // 2) DB 写入（严格对齐你现在表结构：没有 category_slug；year/taken_at/category 必填）
    const payload = {
      image_path: objectPath,
      uploader_name,
      taken_at,                 // 'YYYY-MM-DD'
      people: people || null,   // 允许空
      category: category_cn,
      year,                     // NOT NULL
      status: "pending",
    };

    const ins = await supabase.from(TABLE).insert([payload]).select("id").single();

    if (ins.error) {
      failCount++;
      appendLog(`   ❌ DB 写入失败：${ins.error.message}`);

      // 回滚删除刚上传的 Storage 文件，避免“Storage 有、DB 没”
      await safeRemove(objectPath);
      continue;
    }

    okCount++;
    appendLog(`   ✅ 成功：已进入 pending（id=${ins.data?.id || "?"}）`);
  }

  if (okCount > 0 && failCount === 0) {
    setMsg(`提交成功：${okCount}/${files.length} 张已进入审核队列（pending）。`, "ok");
    form.reset();
  } else if (okCount > 0) {
    setMsg(`部分成功：成功 ${okCount} 张，失败 ${failCount} 张。看下方日志。`, "warn");
  } else {
    setMsg("提交失败：全部失败。看下方日志（若提示 RLS/Policy，说明写入权限没放行）。", "bad");
  }

  if (btn) btn.disabled = false;
}

/** ========= 绑定事件 ========= */
// 支持点击按钮 & 回车提交
form?.addEventListener("submit", (e) => {
  e.preventDefault();
  handleSubmit();
});

btn?.addEventListener("click", (e) => {
  e.preventDefault();
  handleSubmit();
});
