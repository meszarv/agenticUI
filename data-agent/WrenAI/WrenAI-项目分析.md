# WrenAI 项目深度分析

## 1. 项目概述

**WrenAI** 是一个开源的 **GenBI（生成式商业智能）Agent**，核心能力是将自然语言问题转化为精确的 SQL 查询和可视化图表。它通过 **语义层（MDL - 元数据定义语言）** 引导 LLM，结合 **RAG（检索增强生成）** 技术实现高质量的 Text-to-SQL 生成。

---

## 2. 项目结构

```
WrenAI/
├── wren-ui/              # Next.js 14 前端 + 内嵌 Apollo GraphQL 后端
├── wren-ai-service/      # Python FastAPI AI/ML 管道服务
├── wren-launcher/        # Go CLI 部署工具 & dbt 项目转换
├── wren-engine/          # SQL 引擎（git 子模块，外部项目）
├── wren-mdl/             # MDL 元数据定义语言 JSON Schema
├── docker/               # Docker Compose 编排配置
├── deployment/           # Kubernetes/Kustomize 生产部署清单
└── misc/                 # 文档与图片资源
```

---

## 3. 系统架构

### 3.1 服务通信流

```
用户浏览器 (http://localhost:3000)
    ↓ GraphQL (Apollo Server)
Wren UI (Next.js 14 + Apollo GraphQL)
    ↓ HTTP REST API
Wren AI Service (FastAPI :5555/5556)
    ├→ LLM 提供商 (OpenAI, Anthropic, DeepSeek, Vertex AI, Bedrock 等)
    ├→ Qdrant 向量数据库 (:6333) - RAG 存储
    ├→ Wren Engine (:8080) - SQL 验证与执行
    └→ Ibis Server (:8000) - 数据源抽象层
```

### 3.2 三层架构

| 层级 | 技术栈 | 职责 |
|------|--------|------|
| **Wren UI** | TypeScript / Next.js 14 / Apollo / Ant Design | 前端交互 + GraphQL API 网关 |
| **Wren AI Service** | Python 3.12 / FastAPI / Hamilton / Haystack | AI 管道编排、RAG、LLM 调用 |
| **外部服务** | Wren Engine / Ibis Server / Qdrant | SQL 执行、数据源连接、向量搜索 |

---

## 4. 核心功能

### 4.1 GenBI 核心能力

| 功能 | 说明 |
|------|------|
| **Text-to-SQL** | 自然语言转精确 SQL 查询 |
| **Text-to-Chart** | 自动生成 Vega-Lite 可视化图表 |
| **语义层 (MDL)** | 业务友好的数据建模（指标、关系、计算字段） |
| **SQL Pair 学习** | 从历史 SQL 问答对中学习，提升准确率 |
| **意图分类** | 在生成 SQL 前理解用户意图 |
| **SQL 自动修正** | 自动修复无效 SQL 并重试（最多 3 次） |
| **问题推荐** | 生成后续建议问题 |
| **图表调整** | 交互式修改已生成的图表 |
| **自定义指令** | 用户可添加自定义指令引导 SQL 生成 |
| **API 嵌入** | 提供 REST API 供外部系统调用 |
| **SQL 诊断** | 对失败的 SQL 进行根因分析 |
| **语义描述生成** | 自动为表和列生成业务描述 |
| **关系推荐** | 智能推荐表之间的关联关系 |

### 4.2 支持的数据源

- PostgreSQL, MySQL, Microsoft SQL Server
- BigQuery, Snowflake, Databricks, Redshift, Athena
- ClickHouse, Oracle, Trino, DuckDB

### 4.3 支持的 LLM 提供商

通过 **LiteLLM** 统一接入 40+ 模型：

| 提供商 | 模型示例 |
|--------|----------|
| OpenAI | GPT-4, GPT-4o, GPT-4o-mini |
| Anthropic | Claude 3/3.5/4 系列 |
| Google | Gemini, Vertex AI |
| AWS Bedrock | Claude, Titan 等 |
| Azure OpenAI | 各 GPT 模型 |
| DeepSeek | DeepSeek-V3 等 |
| Ollama | 本地模型 |
| Groq, LM Studio, Open Router | 各类开源模型 |

---

## 5. 详细服务架构

### 5.1 Wren AI Service（Python / FastAPI）

```
src/
├── core/
│   ├── pipeline.py           # 管道抽象基类
│   ├── provider.py           # 提供商抽象接口（LLM、Embedder、DocumentStore、Engine）
│   └── engine.py             # SQL 引擎抽象接口
├── providers/                # 可插拔的提供商实现
│   ├── llm/litellm.py        # LiteLLM 包装（支持 40+ LLM API）
│   ├── embedder/litellm.py   # 文本嵌入
│   ├── engine/wren.py        # Wren UI / Ibis 引擎实现
│   ├── document_store/qdrant.py
│   └── loader.py             # 插件注册系统（基于装饰器）
├── pipelines/
│   ├── indexing/             # 6 个索引管道（schema/历史问题/表描述/SQL对/指令/项目元数据）
│   ├── retrieval/            # 8 个检索管道（schema检索/历史问题/SQL对/SQL函数/指令等）
│   ├── generation/           # 15+ 生成管道（SQL生成/修正/图表/问题推荐/关系推荐等）
│   └── common.py             # 共享工具（DDL 构建、类型映射）
├── web/v1/
│   ├── routers/              # 13 个 FastAPI 路由处理器
│   └── services/             # 13 个业务逻辑服务
├── config.py                 # Pydantic Settings 配置管理
└── globals.py                # ServiceContainer 依赖注入
```

**管道框架**：使用 **Hamilton**（数据流 DAG 框架）+ **Haystack**（RAG 库）：
- 每个管道是一组用 Hamilton 装饰器标注的 Python 函数
- 支持同步和异步执行
- 由 LLM、Embedder、DocumentStore、Engine 四类提供商组合而成

### 5.2 Wren UI（TypeScript / Next.js 14）

```
src/
├── apollo/
│   ├── server/
│   │   ├── schema.ts              # GraphQL 类型定义
│   │   ├── resolvers/             # 9 个解析器（asking/model/project/dashboard 等）
│   │   ├── services/              # 15 个业务服务
│   │   ├── repositories/          # 9+ 数据访问层（Knex）
│   │   ├── adaptors/              # 3 个外部服务适配器
│   │   │   ├── wrenAIAdaptor.ts   # → Wren AI Service REST API
│   │   │   ├── wrenEngineAdaptor.ts # → Wren Engine
│   │   │   └── ibisAdaptor.ts     # → Ibis Server
│   │   ├── mdl/
│   │   │   └── mdlBuilder.ts      # 从数据库 schema 构建 MDL
│   │   └── backgrounds/           # 异步后台任务
│   └── client/                    # Apollo Client 操作
├── pages/                         # Next.js 页面路由
├── components/                    # React 组件（按功能组织）
├── hooks/                         # 26 个自定义 React Hooks
└── utils/                         # 26 个工具函数
```

### 5.3 Wren Launcher（Go CLI）

- `wren-launcher`：通过 Docker 启动 WrenAI 全栈服务
- `dbt-auto-convert`：将 dbt 项目自动转换为 WrenAI MDL 格式

---

## 6. Text-to-SQL 完整数据流

```
1. 用户输入自然语言问题 → UI (React)
2. GraphQL Mutation       → Apollo Server (Next.js)
3. HTTP REST 调用         → Wren AI Service (/asks)
4. 意图分类               → 判断查询类型
5. Schema 检索            → 从 Qdrant 向量搜索相关 MDL 片段
6. 上下文组装             → 收集相关表、关系、指令、SQL 对
7. SQL 生成               → LLM 根据上下文生成 SQL
8. SQL 验证               → Wren Engine 验证 SQL 语法
9. SQL 修正（如需要）      → 最多重试 max_sql_correction_retries 次
10. 返回结果              → SQL + 元数据返回到 UI
11. 查询执行              → UI 通过 Wren Engine 执行 SQL
12. 结果展示              → 在 UI 中显示表格/图表
```

---

## 7. MDL（元数据定义语言）

MDL 是 WrenAI 的语义层核心，JSON Schema 定义位于 `/wren-mdl/mdl.schema.json`。

### 核心概念

| 概念 | 说明 |
|------|------|
| **Models** | 数据库表的抽象，附带业务元数据 |
| **Columns** | 带类型的字段，支持表达式 |
| **Relationships** | 表间关系（1:1, 1:N, M:1） |
| **Metrics** | 聚合计算指标（SUM, COUNT, AVG） |
| **Calculated Fields** | 派生字段（表达式计算） |
| **Properties** | 自定义元数据标签 |

### MDL 示例

```json
{
  "catalog": "my_db",
  "schema": "public",
  "dataSource": "POSTGRES",
  "models": [
    {
      "name": "customers",
      "columns": [
        { "name": "id", "type": "int", "notNull": true },
        {
          "name": "revenue",
          "type": "decimal",
          "isCalculated": true,
          "expression": "SUM(orders.amount)"
        }
      ]
    }
  ],
  "relationships": [
    {
      "name": "customers_orders",
      "sourceModel": "customers",
      "targetModel": "orders",
      "type": "ONE_TO_MANY"
    }
  ]
}
```

### MDL 工作流

1. 用户连接数据源 → 自动检测 Schema
2. MDL 自动生成（`mdlBuilder.ts`）
3. 用户自定义（添加指标、关系、描述）
4. MDL 部署到 AI Service（`deployService.ts`）
5. AI Service 将 MDL 索引到 Qdrant 向量库
6. 查询时通过 RAG 检索相关 Schema 上下文

---

## 8. 扩展点分析

### 8.1 LLM 提供商扩展（最易扩展）

**基于装饰器的插件注册系统**：

```python
# src/providers/loader.py
@provider("my_custom_llm")
class MyCustomLLMProvider(LLMProvider):
    def get_generator(self, *args, **kwargs):
        # 自定义 LLM 逻辑
        ...
```

**添加新提供商步骤**：
1. 创建 `src/providers/{type}/{name}.py`
2. 实现抽象接口（`LLMProvider` / `EmbedderProvider` / `DocumentStoreProvider` / `Engine`）
3. 用 `@provider("provider_name")` 装饰器注册
4. 在 `src/providers/__init__.py` 中导入（通过 `import_mods()` 自动发现）
5. 在 `config.yaml` 中引用

**四类可扩展的抽象接口**：

| 接口 | 职责 | 当前实现 |
|------|------|----------|
| `LLMProvider` | 文本生成 | LiteLLM（40+ 模型） |
| `EmbedderProvider` | 文本嵌入（用于 RAG） | LiteLLM |
| `DocumentStoreProvider` | 向量存储 | Qdrant |
| `Engine` | SQL 验证与执行 | Wren UI / Ibis |

### 8.2 管道扩展

**添加新管道步骤**：
1. 创建 `src/pipelines/{category}/{name}.py`
2. 继承 `BasicPipeline`
3. 实现 `run()` 方法，使用 Hamilton DAG 函数定义逻辑
4. 在 `config.yaml` 的 `pipeline.pipes` 中注册
5. 在 `globals.py` 的 `ServiceContainer` 中接线

**Hamilton 管道示例**：

```python
class MyPipeline(BasicPipeline):
    def __init__(self, llm_provider, embedder_provider, **kwargs):
        # 定义 Hamilton DAG 函数
        ...

    async def run(self, query: str) -> Dict:
        return await self._pipe.execute(...)
```

### 8.3 GraphQL Schema 扩展（UI）

1. 在 `schema.ts` 中添加新的类型定义
2. 在 `resolvers/` 中创建解析器
3. 在 `services/` 中实现业务逻辑
4. 在 `repositories/` 中实现数据访问（如需数据库操作）
5. 运行 `yarn generate-gql` 生成 TypeScript 类型

### 8.4 数据源扩展

- 通过 Wren Engine（外部项目）+ Ibis Server 接入
- UI 中的 `DataSourceSchemaDetector` 自动检测数据库 Schema
- MDL 从 Schema 自动生成

### 8.5 REST API 集成点

**Wren AI Service 对外 REST API**（供外部应用调用）：

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/asks` | 提交自然语言问题 |
| GET | `/asks/{query_id}/result` | 轮询查询结果 |
| GET | `/asks/{query_id}/streaming-result` | SSE 流式结果 |
| PATCH | `/asks/{query_id}` | 取消查询 |
| POST | `/charts` | 生成图表 |
| GET | `/charts/{query_id}/result` | 获取图表结果 |
| POST | `/sql-pairs` | 管理 SQL 问答对 |
| POST | `/sql-questions` | 从问题生成 SQL |
| POST | `/sql-answers` | 从 SQL 结果生成文本回答 |
| POST | `/instructions` | 管理自定义指令 |
| POST | `/semantics/prepare` | 索引语义层（MDL） |
| POST | `/semantics/description` | 生成语义描述 |
| POST | `/ask-feedbacks` | 收集用户反馈 |

### 8.6 可观测性扩展

- **Langfuse 集成**：LLM 可观测性（成本追踪、延迟监控、准确率评估）
- **API History**：UI 中记录所有 API 调用日志
- 配置项：`langfuse_host`, `langfuse_enable`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`

---

## 9. 配置机制

### 9.1 AI Service 配置（`config.yaml`）

多文档 YAML 格式，各段配置独立：

```yaml
---
type: llm
provider: litellm_llm
models:
  - model: gpt-4o-mini
    api_base: https://api.openai.com/v1
    alias: default
    kwargs:
      temperature: 0
---
type: embedder
provider: litellm_embedder
models:
  - model: text-embedding-3-large
---
type: engine
provider: wren_ui
endpoint: http://wren-engine:8080
---
type: document_store
provider: qdrant
location: http://qdrant:6333
embedding_model_dim: 3072
---
type: pipeline
pipes:
  - name: sql_generation
    llm: litellm_llm.default
    embedder: litellm_embedder.default
    engine: wren_ui
    document_store: qdrant
---
settings:
  engine_timeout: 30
  max_sql_correction_retries: 3
```

### 9.2 关键配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `engine_timeout` | 30s | SQL 执行超时 |
| `max_sql_correction_retries` | 3 | SQL 生成失败重试次数 |
| `column_indexing_batch_size` | 50 | MDL 索引批处理大小 |
| `table_retrieval_size` | 10 | 检索相关表数量 |
| `table_column_retrieval_size` | 100 | 每表检索列数 |
| `allow_intent_classification` | true | 启用意图检测 |
| `allow_sql_generation_reasoning` | true | SQL 生成时包含推理 |
| `allow_sql_diagnosis` | true | 启用 SQL 诊断 |
| `query_cache_ttl` | 3600s | 查询缓存 TTL |
| `historical_question_retrieval_similarity_threshold` | 0.9 | 历史问题向量搜索阈值 |
| `sql_pairs_similarity_threshold` | 0.7 | SQL 对匹配阈值 |

### 9.3 配置优先级

1. 代码中的默认值（最低）
2. 环境变量
3. `.env.dev` 文件
4. `config.yaml` 文件（最高）

### 9.4 UI 数据库配置

```bash
# SQLite（开发环境）
export DB_TYPE=sqlite
export SQLITE_FILE=./db.sqlite3

# PostgreSQL（生产环境）
export DB_TYPE=pg
export PG_URL=postgres://user:pass@localhost/wrenai
```

---

## 10. 技术栈总览

### 后端服务

| 组件 | 语言 | 框架 | 版本 |
|------|------|------|------|
| Wren UI | TypeScript | Next.js 14 | 14.2.35 |
| GraphQL Server | TypeScript | Apollo Server | 3.10.2 |
| UI 数据库 | JavaScript | Knex | 3.1.0 |
| AI Service | Python 3.12 | FastAPI | 0.121.1 |
| 管道 DAG | Python | Hamilton | 1.69.0 |
| RAG 库 | Python | Haystack | 2.7.0 |
| 向量数据库 | - | Qdrant | 1.11.0 |
| CLI 工具 | Go | Go | 1.18+ |

### 核心依赖

- **LLM 调用**：LiteLLM（统一接口）、Langfuse（可观测性）
- **向量搜索**：Haystack + Qdrant
- **SQL 解析**：SQLParse、sqlglot
- **可视化**：Vega-Lite（前端）
- **数据库**：Knex（UI 端）、SQLAlchemy/Ibis（数据源端）
- **数据验证**：Pydantic、JSON Schema

### 部署方式

| 方式 | 工具 | 适用场景 |
|------|------|----------|
| Docker Compose | docker-compose | 本地开发 / 单机部署 |
| Kubernetes | Kustomize | 生产环境 |
| CLI 启动器 | wren-launcher (Go) | 快速本地启动 |

---

## 11. 扩展性评估

### 高度可扩展（设计为插件化）

1. **LLM 提供商** — 装饰器注册 + LiteLLM 统一接口，零代码即可切换模型
2. **配置系统** — 声明式 `config.yaml`，支持多文档 YAML 分段配置
3. **AI 管道** — Hamilton DAG 框架，可自由组合索引/检索/生成管道

### 中度可扩展

4. **GraphQL Schema** — 标准 Apollo Server 模式，可添加新类型和解析器
5. **UI 组件** — React 组件库 + Ant Design，可定制前端
6. **可观测性** — Langfuse 已集成，可扩展到其他 APM 工具

### 扩展较难（依赖外部项目）

7. **数据源** — 需通过 Wren Engine（外部子模块）扩展
8. **向量存储** — 目前仅支持 Qdrant，切换需修改代码

---

## 12. 总结

WrenAI 是一个架构清晰、模块化设计的 GenBI 系统，其核心优势在于：

- **语义层驱动**：通过 MDL 为 LLM 提供业务上下文，显著提升 Text-to-SQL 准确率
- **RAG 增强**：结合向量搜索和 LLM 生成，实现上下文感知的 SQL 生成
- **插件化架构**：Provider 系统支持灵活切换 LLM、嵌入模型、向量存储
- **管道编排**：Hamilton + Haystack 提供可组合的 AI 管道框架
- **全栈覆盖**：从数据连接、语义建模到自然语言查询、可视化的完整闭环
- **多数据源**：支持 12+ 主流数据库
- **多模型**：通过 LiteLLM 接入 40+ LLM 模型

对于希望构建企业级自然语言 BI 系统的团队，WrenAI 提供了一个成熟且可扩展的起点。
