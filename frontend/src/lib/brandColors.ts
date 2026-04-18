/**
 * Brand colors for well-known tickers.
 * Used in donut chart, holdings table, and treemap.
 */

// Ticker → brand hex color
export const BRAND_COLORS: Record<string, string> = {
  // Big Tech
  AAPL: '#555555',
  GOOGL: '#EA4335',
  GOOG: '#EA4335',
  MSFT: '#00A4EF',
  AMZN: '#FF9900',
  META: '#0081FB',
  NVDA: '#76B900',
  TSLA: '#CC0000',
  NFLX: '#E50914',
  CRM: '#00A1E0',
  ORCL: '#C74634',
  INTC: '#0071C5',
  AMD: '#ED1C24',
  ADBE: '#FF0000',

  // Finance
  JPM: '#005EB8',
  BAC: '#012169',
  GS: '#6BA539',
  MS: '#003DA5',
  V: '#1A1F71',
  MA: '#FF5F00',
  PYPL: '#003087',
  SQ: '#006AFF',

  // Other equities
  DIS: '#006EC7',
  NKE: '#111111',
  KO: '#F40009',
  PEP: '#004B93',
  WMT: '#0071CE',
  JNJ: '#D51900',
  PFE: '#0093D0',
  UNH: '#002677',
  HD: '#F96302',
  MCD: '#FFC72C',
  COST: '#E31837',
  SBUX: '#006241',
  BA: '#0039A6',
  UBER: '#000000',
  ABNB: '#FF5A5F',
  SNOW: '#29B5E8',
  PLTR: '#101010',
  COIN: '#0052FF',
  HOOD: '#00C805',
  SOFI: '#00D4AA',
  RBLX: '#E2001A',
  SHOP: '#96BF48',
  SPOT: '#1DB954',
  SNAP: '#FFFC00',
  PINS: '#E60023',
  ROKU: '#6C3C97',

  // Crypto
  BTC: '#F7931A',
  'BTC-USD': '#F7931A',
  ETH: '#627EEA',
  'ETH-USD': '#627EEA',
  SOL: '#9945FF',
  'SOL-USD': '#9945FF',
  XRP: '#23292F',
  'XRP-USD': '#23292F',
  DOGE: '#C3A634',
  'DOGE-USD': '#C3A634',
  ADA: '#0033AD',
  DOT: '#E6007A',
  AVAX: '#E84142',
  MATIC: '#8247E5',
  LINK: '#2A5ADA',

  // ETFs
  SPY: '#FF6600',
  QQQ: '#008C99',
  VTI: '#96151D',
  VOO: '#96151D',
  IWM: '#0072BC',
  GLD: '#D4A843',
  SLV: '#C0C0C0',
  ARKK: '#FFFFFF',
  XLF: '#003DA5',
  XLE: '#007832',
  XLK: '#5C2D91',
};

// Domain mapping for Clearbit logos (high-quality overrides)
const TICKER_DOMAINS: Record<string, string> = {
  AAPL: 'apple.com', GOOGL: 'google.com', GOOG: 'google.com',
  MSFT: 'microsoft.com', AMZN: 'amazon.com', META: 'meta.com',
  NVDA: 'nvidia.com', TSLA: 'tesla.com', NFLX: 'netflix.com',
  CRM: 'salesforce.com', ORCL: 'oracle.com', INTC: 'intel.com',
  AMD: 'amd.com', ADBE: 'adobe.com', JPM: 'jpmorganchase.com',
  BAC: 'bankofamerica.com', GS: 'goldmansachs.com', MS: 'morganstanley.com',
  V: 'visa.com', MA: 'mastercard.com', PYPL: 'paypal.com',
  DIS: 'disney.com', NKE: 'nike.com', KO: 'coca-cola.com',
  PEP: 'pepsico.com', WMT: 'walmart.com', JNJ: 'jnj.com',
  PFE: 'pfizer.com', UNH: 'unitedhealthgroup.com', HD: 'homedepot.com',
  MCD: 'mcdonalds.com', COST: 'costco.com', SBUX: 'starbucks.com',
  BA: 'boeing.com', UBER: 'uber.com', ABNB: 'airbnb.com',
  SNOW: 'snowflake.com', PLTR: 'palantir.com', COIN: 'coinbase.com',
  HOOD: 'robinhood.com', SOFI: 'sofi.com', RBLX: 'roblox.com',
  SHOP: 'shopify.com', SPOT: 'spotify.com', SNAP: 'snap.com',
  PINS: 'pinterest.com', SQ: 'squareup.com', ROKU: 'roku.com',
  SPY: 'ssga.com', QQQ: 'invesco.com', VTI: 'vanguard.com',
  VOO: 'vanguard.com', ARKK: 'ark-invest.com', GLD: 'ssga.com',
  // Semis
  MU: 'micron.com', TSM: 'tsmc.com', AVGO: 'broadcom.com',
  QCOM: 'qualcomm.com', TXN: 'ti.com', LRCX: 'lamresearch.com',
  KLAC: 'kla.com', AMAT: 'appliedmaterials.com', MRVL: 'marvell.com',
  ARM: 'arm.com', SMCI: 'supermicro.com', DELL: 'dell.com',
  // Healthcare
  LLY: 'lilly.com', ABBV: 'abbvie.com', MRK: 'merck.com',
  TMO: 'thermofisher.com', ABT: 'abbott.com', AMGN: 'amgen.com',
  GILD: 'gilead.com', REGN: 'regeneron.com', VRTX: 'vrtx.com',
  ISRG: 'intuitive.com', DXCM: 'dexcom.com', MRNA: 'modernatx.com',
  // Industrials & Energy
  CAT: 'caterpillar.com', DE: 'deere.com', HON: 'honeywell.com',
  GE: 'ge.com', RTX: 'rtx.com', LMT: 'lockheedmartin.com',
  NOC: 'northropgrumman.com', XOM: 'exxonmobil.com', CVX: 'chevron.com',
  COP: 'conocophillips.com', SLB: 'slb.com', OXY: 'oxy.com',
  // Consumer
  PG: 'pg.com', CL: 'colgate.com', EL: 'esteelauder.com',
  LULU: 'lululemon.com', TGT: 'target.com', LOW: 'lowes.com',
  TJX: 'tjx.com', ROST: 'rossstores.com', CMG: 'chipotle.com',
  YUM: 'yum.com', DKNG: 'draftkings.com', MGM: 'mgmresorts.com',
  // Fintech / Payments
  AXP: 'americanexpress.com', SCHW: 'schwab.com', BLK: 'blackrock.com',
  ICE: 'ice.com', CME: 'cmegroup.com', MSTR: 'microstrategy.com',
  // Media / Internet
  GRMN: 'garmin.com', ZM: 'zoom.us', DOCU: 'docusign.com',
  TWLO: 'twilio.com', NET: 'cloudflare.com', CRWD: 'crowdstrike.com',
  ZS: 'zscaler.com', DDOG: 'datadoghq.com', MDB: 'mongodb.com',
  PANW: 'paloaltonetworks.com', FTNT: 'fortinet.com', OKTA: 'okta.com',
  NOW: 'servicenow.com', WDAY: 'workday.com', TEAM: 'atlassian.com',
  U: 'unity.com', RBLX2: 'roblox.com', EA: 'ea.com',
  TTWO: 'take2games.com', ATVI: 'activision.com',
  // Telecom / Utilities
  T: 'att.com', VZ: 'verizon.com', TMUS: 't-mobile.com',
  NEE: 'nexteraenergy.com', DUK: 'duke-energy.com', SO: 'southerncompany.com',
  // Transport
  UPS: 'ups.com', FDX: 'fedex.com', DAL: 'delta.com',
  UAL: 'united.com', LUV: 'southwest.com', AAL: 'aa.com',
  // REITs
  AMT: 'americantower.com', PLD: 'prologis.com', CCI: 'crowncastle.com',
  O: 'realtyincome.com', SPG: 'simon.com',
  // Crypto
  BTC: 'bitcoin.org', ETH: 'ethereum.org', SOL: 'solana.com',
  XRP: 'ripple.com', DOGE: 'dogecoin.com', ADA: 'cardano.org',
  DOT: 'polkadot.network', AVAX: 'avax.network', MATIC: 'polygon.technology',
  LINK: 'chain.link', MARA: 'mara.com', RIOT: 'riotplatforms.com',
  CLSK: 'cleanspark.com', IREN: 'irisenergy.co',
  // Mining stocks
  NEM: 'newmont.com', GOLD: 'barrick.com', FCX: 'fcx.com',
  // Misc popular
  RIVN: 'rivian.com', LCID: 'lucidmotors.com', NIO: 'nio.com',
  LI: 'lixiang.com', XPEV: 'heyxpeng.com', F: 'ford.com',
  GM: 'gm.com', BABA: 'alibabagroup.com', JD: 'jd.com',
  PDD: 'pinduoduo.com', BIDU: 'baidu.com', NTR: 'nutrien.com',
  MOS: 'mosaicco.com', CF: 'cfindustries.com',
  WFC: 'wellsfargo.com', C: 'citigroup.com', USB: 'usbank.com',
  BK: 'bnymellon.com', STT: 'statestreet.com',
  IBIT: 'ishares.com', BITO: 'proshares.com', SCHD: 'schwab.com',
  DIA: 'ssga.com', IWM: 'ishares.com', XLF: 'ssga.com',
  XLE: 'ssga.com', XLK: 'ssga.com', SLV: 'ishares.com',
};

/**
 * Get logo URL for a ticker.
 *
 * Strategy:
 * 1. Check TICKER_DOMAINS for a high-quality Google favicon match (128px)
 *    Google's favicon service is free, reliable, and needs no API key.
 * 2. Fall back to a ticker-based icon service.
 *
 * Note: Clearbit logos were deprecated (acquired by HubSpot).
 *       Finnhub /api/logo requires auth headers that <img> can't send.
 */
export function getLogoUrl(ticker: string): string {
  const clean = ticker.toUpperCase().replace('-USD', '');

  // Priority 1: Google high-res favicon via known domain
  const domain = TICKER_DOMAINS[clean];
  if (domain) {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
  }

  // Priority 2: Try a guessed domain for unmapped tickers
  // Many companies use ticker.com (e.g., AMD → amd.com)
  return `https://www.google.com/s2/favicons?domain=${clean.toLowerCase()}.com&sz=128`;
}

/**
 * Get brand color for a ticker. Falls back to the provided default.
 */
export function getBrandColor(ticker: string, fallback: string): string {
  return BRAND_COLORS[ticker.toUpperCase()] || BRAND_COLORS[ticker.toUpperCase().replace('-USD', '')] || fallback;
}
