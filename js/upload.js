import { supabase } from "./supabaseClient.js";

/** ========= 可配置区 ========= */
const BUCKET = "photos";
const TABLE  = "photos";

// 单文件大小限制
const MAX_MB = 50;
const MAX_BYTES = MAX_MB * 1024 * 1024;

// 允许的 MIME
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// 中文分类 -> 英文目录（用于 Storage key）
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

// log 节点不存在就自动创建一个，避免你忘记加 <pre id="log"></pre>
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
  // 放到 msg 后面
  msg?.insertAdjacentElement("afterend", log);
}

/** ========= 工具函数 ========= */
function setMsg(text, cls = "muted") {
  if (!msg) return;
  msg.className = cls;     // 你 CSS 里可定义 .ok .warn .bad
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

// 允许用后缀兜底（有些系统 file.type 为空）
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

  // file.type 兜底
  if (file?.type === "image/jpeg") return "jpg";
  if (file?.type === "image/png") return "png";
  if (file?.type === "image/webp") return "webp";

  return "jpg";
}

function mimeFromExt(ext) {
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function newUUID() {
  return (crypto?.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// 防止出现奇怪字符（虽然我们最终不使用原文件名，但仍保底）
function safeSlug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** ========= 初始化提示 ========= */
setMsg("✅ 已加载，等待提交…", "ok");

/** ========= 主逻辑 ========= */
async function handleSubmit() {
  clearLog();

  const uploader_name = form?.uploader_name?.value?.trim() || "";
  const taken_at = form?.taken_at?.value || ""; // yyyy-mm-dd
  const people = form?.people?.value?.trim() || "";
  const category_cn = form?.category?.value || "";
  const category_slug = safeSlug(CATEGORY_SLUG[category_cn] || "other");

  const files = Array.from(fileInput?.files || []);

  // 基本校验
  if (!uploader_name || !taken_at || !category_cn) {
    setMsg("提交失败：请把必填项都填完。", "bad");
    return;
  }
  if (files.length === 0) {
    setMsg("提交失败：请选择至少 1 张图片。", "bad");
    return;
  }

  // 解析 year
  const dt = new Date(taken_at);
  const year = dt instanceof Date && !Number.isNaN(dt.getTime()) ? dt.getFullYear() : NaN;
  if (!Number.isFinite(year)) {
    setMsg("提交失败：拍摄日期无效，请重新选择日期。", "bad");
    return;
  }

  // 文件校验：类型 + 大小
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

  //（可选）打个 session 日志，方便你排查 anon/auth
  try {
    const { data } = await supabase.auth.getSession();
    appendLog(`session: ${data?.session ? "authenticated" : "anon"}`);
  } catch {
    // ignore
  }

  btn.disabled = true;
  setMsg(`开始上传：共 ${files.length} 张…`, "warn");

  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    try {
      const uuid = newUUID();
      const ext = getExt(file);
      const ct = file.type || mimeFromExt(ext);

      /**
       * ✅ 关键：Storage Key 必须满足你的 RLS 规则
       * - bucket: photos
       * - 第一层目录: uploads
       * - 后面全英文
       */
      const objectPath = `uploads/${year}/${category_slug}/${uuid}.${ext}`;

      appendLog(`[#${i + 1}] 上传中：${file.name} -> ${objectPath}`);

      // 1) 上传 Storage
      const up = await supabase.storage.from(BUCKET).upload(objectPath, file, {
        upsert: false,
        contentType: ct,
        cacheControl: "3600",
      });

      if (up.error) {
        failCount++;
        appendLog(`   ❌ Storage 上传失败：${up.error.message}`);
        // 常见：RLS / policy / bucket not found
        continue;
      }

      // 2) 写 DB（pending）
      // 先尝试“完整字段”，失败再降级只写最核心字段，避免你表结构不一致导致全挂
      const fullPayload = {
        image_path: objectPath,
        uploader_name,
        taken_at,
        people: people || null,
        category: category_cn,
        category_slug,     // 若你表没这个字段，会在下面自动降级
        year,
        status: "pending",
      };

      let ins = await supabase.from(TABLE).insert([fullPayload]);

      if (ins.error) {
        appendLog(`   ⚠️ DB 写入失败(完整字段)：${ins.error.message}`);
        // 降级重试（只写最核心字段）
        const minimalPayload = {
          image_path: objectPath,
          uploader_name,
          taken_at,
          category: category_cn,
          status: "pending",
        };
        ins = await supabase.from(TABLE).insert([minimalPayload]);
      }

      if (ins.error) {
        failCount++;
        appendLog(`   ❌ DB 写入失败：${ins.error.message}`);

        // 回滚：删掉刚上传的文件，避免孤儿文件
        const rm = await supabase.storage.from(BUCKET).remove([objectPath]);
        if (rm?.error) appendLog(`   ⚠️ 回滚删除失败：${rm.error.message}`);
        else appendLog(`   🧹 已回滚删除：${objectPath}`);

        continue;
      }

      okCount++;
      appendLog("   ✅ 成功：已进入 pending");
    } catch (err) {
      failCount++;
      appendLog(`   ❌ 发生异常：${err?.message || String(err)}`);
      continue;
    }
  }

  if (okCount > 0 && failCount === 0) {
    setMsg(`提交成功：${okCount}/${files.length} 张已进入审核队列（pending）。`, "ok");
    form.reset();
  } else if (okCount > 0) {
    setMsg(`部分成功：成功 ${okCount} 张，失败 ${failCount} 张。看下方日志。`, "warn");
  } else {
    setMsg("提交失败：全部失败。看下方日志（若仍提示 RLS，说明 storage.objects 的 INSERT policy 仍未放行 uploads/）。", "bad");
  }

  btn.disabled = false;
}

btn?.addEventListener("click", (e) => {
  e.preventDefault();
  handleSubmit();
});
