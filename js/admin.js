import { supabase } from "./supabase.js";

const $ = (id) => document.getElementById(id);

const loginCard = $("loginCard");
const meCard = $("meCard");
const loginMsg = $("loginMsg");
const meText = $("meText");
const meUid = $("meUid");
const adminState = $("adminState");
const list = $("list");

$("btnLogin").addEventListener("click", onLogin);
$("btnLogout").addEventListener("click", onLogout);
$("btnRefresh").addEventListener("click", loadPending);

init();

async function init() {
  // 读取现有 session
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    await showAuthed(session.user);
  } else {
    showLogin();
  }

  // session 变化监听
  supabase.auth.onAuthStateChange(async (_event, session2) => {
    if (session2?.user) await showAuthed(session2.user);
    else showLogin();
  });
}

function showLogin() {
  loginCard.style.display = "";
  meCard.style.display = "none";
  list.innerHTML = "";
  loginMsg.textContent = "";
}

async function showAuthed(user) {
  loginCard.style.display = "none";
  meCard.style.display = "";
  meText.textContent = user.email || "(no email)";
  meUid.textContent = `user_id: ${user.id}`;

  // 关键：判断是否管理员（依赖你刚刚加的 admins_read_self policy）
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    adminState.innerHTML = `<span class="danger">读取 admins 失败：</span>${escapeHtml(error.message)}`;
    list.innerHTML = "";
    return;
  }

  const isAdmin = !!data?.user_id;
  if (!isAdmin) {
    adminState.innerHTML = `<span class="danger">你已登录，但不是管理员（admins 表中没有你的 user_id）。</span>`;
    list.innerHTML = "";
    return;
  }

  adminState.innerHTML = `<span class="ok">管理员已确认 ✅</span>`;
  await loadPending();
}

async function onLogin() {
  loginMsg.textContent = "";
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || !password) {
    loginMsg.textContent = "请输入邮箱和密码。";
    return;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    loginMsg.textContent = "登录失败：" + error.message;
  }
}

async function onLogout() {
  await supabase.auth.signOut();
}

async function loadPending() {
  list.innerHTML = `<div class="card">加载中...</div>`;

  const { data, error } = await supabase
    .from("photos")
    .select("id,image_path,uploader_name,taken_at,people,category,year,status,created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = `<div class="card"><span class="danger">读取 photos 失败：</span>${escapeHtml(error.message)}</div>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = `<div class="card">暂无待审核投稿。</div>`;
    return;
  }

  list.innerHTML = data.map(renderItem).join("");
  bindActions();
}

function renderItem(row) {
  const publicUrl = supabase.storage.from("photos").getPublicUrl(row.image_path).data.publicUrl;

  return `
  <div class="card" data-id="${row.id}">
    <div class="grid">
      <div>
        <img src="${publicUrl}" alt="preview" />
        <div class="muted" style="margin-top:8px;word-break:break-all;">
          路径：${escapeHtml(row.image_path)}
        </div>
        <div style="margin-top:8px;">
          <a href="${publicUrl}" target="_blank" rel="noopener">打开原图</a>
        </div>
      </div>
      <div>
        <h2 style="margin:0 0 10px 0;">${escapeHtml(row.category || "未分类")}</h2>
        <div class="muted">上传者：<b>${escapeHtml(row.uploader_name || "")}</b></div>
        <div class="muted">拍摄日期：${escapeHtml(row.taken_at || "")}（${escapeHtml(String(row.year || ""))}）</div>
        <div class="muted">涉及人物：${escapeHtml(row.people || "无")}</div>
        <div class="muted">状态：<b>${escapeHtml(row.status || "")}</b></div>

        <div class="row" style="margin-top:14px;">
          <button class="btn2 act-approve">通过</button>
          <button class="btn act-reject">拒绝</button>
          <span class="muted act-msg"></span>
        </div>
      </div>
    </div>
  </div>`;
}

function bindActions() {
  document.querySelectorAll(".act-approve").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const card = e.target.closest(".card");
      await updateStatus(card, "approved");
    });
  });

  document.querySelectorAll(".act-reject").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const card = e.target.closest(".card");
      await updateStatus(card, "rejected");
    });
  });
}

async function updateStatus(card, status) {
  const id = card.getAttribute("data-id");
  const msg = card.querySelector(".act-msg");
  msg.textContent = "处理中...";

  const { error } = await supabase
    .from("photos")
    .update({ status })
    .eq("id", id);

  if (error) {
    msg.innerHTML = `<span class="danger">${escapeHtml(error.message)}</span>`;
    return;
  }

  msg.innerHTML = `<span class="ok">已更新为 ${status}</span>`;
  // 更新完直接移除卡片
  card.remove();
  if (list.children.length === 0) list.innerHTML = `<div class="card">暂无待审核投稿。</div>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
