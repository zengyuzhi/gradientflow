# -*- coding: utf-8 -*-
"""
Agent Service - Message polling and @ mention response

Uses core.llm_client for LLM calls with gpt-oss harmony format support.
"""
import re
import json
from typing import Optional, Tuple, List, Dict

from base_agent import BaseAgentService
from core import (
    API_BASE,
    AGENT_TOKEN,
    DEFAULT_AGENT_ID,
    DEFAULT_AGENT_USER_ID,
    CONVERSATION_ID,
    REQUEST_TIMEOUT,
    log_text,
    strip_special_tags,
    RE_REACT_TOOL,
    # Harmony parser (GPT-OSS)
    HarmonyPromptBuilder,
    parse_harmony_response,
    clean_harmony_response,
    build_tool_result_message,
    build_multi_tool_results,
    # Unified tool formatters
    add_tools_to_harmony_builder,
    build_tools_text_prompt,
    build_mcp_text_prompt,
    build_reaction_text_prompt,
    # LLM client
    chat_with_history,
    configure_llm,
    # Tool executor
    AgentTools,
    parse_tool_calls,
    remove_tool_calls,
)


class AgentService(BaseAgentService):
    """
    Agent Service with GPT-OSS Harmony format support.

    Extends BaseAgentService with:
    - core.llm_client based LLM calls
    - Built-in tool support (GET_CONTEXT, WEB_SEARCH, LOCAL_RAG)
    - MCP tool integration
    - GPT-OSS Harmony format for function calling
    """

    def __init__(
        self,
        api_base: str = API_BASE,
        agent_token: str = AGENT_TOKEN,
        agent_id: str = DEFAULT_AGENT_ID,
        agent_user_id: str = DEFAULT_AGENT_USER_ID,
    ):
        super().__init__(
            api_base=api_base,
            agent_token=agent_token,
            agent_id=agent_id,
            agent_user_id=agent_user_id,
        )
        # Tools instance (lazy initialized)
        self._tools: Optional[AgentTools] = None

        # Harmony format flag (auto-detected from provider)
        self._use_harmony_format: bool = False

    # =========================================================================
    # Tools Management
    # =========================================================================

    def _init_tools(self) -> AgentTools:
        """Initialize or get the AgentTools instance."""
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
        """Get the tools instance."""
        return self._init_tools()

    def get_headers(self) -> Dict[str, str]:
        """Get Agent API headers (for backward compatibility)."""
        return self._agent_headers

    # =========================================================================
    # LLM Initialization (Abstract Method Implementation)
    # =========================================================================

    def _init_llm(self, config: Dict) -> None:
        """Configure core.llm_client from agent config."""
        model = config.get("model", {})
        runtime = config.get("runtime", {})

        provider = model.get("provider", "")

        if provider == "parallax":
            base_url = runtime.get("endpoint")
            if base_url:
                api_key = runtime.get("apiKeyAlias") or "not-needed"
                configure_llm(base_url=base_url, api_key=api_key)
                print(f"[Agent] Configured parallax provider: {base_url}")

                # Enable harmony format for parallax/gpt-oss
                self._use_harmony_format = True
                print(f"[Agent] Harmony format enabled for GPT-OSS")

    # =========================================================================
    # Harmony Format System Prompt Building
    # =========================================================================

    def _build_harmony_system_prompt(
        self, mode: str = "passive", users: List[Dict] = None
    ) -> str:
        """
        Build system prompt in GPT-OSS Harmony format.

        Args:
            mode: "passive" or "proactive"
            users: List of users for context

        Returns:
            Harmony formatted system prompt
        """
        # Get base instructions from config
        config_prompt = (
            self.agent_config.get("systemPrompt") if self.agent_config else None
        )

        # Build instructions with config prompt or default
        if config_prompt:
            instructions = config_prompt
        else:
            instructions = (
                "You are a friendly chat assistant. "
                "Be concise and helpful. Match the user's language in your response."
            )

        # Add response guidelines
        instructions += "\n\n## Response Guidelines\n"
        instructions += "- **Language**: ALWAYS respond in the same language as the user's message.\n"
        instructions += "- **Format**: Do NOT include any prefix like your name or role.\n"
        instructions += "- **Style**: Be concise. No unnecessary filler words.\n"
        instructions += "- **Tool Usage**: When you need to use a tool, ONLY output the tool call. Do NOT output a final answer in the same response. Wait for tool results before providing your answer.\n"
        instructions += "- **No Hallucination**: If a tool returns an error or no results, tell the user honestly. Do NOT make up or guess the answer.\n"

        # Add agent awareness
        my_name = self.mention_detector.agent_name or "Assistant"
        ai_agents = []
        if users:
            for u in users:
                if (
                    u.get("type") == "agent" or u.get("isLLM")
                ) and u.get("id") != self.agent_user_id:
                    ai_agents.append(u.get("name", "Unknown AI"))

        instructions += f"\n## GradientFlow Info\n"
        instructions += f"**Your Name:** {my_name}\n"
        if ai_agents:
            instructions += f"**Other AI Agents:** {', '.join(ai_agents)}\n"

        instructions += "\n**Important:** Messages with `(to @SomeAgent)` are directed at that specific agent. "
        instructions += "If a message is `(to @OtherAgent)` and NOT `(to you)`, you should skip - it's not your question to answer.\n"
        instructions += "- Reply when the message is (to you) or is open to everyone.\n"
        instructions += "- Use the existing conversation history to answer general questions; do not ignore prior context.\n"

        # Add mode-specific instructions
        capabilities = (
            self.agent_config.get("capabilities", {}) if self.agent_config else {}
        )
        has_like = capabilities.get("like", False)
        has_active = capabilities.get("answer_active", False)

        if mode == "proactive":
            instructions += self._build_harmony_proactive_instructions(has_like, has_active)
        elif mode == "passive" and has_like:
            instructions += self._build_harmony_reaction_instructions()

        # Get enabled tools and reasoning level from config
        enabled_tools = self.agent_config.get("tools", []) if self.agent_config else []
        reasoning = self.agent_config.get("reasoning", "low") if self.agent_config else "low"
        # Validate reasoning level
        if reasoning not in ("low", "medium", "high"):
            reasoning = "low"

        # Build harmony prompt
        builder = HarmonyPromptBuilder(reasoning=reasoning)
        builder.set_instructions(instructions)

        # Add function definitions using unified tool formatter
        mcp_config = self.agent_config.get("mcp", {}) if self.agent_config else {}
        add_tools_to_harmony_builder(
            builder=builder,
            enabled_keys=enabled_tools,
            has_like_capability=has_like,
            mcp_config=mcp_config,
        )
        print(f"[Agent] Enabled tools (harmony): {enabled_tools}")

        return builder.build()

    def _build_harmony_proactive_instructions(self, has_like: bool, has_active: bool) -> str:
        """Build proactive mode instructions for harmony format."""
        prompt = "\n\n## Participation Guide\n"
        prompt += "You are observing the chat. Decide whether to participate:\n\n"

        prompt += "**Message Direction Markers:**\n"
        prompt += "- (to you) = Message is for you, you should reply\n"
        prompt += "- (to @OtherAgent) = Message is for another AI, do NOT respond!\n"
        prompt += "- No marker = Message is for everyone, you may choose to participate\n\n"

        prompt += "**Decision Criteria:**\n"
        prompt += "- Messages directed to you → Reply with helpful response\n"
        prompt += "- Messages to other agents → Skip (output nothing or use skip function)\n"
        prompt += "- General questions you can help with → May reply\n"
        if has_like:
            prompt += "- Interesting/great content → React with emoji using react function\n"
        prompt += "- Small talk/irrelevant/already answered → Skip\n"

        return prompt

    def _build_harmony_reaction_instructions(self) -> str:
        """Build reaction instructions for harmony format."""
        return (
            "\n\n## Reactions\n"
            "You can react to messages with emoji using the react function.\n"
            "Use reactions for simple acknowledgments instead of text replies.\n"
            "If you only need to react without sending a text message, output [SKIP] in the final channel.\n"
        )

    # =========================================================================
    # Standard System Prompt Building (Abstract Method Implementation)
    # =========================================================================

    def build_system_prompt(
        self, mode: str = "passive", users: List[Dict] = None
    ) -> str:
        """Build system prompt - uses harmony format if enabled."""
        if self._use_harmony_format:
            return self._build_harmony_system_prompt(mode, users)

        # Fall back to standard format
        return self._build_standard_system_prompt(mode, users)

    def _build_standard_system_prompt(
        self, mode: str = "passive", users: List[Dict] = None
    ) -> str:
        """Build standard (non-harmony) system prompt with tool documentation."""
        base_prompt = self._build_base_system_prompt(mode, users)

        # Add mode-specific instructions
        capabilities = (
            self.agent_config.get("capabilities", {}) if self.agent_config else {}
        )
        has_like = capabilities.get("like", False)
        has_active = capabilities.get("answer_active", False)

        if mode == "proactive":
            base_prompt += self._build_proactive_prompt(has_like, has_active)
        elif mode == "passive" and has_like:
            base_prompt += self._build_reaction_prompt()

        # Add context tools documentation
        base_prompt += self._build_tools_prompt()

        # Add MCP tools documentation
        base_prompt += self._build_mcp_prompt()

        return base_prompt

    def _build_proactive_prompt(self, has_like: bool, has_active: bool) -> str:
        """Build proactive mode instructions."""
        prompt = "\n\n## GradientFlow Participation Guide\n"
        prompt += "You are observing the GradientFlow chat. Decide whether to participate:\n\n"

        prompt += "**Message Direction Markers:**\n"
        prompt += "- [TO: YOU] = Message is for you, you should reply\n"
        prompt += "- [TO: @OtherAgent, not you] = Message is for another AI, do NOT respond!\n"
        prompt += "- [TO: everyone] = Message is for everyone, you may choose to participate\n\n"

        prompt += "**Available Actions:**\n"
        if has_active:
            prompt += "1. **Reply** - If you can provide valuable help or answer questions\n"
        if has_like:
            prompt += "2. **React** - Use [REACT:emoji:message_id] to react (👍 ❤️ 😂 🎉)\n"
        prompt += "3. **Skip** - Output [SKIP] to not participate\n\n"

        prompt += "**Decision Criteria:**\n"
        prompt += "- ✅ [TO: YOU] messages → Must reply\n"
        prompt += "- ❌ [TO: @OtherAgent, not you] → Must [SKIP], not your question!\n"
        prompt += "- ✅ [TO: everyone] with questions → May reply\n"
        prompt += "- ✅ Interesting/great/thankful content → React\n"
        prompt += "- ❌ Small talk/irrelevant/already answered → [SKIP]\n\n"

        prompt += "**Important:** If marked [TO: @OtherAgent, not you], you must NOT reply!\n"

        if has_like:
            prompt += "\nReaction format: [REACT:emoji:message_id], copy the full message_id from [msg:xxx] prefix"

        return prompt

    def _build_reaction_prompt(self) -> str:
        """Build reaction tool instructions for passive mode (using unified definition)."""
        return build_reaction_text_prompt()

    def _build_tools_prompt(self) -> str:
        """Build context tools documentation (using unified definitions)."""
        enabled_tools = (
            self.agent_config.get("tools", []) if self.agent_config else []
        )
        print(f"[Agent] Enabled tools (text): {enabled_tools}")
        return build_tools_text_prompt(enabled_tools, has_like_capability=False)

    def _build_mcp_prompt(self) -> str:
        """Build MCP tools documentation (using unified definitions)."""
        mcp_config = (
            self.agent_config.get("mcp", {}) if self.agent_config else {}
        )
        return build_mcp_text_prompt(mcp_config)

    # =========================================================================
    # Tool Execution
    # =========================================================================

    def _parse_harmony_tool_calls(self, response: str) -> Tuple[List[Dict], str]:
        """
        Parse tool calls from harmony format response.

        Returns:
            Tuple of (tool_calls_list, final_text)
        """
        parsed = parse_harmony_response(response)
        tool_calls = []

        # Convert harmony function calls to our internal format
        for fc in parsed.function_calls:
            func_name = fc["name"]
            args = fc["arguments"]

            # Map function names to tool types
            if func_name == "get_context":
                msg_id = args.get("message_id", "")
                if msg_id:
                    tool_calls.append({"type": "get_context", "args": msg_id})
            elif func_name == "get_long_context":
                tool_calls.append({"type": "get_long_context", "args": None})
            elif func_name == "web_search":
                query = args.get("query", "")
                if query:
                    tool_calls.append({"type": "web_search", "args": query})
            elif func_name == "local_rag":
                query = args.get("query", "")
                if query:
                    tool_calls.append({"type": "local_rag", "args": query})
            elif func_name == "react":
                emoji = args.get("emoji", "")
                msg_id = args.get("message_id", "")
                if emoji and msg_id:
                    tool_calls.append({"type": "react", "args": {"emoji": emoji, "message_id": msg_id}})
            elif func_name.startswith("mcp_"):
                # MCP tool: mcp_toolname -> toolname
                mcp_tool_name = func_name[4:]
                tool_calls.append({"type": "mcp", "tool": mcp_tool_name, "args": args})

        final_text = parsed.final_answer or ""
        # If the model emitted tool calls, ignore any final text in the same turn
        # to avoid returning a premature answer before tool results are processed.
        if tool_calls:
            final_text = ""
        return tool_calls, final_text

    def _execute_harmony_tool_calls(
        self, tool_calls: List[Dict], current_msg: Dict
    ) -> List[Tuple[str, str]]:
        """
        Execute tool calls and return results.

        Returns:
            List of (tool_name, result_text) tuples
        """
        results = []
        executed_mcp_calls = set()

        for call in tool_calls:
            tool_type = call.get("type")
            args = call.get("args")

            if tool_type == "react":
                # Execute reaction immediately
                emoji = args.get("emoji", "")
                msg_id = args.get("message_id", "")
                # Strip "msg:" prefix if present (LLM outputs [msg:xxx] format)
                if msg_id.startswith("msg:"):
                    msg_id = msg_id[4:]
                # Convert text emoji names to actual emoji
                emoji_map = {
                    "thumbs_up": "👍", "heart": "❤️", "fire": "🔥",
                    "clap": "👏", "laughing": "😂", "celebration": "🎉",
                    "thinking": "🤔", "sad": "😢", "angry": "😠",
                }
                actual_emoji = emoji_map.get(emoji.lower(), emoji)
                print(f"[Agent] Executing harmony tool: react({actual_emoji}, {msg_id})")
                self.add_reaction(msg_id, actual_emoji)
                # Don't add to results - reactions are fire-and-forget

            elif tool_type == "get_context":
                print(f"[Agent] Executing harmony tool: get_context({args})")
                ctx = self.tools.get_context(args)
                if ctx:
                    result = self.tools.compress_context(
                        ctx.get("messages", []), ctx.get("users", [])
                    )
                    results.append(("get_context", result))

            elif tool_type == "get_long_context":
                print(f"[Agent] Executing harmony tool: get_long_context()")
                ctx = self.tools.get_long_context()
                if ctx:
                    result = self.tools.compress_context(
                        ctx.get("messages", []), ctx.get("users", [])
                    )
                    results.append(("get_long_context", result))

            elif tool_type == "web_search":
                print(f"[Agent] Executing harmony tool: web_search({args})")
                search_result = self.tools.web_search(args, max_results=3)
                if search_result:
                    result = self.tools.format_search_results(search_result)
                    results.append(("web_search", result))

            elif tool_type == "local_rag":
                print(f"[Agent] Executing harmony tool: local_rag({args})")
                rag_result = self.tools.local_rag(args)
                if rag_result:
                    result = self.tools.format_rag_results(rag_result)
                    results.append(("local_rag", result))

            elif tool_type == "mcp":
                tool_name = call.get("tool", "unknown")
                mcp_args = call.get("args", {})
                mcp_config = self.agent_config.get("mcp", {}) if self.agent_config else {}
                if mcp_config.get("url"):
                    dedup_key = (tool_name, json.dumps(mcp_args, sort_keys=True))
                    if dedup_key in executed_mcp_calls:
                        print(f"[Agent] Skipping duplicate harmony MCP call: {tool_name}({mcp_args})")
                        continue
                    executed_mcp_calls.add(dedup_key)

                    print(f"[Agent] Executing harmony MCP tool: {tool_name}({mcp_args})")
                    mcp_result = self.tools.execute_mcp_tool(mcp_config, tool_name, mcp_args)
                    if mcp_result is not None:
                        result = self.tools.format_mcp_result(tool_name, mcp_result)
                        results.append((f"mcp_{tool_name}", result))
                    else:
                        # Include error message so LLM knows the tool failed
                        results.append((f"mcp_{tool_name}", f"[Error] Tool '{tool_name}' execution failed. Please inform the user."))

        return results

    def parse_and_execute_tools(
        self, response: str, current_msg: Dict
    ) -> Tuple[bool, str, Optional[Dict]]:
        """
        Parse and execute tool calls in response.

        Returns:
            Tuple of (only_tools, cleaned_text, context_data)
        """
        context_data = None

        # Execute reaction tools (standard format)
        matches = RE_REACT_TOOL.findall(response)
        for emoji, msg_id in matches:
            msg_id = msg_id.strip()
            # Strip "msg:" prefix if present (LLM outputs [msg:xxx] format)
            if msg_id.startswith("msg:"):
                msg_id = msg_id[4:]
            print(f"[Agent] Executing tool: add_reaction({emoji.strip()}, {msg_id})")
            self.add_reaction(msg_id, emoji.strip())

        # Parse context tools
        tool_calls = parse_tool_calls(response)
        tool_results = []

        # Handle GET_CONTEXT calls
        for msg_id in tool_calls.get("get_context", []):
            print(f"[Agent] Executing tool: get_context({msg_id})")
            ctx = self.tools.get_context(msg_id)
            if ctx:
                context_data = ctx
                tool_results.append(
                    (
                        "get_context",
                        self.tools.compress_context(
                            ctx.get("messages", []), ctx.get("users", [])
                        ),
                    )
                )

        # Handle GET_LONG_CONTEXT calls
        if tool_calls.get("get_long_context"):
            print(f"[Agent] Executing tool: get_long_context()")
            ctx = self.tools.get_long_context()
            if ctx:
                context_data = ctx
                tool_results.append(
                    (
                        "get_long_context",
                        self.tools.compress_context(
                            ctx.get("messages", []), ctx.get("users", [])
                        ),
                    )
                )

        # Handle WEB_SEARCH calls (first unique only)
        web_search_queries = tool_calls.get("web_search", [])
        if web_search_queries:
            query = web_search_queries[0]
            print(f"[Agent] Executing tool: web_search({query})")
            if len(web_search_queries) > 1:
                print(f"[Agent] Ignoring {len(web_search_queries) - 1} duplicate searches")
            search_result = self.tools.web_search(query, max_results=3)
            if search_result:
                tool_results.append(
                    ("web_search", self.tools.format_search_results(search_result))
                )

        # Handle LOCAL_RAG calls (first unique only)
        local_rag_queries = tool_calls.get("local_rag", [])
        if local_rag_queries:
            query = local_rag_queries[0]
            print(f"[Agent] Executing tool: local_rag({query})")
            if len(local_rag_queries) > 1:
                print(f"[Agent] Ignoring {len(local_rag_queries) - 1} duplicate RAG calls")
            rag_result = self.tools.local_rag(query)
            if rag_result:
                tool_results.append(
                    ("local_rag", self.tools.format_rag_results(rag_result))
                )

        # Handle MCP tool calls
        mcp_config = (
            self.agent_config.get("mcp", {}) if self.agent_config else {}
        )
        mcp_calls = tool_calls.get("mcp", [])
        if mcp_calls and mcp_config.get("url"):
            executed_tools = set()
            for mcp_call in mcp_calls:
                tool_name = mcp_call.get("tool", "unknown")
                args = mcp_call.get("args", {})

                if tool_name in executed_tools:
                    print(f"[Agent] Skipping duplicate MCP call: {tool_name}")
                    continue
                executed_tools.add(tool_name)

                print(f"[Agent] Executing MCP tool: {tool_name}({args})")
                mcp_result = self.tools.execute_mcp_tool(mcp_config, tool_name, args)
                if mcp_result is not None:
                    tool_results.append(
                        (
                            f"mcp:{tool_name}",
                            self.tools.format_mcp_result(tool_name, mcp_result),
                        )
                    )

        # Clean response
        cleaned = RE_REACT_TOOL.sub("", response)
        cleaned = remove_tool_calls(cleaned).strip()

        # Create context_data for tool results
        if tool_results and not context_data:
            context_data = {"tool_results": tool_results}

        # Force another round if we have tool calls with results
        has_tool_calls = bool(
            tool_calls.get("web_search")
            or tool_calls.get("local_rag")
            or tool_calls.get("get_context")
            or tool_calls.get("get_long_context")
            or tool_calls.get("mcp")
        )

        if has_tool_calls and tool_results:
            print(f"[Agent] Tool calls detected with results, forcing second round")
            return True, "", context_data
        elif has_tool_calls and not tool_results:
            print(f"[Agent] Warning: tool calls failed, using raw model output")

        return len(cleaned) == 0, cleaned, context_data

    # =========================================================================
    # Response Generation (Abstract Method Implementation)
    # =========================================================================

    def generate_reply(
        self,
        context: List[Dict],
        current_msg: Dict,
        mode: str = "passive",
        max_tool_rounds: int = 2,
        users: List[Dict] = None,
    ) -> Tuple[bool, str]:
        """
        Generate reply using core.llm_client.

        Supports:
        - Multi-round tool execution
        - GPT-OSS Harmony format (when enabled)
        """
        if self._use_harmony_format:
            return self._generate_harmony_reply(context, current_msg, mode, max_tool_rounds, users)

        return self._generate_standard_reply(context, current_msg, mode, max_tool_rounds, users)

    def _generate_harmony_reply(
        self,
        context: List[Dict],
        current_msg: Dict,
        mode: str = "passive",
        max_tool_rounds: int = 2,
        users: List[Dict] = None,
    ) -> Tuple[bool, str]:
        """Generate reply using GPT-OSS harmony format."""
        system_prompt = {
            "role": "system",
            "content": self.build_system_prompt(mode=mode, users=users),
        }
        messages = [system_prompt] + context

        # Get model config
        model_config = (
            self.agent_config.get("model", {}) if self.agent_config else {}
        )
        model_name = model_config.get("name", "default")
        temperature = model_config.get("temperature", 0.6)
        max_tokens = model_config.get("maxTokens", 1024)

        tool_round = 0
        only_tools = False
        final_text = ""

        while tool_round < max_tool_rounds:
            tool_round += 1

            # Log prompt
            agent_name = (
                self.agent_config.get("name", self.agent_id)
                if self.agent_config
                else self.agent_id
            )
            print(f"\n[{agent_name}] ===== Harmony LLM Prompt (Round {tool_round}) =====")
            print(f"[{agent_name}] Model: {model_name}, Temp: {temperature}")
            for i, msg in enumerate(messages):
                role = msg.get("role", "unknown")
                content = msg.get("content", "")
                print(f"[{i}] {role}: {log_text(content)}")
            print(f"[{agent_name}] ===== End Prompt =====\n")

            try:
                response = chat_with_history(
                    messages,
                    model=model_name,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )

                print(f"\n[{agent_name}] ===== Raw Harmony Response =====")
                print(response)
                print(f"[{agent_name}] ===== End Response =====\n")

                # Parse harmony response
                tool_calls, final_text = self._parse_harmony_tool_calls(response)

                # Execute tool calls FIRST (before checking skip)
                # This ensures reactions are executed even when [SKIP] is present
                tool_results = []
                if tool_calls:
                    tool_results = self._execute_harmony_tool_calls(tool_calls, current_msg)
                    print(f"[{agent_name}] Executed {len(tool_calls)} tool calls ({len(tool_results)} with results)")

                # Check for skip signal (after executing tools)
                if "[SKIP]" in response or not response.strip():
                    print(f"[{agent_name}] Only tool actions, no text reply")
                    return True, ""

                # If we have tool results and more rounds available, continue
                if tool_results and tool_round < max_tool_rounds:
                    print(f"[{agent_name}] Tool returned data, round {tool_round + 1}...")

                    # Build tool results as plain text (separate from chat history)
                    tool_results_text = []
                    for tool_name, result in tool_results:
                        tool_results_text.append(f"**{tool_name}**:\n{result}")
                    formatted_results = "\n\n".join(tool_results_text)

                    # Create a single user message with tool results
                    # Keep tool results separate from chat history (OpenAI style)
                    tool_context_message = f"""[Tool Results]
{formatted_results}

Now provide your response based on the tool results above."""

                    messages.append({
                        "role": "user",
                        "content": tool_context_message,
                    })
                    continue

                # No more tools or max rounds reached
                # Clean the response if we don't have a final_text
                if not final_text:
                    final_text = clean_harmony_response(response)

                # Check if only reactions were executed
                only_tools = len(final_text.strip()) == 0

                return only_tools, final_text

            except Exception as e:
                print(f"[Agent] Harmony LLM call failed: {e}")
                import traceback
                traceback.print_exc()
                return False, f"Sorry, I encountered an issue: {str(e)}"

        print(f"[Agent] Max tool rounds reached ({max_tool_rounds})")
        return only_tools, final_text

    def _generate_standard_reply(
        self,
        context: List[Dict],
        current_msg: Dict,
        mode: str = "passive",
        max_tool_rounds: int = 2,
        users: List[Dict] = None,
    ) -> Tuple[bool, str]:
        """Generate reply using standard format."""
        system_prompt = {
            "role": "system",
            "content": self.build_system_prompt(mode=mode, users=users),
        }
        messages = [system_prompt] + context

        # Get model config
        model_config = (
            self.agent_config.get("model", {}) if self.agent_config else {}
        )
        model_name = model_config.get("name", "default")
        temperature = model_config.get("temperature", 0.6)
        max_tokens = model_config.get("maxTokens", 1024)

        tool_round = 0
        only_tools = False
        final_text = ""

        while tool_round < max_tool_rounds:
            tool_round += 1

            # Log prompt
            agent_name = (
                self.agent_config.get("name", self.agent_id)
                if self.agent_config
                else self.agent_id
            )
            print(f"\n[{agent_name}] ===== LLM Prompt (Round {tool_round}) =====")
            print(f"[{agent_name}] Model: {model_name}, Temp: {temperature}")
            for i, msg in enumerate(messages):
                role = msg.get("role", "unknown")
                content = msg.get("content", "")
                print(f"[{i}] {role}: {log_text(content)}")
            print(f"[{agent_name}] ===== End Prompt =====\n")

            try:
                response = chat_with_history(
                    messages,
                    model=model_name,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )

                print(f"\n[{agent_name}] ===== Raw Response =====")
                print(response)
                print(f"[{agent_name}] ===== End Response =====\n")

                # Parse and execute tools
                only_tools, final_text, context_data = self.parse_and_execute_tools(
                    response, current_msg
                )

                # Clean response
                cleaned = strip_special_tags(response)
                cleaned = remove_tool_calls(cleaned).strip()
                print(f"[{agent_name}] Cleaned: {log_text(cleaned)}")

                if not context_data:
                    final_text = cleaned
                    only_tools = len(final_text) == 0

                # If tools used, do another round with results
                if context_data and tool_round < max_tool_rounds:
                    print(
                        f"[{agent_name}] Tool returned data, round {tool_round + 1}..."
                    )

                    tool_results = context_data.get("tool_results", [])
                    if tool_results:
                        results_text = []
                        for tool_name, result in tool_results:
                            results_text.append(f"**[{tool_name}]**:\n{result}")
                        tool_output = "\n\n".join(results_text)
                    else:
                        tool_output = self.tools.compress_context(
                            context_data.get("messages", []),
                            context_data.get("users", []),
                        )

                    messages.append(
                        {
                            "role": "assistant",
                            "content": f"[Used tools]\n{cleaned}",
                        }
                    )
                    messages.append(
                        {
                            "role": "user",
                            "content": f"[Tool results]:\n{tool_output}\n\nNow please provide your response based on this information.",
                        }
                    )
                    continue

                return only_tools, final_text

            except Exception as e:
                print(f"[Agent] LLM call failed: {e}")
                return False, f"Sorry, I encountered an issue: {str(e)}"

        print(f"[Agent] Max tool rounds reached ({max_tool_rounds})")
        return only_tools, final_text


# =============================================================================
# Main Entry Point
# =============================================================================

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

    if service.login(args.email, args.password):
        config = service.fetch_agent_config()
        if config:
            print(f"[Agent] Loaded config:")
            print(f"  - Name: {config.get('name')}")
            print(f"  - Provider: {config.get('model', {}).get('provider')}")
            print(f"  - Model: {config.get('model', {}).get('name')}")
            caps = config.get("capabilities", {})
            mode = "proactive" if caps.get("answer_active") else "passive"
            print(f"  - Mode: {mode}")
            print(f"  - Harmony Format: {service._use_harmony_format}")
            print(f"  - System Prompt: {log_text(config.get('systemPrompt', ''))}")
        else:
            print("[Agent] Warning: Could not load agent config, using defaults")
        service.run()
    else:
        print("[Agent] Cannot start: login failed")
