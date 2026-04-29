import json
import logging
import os
import random
import re
import threading
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import unquote, urlparse

import httpx

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from pydantic import BaseModel

from news_agent.database import (
    create_token,
    create_user,
    count_user_actions,
    decode_token,
    get_or_create_article,
    get_session,
    get_user_actions,
    get_user_article_actions,
    get_user_by_username,
    hash_password,
    init_db,
    set_article_action,
    verify_password,
)
from news_agent.models import ActionType, User, UserPreference
from news_agent.news_agent import (
    default_content_preferences,
    default_news_source_preferences,
    get_memory,
    update_memory,
)
from news_agent.tools.tavily_tools import (
    tavily_crawl,
    tavily_extract_content,
    tavily_map_site,
    tavily_search,
)


@dataclass
class MemoryRecord:
    value: str


class JsonMemoryStore:
    """Simple file-backed store with get/put used by existing memory functions."""

    def __init__(self, file_path: Path):
        self.file_path = file_path
        self.lock = threading.Lock()
        self._data: Dict[str, str] = {}
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        self._load()

    def _load(self) -> None:
        if self.file_path.exists():
            try:
                raw = json.loads(self.file_path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    self._data = {str(k): str(v) for k, v in raw.items()}
            except json.JSONDecodeError:
                self._data = {}

    def _save(self) -> None:
        self.file_path.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    @staticmethod
    def _key(namespace: Any, key: str) -> str:
        if isinstance(namespace, (list, tuple)):
            namespace_value = "/".join(str(part) for part in namespace)
        else:
            namespace_value = str(namespace)
        return f"{namespace_value}:{key}"

    def get(self, namespace: Any, key: str) -> Optional[MemoryRecord]:
        data_key = self._key(namespace, key)
        value = self._data.get(data_key)
        if value is None:
            return None
        return MemoryRecord(value=value)

    def put(self, namespace: Any, key: str, value: str) -> None:
        data_key = self._key(namespace, key)
        with self.lock:
            self._data[data_key] = value
            self._save()


class ChatRequest(BaseModel):
    message: str


class FeedbackRequest(BaseModel):
    feedback: str


ROOT_DIR = Path(__file__).resolve().parents[2]
WEB_DIR = ROOT_DIR / "web"
DATA_DIR = ROOT_DIR / "data"
PREFS_FILE = DATA_DIR / "preferences.json"

load_dotenv(ROOT_DIR / ".env")
store = JsonMemoryStore(PREFS_FILE)

TOOLS = [tavily_crawl, tavily_map_site, tavily_search, tavily_extract_content]
TOOLS_BY_NAME = {tool.name: tool for tool in TOOLS}
NEWS_CACHE: deque[Dict[str, str]] = deque()
NEWS_CACHE_LOCK = threading.Lock()
NEWS_CACHE_REFILLING = False
NEWS_CACHE_TARGET = 3

NEWS_PUSH_PROMPTS = [
    "请推送今天一条重要新闻，只要一条。",
    "请给我今天最新且值得阅读的一条新闻。",
    "给我推送一条今天的热点新闻，保持简洁。",
]


app = FastAPI(title="News Agent Web API", version="1.0.0")
logger = logging.getLogger("news_agent.web_api")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    _trigger_news_prefetch()


if WEB_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(WEB_DIR)), name="assets")


def _build_llm(temperature: float = 0.2) -> ChatOpenAI:
    api_key = os.getenv("QWEN_API_KEY")
    base_url = os.getenv("QWEN_API_BASE")
    model = os.getenv("QWEN_MODEL", "qwen3.5-flash")

    if not api_key or not base_url:
        raise HTTPException(
            status_code=500,
            detail="Missing QWEN_API_KEY or QWEN_API_BASE in environment.",
        )

    return ChatOpenAI(
        model=model,
        temperature=temperature,
        api_key=api_key,
        base_url=base_url,
    )


def _render_tool_result(result: Any) -> str:
    if isinstance(result, (dict, list)):
        return json.dumps(result, ensure_ascii=False)
    return str(result)


def _build_system_prompt(strict_news_only: bool = False) -> str:
    news_source_preferences = get_memory(
        store,
        ("news_feed_agent", "news_source_preferences"),
        default_news_source_preferences,
    )
    content_preferences = get_memory(
        store,
        ("news_feed_agent", "content_preferences"),
        default_content_preferences,
    )

    strict_block = ""
    if strict_news_only:
        strict_block = """
你只能输出 1 条新闻，禁止回答与新闻无关内容。
必须严格输出以下 Markdown 结构：

## 中文
标题: <中文标题>
内容: <中文摘要，2-4句>
原链接: <https://...>

## English
Title: <English title>
Summary: <English summary, 2-4 sentences, English only>
Link: <https://...>

要求：
1. English Summary 必须是英文，不得夹杂中文。
2. 中文和英文链接必须一致，且必须为原文链接。
3. 严禁输出多条新闻。
"""

    return f"""你是一个智能新闻聚合助手。
你需要在保证准确性的前提下优先追求响应速度。

可用工具：
1. tavily_crawl
2. tavily_map_site
3. tavily_search
4. tavily_extract_content

速度优先策略：
1. 默认先用 tavily_search。
2. 若首轮结果足够，则不要继续调用其他工具。
3. 仅在确有必要时再调用 crawl/map/extract。

{strict_block}

最终输出必须是 Markdown。
只要回答中包含新闻事实，就必须附带原文链接。
格式建议：
- [标题](原文链接)：摘要

若输出多条新闻，请在末尾追加“### Sources”并列出对应链接。

优先使用以下新闻来源偏好：
{news_source_preferences}

只关注以下内容偏好：
{content_preferences}
"""


def _extract_field(section: str, labels: List[str]) -> str:
    for label in labels:
        match = re.search(
            rf"{re.escape(label)}\s*[:：]\s*(.+)", section, flags=re.IGNORECASE
        )
        if match:
            return match.group(1).strip()
    return ""


def _contains_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def _extract_url(text: str) -> str:
    match = re.search(r"https?://\S+", text)
    return match.group(0).rstrip(")].,;\"'") if match else ""


def _ensure_english(text: str) -> str:
    if not text or not _contains_chinese(text):
        return text

    translator = _build_llm(temperature=0.0)
    result = translator.invoke(
        [
            SystemMessage(content="你是翻译助手。请将输入内容翻译成自然、简洁的英文，只输出英文结果。"),
            HumanMessage(content=text),
        ]
    )
    return str(result.content).strip()


def _parse_news_markdown(content: str) -> Dict[str, str]:
    zh_section = ""
    en_section = ""

    zh_match = re.search(r"##\s*中文([\s\S]*?)(?=\n##\s*English|\Z)", content, flags=re.IGNORECASE)
    en_match = re.search(r"##\s*English([\s\S]*?)$", content, flags=re.IGNORECASE)

    if zh_match:
        zh_section = zh_match.group(1)
    if en_match:
        en_section = en_match.group(1)

    title_zh = _extract_field(zh_section or content, ["标题", "Title"])
    summary_zh = _extract_field(zh_section or content, ["内容", "摘要", "Summary"])
    url_zh = _extract_field(zh_section or content, ["原链接", "链接", "Link", "URL"])

    title_en = _extract_field(en_section or content, ["Title", "标题(EN)"])
    summary_en = _extract_field(en_section or content, ["Summary", "内容(EN)", "摘要(EN)"])
    url_en = _extract_field(en_section or content, ["Link", "URL", "原链接"])

    link = url_zh or url_en or _extract_url(content)

    if not title_zh:
        title_zh = "今日新闻"
    if not summary_zh:
        summary_zh = "未提取到摘要，请点击原文链接查看详细内容。"

    if not title_en:
        title_en = _ensure_english(title_zh)
    if not summary_en:
        summary_en = _ensure_english(summary_zh)
    else:
        summary_en = _ensure_english(summary_en)

    return {
        "title_zh": title_zh,
        "summary_zh": summary_zh,
        "title_en": title_en,
        "summary_en": summary_en,
        "link": link,
        "raw_markdown": content,
    }


def _run_tool_enabled_chat(user_message: str, strict_news_only: bool) -> str:
    llm = _build_llm(temperature=0.15 if strict_news_only else 0.2)
    llm_with_tools = llm.bind_tools(TOOLS)

    messages: List[Any] = [
        SystemMessage(content=_build_system_prompt(strict_news_only=strict_news_only)),
        HumanMessage(content=user_message),
    ]

    max_turns = 3 if strict_news_only else 4
    for _ in range(max_turns):
        ai_message = llm_with_tools.invoke(messages)
        messages.append(ai_message)

        if not getattr(ai_message, "tool_calls", None):
            return str(ai_message.content)

        for tool_call in ai_message.tool_calls:
            tool_name = tool_call.get("name")
            args = tool_call.get("args", {})
            tool = TOOLS_BY_NAME.get(tool_name)

            if tool is None:
                tool_output = f"Unknown tool requested: {tool_name}"
            else:
                try:
                    tool_output = _render_tool_result(tool.invoke(args))
                except Exception as exc:
                    tool_output = f"Tool {tool_name} failed: {exc}"

            messages.append(
                ToolMessage(
                    content=tool_output,
                    tool_call_id=tool_call.get("id", ""),
                    name=tool_name or "unknown",
                )
            )

    # Fallback when the tool loop does not naturally stop.
    # We force a final answer from current context instead of failing the request.
    fallback_prompt = SystemMessage(content="立即停止工具调用，基于当前上下文直接输出最终 Markdown 答案。")
    fallback_response = _build_llm(temperature=0.2).invoke(messages + [fallback_prompt])
    return str(fallback_response.content)


def _generate_one_news_item() -> Dict[str, str]:
    prompt = random.choice(NEWS_PUSH_PROMPTS)
    content = _run_tool_enabled_chat(prompt, strict_news_only=True)
    item = _parse_news_markdown(content)
    if not item.get("link"):
        # enforce required source link if model misses it
        item["link"] = _extract_url(content)
    return item


def _refill_news_cache_worker() -> None:
    global NEWS_CACHE_REFILLING
    try:
        while True:
            with NEWS_CACHE_LOCK:
                if len(NEWS_CACHE) >= NEWS_CACHE_TARGET:
                    break
            try:
                item = _generate_one_news_item()
            except Exception as exc:
                logger.warning("News prefetch failed: %s", exc)
                break
            with NEWS_CACHE_LOCK:
                NEWS_CACHE.append(item)
    finally:
        with NEWS_CACHE_LOCK:
            NEWS_CACHE_REFILLING = False


def _trigger_news_prefetch() -> None:
    global NEWS_CACHE_REFILLING
    with NEWS_CACHE_LOCK:
        if NEWS_CACHE_REFILLING or len(NEWS_CACHE) >= NEWS_CACHE_TARGET:
            return
        NEWS_CACHE_REFILLING = True
    thread = threading.Thread(target=_refill_news_cache_worker, daemon=True)
    thread.start()


_trigger_news_prefetch()


def _learn_from_interaction(user_text: str, assistant_text: str) -> None:
    messages = [
        {"role": "user", "content": user_text},
        {"role": "assistant", "content": assistant_text},
    ]

    update_memory(store, ("news_feed_agent", "news_source_preferences"), messages)
    update_memory(store, ("news_feed_agent", "content_preferences"), messages)


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/preferences")
def preferences() -> Dict[str, str]:
    source = get_memory(
        store,
        ("news_feed_agent", "news_source_preferences"),
        default_news_source_preferences,
    )
    content = get_memory(
        store,
        ("news_feed_agent", "content_preferences"),
        default_content_preferences,
    )
    return {"news_sources": source, "content_preferences": content}


@app.post("/api/news/next")
def next_news() -> Dict[str, str]:
    with NEWS_CACHE_LOCK:
        item = NEWS_CACHE.popleft() if NEWS_CACHE else None

    if item is None:
        item = _generate_one_news_item()

    _trigger_news_prefetch()
    return item


@app.get("/api/news/detail")
def news_detail(url: str) -> Dict[str, str]:
    decoded = unquote(url).strip()
    parsed = urlparse(decoded)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Invalid url parameter")

    results = tavily_extract_content.invoke({"urls": [decoded]})
    if not results:
        raise HTTPException(status_code=404, detail="No content extracted")

    first = results[0] if isinstance(results, list) else {}
    content = first.get("content", "") if isinstance(first, dict) else ""
    if not content:
        content = "未能提取正文，请打开原文链接查看。"

    return {"url": decoded, "content": content}


@app.post("/api/chat")
def chat(payload: ChatRequest) -> Dict[str, str]:
    user_message = payload.message.strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Message is required.")

    try:
        forced_query = (
            f"{user_message}\n\n"
            "输出要求：请使用 Markdown。"
            "若回答中包含新闻信息，每条新闻都必须带原文链接，格式为 [标题](链接)：摘要。"
        )
        assistant_message = _run_tool_enabled_chat(forced_query, strict_news_only=False)
    except Exception as exc:
        logger.exception("Chat generation failed: %s", exc)
        return {
            "content": "当前模型服务暂时繁忙，请稍后重试。",
            "learning_status": "skipped",
        }

    learning_status = "updated"

    # Keep chat responsive: preference learning failure should not break the main reply.
    try:
        _learn_from_interaction(user_message, assistant_message)
    except Exception as exc:
        learning_status = "skipped"
        logger.warning("Preference learning skipped after chat response: %s", exc)

    return {"content": assistant_message, "learning_status": learning_status}


@app.post("/api/feedback")
def feedback(payload: FeedbackRequest) -> Dict[str, str]:
    text = payload.feedback.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Feedback is required.")

    try:
        update_memory(
            store,
            ("news_feed_agent", "content_preferences"),
            [{"role": "user", "content": text}],
        )
        update_memory(
            store,
            ("news_feed_agent", "news_source_preferences"),
            [{"role": "user", "content": text}],
        )
    except Exception as exc:
        logger.warning("Preference update skipped in feedback endpoint: %s", exc)
        return {"status": "skipped"}

    return {"status": "updated"}


# ── Weather data ────────────────────────────────────────────────

CITY_ADCODES: Dict[str, str] = {
    "北京": "110000",
    "天津": "120000",
    "上海": "310000",
    "重庆": "500000",
    "哈尔滨": "230100",
    "长春": "220100",
    "沈阳": "210100",
    "呼和浩特": "150100",
    "石家庄": "130100",
    "太原": "140100",
    "西安": "610100",
    "兰州": "620100",
    "西宁": "630100",
    "银川": "640100",
    "乌鲁木齐": "650100",
    "拉萨": "540100",
    "郑州": "410100",
    "武汉": "420100",
    "长沙": "430100",
    "南京": "320100",
    "杭州": "330100",
    "合肥": "340100",
    "南昌": "360100",
    "福州": "350100",
    "台北": "710000",
    "济南": "370100",
    "青岛": "370200",
    "昆明": "530100",
    "贵阳": "520100",
    "南宁": "450100",
    "广州": "440100",
    "海口": "460100",
    "成都": "510100",
    "深圳": "440300",
    "香港": "810000",
    "澳门": "820000",
    "厦门": "350200",
    "苏州": "320500",
    "大连": "210200",
    "宁波": "330200",
}


def _build_travel_advice(weather_data: Dict[str, Any]) -> str:
    """Use LLM to generate travel advice based on weather forecast data."""
    try:
        llm = _build_llm(temperature=0.2)
        system_msg = SystemMessage(
            content="你是一个专业的出行助手。根据提供的天气预报数据，用中文为用户生成简洁实用的出行建议（2-4句话）。"
                    "建议应包含：穿衣、交通、注意事项等实用信息。如果有恶劣天气需重点提醒。"
        )
        human_msg = HumanMessage(content=f"城市：{weather_data.get('city', '未知')}\n预报数据：{json.dumps(weather_data, ensure_ascii=False)}")
        response = llm.invoke([system_msg, human_msg])
        return str(response.content).strip()
    except Exception as exc:
        logger.warning("Travel advice generation failed: %s", exc)
        return "暂无出行建议，请留意天气变化。"


@app.get("/api/weather")
def get_weather(city: str = "天津", days: int = 5) -> Dict[str, Any]:
    """
    Get weather forecast for a city.
    city: city name (e.g. "北京")
    days: number of forecast days, max 7, default 5
    """
    adcode = CITY_ADCODES.get(city)
    if not adcode:
        available = list(CITY_ADCODES.keys())
        raise HTTPException(status_code=400, detail=f"Unsupported city '{city}'. Available: {available}")

    amap_key = os.getenv("AMAP_KEY")
    if not amap_key:
        raise HTTPException(status_code=500, detail="AMAP_KEY is not configured in .env file.")

    safe_days = max(1, min(days, 7))

    with httpx.Client(timeout=15.0) as client:
        resp = client.get(
            "https://restapi.amap.com/v3/weather/weatherInfo",
            params={"key": amap_key, "city": adcode, "extensions": "all", "output": "JSON"},
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to reach weather service.")

    data = resp.json()
    if data.get("status") != "1":
        raise HTTPException(status_code=502, detail=f"Weather API error: {data.get('info', 'unknown')}")

    forecast = data.get("forecasts", [{}])[0] if data.get("forecasts") else {}
    casts = forecast.get("casts", [])
    sliced = casts[:safe_days]

    forecast_data = {
        "city": forecast.get("city", city),
        "adcode": forecast.get("adcode", adcode),
        "province": forecast.get("province", ""),
        "reporttime": forecast.get("reporttime", ""),
        "casts": sliced,
    }

    travel_advice = _build_travel_advice(forecast_data)

    return {
        "city": forecast_data["city"],
        "adcode": forecast_data["adcode"],
        "province": forecast_data["province"],
        "reporttime": forecast_data["reporttime"],
        "casts": forecast_data["casts"],
        "travel_advice": travel_advice,
    }


STOCK_INDEX_MAP: Dict[str, Tuple[str, str]] = {
    "000001": ("上证指数", "sh"),
    "399001": ("深证成指", "sz"),
    "000300": ("沪深300", "sh"),
    "000688": ("科创50", "sh"),
    "399006": ("创业板指", "sz"),
    "000016": ("上证50", "sh"),
    "000905": ("中证500", "sh"),
    "000852": ("中证1000", "sh"),
    "399005": ("中小板指", "sz"),
}

STOCK_HEADERS: Dict[str, str] = {
    "Referer": "http://finance.sina.com.cn/",
}


@app.get("/api/stock")
def get_stock(symbol: str = "") -> Dict[str, Any]:
    """
    Get real-time quote for a stock index.
    Uses Sina Finance API (free, no auth required).
    """
    sym = symbol.strip()
    if not sym:
        raise HTTPException(status_code=400, detail="symbol is required")

    info = STOCK_INDEX_MAP.get(sym)
    prefix = info[1] if info else None
    if not prefix:
        if sym.startswith("60") or sym.startswith("5") or sym.startswith("688"):
            prefix = "sh"
        elif sym.startswith("00") or sym.startswith("30") or sym.startswith("002"):
            prefix = "sz"
        elif sym.startswith("8") or sym.startswith("4"):
            prefix = "bj"
        else:
            prefix = "sh"

    sina_sym = f"s_{prefix}{sym}"
    try:
        with httpx.Client(timeout=15.0, headers=STOCK_HEADERS) as client:
            resp = client.get(
                "http://hq.sinajs.cn/list",
                params={"list": sina_sym},
            )
        if resp.status_code != 200 or not resp.text.strip():
            raise HTTPException(status_code=502, detail="Stock API unreachable")

        raw = resp.text.strip()
        line = raw.split("\n")[0] if "\n" in raw else raw

        if "=\"\";" in line or len(line) < 20:
            return {
                "symbol": sym,
                "name": info[0] if info else sym,
                "price": None,
                "change": None,
                "changePercent": None,
                "open": None,
                "high": None,
                "low": None,
                "prevClose": None,
                "volume": None,
                "amount": None,
                "error": "无数据",
            }

        content = line.split('="')[1].rstrip('";')
        parts = content.split(",")
        if len(parts) < 6:
            return {
                "symbol": sym,
                "name": info[0] if info else sym,
                "price": None,
                "change": None,
                "changePercent": None,
                "open": None,
                "high": None,
                "low": None,
                "prevClose": None,
                "volume": None,
                "amount": None,
                "error": "数据格式异常",
            }

        name = info[0] if info else parts[0]
        vol_str = parts[1]
        amount_str = parts[2]
        vol = float(vol_str) if vol_str and vol_str not in ("", "-") else None
        amount = float(amount_str) if amount_str and amount_str not in ("", "-") else None

        price: Optional[float] = None
        change: Optional[float] = None
        change_percent: Optional[float] = None
        prev_close: Optional[float] = None
        open_price: Optional[float] = None
        high_price: Optional[float] = None
        low_price: Optional[float] = None

        if len(parts) == 6:
            price = float(parts[1]) if parts[1] not in ("", "-") else None
            change = float(parts[2]) if parts[2] not in ("", "-") else None
            change_percent = float(parts[3]) if parts[3] not in ("", "-") else None
        elif len(parts) >= 10:
            open_price = float(parts[1]) if parts[1] not in ("", "-") else None
            prev_close = float(parts[2]) if parts[2] not in ("", "-") else None
            price = float(parts[3]) if parts[3] not in ("", "-") else None
            high_price = float(parts[4]) if parts[4] not in ("", "-") else None
            low_price = float(parts[5]) if parts[5] not in ("", "-") else None
            if price is not None and prev_close is not None:
                change = round(price - prev_close, 2)
            if prev_close and prev_close != 0 and price is not None:
                change_percent = round((price - prev_close) / prev_close * 100, 2)

        return {
            "symbol": sym,
            "name": name,
            "price": price,
            "change": change,
            "changePercent": change_percent,
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "prevClose": prev_close,
            "volume": vol,
            "amount": amount,
            "error": None,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Stock quote fetch failed for %s: %s", sym, exc)
        return {
            "symbol": sym,
            "name": sym,
            "price": None,
            "change": None,
            "changePercent": None,
            "open": None,
            "high": None,
            "low": None,
            "prevClose": None,
            "volume": None,
            "amount": None,
            "error": f"获取失败: {exc}",
        }


@app.get("/api/stock/history")
def get_stock_history(symbol: str = "") -> Dict[str, Any]:
    """
    Get daily K-line data for a stock index (past ~10 trading days).
    Uses Sina Finance API (free, no auth required).
    Returns a list of daily records with date, open, close, high, low, volume.
    """
    sym = symbol.strip()
    if not sym:
        raise HTTPException(status_code=400, detail="symbol is required")

    info = STOCK_INDEX_MAP.get(sym)
    prefix = info[1] if info else None
    if not prefix:
        if sym.startswith("60") or sym.startswith("5") or sym.startswith("688"):
            prefix = "sh"
        elif sym.startswith("00") or sym.startswith("30") or sym.startswith("002"):
            prefix = "sz"
        elif sym.startswith("8") or sym.startswith("4"):
            prefix = "bj"
        else:
            prefix = "sh"

    sina_sym = f"{prefix}{sym}"
    try:
        with httpx.Client(timeout=15.0, headers=STOCK_HEADERS) as client:
            resp = client.get(
                "http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData",
                params={
                    "symbol": sina_sym,
                    "scale": "240",
                    "ma": "no",
                    "datalen": "10",
                },
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="History API unreachable")

        raw_text = resp.text.strip()
        klines = json.loads(raw_text) if raw_text.startswith("[") else []

        history = []
        for item in klines:
            if not isinstance(item, dict):
                continue
            history.append({
                "date": item.get("day", "")[:10],
                "open": float(item["open"]) if item.get("open") not in ("", "-") else None,
                "close": float(item["close"]) if item.get("close") not in ("", "-") else None,
                "high": float(item["high"]) if item.get("high") not in ("", "-") else None,
                "low": float(item["low"]) if item.get("low") not in ("", "-") else None,
                "volume": float(item["volume"]) if item.get("volume") not in ("", "-") else 0,
            })

        return {"symbol": sym, "history": history, "error": None}

    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Stock history fetch failed for %s: %s", sym, exc)
        return {"symbol": sym, "history": [], "error": f"获取历史数据失败: {exc}"}


# ── Auth helpers ───────────────────────────────────────────────

def get_user_from_header(authorization: str = Header(None)) -> Optional[dict]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return decode_token(authorization[7:])


def require_auth(authorization: str = Header(None)) -> dict:
    user = get_user_from_header(authorization)
    if user is None:
        raise HTTPException(status_code=401, detail="请先登录")
    return user


# ── Auth endpoints ─────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@app.post("/api/auth/register")
def register(req: RegisterRequest) -> Dict[str, Any]:
    username = req.username.strip()
    password = req.password
    if len(username) < 3 or len(username) > 50:
        raise HTTPException(status_code=400, detail="用户名需3-50个字符")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="密码至少6位")
    if get_user_by_username(username):
        raise HTTPException(status_code=409, detail="用户名已存在")
    user_id, username = create_user(username, password)
    token = create_token(user_id, username)
    return {"token": token, "username": username, "userId": user_id}


@app.post("/api/auth/login")
def login(req: LoginRequest) -> Dict[str, Any]:
    user = get_user_by_username(req.username.strip())
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = create_token(user.id, user.username)
    return {"token": token, "username": user.username, "userId": user.id}


@app.post("/api/auth/logout")
def logout(authorization: str = Header(None)) -> Dict[str, str]:
    return {"message": "ok"}


@app.get("/api/auth/me")
def me(authorization: str = Header(None)) -> Dict[str, Any]:
    user_data = require_auth(authorization)
    return {"userId": int(user_data["sub"]), "username": user_data["username"]}


@app.post("/api/auth/change-password")
def change_password(req: ChangePasswordRequest, authorization: str = Header(None)) -> Dict[str, str]:
    user_data = require_auth(authorization)
    with get_session() as db:
        user = db.get(User, int(user_data["sub"]))
        if not user or not verify_password(req.old_password, user.password_hash):
            raise HTTPException(status_code=400, detail="原密码错误")
        user.password_hash = hash_password(req.new_password)
        db.commit()
    return {"message": "密码修改成功"}


# ── Article action endpoints ────────────────────────────────────

class ArticleActionRequest(BaseModel):
    url: str
    action: str
    title_zh: str = ""
    title_en: str = ""
    summary_zh: str = ""
    summary_en: str = ""


@app.post("/api/article/action")
def article_action(req: ArticleActionRequest, authorization: str = Header(None)) -> Dict[str, Any]:
    user_data = require_auth(authorization)
    action_map = {"like": ActionType.like, "favorite": ActionType.favorite, "not_interested": ActionType.not_interested}
    action = action_map.get(req.action)
    if action is None:
        raise HTTPException(status_code=400, detail="无效的操作类型")

    with get_session() as db:
        set_article_action(db, int(user_data["sub"]), req.url, action,
                          req.title_zh, req.title_en, req.summary_zh, req.summary_en)
    return {"action": req.action}


@app.get("/api/article/actions")
def get_article_actions(
    action: str = Query(...),
    limit: int = Query(50),
    offset: int = Query(0),
    authorization: str = Header(None),
) -> Dict[str, Any]:
    user_data = require_auth(authorization)
    action_map = {"like": ActionType.like, "liked": ActionType.like,
                  "favorite": ActionType.favorite, "favorited": ActionType.favorite,
                  "history": ActionType.viewed}
    act = action_map.get(action)
    if act is None:
        raise HTTPException(status_code=400, detail="无效的操作类型")

    with get_session() as db:
        total = count_user_actions(db, int(user_data["sub"]), act)
        actions = get_user_actions(db, int(user_data["sub"]), act, limit, offset)
        articles = []
        for a in actions:
            articles.append({
                "url": a.article.url,
                "title_zh": a.article.title_zh or "未命名",
                "title_en": a.article.title_en or "",
                "summary_zh": a.article.summary_zh or "",
                "summary_en": a.article.summary_en or "",
                "action": a.action.value,
                "created_at": a.created_at.isoformat(),
            })
        return {"articles": articles, "has_more": (offset + len(articles)) < total}


@app.post("/api/article/view")
def record_view(req: ArticleActionRequest, authorization: str = Header(None)) -> Dict[str, str]:
    user_data = get_user_from_header(authorization)
    if user_data is None:
        return {"message": "ok"}
    with get_session() as db:
        set_article_action(db, int(user_data["sub"]), req.url, ActionType.viewed,
                          req.title_zh, req.title_en, req.summary_zh, req.summary_en)
    return {"message": "ok"}


@app.get("/api/article/actions/by-url")
def get_article_actions_by_url(
    url: str = Query(...),
    authorization: str = Header(None),
) -> Dict[str, Any]:
    user_data = get_user_from_header(authorization)
    if user_data is None:
        return {"like": False, "favorite": False, "not_interested": False}
    with get_session() as db:
        actions = get_user_article_actions(db, int(user_data["sub"]), url)
    return {
        "like": bool(actions.get("like")),
        "favorite": bool(actions.get("favorite")),
        "not_interested": bool(actions.get("not_interested")),
    }


# ── Preferences (per-user) ──────────────────────────────────────

@app.get("/api/preferences")
def get_preferences(authorization: str = Header(None)) -> Dict[str, Any]:
    user_data = get_user_from_header(authorization)
    if user_data is None:
        source = get_memory(store, ("news_feed_agent", "news_source_preferences"), default_news_source_preferences)
        content = get_memory(store, ("news_feed_agent", "content_preferences"), default_content_preferences)
        return {"news_sources": json.loads(source) if isinstance(source, str) else list(source or []),
                "content_preferences": json.loads(content) if isinstance(content, str) else list(content or []),
                "is_guest": True}

    with get_session() as db:
        pref = db.scalars(
            select(UserPreference).where(UserPreference.user_id == int(user_data["sub"]))
        ).first()
        if pref:
            return {"news_sources": pref.news_source_preferences or [],
                    "content_preferences": pref.content_preferences or [],
                    "is_guest": False}
        return {"news_sources": [], "content_preferences": [], "is_guest": False}


@app.post("/api/preferences")
def update_preferences(req: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    user_data = require_auth(authorization)
    sources = req.get("news_sources", [])
    content = req.get("content_preferences", [])

    with get_session() as db:
        pref = db.scalars(
            select(UserPreference).where(UserPreference.user_id == int(user_data["sub"]))
        ).first()
        if pref:
            pref.news_source_preferences = sources
            pref.content_preferences = content
        else:
            pref = UserPreference(user_id=int(user_data["sub"]),
                                  news_source_preferences=sources, content_preferences=content)
            db.add(pref)
        db.commit()

    return {"news_sources": sources, "content_preferences": content}


# ── Stock / News endpoints remain unchanged ────────────────────


@app.get("/")
def index() -> FileResponse:
    if not WEB_DIR.exists():
        raise HTTPException(status_code=500, detail="Web assets folder not found.")
    return FileResponse(WEB_DIR / "index.html")


@app.get("/article")
def article_page() -> FileResponse:
    if not WEB_DIR.exists():
        raise HTTPException(status_code=500, detail="Web assets folder not found.")
    return FileResponse(WEB_DIR / "article.html")
