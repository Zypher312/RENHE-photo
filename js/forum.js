import { supabase } from "./supabase.js"; // 如果你项目用的是 supabaseClient.js，就把这里改成 "./supabaseClient.js"

const FORUM_EMAIL = "forum@renhe.local"; // 改成你在 Supabase Auth 创建的那个论坛账号邮箱
const TABLE = "comment";

const TOPICS = ["每日爆料", "每日比赛", "每日闲聊", "每日NSFW"];

const $ = (id) => document.getElementById(id);

const loginCard = $("loginCard");
const forumCard = $("forumCard");

const passEl = $("pass");
const loginMsg = $("loginMsg");

const topicTabs = $("topicTabs");
const listEl = $("list");

const nicknameEl = $("nickname");
const dayEl = $("day");
const contentEl = $("content");
const sendMsg = $("sendMsg");

let currentTopic = TOPICS[0];
let currentDay = toYMD(new Date());

function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }

function setMsg(el, text, cls="muted"){
  el.className = "msg " + cls + " small";
  el.textContent = text || "";
}

function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function toYMD(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function renderTabs(){
  topicTabs.innerHTML = "";
  for (const t of TOPICS){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline btn-mini";
    btn.textContent = t;
    if (t === currentTopic) btn.style.borderColor = "#111827";
    btn.addEventListener("click", async () => {
      currentTopic = t;
      renderTabs();
      await loadPosts();
    });
    topicTabs.appendChild(btn);
  }
}

async function loadPosts(){
  listEl.innerHTML = `<div class="muted">加载中...</div>`;

  const { data, error } = await supabase
    .from(TABLE)
    .select("id,day,topic,nickname,content,created_at")
    .eq("day", currentDay)
    .eq("topic", currentTopic)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error){
    listEl.innerHTML = `<div class="msg err small">读取失败：${esc(error.message)}</div>`;
    return;
  }

  if (!data || data.length === 0){
    listEl.innerHTML = `<div class="muted">今天这个主题还没有人发言。</div>`;
    return;
  }

  listEl.innerHTML = data.map(row => {
    const who = row.nickname ? esc(row.nickname) : "匿名";
    const time = row.created_at ? new Date(row.created_at).toLocaleString() : "";
    return `
      <div class="card" style="margin:10px 0;">
        <div class="muted small"><b>${who}</b> · ${esc(time)}</div>
        <div style="margin-top:8px; white-space:pre-wrap;">${esc(row.content)}</div>
      </div>
    `;
  }).join("");
}

async function showLogin(){
  show(loginCard);
  hide(forumCard);
  setMsg(loginMsg, "");
}

async function showForum(){
  hide(loginCard);
  show(forumCard);

  dayEl.value = currentDay;
  renderTabs();
  await loadPosts();
}

$("btnLogin").addEventListener("click", async () => {
  const password = (passEl.value || "").trim();
  if (!password) {
    setMsg(loginMsg, "请输入通行证。", "err");
    return;
  }

  setMsg(loginMsg, "正在验证通行证...");

  const { error } = await supabase.auth.signInWithPassword({
    email: FORUM_EMAIL,
    password
  });

  if (error){
    setMsg(loginMsg, "通行证错误或登录失败：" + error.message, "err");
    return;
  }

  setMsg(loginMsg, "进入成功 ✅", "ok");
  await showForum();
});

$("btnLogout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  await showLogin();
});

dayEl.addEventListener("change", async () => {
  currentDay = dayEl.value || toYMD(new Date());
  await loadPosts();
});

$("btnSend").addEventListener("click", async () => {
  const content = (contentEl.value || "").trim();
  const nickname = (nicknameEl.value || "").trim();

  if (!content){
    setMsg(sendMsg, "请输入内容。", "err");
    return;
  }
  if (content.length > 500){
    setMsg(sendMsg, "内容太长（最多 500 字）。", "err");
    return;
  }

  setMsg(sendMsg, "发送中...");

  const { error } = await supabase
    .from(TABLE)
    .insert({
      day: currentDay,
      topic: currentTopic,
      nickname: nickname || null,
      content
    });

  if (error){
    setMsg(sendMsg, "发送失败：" + error.message, "err");
    return;
  }

  contentEl.value = "";
  setMsg(sendMsg, "已发送 ✅", "ok");
  await loadPosts();
});

(async function init(){
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await showForum();
  else await showLogin();

  supabase.auth.onAuthStateChange(async (_e, s) => {
    if (s) await showForum();
    else await showLogin();
  });
})();
