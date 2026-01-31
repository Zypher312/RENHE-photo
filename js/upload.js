import { supabase } from "./supabaseClient.js";

const form = document.querySelector("#uploadForm");
const msg = document.querySelector("#msg");

function setMsg(t) { msg.textContent = t; }

function isAllowedFile(file) {
  const okType = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  const okSize = file.size <= 10 * 1024 * 1024; // 10MB
  return okType && okSize;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("提交中...");

  try {
    const fd = new FormData(form);
    const file = fd.get("photo");

    if (!file || !isAllowedFile(file)) {
      throw new Error("文件类型或大小不符合（jpg/png/webp，≤10MB）");
    }

    const uploader = String(fd.get("uploader_name") || "").trim();
    const takenAt = String(fd.get("taken_at") || "").trim();
    const people = String(fd.get("people") || "").trim();
    const category = String(fd.get("category") || "").trim();

    const year = Number(takenAt.slice(0, 4));
    if (!year) throw new Error("拍摄日期不合法");

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `uploads/${crypto.randomUUID()}.${ext}`;

    // 1) 上传到 Storage: photos bucket / uploads/
    const { error: upErr } = await supabase.storage
      .from("photos")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw upErr;

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
    if (dbErr) throw dbErr;

    form.reset();
    setMsg("提交成功 ✅ 已进入待审核队列");
  } catch (err) {
    console.error(err);
    setMsg("提交失败：" + (err.message || "未知错误"));
  }
});
