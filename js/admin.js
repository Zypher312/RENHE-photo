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
    storageKey: "renhe-photo-auth",
  },
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
  if (!el) return;
  el.className = "msg " + cls + " small";
  el.textContent = text || "";
}
function show(el) { el && el.classList.remove("hidden"); }
function hide(el) { el && el.classList.add("hidden"); }

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function publicUrl(pathInBucket) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathInBucket);
  return data?.publicUrl || "";
}

function fmtDateYMD(s) {
  // s 可能是 yyyy-mm-dd 或 ISO
  if (!s) return "";
  try {
    // yyyy-mm-dd 直接返回更直观
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return String(s);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return String(s);
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 兼容旧浏览器
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
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

/** ====== 渲染：单条卡片（新布局） ====== */
function renderPendingItem(row) {
  const img = publicUrl(row.image_path);
  const uploader = row.uploader_name || "（未填）";
  const category = row.category || "未分类";
  const year = row.year || (row.taken_at ? new Date(row.taken_at).getFullYear() : "");
  const taken = fmtDateYMD(row.taken_at);
  const people = row.people || "无";
  const path = row.image_path || "";

  const item = document.createElement("div");
  item.className = "pending-item";
  item.dataset.itemid = row.id;

  // 用 data-* 存一下，后面复制/打开原图/错误回退用
  item.dataset.img = img;
  item.dataset.path = path;

  item.innerHTML = `
    <div class="pending-top">
      <div class="preview">
        <div class="badge">PENDING</div>
        <img class="preview-img" src="${escapeHtml(img)}" alt="preview" loading="lazy" />
      </div>

      <div class="side">
        <div class="side-head">
          <div style="min-width:0;">
            <h3 class="title">${escapeHtml(uploader)}</h3>
            <div class="muted small" style="margin-top:2px;">投稿信息</div>
          </div>
          <span class="chip">${escapeHtml(category)} · ${escapeHtml(String(year))}</span>
        </div>

        <div class="meta-grid">
          <div class="k">拍摄日期</div><div class="v">${escapeHtml(taken || "未填")}</div>
          <div class="k">人物</div><div class="v">${escapeHtml(people)}</div>
          <div class="k">状态</div><div class="v"><b>pending</b></div>
        </div>

        <details class="path">
          <summary>
            <span>image_path</span>
            <span class="muted small">展开 / 收起</span>
          </summary>
          <div class="path-box">
            <div class="path-code">${escapeHtml(path)}</div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              <button class="btn btn-outline btn-mini" type="button" data-action="copy_path" data-id="${row.id}">复制</button>
              <a class="btn btn-outline btn-mini" href="${escapeHtml(img)}" target="_blank" rel="noopener">打开原图</a>
            </div>
          </div>
        </details>

        <div class="msg muted small" data-rowmsg="${row.id}"></div>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-bad btn-mini" type="button" data-action="reject" data-id="${row.id}">驳回</button>
      <button class="btn btn-ok btn-mini" type="button" data-action="approve" data-id="${row.id}">通过</button>
    </div>
  `;

  // 图片加载失败：换成友好提示，不留破图标
  const imgEl = item.querySelector(".preview-img");
  imgEl.addEventListener("error", () => {
    imgEl.remove();
    const ph = document.createElement("div");
    ph.style.color = "rgba(255,255,255,.85)";
    ph.style.padding = "18px";
    ph.style.textAlign = "center";
    ph.innerHTML = `
      <div style="font-weight:900; font-size:14px; margin-bottom:6px;">预览加载失败</div>
      <div style="font-size:12px; opacity:.85; line-height:1.45;">
        可能是 Storage 未公开 / policy 限制，或链接过期。<br/>
        你仍可使用“打开原图”查看。
      </div>
    `;
    item.querySelector(".preview").appendChild(ph);
  });

  return item;
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
    listEl.appendChild(renderPendingItem(row));
  }
}

/** ====== 审核操作 ====== */
async function approveOrReject(id, status) {
  const rowMsg = document.querySelector(`[data-rowmsg="${id}"]`);
  if (rowMsg) {
    rowMsg.className = "msg muted small";
    rowMsg.textContent = status === "approved" ? "正在通过…" : "正在驳回…";
  }

  const { error } = await supabase
    .from("photos")
    .update({ status })
    .eq("id", id);

  if (error) {
    if (rowMsg) {
      rowMsg.className = "msg err small";
      rowMsg.textContent = "操作失败：" + error.message;
    }
    console.error("[approveOrReject] error:", error);
    return false;
  }

  if (rowMsg) {
    rowMsg.className = "msg ok small";
    rowMsg.textContent = "已更新为 " + status + " ✅";
  }

  setTimeout(() => {
    const item = document.querySelector(`.pending-item[data-itemid="${id}"]`);
    if (item) item.remove();
    if (!listEl.children.length) show(emptyEl);
  }, 650);

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

  if (isRecovery) {
    hide(loginCard);
    hide(adminCard);
    hide(listCard);
    show(resetCard);
    setMsg(resetMsg, "请设置新密码。设置后将自动退出，需要用新密码重新登录。");
    return;
  }

  if (!session) {
    show(loginCard);
    hide(resetCard);
    hide(adminCard);
    hide(listCard);
    setMsg(loginMsg, "未登录。请先登录管理员账号。");
    return;
  }

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
      redirectTo: RESET_REDIRECT,
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

/**
 * 列表点击：approve/reject + 复制 image_path
 * - “打开原图”是 <a>，不走这里
 */
listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === "approve") await approveOrReject(id, "approved");
  if (action === "reject") await approveOrReject(id, "rejected");

  if (action === "copy_path") {
    const item = document.querySelector(`.pending-item[data-itemid="${id}"]`);
    const path = item?.dataset?.path || "";
    const rowMsg = document.querySelector(`[data-rowmsg="${id}"]`);

    if (!path) {
      if (rowMsg) {
        rowMsg.className = "msg err small";
        rowMsg.textContent = "复制失败：找不到 image_path";
      }
      return;
    }

    const ok = await copyToClipboard(path);
    if (rowMsg) {
      rowMsg.className = "msg " + (ok ? "ok" : "err") + " small";
      rowMsg.textContent = ok ? "已复制 image_path ✅" : "复制失败（浏览器权限限制）";
    }
  }
});

/** ====== auth 状态变化：找回密码事件最关键 ====== */
supabase.auth.onAuthStateChange((event, session) => {
  console.log("[onAuthStateChange]", event, session);

  if (event === "PASSWORD_RECOVERY") {
    hide(loginCard);
    hide(adminCard);
    hide(listCard);
    show(resetCard);
    setMsg(resetMsg, "请设置新密码。设置后将自动退出，需要用新密码重新登录。");
    return;
  }

  refreshUI();
});

/** 初次加载 */
refreshUI();
