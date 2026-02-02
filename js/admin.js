import { supabase } from "./supabase.js";

const $ = (id) => document.getElementById(id);

const loginCard = $("loginCard");
const adminCard = $("adminCard");
const listCard  = $("listCard");

const emailEl = $("email");
const passEl  = $("password");

const btnLogin  = $("btnLogin");
const btnForgot = $("btnForgot");
const btnLogout = $("btnLogout");
const btnReload = $("btnReload");

const loginMsg = $("loginMsg");
const adminMsg = $("adminMsg");

const whoEl = $("who");
const uidEl = $("uid");

const listEl  = $("list");
const emptyEl = $("empty");

function setMsg(el, text, cls = "muted") {
  el.className = "msg " + cls + " small";
  el.textContent = text || "";
}
function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

async function isAdminByDB(userId){
  // 通过查询 admins 表判断（依赖你的 RLS：admins_read_self）
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return !!data?.user_id;
}

async function loadPending(){
  listEl.innerHTML = "";
  hide(emptyEl);
  setMsg(adminMsg, "正在加载待审列表…");

  const { data, error } = await supabase
    .from("photos")
    .select("id,image_path,uploader_name,taken_at,people,category,year,status,created_at")
    .eq("status","pending")
    .order("created_at", { ascending: true });

  if (error){
    setMsg(adminMsg, "加载失败：" + error.message, "err");
    return;
  }

  if (!data || data.length === 0){
    setMsg(adminMsg, "已加载。暂无待审投稿。", "ok");
    show(emptyEl);
    return;
  }

  setMsg(adminMsg, `已加载 ${data.length} 条待审投稿。`, "ok");

  for (const row of data){
    const publicUrl = supabase.storage.from("photos").getPublicUrl(row.image_path).data.publicUrl;

    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <img class="thumb" src="${publicUrl}" alt="thumb" />
      <div style="min-width:0;">
        <div style="font-weight:800; margin-bottom:6px;">
          ${escapeHtml(row.uploader_name || "（未填）")} · ${escapeHtml(row.category || "")} · ${escapeHtml(String(row.year || ""))}
        </div>
        <div class="muted small">拍摄日期：<b>${escapeHtml(row.taken_at || "")}</b></div>
        <div class="muted small">人物：${escapeHtml(row.people || "无")}</div>
        <div class="muted small">image_path：<code>${escapeHtml(row.image_path || "")}</code></div>

        <div class="row" style="margin-top:10px;">
          <a class="btn btn-outline btn-mini" href="${publicUrl}" target="_blank" rel="noopener">打开原图</a>
          <div class="spacer"></div>
          <button class="btn btn-bad btn-mini" data-action="reject" data-id="${row.id}">驳回</button>
          <button class="btn btn-ok btn-mini" data-action="approve" data-id="${row.id}">通过</button>
        </div>

        <div class="msg muted small" data-rowmsg="${row.id}"></div>
      </div>
    `;
    listEl.appendChild(item);
  }
}

async function approveOrReject(id, status){
  const rowMsg = document.querySelector(`[data-rowmsg="${id}"]`);
  if (rowMsg) rowMsg.textContent = status === "approved" ? "正在通过…" : "正在驳回…";

  const { error } = await supabase
    .from("photos")
    .update({ status })
    .eq("id", id);

  if (error){
    if (rowMsg) {
      rowMsg.className = "msg err small";
      rowMsg.textContent = "操作失败：" + error.message;
    }
    return;
  }

  if (rowMsg){
    rowMsg.className = "msg ok small";
    rowMsg.textContent = "已更新为 " + status + " ✅";
  }

  setTimeout(() => {
    const item = rowMsg?.closest(".item");
    if (item) item.remove();
    if (!listEl.children.length) show(emptyEl);
  }, 600);
}

async function refreshSessionUI(){
  const { data: { session } } = await supabase.auth.getSession();

  if (!session){
    // 未登录
    show(loginCard);
    hide(adminCard);
    hide(listCard);
    setMsg(loginMsg, "未登录。请先登录管理员账号。");
    return;
  }

  const user = session.user;
  whoEl.textContent = user.email || user.id;
  uidEl.textContent = "user_id: " + user.id;

  // 检查是否管理员
  let admin = false;
  try{
    admin = await isAdminByDB(user.id);
  }catch(e){
    show(adminCard);
    hide(listCard);
    hide(loginCard);
    setMsg(adminMsg, "检查管理员失败：" + (e?.message || e), "err");
    return;
  }

  if (!admin){
    show(adminCard);
    hide(listCard);
    hide(loginCard);
    setMsg(adminMsg, "你已登录，但不是管理员（admins 表中没有你的 user_id）。", "err");
    return;
  }

  // 管理员：显示列表
  hide(loginCard);
  show(adminCard);
  show(listCard);
  setMsg(adminMsg, "管理员验证通过 ✅", "ok");
  await loadPending();
}

/** 登录 */
btnLogin.addEventListener("click", async () => {
  const email = emailEl.value.trim();
  const password = passEl.value;

  if (!email || !password){
    setMsg(loginMsg, "请输入邮箱和密码。", "err");
    return;
  }

  btnLogin.disabled = true;
  btnForgot.disabled = true;
  setMsg(loginMsg, "正在登录…");

  try{
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error){
      setMsg(loginMsg, "登录失败：" + error.message, "err");
      return;
    }
    if (!data?.session){
      setMsg(loginMsg, "登录未返回 session（可能网络/配置异常），请看控制台 Console。", "err");
      return;
    }
    setMsg(loginMsg, "登录成功 ✅ 正在加载后台…", "ok");
    await refreshSessionUI();
  }catch(e){
    setMsg(loginMsg, "登录异常：" + (e?.message || e), "err");
  }finally{
    btnLogin.disabled = false;
    btnForgot.disabled = false;
  }
});

/** 忘记密码（发邮件） */
btnForgot.addEventListener("click", async () => {
  const email = emailEl.value.trim();
  if (!email){
    setMsg(loginMsg, "先在邮箱框里填你的邮箱，然后点“忘记密码”。", "err");
    return;
  }

  btnLogin.disabled = true;
  btnForgot.disabled = true;
  setMsg(loginMsg, "正在发送重置密码邮件…");

  try{
    // 你可以不做 reset.html，也能先用控制台直接改密码；做了 reset.html 体验更完整
    const redirectTo = location.origin + location.pathname.replace(/admin\.html$/, "reset.html");
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    if (error){
      setMsg(loginMsg, "发送失败：" + error.message, "err");
      return;
    }
    setMsg(loginMsg, "已发送 ✅ 去邮箱点开重置链接（可能在垃圾箱）。", "ok");
  }catch(e){
    setMsg(loginMsg, "发送异常：" + (e?.message || e), "err");
  }finally{
    btnLogin.disabled = false;
    btnForgot.disabled = false;
  }
});

btnLogout.addEventListener("click", async () => {
  await supabase.auth.signOut();
  await refreshSessionUI();
});

btnReload.addEventListener("click", async () => {
  await loadPending();
});

listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === "approve") await approveOrReject(id, "approved");
  if (action === "reject")  await approveOrReject(id, "rejected");
});

// 初次加载
refreshSessionUI();

// 会话变化自动刷新
supabase.auth.onAuthStateChange(() => refreshSessionUI());
