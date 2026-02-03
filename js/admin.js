import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/** ====== 你的 Supabase 配置（保持你自己的） ====== */
const SUPABASE_URL = "https://ymfwfruzhzpvexzqwbfq.supabase.co";
const SUPABASE_KEY = "sb_publishable_MaLbSbI140CBstTTP2ICmw_R8XEZNyy";
const BUCKET = "photos";

/** GitHub Pages 子路径兼容：用于 reset password redirectTo */
const BASE_URL = new URL(".", location.href).href; // e.g. https://xxx.github.io/RENHE-photo/
const RESET_REDIRECT = BASE_URL + "admin.html";

/** supabase client：显式打开 session 持久化 + url 检测（找回密码会用到） */
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
    storageKey: "renhe-photo-auth"
  }
});

/** ====== DOM ====== */
const $ = (id) => document.getElementById(id);

const loginCard = $("loginCard");
const resetCard = $("resetCard");
const adminCard = $("adminCard");
const listCard = $("listCard");

const emailEl = $("email");
const passEl = $("password");
const loginMsg = $("loginMsg");

const newPassEl = $("newPassword");
const resetMsg = $("resetMsg");

const whoEl = $("who");
const roleEl = $("role");
const adminMsg = $("adminMsg");

const listEl = $("list");
const emptyEl = $("empty");

/** ====== UI helpers ====== */
function setMsg(el, text, cls = "muted") {
  el.className = "msg " + cls + " small";
  el.textContent = text || "";
}

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function publicUrl(pathInBucket) {
  // 用官方方法拿 public url（比手拼更稳）
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathInBucket);
  return data?.publicUrl || "";
}

/** ====== 数据权限判断：是否管理员 ====== */
async function isAdminByDB(userId) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

/** ====== 加载 pending 列表 ====== */
async function loadPending() {
  listEl.innerHTML = "";
  hide(emptyEl);
  setMsg(adminMsg, "正在加载待审列表…");

  const { data, error } = await supabase
    .from("photos")
    .select("id,image_path,uploader_name,taken_at,people,category,year,status,created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    setMsg(
      adminMsg,
      "加载失败：" + error.message + "（如果是 RLS/权限问题，说明你还没通过管理员校验或策略未生效）",
      "err"
    );
    console.error("[loadPending] error:", error);
    return;
  }

  if (!data || data.length === 0) {
    setMsg(adminMsg, "已加载。暂无待审投稿。", "ok");
    show(emptyEl);
    return;
  }

  setMsg(adminMsg, `已加载 ${data.length} 条待审投稿。`, "ok");

  for (const row of data) {
    const img = publicUrl(row.image_path);

    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <img class="thumb" src="${img}" alt="thumb" />
      <div class="meta">
        <h3>${escapeHtml(row.uploader_name || "（未填）")} · ${escapeHtml(row.category || "")} · ${row.year || ""}</h3>
        <div class="kv muted small">拍摄日期：<b>${row.taken_at || ""}</b></div>
        <div class="kv muted small">人物：${escapeHtml(row.people || "无")}</div>
        <div class="kv muted small">image_path：<code>${escapeHtml(row.image_path || "")}</code></div>

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

/** ====== 审核操作 ====== */
async function approveOrReject(id, status) {
  const rowMsg = document.querySelector(`[data-rowmsg="${id}"]`);
  rowMsg.className = "msg muted small";
  rowMsg.textContent = status === "approved" ? "正在通过…" : "正在驳回…";

  const { error } = await supabase
    .from("photos")
    .update({ status })
    .eq("id", id);

  if (error) {
    rowMsg.className = "msg err small";
    rowMsg.textContent = "操作失败：" + error.message;
    console.error("[approveOrReject] error:", error);
    return false;
  }

  rowMsg.className = "msg ok small";
  rowMsg.textContent = "已更新为 " + status + " ✅";

  setTimeout(() => {
    const item = rowMsg.closest(".item");
    if (item) item.remove();
    if (!listEl.children.length) show(emptyEl);
  }, 600);

  return true;
}

/** ====== 会话 UI 切换 ====== */
async function refreshUI() {
  const { data: { session } } = await supabase.auth.getSession();
  console.log("[refreshUI] session:", session);

  // 处于密码找回流程时，显示 resetCard（supabase 会把 session 注入）
  const urlParams = new URLSearchParams(location.search);
  const hash = location.hash || "";
  const isRecovery = hash.includes("recovery") || urlParams.get("type") === "recovery";
  // 注意：实际 recovery 事件我们用 onAuthStateChange 更稳，下面只是兜底

  if (isRecovery) {
    hide(loginCard);
    hide(adminCard);
    hide(listCard);
    show(resetCard);
    setMsg(resetMsg, "请设置新密码。设置后将自动退出，需要用新密码重新登录。");
    return;
  }

  if (!session) {
    // 未登录
    show(loginCard);
    hide(resetCard);
    hide(adminCard);
    hide(listCard);
    setMsg(loginMsg, "未登录。请先登录管理员账号。");
    return;
  }

  // 已登录，检查管理员
  hide(resetCard);
  hide(loginCard);
  show(adminCard);

  const user = session.user;
  whoEl.textContent = user.email || user.id;
  roleEl.textContent = "user_id: " + user.id;

  let admin = false;
  try {
    admin = await isAdminByDB(user.id);
  } catch (e) {
    hide(listCard);
    setMsg(adminMsg, "检查管理员失败：" + (e?.message || e), "err");
    console.error("[isAdminByDB] exception:", e);
    return;
  }

  if (!admin) {
    hide(listCard);
    setMsg(adminMsg, "你已登录，但不是管理员（admins 表中没有你的 user_id）。", "err");
    return;
  }

  // 管理员：显示列表
  show(listCard);
  setMsg(adminMsg, "管理员验证通过 ✅", "ok");
  await loadPending();
}

/** ====== 登录（带 try/catch + 超时提示） ====== */
async function doLogin() {
  const email = emailEl.value.trim();
  const password = passEl.value;

  if (!email || !password) {
    setMsg(loginMsg, "请输入邮箱和密码。", "err");
    return;
  }

  setMsg(loginMsg, "正在登录…");

  // 8 秒仍未完成，就提示用户检查插件/隐私设置
  const t = setTimeout(() => {
    setMsg(
      loginMsg,
      "仍在登录…如果你开了广告拦截/隐私插件，可能会拦截请求或阻止写入会话。请关闭插件后刷新重试，并查看 Console / Network。",
      "err"
    );
  }, 8000);

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    clearTimeout(t);

    console.log("[signInWithPassword] data:", data, "error:", error);

    if (error) {
      setMsg(loginMsg, "登录失败：" + error.message, "err");
      return;
    }

    setMsg(loginMsg, "登录成功 ✅ 正在检查管理员权限…", "ok");
    await refreshUI();

  } catch (e) {
    clearTimeout(t);
    console.error("[doLogin] exception:", e);
    setMsg(loginMsg, "登录异常：" + (e?.message || e), "err");
  }
}

/** ====== 忘记密码：发邮件 ====== */
async function doForgotPassword() {
  const email = emailEl.value.trim();
  if (!email) {
    setMsg(loginMsg, "请输入邮箱后再点“忘记密码”。", "err");
    return;
  }

  setMsg(loginMsg, "正在发送找回邮件…");
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: RESET_REDIRECT // 回到 admin.html
    });

    if (error) {
      setMsg(loginMsg, "发送失败：" + error.message, "err");
      console.error("[resetPasswordForEmail] error:", error);
      return;
    }

    setMsg(
      loginMsg,
      "已发送找回邮件 ✅ 请去邮箱打开链接完成重置（可能在垃圾箱）。",
      "ok"
    );
  } catch (e) {
    console.error("[doForgotPassword] exception:", e);
    setMsg(loginMsg, "发送异常：" + (e?.message || e), "err");
  }
}

/** ====== 找回后设置新密码 ====== */
async function doSetNewPassword() {
  const newPassword = (newPassEl.value || "").trim();
  if (newPassword.length < 6) {
    setMsg(resetMsg, "新密码至少 6 位。", "err");
    return;
  }

  setMsg(resetMsg, "正在更新密码…");
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setMsg(resetMsg, "更新失败：" + error.message, "err");
      console.error("[updateUser] error:", error);
      return;
    }

    setMsg(resetMsg, "更新成功 ✅ 将退出登录，请用新密码重新登录。", "ok");
    setTimeout(async () => {
      await supabase.auth.signOut();
      location.href = BASE_URL + "admin.html";
    }, 900);

  } catch (e) {
    console.error("[doSetNewPassword] exception:", e);
    setMsg(resetMsg, "更新异常：" + (e?.message || e), "err");
  }
}

/** ====== 事件绑定 ====== */
$("btnLogin").addEventListener("click", doLogin);
$("btnForgot").addEventListener("click", doForgotPassword);

$("btnLogout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  await refreshUI();
});

$("btnReload").addEventListener("click", loadPending);

$("btnSetNewPass").addEventListener("click", doSetNewPassword);

listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === "approve") await approveOrReject(id, "approved");
  if (action === "reject") await approveOrReject(id, "rejected");
});

/** ====== auth 状态变化：找回密码事件最关键 ====== */
supabase.auth.onAuthStateChange((event, session) => {
  console.log("[onAuthStateChange]", event, session);

  // PASSWORD_RECOVERY 时显示 resetCard
  if (event === "PASSWORD_RECOVERY") {
    hide(loginCard);
    hide(adminCard);
    hide(listCard);
    show(resetCard);
    setMsg(resetMsg, "请设置新密码。设置后将自动退出，需要用新密码重新登录。");
    return;
  }

  // 其他事件都刷新 UI
  refreshUI();
});

/** 初次加载 */
refreshUI();
