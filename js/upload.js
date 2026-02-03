import { supabase } from "./supabaseClient.js";

// ===== 你项目里用到的表 / bucket =====
const BUCKET = "photos";
const TABLE = "photos";

// ===== 单文件大小限制：50MB/张 =====
const MAX_MB = 50;
const MAX_BYTES = MAX_MB * 1024 * 1024;

// 允许的图片类型
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const form = document.getElementById("uploadForm");
const btn = document.getElementById("submitBtn");
const fileInput = document.getElementById("photoInput");
const msg = document.getElementById("msg");
const log = document.getElementById("log"); // ✅ upload.html 里要有这个

function setMsg(text, cls = "muted") {
  if (!msg) return;
  msg.className = cls; // ok/warn/bad/muted
  msg.textContent = text || "";
}

function clearLog() {
  if (log) log.textContent = "";
}
function appendLog(text) {
  if (!log) return;
  log.textContent += (text || "") + "\n";
}

function sanitizeFilename(name) {
  return String(name || "")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_");
}
function extOkByName(filename) {
  const lower = String(filename || "").toLowerCase();
  return (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp")
  );
}

// 页面加载提示（看到这句说明 upload.js + supabaseClient.js 都加载成功）
setMsg("✅ 已加载，等待提交…", "ok");

async function handleSubmit() {
  clearLog();

  try {
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

    // 前端校验：类型 + 大小
    const badFiles = files.filter((f) => {
      const typeOk = ALLOWED_TYPES.has(f.type) || extOkByName(f.name);
      const sizeOk = f.size <= MAX_BYTES;
      return !(typeOk && sizeOk);
    });

    if (badFiles.length > 0) {
      setMsg(`提交失败：有文件类型/大小不符合（jpg/png/webp，≤${MAX_MB}MB/张）`, "bad");
      appendLog("不符合的文件：");
      badFiles.forEach((f) => {
        appendLog(`- ${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB, ${f.type || "unknown"})`);
      });
      return;
    }

    btn.disabled = true;
    setMsg(`开始上传：共 ${files.length} 张…`, "warn");

    let okCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const year = new Date(taken_at).getFullYear();
      const safeName = sanitizeFilename(file.name);

      const uuid = (crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`);

      // 存储路径：year/category/uuid_filename
      const objectPath = `${year}/${category}/${uuid}_${safeName}`;

      appendLog(`[#${i + 1}] 上传中：${file.name} -> ${objectPath}`);

      // 1) 上传到 Storage
      const { error: upError } = await supabase
        .storage
        .from(BUCKET)
        .upload(objectPath, file, {
          upsert: false,
          contentType: file.type || undefined
        });

      if (upError) {
        failCount++;
        appendLog(`   ❌ Storage 上传失败：${upError.message}`);
        continue;
      }

      // 2) 写入数据库（pending）
      const { error: insError } = await supabase
        .from(TABLE)
        .insert([{
          image_path: objectPath,
          uploader_name,
          taken_at,
          people: people || null,
          category,
          year,
          status: "pending"
        }]);

      if (insError) {
        failCount++;
        appendLog(`   ❌ DB 写入失败：${insError.message}`);

        // 可选：DB失败就删掉刚上传的文件，避免“孤儿文件”
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
      setMsg("提交失败：全部失败。看下方日志（常见原因：RLS/Policy/后端限制）。", "bad");
    }
  } catch (e) {
    console.error(e);
    setMsg("提交失败：前端脚本报错了（看 Console）。", "bad");
    appendLog(String(e?.message || e));
  } finally {
    btn.disabled = false;
  }
}

// 按钮触发（不刷新页面）
btn.addEventListener("click", (e) => {
  e.preventDefault();
  handleSubmit();
});
