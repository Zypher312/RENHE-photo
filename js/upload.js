import { supabase } from "./supabaseClient.js";

const form = document.querySelector("#uploadForm");
const msg = document.querySelector("#msg");
const photoInput = document.querySelector("#photoInput");

function setMsg(t) { msg.textContent = t; }

function isAllowedFile(file) {
  const okType = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  const okSize = file.size <= 10 * 1024 * 1024; // 10MB/张
  return okType && okSize;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("提交中...");

  try {
    const fd = new FormData(form);
    const files = photoInput?.files ? Array.from(photoInput.files) : [];
    if (!files.length) throw new Error("请先选择至少 1 张图片");

    // 基本信息（本次批量所有图片共用）
    const uploader = String(fd.get("uploader_name") || "").trim();
    const takenAt = String(fd.get("taken_at") || "").trim();
    const people = String(fd.get("people") || "").trim();
    const category = String(fd.get("category") || "").trim();

    const year = Number(takenAt.slice(0, 4));
    if (!year) throw new Error("拍摄日期不合法");

    // 先检查所有文件是否合规（有一张不合规就直接提示）
    const bad = files.filter(f => !isAllowedFile(f));
    if (bad.length) {
      const names = bad.map(f => f.name).slice(0, 5).join("、");
      throw new Error(`以下文件类型/大小不符合（jpg/png/webp，≤10MB/张）：${names}${bad.length>5 ? "..." : ""}`);
    }

    let okCount = 0;
    const failed = [];

    // 顺序上传（最稳；避免并发导致偶发失败）
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      setMsg(`上传中 ${i + 1}/${files.length}：${file.name}`);

      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `uploads/${crypto.randomUUID()}.${ext}`;

      // 1) 上传到 Storage
      const { error: upErr } = await supabase.storage
        .from("photos")
        .upload(path, file, { contentType: file.type, upsert: false });

      if (upErr) {
        failed.push(`${file.name}（上传失败：${upErr.message}）`);
        continue;
      }

      // 2) 写入 photos 表（pending）
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
      // 失败信息不要太长，截断一下
      const show = failed.slice(0, 3).join("；");
      setMsg(`部分成功：已上传 ${okCount}/${files.length} 张 ✅；失败 ${failed.length} 张：${show}${failed.length>3 ? "..." : ""}`);
      console.warn("批量上传失败明细：", failed);
    }
  } catch (err) {
    console.error(err);
    setMsg("提交失败：" + (err.message || "未知错误"));
  }
});
