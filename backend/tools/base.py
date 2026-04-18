"""
SignalStack — Tool Base Infrastructure

Shared error types, retry logic, and validation used by all tool providers.
Carries forward the 4-category error pattern from the v1 bot (errors.py)
adapted for the async MCP server architecture.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional, Literal
from pydantic import BaseModel

logger = logging.getLogger("tools")


# ============================================================================
# STRUCTURED ERROR RESPONSES (4 categories from v1)
# ============================================================================

@dataclass
class ToolError:
    """Structured error for tool failures. Same 4 categories as v1."""
    category: Literal["transient", "validation", "business", "permission"]
    message: str
    is_retryable: bool
    tool_name: str
    details: Optional[dict] = None

    def to_dict(self) -> dict:
        result = {
            "ok": False,
            "error": self.category,
            "message": self.message,
            "isRetryable": self.is_retryable,
            "tool": self.tool_name,
        }
        if self.details:
            result["details"] = self.details
        return result


def transient_error(tool_name: str, message: str, details: Optional[dict] = None) -> ToolError:
    """Rate limits, timeouts, temporary API failures. Always retryable."""
    return ToolError("transient", message, True, tool_name, details)

def validation_error(tool_name: str, message: str, details: Optional[dict] = None) -> ToolError:
    """Bad input. NOT retryable with same input."""
    return ToolError("validation", message, False, tool_name, details)

def business_error(tool_name: str, message: str, details: Optional[dict] = None) -> ToolError:
    """Valid operation, no useful result. NOT retryable as-is."""
    return ToolError("business", message, False, tool_name, details)

def permission_error(tool_name: str, message: str, details: Optional[dict] = None) -> ToolError:
    """Auth failure, tier gating, policy block."""
    return ToolError("permission", message, False, tool_name, details)


# ============================================================================
# TOOL RESULT WRAPPER
# ============================================================================

@dataclass
class ToolResult:
    """Successful tool result."""
    ok: bool = True
    data: dict = field(default_factory=dict)
    tool_name: str = ""

    def to_dict(self) -> dict:
        return {"ok": True, "data": self.data, "tool": self.tool_name}


# ============================================================================
# RETRY WITH EXPONENTIAL BACKOFF
# ============================================================================

async def retry_with_backoff(
    func,
    max_retries: int = 3,
    base_delay: float = 5.0,
    max_delay: float = 30.0,
    tool_name: str = "",
):
    """Execute an async function with exponential backoff on transient failures.
    
    Args:
        func: Async callable that returns (status_code, data) or raises
        max_retries: Maximum retry attempts
        base_delay: Initial delay in seconds
        max_delay: Maximum delay cap
        tool_name: For error reporting
        
    Returns:
        The function's return value on success
        
    Raises:
        Last exception if all retries exhausted
    """
    last_error = None

    for attempt in range(max_retries + 1):
        try:
            result = await func()

            # Check for rate limit response
            if isinstance(result, dict) and result.get("status_code") == 429:
                if attempt < max_retries:
                    delay = min(base_delay * (2 ** attempt), max_delay)
                    logger.warning(f"{tool_name}: Rate limited, retrying in {delay}s (attempt {attempt + 1}/{max_retries})")
                    await asyncio.sleep(delay)
                    continue
                else:
                    return result

            return result

        except Exception as e:
            last_error = e
            if attempt < max_retries:
                delay = min(base_delay * (2 ** attempt), max_delay)
                logger.warning(f"{tool_name}: Error '{e}', retrying in {delay}s (attempt {attempt + 1}/{max_retries})")
                await asyncio.sleep(delay)
            else:
                raise

    raise last_error


# ============================================================================
# HTTP STATUS CLASSIFIER
# ============================================================================

def classify_http_error(tool_name: str, status_code: int, body: str = "") -> ToolError:
    """Classify an HTTP error into the correct 4-category error."""
    if status_code == 429:
        return transient_error(tool_name, f"Rate limited (429): {body[:200]}")
    elif status_code in (408, 502, 503, 504):
        return transient_error(tool_name, f"Temporary server error ({status_code}): {body[:200]}")
    elif status_code == 401:
        return permission_error(tool_name, f"Authentication failed (401): {body[:200]}")
    elif status_code == 403:
        return permission_error(tool_name, f"Access denied (403): {body[:200]}")
    elif status_code == 404:
        return validation_error(tool_name, f"Not found (404): {body[:200]}")
    elif status_code == 400:
        return validation_error(tool_name, f"Bad request (400): {body[:200]}")
    else:
        return transient_error(tool_name, f"HTTP error ({status_code}): {body[:200]}")
