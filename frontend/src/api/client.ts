import type {
  Alert,
  AnalyticsPayload,
  AuthTokens,
  BillingStatus,
  BrokerageConnection,
  ChartPoint,
  EarningsEntry,
  ExploreCategory,
  ExploreDeepDive,
  ExploreIdeasResponse,
  Holding,
  IntelligenceResult,
  InvestorProfile,
  ManualHoldingInput,
  NewsArticle,
  PolymarketMarket,
  PolymarketMatches,
  Portfolio,
  PriceAlert,
  Profile,
  ProfileUpdate,
  ReferralStats,
  ResearchPayload,
  WatchlistItem,
} from './types';

const API_BASE = '/api/v1';

interface APIResponse<T = unknown> {
  status: 'ok' | 'error';
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    this.accessToken = localStorage.getItem('ss_access_token');
    this.refreshToken = localStorage.getItem('ss_refresh_token');
  }

  setTokens(access: string, refresh: string) {
    this.accessToken = access;
    this.refreshToken = refresh;
    localStorage.setItem('ss_access_token', access);
    localStorage.setItem('ss_refresh_token', refresh);
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('ss_access_token');
    localStorage.removeItem('ss_refresh_token');
    localStorage.removeItem('ss_user_id');
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<APIResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    try {
      let response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      // Auto-refresh on 401
      if (response.status === 401 && this.refreshToken) {
        const refreshed = await this.doRefresh();
        if (refreshed) {
          headers['Authorization'] = `Bearer ${this.accessToken}`;
          response = await fetch(`${API_BASE}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });
        } else {
          this.clearTokens();
          window.location.href = '/signin';
          return { status: 'error', error: { code: 'auth_expired', message: 'Session expired' } };
        }
      }

      const data = await response.json();
      return data;
    } catch {
      return {
        status: 'error',
        error: { code: 'network', message: 'Network error. Please check your connection.' },
      };
    }
  }

  private async doRefresh(): Promise<boolean> {
    try {
      const resp = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.status === 'ok' && data.data?.access_token) {
          this.setTokens(data.data.access_token, data.data.refresh_token);
          return true;
        }
      }
    } catch {
      /* non-fatal: network failure during token refresh — fall through to return false */
    }
    return false;
  }

  // Auth
  async signUp(email: string, password: string, displayName?: string) {
    return this.request<AuthTokens>('POST', '/auth/signup', { email, password, display_name: displayName });
  }

  async signIn(email: string, password: string) {
    return this.request<AuthTokens>('POST', '/auth/signin', { email, password });
  }

  // Profile
  async getProfile() {
    return this.request<Profile>('GET', '/profile');
  }

  async updateProfile(data: ProfileUpdate) {
    return this.request<Profile>('PATCH', '/profile', data);
  }

  async getInvestorProfile() {
    return this.request<InvestorProfile>('GET', '/profile/investor');
  }

  async updateInvestorProfile(data: Partial<InvestorProfile>) {
    return this.request<InvestorProfile>('PUT', '/profile/investor', data);
  }

  // Portfolios & Holdings
  async getPortfolios() {
    return this.request<Portfolio[]>('GET', '/portfolios');
  }

  async getHoldings(portfolioId: string) {
    return this.request<Holding[]>('GET', `/portfolios/${portfolioId}/holdings`);
  }

  async getAllHoldings() {
    return this.request<Holding[]>('GET', '/portfolios/all-holdings');
  }

  // Connections
  async registerConnection(broker?: string) {
    return this.request<{ redirect_url?: string } & AnalyticsPayload>(
      'POST', '/connections/register', broker ? { broker } : undefined,
    );
  }

  async connectionCallback() {
    return this.request<AnalyticsPayload>('POST', '/connections/callback');
  }

  async getConnections() {
    return this.request<BrokerageConnection[]>('GET', '/connections');
  }

  async syncPortfolio() {
    return this.request<{ accounts_synced?: number; holdings_synced?: number; errors?: string[] }>(
      'POST', '/connections/sync',
    );
  }

  async disconnectBrokerage(connectionId: string) {
    return this.request<AnalyticsPayload>('DELETE', `/connections/${connectionId}`);
  }

  // Watchlist
  async getWatchlist() {
    return this.request<WatchlistItem[]>('GET', '/watchlist');
  }

  async addToWatchlist(ticker: string) {
    return this.request<WatchlistItem>('POST', '/watchlist', { ticker });
  }

  async removeFromWatchlist(ticker: string) {
    return this.request<AnalyticsPayload>('DELETE', `/watchlist/${ticker}`);
  }

  // Alerts
  async getAlerts(params?: { alert_type?: string; unread_only?: boolean; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.alert_type) query.set('alert_type', params.alert_type);
    if (params?.unread_only) query.set('unread_only', 'true');
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.request<Alert[]>('GET', `/alerts${qs ? '?' + qs : ''}`);
  }

  async getAlert(id: string) {
    return this.request<Alert>('GET', `/alerts/${id}`);
  }

  async getUnreadCount() {
    return this.request<{ unread_count: number }>('GET', '/alerts/unread-count');
  }

  async submitAlertFeedback(id: string, feedback: 'useful' | 'not_useful') {
    return this.request<AnalyticsPayload>('POST', `/alerts/${id}/feedback`, { feedback });
  }

  async dismissAlert(id: string) {
    return this.request<AnalyticsPayload>('POST', `/alerts/${id}/dismiss`);
  }

  // Intelligence
  async generateIntelligence() {
    return this.request<IntelligenceResult>('POST', '/intelligence/generate');
  }

  async getLatestIntelligence() {
    return this.request<Alert | { message: string }>('GET', '/intelligence/latest');
  }

  /**
   * Get the auth token for manual SSE connection (EventSource doesn't support headers).
   * Use with fetch() + ReadableStream for authenticated SSE.
   */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  // Chart
  async getChartData(timeframe: string, startDate?: string, endDate?: string) {
    const params = new URLSearchParams({ timeframe });
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    return this.request<ChartPoint[]>('GET', `/chart/performance?${params.toString()}`);
  }

  // Polymarket
  async getPolymarketMatches(includeMacro: boolean = true) {
    return this.request<PolymarketMatches>('GET', `/polymarket/holdings-match?include_macro=${includeMacro}`);
  }

  async searchPolymarketMarkets(query: string, minVolume: number = 1000, category: string = 'all') {
    const params = new URLSearchParams({ q: query, min_volume: String(minVolume), category });
    return this.request<{ markets?: PolymarketMarket[] } & AnalyticsPayload>(
      'GET', `/polymarket/search?${params.toString()}`,
    );
  }

  async getPolymarketPrices(marketId: string) {
    return this.request<AnalyticsPayload>('GET', `/polymarket/prices/${encodeURIComponent(marketId)}`);
  }

  // Manual Portfolio
  async addManualHolding(holding: ManualHoldingInput) {
    return this.request<Holding>('POST', '/manual-portfolio/holdings', holding);
  }

  async updateManualHolding(ticker: string, update: Partial<ManualHoldingInput>) {
    return this.request<Holding>('PATCH', `/manual-portfolio/holdings/${ticker}`, update);
  }

  async removeManualHolding(ticker: string) {
    return this.request<AnalyticsPayload>('DELETE', `/manual-portfolio/holdings/${ticker}`);
  }

  async refreshPrices() {
    return this.request<{ updated: number } & AnalyticsPayload>('POST', '/manual-portfolio/refresh-prices');
  }

  async bulkAddHoldings(holdings: ManualHoldingInput[]) {
    return this.request<AnalyticsPayload>('POST', '/manual-portfolio/bulk', holdings);
  }

  // Earnings
  async getEarningsCalendar() {
    return this.request<EarningsEntry[]>('GET', '/earnings');
  }

  async refreshEarnings() {
    return this.request<AnalyticsPayload>('POST', '/earnings/refresh');
  }

  // Explore
  async getExploreCategories() {
    return this.request<ExploreCategory[]>('GET', '/explore/categories');
  }

  async getExploreIdeas(category: string = 'for_you') {
    return this.request<ExploreIdeasResponse>('GET', `/explore/ideas?category=${encodeURIComponent(category)}`);
  }

  async generateExploreIdeas(category: string = 'for_you') {
    return this.request<ExploreIdeasResponse>('POST', '/explore/generate', { category });
  }

  async getExploreDeepDive(ticker: string) {
    return this.request<ExploreDeepDive>('POST', '/explore/deep-dive', { ticker });
  }

  // Research
  async getResearch(ticker: string) {
    return this.request<ResearchPayload>('GET', `/research/${encodeURIComponent(ticker)}`);
  }

  async getResearchChart(ticker: string, timeframe: string = '3M') {
    return this.request<ChartPoint[]>('GET', `/research/${encodeURIComponent(ticker)}/chart?timeframe=${timeframe}`);
  }

  async searchSymbols(query: string) {
    return this.request<AnalyticsPayload>('GET', `/research/search/symbols?q=${encodeURIComponent(query)}`);
  }

  // News
  async getHoldingsNews(limit: number = 30) {
    return this.request<{ articles: NewsArticle[] }>('GET', `/news/holdings?limit=${limit}`);
  }

  async getMarketNews(limit: number = 20) {
    return this.request<{ articles: NewsArticle[] }>('GET', `/news/markets?limit=${limit}`);
  }

  async getEconomyData() {
    return this.request<AnalyticsPayload>('GET', '/news/economy');
  }

  // Valuation
  async getFairValue(ticker: string, currentPrice: number, financials: AnalyticsPayload, fundamentals: AnalyticsPayload) {
    return this.request<AnalyticsPayload>('POST', '/valuation/fair-value', {
      ticker, current_price: currentPrice, financials, fundamentals,
    });
  }

  // StockTwits
  async getStockTwits(ticker: string, limit: number = 20) {
    return this.request<AnalyticsPayload>('GET', `/stocktwits/${encodeURIComponent(ticker)}?limit=${limit}`);
  }

  // Market data (Alpha Vantage, NewsAPI, Fear & Greed, Unusual Whales)
  async getFearGreed() {
    return this.request<AnalyticsPayload>('GET', '/market-data/fear-greed');
  }

  async getTechnicals(ticker: string) {
    return this.request<AnalyticsPayload>('GET', `/market-data/technicals/${encodeURIComponent(ticker)}`);
  }

  async getNewsApiHeadlines(limit: number = 20) {
    return this.request<{ articles: NewsArticle[] }>('GET', `/market-data/headlines?limit=${limit}`);
  }

  async getCongressTrades(limit: number = 20) {
    return this.request<{ trades: AnalyticsPayload[] }>('GET', `/market-data/congress?limit=${limit}`);
  }

  async getOptionsFlow(ticker: string) {
    return this.request<AnalyticsPayload>('GET', `/market-data/options-flow/${encodeURIComponent(ticker)}`);
  }

  // Email delivery
  async sendAlertEmail(alertId: string) {
    return this.request<AnalyticsPayload>('POST', `/alerts/${alertId}/email`);
  }

  // Push notifications
  async savePushSubscription(subscription: PushSubscriptionJSON) {
    return this.request<{ subscribed: boolean }>('POST', '/push-subscriptions', subscription);
  }

  async deletePushSubscription() {
    return this.request<AnalyticsPayload>('DELETE', '/push-subscriptions');
  }

  // Price alerts
  async createPriceAlert(ticker: string, thresholdPct: number, direction: 'above' | 'below') {
    return this.request<PriceAlert>('POST', '/price-alerts', { ticker, threshold_pct: thresholdPct, direction });
  }

  async getPriceAlerts() {
    return this.request<PriceAlert[]>('GET', '/price-alerts');
  }

  async deletePriceAlert(id: string) {
    return this.request<AnalyticsPayload>('DELETE', `/price-alerts/${id}`);
  }

  // Billing
  async createCheckoutSession() {
    return this.request<{ checkout_url: string }>('POST', '/billing/checkout');
  }

  async createPortalSession() {
    return this.request<{ portal_url: string }>('POST', '/billing/portal');
  }

  async getBillingStatus() {
    return this.request<BillingStatus>('GET', '/billing/status');
  }

  // Referrals
  async getReferralCode() {
    return this.request<ReferralStats>('GET', '/referrals/code');
  }

  async getReferralStats() {
    return this.request<ReferralStats>('GET', '/referrals/stats');
  }

  async applyReferralCode(code: string) {
    return this.request<AnalyticsPayload>('POST', `/referrals/apply?code=${encodeURIComponent(code)}`);
  }
}

export const api = new ApiClient();
export type { APIResponse };
