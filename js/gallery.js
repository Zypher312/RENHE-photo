async function loadManifest() {
  const res = await fetch("assets/manifest.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load assets/manifest.json");
  return await res.json();
}

function groupByYear(items) {
  const map = new Map();
  for (const it of items) {
    const year = it.year || "unknown";
    if (!map.has(year)) map.set(year, []);
    map.get(year).push(it);
  }
  // year desc
  return Array.from(map.entries()).sort((a, b) => String(b[0]).localeCompare(String(a[0])));
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function thumbPathFromFull(src) {
  // 如果你有 thumbs，就把 full -> thumbs
  // 例：assets/full/2026/other/xxx.jpg -> assets/thumbs/2026/other/xxx.jpg
  return src.replace("/full/", "/thumbs/");
}

function buildYearSection(year, items) {
  const section = document.createElement("section");
  section.className = "year-section";

  const h2 = document.createElement("h2");
  h2.textContent = year;
  section.appendChild(h2);

  const grid = document.createElement("div");
  grid.className = "photo-grid";

  for (const it of items) {
    const full = it.src;                 // 高清图
    const thumb = thumbPathFromFull(it.src); // 缩略图（如果不存在也没事，会 fallback）

    const caption = [
      it.category ? `分类：${it.category}` : "",
      it.taken_at ? `拍摄：${it.taken_at}` : "",
      it.uploader_name ? `上传者：${it.uploader_name}` : "",
      it.people ? `人物：${it.people}` : "",
    ].filter(Boolean).join(" · ");

    const a = document.createElement("a");
    a.href = full;
    a.target = "_blank"; // 先用最简单：新标签打开高清图（你如果想用 lightbox 我也可以改）
    a.rel = "noopener";

    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = caption || `photo-${it.id}`;

    // 优先 thumb，不存在就用 full
    img.src = thumb;
    img.onerror = () => { img.src = full; };

    const meta = document.createElement("div");
    meta.className = "photo-meta";
    meta.textContent = caption;

    const card = document.createElement("div");
    card.className = "photo-card";
    a.appendChild(img);
    card.appendChild(a);
    card.appendChild(meta);

    grid.appendChild(card);
  }

  section.appendChild(grid);
  return section;
}

async function main() {
  const root = document.getElementById("gallery-root");
  root.innerHTML = "<p>Loading...</p>";

  try {
    const items = await loadManifest();

    if (!Array.isArray(items) || items.length === 0) {
      root.innerHTML = "<p>暂无照片</p>";
      return;
    }

    // 可选：按 taken_at desc
    items.sort((a, b) => String(b.taken_at || "").localeCompare(String(a.taken_at || "")));

    const groups = groupByYear(items);

    root.innerHTML = "";
    for (const [year, list] of groups) {
      root.appendChild(buildYearSection(year, list));
    }
  } catch (e) {
    console.error(e);
    root.innerHTML = `<p style="color:red;">加载失败：${escapeHtml(e.message)}</p>`;
  }
}

main();
