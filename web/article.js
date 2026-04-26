const params = new URLSearchParams(window.location.search);
const url = params.get("url") || "";

const titleNode = document.getElementById("articleTitle");
const contentNode = document.getElementById("articleContent");
const sourceNode = document.getElementById("sourceLink");
const backBtn = document.getElementById("backBtn");
const readingTimeNode = document.getElementById("readingTime");
const langBadgeNode = document.getElementById("langBadge");

backBtn.addEventListener("click", () => {
  window.location.href = "/?view=browse";
});

function estimateReadingTime(text) {
  const words = text.trim().split(/\s+/).length;
  const minutes = Math.ceil(words / 400);
  return minutes < 1 ? "不到 1 分钟" : `约 ${minutes} 分钟`;
}

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

  // Show loading skeleton
  contentNode.innerHTML = `
    <div class="skeleton" style="height:24px;width:70%;margin-bottom:16px"></div>
    <div class="skeleton" style="height:16px;width:100%;margin-bottom:8px"></div>
    <div class="skeleton" style="height:16px;width:90%;margin-bottom:8px"></div>
    <div class="skeleton" style="height:16px;width:95%;margin-bottom:8px"></div>
    <div class="skeleton" style="height:16px;width:80%;margin-bottom:24px"></div>
    <div class="skeleton" style="height:16px;width:100%;margin-bottom:8px"></div>
    <div class="skeleton" style="height:16px;width:85%;margin-bottom:8px"></div>
    <div class="skeleton" style="height:16px;width:92%;margin-bottom:8px"></div>
  `;

  fetch(`/api/news/detail?url=${encodeURIComponent(url)}`)
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      return resp.json();
    })
    .then((data) => {
      const text = data.content || "未提取到正文内容";

      if (window.marked?.parse) {
        contentNode.innerHTML = window.marked.parse(text);
      } else {
        contentNode.textContent = text;
      }

      // Estimate reading time
      if (readingTimeNode) {
        readingTimeNode.textContent = `预计阅读 ${estimateReadingTime(text)}`;
      }
    })
    .catch((err) => {
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
