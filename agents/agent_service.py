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

# Additional patterns for native model format cleanup
_RE_NATIVE_CHANNEL_BLOCK = re.compile(
    r"<\|channel\|>(?:analysis|commentary|tool)[^<]*(?:<\|constrain\|>[^<]*)?<\|message\|>.*?(?:<\|end\|>|<\|call\|>|<\|start\|>|$)",
    re.DOTALL | re.IGNORECASE
)
_RE_NATIVE_TOOL_CALL = re.compile(
    r"<\|channel\|>(?:commentary|analysis|tool)\s+to=\w+[^<]*(?:<\|constrain\|>[^<]*)?<\|message\|>\{[^}]*\}(?:<\|call\|>)?",
    re.DOTALL | re.IGNORECASE
)
_RE_JSON_TOOL_CALL = re.compile(r'\{"(?:query|id|search)[^}]*\}')


def strip_special_tags(text: str) -> str:
    """清理模型输出的特殊标签，只保留最终回答"""
    if not text:
        return ""

    # 1. 尝试提取 final channel 的内容
    final_match = _RE_FINAL_CHANNEL.search(text)
    if final_match:
        text = final_match.group(1)
    else:
        # 如果没有 final channel，尝试移除所有 analysis/commentary 块
        text = _RE_NATIVE_TOOL_CALL.sub("", text)
        text = _RE_NATIVE_CHANNEL_BLOCK.sub("", text)

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
    text = _RE_JSON_TOOL_CALL.sub("", text)

    # 7. 清理多余空行和空白
    text = _RE_MULTI_NEWLINES.sub("\n\n", text)

    return text.strip()


# 配置常量
API_BASE = "http://localhost:4000"
AGENT_TOKEN = "dev-agent-token"
DEFAULT_AGENT_ID = "helper-agent-1"  # Renamed: default agent for single-agent mode
POLL_INTERVAL = 1
HEARTBEAT_INTERVAL = 5
DEFAULT_PROACTIVE_COOLDOWN = 30  # 可通过 Agent 配置覆盖
CONVERSATION_ID = "global"
DEFAULT_AGENT_USER_ID = "llm1"  # Renamed: default for single-agent mode
CONTEXT_LIMIT = 10  # 上下文消息数量限制
REQUEST_TIMEOUT = 10
LLM_TIMEOUT = 30

# Import built-in tools
from tools import AgentTools, parse_tool_calls, remove_tool_calls


class AgentService:
    """Agent 服务 - 处理消息轮询和 LLM 交互"""

    def __init__(
        self,
        api_base: str = API_BASE,
        agent_token: str = AGENT_TOKEN,
        agent_id: str = DEFAULT_AGENT_ID,
        agent_user_id: str = DEFAULT_AGENT_USER_ID,
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

        # Message cancellation support - track pending message for interruption
        self._pending_message_id: Optional[str] = None
        self._cancel_requested = False
        self._processing_lock = threading.Lock()

        # 复用 HTTP session 提升性能
        self._session = requests.Session()
        self._agent_headers = {
            "Content-Type": "application/json",
            "X-Agent-Token": self.agent_token,
        }

        # 缓存用户名映射
        self._user_map_cache: Dict[str, str] = {}
        self._agent_name_cache: Optional[str] = None

        # Initialize built-in tools (will be set after session is created)
        self._tools: Optional[AgentTools] = None

    def _init_tools(self) -> AgentTools:
        """Initialize or get the AgentTools instance"""
        if self._tools is None:
            self._tools = AgentTools(
                api_base=self.api_base,
                agent_id=self.agent_id,
                headers=self._agent_headers,
                session=self._session,
                conversation_id=CONVERSATION_ID,
                request_timeout=REQUEST_TIMEOUT,
            )
        return self._tools

    @property
    def tools(self) -> AgentTools:
        """Get the tools instance"""
        return self._init_tools()

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

    def mentions_another_agent(self, message: Dict, users: List[Dict]) -> bool:
        """
        检查消息是否 @ 了其他 Agent（非本 Agent）

        如果消息明确 @ 了另一个 Agent，则本 Agent 不应主动回复。
        """
        mentions = message.get("mentions", [])
        content = message.get("content", "")

        # 获取所有 agent 类型用户
        agent_users = [u for u in users if u.get("type") == "agent" or u.get("isLLM")]

        for user in agent_users:
            user_id = user.get("id")
            user_name = user.get("name", "")

            # 跳过自己
            if user_id == self.agent_user_id:
                continue

            # 检查 mentions 列表
            if user_id in mentions:
                return True

            # 检查内容中的 @Name
            if user_name and f"@{user_name}" in content:
                return True

        return False

    def check_for_followup_messages(self, sender_id: str, after_timestamp: int) -> Optional[Dict]:
        """
        Check if the sender has sent any follow-up messages after the given timestamp.

        This is used to detect when a user sends additional messages while the agent
        is still processing their previous message (the "split message" problem).

        Returns the newest follow-up message if found, None otherwise.
        """
        try:
            messages, _ = self.fetch_messages(since=after_timestamp)
            # Find messages from the same sender that are newer
            followups = [
                m for m in messages
                if m.get("senderId") == sender_id
                and m.get("timestamp", 0) > after_timestamp
                and m.get("id") not in self.processed_message_ids
            ]
            if followups:
                # Return the newest one
                return max(followups, key=lambda m: m.get("timestamp", 0))
            return None
        except Exception as e:
            print(f"[Agent] Error checking for follow-up messages: {e}")
            return None

    def should_cancel_response(self, original_msg: Dict) -> Tuple[bool, Optional[Dict]]:
        """
        Check if we should cancel the current response due to follow-up messages.

        Returns (should_cancel, followup_message)
        """
        sender_id = original_msg.get("senderId")
        msg_timestamp = original_msg.get("timestamp", 0)

        followup = self.check_for_followup_messages(sender_id, msg_timestamp)
        if followup:
            print(f"[Agent] Detected follow-up message from same sender, cancelling response...")
            print(f"[Agent] Follow-up: {followup.get('content', '')[:50]}...")
            return True, followup

        return False, None

    def build_context(self, messages: List[Dict], users: List[Dict], current_msg: Dict) -> List[Dict]:
        """构建对话上下文"""
        # 优先使用缓存的用户映射
        user_map = self._user_map_cache.copy()
        # 补充新用户
        for u in users:
            if u["id"] not in user_map:
                user_map[u["id"]] = u.get("name", "User")

        # Build a map of agent user IDs to their names
        agent_user_ids = {}
        for u in users:
            if u.get("type") == "agent" or u.get("isLLM"):
                agent_user_ids[u["id"]] = u.get("name", "Agent")

        # 取最近消息作为上下文
        recent = messages[-CONTEXT_LIMIT:] if len(messages) > CONTEXT_LIMIT else messages
        current_msg_id = current_msg.get("id")
        context_messages = []

        for msg in recent:
            sender_id = msg.get("senderId", "")
            msg_id = msg.get("id", "")
            mentions = msg.get("mentions", [])
            reply_to_id = msg.get("replyToId")

            # 过滤历史消息中的特殊标签
            content = strip_special_tags(msg.get("content", ""))
            # 移除 @ 标签 (we'll add structured [TO: xxx] tag instead)
            content = _RE_MENTION.sub("", content).strip()

            # Determine who this message is directed to
            directed_to = None
            directed_to_me = False

            # Check mentions - is this message @'ing an agent?
            for mentioned_id in mentions:
                if mentioned_id in agent_user_ids:
                    if mentioned_id == self.agent_user_id:
                        directed_to_me = True
                        directed_to = "YOU"
                    else:
                        directed_to = agent_user_ids[mentioned_id]
                    break

            # Check if replying to an agent's message
            if reply_to_id and not directed_to:
                replied_msg = next((m for m in messages if m.get("id") == reply_to_id), None)
                if replied_msg:
                    replied_sender = replied_msg.get("senderId")
                    if replied_sender in agent_user_ids:
                        if replied_sender == self.agent_user_id:
                            directed_to_me = True
                            directed_to = "YOU"
                        else:
                            directed_to = agent_user_ids[replied_sender]

            if sender_id == self.agent_user_id:
                context_messages.append({"role": "assistant", "content": content})
            else:
                sender_name = user_map.get(sender_id, "User")

                # Build formatted message with clear direction tag
                if directed_to_me:
                    # Message is for ME (this agent)
                    direction_tag = "[TO: YOU]"
                elif directed_to:
                    # Message is for ANOTHER agent - clearly mark it
                    direction_tag = f"[TO: @{directed_to}, not you]"
                else:
                    # General message to everyone
                    direction_tag = "[TO: everyone]"

                formatted = f"[msg:{msg_id}] <{sender_name}> {direction_tag}: {content}"
                context_messages.append({"role": "user", "content": formatted})

        return context_messages

    def build_system_prompt(self, mode: str = "passive") -> str:
        """
        构建系统提示词，根据能力配置添加工具说明

        mode:
        - "passive": 被 @ 时，必须回复
        - "proactive": 主动模式，AI 自己决定是否回复/点赞
        """
        # Get current date/time for context
        import datetime
        current_date = datetime.datetime.now().strftime("%Y年%m月%d日")
        current_datetime = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

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

        # Add current date/time context
        base_prompt = f"**Current date: {current_date} ({current_datetime})**\n\n{base_prompt}"

        capabilities = self.agent_config.get("capabilities", {}) if self.agent_config else {}
        has_like = capabilities.get("like", False)
        has_active = capabilities.get("answer_active", False)

        if mode == "proactive":
            # 主动模式：AI 自己决定要不要参与
            tool_prompt = "\n\n## 群聊参与指南\n"
            tool_prompt += "你正在观察群聊对话。请判断是否需要参与：\n\n"

            tool_prompt += "**消息方向标记说明：**\n"
            tool_prompt += "- [TO: YOU] = 消息是发给你的，你应该回复\n"
            tool_prompt += "- [TO: @其他Agent, not you] = 消息是发给其他AI助手的，你不应该抢答！\n"
            tool_prompt += "- [TO: everyone] = 消息是发给所有人的，你可以选择是否参与\n\n"

            tool_prompt += "**可选行动：**\n"
            if has_active:
                tool_prompt += "1. **回复消息** - 如果你能提供有价值的帮助、解答问题、或参与有意义的讨论\n"
            if has_like:
                tool_prompt += "2. **表情反应** - 使用 [REACT:emoji:message_id] 对消息点赞（👍 ❤️ 😂 🎉）\n"
            tool_prompt += "3. **跳过** - 输出 [SKIP] 表示不参与\n\n"

            tool_prompt += "**判断标准：**\n"
            tool_prompt += "- ✅ [TO: YOU] 的消息 → 必须回复\n"
            tool_prompt += "- ❌ [TO: @其他Agent, not you] 的消息 → 必须 [SKIP]，这不是问你的！\n"
            tool_prompt += "- ✅ [TO: everyone] 且用户提问或寻求帮助 → 可以回复\n"
            tool_prompt += "- ✅ 有趣/精彩/感谢的内容 → 点赞\n"
            tool_prompt += "- ❌ 闲聊/与你无关/已有人回答 → [SKIP]\n"
            tool_prompt += "- ❌ 不确定是否需要你 → [SKIP]\n\n"

            tool_prompt += "**重要：** 如果消息标记了 [TO: @其他Agent, not you]，你绝对不能回复！这是在问其他AI助手，不是你。\n"

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

        # Add context tools documentation based on enabled tools
        enabled_tools = self.agent_config.get("tools", []) if self.agent_config else []

        # Build tools prompt dynamically based on what's enabled
        tools_sections = []
        tool_num = 1

        # Check each tool and add if enabled
        if "chat.get_context" in enabled_tools:
            tools_sections.append(
                f"{tool_num}. **Get Context** - Get 10 messages around a specific message:\n"
                "   Format: [GET_CONTEXT:message_id]\n"
                "   Example: [GET_CONTEXT:abc-123-def]\n"
                "   Use when: You need to understand the context of a specific message"
            )
            tool_num += 1

        if "chat.get_long_context" in enabled_tools:
            tools_sections.append(
                f"{tool_num}. **Get Long Context** - Get the full conversation history:\n"
                "   Format: [GET_LONG_CONTEXT]\n"
                "   Use when: You need to summarize or understand the entire conversation"
            )
            tool_num += 1

        if "tools.web_search" in enabled_tools:
            tools_sections.append(
                f"{tool_num}. **Web Search** - Search the web for current information:\n"
                "   Format: [WEB_SEARCH:search query]\n"
                "   Example: [WEB_SEARCH:latest news about AI]\n"
                "   **IMPORTANT**: You MUST use this tool for:\n"
                "   - Current events, news, sports scores, standings\n"
                "   - Recent developments (anything after your knowledge cutoff)\n"
                "   - Real-time data (stock prices, weather, etc.)\n"
                "   - Facts you're unsure about\n"
                "   DO NOT guess or hallucinate answers about current events - search first!"
            )
            tool_num += 1

        if "tools.local_rag" in enabled_tools:
            tools_sections.append(
                f"{tool_num}. **Local RAG** - Search the knowledge base for relevant documents:\n"
                "   Format: [LOCAL_RAG:search query]\n"
                "   Example: [LOCAL_RAG:company policy on remote work]\n"
                "   Use when: You need to find information from uploaded documents"
            )
            tool_num += 1

        # Only add tools section if any tools are enabled
        if tools_sections:
            context_tools_prompt = (
                "\n\n## Context Tools\n"
                "If you need more context to answer properly, you can use these tools:\n\n"
                + "\n\n".join(tools_sections)
                + "\n\n**Tool Usage Rules:**\n"
                "- If you use these tools, they will be executed and results will be provided.\n"
                "- You can then provide a more informed response based on the tool results.\n"
            )
            if "tools.web_search" in enabled_tools:
                context_tools_prompt += "- For questions about current events/standings/scores: ALWAYS search first!\n"
            base_prompt += context_tools_prompt

        return base_prompt

    def parse_and_execute_tools(self, response: str, current_msg: Dict) -> Tuple[bool, str, Optional[Dict]]:
        """
        解析响应中的工具调用并执行

        Returns:
            Tuple of (是否只有工具调用, 清理后的文本, 上下文数据如果请求了的话)
        """
        context_data = None

        # Execute reaction tools
        matches = _RE_REACT_TOOL.findall(response)
        for emoji, msg_id in matches:
            print(f"[Agent] 执行工具: add_reaction({emoji.strip()}, {msg_id})")
            self.add_reaction(msg_id.strip(), emoji.strip())

        # Parse and execute context tools
        tool_calls = parse_tool_calls(response)
        tool_results = []  # Collect results from all tools

        # Handle GET_CONTEXT calls
        for msg_id in tool_calls.get("get_context", []):
            print(f"[Agent] 执行工具: get_context({msg_id})")
            ctx = self.tools.get_context(msg_id)
            if ctx:
                context_data = ctx
                tool_results.append(("get_context", self.tools.compress_context(
                    ctx.get("messages", []), ctx.get("users", [])
                )))

        # Handle GET_LONG_CONTEXT calls
        if tool_calls.get("get_long_context"):
            print(f"[Agent] 执行工具: get_long_context()")
            ctx = self.tools.get_long_context()
            if ctx:
                context_data = ctx
                tool_results.append(("get_long_context", self.tools.compress_context(
                    ctx.get("messages", []), ctx.get("users", [])
                )))

        # Handle WEB_SEARCH calls - only execute first unique query to avoid duplicates
        web_search_queries = tool_calls.get("web_search", [])
        if web_search_queries:
            # Take only the first query (model often outputs multiple similar queries)
            query = web_search_queries[0]
            print(f"[Agent] 执行工具: web_search({query})")
            if len(web_search_queries) > 1:
                print(f"[Agent] 忽略 {len(web_search_queries) - 1} 个重复的搜索请求")
            search_result = self.tools.web_search(query, max_results=3)
            if search_result:
                tool_results.append(("web_search", self.tools.format_search_results(search_result)))

        # Handle LOCAL_RAG calls - only execute first unique query to avoid duplicates
        local_rag_queries = tool_calls.get("local_rag", [])
        if local_rag_queries:
            query = local_rag_queries[0]
            print(f"[Agent] 执行工具: local_rag({query})")
            if len(local_rag_queries) > 1:
                print(f"[Agent] 忽略 {len(local_rag_queries) - 1} 个重复的RAG请求")
            rag_result = self.tools.local_rag(query)
            if rag_result:
                tool_results.append(("local_rag", self.tools.format_rag_results(rag_result)))

        # 移除所有工具调用标记
        cleaned = _RE_REACT_TOOL.sub("", response)
        cleaned = remove_tool_calls(cleaned).strip()

        # Return tool results along with context_data for multi-round processing
        # If there are tool results, we'll need another round
        if tool_results and not context_data:
            # Create a synthetic context_data to trigger another round
            context_data = {"tool_results": tool_results}

        # 如果清理后为空，说明只有工具调用
        return len(cleaned) == 0, cleaned, context_data

    def generate_reply(self, context: list, current_msg: dict, mode: str = "passive", max_tool_rounds: int = 2) -> tuple:
        """
        调用 LLM 生成回复，支持多轮工具调用

        Args:
            context: 消息上下文列表
            current_msg: 当前处理的消息
            mode: 模式 ("passive" 或 "proactive")
            max_tool_rounds: 最大工具调用轮数（防止无限循环）

        Returns:
            (是否只有工具调用/跳过, 回复内容)
        """
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

        tool_round = 0
        while tool_round < max_tool_rounds:
            tool_round += 1

            # 打印完整提示词
            agent_name = self.agent_config.get("name", self.agent_id) if self.agent_config else self.agent_id
            print(f"\n[{agent_name}] ===== 发送给模型的提示词 (Round {tool_round}) =====")
            print(f"[{agent_name}] Model: {model_name}, Temp: {temperature}, MaxTokens: {max_tokens}")
            for i, msg in enumerate(messages):
                role = msg.get("role", "unknown")
                content = msg.get("content", "")
                print(f"[{i}] {role}:")
                print(f"    {content}")
            print(f"[{agent_name}] ===== 提示词结束 =====\n")

            try:
                response = chat_with_history(
                    messages,
                    model=model_name,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
                # 打印原始响应
                print(f"\n[{agent_name}] ===== 原始响应 =====")
                print(response)
                print(f"[{agent_name}] ===== 原始响应结束 =====\n")

                # 解析并执行工具调用 (从原始响应解析，因为 strip_special_tags 会移除工具调用标签)
                only_tools, final_text, context_data = self.parse_and_execute_tools(response, current_msg)

                # 清理响应文本（移除特殊标签和工具调用）
                cleaned = strip_special_tags(response)
                cleaned = remove_tool_calls(cleaned).strip()
                print(f"[{agent_name}] 过滤后: {cleaned[:100]}...")

                # 如果没有工具返回数据，直接使用清理后的文本
                if not context_data:
                    final_text = cleaned
                    only_tools = len(final_text) == 0

                # If tools were used, we need another round with enriched context
                if context_data and tool_round < max_tool_rounds:
                    print(f"[{agent_name}] 工具返回了数据，进行第 {tool_round + 1} 轮调用...")

                    # Check if this is tool_results (web search, RAG) or context data
                    tool_results = context_data.get("tool_results", [])

                    if tool_results:
                        # Format all tool results
                        results_text = []
                        for tool_name, result in tool_results:
                            results_text.append(f"**[{tool_name}]**:\n{result}")
                        tool_output = "\n\n".join(results_text)
                    else:
                        # Legacy context data format
                        tool_output = self.tools.compress_context(
                            context_data.get("messages", []),
                            context_data.get("users", [])
                        )

                    # Add the tool results as conversation context
                    messages.append({
                        "role": "assistant",
                        "content": f"[Used tools]\n{cleaned}"
                    })
                    messages.append({
                        "role": "user",
                        "content": f"[Tool results]:\n{tool_output}\n\nNow please provide your response based on this information."
                    })
                    continue  # Go to next round

                # No more tool calls needed, return the result
                return only_tools, final_text

            except Exception as e:
                print(f"[Agent] LLM 调用失败: {e}")
                return False, f"抱歉，我遇到了一些问题：{str(e)}"

        # Max rounds reached
        print(f"[Agent] 达到最大工具调用轮数 ({max_tool_rounds})")
        return only_tools, final_text

    def process_message(self, message: dict, messages: list, users: list, check_followup: bool = True):
        """
        处理单条消息

        Args:
            message: 要处理的消息
            messages: 当前所有消息列表
            users: 用户列表
            check_followup: 是否检查后续消息（避免回复过早的消息）
        """
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

        # ===== Follow-up Check (Before Processing) =====
        # Check if the user has sent more messages since this one
        # This handles the "split message" problem where users send messages like:
        # "Hey guys!" -> "You know what happened?" -> "I saw a shooting star!"
        # We should wait and respond to the complete thought, not just the first message.
        if check_followup:
            should_cancel, followup = self.should_cancel_response(message)
            if should_cancel:
                print(f"[Agent] Skipping message {msg_id[:8]}... due to follow-up from same sender")
                # Mark this message as processed so we don't try again
                self.processed_message_ids.add(msg_id)
                # The follow-up message will be processed in the next poll cycle
                return

        # 设置 looking 状态
        self.set_looking(True)

        try:
            # 刷新配置（确保使用最新的系统提示词和模型参数）
            self.fetch_agent_config()

            # ===== Refresh messages to include recent context =====
            # Fetch latest messages to include any follow-ups in context
            fresh_messages, fresh_users = self.fetch_messages()
            if fresh_messages:
                messages = fresh_messages
                users = fresh_users

            # 构建上下文
            context = self.build_context(messages, users, message)

            # 生成回复（可能包含工具调用）
            only_tools, reply = self.generate_reply(context, message)

            # ===== Follow-up Check (After Processing) =====
            # Check again after LLM call - if user sent more messages during processing,
            # our response might be outdated/awkward
            should_cancel_after, followup_after = self.should_cancel_response(message)
            if should_cancel_after and not only_tools:
                print(f"[Agent] Response cancelled - user sent follow-up during processing")
                # Mark as processed but don't send the response
                self.processed_message_ids.add(msg_id)
                return

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

        # ===== 关键检查：如果消息 @ 了其他 Agent，不要主动回复 =====
        # 例如：用户 @MOSS 提问，AI助手 不应该抢答
        if self.mentions_another_agent(message, users):
            print(f"[Agent] Proactive: Skipping - message mentions another agent")
            self.reacted_message_ids.add(msg_id)
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

        # ===== Follow-up Check (Before Processing) =====
        # In proactive mode, also check for follow-up messages
        should_cancel, followup = self.should_cancel_response(message)
        if should_cancel:
            print(f"[Agent] Proactive: Skipping message due to follow-up from same sender")
            self.reacted_message_ids.add(msg_id)
            return False

        print(f"[Agent] 主动模式处理消息: {message.get('content', '')[:50]}...")

        # 设置 looking 状态
        self.set_looking(True)

        try:
            # 刷新配置
            self.fetch_agent_config()

            # ===== Refresh messages to include recent context =====
            fresh_messages, fresh_users = self.fetch_messages()
            if fresh_messages:
                messages = fresh_messages
                users = fresh_users

            # 构建完整上下文（包含最近对话）
            context = self.build_context(messages, users, message)

            # 生成响应（主动模式，AI 自己决定）
            only_tools, response = self.generate_reply(context, message, mode="proactive")

            # 检查是否跳过
            if "[SKIP]" in response:
                print(f"[Agent] 主动模式: AI 决定跳过")
                self.reacted_message_ids.add(msg_id)
                return False

            # ===== Follow-up Check (After Processing) =====
            should_cancel_after, _ = self.should_cancel_response(message)
            if should_cancel_after and not only_tools:
                print(f"[Agent] Proactive response cancelled - user sent follow-up during processing")
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

    parser = argparse.ArgumentParser(description="Agent Service (Single Agent Mode)")
    parser.add_argument("--email", default="root@example.com", help="Login email")
    parser.add_argument("--password", default="1234567890", help="Login password")
    parser.add_argument("--agent-id", default=DEFAULT_AGENT_ID, help="Agent ID")
    args = parser.parse_args()

    print(f"[Agent] Starting single agent mode...")
    print(f"[Agent] For multiple agents, use: python multi_agent_manager.py")
    print("-" * 40)

    service = AgentService(agent_id=args.agent_id)

    # Login to get token
    if service.login(args.email, args.password):
        # Fetch agent config
        config = service.fetch_agent_config()
        if config:
            print(f"[Agent] Loaded config:")
            print(f"  - Name: {config.get('name')}")
            print(f"  - Provider: {config.get('model', {}).get('provider')}")
            print(f"  - Model: {config.get('model', {}).get('name')}")
            caps = config.get('capabilities', {})
            mode = "proactive" if caps.get('answer_active') else "passive"
            print(f"  - Mode: {mode}")
            print(f"  - System Prompt: {config.get('systemPrompt', '')[:50]}...")
        else:
            print("[Agent] Warning: Could not load agent config, using defaults")
        service.run()
    else:
        print("[Agent] Cannot start: login failed")