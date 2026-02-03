import { supabase } from "./supabaseClient.js";

const BUCKET = "photos";
const TABLE  = "photos";

const MAX_MB = 50;
const MAX_BYTES = MAX_MB * 1024 * 1024;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const TYPE_TO_EXT = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
};

// ✅ 用英文 slug 存目录，避免中文 key
const CATEGORY_SLUG = {
  "比赛实况": "match",
  "训练物料": "train",
  "路透花絮": "candid",
  "饭制同人": "fanart",
};

const form = document.getElementById("uploadForm");
const btn = document.getElementById("submitBtn");
const fileInput = document.getElementById("photoInput");
const msg = document.getElementById("msg");
const logEl = document.getElementById("log"); // 你页面里最好有 <pre id="log"></pre>，没有也不致命

function setMsg(text, cls = "") {
  msg.className = cls;
  msg.textContent = text;
}
function logClear() {
  if (logEl) logEl.textContent = "";
}
function logAppend(t) {
  if (logEl) logEl.textContent += t + "\n";
}

function getExt(file) {
  if (TYPE_TO_EXT[file.type]) return TYPE_TO_EXT[file.type];
  const m = /\.([a-zA-Z0-9]+)$/.exec(file.name);
  return m ? m[1].toLowerCase() : "jpg";
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// 页面加载提示
setMsg("✅ 已加载，等待提交…", "ok");

async function handleSubmit() {
  logClear();

  const uploader_name = form.uploader_name.value.trim();
  const taken_at = form.taken_at.value; // yyyy-mm-dd（value 永远是这个格式）
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

  // 前端校验：类型 + 大小
  const badFiles = files.filter(f => {
    const typeOk = ALLOWED_TYPES.has(f.type) || !!getExt(f);
    const sizeOk = f.size <= MAX_BYTES;
    return !(typeOk && sizeOk);
  });
  if (badFiles.length > 0) {
    setMsg(`提交失败：有文件类型/大小不符合（jpg/png/webp，≤${MAX_MB}MB/张）`, "bad");
    badFiles.forEach(f => logAppend(`- ${f.name} (${(f.size/1024/1024).toFixed(2)}MB, ${f.type || "unknown"})`));
    return;
  }

  btn.disabled = true;
  setMsg(`开始上传：共 ${files.length} 张…`, "warn");

  let okCount = 0;
  let failCount = 0;

  const year = new Date(taken_at).getFullYear();
  const catSlug = CATEGORY_SLUG[category] || "misc";

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = getExt(file);
    const id = uuid();

    // ✅ 关键：objectPath 全英文 + 只用 uuid 文件名（不拼原始中文文件名）
    const objectPath = `${year}/${catSlug}/${id}.${ext}`;

    logAppend(`[#${i + 1}] 上传中：${file.name} -> ${objectPath}`);

    // 1) 上传到 Storage
    const up = await supabase.storage.from(BUCKET).upload(objectPath, file, {
      upsert: false,
      contentType: file.type || undefined,
    });

    if (up.error) {
      failCount++;
      logAppend(`   ❌ Storage 上传失败：${up.error.message}`);
      continue;
    }

    // 2) 写入数据库（pending）
    const ins = await supabase.from(TABLE).insert([{
      image_path: objectPath,
      uploader_name,
      taken_at,
      people: people || null,
      category,     // 这里仍然保留中文分类作为展示字段
      year,
      status: "pending",
    }]);

    if (ins.error) {
      failCount++;
      logAppend(`   ❌ DB 写入失败：${ins.error.message}`);

      // 可选：DB失败就删 Storage 文件避免孤儿文件
      // await supabase.storage.from(BUCKET).remove([objectPath]);

      continue;
    }

    okCount++;
    logAppend("   ✅ 成功：已进入 pending");
  }

  if (okCount > 0 && failCount === 0) {
    setMsg(`提交成功：${okCount}/${files.length} 张已进入审核队列（pending）。`, "ok");
    form.reset();
  } else if (okCount > 0) {
    setMsg(`部分成功：成功 ${okCount} 张，失败 ${failCount} 张。看下方日志。`, "warn");
  } else {
    setMsg("提交失败：全部失败。看下方日志（若此时不再是 Invalid key，再去查 RLS/Policy）。", "bad");
  }

  btn.disabled = false;
}

btn.addEventListener("click", (e) => {
  e.preventDefault();
  handleSubmit();
});
