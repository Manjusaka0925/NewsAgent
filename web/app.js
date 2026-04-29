const views = {
  home: document.getElementById("view-home"),
  browse: document.getElementById("view-browse"),
  weather: document.getElementById("view-weather"),
  stock: document.getElementById("view-stock"),
  chat: document.getElementById("view-chat"),
  profile: document.getElementById("view-profile"),
};

const navButtons = document.querySelectorAll(".nav-btn");
const startBtn = document.getElementById("startBtn");
const statusBox = document.getElementById("statusBox");
const nextNewsBtn = document.getElementById("nextNewsBtn");
const prevNewsBtn = document.getElementById("prevNewsBtn");
const refreshBtn = document.getElementById("refreshBtn");
const newsStream = document.getElementById("newsStream");
const browseCaption = document.getElementById("browseCaption");
const chatEmpty = document.getElementById("chatEmpty");

const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatWindow = document.getElementById("chatWindow");
const chatCaption = document.getElementById("chatCaption");

let loadingNews = false;
let newsCount = 0;
let newsHistory = [];
let historyIndex = 0;

const WEATHER_STATE_KEY = "newsAgent.weatherState";
const WEATHER_CACHE_KEY = "newsAgent.weatherCache";
const WEATHER_AVAILABLE_CITIES = [
  "北京", "天津", "上海", "重庆", "哈尔滨", "长春", "沈阳", "呼和浩特",
  "石家庄", "太原", "西安", "兰州", "西宁", "银川", "乌鲁木齐", "拉萨",
  "郑州", "武汉", "长沙", "南京", "杭州", "合肥", "南昌", "福州", "台北",
  "济南", "青岛", "昆明", "贵阳", "南宁", "广州", "海口", "成都", "深圳",
  "香港", "澳门", "厦门", "苏州", "大连", "宁波",
];
let _weatherInited = false;

function saveWeatherState(cards) {
  try {
    sessionStorage.setItem(WEATHER_STATE_KEY, JSON.stringify(cards));
  } catch (_) {}
}

function restoreWeatherState() {
  try {
    const raw = sessionStorage.getItem(WEATHER_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function saveWeatherCache(id, data) {
  try {
    const raw = sessionStorage.getItem(WEATHER_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[id] = data;
    sessionStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cache));
  } catch (_) {}
}

function restoreWeatherCache() {
  try {
    const raw = sessionStorage.getItem(WEATHER_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function getDefaultWeatherCards() {
  return [
    { id: "card-0", city: "天津", days: 5 },
    { id: "card-1", city: "北京", days: 5 },
    { id: "card-2", city: "上海", days: 5 },
  ];
}

const WEATHER_ICONS = {
  "晴": "☀️", "多云": "⛅", "阴": "☁️", "小雨": "🌧️", "中雨": "🌧️",
  "大雨": "⛈️", "暴雨": "⛈️", "雷阵雨": "⛈️", "阵雨": "🌧️", "小雪": "🌨️",
  "中雪": "🌨️", "大雪": "❄️", "暴雪": "❄️", "雨夹雪": "🌨️", "雾": "🌫️",
  "霾": "🌫️", "沙尘": "🌪️", "扬沙": "🌪️", "浮尘": "🌪️", "雾霾": "🌫️",
};

function getWeatherIcon(weather) {
  return WEATHER_ICONS[weather] || "🌤️";
}

function getWeekDay(weekNum) {
  const map = { "1": "周一", "2": "周二", "3": "周三", "4": "周四", "5": "周五", "6": "周六", "7": "周日" };
  return map[String(weekNum)] || "周" + weekNum;
}

function formatDateShort(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"));
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}月${day}日`;
}

function renderWeatherCard(cardData, weatherData, isLoading = false) {
  const cardEl = document.getElementById(cardData.id);
  if (!cardEl) return;

  if (isLoading) {
    cardEl.innerHTML = `
      <div class="weather-card-header">
        <div class="weather-card-title">
          <div class="skeleton" style="width:80px;height:22px;border-radius:6px;"></div>
          <div class="skeleton" style="width:50px;height:22px;border-radius:6px;margin-left:6px;"></div>
        </div>
        <div class="skeleton" style="width:60px;height:22px;border-radius:6px;"></div>
      </div>
      <div class="weather-loading">
        <div class="spinner"></div>
        <span>加载天气数据...</span>
      </div>`;
    return;
  }

  if (weatherData.error) {
    cardEl.innerHTML = `
      <div class="weather-card-header">
        <div class="weather-card-title">
          <span class="weather-city-name">${cardData.city}</span>
        </div>
        <select class="weather-days-select" data-card-id="${cardData.id}">
          ${[3, 4, 5, 6, 7].map(d => `<option value="${d}" ${d === cardData.days ? 'selected' : ''}>${d}天</option>`).join("")}
        </select>
      </div>
      <div class="weather-error">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="var(--red)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        <span>${weatherData.error}</span>
      </div>`;
    setupWeatherCardControls(cardData);
    return;
  }

  const casts = weatherData.casts || [];
  const today = casts[0] || {};
  const todayIcon = getWeatherIcon(today.dayweather);
  const todayTemp = `${today.nighttemp || '--'}° ~ ${today.daytemp || '--'}°`;

  const forecastDays = casts.slice(1);

  cardEl.innerHTML = `
    <div class="weather-card-header">
      <div class="weather-card-title">
        <span class="weather-city-name">${weatherData.city || cardData.city}</span>
        <span class="weather-reporttime">${weatherData.reporttime ? '更新: ' + weatherData.reporttime.slice(-8, -3) : ''}</span>
      </div>
      <div class="weather-card-header-right">
        <select class="weather-city-select" data-card-id="${cardData.id}">
          ${WEATHER_AVAILABLE_CITIES.map(c => `<option value="${c}" ${c === cardData.city ? 'selected' : ''}>${c}</option>`).join("")}
        </select>
        <select class="weather-days-select" data-card-id="${cardData.id}">
          ${[3, 4, 5, 6, 7].map(d => `<option value="${d}" ${d === cardData.days ? 'selected' : ''}>${d}天</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="weather-today">
      <div class="weather-today-main">
        <span class="weather-today-icon">${todayIcon}</span>
        <div class="weather-today-info">
          <span class="weather-today-temp">${todayTemp}</span>
          <span class="weather-today-desc">${today.dayweather || today.nightweather || '--'}</span>
        </div>
      </div>
    </div>

    ${forecastDays.length > 0 ? `
    <div class="weather-forecast">
      ${forecastDays.map(day => `
        <div class="weather-forecast-day">
          <span class="weather-forecast-week">${getWeekDay(day.week)}</span>
          <span class="weather-forecast-icon">${getWeatherIcon(day.dayweather)}</span>
          <span class="weather-forecast-temp">${day.nighttemp || '--'}° ~ ${day.daytemp || '--'}°</span>
        </div>
      `).join("")}
    </div>
    ` : ""}

    <div class="weather-advice">
      <div class="weather-advice-label">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
        出行建议
      </div>
      <p class="weather-advice-text">${weatherData.travel_advice || '暂无出行建议'}</p>
    </div>`;

  setupWeatherCardControls(cardData);
}

function setupWeatherCardControls(cardData) {
  const cardEl = document.getElementById(cardData.id);
  if (!cardEl) return;

  const citySelect = cardEl.querySelector(".weather-city-select");
  const daysSelect = cardEl.querySelector(".weather-days-select");

  if (citySelect) {
    citySelect.addEventListener("change", async (e) => {
      cardData.city = e.target.value;
      saveWeatherState(window._weatherCards);
      await loadWeatherCard(cardData);
    });
  }

  if (daysSelect) {
    daysSelect.addEventListener("change", async (e) => {
      cardData.days = parseInt(e.target.value, 10);
      saveWeatherState(window._weatherCards);
      await loadWeatherCard(cardData);
    });
  }
}

async function loadWeatherCard(cardData) {
  const cardEl = document.getElementById(cardData.id);
  if (!cardEl) return;

  renderWeatherCard(cardData, {}, true);

  try {
    const resp = await fetch(`/api/weather?city=${encodeURIComponent(cardData.city)}&days=${cardData.days}`);
    const data = await resp.json();
    if (!resp.ok) {
      renderWeatherCard(cardData, { error: data.detail || "加载失败" });
      return;
    }
    renderWeatherCard(cardData, data);
    saveWeatherCache(cardData.id, data);
  } catch (err) {
    renderWeatherCard(cardData, { error: "网络请求失败，请检查连接" });
  }
}

async function initWeatherView() {
  const container = document.getElementById("weatherCardsContainer");
  if (!container) return;

  if (_weatherInited) {
    const cards = restoreWeatherState() || getDefaultWeatherCards();
    const cache = restoreWeatherCache();
    cards.forEach(card => {
      const el = document.getElementById(card.id);
      if (el && cache[card.id]) {
        renderWeatherCard(card, cache[card.id]);
      }
    });
    return;
  }
  _weatherInited = true;

  let cards = restoreWeatherState();
  if (!cards) {
    cards = getDefaultWeatherCards();
    saveWeatherState(cards);
  }
  window._weatherCards = cards;

  const cache = restoreWeatherCache();
  container.innerHTML = cards.map(card => `<div class="weather-card" id="${card.id}"></div>`).join("");

  cards.forEach(card => {
    const el = document.getElementById(card.id);
    if (el && cache[card.id]) {
      renderWeatherCard(card, cache[card.id]);
    }
  });

  await Promise.all(cards.map(card => loadWeatherCard(card)));
}

/* ── Stock Market ─────────────────────────────────────────────── */
const STOCK_CARDS_KEY = "newsAgent.stockCards";
const STOCK_CACHE_KEY = "newsAgent.stockCache";
const STOCK_DETAIL_CACHE_KEY = "newsAgent.stockDetailCache";
let _stockInited = false;

const DEFAULT_STOCKS = [
  { id: "stock-0", symbol: "000001", name: "上证指数", market: "sh" },
  { id: "stock-1", symbol: "399001", name: "深证成指", market: "sz" },
  { id: "stock-2", symbol: "000300", name: "沪深300", market: "sh" },
  { id: "stock-3", symbol: "000688", name: "科创50", market: "sh" },
];

const STOCK_SWITCH_LIST = [
  { group: "主要指数", stocks: [
    { symbol: "000001", name: "上证指数", market: "sh" },
    { symbol: "399001", name: "深证成指", market: "sz" },
    { symbol: "399006", name: "创业板指", market: "sz" },
    { symbol: "000688", name: "科创50", market: "sh" },
    { symbol: "000300", name: "沪深300", market: "sh" },
    { symbol: "000016", name: "上证50", market: "sh" },
    { symbol: "000905", name: "中证500", market: "sh" },
    { symbol: "000852", name: "中证1000", market: "sh" },
    { symbol: "399005", name: "中小板指", market: "sz" },
  ]},
  { group: "行业指数", stocks: [
    { symbol: "000998", name: "中证内地地产", market: "sz" },
    { symbol: "399001", name: "中证消费", market: "sz" },
    { symbol: "000991", name: "全指医药", market: "sh" },
    { symbol: "000993", name: "全指金融", market: "sh" },
    { symbol: "000913", name: "内地消费", market: "sh" },
    { symbol: "399365", name: "国证食品", market: "sz" },
    { symbol: "399986", name: "银行指数", market: "sz" },
    { symbol: "399976", name: "CS新能车", market: "sz" },
    { symbol: "399417", name: "国证芯片", market: "sz" },
  ]},
  { group: "热门个股", stocks: [
    { symbol: "600519", name: "贵州茅台", market: "sh" },
    { symbol: "601318", name: "中国平安", market: "sh" },
    { symbol: "000858", name: "五粮液", market: "sz" },
    { symbol: "300750", name: "宁德时代", market: "sz" },
    { symbol: "002475", name: "立讯精密", market: "sz" },
    { symbol: "600036", name: "招商银行", market: "sh" },
    { symbol: "601888", name: "中国中免", market: "sh" },
    { symbol: "688981", name: "中芯国际", market: "sh" },
    { symbol: "002594", name: "比亚迪", market: "sz" },
    { symbol: "600900", name: "长江电力", market: "sh" },
  ]},
  { group: "ETF基金", stocks: [
    { symbol: "510300", name: "沪深300ETF", market: "sh" },
    { symbol: "510500", name: "中证500ETF", market: "sh" },
    { symbol: "588000", name: "科创50ETF", market: "sh" },
    { symbol: "159915", name: "创业板ETF", market: "sz" },
    { symbol: "510050", name: "上证50ETF", market: "sh" },
    { symbol: "159901", name: "深证100ETF", market: "sz" },
  ]},
];

const STOCK_INDICATOR_LABELS = {
  open: "开盘",
  high: "最高",
  low: "最低",
  volume: "成交量",
  amount: "成交额",
};

function saveStockState(cards) {
  try {
    sessionStorage.setItem(STOCK_CARDS_KEY, JSON.stringify(cards));
  } catch (_) {}
}

function restoreStockState() {
  try {
    const raw = sessionStorage.getItem(STOCK_CARDS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function saveStockCache(id, data) {
  try {
    const raw = sessionStorage.getItem(STOCK_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[id] = data;
    sessionStorage.setItem(STOCK_CACHE_KEY, JSON.stringify(cache));
  } catch (_) {}
}

function restoreStockCache() {
  try {
    const raw = sessionStorage.getItem(STOCK_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function saveStockDetailCache(symbol, data) {
  try {
    const raw = sessionStorage.getItem(STOCK_DETAIL_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[symbol] = data;
    sessionStorage.setItem(STOCK_DETAIL_CACHE_KEY, JSON.stringify(cache));
  } catch (_) {}
}

function restoreStockDetailCache(symbol) {
  try {
    const raw = sessionStorage.getItem(STOCK_DETAIL_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    return cache[symbol] || null;
  } catch (_) {
    return null;
  }
}

function formatStockNumber(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return "--";
  return Number(num).toFixed(decimals);
}

function formatStockAmount(num) {
  if (num === null || num === undefined || isNaN(num)) return "--";
  const n = Number(num);
  if (n >= 100000000) return (n / 100000000).toFixed(2) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(2) + "万";
  return n.toFixed(2);
}

function getStockChangeClass(change) {
  if (change === null || change === undefined || isNaN(change)) return "flat";
  if (Number(change) > 0) return "up";
  if (Number(change) < 0) return "down";
  return "flat";
}

function getStockArrow(change) {
  if (change === null || change === undefined || isNaN(change)) return "—";
  const c = Number(change);
  if (c > 0) return "▲";
  if (c < 0) return "▼";
  return "—";
}

function renderStockCard(cardData, stockData, isLoading = false) {
  const cardEl = document.getElementById(cardData.id);
  if (!cardEl) return;

  if (isLoading) {
    cardEl.innerHTML = `
      <div class="stock-card-header">
        <div class="stock-card-title-group">
          <div class="skeleton" style="width:90px;height:24px;border-radius:6px;"></div>
          <div class="skeleton" style="width:60px;height:14px;border-radius:4px;margin-top:2px;"></div>
        </div>
        <div class="skeleton" style="width:70px;height:28px;border-radius:999px;"></div>
      </div>
      <div class="stock-card-body">
        <div>
          <div class="skeleton" style="width:120px;height:40px;border-radius:6px;"></div>
          <div class="skeleton" style="width:40px;height:14px;border-radius:4px;margin-top:4px;"></div>
        </div>
        <div style="text-align:right;">
          <div class="skeleton" style="width:80px;height:20px;border-radius:4px;"></div>
          <div class="skeleton" style="width:60px;height:14px;border-radius:4px;margin-top:4px;"></div>
        </div>
      </div>
      <div class="stock-card-indicators">
        ${[0,1,2].map(() => `
          <div class="stock-indicator">
            <div class="skeleton" style="width:30px;height:12px;border-radius:4px;"></div>
            <div class="skeleton" style="width:50px;height:16px;border-radius:4px;margin-top:2px;"></div>
          </div>`).join("")}
      </div>
      <p class="stock-card-hint">点击查看一周走势</p>`;
    return;
  }

  if (stockData.error) {
    cardEl.innerHTML = `
      <div class="stock-card-header">
        <div class="stock-card-title-group">
          <span class="stock-card-name">${cardData.name}</span>
          <span class="stock-card-code">${cardData.symbol}</span>
        </div>
      </div>
      <div class="stock-card-error">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--red)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        <span>${stockData.error}</span>
      </div>`;
    cardEl.addEventListener("click", (e) => {
      if (!e.target.closest(".stock-selector")) loadStockDetail(cardData);
    });
    return;
  }

  const price = formatStockNumber(stockData.price);
  const change = stockData.change;
  const changePercent = stockData.changePercent;
  const changeClass = getStockChangeClass(change);
  const arrow = getStockArrow(change);

  const rawIndicators = [
    { label: STOCK_INDICATOR_LABELS.open, value: stockData.open },
    { label: STOCK_INDICATOR_LABELS.high, value: stockData.high },
    { label: STOCK_INDICATOR_LABELS.low, value: stockData.low },
  ].filter(ind => ind.value !== null && ind.value !== undefined && !isNaN(ind.value));

  cardEl.innerHTML = `
    <div class="stock-card-header">
      <div class="stock-card-title-group">
        <span class="stock-card-name">${cardData.name}</span>
        <span class="stock-card-code">${cardData.symbol}</span>
      </div>
      ${changePercent !== null && changePercent !== undefined && !isNaN(changePercent) ? `<div class="stock-card-change ${changeClass}">
        ${arrow} ${Math.abs(Number(changePercent)).toFixed(2)}%
      </div>` : ""}
    </div>
    <div class="stock-card-selector-row">
      <select class="stock-selector" data-card-id="${cardData.id}">
        ${STOCK_SWITCH_LIST.map(g => `
          <optgroup label="${g.group}">
            ${g.stocks.map(s => `<option value="${s.symbol}|${s.name}|${s.market}" ${s.symbol === cardData.symbol ? "selected" : ""}>${s.name} (${s.symbol})</option>`).join("")}
          </optgroup>`).join("")}
      </select>
    </div>
    <div class="stock-card-body">
      <div>
        <div class="stock-card-price">${price}</div>
        <div class="stock-card-unit">${stockData.open !== null && stockData.open !== undefined && !isNaN(stockData.open) ? "元 / 指数点" : "指数点"}</div>
      </div>
      ${change !== null && change !== undefined && !isNaN(change) ? `<div class="stock-card-change-info">
        <span class="stock-card-change-value" style="color: ${changeClass === 'up' ? 'var(--green)' : changeClass === 'down' ? 'var(--red)' : 'var(--text-2)'}">
          ${arrow} ${formatStockNumber(Math.abs(Number(change)))}
        </span>
        <span class="stock-card-change-percent">较昨日收盘</span>
      </div>` : ""}
    </div>
    ${rawIndicators.length > 0 ? `<div class="stock-card-indicators">
      ${rawIndicators.map(ind => `
        <div class="stock-indicator">
          <span class="stock-indicator-label">${ind.label}</span>
          <span class="stock-indicator-value">${formatStockNumber(ind.value)}</span>
        </div>`).join("")}
    </div>` : ""}
    <p class="stock-card-hint">点击查看一周走势</p>`;

  cardEl.addEventListener("change", handleStockSelectorChange);
  cardEl.addEventListener("click", (e) => {
    if (e.target.closest(".stock-selector")) return;
    loadStockDetail(cardData);
  });
}

async function loadStockCard(cardData) {
  const cardEl = document.getElementById(cardData.id);
  if (!cardEl) return;

  renderStockCard(cardData, {}, true);

  try {
    const resp = await fetch(`/api/stock?symbol=${encodeURIComponent(cardData.symbol)}`);
    const data = await resp.json();
    if (!resp.ok) {
      renderStockCard(cardData, { error: data.detail || "加载失败" });
      return;
    }
    renderStockCard(cardData, data);
    saveStockCache(cardData.id, data);
  } catch (err) {
    renderStockCard(cardData, { error: "网络请求失败，请检查连接" });
  }
}

function handleStockSelectorChange(e) {
  const select = e.target.closest(".stock-selector");
  if (!select) return;
  const cardId = select.dataset.cardId;
  const [symbol, name, market] = select.value.split("|");

  // Update in-memory cards
  const idx = window._stockCards.findIndex(c => c.id === cardId);
  if (idx === -1) return;
  window._stockCards[idx] = { id: cardId, symbol, name, market };

  // Update sessionStorage
  saveStockState(window._stockCards);

  // Clear old cache and reload
  const cache = restoreStockCache();
  delete cache[cardId];
  try { sessionStorage.setItem(STOCK_CACHE_KEY, JSON.stringify(cache)); } catch (_) {}

  loadStockCard(window._stockCards[idx]);
}

async function initStockView() {
  const container = document.getElementById("stockCardsContainer");
  if (!container) return;

  if (_stockInited) {
    const cards = restoreStockState() || DEFAULT_STOCKS.map(s => ({ ...s }));
    window._stockCards = cards;
    const cache = restoreStockCache();
    cards.forEach(card => {
      const el = document.getElementById(card.id);
      if (el && cache[card.id]) {
        renderStockCard(card, cache[card.id]);
      }
    });
    return;
  }
  _stockInited = true;

  let cards = restoreStockState();
  if (!cards) {
    cards = DEFAULT_STOCKS.map(s => ({ ...s }));
    saveStockState(cards);
  }
  window._stockCards = cards;

  const cache = restoreStockCache();
  container.innerHTML = cards.map(card => `<div class="stock-card" id="${card.id}"></div>`).join("");

  cards.forEach(card => {
    const el = document.getElementById(card.id);
    if (el && cache[card.id]) {
      renderStockCard(card, cache[card.id]);
    }
  });

  await Promise.all(cards.map(card => loadStockCard(card)));
}

let stockChartInstance = null;

async function loadStockDetail(cardData) {
  const overlay = document.getElementById("stockChartOverlay");
  const nameEl = document.getElementById("stockChartName");
  const codeEl = document.getElementById("stockChartCode");
  const metaEl = document.getElementById("stockChartMeta");
  const chartContainer = document.getElementById("stockChartContainer");

  if (!overlay) return;

  const cachedDetail = restoreStockDetailCache(cardData.symbol);
  if (cachedDetail) {
    nameEl.textContent = cardData.name;
    codeEl.textContent = cardData.symbol;
    const price = formatStockNumber(cachedDetail.price);
    const change = cachedDetail.change;
    const changePercent = cachedDetail.changePercent;
    const changeClass = getStockChangeClass(change);
    const arrow = getStockArrow(change);
    metaEl.innerHTML = `
      <span style="font-family:var(--font-display);font-size:1.4rem;color:var(--text-1);">${price}</span>
      <span class="stock-card-change ${changeClass}">
        ${arrow} ${formatStockNumber(Math.abs(Number(change || 0)))} (${Math.abs(Number(changePercent || 0)).toFixed(2)}%)
      </span>`;
    overlay.classList.remove("hidden");
    chartContainer.innerHTML = "";
    renderStockScatterChart(chartContainer, cachedDetail.history, cardData.name, cardData.symbol);
    return;
  }

  nameEl.textContent = cardData.name;
  codeEl.textContent = cardData.symbol;
  metaEl.innerHTML = "";
  chartContainer.innerHTML = `<div class="stock-chart-empty">
    <div class="spinner"></div>
    <span>加载图表数据...</span>
  </div>`;
  overlay.classList.remove("hidden");

  try {
    const resp = await fetch(`/api/stock/history?symbol=${encodeURIComponent(cardData.symbol)}`);
    const data = await resp.json();

    if (!resp.ok || data.error) {
      chartContainer.innerHTML = `<div class="stock-chart-empty">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        <span>${data.error || "加载失败"}</span>
      </div>`;
      return;
    }

    saveStockDetailCache(cardData.symbol, data);

    const price = formatStockNumber(data.price);
    const change = data.change;
    const changePercent = data.changePercent;
    const changeClass = getStockChangeClass(change);
    const arrow = getStockArrow(change);

    metaEl.innerHTML = `
      <span style="font-family:var(--font-display);font-size:1.4rem;color:var(--text-1);">${price}</span>
      <span class="stock-card-change ${changeClass}">
        ${arrow} ${formatStockNumber(Math.abs(Number(change || 0)))} (${Math.abs(Number(changePercent || 0)).toFixed(2)}%)
      </span>`;

    renderStockScatterChart(chartContainer, data.history, cardData.name, cardData.symbol);

  } catch (err) {
    chartContainer.innerHTML = `<div class="stock-chart-empty">
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      <span>网络请求失败</span>
    </div>`;
  }
}

function renderStockScatterChart(container, historyData, name, symbol) {
  if (!historyData || !Array.isArray(historyData) || historyData.length === 0) {
    container.innerHTML = `<div class="stock-chart-empty">
      <svg viewBox="0 0 24 24"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/></svg>
      <span>暂无历史数据</span>
    </div>`;
    return;
  }

  if (stockChartInstance) {
    stockChartInstance.dispose();
    stockChartInstance = null;
  }

  const chart = echarts.init(container);
  stockChartInstance = chart;

  const dates = historyData.map(d => {
    const s = String(d.date || "");
    if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    return d.date;
  });

  const closePrices = historyData.map(d => {
    const v = parseFloat(d.close);
    return isNaN(v) ? null : v;
  });

  const volumes = historyData.map(d => {
    const v = parseFloat(d.volume);
    return isNaN(v) || v <= 0 ? null : v;
  });

  const minPrice = Math.min(...closePrices.filter(v => v !== null));
  const maxPrice = Math.max(...closePrices.filter(v => v !== null));
  const pricePadding = (maxPrice - minPrice) * 0.1 || 1;

  const upData = [];
  const downData = [];
  const flatData = [];

  for (let i = 0; i < historyData.length; i++) {
    const close = closePrices[i];
    const prevClose = i > 0 ? closePrices[i - 1] : close;
    const itemData = [i, close, volumes[i] || '-'];
    if (close === null) {
      flatData.push(itemData);
    } else if (prevClose !== null && close > prevClose) {
      upData.push(itemData);
    } else if (prevClose !== null && close < prevClose) {
      downData.push(itemData);
    } else {
      flatData.push(itemData);
    }
  }

  const option = {
    backgroundColor: 'transparent',
    grid: {
      left: 60,
      right: 60,
      top: 20,
      bottom: 60,
    },
    xAxis: {
      type: 'category',
      data: dates,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
      axisTick: { show: false },
      axisLabel: {
        color: '#475569',
        fontSize: 11,
        interval: Math.floor(dates.length / 6),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      min: (minPrice - pricePadding).toFixed(2),
      max: (maxPrice + pricePadding).toFixed(2),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: '#475569',
        fontSize: 11,
        formatter: (v) => v.toFixed(2),
      },
      splitLine: {
        lineStyle: { color: 'rgba(255,255,255,0.05)', type: 'dashed' },
      },
    },
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(17,24,39,0.95)',
      borderColor: 'rgba(255,255,255,0.14)',
      borderWidth: 1,
      textStyle: { color: '#f1f5f9', fontSize: 12 },
      formatter: (params) => {
        if (!params || params.value === undefined) return '';
        const [idx, close, vol] = params.value;
        const date = dates[idx] || '';
        const prevClose = idx > 0 ? closePrices[idx - 1] : close;
        const chg = prevClose !== null ? (close - prevClose).toFixed(2) : '—';
        const chgPct = prevClose !== null && prevClose !== 0 ? (((close - prevClose) / prevClose) * 100).toFixed(2) + '%' : '—';
        let volStr = '—';
        if (vol && vol !== '-') {
          const v = parseFloat(vol);
          if (v >= 100000000) volStr = (v / 100000000).toFixed(2) + '亿';
          else if (v >= 10000) volStr = (v / 10000).toFixed(2) + '万';
          else volStr = v.toFixed(0);
        }
        return `<div style="font-family:'DM Sans',sans-serif;line-height:1.8;">
          <div style="color:#94a3b8;font-size:11px;">${date}</div>
          <div style="font-size:14px;font-weight:600;color:#f1f5f9;">${close !== null ? close.toFixed(2) : '—'}</div>
          <div style="color:${parseFloat(chg) >= 0 ? '#10b981' : '#ef4444'};font-size:11px;">
            涨跌额: ${chg} &nbsp; 涨跌幅: ${chgPct}
          </div>
          <div style="color:#94a3b8;font-size:11px;">成交量: ${volStr}</div>
        </div>`;
      },
    },
    series: [
      {
        name: '上涨',
        type: 'scatter',
        symbolSize: 10,
        itemStyle: { color: '#10b981', opacity: 0.85 },
        data: upData,
        z: 3,
      },
      {
        name: '下跌',
        type: 'scatter',
        symbolSize: 10,
        itemStyle: { color: '#ef4444', opacity: 0.85 },
        data: downData,
        z: 3,
      },
      {
        name: '平盘',
        type: 'scatter',
        symbolSize: 10,
        itemStyle: { color: '#94a3b8', opacity: 0.7 },
        data: flatData,
        z: 3,
      },
      {
        name: '收盘价连线',
        type: 'line',
        data: closePrices,
        lineStyle: {
          color: 'rgba(99,102,241,0.4)',
          width: 1.5,
          type: 'dashed',
        },
        itemStyle: { opacity: 0 },
        symbol: 'none',
        tooltip: { show: false },
        z: 2,
      },
    ],
  };

  chart.setOption(option);

  window.addEventListener('resize', () => chart.resize());
}

document.addEventListener('click', (e) => {
  const overlay = document.getElementById('stockChartOverlay');
  const chartClose = document.getElementById('stockChartClose');
  if (!overlay || overlay.classList.contains('hidden')) return;
  if (e.target === overlay) {
    overlay.classList.add('hidden');
    if (stockChartInstance) {
      stockChartInstance.dispose();
      stockChartInstance = null;
    }
  }
  if (e.target.closest('#stockChartClose')) {
    overlay.classList.add('hidden');
    if (stockChartInstance) {
      stockChartInstance.dispose();
      stockChartInstance = null;
    }
  }
});

const LATEST_NEWS_KEY = "newsAgent.latestNews";
const NEWS_STATE_KEY = "newsAgent.newsState";
const LAST_VIEW_KEY = "newsAgent.lastView";

function setStatus(text) {
  statusBox.textContent = text;
}

function saveLatestNews(payload) {
  try {
    sessionStorage.setItem(LATEST_NEWS_KEY, JSON.stringify(payload));
  } catch (_) {
    // ignore storage failures
  }
}

function getLatestNews() {
  try {
    const raw = sessionStorage.getItem(LATEST_NEWS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveNewsState() {
  try {
    sessionStorage.setItem(
      NEWS_STATE_KEY,
      JSON.stringify({
        history: newsHistory,
        index: historyIndex,
        count: newsCount,
      })
    );
  } catch (_) {}
}

function restoreNewsState() {
  try {
    const raw = sessionStorage.getItem(NEWS_STATE_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    if (!state.history || !Array.isArray(state.history) || state.history.length === 0) return false;

    newsHistory = state.history;
    historyIndex = typeof state.index === "number" ? state.index : 0;
    newsCount = typeof state.count === "number" ? state.count : 0;
    if (historyIndex < 0) historyIndex = 0;
    if (historyIndex >= newsHistory.length) historyIndex = 0;
    return true;
  } catch (_) {
    return false;
  }
}

function showCaption(node, text) {
  const spinner = node.querySelector('.spinner') || node.querySelector('.spinner');
  node.innerHTML = `<div class="spinner"></div>${text}`;
  node.classList.remove("hidden");
}

function hideCaption(node) {
  node.classList.add("hidden");
}

function switchView(target) {
  Object.entries(views).forEach(([name, node]) => {
    node.classList.toggle("active", name === target);
  });

  navButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === target);
  });

  try {
    sessionStorage.setItem(LAST_VIEW_KEY, target);
  } catch (_) {}

  if (target === "browse" && newsCount === 0) {
    const cached = getLatestNews();
    if (cached) {
      renderSingleNews(cached);
      newsCount = 1;
      historyIndex = 0;
      newsHistory = [getCardSnapshot(newsStream.querySelector(".news-card"), cached.link)];
      saveNewsState();
      setStatus("已恢复上次浏览新闻");
      return;
    }
    loadNextNews();
  }

  if (target === "weather") {
    initWeatherView();
  }

  if (target === "stock") {
    initStockView();
  }
}

function markdownToHtml(markdown) {
  if (window.marked && typeof window.marked.parse === "function") {
    return window.marked.parse(markdown ?? "");
  }

  const escaped = (markdown ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(/\n/g, "<br>");
}

function splitBilingualNews(content) {
  const safe = content || "";

  const zhTitle =
    (safe.match(/标题\s*[:：]\s*(.+)/i) || [])[1] ||
    (safe.match(/Title\s*\(CN\)\s*[:：]\s*(.+)/i) || [])[1] ||
    "未获取到中文标题";
  const zhSummary =
    (safe.match(/内容\s*[:：]\s*([\s\S]*?)(?:\n\s*原链接|\n\s*##\s*English|$)/i) || [])[1]?.trim() ||
    "未获取到中文内容";
  const link =
    (safe.match(/原链接\s*[:：]\s*(https?:\/\/\S+)/i) || [])[1] ||
    (safe.match(/Link\s*[:：]\s*(https?:\/\/\S+)/i) || [])[1] ||
    (safe.match(/\((https?:\/\/[^)]+)\)/i) || [])[1] ||
    "";

  const enTitle =
    (safe.match(/English[\s\S]*?Title\s*[:：]\s*(.+)/i) || [])[1] ||
    (safe.match(/标题\(EN\)\s*[:：]\s*(.+)/i) || [])[1] ||
    zhTitle;
  const enSummary =
    (safe.match(/English[\s\S]*?Summary\s*[:：]\s*([\s\S]*?)(?:\n\s*Link|$)/i) || [])[1]?.trim() ||
    (safe.match(/英文内容\s*[:：]\s*([\s\S]*?)(?:\n\s*Link|$)/i) || [])[1]?.trim() ||
    zhSummary;

  return {
    zhTitle: zhTitle.trim(),
    zhSummary,
    enTitle: enTitle.trim(),
    enSummary,
    link,
  };
}

function formatDate() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const weekday = weekdays[now.getDay()];
  return `${month}月${day}日 ${weekday}`;
}

function renderSingleNews(payload) {
  const parsed = payload?.title_zh
    ? {
        zhTitle: payload.title_zh,
        zhSummary: payload.summary_zh,
        enTitle: payload.title_en,
        enSummary: payload.summary_en,
        link: payload.link,
      }
    : splitBilingualNews(payload?.raw_markdown || payload?.content || "");

  const snapshot = {
    title_zh: parsed.zhTitle,
    summary_zh: parsed.zhSummary,
    title_en: parsed.enTitle,
    summary_en: parsed.enSummary,
    link: parsed.link,
  };
  saveLatestNews(snapshot);

  const dateStr = formatDate();
  const indexStr = newsCount > 0 ? `第 ${newsCount} 条` : `今日推荐`;

  newsStream.innerHTML = `
    <article class="news-card">
      <div class="news-card-meta">
        <span class="news-card-badge">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
          ${indexStr}
        </span>
        <span class="news-card-date">${dateStr}</span>
      </div>
      <section class="news-lang-section">
        <p class="news-lang-label">中文</p>
        <h4 class="news-title">${parsed.zhTitle}</h4>
        <p class="news-summary">${parsed.zhSummary}</p>
      </section>
      <section class="news-lang-section">
        <p class="news-lang-label">English</p>
        <h4 class="news-title">${parsed.enTitle}</h4>
        <p class="news-summary">${parsed.enSummary}</p>
      </section>
      <div class="news-footer">
        <div class="news-actions">
        </div>
        <span class="news-index-badge">点击卡片阅读全文</span>
      </div>
    </article>
  `;

  const card = newsStream.querySelector(".news-card");
  if (card && parsed.link) {
    card.classList.add("clickable");
    card.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      window.location.href = `/article?url=${encodeURIComponent(parsed.link)}`;
    });
  }

  updateFloatingButtons(parsed.link, parsed.zhTitle, parsed.enTitle, parsed.zhSummary, parsed.enSummary);

  newsStream.scrollTop = 0;
}

async function loadNextNews() {
  if (loadingNews) return;

  if (historyIndex < newsHistory.length - 1) {
    historyIndex += 1;
    renderFromSnapshot(newsHistory[historyIndex], historyIndex);
    saveNewsState();
    setStatus(`已加载新闻 ${historyIndex + 1} / ${newsHistory.length}`);
    return;
  }

  loadingNews = true;
  if (nextNewsBtn) {
    nextNewsBtn.classList.add("loading");
    nextNewsBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>`;
  }

  setStatus("正在拉取下一条新闻...");
  showCaption(browseCaption, "正在拉取下一条新闻...");

  try {
    const response = await fetch("/api/news/next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    newsCount += 1;

    renderSingleNews(data);

    const card = newsStream.querySelector(".news-card");
    if (card) {
      const snapshot = getCardSnapshot(card, data.link);
      if (historyIndex < newsHistory.length - 1) {
        newsHistory = newsHistory.slice(0, historyIndex + 1);
      }
      newsHistory.push(snapshot);
      historyIndex = newsHistory.length - 1;
      saveNewsState();
    }

    setStatus(`已生成第 ${newsCount} 条推荐`);
  } catch (error) {
    setStatus(`拉取新闻失败: ${error.message}`);
    const errorCard = document.createElement("div");
    errorCard.className = "news-card";
    errorCard.style.borderColor = "rgba(239,68,68,0.3)";
    errorCard.innerHTML = `
      <div class="news-card-meta">
        <span class="news-card-badge" style="color:var(--red);background:var(--amber-dim);border-color:rgba(239,68,68,0.2)">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          加载失败
        </span>
      </div>
      <p class="news-summary" style="color:var(--text-3)">${error.message}</p>
    `;
    newsStream.prepend(errorCard);
  } finally {
    loadingNews = false;
    if (nextNewsBtn) {
      nextNewsBtn.classList.remove("loading");
      nextNewsBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 16l-6-6 1.41-1.41L12 13.17l4.59-4.58L18 10z"/></svg>`;
    }
    hideCaption(browseCaption);
    saveNewsState();
    setStatus(`已加载新闻 ${historyIndex + 1} / ${newsHistory.length}`);
  }
}

function getCardSnapshot(card, link) {
  return {
    title_zh: card.querySelector(".news-lang-section:nth-child(2) .news-title")?.textContent || "",
    summary_zh: card.querySelector(".news-lang-section:nth-child(2) .news-summary")?.textContent || "",
    title_en: card.querySelector(".news-lang-section:nth-child(3) .news-title")?.textContent || "",
    summary_en: card.querySelector(".news-lang-section:nth-child(3) .news-summary")?.textContent || "",
    link: link || "",
  };
}

function renderFromSnapshot(snapshot, index) {
  const idx = typeof index === "number" ? index : 0;
  const indexStr = `第 ${idx + 1} 条`;
  newsStream.innerHTML = `
    <article class="news-card">
      <div class="news-card-meta">
        <span class="news-card-badge">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
          ${indexStr}
        </span>
        <span class="news-card-date">${formatDate()}</span>
      </div>
      <section class="news-lang-section">
        <p class="news-lang-label">中文</p>
        <h4 class="news-title">${snapshot.title_zh}</h4>
        <p class="news-summary">${snapshot.summary_zh}</p>
      </section>
      <section class="news-lang-section">
        <p class="news-lang-label">English</p>
        <h4 class="news-title">${snapshot.title_en}</h4>
        <p class="news-summary">${snapshot.summary_en}</p>
      </section>
      <div class="news-footer">
        <div class="news-actions">
        </div>
        <span class="news-index-badge">点击卡片阅读全文</span>
      </div>
    </article>
  `;

  const card = newsStream.querySelector(".news-card");
  if (card && snapshot.link) {
    card.classList.add("clickable");
    card.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      window.location.href = `/article?url=${encodeURIComponent(snapshot.link)}`;
    });
  }

  updateFloatingButtons(snapshot.link || "", snapshot.title_zh, snapshot.title_en, snapshot.summary_zh, snapshot.summary_en);

  newsStream.scrollTop = 0;
}

function loadPrevNews() {
  if (historyIndex <= 0 || loadingNews) return;
  historyIndex -= 1;
  renderFromSnapshot(newsHistory[historyIndex], historyIndex);
  saveNewsState();
  setStatus(`已加载新闻 ${historyIndex + 1} / ${newsHistory.length}`);
}

function addChatMessage(role, content) {
  if (chatEmpty) {
    chatEmpty.remove();
  }

  const item = document.createElement("div");
  item.className = `chat-item ${role}`;
  item.innerHTML = markdownToHtml(content);
  chatWindow.appendChild(item);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function sendChat(message) {
  addChatMessage("user", message);
  setStatus("大模型处理中...");
  showCaption(chatCaption, "大模型思考中...");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    addChatMessage("assistant", data.content || "暂无回复");
    setStatus("回复完成");
  } catch (error) {
    addChatMessage("assistant", `**请求失败**: ${error.message}\n\n请检查网络连接或稍后重试。`);
    setStatus("聊天请求失败");
  } finally {
    hideCaption(chatCaption);
  }
}

/* ── Navigation ────────────────────────────────────────────── */
navButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

/* ── Hero start button ─────────────────────────────────────── */
startBtn.addEventListener("click", () => switchView("browse"));

/* ── Hero ghost button → chat ─────────────────────────────── */
const gotoChatBtn = document.querySelector("[data-goto-chat]");
if (gotoChatBtn) {
  gotoChatBtn.addEventListener("click", () => switchView("chat"));
}

/* ── Refresh / reload button ──────────────────────────────── */
if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    if (!loadingNews) loadNextNews();
  });
}

/* ── Next news button ─────────────────────────────────────── */
if (nextNewsBtn) {
  nextNewsBtn.style.visibility = "visible";
  nextNewsBtn.addEventListener("click", loadNextNews);
}

/* ── Prev news button ─────────────────────────────────────── */
if (prevNewsBtn) {
  prevNewsBtn.style.visibility = "visible";
  prevNewsBtn.addEventListener("click", loadPrevNews);
}

/* ── Arrow key navigation ─────────────────────────────────── */
document.addEventListener("keydown", (e) => {
  if (document.visibilityState === "hidden") return;
  const isBrowseActive = views.browse && views.browse.classList.contains("active");
  if (!isBrowseActive) return;
  if (e.target === chatInput) return;

  if (e.key === "ArrowUp") {
    e.preventDefault();
    loadPrevNews();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    loadNextNews();
  }
});

/* ── Chat form ──────────────────────────────────────────────── */
chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = "";
  sendChat(message);
});

/* ── Initial assistant welcome ──────────────────────────────── */
addChatMessage(
  "assistant",
  "欢迎使用 **闻新**！\n\n你可以直接提问，例如：\n- 请给我今天值得看的科技和商业新闻\n- 最近有哪些 AI 领域的重大投资？\n- 帮我找找关于新能源汽车的最新动态"
);

// ── Auth ─────────────────────────────────────────────────────────────────────

const AUTH_TOKEN_KEY = "newsAgent.token";
const AUTH_USER_KEY = "newsAgent.user";

let currentUser = JSON.parse(sessionStorage.getItem(AUTH_USER_KEY) || "null");
let currentToken = sessionStorage.getItem(AUTH_TOKEN_KEY) || null;

function apiFetch(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (currentToken) headers["Authorization"] = `Bearer ${currentToken}`;
  return fetch(url, { ...options, headers });
}

function showAuthGate() {
  const gate = document.getElementById("authGate");
  const shell = document.getElementById("appShell");
  if (gate) gate.style.display = "flex";
  if (shell) shell.style.visibility = "hidden";
}

function hideAuthGate() {
  const gate = document.getElementById("authGate");
  const shell = document.getElementById("appShell");
  if (gate) gate.style.display = "none";
  if (shell) shell.style.visibility = "visible";
}

function updateAuthUI() {
  const logoutBtn = document.getElementById("logoutBtn");
  const profileUsername = document.getElementById("profileUsername");
  const profileJoined = document.getElementById("profileJoined");
  const changePwdSection = document.getElementById("changePwdSection");

  if (currentUser) {
    hideAuthGate();
    logoutBtn.style.display = "block";
    profileUsername.textContent = currentUser.username;
    profileJoined.textContent = `UID: ${currentUser.userId}`;
    changePwdSection.style.display = "block";
  } else {
    showAuthGate();
    logoutBtn.style.display = "none";
    profileUsername.textContent = "未登录";
    profileJoined.textContent = "登录后可同步收藏、点赞和偏好";
    changePwdSection.style.display = "none";
  }
}

// Auth gate elements
let authMode = "login";
const authTabs = document.querySelectorAll(".auth-tab");
const authForm = document.getElementById("authForm");
const authError = document.getElementById("authError");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const confirmPwdGroup = document.getElementById("confirmPwdGroup");
const logoutBtn = document.getElementById("logoutBtn");

function setAuthMode(mode) {
  authMode = mode;
  authTabs.forEach(t => t.classList.toggle("active", t.dataset.authTab === mode));
  authSubmitBtn.textContent = mode === "login" ? "登录" : "注册";
  confirmPwdGroup.style.display = mode === "register" ? "flex" : "none";
  authError.classList.add("hidden");
  authForm.reset();
}

authTabs.forEach(tab => {
  tab.addEventListener("click", () => setAuthMode(tab.dataset.authTab));
});

authForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.classList.add("hidden");
  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = "处理中...";

  const username = document.getElementById("authUsername").value.trim();
  const password = document.getElementById("authPassword").value;
  const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";

  if (authMode === "register") {
    const confirm = document.getElementById("authConfirmPassword").value;
    if (password !== confirm) {
      authError.textContent = "两次密码输入不一致";
      authError.classList.remove("hidden");
      authSubmitBtn.disabled = false;
      authSubmitBtn.textContent = "注册";
      return;
    }
  }

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      authError.textContent = data.detail || "操作失败";
      authError.classList.remove("hidden");
    } else {
      currentToken = data.token;
      currentUser = { username: data.username, userId: data.userId };
      sessionStorage.setItem(AUTH_TOKEN_KEY, currentToken);
      sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(currentUser));
      updateAuthUI();
      setStatus(authMode === "login" ? `欢迎回来，${data.username}！` : `注册成功，已登录`);
    }
  } catch {
    authError.textContent = "网络错误，请重试";
    authError.classList.remove("hidden");
  }
  authSubmitBtn.disabled = false;
  authSubmitBtn.textContent = authMode === "login" ? "登录" : "注册";
});

logoutBtn?.addEventListener("click", () => {
  currentToken = null;
  currentUser = null;
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_USER_KEY);
  updateAuthUI();
  setStatus("已退出登录");
});

// Change password
const changePwdBtn = document.getElementById("changePwdBtn");
const changePwdSection = document.getElementById("changePwdSection");
const cancelChangePwdBtn = document.getElementById("cancelChangePwdBtn");

changePwdBtn?.addEventListener("click", () => {
  changePwdSection?.classList.toggle("hidden");
});
cancelChangePwdBtn?.addEventListener("click", () => {
  changePwdSection?.classList.add("hidden");
});

document.getElementById("changePwdForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("changePwdError");
  const oldPwd = document.getElementById("oldPassword").value;
  const newPwd = document.getElementById("newPassword").value;
  const confirmPwd = document.getElementById("confirmNewPassword").value;
  errEl.classList.add("hidden");

  if (newPwd.length < 6) {
    errEl.textContent = "新密码至少6位"; errEl.classList.remove("hidden"); return;
  }
  if (newPwd !== confirmPwd) {
    errEl.textContent = "两次新密码输入不一致"; errEl.classList.remove("hidden"); return;
  }

  const resp = await apiFetch("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    errEl.textContent = data.detail || "修改失败"; errEl.classList.remove("hidden");
  } else {
    e.target.reset();
    errEl.textContent = "密码修改成功！";
    errEl.style.color = "var(--green)";
    errEl.classList.remove("hidden");
    setTimeout(() => { errEl.classList.add("hidden"); errEl.style.color = ""; }, 3000);
    setStatus("密码修改成功");
  }
});

// ── Article Actions ──────────────────────────────────────────────────────────

// Floating action buttons - event delegation avoids closure/capture bugs during fast navigation
const floatingLikeBtn  = document.getElementById("favLikeBtn");
const floatingFavBtn   = document.getElementById("favFavBtn");
const floatingNotBtn  = document.getElementById("favNotBtn");

const FLOATING_ACTIONS_ID = "floatingActions";

function getCurrentActionUrl() {
  const entry = newsHistory[historyIndex];
  return entry?.link || "";
}

function getCurrentActionTitles() {
  const entry = newsHistory[historyIndex];
  return {
    zh: entry?.title_zh || "",
    en: entry?.title_en || "",
    zhSummary: entry?.summary_zh || "",
    enSummary: entry?.summary_en || "",
  };
}

function refreshFloatingButtonsState() {
  const url = getCurrentActionUrl();
  if (!url) return;
  const state = resolveActionState(url);
  [floatingLikeBtn, floatingFavBtn, floatingNotBtn].forEach(btn => {
    const action = btn.dataset.action;
    btn.classList.toggle(`active-${action}`, !!state[action]);
  });
}

// One-time delegation: register once at init, never overwritten
document.addEventListener("click", (e) => {
  const btn = e.target.closest("#floatingActions .floating-action-btn");
  if (!btn) return;
  const action = btn.dataset.action;
  const url = getCurrentActionUrl();
  if (!url) return;

  // Use const so the closure captures the VALUE at click time, not a variable reference
  const titles = getCurrentActionTitles();

  const currentState = resolveActionState(url);
  const newVal = !currentState[action];
  setActionState(url, action, newVal);
  if (window._actionStateCache[url] !== undefined) {
    window._actionStateCache[url][action] = newVal;
  }
  btn.classList.toggle(`active-${action}`, newVal);
  btn.classList.add("action-pop");
  setTimeout(() => btn.classList.remove("action-pop"), 300);

  if (action === "not-interested" && newVal) {
    loadNextNews();
  } else {
    doArticleAction(url, action, titles.zh, titles.en, titles.zhSummary, titles.enSummary);
  }
});

// Per-URL action cache fetched from DB (url -> { like, favorite, not_interested })
// This cache bridges DB -> in-memory during a session to avoid repeated API calls.
// Always falls back to sessionStorage if the URL is not in cache.
window._actionStateCache = {};

function resolveActionState(url) {
  const dbCache = window._actionStateCache[url];
  if (dbCache !== undefined) return dbCache;
  return getActionState(url);
}

async function fetchActionState(url) {
  if (!currentToken) return;
  if (window._actionStateCache[url] !== undefined) return;
  try {
    const resp = await apiFetch(`/api/article/actions/by-url?url=${encodeURIComponent(url)}`);
    if (resp.ok) {
      const data = await resp.json();
      const merged = {
        like: !!data.like,
        favorite: !!data.favorite,
        not_interested: !!data.not_interested,
      };
      const local = getActionState(url);
      if (local.like) merged.like = true;
      if (local.favorite) merged.favorite = true;
      if (local.not_interested) merged.not_interested = true;
      window._actionStateCache[url] = merged;
      if (url === getCurrentActionUrl()) {
        refreshFloatingButtonsState();
      }
    }
  } catch (_) {}
}

function updateFloatingButtons(url, titleZh, titleEn, zhSummary, enSummary) {
  if (currentToken && url) {
    fetchActionState(url);
  }
  refreshFloatingButtonsState();
}

async function doArticleAction(url, action, titleZh, titleEn, summaryZh, summaryEn) {
  if (!currentToken) {
    showAuthGate();
    return;
  }
  try {
    const resp = await apiFetch("/api/article/action", {
      method: "POST",
      body: JSON.stringify({ url, action, title_zh: titleZh, title_en: titleEn, summary_zh: summaryZh, summary_en: summaryEn }),
    });
    if (resp.ok) {
      const labels = { like: "已点赞", favorite: "已收藏", "not-interested": "已标记" };
      setStatus(labels[action] || "操作成功");
    }
  } catch (_) {}
}

function getActionState(url) {
  return JSON.parse(sessionStorage.getItem(`newsAgent.action_${encodeURIComponent(url)}`) || "{}");
}

function setActionState(url, key, val) {
  const s = getActionState(url);
  s[key] = val;
  sessionStorage.setItem(`newsAgent.action_${encodeURIComponent(url)}`, JSON.stringify(s));
}

function updateActionButtons(url) {
  const state = getActionState(url);
  document.querySelectorAll(`[data-action-url="${CSS.escape(url)}"]`).forEach(btn => {
    const a = btn.dataset.action;
    btn.classList.toggle(`active-${a}`, !!state[a]);
  });
}

// ── Profile / Personal Center ───────────────────────────────────────────────

let profileOffsets = { liked: 0, favorited: 0, history: 0 };
const PROFILE_LIMIT = 20;

function renderArticleItem(article) {
  const date = new Date(article.created_at).toLocaleDateString("zh-CN");
  const title = article.title_zh || article.title_en || "未命名";
  const labelMap = { like: "已赞", favorite: "已收藏", viewed: "" };
  const label = labelMap[article.action] || "";
  return `
    <a class="profile-article-item" href="${article.url}" target="_blank" rel="noopener">
      <div style="flex:1;min-width:0;">
        <div class="profile-article-meta">
          ${label ? `<span class="profile-article-badge">${label}</span>` : ""}
          <span class="profile-article-date">${date}</span>
        </div>
        <div class="profile-article-title">${title}</div>
      </div>
      <svg viewBox="0 0 24 24" style="width:16px;height:16px;flex-shrink:0;color:var(--text-3);fill:currentColor;align-self:center;">
        <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
      </svg>
    </a>`;
}

async function loadArticleList(type, offset, limit) {
  if (!currentToken) {
    return { articles: [], hasMore: false };
  }
  try {
    const resp = await apiFetch(`/api/article/actions?action=${type}&limit=${limit}&offset=${offset}`);
    if (!resp.ok) return { articles: [], hasMore: false };
    const data = await resp.json();
    return { articles: data.articles || [], hasMore: !!data.has_more };
  } catch (_) {
    return { articles: [], hasMore: false };
  }
}

async function loadProfileData() {
  if (!currentUser) {
    ["likedArticleList", "favoritedArticleList", "historyArticleList"].forEach(id => {
      document.getElementById(id).innerHTML = `<div class="profile-empty">登录后可查看记录</div>`;
    });
    document.getElementById("loadMoreLiked").style.display = "none";
    document.getElementById("loadMoreFavorited").style.display = "none";
    document.getElementById("loadMoreHistory").style.display = "none";
    return;
  }

  profileOffsets = { liked: 0, favorited: 0, history: 0 };

  const [likedData, favData, histData] = await Promise.all([
    loadArticleList("like", 0, 1),
    loadArticleList("favorite", 0, 1),
    loadArticleList("history", 0, PROFILE_LIMIT),
  ]);

  renderArticleSection("likedArticleList", likedData, "liked");
  renderArticleSection("favoritedArticleList", favData, "favorited");
  renderArticleSection("historyArticleList", histData, "history");
}

function renderArticleSection(listId, data, type) {
  const list = document.getElementById(listId);
  const moreBtn = document.getElementById(`loadMore${type.charAt(0).toUpperCase() + type.slice(1)}`);
  if (!data.articles.length) {
    list.innerHTML = `<div class="profile-empty">暂无记录</div>`;
    moreBtn.style.display = "none";
    return;
  }
  list.innerHTML = data.articles.map(renderArticleItem).join("");
  moreBtn.style.display = data.hasMore ? "block" : "none";
  moreBtn.onclick = async () => {
    const apiType = type === "liked" ? "like" : type === "favorited" ? "favorite" : type;
    profileOffsets[type] += 1;
    const next = await loadArticleList(apiType, profileOffsets[type], PROFILE_LIMIT);
    list.insertAdjacentHTML("beforeend", next.articles.map(renderArticleItem).join(""));
    moreBtn.style.display = next.hasMore ? "block" : "none";
  };
}

// Load profile on view switch
const originalSwitchView = switchView;
switchView = function(name) {
  originalSwitchView(name);
  if (name === "profile") loadProfileData();
};

// ── Init ───────────────────────────────────────────────────────────────────

function initApp() {
  updateAuthUI();

  if (!currentUser) {
    showAuthGate();
    return;
  }

  // Restore saved view state
  const initialView = new URLSearchParams(window.location.search).get("view");
  const savedView = (() => {
    try { return sessionStorage.getItem(LAST_VIEW_KEY); } catch (_) { return null; }
  })();
  const targetView = initialView || savedView || "home";

  if (targetView === "browse") {
    const stateRestored = restoreNewsState();
    switchView("browse");
    if (stateRestored && newsHistory.length > 0) {
      renderFromSnapshot(newsHistory[historyIndex], historyIndex);
      setStatus(`已恢复新闻浏览状态（${historyIndex + 1} / ${newsHistory.length}）`);
    }
  } else if (targetView === "weather") {
    switchView("weather");
  } else if (targetView === "stock") {
    switchView("stock");
  } else if (targetView === "chat") {
    switchView("chat");
  } else if (targetView === "profile") {
    switchView("profile");
    loadProfileData();
  } else {
    switchView("home");
  }
}

initApp();
