import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/** ========= 你需要填这两个（用 anon / publishable key） =========
 *  - URL：Project Settings -> API 里的 Project URL
 *  - KEY：Publishable / anon key（可以放前端）
 */
const SUPABASE_URL = "https://ymfwfruzhzpvexzqwbfq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_MaLbSbI140CBstTTP2ICmw_R8XEZNyy";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "renhe-forum-auth",
  },
});

/** ====== 论坛配置 ====== */
const TABLE = "comment";
const TOPICS = [
  { key: "daily_news", name: "每日爆料" },
  { key: "daily_match", name: "每日比赛" },
  { key: "daily_chat", name: "每日闲聊" },
  { key: "daily_nsfw", name: "每日涩涩" },
];

/** ====== DOM ====== */
const $ = (id) => document.getElementById(id);

const gateMsg = $("gateMsg");
const gateCard = $("gateCard");
const forumArea = $("forumArea");

const emailEl = $("email");
const passwordEl = $("password");
const btnEnter = $("btnEnter");
const btnExit = $("btnExit");

const whoami = $("whoami");
const topicTabs = $("topicTabs");
const nicknameEl = $("nickname");
const dayPicker = $("dayPicker");
const msgList = $("msgList");
const msgText = $("msgText");
const btnSend = $("btnSend");

function show(el) { el && el.classList.remove("hidden"); }
function hide(el) { el && el.classList.add("hidden"); }

function setMsg(text, cls = "") {
  if (!gateMsg) return;
  gateMsg.className = "msg " + cls;
  gateMsg.textContent = text || "";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

let currentTopic = TOPICS[0].key;

async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

function renderTabs() {
  if (!topicTabs) return;
  topicTabs.innerHTML = "";
  for (const t of TOPICS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = t.name;
    b.className = (t.key === currentTopic) ? "tab active" : "tab";
    b.addEventListener("click", async () => {
      currentTopic = t.key;
      renderTabs();
      await loadMessages();
    });
    topicTabs.appendChild(b);
  }
}

function renderMessages(rows) {
  if (!msgList) return;
  msgList.innerHTML = "";

  if (!rows.length) {
    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = "今天还没人发言。";
    msgList.appendChild(p);
    return;
  }

  for (const r of rows) {
    const item = document.createElement("div");
    item.className = "msg-item";

    const nick = escapeHtml(r.nickname || "匿名");
    const time = escapeHtml(new Date(r.created_at).toLocaleString());
    const text = escapeHtml(r.content || "");

    item.innerHTML = `
      <div class="msg-head">
        <b>${nick}</b>
        <span class="muted small">${time}</span>
      </div>
      <div class="msg-body">${text}</div>
    `;
    msgList.appendChild(item);
  }
}

async function loadMessages() {
  if (!msgList) return;

  const day = dayPicker?.value || todayYMD();
  msgList.innerHTML = `<div class="muted">加载中…</div>`;

  const { data, error } = await supabase
    .from(TABLE)
    .select("id, topic, day, nickname, content, created_at")
    .eq("topic", currentTopic)
    .eq("day", day)
    .order("created_at", { ascending: true });

  if (error) {
    msgList.innerHTML = "";
    const d = document.createElement("div");
    d.className = "msg err";
    d.textContent = "加载失败：" + error.message;
    msgList.appendChild(d);
    return;
  }

  renderMessages(data || []);
}

async function sendMessage() {
  const session = await getSession();
  if (!session) {
    alert("你还没登录。");
    return;
  }

  const day = dayPicker?.value || todayYMD();
  const nickname = (nicknameEl?.value || "").trim().slice(0, 24);
  const content = (msgText?.value || "").trim();

  if (!content) return alert("请输入内容。");
  if (content.length > 300) return alert("太长了，建议 300 字以内（更省数据库）。");

  btnSend && (btnSend.disabled = true);

  const row = {
    topic: currentTopic,
    day,
    nickname: nickname || "匿名",
    content, // emoji/颜文字 OK（UTF-8）
    // 如果你 comment 表里有 user_id 字段，可以加：
    // user_id: session.user.id,
  };

  const { error } = await supabase.from(TABLE).insert(row);

  btnSend && (btnSend.disabled = false);

  if (error) {
    alert("发送失败：" + error.message);
    return;
  }

  msgText.value = "";
  await loadMessages();
}

/** ====== 登录/退出 ====== */
async function login() {
  const email = (emailEl?.value || "").trim();
  const password = passwordEl?.value || "";
  if (!email || !password) return setMsg("请输入账号和密码。", "err");

  setMsg("正在登录…");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return setMsg("登录失败：" + error.message, "err");

  setMsg("登录成功 ✅", "ok");
  await refreshUI();
}

async function logout() {
  await supabase.auth.signOut();
  setMsg("已退出。");
  await refreshUI();
}

/** ====== 刷新 UI：未登录隐藏论坛 ====== */
async function refreshUI() {
  const session = await getSession();

  if (!session) {
    hide(forumArea);
    show(gateCard);
    hide(btnExit);
    show(btnEnter);
    whoami && (whoami.textContent = "");
    setMsg("请登录进入论坛。");
    return;
  }

  // 已登录
  show(forumArea);
  show(gateCard); // 你也可以改为 hide(gateCard) 只留退出按钮
  show(btnExit);
  show(btnEnter);

  whoami && (whoami.textContent = `已登录：${session.user.email}`);

  if (dayPicker && !dayPicker.value) dayPicker.value = todayYMD();
  renderTabs();
  await loadMessages();
}

/** ====== 绑定事件 ====== */
btnEnter?.addEventListener("click", login);
btnExit?.addEventListener("click", logout);
btnSend?.addEventListener("click", sendMessage);
dayPicker?.addEventListener("change", loadMessages);

supabase.auth.onAuthStateChange(() => refreshUI());
refreshUI();
