"""
SignalStack — Fear & Greed Index Tool

Provider: Alternative.me (free, no key needed)
Rate limit: Reasonable usage (no formal limit)

Tools:
  get_fear_greed — Current market Fear & Greed index (0-100)
"""

import httpx
import logging
from backend.tools.base import ToolResult, transient_error

logger = logging.getLogger("tools.fear_greed")

FEAR_GREED_URL = "https://api.alternative.me/fng/"


async def get_fear_greed(limit: int = 7) -> dict:
    """Fetch the Fear & Greed Index from Alternative.me.

    Returns current value + recent history.
    Scale: 0 = Extreme Fear, 50 = Neutral, 100 = Extreme Greed.
    """
    tool_name = "get_fear_greed"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(FEAR_GREED_URL, params={"limit": min(limit, 30)})

        if resp.status_code != 200:
            return transient_error(tool_name, f"Fear & Greed API error ({resp.status_code})").to_dict()

        data = resp.json()
        entries = data.get("data", [])

        if not entries:
            return transient_error(tool_name, "No Fear & Greed data returned").to_dict()

        current = entries[0]
        value = int(current.get("value", 50))

        # Classify
        if value <= 20: classification = "Extreme Fear"
        elif value <= 40: classification = "Fear"
        elif value <= 60: classification = "Neutral"
        elif value <= 80: classification = "Greed"
        else: classification = "Extreme Greed"

        history = [
            {
                "value": int(e.get("value", 0)),
                "classification": e.get("value_classification", ""),
                "timestamp": e.get("timestamp", ""),
            }
            for e in entries
        ]

        return ToolResult(
            ok=True,
            tool_name=tool_name,
            data={
                "value": value,
                "classification": classification,
                "previous_close": int(entries[1]["value"]) if len(entries) > 1 else None,
                "history": history,
            },
        ).to_dict()

    except Exception as e:
        return transient_error(tool_name, f"Fear & Greed fetch failed: {e}").to_dict()
