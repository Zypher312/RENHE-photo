import { supabase } from "./supabaseClient.js";

const form = document.querySelector("#uploadForm");
const msg = document.querySelector("#msg");
const photoInput = document.querySelector("#photoInput");
const submitBtn = document.querySelector("#submitBtn");

// 这两行是“脚本是否加载成功”的硬证据
console.log("upload.js loaded");
msg.textContent = "✅ upload.js 已加载（现在点提交不会刷新页面）";

function setMsg(t) { msg.textContent = t; }

function isAllowedFile(file) {
  const okType = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  const okSize = file.size <= 10 * 1024 * 1024; // 10MB/张
  return okType && okSize;
}

submitBtn.addEventListener("click", async () => {
  // 使用浏览器原生 required 校验
  if (!form.reportValidity()) return;

  setMsg("提交中...");

  try {
    const files = photoInput?.files ? Array.from(photoInput.files) : [];
    if (!files.length) throw new Error("请先选择至少 1 张图片");

    const fd = new FormData(form);
    const uploader = String(fd.get("uploader_name") || "").trim();
    const takenAt = String(fd.get("taken_at") || "").trim();
    const people = String(fd.get("people") || "").trim();
    const category = String(fd.get("category") || "").trim();

    const year = Number(takenAt.slice(0, 4));
    if (!year) throw new Error("拍摄日期不合法");

    const bad = files.filter(f => !isAllowedFile(f));
    if (bad.length) {
      throw new Error("有文件类型/大小不符合（jpg/png/webp，≤10MB/张）");
    }

    let okCount = 0;
    const failed = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setMsg(`上传中 ${i + 1}/${files.length}：${file.name}`);

      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `uploads/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("photos")
        .upload(path, file, { contentType: file.type, upsert: false });

      if (upErr) {
        failed.push(`${file.name}（上传失败：${upErr.message}）`);
        continue;
      }

      const { error: dbErr } = await supabase.from("photos").insert({
        image_path: path,
        uploader_name: uploader,
        taken_at: takenAt,
        people: people || null,
        category,
        year,
        status: "pending",
      });

      if (dbErr) {
        failed.push(`${file.name}（写入失败：${dbErr.message}）`);
        continue;
      }

      okCount++;
    }

    form.reset();
    if (failed.length === 0) {
      setMsg(`提交成功 ✅ 已上传 ${okCount}/${files.length} 张，全部进入待审核队列`);
    } else {
      setMsg(`部分成功：已上传 ${okCount}/${files.length} 张；失败 ${failed.length} 张（F12 控制台看明细）`);
      console.warn("失败明细：", failed);
    }
  } catch (err) {
    console.error(err);
    setMsg("提交失败：" + (err.message || "未知错误"));
  }
});
