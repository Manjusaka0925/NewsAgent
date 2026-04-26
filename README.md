# 新闻代理 (News Agent)

一个基于 LangGraph 构建的 AI 驱动新闻聚合代理，现已支持独立 Web 前端（FastAPI + 现代化单页界面），可以爬取你喜欢的新闻源并根据你的兴趣提供个性化新闻摘要。

## 项目概述

这个新闻代理可以：
- 从你偏好的新闻源提供每日新闻简讯
- 分享有趣的新闻事实
- 总结来自特定新闻源的新闻
- 随着时间推移学习和适应你的内容偏好

该代理使用 [Tavily](https://www.tavily.com/) 进行网页爬取，使用 Qwen3.5-Flash（OpenAI 兼容接口）进行智能内容策划。

## 独立前端版本

当前项目已新增独立前端与后端接口，实现以下页面和交互：

- 左侧导航栏包含：`主页`、`新闻浏览`、`天气导览`、`AI 智能搜索`
- 默认进入主页，显示开始按钮
- 点击开始后进入新闻浏览页，自动推送一条今日新闻
- 在新闻浏览页向下滑动到底部，或点击右侧圆形向下按钮，自动加载下一条推荐
- 点击"天气导览"进入天气页，可查看最多3个城市的多日天气预报及出行建议，每个卡片支持独立切换城市和预报天数
- 点击"AI 智能搜索"进入聊天页，可按兴趣提问新闻；提问内容会反向更新偏好并影响后续推荐

新增文件：

- `src/news_agent/web_api.py`：FastAPI 后端（新闻流、聊天、天气、偏好更新接口）
- `web/index.html`：前端页面骨架
- `web/styles.css`：现代风格 UI 与动效
- `web/app.js`：页面导航、新闻流加载、天气、聊天交互

## 安装步骤

### 从0开始运行项目的完整指南

#### 第一步：环境准备

**1. 安装 Python**
   - 确保已安装 Python 3.11 或更高版本
   - 验证：打开 PowerShell，运行 `python --version`

**2. 安装 uv 包管理工具（推荐）**
   ```powershell
   pip install uv
   ```

#### 第二步：获取项目

**1. 克隆或下载项目**
   ```powershell
   cd C:\path\to\NewsAgent
   ```

#### 第三步：依赖安装

**1. 使用 uv 安装依赖**
   ```powershell
   uv sync
   ```

   这将安装以下主要依赖：
   - `langchain` - LLM 应用框架
   - `langgraph` - AI 工作流编排框架
   - `langchain-openai` - OpenAI 集成
   - `langgraph-cli` - LangGraph 开发工具
   - `tavily-python` - 网页爬虫工具
   - `langsmith` - 日志和调试工具

#### 第四步：配置 API 密钥

**1. 阅读并复制 `.env.example` 文件中的内容**
   ```
   # 相关内容的获取方法在该文件已经说明
   ```

**2. 编辑 `.env` 文件（用 VSCode 或任何文本编辑器打开）**
   ```
   # 你需要填写以下 API 密钥：
   QWEN_API_KEY=你的千问API密钥
   QWEN_API_BASE=千问的接口基础地址
   TAVILY_API_KEY=你的TavilyAPI密钥
   AMAP_KEY=你的高德地图Web服务API密钥（用于天气功能）
   ```

#### 第五步：启动项目

**方式 A：启动独立前端版本（推荐）**

```powershell
uv run uvicorn news_agent.web_api:app --reload --host 127.0.0.1 --port 8000
```

打开浏览器访问：`http://127.0.0.1:8000`

**方式 B：启动 LangGraph Studio（开发调试）**

```powershell
langgraph dev
```


#### 第六步：独立前端交互说明

1. `开始`：点击开始进入新闻浏览
2. `新闻浏览`：
   - 首次自动生成"今日一条新闻"
   - 向下滑到底部自动加载下一条
   - 点击右侧圆形箭头也会加载下一条
3. `天气导览`：
   - 默认显示天津、北京、上海三个城市
   - 每个卡片可单独切换城市（支持全国40+城市）
   - 每个卡片可单独设置预报天数（3-7天）
   - 每个卡片提供 AI 生成的出行建议
   - 天气数据来自高德地图 API
4. `AI 智能搜索`：
   - 可主动提问指定主题新闻
   - 你的提问会更新偏好记忆，影响后续推荐

#### 第七步：如果你只需要 API

接口示例：

- `GET /api/health`：健康检查
- `POST /api/news/next`：获取下一条推荐新闻
- `POST /api/chat`：聊天问答并更新偏好
- `GET /api/weather`：获取城市天气预报
- `GET /api/preferences`：查看当前偏好

示例请求：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/chat" -Method Post -ContentType "application/json" -Body '{"message":"请给我今天AI投融资新闻"}'
```

---

## 原始 LangGraph 运行方式（保留）

**1. 启动 LangGraph 开发服务器**
   ```powershell
   langgraph dev
   ```

**2. 打开浏览器**
   - 自动打开 LangGraph Studio 界面（通常是 http://localhost:8000）
   - 如果没有自动打开，手动访问该地址

**3. 与代理交互**

在 LangGraph Studio 中，你可以尝试以下指令：


- "Give me today's daily digest" - 获取今日新闻简讯
- "What's an interesting tech fact from today?" - 获取有趣的科技事实
- "Summarize the latest from TechCrunch" - 总结 TechCrunch 最新新闻
- "I prefer business news over technology" - 告诉代理你的偏好（代理会学习）


## 核心功能说明

### 1. 代理工作流程
- 接收用户查询
- 使用 Tavily 工具搜索相关新闻
- 从网页内容中提取关键信息
- 使用 Qwen3.5-Flash 进行内容总结和策划
- 返回个性化结果

### 2. 内存管理
代理维护两种类型的偏好记录：
- **新闻源偏好**：你最喜欢关注的新闻网站
- **内容偏好**：你感兴趣的主题和类型

### 3. 学习机制
- 代理通过你的反馈不断学习
- 提供用户反馈来改进推荐
- 随时间提供更符合你兴趣的结果


## 技术栈

- **Python 3.11+** - 编程语言
- **LangGraph** - AI 工作流编排框架
- **LangChain** - LLM 应用开发框架
- **Qwen3.5-Flash（OpenAI 兼容）** - 语言模型
- **Tavily** - Web 爬虫和搜索工具
- **高德地图 API** - 天气数据来源
- **FastAPI + Uvicorn** - 独立后端服务
- **原生 HTML/CSS/JS** - 现代化独立前端
- **LangSmith** - 可选调试平台（可关闭）

## 下一步

完成基本运行后，你可以：
- 探索修改 `news_agent.py` 中的工作流
- 在 `prompts.py` 中自定义提示词
- 添加更多的新闻源到 `default_news_source_preferences`
- 集成到你自己的应用中

## 许可证和贡献

查看 `CONTRIBUTORS.md` 了解项目贡献者信息。

---

**需要帮助？** 检查是否遗漏了任何 API 密钥配置，或查看各个工具文件中的代码注释。
