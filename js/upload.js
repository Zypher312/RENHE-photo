// js/upload.js
import { supabase } from "./supabase.js"; // ✅ 如果你用的是 supabaseClient.js，看下方替换说明

// ===== 你项目里用到的 bucket / table =====
const BUCKET = "photos";
const TABLE  = "photos";

// ===== 单文件大小限制：50MB/张 =====
const MAX_MB = 50;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// ✅ 分类中文 -> 英文目录（用于 Storage 路径，避免 Invalid key）
const CATEGORY_SLUG = {
  "比赛实况": "match",
  "训练物料": "training",
  "路透花絮": "candid",
  "饭制同人": "fanart",
};

// ===== DOM =====
const form = document.getElementById("uploadForm");
const btn = document.getElementById("submitBtn");
const fileInput = document.getElementById("photoInput");
const msg = document.getElementById("msg");
let log = document.getElementById("log"); // 你页面里最好有 <pre id="log"></pre>

// 如果页面没放 log，也别让脚本炸掉
if (!log) {
  log = document.createElement("pre");
  log.id = "log";
  log.style.whiteSpace = "pre-wrap";
  log.style.marginTop = "12px";
  log.style.padding = "12px";
  log.style.border = "1px dashed rgba(0,0,0,.2)";
  log.style.borderRadius = "12px";
  form.appendChild(log);
}

function setMsg(text, cls = "") {
  msg.className = cls;
  msg.textContent = text;
}
function appendLog(text) {
  log.textContent += text + "\n";
}

// ✅ 只允许 ASCII：a-zA-Z0-9._- （其他全部替换成 _）
function toSafeAsciiPart(s, maxLen = 80) {
  return (s || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLen) || "x";
}

function getCategorySlug(categoryCN) {
  return CATEGORY_SLUG[categoryCN] || toSafeAsciiPart(categoryCN, 40) || "misc";
}

function getExt(file) {
  // 先看文件名后缀
  const m = (file.name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  if (m) {
    const ext = m[1];
    if (ext === "jpeg") return "jpg";
    if (["jpg", "png", "webp"].includes(ext)) return ext;
  }
  // 再看 mime
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function isFileOk(file) {
  const typeOk = ALLOWED_TYPES.has(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name || "");
  const sizeOk = file.size <= MAX_BYTES;
  return typeOk && sizeOk;
}

// 页面加载提示
setMsg("✅ 已加载，等待提交…", "ok");

async function handleSubmit() {
  log.textContent = "";

  const uploader_name = form.uploader_name.value.trim();
  const taken_at = form.taken_at.value; // yyyy-mm-dd
  const people = form.people.value.trim();
  const category = form.category.value;

  const files = Array.from(fileInput.files || []);

  if (!uploader_name || !taken_at || !category) {
    setMsg("提交失败：请把必填项都填完。", "bad");
    return;
  }
  if (files.length === 0) {
    setMsg("提交失败：请选择至少 1 张图片。", "bad");
    return;
  }

  const badFiles = files.filter((f) => !isFileOk(f));
  if (badFiles.length > 0) {
    setMsg(`提交失败：有文件类型/大小不符合（jpg/png/webp，≤${MAX_MB}MB/张）`, "bad");
    appendLog("不符合的文件：");
    badFiles.forEach((f) => appendLog(`- ${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB, ${f.type || "unknown"})`));
    return;
  }

  btn.disabled = true;
  setMsg(`开始上传：共 ${files.length} 张…`, "warn");

  let okCount = 0;
  let failCount = 0;

  const year = new Date(taken_at).getFullYear();
  const categorySlug = getCategorySlug(category);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = getExt(file);

    // ✅ 文件名也只保留 ASCII
    const baseName = toSafeAsciiPart((file.name || "file").replace(/\.[^.]+$/, ""), 60);

    const uuid = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    // ✅ Storage 路径：纯英文/数字/下划线，彻底避免 Invalid key
    const objectPath = `${year}/${categorySlug}/${uuid}_${baseName}.${ext}`;

    appendLog(`[#${i + 1}] 上传中：${file.name} -> ${objectPath}`);

    // 1) 上传到 Storage
    const up = await supabase.storage.from(BUCKET).upload(objectPath, file, {
      upsert: false,
      contentType: file.type || undefined,
    });

    if (up.error) {
      failCount++;
      appendLog(`   ❌ Storage 上传失败：${up.error.message}`);
      continue;
    }

    // 2) 写入数据库（pending）
    const ins = await supabase.from(TABLE).insert([{
      image_path: objectPath,
      uploader_name,
      taken_at,
      people: people || null,
      category,         // ✅ 中文照存 DB
      year,
      status: "pending",
      original_name: file.name || null, // 可选：保留原始文件名
    }]);

    if (ins.error) {
      failCount++;
      appendLog(`   ❌ DB 写入失败：${ins.error.message}`);

      // 避免孤儿文件：DB失败就删掉刚上传的文件
      await supabase.storage.from(BUCKET).remove([objectPath]);

      continue;
    }

    okCount++;
    appendLog("   ✅ 成功：已进入 pending");
  }

  if (okCount > 0 && failCount === 0) {
    setMsg(`提交成功：${okCount}/${files.length} 张已进入审核队列（pending）。`, "ok");
    form.reset();
  } else if (okCount > 0) {
    setMsg(`部分成功：成功 ${okCount} 张，失败 ${failCount} 张。看下方日志。`, "warn");
  } else {
    setMsg("提交失败：全部失败。看下方日志（如果不再是 Invalid key，那再看 RLS/Policy）。", "bad");
  }

  btn.disabled = false;
}

btn.addEventListener("click", (e) => {
  e.preventDefault();
  handleSubmit();
});
