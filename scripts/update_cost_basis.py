"""
Interactive script to populate cost basis for manual holdings.
Prompts for the average cost basis of each holding that has none set.
Run: python -m scripts.update_cost_basis
"""
import asyncio
from backend.services.supabase import get_service_client


async def update():
    db = get_service_client()

    # Get all holdings without cost basis
    result = await db.select(
        table="holdings",
        columns="id,ticker,current_price,avg_cost_basis",
    )

    if result["status_code"] != 200:
        print(f"Failed to fetch holdings: {result}")
        return

    holdings = result["data"]
    needs_update = [h for h in holdings if not h.get("avg_cost_basis")]

    if not needs_update:
        print("All holdings already have cost basis set.")
        return

    print(f"Found {len(needs_update)} holdings without cost basis.")
    print()

    # Ask user for each one
    for h in needs_update:
        ticker = h["ticker"]
        price = h.get("current_price", 0)
        print(f"{ticker} — Current price: ${price}")
        user_input = input(f"  Enter your average cost basis for {ticker} (or press Enter to skip): ").strip()

        if not user_input:
            print(f"  Skipped {ticker}")
            continue

        try:
            cost = float(user_input.replace("$", "").replace(",", ""))
        except ValueError:
            print(f"  Invalid number, skipping {ticker}")
            continue

        # Update in database
        update_result = await db.update(
            table="holdings",
            data={"avg_cost_basis": cost},
            filters={"id": f"eq.{h['id']}"},
        )

        if update_result["status_code"] in (200, 204):
            pct = ((price - cost) / cost * 100) if cost > 0 else 0
            print(f"  Updated {ticker}: cost ${cost:.2f}, unrealized {pct:+.1f}%")
        else:
            print(f"  Failed to update {ticker}: {update_result}")

    print()
    print("Done! Refresh your dashboard to see P/L data.")


asyncio.run(update())
