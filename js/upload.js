import { supabase } from "./supabaseClient.js";

const BUCKET = "photos";
const TABLE = "photos";

const MAX_MB = 50;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const form = document.getElementById("uploadForm");
const btn = document.getElementById("submitBtn");
const fileInput = document.getElementById("photoInput");
const msg = document.getElementById("msg");
const log = document.getElementById("log"); // 确保 upload.html 里有 <pre id="log"></pre>

function setMsg(text, cls = "muted") {
  msg.className = cls;
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

// 你的中文分类 -> 英文目录（用于 Storage key）
// DB 里仍然可以存中文 category 不影响展示
const CATEGORY_SLUG = {
  "比赛实况": "match",
  "训练物料": "training",
  "路透花絮": "candid",
  "饭制同人": "fanart",
};

function getExt(file) {
  const name = (file.name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";
  // 兜底
  if (ext === "jpeg") return "jpg";
  if (ext === "jpg" || ext === "png" || ext === "webp") return ext;
  // 如果 file.type 有就跟着 type 走
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

setMsg("✅ 已加载，等待提交…", "ok");

async function handleSubmit() {
  clearLog();

  const uploader_name = form.uploader_name.value.trim();
  const taken_at = form.taken_at.value; // yyyy-mm-dd
  const people = form.people.value.trim();
  const category_cn = form.category.value; // 仍然存中文用于展示
  const category_slug = CATEGORY_SLUG[category_cn] || "other";

  const files = Array.from(fileInput.files || []);
  if (!uploader_name || !taken_at || !category_cn) {
    setMsg("提交失败：请把必填项都填完。", "bad");
    return;
  }
  if (files.length === 0) {
    setMsg("提交失败：请选择至少 1 张图片。", "bad");
    return;
  }

  // 前端校验：类型 + 大小
  const badFiles = files.filter((f) => {
    const typeOk = ALLOWED_TYPES.has(f.type);
    const sizeOk = f.size <= MAX_BYTES;
    return !(typeOk && sizeOk);
  });
  if (badFiles.length > 0) {
    setMsg(`提交失败：有文件类型/大小不符合（jpg/png/webp，≤${MAX_MB}MB/张）`, "bad");
    appendLog("不符合的文件：");
    badFiles.forEach((f) => appendLog(`- ${f.name} (${(f.size / 1024 / 1024).toFixed(2)}MB, ${f.type})`));
    return;
  }

  btn.disabled = true;
  setMsg(`开始上传：共 ${files.length} 张…`, "warn");

  let okCount = 0;
  let failCount = 0;

  const year = new Date(taken_at).getFullYear();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const uuid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const ext = getExt(file);

    // ✅ 关键：Storage key 全英文 + 不含原文件名
    const objectPath = `${year}/${category_slug}/${uuid}.${ext}`;

    appendLog(`[#${i + 1}] 上传中：${file.name} -> ${objectPath}`);

    // 1) 上传到 Storage
    const up = await supabase.storage.from(BUCKET).upload(objectPath, file, {
      upsert: false,
      contentType: file.type || undefined
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
      category: category_cn,       // 中文展示用
      category_slug,               // 英文目录用（可选）
      year,
      status: "pending"
    }]);

    if (ins.error) {
      failCount++;
      appendLog(`   ❌ DB 写入失败：${ins.error.message}`);
      // 可选：DB失败就删掉文件，避免孤儿文件
      // await supabase.storage.from(BUCKET).remove([objectPath]);
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
    setMsg("提交失败：全部失败。看下方日志（目前你的失败原因是 Storage RLS）。", "bad");
  }

  btn.disabled = false;
}

btn.addEventListener("click", (e) => {
  e.preventDefault();
  handleSubmit();
});
