# -*- coding: utf-8 -*-
"""
Agent Service - 轮询消息并响应 @ 提及
"""
import re
import time
import threading
import requests
from typing import Optional
from query import chat_with_history, configure as configure_llm


def strip_special_tags(text: str) -> str:
    """清理模型输出的特殊标签，只保留最终回答"""
    if not text:
        return ""

    # 1. 尝试提取 final channel 的内容
    final_match = re.search(
        r"<\|channel\|>final<\|message\|>(.*?)(?:<\|end\|>|$)", text, flags=re.DOTALL
    )
    if final_match:
        text = final_match.group(1)

    # 2. 移除 <think>...</think>
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)

    # 3. 移除所有 <|xxx|> 标签及其后面到下一个标签或换行的内容
    # 先移除完整的 channel 块
    text = re.sub(
        r"<\|start\|>.*?(?=<\|start\|>|$)", "", text, flags=re.DOTALL
    )
    text = re.sub(
        r"<\|channel\|>[^<]*<\|message\|>.*?(?:<\|end\|>|<\|start\|>|$)",
        "", text, flags=re.DOTALL
    )

    # 4. 移除剩余的特殊标签
    text = re.sub(r"<\|[^>]+\|>", "", text)

    # 5. 清理残留关键词（行首）
    text = re.sub(r"^(analysis|commentary|thinking|final)\s*", "", text, flags=re.IGNORECASE | re.MULTILINE)

    # 6. 移除 JSON 格式的工具调用残留
    text = re.sub(r'\{[^}]*"reaction"[^}]*\}', "", text)
    text = re.sub(r'\{[^}]*"emoji"[^}]*\}', "", text)

    # 7. 清理多余空行和空白
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()

# 配置
API_BASE = "http://localhost:4000"
AGENT_TOKEN = "dev-agent-token"  # 与 server 的 AGENT_API_TOKEN 保持一致
AGENT_ID = "helper-agent-1"  # 默认 Agent ID
POLL_INTERVAL = 1  # 轮询间隔（秒）
HEARTBEAT_INTERVAL = 5  # 心跳间隔（秒）
PROACTIVE_COOLDOWN = 60  # 主动回复冷却时间（秒）
CONVERSATION_ID = "global"

# Agent 的 User ID（从 data.json 获取）
AGENT_USER_ID = "llm1"


class AgentService:
    def __init__(
        self,
        api_base: str = API_BASE,
        agent_token: str = AGENT_TOKEN,
        agent_id: str = AGENT_ID,
        agent_user_id: str = AGENT_USER_ID,
    ):
        self.api_base = api_base
        self.agent_token = agent_token
        self.agent_id = agent_id
        self.agent_user_id = agent_user_id
        self.last_seen_timestamp = int(time.time() * 1000)
        self.processed_message_ids = set()
        self.reacted_message_ids = set()  # 已反应过的消息（主动模式）
        self.last_proactive_time = 0  # 上次主动反应的时间
        # Agent 配置（从后端获取）
        self.agent_config = None

    def get_headers(self) -> dict:
        """获取 API 请求头"""
        return {
            "Content-Type": "application/json",
            "X-Agent-Token": self.agent_token,
        }

    def login(self, email: str, password: str) -> Optional[str]:
        """登录获取 JWT token"""
        try:
            resp = requests.post(
                f"{self.api_base}/auth/login",
                json={"email": email, "password": password},
                timeout=10,
            )
            if resp.status_code == 200:
                # 从 cookie 获取 token
                token = resp.cookies.get("token")
                if token:
                    self.jwt_token = token
                    print(f"[Agent] 登录成功")
                    return token
            print(f"[Agent] 登录失败: {resp.status_code}")
            return None
        except Exception as e:
            print(f"[Agent] 登录异常: {e}")
            return None

    def fetch_agent_config(self) -> Optional[dict]:
        """从后端获取 Agent 配置"""
        headers = {}
        if hasattr(self, "jwt_token") and self.jwt_token:
            headers["Authorization"] = f"Bearer {self.jwt_token}"

        try:
            resp = requests.get(
                f"{self.api_base}/agents",
                headers=headers,
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                agents = data.get("agents", [])
                # 找到当前 agent
                for agent in agents:
                    if agent.get("id") == self.agent_id:
                        self.agent_config = agent
                        # 如果是 parallax provider，配置 LLM client
                        model = agent.get("model", {})
                        runtime = agent.get("runtime", {})
                        if model.get("provider") == "parallax":
                            base_url = runtime.get("endpoint")
                            api_key = runtime.get("apiKeyAlias") or "not-needed"
                            if base_url:
                                configure_llm(base_url=base_url, api_key=api_key)
                                print(f"[Agent] 已配置 parallax provider: {base_url}")
                        return agent
                print(f"[Agent] 未找到 Agent 配置: {self.agent_id}")
                return None
            else:
                print(f"[Agent] 获取 Agent 配置失败: {resp.status_code}")
                return None
        except Exception as e:
            print(f"[Agent] 获取 Agent 配置异常: {e}")
            return None

    def fetch_messages(self, since: Optional[int] = None) -> list:
        """获取消息列表"""
        params = {"conversationId": CONVERSATION_ID}
        if since:
            params["since"] = since

        # 使用 JWT token 认证
        headers = {}
        if hasattr(self, "jwt_token") and self.jwt_token:
            headers["Authorization"] = f"Bearer {self.jwt_token}"

        try:
            resp = requests.get(
                f"{self.api_base}/messages",
                params=params,
                headers=headers,
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("messages", []), data.get("users", [])
            elif resp.status_code == 401:
                print(f"[Agent] 未授权，请先登录")
                return [], []
            else:
                print(f"[Agent] 获取消息失败: {resp.status_code} - {resp.text}")
                return [], []
        except Exception as e:
            print(f"[Agent] 请求异常: {e}")
            return [], []

    def send_heartbeat(self) -> bool:
        """发送心跳信号"""
        try:
            resp = requests.post(
                f"{self.api_base}/agents/{self.agent_id}/heartbeat",
                headers=self.get_headers(),
                timeout=5,
            )
            return resp.status_code == 200
        except Exception:
            return False

    def _heartbeat_loop(self):
        """心跳线程"""
        while self._running:
            self.send_heartbeat()
            time.sleep(HEARTBEAT_INTERVAL)

    def send_message(self, content: str, reply_to_id: Optional[str] = None) -> bool:
        """通过 Agent API 发送消息"""
        payload = {
            "content": content,
            "conversationId": CONVERSATION_ID,
        }
        if reply_to_id:
            payload["replyToId"] = reply_to_id

        try:
            resp = requests.post(
                f"{self.api_base}/agents/{self.agent_id}/messages",
                json=payload,
                headers=self.get_headers(),
                timeout=30,
            )
            if resp.status_code == 200:
                print(f"[Agent] 消息已发送: {content[:50]}...")
                return True
            else:
                print(f"[Agent] 发送失败: {resp.status_code} - {resp.text}")
                return False
        except Exception as e:
            print(f"[Agent] 发送异常: {e}")
            return False

    def add_reaction(self, message_id: str, emoji: str) -> bool:
        """给消息添加表情反应"""
        payload = {
            "messageId": message_id,
            "emoji": emoji,
        }

        try:
            resp = requests.post(
                f"{self.api_base}/agents/{self.agent_id}/reactions",
                json=payload,
                headers=self.get_headers(),
                timeout=10,
            )
            if resp.status_code == 200:
                print(f"[Agent] 已添加反应: {emoji} -> {message_id[:8]}...")
                return True
            else:
                print(f"[Agent] 添加反应失败: {resp.status_code} - {resp.text}")
                return False
        except Exception as e:
            print(f"[Agent] 添加反应异常: {e}")
            return False

    def is_mentioned(self, message: dict, users: list) -> bool:
        """检查消息是否 @ 了本 Agent"""
        mentions = message.get("mentions", [])
        if self.agent_user_id in mentions:
            return True

        # 也检查消息内容中是否包含 @AgentName
        content = message.get("content", "")
        # 查找 agent 对应的用户名
        for user in users:
            if user.get("id") == self.agent_user_id:
                agent_name = user.get("name", "")
                if agent_name and f"@{agent_name}" in content:
                    return True
        return False

    def build_context(self, messages: list, users: list, current_msg: dict) -> list:
        """构建对话上下文"""
        # 获取最近的消息作为上下文
        context_messages = []

        # 用户 ID -> 名称映射
        user_map = {u["id"]: u.get("name", "User") for u in users}

        # 取最近 10 条消息作为上下文
        recent = messages[-10:] if len(messages) > 10 else messages

        # 找出当前触发消息的发送者
        trigger_sender_id = current_msg.get("senderId", "")
        trigger_sender_name = user_map.get(trigger_sender_id, "User")

        for msg in recent:
            sender_id = msg.get("senderId", "")
            sender_name = user_map.get(sender_id, "User")
            msg_id = msg.get("id", "")
            # 过滤历史消息中的特殊标签
            content = strip_special_tags(msg.get("content", ""))
            # 移除 @ 标签（已完成触发作用）
            content = re.sub(r"@[\w\-\.]+\s*", "", content).strip()

            if sender_id == self.agent_user_id:
                context_messages.append({"role": "assistant", "content": content})
            else:
                # 强调发送者身份，标记是否是当前提问者
                is_trigger = msg.get("id") == current_msg.get("id")
                if is_trigger:
                    # 当前提问的消息，强调这是需要回复的，包含 message_id
                    formatted = f"[msg:{msg_id}] <Name: {sender_name}> [asking you]: {content}"
                else:
                    formatted = f"[msg:{msg_id}] <Name: {sender_name}>: {content}"
                context_messages.append({"role": "user", "content": formatted})

        return context_messages

    def build_system_prompt(self, proactive_mode: bool = False) -> str:
        """构建系统提示词，根据能力配置添加工具说明"""
        default_system_prompt = (
            "You are a helpful AI assistant in a group chat. "
            "Respond directly and concisely to the user's message. "
            "Do NOT include any prefix like '[GPT-4]:' or your name in responses. "
            "Be friendly and helpful. You may respond in the user's language."
        )
        config_system_prompt = (
            self.agent_config.get("systemPrompt") if self.agent_config else None
        )
        base_prompt = config_system_prompt or default_system_prompt

        # 检查是否启用了 like 能力
        capabilities = self.agent_config.get("capabilities", {}) if self.agent_config else {}
        if capabilities.get("like"):
            if proactive_mode:
                # 主动模式：只能点赞，不能发文字
                tool_prompt = (
                    "\n\n## Proactive Reaction Mode\n"
                    "You are observing the chat. You can ONLY react with emojis to interesting messages.\n"
                    "To react, output: [REACT:emoji:current]\n"
                    "Examples: [REACT:👍:current] [REACT:😂:current] [REACT:❤️:current] [REACT:🎉:current]\n"
                    "If the message is not interesting or worth reacting to, output: [SKIP]\n"
                    "DO NOT output any text - only [REACT:...] or [SKIP].\n"
                    "React to messages that are funny, insightful, kind, or celebratory."
                )
            else:
                # 被动模式（被 @ 时）：可以点赞也可以回复
                tool_prompt = (
                    "\n\n## Tools Available\n"
                    "You have access to a reaction tool. Format: [REACT:emoji:message_id]\n"
                    "- emoji: Any emoji like 👍 ❤️ 😂 🎉 etc.\n"
                    "- message_id: Use 'current' for the asking message, or copy the exact [msg:xxx] id\n\n"
                    "Examples:\n"
                    "- [REACT:👍:current] - react to the current message\n"
                    "- [REACT:❤️:abc-123-def] - react to a specific message\n\n"
                    "Rules:\n"
                    "- For simple acknowledgments (谢谢, ok, 好的, etc.), use [REACT:...] ONLY, no text\n"
                    "- You can combine reaction with text reply if needed\n"
                    "- IMPORTANT: Output the [REACT:...] on its own line, with square brackets"
                )
            base_prompt += tool_prompt

        return base_prompt

    def parse_and_execute_tools(self, response: str, current_msg: dict) -> tuple[bool, str]:
        """解析响应中的工具调用并执行，返回 (是否只有工具调用, 清理后的文本)"""
        # 检测 [REACT:emoji:message_id] 模式
        react_pattern = r"\[REACT:([^:]+):([^\]]+)\]"
        matches = re.findall(react_pattern, response)

        for emoji, msg_id in matches:
            # 如果 message_id 是 "current" 或匹配当前消息，使用当前消息 ID
            target_id = current_msg.get("id") if msg_id in ("current", "this") else msg_id
            print(f"[Agent] 执行工具: add_reaction({emoji}, {target_id})")
            self.add_reaction(target_id, emoji.strip())

        # 移除所有工具调用标记
        cleaned = re.sub(react_pattern, "", response).strip()

        # 如果清理后为空或只有空白，说明只有工具调用
        only_tools = len(cleaned) == 0

        return only_tools, cleaned

    def generate_reply(self, context: list, current_msg: dict, proactive_mode: bool = False) -> tuple:
        """调用 LLM 生成回复，返回 (是否只有工具调用, 回复内容)"""
        system_prompt = {
            "role": "system",
            "content": self.build_system_prompt(proactive_mode=proactive_mode),
        }
        messages = [system_prompt] + context

        # 从配置获取模型参数
        model_config = self.agent_config.get("model", {}) if self.agent_config else {}
        model_name = model_config.get("name", "default")
        temperature = model_config.get("temperature", 0.6)
        max_tokens = model_config.get("maxTokens", 1024)

        # 打印完整提示词
        print(f"\n[Agent] ===== 发送给模型的提示词 =====")
        print(f"[Agent] Model: {model_name}, Temp: {temperature}, MaxTokens: {max_tokens}")
        for i, msg in enumerate(messages):
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            print(f"[{i}] {role}:")
            print(f"    {content}")
        print(f"[Agent] ===== 提示词结束 =====\n")

        try:
            response = chat_with_history(
                messages,
                model=model_name,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            # 打印原始响应
            print(f"\n[Agent] ===== 原始响应 =====")
            print(response)
            print(f"[Agent] ===== 原始响应结束 =====\n")
            # 移除特殊标签
            cleaned = strip_special_tags(response)
            print(f"[Agent] 过滤后: {cleaned[:100]}...")

            # 解析并执行工具调用
            only_tools, final_text = self.parse_and_execute_tools(cleaned, current_msg)
            return only_tools, final_text
        except Exception as e:
            print(f"[Agent] LLM 调用失败: {e}")
            return False, f"抱歉，我遇到了一些问题：{str(e)}"

    def process_message(self, message: dict, messages: list, users: list):
        """处理单条消息"""
        msg_id = message.get("id")
        sender_id = message.get("senderId")

        # 跳过自己发的消息
        if sender_id == self.agent_user_id:
            return

        # 跳过已处理的消息
        if msg_id in self.processed_message_ids:
            return

        # 检查是否被 @
        if not self.is_mentioned(message, users):
            return

        print(f"[Agent] 收到 @ 消息: {message.get('content', '')[:50]}...")

        # 刷新配置（确保使用最新的系统提示词和模型参数）
        self.fetch_agent_config()

        # 构建上下文
        context = self.build_context(messages, users, message)

        # 生成回复（可能包含工具调用）
        only_tools, reply = self.generate_reply(context, message)

        # 如果只有工具调用（如表情反应），不发送文本消息
        if only_tools:
            print(f"[Agent] 仅执行工具调用，不发送文本消息")
        elif reply:
            # 发送文本回复
            self.send_message(reply, reply_to_id=msg_id)

        # 标记为已处理
        self.processed_message_ids.add(msg_id)

    def try_proactive_reaction(self, message: dict, messages: list, users: list) -> bool:
        """尝试主动给消息添加表情反应（不发文字）"""
        msg_id = message.get("id")
        sender_id = message.get("senderId")

        # 跳过自己的消息
        if sender_id == self.agent_user_id:
            return False

        # 跳过已反应过的消息
        if msg_id in self.reacted_message_ids:
            return False

        # 检查冷却时间
        now = time.time()
        if now - self.last_proactive_time < PROACTIVE_COOLDOWN:
            return False

        # 检查是否启用了 like 能力
        capabilities = self.agent_config.get("capabilities", {}) if self.agent_config else {}
        if not capabilities.get("like"):
            return False

        print(f"[Agent] 主动模式检查消息: {message.get('content', '')[:30]}...")

        # 构建简单上下文（只包含当前消息）
        user_map = {u["id"]: u.get("name", "User") for u in users}
        sender_name = user_map.get(sender_id, "User")
        content = strip_special_tags(message.get("content", ""))
        context = [{"role": "user", "content": f"<Name: {sender_name}>: {content}"}]

        # 生成反应（主动模式）
        only_tools, response = self.generate_reply(context, message, proactive_mode=True)

        # 检查是否跳过
        if "[SKIP]" in response or not only_tools:
            print(f"[Agent] 主动模式: 跳过此消息")
            self.reacted_message_ids.add(msg_id)
            return False

        # 如果执行了工具调用，更新冷却时间
        self.last_proactive_time = now
        self.reacted_message_ids.add(msg_id)
        return True

    def run(self):
        """主循环"""
        print(f"[Agent] 启动服务...")
        print(f"[Agent] API: {self.api_base}")
        print(f"[Agent] Agent ID: {self.agent_id}")
        print(f"[Agent] 轮询间隔: {POLL_INTERVAL}s")
        print(f"[Agent] 心跳间隔: {HEARTBEAT_INTERVAL}s")
        print("-" * 40)

        # 启动心跳线程
        self._running = True
        self.send_heartbeat()  # 立即发送一次心跳
        heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        heartbeat_thread.start()
        print("[Agent] 心跳线程已启动")

        while True:
            try:
                messages, users = self.fetch_messages()

                if messages:
                    # 只处理新消息（时间戳大于上次检查的）
                    new_messages = [
                        m
                        for m in messages
                        if m.get("timestamp", 0) > self.last_seen_timestamp
                        and m.get("id") not in self.processed_message_ids
                    ]

                    for msg in new_messages:
                        # 先检查是否是 @ 消息
                        if self.is_mentioned(msg, users):
                            self.process_message(msg, messages, users)
                        else:
                            # 非 @ 消息尝试主动反应
                            self.try_proactive_reaction(msg, messages, users)

                    # 更新最后检查时间
                    if messages:
                        latest_ts = max(m.get("timestamp", 0) for m in messages)
                        self.last_seen_timestamp = max(
                            self.last_seen_timestamp, latest_ts
                        )

            except Exception as e:
                print(f"[Agent] 循环异常: {e}")

            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Agent Service")
    parser.add_argument("--email", default="root@example.com", help="登录邮箱")
    parser.add_argument("--password", default="1234567890", help="登录密码")
    parser.add_argument("--agent-id", default=AGENT_ID, help="Agent ID")
    args = parser.parse_args()

    service = AgentService(agent_id=args.agent_id)

    # 先登录获取 token
    if service.login(args.email, args.password):
        # 获取 Agent 配置
        config = service.fetch_agent_config()
        if config:
            print(f"[Agent] 已加载配置:")
            print(f"  - 名称: {config.get('name')}")
            print(f"  - Provider: {config.get('model', {}).get('provider')}")
            print(f"  - Model: {config.get('model', {}).get('name')}")
            print(f"  - System Prompt: {config.get('systemPrompt', '')[:50]}...")
        else:
            print("[Agent] 警告: 未能加载 Agent 配置，将使用默认设置")
        service.run()
    else:
        print("[Agent] 无法启动：登录失败")