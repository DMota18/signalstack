"""
SignalStack — Tool Registry

Central registry that aggregates tool schemas and executors from all
MCP providers. Used by the agentic loop to:
  1. Get tool definitions (schemas) for Claude's tool_use
  2. Dispatch tool calls to the correct executor
  3. Filter tools per subagent (4-5 tools max per agent)

Provider modules:
  - finnhub:    get_price_data, get_news_sentiment, get_insider_trades, get_company_profile
  - fred:       get_fred_data, get_economic_calendar
  - coingecko:  get_crypto_data
  - polymarket: search_polymarket_markets, get_market_prices, get_market_volume, match_holdings_to_markets
  - sec_edgar:  get_institutional_holders, get_13f_fund_positions
"""

import logging

from backend.tools.coingecko import COINGECKO_TOOL_EXECUTORS, COINGECKO_TOOL_SCHEMAS
from backend.tools.finnhub import FINNHUB_TOOL_EXECUTORS, FINNHUB_TOOL_SCHEMAS
from backend.tools.fred import FRED_TOOL_EXECUTORS, FRED_TOOL_SCHEMAS
from backend.tools.polymarket import POLYMARKET_TOOL_EXECUTORS, POLYMARKET_TOOL_SCHEMAS
from backend.tools.sec_edgar import SEC_EDGAR_TOOL_EXECUTORS, SEC_EDGAR_TOOL_SCHEMAS

logger = logging.getLogger("tools.registry")


# ============================================================================
# AGGREGATE ALL SCHEMAS AND EXECUTORS
# ============================================================================

ALL_TOOL_SCHEMAS = (
    FINNHUB_TOOL_SCHEMAS
    + FRED_TOOL_SCHEMAS
    + COINGECKO_TOOL_SCHEMAS
    + POLYMARKET_TOOL_SCHEMAS
    + SEC_EDGAR_TOOL_SCHEMAS
)

ALL_TOOL_EXECUTORS = {
    **FINNHUB_TOOL_EXECUTORS,
    **FRED_TOOL_EXECUTORS,
    **COINGECKO_TOOL_EXECUTORS,
    **POLYMARKET_TOOL_EXECUTORS,
    **SEC_EDGAR_TOOL_EXECUTORS,
}


# ============================================================================
# SUBAGENT TOOL SCOPING (Domain 1.2 — 4-5 tools per agent max)
# ============================================================================

SUBAGENT_TOOLS = {
    "sentiment": [
        "get_news_sentiment",
        "get_price_data",
        "get_company_profile",
    ],
    "polymarket": [
        "search_polymarket_markets",
        "get_market_prices",
        "get_market_volume",
        "match_holdings_to_markets",
    ],
    "insider": [
        "get_insider_trades",
        "get_company_profile",
    ],
    "institutional": [
        "get_institutional_holders",
        "get_13f_fund_positions",
    ],
    "macro": [
        "get_fred_data",
        "get_economic_calendar",
    ],
    "profile": [
        "get_price_data",
        "get_crypto_data",
        "get_company_profile",
    ],
}


def get_schemas_for_agent(agent_name: str) -> list[dict]:
    """Get tool schemas filtered for a specific subagent.

    Args:
        agent_name: One of: sentiment, polymarket, insider, institutional, macro, profile

    Returns:
        List of tool schema dicts for Claude's tool_use parameter
    """
    tool_names = SUBAGENT_TOOLS.get(agent_name, [])
    return [s for s in ALL_TOOL_SCHEMAS if s["name"] in tool_names]


def get_all_schemas() -> list[dict]:
    """Get all tool schemas (for the coordinator or unrestricted agents)."""
    return ALL_TOOL_SCHEMAS


async def execute_tool(tool_name: str, tool_input: dict) -> dict:
    """Dispatch a tool call to the correct executor.

    Args:
        tool_name: The tool to execute
        tool_input: Input parameters from Claude's tool_use

    Returns:
        Tool result dict (either ToolResult.to_dict() or ToolError.to_dict())
    """
    executor = ALL_TOOL_EXECUTORS.get(tool_name)

    if not executor:
        logger.warning(f"Unknown tool: {tool_name}")
        return {
            "ok": False,
            "error": "validation",
            "message": f"Unknown tool: '{tool_name}'. Available tools: {list(ALL_TOOL_EXECUTORS.keys())}",
            "isRetryable": False,
            "tool": tool_name,
        }

    try:
        # Extract kwargs from tool_input that match the function signature
        result = await executor(**tool_input)
        return result
    except TypeError as e:
        # Wrong arguments passed
        logger.error(f"Tool {tool_name} argument error: {e}")
        return {
            "ok": False,
            "error": "validation",
            "message": f"Invalid arguments for tool '{tool_name}': {e}",
            "isRetryable": False,
            "tool": tool_name,
        }
    except Exception as e:
        logger.error(f"Tool {tool_name} execution error: {e}")
        return {
            "ok": False,
            "error": "transient",
            "message": f"Tool '{tool_name}' failed: {e}",
            "isRetryable": True,
            "tool": tool_name,
        }
