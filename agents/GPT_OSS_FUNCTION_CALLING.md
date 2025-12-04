# GPT-OSS Function Calling 提示词构建指南

本文档说明如何为 gpt-oss 模型构建支持 Function Calling 的提示词（Harmony 格式）。

## 概述

gpt-oss 使用 **Harmony 格式**，与标准 OpenAI API 的 `tools` 参数不同。需要在提示词中手动定义工具，并解析模型输出。

## System Prompt 完整模板

将所有内容放在一个 system prompt 中：

```
You are ChatGPT, a large language model trained by OpenAI.
Knowledge cutoff: 2024-06
Current date: {CURRENT_DATE}

Reasoning: {REASONING_LEVEL}

# Valid channels: analysis, commentary, final. Channel must be included for every message.
Calls to these tools must go to the commentary channel: 'functions'.

# Instructions

{YOUR_INSTRUCTIONS}

# Tools

## functions

namespace functions {

{FUNCTION_DEFINITIONS}

} // namespace functions
```

**参数说明：**

| 参数 | 说明 | 示例 |
|------|------|------|
| `{CURRENT_DATE}` | 当前日期 | `2025-06-28` |
| `{REASONING_LEVEL}` | 推理深度：`low` / `medium` / `high` | `low` |
| `{YOUR_INSTRUCTIONS}` | 你的系统指令 | `你是一个有帮助的助手` |
| `{FUNCTION_DEFINITIONS}` | 工具定义 | 见下方 |

## 工具定义语法

使用 TypeScript 风格定义：

```typescript
// 函数描述（必须）
type function_name = (_: {
// 参数描述
param_name: param_type,
// 可选参数描述
optional_param?: param_type, // default: 默认值
}) => any;

// 无参数函数
type no_args_function = () => any;
```

**类型支持：**

| 类型 | 写法 | 示例 |
|------|------|------|
| 字符串 | `string` | `city: string` |
| 数字 | `number` | `limit: number` |
| 布尔 | `boolean` | `verbose: boolean` |
| 枚举 | `"a" \| "b"` | `unit: "celsius" \| "fahrenheit"` |
| 数组 | `type[]` | `cities: string[]` |
| 可选 | `name?` | `limit?: number` |

## 完整示例

### System Prompt

```
You are ChatGPT, a large language model trained by OpenAI.
Knowledge cutoff: 2024-06
Current date: 2025-06-28

Reasoning: low

# Valid channels: analysis, commentary, final. Channel must be included for every message.
Calls to these tools must go to the commentary channel: 'functions'.

# Instructions

你是一个有帮助的AI助手。请用中文回复用户。
当需要获取实时信息时，使用提供的工具。

# Tools

## functions

namespace functions {

// 获取指定城市的天气信息
type get_weather = (_: {
// 城市名称，如：北京、上海
city: string,
// 温度单位
unit?: "celsius" | "fahrenheit", // default: celsius
}) => any;

// 搜索网页获取信息
type web_search = (_: {
// 搜索关键词
query: string,
// 返回结果数量
limit?: number, // default: 5
}) => any;

// 查询本地知识库
type local_rag = (_: {
// 查询内容
query: string,
// 返回文档数量
top_k?: number, // default: 3
}) => any;

// 获取当前时间
type get_current_time = () => any;

} // namespace functions
```

### Python 调用代码

```python
from openai import OpenAI
from datetime import date

client = OpenAI(base_url="YOUR_ENDPOINT/v1", api_key="not-needed")

SYSTEM_PROMPT = f"""You are ChatGPT, a large language model trained by OpenAI.
Knowledge cutoff: 2024-06
Current date: {date.today().isoformat()}

Reasoning: low

# Valid channels: analysis, commentary, final. Channel must be included for every message.
Calls to these tools must go to the commentary channel: 'functions'.

# Instructions

你是一个有帮助的AI助手。

# Tools

## functions

namespace functions {{

// 获取指定城市的天气信息
type get_weather = (_: {{
// 城市名称
city: string,
}}) => any;

}} // namespace functions"""

messages = [
    {"role": "system", "content": SYSTEM_PROMPT},
    {"role": "user", "content": "北京天气怎么样？"}
]

response = client.chat.completions.create(
    model="default",
    messages=messages,
    max_tokens=1000
)

print(response.choices[0].message.content)
```

## 模型输出格式

### 函数调用

```
<|channel|>analysis<|message|>用户询问北京天气，需要调用 get_weather。<|end|>
<|start|>assistant<|channel|>commentary to=functions.get_weather <|constrain|>json<|message|>{"city":"北京"}<|call|>
```

### 直接回复

```
<|channel|>analysis<|message|>简单问题，直接回答。<|end|>
<|start|>assistant<|channel|>final<|message|>你好！有什么可以帮助你的？<|return|>
```

## 解析模型输出

```python
import re
import json
from typing import Optional

def _extract_json_from_position(content: str, start: int) -> Optional[str]:
    """
    从指定位置提取完整的 JSON 对象。
    正确处理嵌套大括号和字符串内的特殊字符。
    """
    if start >= len(content) or content[start] != '{':
        return None

    depth = 0
    in_string = False
    escape_next = False

    for i in range(start, len(content)):
        char = content[i]

        if escape_next:
            escape_next = False
            continue

        if char == '\\' and in_string:
            escape_next = True
            continue

        if char == '"' and not escape_next:
            in_string = not in_string
            continue

        if in_string:
            continue

        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                return content[start:i + 1]

    return None


def parse_harmony_response(content: str) -> dict:
    """解析 harmony 格式的模型输出"""
    result = {
        "thinking": None,       # 思考过程（不展示给用户）
        "function_calls": [],   # 函数调用列表（支持多个）
        "final_answer": None,   # 最终回复
    }

    # 提取思考过程
    analysis = re.search(
        r'<\|channel\|>analysis<\|message\|>(.*?)(?:<\|end\|>|<\|call\|>|$)',
        content, re.DOTALL
    )
    if analysis:
        result["thinking"] = analysis.group(1).strip()

    # 提取函数调用（使用括号计数处理嵌套 JSON）
    func_pattern = re.compile(
        r'to=functions\.(\w+)\s*(?:<\|constrain\|>[^<]*)?<\|message\|>',
        re.DOTALL
    )
    for match in func_pattern.finditer(content):
        func_name = match.group(1)
        json_start = match.end()
        args_json = _extract_json_from_position(content, json_start)

        if args_json:
            try:
                result["function_calls"].append({
                    "name": func_name,
                    "arguments": json.loads(args_json)
                })
            except json.JSONDecodeError:
                result["function_calls"].append({
                    "name": func_name,
                    "arguments": {"raw": args_json}
                })

    # 提取最终回复
    final = re.search(
        r'<\|channel\|>final<\|message\|>(.*?)(?:<\|return\|>|<\|end\|>|$)',
        content, re.DOTALL
    )
    if final:
        result["final_answer"] = final.group(1).strip()

    return result
```

**注意：** 使用 `_extract_json_from_position` 函数可正确处理嵌套 JSON，如 `{"a": {"b": 1}}`。简单的正则 `\{[^}]*\}` 会在第一个 `}` 处截断。

## 处理函数调用结果

执行函数后，有两种方式将结果传回模型：

### 方式一：OpenAI 风格（推荐）

将工具结果作为独立的 `[Tool Results]` 块，保持原始对话历史干净：

```python
# 执行工具
weather_result = get_weather("北京")

# 构建工具结果消息（与聊天历史分离）
tool_results_message = f"""[Tool Results]
**get_weather**:
{json.dumps(weather_result, ensure_ascii=False, indent=2)}

Now provide your response based on the tool results above."""

# 只追加工具结果（不追加 assistant 的函数调用）
messages.append({"role": "user", "content": tool_results_message})

# 继续请求
response = client.chat.completions.create(model="default", messages=messages)
```

**优点：**
- 聊天历史保持干净
- 工具结果与对话明确分离
- 符合 OpenAI 的 `role: "tool"` 设计理念

### 方式二：Harmony 格式

将工具结果以 Harmony 格式追加：

```python
def build_tool_result(func_name: str, result: dict) -> str:
    """构建工具结果消息（Harmony 格式）"""
    result_json = json.dumps(result, ensure_ascii=False)
    return f"<|start|>functions.{func_name} to=assistant<|channel|>commentary<|message|>{result_json}<|end|>"

# 使用示例
tool_result = build_tool_result("get_weather", {"temperature": 25, "condition": "晴"})

# 追加到对话（需同时追加 assistant 消息）
messages.append({"role": "assistant", "content": "<|channel|>commentary to=functions.get_weather<|message|>{\"city\":\"北京\"}<|call|>"})
messages.append({"role": "user", "content": tool_result})

# 继续请求
response = client.chat.completions.create(model="default", messages=messages)
```

**注意：** 使用方式二时，assistant 消息不应包含 `analysis` 块，只保留函数调用部分。

## 通道说明

| 通道 | 用途 | 展示给用户 |
|------|------|------------|
| `analysis` | 模型思考过程 | ❌ 不要 |
| `commentary` | 函数调用 | ❌ 不要 |
| `final` | 最终回复 | ✅ 展示 |

## 多工具定义示例

```
# Tools

## functions

namespace functions {

// 获取天气信息
type get_weather = (_: {
// 城市名称
city: string,
}) => any;

// 网络搜索
type web_search = (_: {
// 搜索查询
query: string,
}) => any;

// 知识库检索
type local_rag = (_: {
// 检索问题
query: string,
// 返回数量
top_k?: number, // default: 3
}) => any;

// 执行代码
type run_code = (_: {
// 代码语言
language: "python" | "javascript",
// 代码内容
code: string,
}) => any;

// 发送消息（无参数示例）
type send_notification = () => any;

} // namespace functions
```

## 注意事项

1. **推理级别选择**
   - `low`: 简单任务，节省 token
   - `medium`: 一般任务
   - `high`: 复杂推理任务

2. **安全性**
   - `analysis` 通道内容未经安全过滤，不要展示给用户

3. **多轮对话**
   - 后续轮次去掉之前的 `analysis` 内容
   - 只保留 `final` 回复作为历史

4. **日期更新**
   - `Current date` 应使用实际当前日期