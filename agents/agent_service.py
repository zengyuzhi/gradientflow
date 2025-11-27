# -*- coding: utf-8 -*-
"""
Agent Service - 轮询消息并响应 @ 提及
"""
import re
import time
import threading
import requests
from typing import Optional, Tuple, List, Dict, Set
from query import chat_with_history, configure as configure_llm

# 预编译正则表达式提升性能
_RE_FINAL_CHANNEL = re.compile(r"<\|channel\|>final<\|message\|>(.*?)(?:<\|end\|>|$)", re.DOTALL)
_RE_THINK_TAG = re.compile(r"<think>.*?</think>", re.DOTALL)
_RE_START_BLOCK = re.compile(r"<\|start\|>.*?(?=<\|start\|>|$)", re.DOTALL)
_RE_CHANNEL_BLOCK = re.compile(r"<\|channel\|>[^<]*<\|message\|>.*?(?:<\|end\|>|<\|start\|>|$)", re.DOTALL)
_RE_SPECIAL_TAG = re.compile(r"<\|[^>]+\|>")
_RE_KEYWORDS = re.compile(r"^(analysis|commentary|thinking|final)\s*", re.IGNORECASE | re.MULTILINE)
_RE_JSON_REACTION = re.compile(r'\{[^}]*"(?:reaction|emoji)"[^}]*\}')
_RE_MULTI_NEWLINES = re.compile(r"\n{3,}")
_RE_MENTION = re.compile(r"@[\w\-\.]+\s*")
_RE_REACT_TOOL = re.compile(r"\[REACT:([^:]+):([^\]]+)\]")


def strip_special_tags(text: str) -> str:
    """清理模型输出的特殊标签，只保留最终回答"""
    if not text:
        return ""

    # 1. 尝试提取 final channel 的内容
    final_match = _RE_FINAL_CHANNEL.search(text)
    if final_match:
        text = final_match.group(1)

    # 2. 移除 <think>...</think>
    text = _RE_THINK_TAG.sub("", text)

    # 3. 移除完整的 channel 块
    text = _RE_START_BLOCK.sub("", text)
    text = _RE_CHANNEL_BLOCK.sub("", text)

    # 4. 移除剩余的特殊标签
    text = _RE_SPECIAL_TAG.sub("", text)

    # 5. 清理残留关键词（行首）
    text = _RE_KEYWORDS.sub("", text)

    # 6. 移除 JSON 格式的工具调用残留
    text = _RE_JSON_REACTION.sub("", text)

    # 7. 清理多余空行和空白
    text = _RE_MULTI_NEWLINES.sub("\n\n", text)

    return text.strip()


# 配置常量
API_BASE = "http://localhost:4000"
AGENT_TOKEN = "dev-agent-token"
AGENT_ID = "helper-agent-1"
POLL_INTERVAL = 1
HEARTBEAT_INTERVAL = 5
DEFAULT_PROACTIVE_COOLDOWN = 30  # 可通过 Agent 配置覆盖
CONVERSATION_ID = "global"
AGENT_USER_ID = "llm1"
CONTEXT_LIMIT = 10  # 上下文消息数量限制
REQUEST_TIMEOUT = 10
LLM_TIMEOUT = 30


class AgentService:
    """Agent 服务 - 处理消息轮询和 LLM 交互"""

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
        self.processed_message_ids: Set[str] = set()
        self.reacted_message_ids: Set[str] = set()
        self.last_proactive_time: float = 0
        self.agent_config: Optional[Dict] = None
        self.jwt_token: Optional[str] = None
        self._running = False

        # 复用 HTTP session 提升性能
        self._session = requests.Session()
        self._agent_headers = {
            "Content-Type": "application/json",
            "X-Agent-Token": self.agent_token,
        }

        # 缓存用户名映射
        self._user_map_cache: Dict[str, str] = {}
        self._agent_name_cache: Optional[str] = None

    def get_headers(self) -> Dict[str, str]:
        """获取 Agent API 请求头"""
        return self._agent_headers

    def _get_auth_headers(self) -> Dict[str, str]:
        """获取带 JWT 认证的请求头"""
        if self.jwt_token:
            return {"Authorization": f"Bearer {self.jwt_token}"}
        return {}

    def login(self, email: str, password: str) -> Optional[str]:
        """登录获取 JWT token"""
        try:
            resp = self._session.post(
                f"{self.api_base}/auth/login",
                json={"email": email, "password": password},
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 200:
                token = resp.cookies.get("token")
                if token:
                    self.jwt_token = token
                    print("[Agent] 登录成功")
                    return token
            print(f"[Agent] 登录失败: {resp.status_code}")
            return None
        except requests.RequestException as e:
            print(f"[Agent] 登录异常: {e}")
            return None

    def fetch_agent_config(self) -> Optional[Dict]:
        """从后端获取 Agent 配置"""
        try:
            resp = self._session.get(
                f"{self.api_base}/agents",
                headers=self._get_auth_headers(),
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code != 200:
                print(f"[Agent] 获取 Agent 配置失败: {resp.status_code}")
                return None

            agents = resp.json().get("agents", [])
            # 使用生成器找到目标 agent
            agent = next((a for a in agents if a.get("id") == self.agent_id), None)
            if not agent:
                print(f"[Agent] 未找到 Agent 配置: {self.agent_id}")
                return None

            self.agent_config = agent

            # 更新 agent_user_id（从配置中获取）
            if agent.get("userId"):
                self.agent_user_id = agent["userId"]
                print(f"[Agent] 已更新 agent_user_id: {self.agent_user_id}")

            # 配置 LLM provider
            model = agent.get("model", {})
            runtime = agent.get("runtime", {})
            if model.get("provider") == "parallax":
                base_url = runtime.get("endpoint")
                if base_url:
                    api_key = runtime.get("apiKeyAlias") or "not-needed"
                    configure_llm(base_url=base_url, api_key=api_key)
                    print(f"[Agent] 已配置 parallax provider: {base_url}")

            return agent
        except requests.RequestException as e:
            print(f"[Agent] 获取 Agent 配置异常: {e}")
            return None

    def fetch_messages(self, since: Optional[int] = None) -> Tuple[List[Dict], List[Dict]]:
        """获取消息列表"""
        params = {"conversationId": CONVERSATION_ID}
        if since:
            params["since"] = since

        try:
            resp = self._session.get(
                f"{self.api_base}/messages",
                params=params,
                headers=self._get_auth_headers(),
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 200:
                data = resp.json()
                users = data.get("users", [])
                # 更新用户缓存
                self._update_user_cache(users)
                return data.get("messages", []), users
            elif resp.status_code == 401:
                print("[Agent] 未授权，请先登录")
            else:
                print(f"[Agent] 获取消息失败: {resp.status_code}")
            return [], []
        except requests.RequestException as e:
            print(f"[Agent] 请求异常: {e}")
            return [], []

    def _update_user_cache(self, users: List[Dict]) -> None:
        """更新用户名缓存"""
        for user in users:
            user_id = user.get("id")
            if user_id:
                self._user_map_cache[user_id] = user.get("name", "User")
                # 缓存 agent 名称
                if user_id == self.agent_user_id:
                    self._agent_name_cache = user.get("name")

    def send_heartbeat(self) -> bool:
        """发送心跳信号"""
        try:
            resp = self._session.post(
                f"{self.api_base}/agents/{self.agent_id}/heartbeat",
                headers=self._agent_headers,
                timeout=5,
            )
            return resp.status_code == 200
        except requests.RequestException:
            return False

    def _heartbeat_loop(self) -> None:
        """心跳线程"""
        while self._running:
            self.send_heartbeat()
            time.sleep(HEARTBEAT_INTERVAL)

    def send_message(self, content: str, reply_to_id: Optional[str] = None) -> bool:
        """通过 Agent API 发送消息"""
        payload = {"content": content, "conversationId": CONVERSATION_ID}
        if reply_to_id:
            payload["replyToId"] = reply_to_id

        try:
            resp = self._session.post(
                f"{self.api_base}/agents/{self.agent_id}/messages",
                json=payload,
                headers=self._agent_headers,
                timeout=LLM_TIMEOUT,
            )
            if resp.status_code == 200:
                print(f"[Agent] 消息已发送: {content[:50]}...")
                return True
            print(f"[Agent] 发送失败: {resp.status_code}")
            return False
        except requests.RequestException as e:
            print(f"[Agent] 发送异常: {e}")
            return False

    def add_reaction(self, message_id: str, emoji: str) -> bool:
        """给消息添加表情反应"""
        try:
            resp = self._session.post(
                f"{self.api_base}/agents/{self.agent_id}/reactions",
                json={"messageId": message_id, "emoji": emoji},
                headers=self._agent_headers,
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 200:
                print(f"[Agent] 已添加反应: {emoji} -> {message_id[:8]}...")
                return True
            print(f"[Agent] 添加反应失败: {resp.status_code}")
            return False
        except requests.RequestException as e:
            print(f"[Agent] 添加反应异常: {e}")
            return False

    def set_looking(self, is_looking: bool) -> bool:
        """设置 Agent 正在查看消息的状态"""
        try:
            resp = self._session.post(
                f"{self.api_base}/agents/{self.agent_id}/looking",
                json={"isLooking": is_looking},
                headers=self._agent_headers,
                timeout=5,
            )
            if resp.status_code == 200:
                print(f"[Agent] Looking 状态已设置: {is_looking}")
                return True
            else:
                print(f"[Agent] Looking 状态设置失败: {resp.status_code}")
                return False
        except requests.RequestException as e:
            print(f"[Agent] Looking 状态设置异常: {e}")
            return False

    def is_mentioned(self, message: Dict, users: List[Dict]) -> bool:
        """检查消息是否 @ 了本 Agent"""
        # 快速检查 mentions 列表
        if self.agent_user_id in message.get("mentions", []):
            return True

        # 检查消息内容中是否包含 @AgentName
        content = message.get("content", "")
        agent_name = self._agent_name_cache
        if not agent_name:
            # 从用户列表中查找并缓存
            for user in users:
                if user.get("id") == self.agent_user_id:
                    agent_name = user.get("name", "")
                    self._agent_name_cache = agent_name
                    break

        return bool(agent_name and f"@{agent_name}" in content)

    def build_context(self, messages: List[Dict], users: List[Dict], current_msg: Dict) -> List[Dict]:
        """构建对话上下文"""
        # 优先使用缓存的用户映射
        user_map = self._user_map_cache.copy()
        # 补充新用户
        for u in users:
            if u["id"] not in user_map:
                user_map[u["id"]] = u.get("name", "User")

        # 取最近消息作为上下文
        recent = messages[-CONTEXT_LIMIT:] if len(messages) > CONTEXT_LIMIT else messages
        current_msg_id = current_msg.get("id")
        context_messages = []

        for msg in recent:
            sender_id = msg.get("senderId", "")
            msg_id = msg.get("id", "")
            # 过滤历史消息中的特殊标签
            content = strip_special_tags(msg.get("content", ""))
            # 移除 @ 标签
            content = _RE_MENTION.sub("", content).strip()

            if sender_id == self.agent_user_id:
                context_messages.append({"role": "assistant", "content": content})
            else:
                sender_name = user_map.get(sender_id, "User")
                # 当前提问的消息标记
                if msg_id == current_msg_id:
                    formatted = f"[msg:{msg_id}] <Name: {sender_name}> [asking you]: {content}"
                else:
                    formatted = f"[msg:{msg_id}] <Name: {sender_name}>: {content}"
                context_messages.append({"role": "user", "content": formatted})

        return context_messages

    def build_system_prompt(self, mode: str = "passive") -> str:
        """
        构建系统提示词，根据能力配置添加工具说明

        mode:
        - "passive": 被 @ 时，必须回复
        - "proactive": 主动模式，AI 自己决定是否回复/点赞
        """
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

        capabilities = self.agent_config.get("capabilities", {}) if self.agent_config else {}
        has_like = capabilities.get("like", False)
        has_active = capabilities.get("answer_active", False)

        if mode == "proactive":
            # 主动模式：AI 自己决定要不要参与
            tool_prompt = "\n\n## 群聊参与指南\n"
            tool_prompt += "你正在观察群聊对话。请判断是否需要参与：\n\n"
            tool_prompt += "**可选行动：**\n"

            if has_active:
                tool_prompt += "1. **回复消息** - 如果你能提供有价值的帮助、解答问题、或参与有意义的讨论\n"
            if has_like:
                tool_prompt += "2. **表情反应** - 使用 [REACT:emoji:message_id] 对消息点赞（👍 ❤️ 😂 🎉）\n"
            tool_prompt += "3. **跳过** - 输出 [SKIP] 表示不参与\n\n"

            tool_prompt += "**判断标准：**\n"
            tool_prompt += "- ✅ 用户提问或寻求帮助 → 回复\n"
            tool_prompt += "- ✅ 有趣/精彩/感谢的内容 → 点赞\n"
            tool_prompt += "- ❌ 闲聊/与你无关/已有人回答 → [SKIP]\n"
            tool_prompt += "- ❌ 不确定是否需要你 → [SKIP]\n\n"

            tool_prompt += "**重要：** 不要过度参与，只在真正有价值时才回复或点赞。宁可错过也不要打扰。\n"

            if has_like:
                tool_prompt += "\n表情格式：[REACT:emoji:message_id]，从消息前缀 [msg:xxx] 复制完整的 message_id"

            base_prompt += tool_prompt

        elif mode == "passive" and has_like:
            # 被动模式（被 @ 时）：必须回复，可选点赞
            tool_prompt = (
                "\n\n## Tools Available\n"
                "You have access to a reaction tool. Format: [REACT:emoji:message_id]\n"
                "- emoji: Any emoji like 👍 ❤️ 😂 🎉 etc.\n"
                "- message_id: Copy the exact id from [msg:xxx] prefix in messages\n\n"
                "Examples:\n"
                "- [REACT:👍:abc-123-def] - react to message with id abc-123-def\n"
                "- [REACT:❤️:xyz-789] - react to message with id xyz-789\n\n"
                "Rules:\n"
                "- For simple acknowledgments (谢谢, ok, 好的, etc.), use [REACT:...] ONLY, no text\n"
                "- You can combine reaction with text reply if needed\n"
                "- IMPORTANT: Use the exact message_id from [msg:xxx], not 'current'"
            )
            base_prompt += tool_prompt

        return base_prompt

    def parse_and_execute_tools(self, response: str, current_msg: Dict) -> Tuple[bool, str]:
        """解析响应中的工具调用并执行，返回 (是否只有工具调用, 清理后的文本)"""
        matches = _RE_REACT_TOOL.findall(response)

        for emoji, msg_id in matches:
            # 直接使用提供的 message_id
            print(f"[Agent] 执行工具: add_reaction({emoji.strip()}, {msg_id})")
            self.add_reaction(msg_id.strip(), emoji.strip())

        # 移除所有工具调用标记
        cleaned = _RE_REACT_TOOL.sub("", response).strip()

        # 如果清理后为空，说明只有工具调用
        return len(cleaned) == 0, cleaned

    def generate_reply(self, context: list, current_msg: dict, mode: str = "passive") -> tuple:
        """调用 LLM 生成回复，返回 (是否只有工具调用/跳过, 回复内容)"""
        system_prompt = {
            "role": "system",
            "content": self.build_system_prompt(mode=mode),
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

        # 设置 looking 状态
        self.set_looking(True)

        try:
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
        finally:
            # 清除 looking 状态
            self.set_looking(False)

    def try_proactive_response(self, message: dict, messages: list, users: list) -> bool:
        """
        主动响应：让 AI 自己决定是否回复或点赞

        返回 True 表示 AI 做了某种响应（回复或点赞），False 表示跳过
        """
        msg_id = message.get("id")
        sender_id = message.get("senderId")

        # 跳过自己的消息
        if sender_id == self.agent_user_id:
            return False

        # 跳过已处理过的消息
        if msg_id in self.reacted_message_ids:
            return False

        # 检查是否启用了主动能力（answer_active 或 like）
        capabilities = self.agent_config.get("capabilities", {}) if self.agent_config else {}
        has_active = capabilities.get("answer_active", False)
        has_like = capabilities.get("like", False)

        if not has_active and not has_like:
            return False

        # 获取冷却时间配置（从 runtime.proactiveCooldown 读取，默认 30 秒）
        runtime = self.agent_config.get("runtime", {}) if self.agent_config else {}
        cooldown = runtime.get("proactiveCooldown", DEFAULT_PROACTIVE_COOLDOWN)

        # 检查冷却时间
        now = time.time()
        if now - self.last_proactive_time < cooldown:
            return False

        print(f"[Agent] 主动模式处理消息: {message.get('content', '')[:50]}...")

        # 设置 looking 状态
        self.set_looking(True)

        try:
            # 刷新配置
            self.fetch_agent_config()

            # 构建完整上下文（包含最近对话）
            context = self.build_context(messages, users, message)

            # 生成响应（主动模式，AI 自己决定）
            only_tools, response = self.generate_reply(context, message, mode="proactive")

            # 检查是否跳过
            if "[SKIP]" in response:
                print(f"[Agent] 主动模式: AI 决定跳过")
                self.reacted_message_ids.add(msg_id)
                return False

            # 如果有文字回复（非纯工具调用），发送消息
            if not only_tools and response.strip():
                print(f"[Agent] 主动模式: AI 决定回复")
                self.send_message(response, reply_to_id=msg_id)

            # 更新冷却时间和已处理集合
            self.last_proactive_time = now
            self.reacted_message_ids.add(msg_id)
            self.processed_message_ids.add(msg_id)
            return True
        finally:
            # 清除 looking 状态
            self.set_looking(False)

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
                        # 先检查是否是 @ 消息（优先级高，无冷却时间）
                        if self.is_mentioned(msg, users):
                            self.process_message(msg, messages, users)
                        else:
                            # 非 @ 消息：主动模式，AI 自己决定是否参与
                            self.try_proactive_response(msg, messages, users)

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