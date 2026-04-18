"""
SignalStack — CoinGecko MCP Tool

Provider: CoinGecko (coingecko.com)
Rate limit: 10-30 calls/min (free tier, no key required)
Auth: None required for free tier

Tools:
  get_crypto_data — Crypto price, market cap, volume, 24h change

Note from v1: CoinGecko uses coin IDs, not ticker symbols.
Common mappings: BTC→bitcoin, ETH→ethereum, SOL→solana.
The tool handles the mapping internally.
"""

import httpx
import logging
from typing import Optional

from backend.tools.base import (
    ToolResult, transient_error, validation_error,
    business_error, classify_http_error, retry_with_backoff,
)

logger = logging.getLogger("tools.coingecko")

COINGECKO_BASE = "https://api.coingecko.com/api/v3"

# Ticker → CoinGecko ID mapping for common cryptos
TICKER_TO_ID = {
    "BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana",
    "ADA": "cardano", "DOT": "polkadot", "AVAX": "avalanche-2",
    "MATIC": "matic-network", "LINK": "chainlink", "UNI": "uniswap",
    "ATOM": "cosmos", "XRP": "ripple", "DOGE": "dogecoin",
    "SHIB": "shiba-inu", "LTC": "litecoin", "BNB": "binancecoin",
    "TRX": "tron", "NEAR": "near", "ARB": "arbitrum",
    "OP": "optimism", "APT": "aptos", "SUI": "sui",
    "PEPE": "pepe", "WIF": "dogwifcoin", "BONK": "bonk",
    "FET": "fetch-ai", "RNDR": "render-token", "INJ": "injective-protocol",
    "TON": "the-open-network", "HBAR": "hedera-hashgraph",
}


# ============================================================================
# TOOL: get_crypto_data
# ============================================================================

CRYPTO_DATA_SCHEMA = {
    "name": "get_crypto_data",
    "description": (
        "Get current cryptocurrency price, market cap, 24h volume, and "
        "24h change from CoinGecko. Supports major cryptos by ticker "
        "symbol (BTC, ETH, SOL, etc.) or CoinGecko ID.\n\n"
        "INPUT: ticker (string, e.g. 'BTC', 'ETH', 'SOL') or "
        "coin_id (string, e.g. 'bitcoin', 'ethereum').\n\n"
        "EXAMPLE QUERIES: 'What is Bitcoin trading at?', "
        "'Get me ETH price and volume'\n\n"
        "EDGE CASES: Uses coin IDs internally, not tickers. Common "
        "tickers are auto-mapped. For obscure coins, pass the "
        "CoinGecko ID directly. Free tier has rate limits.\n\n"
        "DO NOT USE FOR: Stock/ETF prices (use get_price_data). "
        "Crypto news. On-chain data. Historical charts."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "ticker": {
                "type": "string",
                "description": "Crypto ticker (BTC, ETH) or CoinGecko ID (bitcoin, ethereum)",
            },
        },
        "required": ["ticker"],
    },
}


async def get_crypto_data(ticker: str) -> dict:
    """Fetch crypto price data from CoinGecko."""
    tool_name = "get_crypto_data"
    ticker = ticker.upper().strip()

    if not ticker:
        return validation_error(tool_name, "Ticker is required").to_dict()

    # Map ticker to CoinGecko ID
    coin_id = TICKER_TO_ID.get(ticker, ticker.lower())

    # Strip common suffixes users might include
    for suffix in ["-USD", "-USDT", "-USDC"]:
        if ticker.endswith(suffix):
            clean = ticker.replace(suffix, "")
            coin_id = TICKER_TO_ID.get(clean, clean.lower())
            break

    async def _call():
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{COINGECKO_BASE}/coins/{coin_id}",
                params={
                    "localization": "false",
                    "tickers": "false",
                    "market_data": "true",
                    "community_data": "false",
                    "developer_data": "false",
                },
            )
            return {"status_code": resp.status_code, "data": resp.json()}

    try:
        result = await retry_with_backoff(_call, max_retries=2, base_delay=10.0, tool_name=tool_name)
    except httpx.TimeoutException:
        return transient_error(tool_name, "CoinGecko request timeout").to_dict()
    except Exception as e:
        return transient_error(tool_name, f"CoinGecko request failed: {e}").to_dict()

    if result.get("status_code") == 404:
        return business_error(
            tool_name,
            f"Coin '{ticker}' (ID: {coin_id}) not found on CoinGecko. "
            f"Try using the CoinGecko ID directly (e.g. 'bitcoin' instead of 'BTC').",
            {"ticker": ticker, "attempted_id": coin_id},
        ).to_dict()

    if result.get("status_code") != 200:
        return classify_http_error(tool_name, result["status_code"]).to_dict()

    data = result["data"]
    market = data.get("market_data", {})

    return ToolResult(
        ok=True,
        tool_name=tool_name,
        data={
            "coin_id": coin_id,
            "ticker": data.get("symbol", ticker).upper(),
            "name": data.get("name", ""),
            "current_price": market.get("current_price", {}).get("usd"),
            "market_cap": market.get("market_cap", {}).get("usd"),
            "total_volume_24h": market.get("total_volume", {}).get("usd"),
            "price_change_24h": market.get("price_change_24h"),
            "price_change_pct_24h": market.get("price_change_percentage_24h"),
            "price_change_pct_7d": market.get("price_change_percentage_7d"),
            "price_change_pct_30d": market.get("price_change_percentage_30d"),
            "ath": market.get("ath", {}).get("usd"),
            "ath_change_pct": market.get("ath_change_percentage", {}).get("usd"),
            "circulating_supply": market.get("circulating_supply"),
            "max_supply": market.get("max_supply"),
        },
    ).to_dict()


# ============================================================================
# SCHEMA REGISTRY
# ============================================================================

COINGECKO_TOOL_SCHEMAS = [CRYPTO_DATA_SCHEMA]

COINGECKO_TOOL_EXECUTORS = {
    "get_crypto_data": get_crypto_data,
}
