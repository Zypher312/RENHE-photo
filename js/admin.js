import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ✅ 改成你自己的
const SUPABASE_URL = "https://ymfwfruzhzpvexzqwbfq.supabase.co";
const SUPABASE_KEY = "sb_publishable_MaLbSbI140CBstTTP2ICmw_R8XEZNyy";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const loginCard = document.getElementById("loginCard");
const adminCard = document.getElementById("adminCard");
const listCard  = document.getElementById("listCard");

const emailEl = document.getElementById("email");
const passEl  = document.getElementById("password");

const loginMsg = document.getElementById("loginMsg");
const adminMsg = document.getElementById("adminMsg");

const whoEl  = document.getElementById("who");
const roleEl = document.getElementById("role");

const listEl  = document.getElementById("list");
const emptyEl = document.getElementById("empty");

const btnLogin  = document.getElementById("btnLogin");
const btnForgot = document.getElementById("btnForgot");
const btnLogout = document.getElementById("btnLogout");
const btnReload = document.getElementById("btnReload");

function setMsg(el, text, cls="muted"){
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

function getBaseUrl(){
  // https://zypher312.github.io/RENHE-photo/admin.html -> https://zypher312.github.io/RENHE-photo
  const p = location.pathname.replace(/\/[^/]*$/, "");
  return location.origin + p;
}

function publicUrl(image_path){
  // 你的 photos bucket 必须是 public
  return `${SUPABASE_URL}/storage/v1/object/public/photos/${image_path}`;
}

async function isAdminByDB(userId){
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
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
    const img = publicUrl(row.image_path);

    const item = document.createElement("div");
    item.className = "item";

    item.innerHTML = `
      <img class="thumb" src="${img}" alt="thumb" />
      <div class="meta">
        <h3>${escapeHtml(row.uploader_name || "（未填）")} · ${escapeHtml(row.category || "")} · ${row.year || ""}</h3>
        <div class="muted small">拍摄日期：<b>${escapeHtml(row.taken_at || "")}</b></div>
        <div class="muted small">人物：${escapeHtml(row.people || "无")}</div>
        <div class="muted small">image_path：<code>${escapeHtml(row.image_path || "")}</code></div>

        <div class="row" style="margin-top:10px;">
          <a class="btn btn-outline btn-mini" href="${img}" target="_blank" rel="noopener">打开原图</a>
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
  rowMsg.className = "msg muted small";
  rowMsg.textContent = status === "approved" ? "正在通过…" : "正在驳回…";

  const { error } = await supabase
    .from("photos")
    .update({ status })
    .eq("id", id);

  if (error){
    rowMsg.className = "msg err small";
    rowMsg.textContent = "操作失败：" + error.message;
    return;
  }

  rowMsg.className = "msg ok small";
  rowMsg.textContent = "已更新为 " + status + " ✅";

  setTimeout(() => {
    const item = rowMsg.closest(".item");
    if (item) item.remove();
    if (!listEl.children.length) show(emptyEl);
  }, 600);
}

async function refreshSessionUI(){
  const { data: { session } } = await supabase.auth.getSession();

  if (!session){
    show(loginCard);
    hide(adminCard);
    hide(listCard);
    setMsg(loginMsg, "未登录。请先登录管理员账号。");
    return;
  }

  const user = session.user;
  whoEl.textContent = user.email || user.id;
  roleEl.textContent = "user_id: " + user.id;

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

  hide(loginCard);
  show(adminCard);
  show(listCard);
  setMsg(adminMsg, "管理员验证通过 ✅", "ok");
  await loadPending();
}

// ============ 事件：登录（关键：加 try/catch，不然你就会卡在“正在登录”） ============
btnLogin.addEventListener("click", async () => {
  const email = emailEl.value.trim();
  const password = passEl.value;

  if (!email || !password){
    setMsg(loginMsg, "请输入邮箱和密码。", "err");
    return;
  }

  btnLogin.disabled = true;
  btnForgot.disabled = true;
  setMsg(loginMsg, "正在登录…（如果一直不动，打开 F12 → Console 看报错）");

  // 8 秒提示（不影响请求，只是给你反馈）
  const t = setTimeout(() => {
    setMsg(loginMsg, "仍在登录…如果你开了广告拦截/隐私插件，可能会拦截请求。请看 Console / Network。", "err");
  }, 8000);

  try{
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error){
      setMsg(loginMsg, "登录失败：" + error.message, "err");
      return;
    }
    setMsg(loginMsg, "登录成功 ✅ 正在加载后台…", "ok");
    await refreshSessionUI();
  }catch(e){
    // ✅ 你现在“卡住”的核心原因通常就在这里：Failed to fetch / 被拦截 / DNS / 404 等
    setMsg(loginMsg, "登录请求异常：" + (e?.message || e) + "（去 F12→Console/Network 看详细原因）", "err");
  }finally{
    clearTimeout(t);
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

// ============ 忘记密码 ============
btnForgot.addEventListener("click", async () => {
  const email = emailEl.value.trim();
  if (!email){
    setMsg(loginMsg, "先在邮箱框填你要重置的邮箱。", "err");
    return;
  }

  btnLogin.disabled = true;
  btnForgot.disabled = true;

  try{
    const redirectTo = `${getBaseUrl()}/reset.html`; // 你需要创建 reset.html（下面给你）
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error){
      setMsg(loginMsg, "发送重置邮件失败：" + error.message, "err");
      return;
    }
    setMsg(loginMsg, "已发送重置邮件 ✅ 去邮箱点链接，按提示设置新密码。", "ok");
  }catch(e){
    setMsg(loginMsg, "发送重置邮件异常：" + (e?.message || e), "err");
  }finally{
    btnLogin.disabled = false;
    btnForgot.disabled = false;
  }
});

// 初次加载
refreshSessionUI();
supabase.auth.onAuthStateChange(() => refreshSessionUI());
