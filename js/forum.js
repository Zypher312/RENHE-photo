import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/** =========================
 *  你只需要改这里 3 行
 *  ========================= */
const SUPABASE_URL = "https://ymfwfruzhzpvexzqwbfq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_MaLbSbI140CBstTTP2ICmw_R8XEZNyy";
const SHARED_EMAIL = "1998@renhe.local"; // 只允许这个邮箱登录进入论坛

/** 论坛用哪张表存消息（你现在就是 comment） */
const TABLE = "comment";

/** 话题列表（你也可以随时改） */
const TOPICS = [
  { key: "daily_news", name: "每日爆料" },
  { key: "daily_match", name: "每日比赛" },
  { key: "daily_chat", name: "每日闲聊" },
  { key: "daily_nsfw", name: "每日NSFW" },
];

/** 限制长度：省数据库 */
const MAX_NICK = 24;
const MAX_TEXT = 500;

/** supabase client（单独 storageKey，避免和 admin 的登录互相串） */
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
    storageKey: "renhe-forum-auth",
  },
});

/** ===== DOM ===== */
const $ = (id) => document.getElementById(id);

const gateCard = $("gateCard");
const forumArea = $("forumArea");

const emailEl = $("email");
const passEl = $("password");

const btnEnter = $("btnEnter");
const btnExit = $("btnExit");
const gateMsg = $("gateMsg");

const topicTabs = $("topicTabs");
const nicknameEl = $("nickname");
const dayPicker = $("dayPicker");
const whoami = $("whoami");

const msgList = $("msgList");
const msgText = $("msgText");
const btnSend = $("btnSend");

/** ===== UI helpers ===== */
function setMsg(text, cls = "") {
  if (!gateMsg) return;
  gateMsg.className = "msg " + (cls || "");
  gateMsg.textContent = text || "";
}
function show(el) { el && el.classList.remove("hidden"); }
function hide(el) { el && el.classList.add("hidden"); }

function ymdToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** ===== 状态 ===== */
let currentTopic = TOPICS[0].key;

/** ===== 只允许共享账号 ===== */
async function enforceSharedEmail(session) {
  const email = session?.user?.email || "";
  if (!email) return false;

  if (email.toLowerCase() !== SHARED_EMAIL.toLowerCase()) {
    // 如果登录的不是共享账号，立刻踢出去
    await supabase.auth.signOut();
    setMsg("此账号无权限进入论坛（仅允许共享账号）。", "err");
    hide(forumArea);
    show(gateCard);
    btnExit.classList.add("hidden");
    return false;
  }
  return true;
}

/** ===== 渲染 tabs ===== */
function renderTabs() {
  topicTabs.innerHTML = "";
  for (const t of TOPICS) {
    const b = document.createElement("button");
    b.className = "tab" + (t.key === currentTopic ? " active" : "");
    b.type = "button";
    b.textContent = t.name;
    b.dataset.key = t.key;
    topicTabs.appendChild(b);
  }
}

/** ===== 拉消息 =====
 *  依赖 comment 表至少有这些字段：
 *  topic(text), day(date or text y-m-d), nickname(text), content(text), created_at(timestamp)
 */
async function loadMessages() {
  msgList.innerHTML = `<div class="muted">加载中…</div>`;

  const day = dayPicker.value || ymdToday();

  const { data, error } = await supabase
    .from(TABLE)
    .select("id, topic, day, nickname, content, created_at")
    .eq("topic", currentTopic)
    .eq("day", day)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    msgList.innerHTML = `<div class="msg err">加载失败：${escapeHtml(error.message)}</div>`;
    return;
  }

  if (!data || data.length === 0) {
    msgList.innerHTML = `<div class="muted">今天这个话题还没人说话。</div>`;
    return;
  }

  msgList.innerHTML = "";
  for (const row of data) {
    const nick = row.nickname || "匿名";
    const time = row.created_at ? new Date(row.created_at).toLocaleString() : "";
    const div = document.createElement("div");
    div.className = "msg-item";
    div.innerHTML = `
      <div class="msg-head">
        <b>${escapeHtml(nick)}</b>
        <span class="muted small">${escapeHtml(time)}</span>
      </div>
      <div class="msg-body">${escapeHtml(row.content || "")}</div>
    `;
    msgList.appendChild(div);
  }

  // 拉到底部
  msgList.scrollTop = msgList.scrollHeight;
}

/** ===== 发消息 ===== */
async function sendMessage() {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) {
    setMsg("请先登录。", "err");
    return;
  }
  const ok = await enforceSharedEmail(session);
  if (!ok) return;

  const day = dayPicker.value || ymdToday();
  const nickname = (nicknameEl.value || "").trim().slice(0, MAX_NICK);
  const content = (msgText.value || "").trim().slice(0, MAX_TEXT);

  if (!content) return;

  btnSend.disabled = true;
  btnSend.textContent = "发送中…";

  const { error } = await supabase.from(TABLE).insert({
    topic: currentTopic,
    day,
    nickname,
    content,
  });

  btnSend.disabled = false;
  btnSend.textContent = "发送";

  if (error) {
    msgList.insertAdjacentHTML(
      "afterbegin",
      `<div class="msg err">发送失败：${escapeHtml(error.message)}</div>`
    );
    return;
  }

  msgText.value = "";
  await loadMessages();
}

/** ===== 登录/退出 ===== */
async function doLogin() {
  const email = (emailEl.value || "").trim();
  const password = (passEl.value || "").trim();

  if (!email || !password) {
    setMsg("请填写邮箱和密码。", "err");
    return;
  }

  setMsg("正在登录…");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    setMsg("登录失败：" + error.message, "err");
    return;
  }

  const ok = await enforceSharedEmail(data.session);
  if (!ok) return;

  setMsg("登录成功 ✅", "ok");
  await refreshUI();
}

async function doLogout() {
  await supabase.auth.signOut();
  setMsg("已退出。");
  await refreshUI();
}

/** ===== 刷新 UI ===== */
async function refreshUI() {
  const { data: { session } } = await supabase.auth.getSession();

  // 未登录：只显示 gate
  if (!session) {
    show(gateCard);
    hide(forumArea);
    btnExit.classList.add("hidden");
    setMsg("请输入共享账号邮箱 + 密码登录后进入论坛。");
    return;
  }

  // 已登录但不是共享邮箱：踢出
  const ok = await enforceSharedEmail(session);
  if (!ok) return;

  // 已登录 & 是共享邮箱：显示论坛
  hide(gateCard);
  show(forumArea);
  btnExit.classList.remove("hidden");
  setMsg("");

  whoami.textContent = `当前登录：${session.user.email}`;

  // 初始化：tabs + 日期 + 拉消息
  renderTabs();
  if (!dayPicker.value) dayPicker.value = ymdToday();
  await loadMessages();
}

/** ===== 事件绑定 ===== */
btnEnter.addEventListener("click", doLogin);
btnExit.addEventListener("click", doLogout);

topicTabs.addEventListener("click", async (e) => {
  const b = e.target.closest("button.tab");
  if (!b) return;
  currentTopic = b.dataset.key;
  renderTabs();
  await loadMessages();
});

dayPicker.addEventListener("change", loadMessages);

btnSend.addEventListener("click", sendMessage);

msgText.addEventListener("keydown", (e) => {
  // Ctrl+Enter 发送
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    sendMessage();
  }
});

/** ===== auth 状态变化监听 ===== */
supabase.auth.onAuthStateChange(() => {
  refreshUI();
});

/** 初次加载 */
refreshUI();
