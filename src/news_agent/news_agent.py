import os
from typing import Any, Dict, List, Literal

from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.store.base import BaseStore
from langgraph.types import Command, interrupt

# Import prompts for both news source and generic preference updates
from news_agent.prompts import (MEMORY_UPDATE_INSTRUCTIONS,
                                MEMORY_UPDATE_INSTRUCTIONS_NEWS_SOURCE)
# Structured output schemas for the two preference types
from news_agent.schemas import UserNewsSourcePreferences, UserPreferences
from news_agent.tools.tavily_tools import (tavily_crawl,
                                           tavily_extract_content,
                                           tavily_map_site, tavily_search)

default_news_source_preferences = """   

- TechCrunch
- The Verge
- The Wall Street Journal
- The New Yorker
- The Atlantic
- New York Times
- The Economist
- Associated Press
- Forbes
- Bloomberg
- The Economist
"""

default_content_preferences = """
- Technology and innovation news
- Business and finance developments
- AI and machine learning advancements
- Startup and venture capital news
- Digital transformation trends
- Economic policy and market analysis
- Media and journalism industry insights
"""


def get_memory(
    store,
    namespace,
    default_content,
):
    """Get memory from the store or initialize with default if it doesn't exist.

    Args:
        store: LangGraph BaseStore instance to search for existing memory

    Returns:
        str: The content of the memory profile, either from existing memory or the default
    """

    # Search for existing memory with namespace and key
    user_preferences = store.get(namespace, "user_preferences")

    if user_preferences:
        return user_preferences.value
    else:
        store.put(namespace, "user_preferences", default_content)

        return default_content


def update_memory(store, namespace, messages):
    """Update memory profile in the store.

    Args:
        store: LangGraph BaseStore instance to update memory
        namespace: Tuple defining the memory namespace, e.g. ("news_feed_agent", "news_source_preferences")
        messages: List of messages to update the memory with
    """

    # ----------------------------------------------------------------------------------
    # Determine which preference profile we are updating (news sources vs. content).
    # This allows us to keep the two preference types cleanly separated so that
    # websites do not bleed into content preferences and vice-versa.
    # ----------------------------------------------------------------------------------

    # The namespace is always of the form ("news_feed_agent", <preference_key>)
    preference_key = namespace[1] if len(namespace) > 1 else ""

    if preference_key == "news_source_preferences":
        instructions_prompt = (
            MEMORY_UPDATE_INSTRUCTIONS_NEWS_SOURCE
            + "\n\n重要：画像中只能保留网站或媒体名称（例如：TechCrunch、nytimes.com），严禁写入主题兴趣。"
        )
        schema = UserNewsSourcePreferences
        preference_attribute_name = "user_news_source_preferences"
    elif preference_key == "content_preferences":
        # Dedicated instructions so that only content/topics of interest are captured
        instructions_prompt = """
    # 角色与目标
    你是新闻代理的记忆画像管理器。你需要基于人工反馈消息，有选择地更新“内容偏好”（主题、关注方向）。

    # 指令
    - 严禁整体覆写记忆画像
    - 只做有依据的增量补充
    - 仅当反馈明确与旧信息冲突时，才修改对应条目
    - 其余信息必须完整保留
    - 画像中只能出现内容主题或兴趣方向，不能出现网站/媒体来源
    - 输出风格保持原样（项目符号列表）
    - 以字符串形式输出完整画像

    # 推理步骤
    1. 分析当前记忆画像结构与内容。
    2. 阅读人工反馈消息。
    3. 仅提取内容偏好（主题兴趣）。
    4. 与现有画像逐条比对。
    5. 识别应新增或应修改的最小事实集合。
    6. 保留其他全部信息。
    7. 输出更新后的完整画像。

    # 示例
    <memory_profile>
    - 对计算机视觉及其制造业应用非常感兴趣
    - 对物联网及其制造业应用感兴趣
    </memory_profile>

    <user_messages>
    "请优先推荐可持续发展和绿色制造相关的文章"
    </user_messages>

    <updated_profile>
    - 对计算机视觉及其制造业应用非常感兴趣
    - 对物联网及其制造业应用感兴趣
    - 可持续发展与绿色制造
    </updated_profile>

    # 处理命名空间 {namespace}
    <memory_profile>
    {current_profile}
    </memory_profile>

    请逐步思考本轮反馈，并在尽量少改动的前提下更新画像："""

        schema = UserPreferences
        preference_attribute_name = "user_preferences"
    else:  # Any unforeseen preference namespace falls back to generic behaviour
        instructions_prompt = MEMORY_UPDATE_INSTRUCTIONS
        schema = UserPreferences
        preference_attribute_name = "user_preferences"

    # Update the memory using the appropriate structured output schema so that the
    # resulting profile only contains the correct type of preference data.
    llm = ChatOpenAI(
        model="qwen3.5-flash",
        temperature=0.0,
        api_key=os.getenv("QWEN_API_KEY"),
        base_url=os.getenv("QWEN_API_BASE")
    ).with_structured_output(schema)

    # Get the existing memory (if this is the first time, fall back to an empty string)
    user_preferences_record = store.get(namespace, "user_preferences")
    existing_profile_value = (
        user_preferences_record.value if user_preferences_record else ""
    )

    # Update the memory
    formatted_messages = []
    for msg in messages:
        if isinstance(msg, dict):
            # Message already in the correct format
            formatted_messages.append(msg)
        elif hasattr(msg, "role") and hasattr(msg, "content"):
            # LangChain BaseMessage (e.g., AIMessage, HumanMessage)
            formatted_messages.append({"role": msg.role, "content": msg.content})
        else:
            # Fallback: convert to string and use as assistant content
            formatted_messages.append({"role": "assistant", "content": str(msg)})

    result = llm.invoke(
        [
            {
                "role": "system",
                "content": instructions_prompt.format(
                    current_profile=existing_profile_value, namespace=namespace
                )
                + "\n\nReturn the structured output strictly as valid JSON.",
            },
        ]
        + formatted_messages
    )
    # Save the updated memory to the store
    updated_value: str
    if hasattr(result, preference_attribute_name):
        updated_value = getattr(result, preference_attribute_name)  # type: ignore[attr-defined]
    elif hasattr(result, "user_preferences"):
        updated_value = result.user_preferences  # type: ignore[attr-defined]
    elif hasattr(result, "user_news_source_preferences"):
        updated_value = result.user_news_source_preferences  # type: ignore[attr-defined]
    else:
        # Fallback: attempt to treat the result as a dict or string
        if isinstance(result, dict):
            updated_value = result.get("user_preferences") or result.get(
                "user_news_source_preferences", ""
            )
        else:
            updated_value = str(result)

    store.put(namespace, "user_preferences", updated_value)


class CrawlState(MessagesState):
    """State for the crawling agent."""

    crawl_results: List[Dict[str, Any]] = []
    discovered_urls: List[str] = []
    summary: str = ""


def crawl_agent(
    state: CrawlState, store: BaseStore
) -> Command[Literal["tools", "feedback"]]:
    """Intelligent crawling agent that can crawl websites, extract content, and search the web."""
    llm = ChatOpenAI(
        model="qwen3.5-flash",
        temperature=0.0,
        api_key=os.getenv("QWEN_API_KEY"),
        base_url=os.getenv("QWEN_API_BASE")
    )
    llm_with_tools = llm.bind_tools(
        [tavily_crawl, tavily_map_site, tavily_search, tavily_extract_content]
    )

    # Get the news source preferences
    news_source_preferences = get_memory(
        store,
        ("news_feed_agent", "news_source_preferences"),
        default_news_source_preferences,
    )

    # Get the content preferences
    content_preferences = get_memory(
        store,
        ("news_feed_agent", "content_preferences"),
        default_content_preferences,
    )

    # Enhanced system prompt for crawling capabilities
    system_prompt = f"""你是一个智能新闻聚合助手，目标是基于用户偏好生成高质量新闻摘要。

你可以按三种模式工作：
1. 每日简报：从用户偏好来源中选取当天最重要新闻。
2. 趣味新闻：提供当天有意思、反常识或值得讨论的一条新闻。
3. 单来源总结：若用户指定来源，只总结该来源内容。

若用户意图不清晰，默认使用“每日简报”。

可用工具：
1. tavily_crawl：从入口页抓取站点内容
2. tavily_map_site：发现站点 URL
3. tavily_search：全网搜索
4. tavily_extract_content：抽取指定 URL 正文

若一次工具调用结果质量不足，切换策略重试。

不要反问用户，直接给出最佳结果。

--- 输出格式要求 ---
最终输出必须是可渲染的 Markdown。
每条新闻必须包含可点击的原文链接，格式如下：

- [标题](原文URL)：一句话摘要

可按主题分组，并在末尾附“### Sources”编号链接列表。
列表中的每条链接都必须在正文里出现过，不要输出无关链接。

以下是用户“新闻来源偏好”，检索时优先使用：
{news_source_preferences}

以下是用户“内容偏好”，输出必须与之匹配：
{content_preferences}

若首轮结果不足 5 条：
   • 使用 tavily_search(max_results=20, search_depth="advanced") 重试。
   • 若仍不足，先用 tavily_map_site 再用 tavily_extract_content。
仅在满足偏好且达到结果数量，或连续三次无新增结果时停止。
"""

    response = llm_with_tools.invoke(
        [{"role": "system", "content": system_prompt}, *state["messages"]]
    )

    update = {
        "messages": [response],
    }
    return Command(
        update=update,
        goto="tools",
    )


# Create the tool node with all available tools
tools = [tavily_crawl, tavily_map_site, tavily_search, tavily_extract_content]
tool_node = ToolNode(tools)


def feedback_node(state: CrawlState, store: BaseStore) -> Command[Literal["__end__"]]:
    """Feedback node introduces human in the loop to provide feedback on the results."""
    request = {
        "action_request": {
            "action": "反馈：本次摘要效果如何？是否需要补充或调整偏好？",
            "args": {},
        },
        "config": {
            "allow_ignore": True,
            "allow_respond": True,
            "allow_edit": False,
            "allow_accept": False,
        },
        "description": state["messages"][-1].content,
    }
    response = interrupt([request])[0]

    if response["type"] == "response":
        user_input = response["args"]
        state["messages"].append({"role": "user", "content": user_input})
        update_memory(
            store, ("news_feed_agent", "news_source_preferences"), state["messages"]
        )
        update_memory(
            store, ("news_feed_agent", "content_preferences"), state["messages"]
        )
        goto = END

    elif response["type"] == "ignore":
        goto = END

    else:
        raise ValueError(f"Invalid response: {response}")

    return Command(goto=goto)


# Create the workflow
def should_continue(state: CrawlState) -> str:
    """Determine whether to continue to tools or end."""
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return END


# Keep the original test_graph for backward compatibility
def should_continue_messages(state: MessagesState) -> str:
    """Determine whether to continue to tools or end for MessagesState."""
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return END


overall_workflow = (
    StateGraph(MessagesState)
    .add_node("agent", lambda state, store: crawl_agent(state, store))
    .add_node("tools", tool_node)
    .add_node("feedback", feedback_node)
    .add_edge(START, "agent")
    .add_edge("tools", "agent")
    .add_conditional_edges(
        "agent",
        should_continue_messages,
        {
            "tools": "tools",
            END: "feedback",
        },
    )
    .add_edge("feedback", END)
)

news_agent = overall_workflow.compile()
