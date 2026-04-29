const params = new URLSearchParams(window.location.search);
const url = params.get("url") || "";

const titleNode = document.getElementById("articleTitle");
const contentNode = document.getElementById("articleContent");
const sourceNode = document.getElementById("sourceLink");
const backBtn = document.getElementById("backBtn");
const readingTimeNode = document.getElementById("readingTime");
const langBadgeNode = document.getElementById("langBadge");
const likeBtn = document.getElementById("articleLikeBtn");
const favoriteBtn = document.getElementById("articleFavoriteBtn");

const AUTH_TOKEN_KEY = "newsAgent.token";
const currentToken = sessionStorage.getItem(AUTH_TOKEN_KEY);

function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (currentToken) headers["Authorization"] = `Bearer ${currentToken}`;
  return fetch(path, { ...options, headers });
}

function getArticleState() {
  return JSON.parse(sessionStorage.getItem(`newsAgent.article_${btoa(url)}`) || "{}");
}
function setArticleState(key, val) {
  const s = getArticleState();
  s[key] = val;
  sessionStorage.setItem(`newsAgent.article_${btoa(url)}`, JSON.stringify(s));
}

backBtn.addEventListener("click", () => {
  window.location.href = "/?view=browse";
});

function estimateReadingTime(text) {
  const words = text.trim().split(/\s+/).length;
  const minutes = Math.ceil(words / 400);
  return minutes < 1 ? "不到 1 分钟" : `约 ${minutes} 分钟`;
}

function applyArticleState() {
  const s = getArticleState();
  if (s.like) likeBtn.classList.add("active-like");
  if (s.favorite) favoriteBtn.classList.add("active-favorite");
}

likeBtn.addEventListener("click", () => {
  if (!currentToken) { sessionStorage.setItem("newsAgent.pendingAuth", url); return; }
  const s = getArticleState();
  const newVal = !s.like;
  setArticleState("like", newVal);
  likeBtn.classList.toggle("active-like", newVal);
  apiFetch("/api/article/action", {
    method: "POST",
    body: JSON.stringify({ url, action: "like" }),
  }).catch(() => {});
});

favoriteBtn.addEventListener("click", () => {
  if (!currentToken) { sessionStorage.setItem("newsAgent.pendingAuth", url); return; }
  const s = getArticleState();
  const newVal = !s.favorite;
  setArticleState("favorite", newVal);
  favoriteBtn.classList.toggle("active-favorite", newVal);
  apiFetch("/api/article/action", {
    method: "POST",
    body: JSON.stringify({ url, action: "favorite" }),
  }).catch(() => {});
});

if (!url) {
  titleNode.textContent = "缺少新闻链接";
  contentNode.textContent = "未检测到 url 参数，请返回新闻浏览页重新打开。";
  contentNode.style.color = "var(--text-3)";
  sourceNode.style.display = "none";
  readingTimeNode.style.display = "none";
} else {
  sourceNode.href = url;
  sourceNode.innerHTML = `
    <svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
    打开原文
  `;

  // Record view
  if (currentToken) {
    apiFetch("/api/article/view", {
      method: "POST",
      body: JSON.stringify({ url }),
    }).catch(() => {});
  }

  // Fetch article content and DB action state in parallel
  Promise.all([
    fetch(`/api/news/detail?url=${encodeURIComponent(url)}`).then(r => r.json()),
    currentToken
      ? apiFetch(`/api/article/actions/by-url?url=${encodeURIComponent(url)}`).then(r => r.ok ? r.json() : {})
      : Promise.resolve({}),
  ])
    .then(([articleData, actionData]) => {
      // Apply DB state as primary source, then overlay sessionStorage for optimistic UX
      const dbLike = !!actionData.like;
      const dbFav = !!actionData.favorite;
      if (!dbLike) likeBtn.classList.toggle("active-like", !!getArticleState().like);
      else likeBtn.classList.toggle("active-like", dbLike);
      if (!dbFav) favoriteBtn.classList.toggle("active-favorite", !!getArticleState().favorite);
      else favoriteBtn.classList.toggle("active-favorite", dbFav);
      if (dbLike || dbFav) {
        setArticleState("like", dbLike);
        setArticleState("favorite", dbFav);
      }

      const text = articleData.content || "未提取到正文内容";
      if (window.marked?.parse) {
        contentNode.innerHTML = window.marked.parse(text);
      } else {
        contentNode.textContent = text;
      }
      if (readingTimeNode) {
        readingTimeNode.textContent = `预计阅读 ${estimateReadingTime(text)}`;
      }
    })
    .catch((err) => {
      // Fallback: try sessionStorage state and show error
      applyArticleState();
      contentNode.innerHTML = `
        <div style="text-align:center;padding:40px 0;color:var(--text-3)">
          <div style="font-size:2rem;margin-bottom:12px">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="var(--text-3)" style="opacity:0.4">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
          </div>
          <p style="font-size:0.95rem">正文加载失败: ${err.message}</p>
          <p style="font-size:0.82rem;margin-top:8px">请检查网络连接，或尝试直接访问原文链接。</p>
        </div>
      `;
    });
}
