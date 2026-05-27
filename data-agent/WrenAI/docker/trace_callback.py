"""
LLM 调用追踪回调 — 挂载到 ai-service 容器，自动记录所有 LLM 调用。

通过 docker-compose volume 挂载为 sitecustomize.py，Python 启动时自动执行。
所有 LLM 调用（prompt/response/token/耗时）写入 /app/data/llm_traces.jsonl。
wren-ui 的 /api/traces 接口读取该文件展示在 Logs 页面。

文件位置（容器内）:
  - 本文件: /app/.venv/lib/python3.12/site-packages/sitecustomize.py
  - 输出:   /app/data/llm_traces.jsonl
"""

import json
import os
import threading
from contextvars import ContextVar
from datetime import datetime, timezone

# 输出路径 — docker-compose 中 data volume 挂载到 /app/data/
TRACE_FILE = os.environ.get("LLM_TRACE_FILE", "/app/data/llm_traces.jsonl")
_lock = threading.Lock()

# 使用 contextvars 替代 threading.local()，支持 asyncio 上下文传播
_ctx_query_id: ContextVar[str | None] = ContextVar("trace_query_id", default=None)
_ctx_pipeline_name: ContextVar[str | None] = ContextVar("trace_pipeline_name", default=None)
_ctx_question: ContextVar[str | None] = ContextVar("trace_question", default=None)


def set_trace_context(query_id=None, pipeline_name=None, question=None):
    if query_id is not None:
        _ctx_query_id.set(query_id)
    if pipeline_name is not None:
        _ctx_pipeline_name.set(pipeline_name)
    if question is not None:
        _ctx_question.set(question)


def get_trace_context():
    return {
        "query_id": _ctx_query_id.get(),
        "pipeline_name": _ctx_pipeline_name.get(),
        "question": _ctx_question.get(),
    }


def _truncate(text, max_len=2000):
    if not text or len(text) <= max_len:
        return text
    half = max_len // 2
    return text[:half] + "\n... (" + str(len(text) - max_len) + " chars truncated) ...\n" + text[-half:]


MAX_TRACE_SIZE = int(os.environ.get("MAX_TRACE_SIZE_MB", "50")) * 1024 * 1024  # 默认 50MB


def _write_event(event):
    with _lock:
        try:
            # 文件超过限制时自动 rotation：保留后半部分
            if os.path.exists(TRACE_FILE) and os.path.getsize(TRACE_FILE) > MAX_TRACE_SIZE:
                try:
                    with open(TRACE_FILE, "r") as f:
                        lines = f.readlines()
                    # 保留后 60% 的行
                    keep = lines[len(lines) * 2 // 5:]
                    with open(TRACE_FILE, "w") as f:
                        f.writelines(keep)
                    print(f"[trace_callback] rotated: {len(lines)} → {len(keep)} lines")
                except Exception:
                    pass
            with open(TRACE_FILE, "a") as f:
                f.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
        except Exception as e:
            print("[trace_callback] write error: " + str(e))


try:
    import litellm
    from litellm.integrations.custom_logger import CustomLogger

    class WrenTraceLogger(CustomLogger):
        async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
            try:
                model = kwargs.get("model", "unknown")
                call_type = kwargs.get("call_type", "completion")

                usage = {}
                if hasattr(response_obj, "usage") and response_obj.usage:
                    usage = {
                        "prompt_tokens": getattr(response_obj.usage, "prompt_tokens", 0),
                        "completion_tokens": getattr(response_obj.usage, "completion_tokens", 0),
                        "total_tokens": getattr(response_obj.usage, "total_tokens", 0),
                    }

                response_text = ""
                system_prompt = ""
                user_prompt = ""

                if call_type == "aembedding" or call_type == "embedding":
                    # Embedding 调用：input 是文本列表，响应是向量
                    embed_input = kwargs.get("input", [])
                    if isinstance(embed_input, list):
                        user_prompt = f"[Embedding] {len(embed_input)} texts, first: {str(embed_input[0])[:200]}..." if embed_input else "[Embedding] empty"
                    else:
                        user_prompt = f"[Embedding] {str(embed_input)[:200]}"
                    if hasattr(response_obj, "data"):
                        response_text = f"Returned {len(response_obj.data)} embeddings"
                    # Embedding 的 token 统计：prompt_tokens = 输入 token 数
                    if not usage and hasattr(response_obj, "usage") and response_obj.usage:
                        usage = {"prompt_tokens": getattr(response_obj.usage, "prompt_tokens", 0), "completion_tokens": 0, "total_tokens": getattr(response_obj.usage, "total_tokens", 0)}
                else:
                    # Completion 调用：messages 格式
                    if hasattr(response_obj, "choices") and response_obj.choices:
                        choice = response_obj.choices[0]
                        if hasattr(choice, "message") and hasattr(choice.message, "content"):
                            response_text = choice.message.content or ""

                    messages = kwargs.get("messages", [])
                    for msg in messages:
                        role = msg.get("role", "")
                        content = msg.get("content", "")
                        if isinstance(content, list):
                            content = " ".join(
                                p.get("text", "") for p in content if isinstance(p, dict)
                            )
                        if role == "system":
                            system_prompt = content
                        elif role == "user":
                            user_prompt = content

                ctx = get_trace_context()
                # 优先从 litellm metadata 读取（跨 asyncio context 不丢失）
                meta = kwargs.get("litellm_params", {}).get("metadata", {}) or {}
                qid = meta.get("trace_query_id") or ctx.get("query_id")
                pipe = meta.get("trace_pipeline") or ctx.get("pipeline_name")
                q = meta.get("trace_question") or ctx.get("question")

                duration_ms = 0
                if start_time and end_time:
                    duration_ms = int((end_time - start_time).total_seconds() * 1000)

                event = {
                    "type": "llm_call",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "query_id": qid,
                    "pipeline": pipe,
                    "question": q,
                    "source": "user" if qid else "system",
                    "model": model,
                    "duration_ms": duration_ms,
                    "tokens": usage,
                    "system_prompt": system_prompt,
                    "user_prompt": user_prompt,
                    "response": response_text,
                }
                _write_event(event)
            except Exception as e:
                print("[trace_callback] success error: " + str(e))

        async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
            try:
                ctx = get_trace_context()
                # 优先从 litellm metadata 读取
                meta = kwargs.get("litellm_params", {}).get("metadata", {}) or {}
                qid = meta.get("trace_query_id") or ctx.get("query_id")
                pipe = meta.get("trace_pipeline") or ctx.get("pipeline_name")
                q = meta.get("trace_question") or ctx.get("question")

                messages = kwargs.get("messages", [])
                user_prompt = ""
                for msg in messages:
                    if msg.get("role") == "user":
                        content = msg.get("content", "")
                        if isinstance(content, list):
                            content = " ".join(
                                p.get("text", "") for p in content if isinstance(p, dict)
                            )
                        user_prompt = content

                duration_ms = 0
                if start_time and end_time:
                    duration_ms = int((end_time - start_time).total_seconds() * 1000)

                # Try multiple sources for error info
                error_msg = ""
                if response_obj is not None:
                    error_msg = str(response_obj)
                if not error_msg or error_msg == "None":
                    # Try to get from kwargs
                    error_msg = str(kwargs.get("exception", ""))
                if not error_msg or error_msg == "None":
                    # Try litellm_params
                    error_msg = str(kwargs.get("litellm_params", {}).get("exception", ""))
                if not error_msg or error_msg == "None":
                    error_msg = "Unknown error"

                if not user_prompt and error_msg:
                    user_prompt = f"[Error occurred during LLM call]\n{error_msg[:500]}"

                event = {
                    "type": "llm_error",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "query_id": qid,
                    "pipeline": pipe,
                    "question": q,
                    "source": "user" if qid else "system",
                    "model": kwargs.get("model", "unknown"),
                    "duration_ms": duration_ms,
                    "error": error_msg,
                    "user_prompt": user_prompt,
                }
                _write_event(event)
            except Exception as e:
                print("[trace_callback] failure error: " + str(e))

    wren_trace_logger = WrenTraceLogger()
    litellm.callbacks = [wren_trace_logger]
    print("[trace_callback] LLM trace logger registered, writing to " + TRACE_FILE)

except ImportError:
    # 不在 ai-service 容器里（比如被其他服务意外加载），静默跳过
    pass
