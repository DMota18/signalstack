"""
SignalStack — Email Delivery Service

Sends emails via Resend API (primary) or SMTP (fallback).
Used for daily digests, weekly reports, and pre-earnings briefings.

The email content is pre-formatted by pipeline.format_for_email() —
this service handles only the transport layer.
"""

import logging
import re

import resend

from backend.config import get_settings
from backend.services.supabase import get_service_client

logger = logging.getLogger("services.email")


def _app_url() -> str:
    """Public origin for links in outbound email — never hardcoded."""
    return get_settings().app_base_url


async def send_email_to_user(
    user_id: str,
    subject: str,
    html_body: str,
    text_body: str | None = None,
) -> dict:
    """Send an email to a user by looking up their email in profiles.

    Args:
        user_id: SignalStack user ID
        subject: Email subject line
        html_body: HTML email content
        text_body: Plain text fallback (auto-generated from HTML if not provided)

    Returns:
        {"sent": bool, "error": str|None}
    """
    settings = get_settings()

    if not settings.resend_api_key:
        # Fallback to SMTP if Resend not configured
        if settings.smtp_host and settings.smtp_user:
            return await _send_via_smtp(user_id, subject, html_body, text_body)
        logger.warning("Email skipped: neither Resend nor SMTP configured")
        return {"sent": False, "error": "Email not configured"}

    # Look up user email
    db = get_service_client()
    result = await db.select(
        table="profiles",
        columns="email,email_enabled,display_name",
        filters={"id": f"eq.{user_id}"},
        single=True,
    )

    if result["status_code"] != 200 or not isinstance(result["data"], dict):
        logger.warning(f"Could not fetch email for user {user_id}")
        return {"sent": False, "error": "User not found"}

    profile = result["data"]
    to_email = profile.get("email")
    email_enabled = profile.get("email_enabled", True)
    display_name = profile.get("display_name", "")

    if not to_email:
        return {"sent": False, "error": "No email address"}

    if not email_enabled:
        logger.debug(f"Email disabled for user {user_id}")
        return {"sent": False, "error": "Email notifications disabled"}

    # Plain text fallback
    if not text_body:
        text_body = _strip_html(html_body)

    # Send via Resend
    try:
        resend.api_key = settings.resend_api_key

        to_addr = f"{display_name} <{to_email}>" if display_name else to_email

        email_resp = resend.Emails.send({
            "from": settings.email_from,
            "to": [to_addr],
            "subject": subject,
            "html": html_body,
            "text": text_body,
        })

        email_id = email_resp.get("id") if isinstance(email_resp, dict) else getattr(email_resp, "id", None)
        logger.info(f"Email sent to {to_email}: {subject} (resend_id={email_id})")
        return {"sent": True, "error": None}

    except Exception as e:
        logger.error(f"Resend email failed for {to_email}: {e}")
        return {"sent": False, "error": str(e)}


async def _send_via_smtp(
    user_id: str,
    subject: str,
    html_body: str,
    text_body: str | None = None,
) -> dict:
    """Legacy SMTP fallback."""
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    settings = get_settings()

    db = get_service_client()
    result = await db.select(
        table="profiles",
        columns="email,email_enabled,display_name",
        filters={"id": f"eq.{user_id}"},
        single=True,
    )

    if result["status_code"] != 200 or not isinstance(result["data"], dict):
        return {"sent": False, "error": "User not found"}

    profile = result["data"]
    to_email = profile.get("email")
    if not to_email or not profile.get("email_enabled", True):
        return {"sent": False, "error": "Email not available or disabled"}

    display_name = profile.get("display_name", "")

    if not text_body:
        text_body = _strip_html(html_body)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.email_from
    msg["To"] = f"{display_name} <{to_email}>" if display_name else to_email
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.ehlo()
            if settings.smtp_port == 587:
                server.starttls()
                server.ehlo()
            server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)

        logger.info(f"Email sent via SMTP to {to_email}: {subject}")
        return {"sent": True, "error": None}

    except Exception as e:
        logger.error(f"SMTP email failed: {e}")
        return {"sent": False, "error": str(e)}


# ============================================================================
# EMAIL TEMPLATES
# ============================================================================

def build_digest_email_html(synthesis: dict, user_name: str = "") -> str:
    """Build a responsive HTML email for the daily digest.

    Args:
        synthesis: The intelligence synthesis from the coordinator
        user_name: Display name for personalization

    Returns:
        Complete HTML email string
    """
    holdings = synthesis.get("per_holding_intelligence", [])
    insights = synthesis.get("portfolio_level_insights", [])

    greeting = f"Hi {user_name}," if user_name else "Hi,"

    # Build per-holding rows
    holding_rows = []
    for h in holdings:
        signal = h.get("net_signal", "neutral")
        signal_label = signal.replace("_", " ").title()
        signal_color = _signal_color(signal)
        ticker = h.get("ticker", "")
        narrative = h.get("narrative", "")

        conflicts_html = ""
        if h.get("conflicts"):
            conflict_items = "".join(f"<li style='color:#6A6A6D;font-size:13px;'>{c}</li>" for c in h["conflicts"])
            conflicts_html = f"<ul style='margin:6px 0 0 16px;padding:0;'>{conflict_items}</ul>"

        holding_rows.append(f"""
        <tr>
          <td style="padding:16px 0;border-bottom:1px solid #1A1A1D;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;font-weight:600;color:#E8E6E1;">
                  {ticker}
                  <span style="font-size:12px;font-weight:400;color:{signal_color};margin-left:8px;">
                    {signal_label}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#8A8A8D;padding-top:6px;line-height:1.5;">
                  {narrative}
                  {conflicts_html}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        """)

    holdings_html = "".join(holding_rows)

    # Build insights section
    insights_html = ""
    if insights:
        insight_items = "".join(
            f"<li style='color:#8A8A8D;font-size:13px;line-height:1.6;margin-bottom:4px;'>{i}</li>"
            for i in insights
            if "educational" not in i.lower() and "not investment advice" not in i.lower()
        )
        if insight_items:
            insights_html = f"""
            <tr>
              <td style="padding:16px 0;">
                <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;font-weight:600;color:#D4A843;margin:0 0 8px;">
                  Portfolio insights
                </p>
                <ul style="margin:0;padding:0 0 0 16px;">{insight_items}</ul>
              </td>
            </tr>
            """

    return f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background-color:#0C0C0E;color:#E8E6E1;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0C0C0E;">
        <tr>
          <td align="center" style="padding:24px 16px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
              <!-- Header -->
              <tr>
                <td style="padding:0 0 20px;">
                  <p style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#D4A843;margin:0;">
                    SignalStack
                  </p>
                </td>
              </tr>
              <!-- Greeting -->
              <tr>
                <td style="padding:0 0 16px;">
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#E8E6E1;margin:0;">
                    {greeting}
                  </p>
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#8A8A8D;margin:6px 0 0;">
                    Here's your daily intelligence for {len(holdings)} holding{"s" if len(holdings) != 1 else ""}.
                  </p>
                </td>
              </tr>
              <!-- Insights -->
              {insights_html}
              <!-- Holdings -->
              <tr>
                <td>
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    {holdings_html}
                  </table>
                </td>
              </tr>
              <!-- CTA -->
              <tr>
                <td style="padding:24px 0;" align="center">
                  <a href="{_app_url()}/app"
                    style="display:inline-block;padding:10px 24px;background-color:#D4A843;color:#0C0C0E;text-decoration:none;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;font-weight:600;">
                    Open dashboard
                  </a>
                </td>
              </tr>
              <!-- Disclaimer -->
              <tr>
                <td style="padding:16px 0;border-top:1px solid #1A1A1D;">
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#4A4A4D;margin:0;line-height:1.5;">
                    Educational market intelligence only. Not investment advice. All investment decisions are your own responsibility.
                  </p>
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#4A4A4D;margin:8px 0 0;">
                    SignalStack &middot; <a href="{_app_url()}/app/settings" style="color:#4A4A4D;">Manage notifications</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    """


def build_price_alert_email_html(
    synthesis: dict,
    trigger_data: dict,
    tickers: list[str],
    user_name: str = "",
) -> str:
    """Build a concise HTML email for price movement alerts.

    Args:
        synthesis: Intelligence synthesis from the coordinator
        trigger_data: Dict of ticker -> {actual_change_pct, threshold_pct, direction, current_price}
        tickers: Ordered list of triggered tickers
        user_name: Display name for personalization

    Returns:
        Complete HTML email string
    """
    holdings = synthesis.get("per_holding_intelligence", [])
    holdings_by_ticker = {h.get("ticker"): h for h in holdings}

    greeting = f"Hi {user_name}," if user_name else "Hi,"

    # Build triggered ticker rows
    ticker_rows = []
    for ticker in tickers:
        td = trigger_data.get(ticker, {})
        change_pct = td.get("actual_change_pct", 0)
        current_price = td.get("current_price")
        direction_arrow = "+" if change_pct > 0 else ""
        change_color = "#34C759" if change_pct > 0 else "#FF453A"

        price_str = f"${current_price:,.2f}" if current_price else ""

        holding = holdings_by_ticker.get(ticker, {})
        narrative = holding.get("narrative", "")
        signal = holding.get("net_signal", "neutral")
        signal_label = signal.replace("_", " ").title()
        signal_color = _signal_color(signal)

        ticker_rows.append(f"""
        <tr>
          <td style="padding:16px 0;border-bottom:1px solid #1A1A1D;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                  <span style="font-size:18px;font-weight:700;color:#E8E6E1;">{ticker}</span>
                  <span style="font-size:18px;font-weight:700;color:{change_color};margin-left:12px;">
                    {direction_arrow}{change_pct:.2f}%
                  </span>
                  <span style="font-size:13px;color:#8A8A8D;margin-left:8px;">{price_str}</span>
                </td>
              </tr>
              <tr>
                <td style="padding-top:4px;">
                  <span style="font-size:11px;color:{signal_color};text-transform:uppercase;letter-spacing:0.5px;">
                    {signal_label}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#8A8A8D;padding-top:8px;line-height:1.5;">
                  {narrative}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        """)

    ticker_html = "".join(ticker_rows)

    return f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background-color:#0C0C0E;color:#E8E6E1;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0C0C0E;">
        <tr>
          <td align="center" style="padding:24px 16px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
              <!-- Header -->
              <tr>
                <td style="padding:0 0 20px;">
                  <p style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#D4A843;margin:0;">
                    SignalStack
                  </p>
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#FF453A;margin:4px 0 0;text-transform:uppercase;letter-spacing:1px;font-weight:600;">
                    Price Alert
                  </p>
                </td>
              </tr>
              <!-- Greeting -->
              <tr>
                <td style="padding:0 0 16px;">
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#E8E6E1;margin:0;">
                    {greeting}
                  </p>
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#8A8A8D;margin:6px 0 0;">
                    {len(tickers)} holding{"s" if len(tickers) != 1 else ""} hit your price alert threshold.
                  </p>
                </td>
              </tr>
              <!-- Triggered Tickers -->
              <tr>
                <td>
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    {ticker_html}
                  </table>
                </td>
              </tr>
              <!-- CTA -->
              <tr>
                <td style="padding:24px 0;" align="center">
                  <a href="{_app_url()}/app"
                    style="display:inline-block;padding:10px 24px;background-color:#D4A843;color:#0C0C0E;text-decoration:none;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;font-weight:600;">
                    View full analysis
                  </a>
                </td>
              </tr>
              <!-- Disclaimer -->
              <tr>
                <td style="padding:16px 0;border-top:1px solid #1A1A1D;">
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#4A4A4D;margin:0;line-height:1.5;">
                    Educational market intelligence only. Not investment advice. All investment decisions are your own responsibility.
                  </p>
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#4A4A4D;margin:8px 0 0;">
                    SignalStack &middot; <a href="{_app_url()}/app/settings" style="color:#4A4A4D;">Manage alerts</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    """


def build_earnings_briefing_email_html(
    synthesis: dict,
    earnings_meta: dict,
    tickers: list[str],
    user_name: str = "",
) -> str:
    """Build a responsive HTML email for pre-earnings briefings.

    Args:
        synthesis: Intelligence synthesis from the coordinator
        earnings_meta: Dict of ticker -> {report_date, report_time, consensus_eps, consensus_revenue}
        tickers: Ordered list of tickers with upcoming earnings
        user_name: Display name for personalization

    Returns:
        Complete HTML email string
    """
    holdings = synthesis.get("per_holding_intelligence", [])
    holdings_by_ticker = {h.get("ticker"): h for h in holdings}

    greeting = f"Hi {user_name}," if user_name else "Hi,"

    # Build per-ticker earnings cards
    ticker_rows = []
    for ticker in tickers:
        meta = earnings_meta.get(ticker, {})
        report_date = meta.get("report_date", "TBD")
        report_time = meta.get("report_time", "Time TBD")
        consensus_eps = meta.get("consensus_eps")
        consensus_revenue = meta.get("consensus_revenue")

        # Format estimates
        estimates_parts = []
        if consensus_eps is not None:
            estimates_parts.append(f"EPS est. ${consensus_eps:.2f}")
        if consensus_revenue is not None:
            rev_str = f"${consensus_revenue / 1_000_000_000:.2f}B" if consensus_revenue >= 1_000_000_000 else f"${consensus_revenue / 1_000_000:.0f}M"
            estimates_parts.append(f"Rev est. {rev_str}")
        estimates_html = " &middot; ".join(estimates_parts) if estimates_parts else "Estimates not available"

        holding = holdings_by_ticker.get(ticker, {})
        narrative = holding.get("narrative", "")
        signal = holding.get("net_signal", "neutral")
        signal_label = signal.replace("_", " ").title()
        signal_color = _signal_color(signal)

        catalysts_html = ""
        if holding.get("upcoming_catalysts"):
            catalyst_items = "".join(
                f"<li style='color:#D4A843;font-size:12px;'>{c}</li>"
                for c in holding["upcoming_catalysts"]
            )
            catalysts_html = (
                f"<p style='font-size:12px;color:#8A8A8D;margin:8px 0 2px;font-weight:600;'>Watch for</p>"
                f"<ul style='margin:0 0 0 16px;padding:0;'>{catalyst_items}</ul>"
            )

        ticker_rows.append(f"""
        <tr>
          <td style="padding:16px 0;border-bottom:1px solid #1A1A1D;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                  <span style="font-size:18px;font-weight:700;color:#E8E6E1;">{ticker}</span>
                  <span style="font-size:12px;color:{signal_color};margin-left:8px;">{signal_label}</span>
                </td>
              </tr>
              <tr>
                <td style="padding-top:6px;">
                  <table cellpadding="0" cellspacing="0" border="0" style="background-color:#141416;border-radius:6px;width:100%;">
                    <tr>
                      <td style="padding:10px 12px;">
                        <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;color:#D4A843;margin:0;font-weight:600;">
                          Reports {report_date} &middot; {report_time}
                        </p>
                        <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;color:#8A8A8D;margin:4px 0 0;">
                          {estimates_html}
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#8A8A8D;padding-top:10px;line-height:1.5;">
                  {narrative}
                  {catalysts_html}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        """)

    ticker_html = "".join(ticker_rows)

    return f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background-color:#0C0C0E;color:#E8E6E1;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0C0C0E;">
        <tr>
          <td align="center" style="padding:24px 16px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
              <!-- Header -->
              <tr>
                <td style="padding:0 0 20px;">
                  <p style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#D4A843;margin:0;">
                    SignalStack
                  </p>
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#D4A843;margin:4px 0 0;text-transform:uppercase;letter-spacing:1px;font-weight:600;">
                    Earnings Preview
                  </p>
                </td>
              </tr>
              <!-- Greeting -->
              <tr>
                <td style="padding:0 0 16px;">
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#E8E6E1;margin:0;">
                    {greeting}
                  </p>
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#8A8A8D;margin:6px 0 0;">
                    {len(tickers)} of your holdings report{"s" if len(tickers) == 1 else ""} earnings soon. Here's what the signals show heading in.
                  </p>
                </td>
              </tr>
              <!-- Ticker Cards -->
              <tr>
                <td>
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    {ticker_html}
                  </table>
                </td>
              </tr>
              <!-- CTA -->
              <tr>
                <td style="padding:24px 0;" align="center">
                  <a href="{_app_url()}/app"
                    style="display:inline-block;padding:10px 24px;background-color:#D4A843;color:#0C0C0E;text-decoration:none;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;font-weight:600;">
                    View full briefing
                  </a>
                </td>
              </tr>
              <!-- Disclaimer -->
              <tr>
                <td style="padding:16px 0;border-top:1px solid #1A1A1D;">
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#4A4A4D;margin:0;line-height:1.5;">
                    Educational market intelligence only. Not investment advice. All investment decisions are your own responsibility.
                  </p>
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#4A4A4D;margin:8px 0 0;">
                    SignalStack &middot; <a href="{_app_url()}/app/settings" style="color:#4A4A4D;">Manage notifications</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    """


def build_weekly_email_html(synthesis: dict, user_name: str = "") -> str:
    """Build a responsive HTML email for the weekly portfolio report.

    Args:
        synthesis: The intelligence synthesis from the coordinator
        user_name: Display name for personalization

    Returns:
        Complete HTML email string
    """
    holdings = synthesis.get("per_holding_intelligence", [])
    insights = synthesis.get("portfolio_level_insights", [])

    greeting = f"Hi {user_name}," if user_name else "Hi,"

    # Signal distribution summary
    signal_counts: dict[str, int] = {}
    for h in holdings:
        sig = h.get("net_signal", "neutral")
        signal_counts[sig] = signal_counts.get(sig, 0) + 1

    summary_items = []
    for sig, count in sorted(signal_counts.items(), key=lambda x: -x[1]):
        label = sig.replace("_", " ").title()
        color = _signal_color(sig)
        summary_items.append(
            f'<span style="color:{color};font-weight:600;">{count}</span>'
            f' <span style="color:#8A8A8D;">{label}</span>'
        )
    signal_summary_html = " &middot; ".join(summary_items) if summary_items else ""

    # Build per-holding rows
    holding_rows = []
    for h in holdings:
        signal = h.get("net_signal", "neutral")
        signal_label = signal.replace("_", " ").title()
        signal_color = _signal_color(signal)
        ticker = h.get("ticker", "")
        narrative = h.get("narrative", "")

        catalysts_html = ""
        if h.get("upcoming_catalysts"):
            catalyst_items = "".join(
                f"<li style='color:#D4A843;font-size:12px;'>{c}</li>"
                for c in h["upcoming_catalysts"]
            )
            catalysts_html = (
                f"<p style='font-size:12px;color:#8A8A8D;margin:6px 0 2px;font-weight:600;'>Upcoming</p>"
                f"<ul style='margin:0 0 0 16px;padding:0;'>{catalyst_items}</ul>"
            )

        conflicts_html = ""
        if h.get("conflicts"):
            conflict_items = "".join(
                f"<li style='color:#6A6A6D;font-size:13px;'>{c}</li>"
                for c in h["conflicts"]
            )
            conflicts_html = f"<ul style='margin:6px 0 0 16px;padding:0;'>{conflict_items}</ul>"

        holding_rows.append(f"""
        <tr>
          <td style="padding:16px 0;border-bottom:1px solid #1A1A1D;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;font-weight:600;color:#E8E6E1;">
                  {ticker}
                  <span style="font-size:12px;font-weight:400;color:{signal_color};margin-left:8px;">
                    {signal_label}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#8A8A8D;padding-top:6px;line-height:1.5;">
                  {narrative}
                  {conflicts_html}
                  {catalysts_html}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        """)

    holdings_html = "".join(holding_rows)

    # Build insights section
    insights_html = ""
    if insights:
        insight_items = "".join(
            f"<li style='color:#8A8A8D;font-size:13px;line-height:1.6;margin-bottom:4px;'>{i}</li>"
            for i in insights
            if "educational" not in i.lower() and "not investment advice" not in i.lower()
        )
        if insight_items:
            insights_html = f"""
            <tr>
              <td style="padding:16px 0;">
                <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;font-weight:600;color:#D4A843;margin:0 0 8px;">
                  Key themes this week
                </p>
                <ul style="margin:0;padding:0 0 0 16px;">{insight_items}</ul>
              </td>
            </tr>
            """

    return f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background-color:#0C0C0E;color:#E8E6E1;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0C0C0E;">
        <tr>
          <td align="center" style="padding:24px 16px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
              <!-- Header -->
              <tr>
                <td style="padding:0 0 20px;">
                  <p style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#D4A843;margin:0;">
                    SignalStack
                  </p>
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#4A4A4D;margin:4px 0 0;text-transform:uppercase;letter-spacing:1px;">
                    Weekly Report
                  </p>
                </td>
              </tr>
              <!-- Greeting -->
              <tr>
                <td style="padding:0 0 16px;">
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#E8E6E1;margin:0;">
                    {greeting}
                  </p>
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#8A8A8D;margin:6px 0 0;">
                    Here's your weekly intelligence summary for {len(holdings)} holding{"s" if len(holdings) != 1 else ""}.
                  </p>
                </td>
              </tr>
              <!-- Signal Distribution -->
              <tr>
                <td style="padding:12px 16px;background-color:#141416;border-radius:8px;">
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;color:#4A4A4D;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px;">
                    Signal overview
                  </p>
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;margin:0;">
                    {signal_summary_html}
                  </p>
                </td>
              </tr>
              <!-- Insights -->
              {insights_html}
              <!-- Holdings -->
              <tr>
                <td>
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    {holdings_html}
                  </table>
                </td>
              </tr>
              <!-- CTA -->
              <tr>
                <td style="padding:24px 0;" align="center">
                  <a href="{_app_url()}/app"
                    style="display:inline-block;padding:10px 24px;background-color:#D4A843;color:#0C0C0E;text-decoration:none;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;font-weight:600;">
                    View full report
                  </a>
                </td>
              </tr>
              <!-- Disclaimer -->
              <tr>
                <td style="padding:16px 0;border-top:1px solid #1A1A1D;">
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#4A4A4D;margin:0;line-height:1.5;">
                    Educational market intelligence only. Not investment advice. All investment decisions are your own responsibility.
                  </p>
                  <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#4A4A4D;margin:8px 0 0;">
                    SignalStack &middot; <a href="{_app_url()}/app/settings" style="color:#4A4A4D;">Manage notifications</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    """


# ============================================================================
# HELPERS
# ============================================================================

def _signal_color(signal: str) -> str:
    """Map signal to a hex color for email."""
    colors = {
        "strongly_bullish": "#34C759",
        "bullish": "#34C759",
        "neutral": "#8A8A8D",
        "bearish": "#FF453A",
        "strongly_bearish": "#FF453A",
        "conflicting": "#FFD60A",
        "insufficient_data": "#8A8A8D",
    }
    return colors.get(signal, "#8A8A8D")


def _strip_html(html: str) -> str:
    """Basic HTML-to-text conversion for the plain text fallback."""
    text = re.sub(r"<br\s*/?>", "\n", html)
    text = re.sub(r"</p>", "\n\n", text)
    text = re.sub(r"</h[1-6]>", "\n\n", text)
    text = re.sub(r"<li>", "- ", text)
    text = re.sub(r"<hr\s*/?>", "\n---\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
