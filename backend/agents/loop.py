"""
SignalStack — Agentic Loop (Domain 1.1)

The core lifecycle that drives ALL Claude interactions. Every user
command, scheduled trigger, and subagent invocation flows through
this exact loop. No exceptions.

Loop:
  1. Send request to Claude via Messages API
  2. Inspect response.stop_reason
  3. If stop_reason == "tool_use" → execute the tool, append tool_result, send again
  4. If stop_reason == "end_turn" → return final response
  5. Repeat until end_turn

Three things we NEVER do:
  - Parse natural language to determine when the loop should stop
  - Use arbitrary iteration caps as the primary stopping condition
  - Check response.content[0].type == "text" as a completion signal

The correct termination signal is ALWAYS stop_reason.
"""

import asyncio
import json
import logging

import httpx

from backend.config import get_settings
from backend.services.hooks import (
    post_execution_hook,
    pre_execution_hook,
)
from backend.tools.registry import execute_tool

logger = logging.getLogger("agents.loop")

# Safety backstop — NOT the primary stopping condition
MAX_ITERATIONS = 25


async def run_agent_loop(
    system_prompt: str,
    messages: list[dict],
    tools: list[dict],
    user_context: dict | None = None,
    model: str | None = None,
    max_tokens: int = 4096,
    tool_choice: dict | None = None,
) -> dict:
    """Run the agentic loop until Claude emits stop_reason == 'end_turn'.

    Args:
        system_prompt: System prompt for Claude
        messages: Conversation history (list of role/content dicts)
        tools: Tool definitions (schemas) Claude can use
        user_context: Context for hooks (user_id, tier, has_investor_profile, etc.)
        model: Claude model to use (defaults to config)
        max_tokens: Max tokens per response
        tool_choice: Optional tool_choice override for first iteration

    Returns:
        {
            "text": str,           # Final text response (if any)
            "tool_results": [],    # All tool results collected during the loop
            "iterations": int,     # How many loop iterations ran
            "tokens_used": int,    # Total tokens consumed
            "stop_reason": str,    # Final stop reason
        }
    """
    settings = get_settings()
    model = model or settings.claude_model
    ctx = user_context or {}

    all_tool_results = []
    total_input_tokens = 0
    total_output_tokens = 0
    iteration = 0
    final_text = ""

    while iteration < MAX_ITERATIONS:
        iteration += 1

        # Build the API request
        request_body = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system_prompt,
            "messages": messages,
        }

        if tools:
            request_body["tools"] = tools

        # tool_choice only applies to the first iteration (Domain 1.4)
        if tool_choice and iteration == 1:
            request_body["tool_choice"] = tool_choice

        # Call Claude API
        try:
            response = await _call_claude_api(request_body)
        except Exception as e:
            logger.error(f"Claude API error on iteration {iteration}: {e}")
            return {
                "text": f"Intelligence generation failed: {e}",
                "tool_results": all_tool_results,
                "iterations": iteration,
                "tokens_used": total_input_tokens + total_output_tokens,
                "stop_reason": "error",
            }

        # Track token usage
        usage = response.get("usage", {})
        total_input_tokens += usage.get("input_tokens", 0)
        total_output_tokens += usage.get("output_tokens", 0)

        # === THE CRITICAL CHECK: inspect stop_reason ===
        stop_reason = response.get("stop_reason", "end_turn")
        content_blocks = response.get("content", [])

        if stop_reason == "end_turn":
            # Loop terminates — extract final text
            for block in content_blocks:
                if block.get("type") == "text":
                    final_text += block.get("text", "")

            return {
                "text": final_text,
                "tool_results": all_tool_results,
                "iterations": iteration,
                "tokens_used": total_input_tokens + total_output_tokens,
                "stop_reason": "end_turn",
            }

        elif stop_reason == "tool_use":
            # Process all tool calls in this response
            assistant_content = []
            tool_results_for_message = []

            for block in content_blocks:
                assistant_content.append(block)

                if block.get("type") == "text":
                    final_text += block.get("text", "")

                elif block.get("type") == "tool_use":
                    tool_name = block.get("name", "")
                    tool_input = block.get("input", {})
                    tool_use_id = block.get("id", "")

                    logger.info(f"Tool call [{iteration}]: {tool_name}({json.dumps(tool_input)[:200]})")

                    # Passthrough tools — the input IS the output (e.g. produce_synthesis)
                    if tool_name == "produce_synthesis":
                        raw_result = {"ok": True, "data": tool_input}
                        tool_result_content = json.dumps({"ok": True, "message": "Synthesis accepted."})

                        all_tool_results.append({
                            "tool_name": tool_name,
                            "tool_input": tool_input,
                            "result": raw_result,
                            "iteration": iteration,
                        })

                        tool_results_for_message.append({
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": tool_result_content,
                        })
                        continue

                    # Pre-execution hook (may block the call)
                    pre_result = await pre_execution_hook(tool_name, tool_input, ctx)

                    if not pre_result.allowed:
                        # Tool call blocked by policy
                        logger.info(f"Tool BLOCKED: {tool_name} — {pre_result.block_reason}")
                        raw_result = {
                            "ok": False,
                            "error": "permission",
                            "message": pre_result.block_reason,
                            "isRetryable": False,
                        }
                        tool_result_content = json.dumps(raw_result)
                    else:
                        # Execute the tool
                        modified_input = pre_result.modified_input or tool_input
                        try:
                            raw_result = await execute_tool(tool_name, modified_input)
                        except Exception as e:
                            logger.error(f"Tool execution error: {tool_name} — {e}")
                            raw_result = {
                                "ok": False,
                                "error": "transient",
                                "message": f"Tool execution failed: {e}",
                                "isRetryable": True,
                            }

                        # Post-execution hook (normalize, sanitize, inject compliance)
                        if isinstance(raw_result, dict):
                            raw_result = await post_execution_hook(tool_name, raw_result)

                        tool_result_content = json.dumps(raw_result)

                    # Record the result
                    all_tool_results.append({
                        "tool_name": tool_name,
                        "tool_input": tool_input,
                        "result": raw_result if isinstance(raw_result, dict) else json.loads(tool_result_content),
                        "iteration": iteration,
                    })

                    tool_results_for_message.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": tool_result_content,
                    })

            # Append assistant's response and tool results to conversation
            messages.append({"role": "assistant", "content": assistant_content})
            messages.append({"role": "user", "content": tool_results_for_message})

        else:
            # Unexpected stop_reason — log and return what we have
            logger.warning(f"Unexpected stop_reason: {stop_reason}")
            for block in content_blocks:
                if block.get("type") == "text":
                    final_text += block.get("text", "")

            return {
                "text": final_text,
                "tool_results": all_tool_results,
                "iterations": iteration,
                "tokens_used": total_input_tokens + total_output_tokens,
                "stop_reason": stop_reason,
            }

    # Safety backstop reached — should not happen in normal operation
    logger.error(f"Agent loop hit safety cap ({MAX_ITERATIONS} iterations)")
    return {
        "text": final_text or "Intelligence generation exceeded maximum iterations.",
        "tool_results": all_tool_results,
        "iterations": iteration,
        "tokens_used": total_input_tokens + total_output_tokens,
        "stop_reason": "max_iterations",
    }


async def _call_claude_api(request_body: dict) -> dict:
    """Make a single call to the Claude Messages API with retry on 429."""
    settings = get_settings()

    headers = {
        "x-api-key": settings.anthropic_api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    retries = 5
    for attempt in range(retries):
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers=headers,
                json=request_body,
            )

            if resp.status_code == 200:
                return resp.json()

            if resp.status_code == 429:
                # Rate limited — longer backoff for free tier
                delay = 30 * (2 ** attempt)
                logger.warning(f"Claude API 429, retrying in {delay}s (attempt {attempt + 1}/{retries})")
                await asyncio.sleep(delay)
                continue

            if resp.status_code == 529:
                # Overloaded — back off longer
                delay = 45 * (2 ** attempt)
                logger.warning(f"Claude API 529 (overloaded), retrying in {delay}s")
                await asyncio.sleep(delay)
                continue

            # Non-retryable error
            error_body = resp.text
            logger.error(f"Claude API error {resp.status_code}: {error_body[:500]}")
            raise Exception(f"Claude API error ({resp.status_code}): {error_body[:200]}")

    raise Exception("Claude API: max retries exceeded (429)")
