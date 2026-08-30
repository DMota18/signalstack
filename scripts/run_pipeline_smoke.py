"""Manual smoke check — fires the intelligence pipeline against your real holdings.

Hits the live Supabase project and the Claude API (incurs real cost).
Run deliberately: python -m scripts.run_pipeline_smoke
"""
import asyncio
from backend.services.pipeline import generate_intelligence
from backend.services.supabase import get_service_client


async def test():
    db = get_service_client()
    result = await db.select(table="profiles", columns="id,display_name", limit=1)
    print("User:", result["data"])
    user_id = result["data"][0]["id"]

    print("Running intelligence pipeline...")
    print("This will take 30-60 seconds...")
    result = await generate_intelligence(user_id, "on_demand", "test")
    print("Done!")
    print("Duration:", result.get("duration_ms"), "ms")
    print("Tokens:", result.get("tokens_used"))
    print("Agent results:", result.get("agent_results"))
    print()

    synthesis = result.get("synthesis", {})
    for h in synthesis.get("per_holding_intelligence", []):
        ticker = h.get("ticker", "?")
        signal = h.get("net_signal", "?")
        narrative = h.get("narrative", "")[:200]
        print(f"{ticker}: {signal}")
        print(f"  {narrative}")
        print()

    for insight in synthesis.get("portfolio_level_insights", []):
        print("Insight:", insight[:200])


asyncio.run(test())
