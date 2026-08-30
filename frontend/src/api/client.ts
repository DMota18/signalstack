const API_BASE = '/api/v1';

interface APIResponse<T = any> {
  status: 'ok' | 'error';
  data?: T;
  error?: { code: string; message: string; details?: any };
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
    body?: any,
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
    return this.request<any>('POST', '/auth/signup', { email, password, display_name: displayName });
  }

  async signIn(email: string, password: string) {
    return this.request<any>('POST', '/auth/signin', { email, password });
  }

  // Profile
  async getProfile() {
    return this.request<any>('GET', '/profile');
  }

  async updateProfile(data: any) {
    return this.request<any>('PATCH', '/profile', data);
  }

  async getInvestorProfile() {
    return this.request<any>('GET', '/profile/investor');
  }

  async updateInvestorProfile(data: any) {
    return this.request<any>('PUT', '/profile/investor', data);
  }

  // Portfolios & Holdings
  async getPortfolios() {
    return this.request<any>('GET', '/portfolios');
  }

  async getHoldings(portfolioId: string) {
    return this.request<any>('GET', `/portfolios/${portfolioId}/holdings`);
  }

  async getAllHoldings() {
    return this.request<any>('GET', '/portfolios/all-holdings');
  }

  // Connections
  async registerConnection(broker?: string) {
    return this.request<any>('POST', '/connections/register', broker ? { broker } : undefined);
  }

  async connectionCallback() {
    return this.request<any>('POST', '/connections/callback');
  }

  async getConnections() {
    return this.request<any>('GET', '/connections');
  }

  async syncPortfolio() {
    return this.request<any>('POST', '/connections/sync');
  }

  async disconnectBrokerage(connectionId: string) {
    return this.request<any>('DELETE', `/connections/${connectionId}`);
  }

  // Watchlist
  async getWatchlist() {
    return this.request<any>('GET', '/watchlist');
  }

  async addToWatchlist(ticker: string) {
    return this.request<any>('POST', '/watchlist', { ticker });
  }

  async removeFromWatchlist(ticker: string) {
    return this.request<any>('DELETE', `/watchlist/${ticker}`);
  }

  // Alerts
  async getAlerts(params?: { alert_type?: string; unread_only?: boolean; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.alert_type) query.set('alert_type', params.alert_type);
    if (params?.unread_only) query.set('unread_only', 'true');
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.request<any>('GET', `/alerts${qs ? '?' + qs : ''}`);
  }

  async getAlert(id: string) {
    return this.request<any>('GET', `/alerts/${id}`);
  }

  async getUnreadCount() {
    return this.request<any>('GET', '/alerts/unread-count');
  }

  async submitAlertFeedback(id: string, feedback: 'useful' | 'not_useful') {
    return this.request<any>('POST', `/alerts/${id}/feedback`, { feedback });
  }

  async dismissAlert(id: string) {
    return this.request<any>('POST', `/alerts/${id}/dismiss`);
  }

  // Intelligence
  async generateIntelligence() {
    return this.request<any>('POST', '/intelligence/generate');
  }

  async getLatestIntelligence() {
    return this.request<any>('GET', '/intelligence/latest');
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
    return this.request<any>('GET', `/chart/performance?${params.toString()}`);
  }

  // Polymarket
  async getPolymarketMatches(includeMacro: boolean = true) {
    return this.request<any>('GET', `/polymarket/holdings-match?include_macro=${includeMacro}`);
  }

  async searchPolymarketMarkets(query: string, minVolume: number = 1000, category: string = 'all') {
    const params = new URLSearchParams({ q: query, min_volume: String(minVolume), category });
    return this.request<any>('GET', `/polymarket/search?${params.toString()}`);
  }

  async getPolymarketPrices(marketId: string) {
    return this.request<any>('GET', `/polymarket/prices/${encodeURIComponent(marketId)}`);
  }

  // Manual Portfolio
  async addManualHolding(holding: {
    ticker: string;
    quantity: number;
    security_name?: string;
    security_type?: string;
    avg_cost_basis?: number;
    current_price?: number;
  }) {
    return this.request<any>('POST', '/manual-portfolio/holdings', holding);
  }

  async updateManualHolding(ticker: string, update: {
    quantity?: number;
    avg_cost_basis?: number;
    current_price?: number;
    security_name?: string;
  }) {
    return this.request<any>('PATCH', `/manual-portfolio/holdings/${ticker}`, update);
  }

  async removeManualHolding(ticker: string) {
    return this.request<any>('DELETE', `/manual-portfolio/holdings/${ticker}`);
  }

  async refreshPrices() {
    return this.request<any>('POST', '/manual-portfolio/refresh-prices');
  }

  async bulkAddHoldings(holdings: Array<{
    ticker: string;
    quantity: number;
    security_name?: string;
    security_type?: string;
    avg_cost_basis?: number;
    current_price?: number;
  }>) {
    return this.request<any>('POST', '/manual-portfolio/bulk', holdings);
  }

  // Earnings
  async getEarningsCalendar() {
    return this.request<any>('GET', '/earnings');
  }

  async refreshEarnings() {
    return this.request<any>('POST', '/earnings/refresh');
  }

  // Explore
  async getExploreCategories() {
    return this.request<any>('GET', '/explore/categories');
  }

  async getExploreIdeas(category: string = 'for_you') {
    return this.request<any>('GET', `/explore/ideas?category=${encodeURIComponent(category)}`);
  }

  async generateExploreIdeas(category: string = 'for_you') {
    return this.request<any>('POST', '/explore/generate', { category });
  }

  async getExploreDeepDive(ticker: string) {
    return this.request<any>('POST', '/explore/deep-dive', { ticker });
  }

  // Research
  async getResearch(ticker: string) {
    return this.request<any>('GET', `/research/${encodeURIComponent(ticker)}`);
  }

  async getResearchChart(ticker: string, timeframe: string = '3M') {
    return this.request<any>('GET', `/research/${encodeURIComponent(ticker)}/chart?timeframe=${timeframe}`);
  }

  async searchSymbols(query: string) {
    return this.request<any>('GET', `/research/search/symbols?q=${encodeURIComponent(query)}`);
  }

  // News
  async getHoldingsNews(limit: number = 30) {
    return this.request<any>('GET', `/news/holdings?limit=${limit}`);
  }

  async getMarketNews(limit: number = 20) {
    return this.request<any>('GET', `/news/markets?limit=${limit}`);
  }

  async getEconomyData() {
    return this.request<any>('GET', '/news/economy');
  }

  // Valuation
  async getFairValue(ticker: string, currentPrice: number, financials: any, fundamentals: any) {
    return this.request<any>('POST', '/valuation/fair-value', {
      ticker, current_price: currentPrice, financials, fundamentals,
    });
  }

  // StockTwits
  async getStockTwits(ticker: string, limit: number = 20) {
    return this.request<any>('GET', `/stocktwits/${encodeURIComponent(ticker)}?limit=${limit}`);
  }

  // Market data (Alpha Vantage, NewsAPI, Fear & Greed, Unusual Whales)
  async getFearGreed() {
    return this.request<any>('GET', '/market-data/fear-greed');
  }

  async getTechnicals(ticker: string) {
    return this.request<any>('GET', `/market-data/technicals/${encodeURIComponent(ticker)}`);
  }

  async getNewsApiHeadlines(limit: number = 20) {
    return this.request<any>('GET', `/market-data/headlines?limit=${limit}`);
  }

  async getCongressTrades(limit: number = 20) {
    return this.request<any>('GET', `/market-data/congress?limit=${limit}`);
  }

  async getOptionsFlow(ticker: string) {
    return this.request<any>('GET', `/market-data/options-flow/${encodeURIComponent(ticker)}`);
  }

  // Email delivery
  async sendAlertEmail(alertId: string) {
    return this.request<any>('POST', `/alerts/${alertId}/email`);
  }

  // Push notifications
  async savePushSubscription(subscription: any) {
    return this.request<any>('POST', '/push-subscriptions', subscription);
  }

  async deletePushSubscription() {
    return this.request<any>('DELETE', '/push-subscriptions');
  }

  // Price alerts
  async createPriceAlert(ticker: string, thresholdPct: number, direction: 'above' | 'below') {
    return this.request<any>('POST', '/price-alerts', { ticker, threshold_pct: thresholdPct, direction });
  }

  async getPriceAlerts() {
    return this.request<any>('GET', '/price-alerts');
  }

  async deletePriceAlert(id: string) {
    return this.request<any>('DELETE', `/price-alerts/${id}`);
  }

  // Billing
  async createCheckoutSession() {
    return this.request<any>('POST', '/billing/checkout');
  }

  async createPortalSession() {
    return this.request<any>('POST', '/billing/portal');
  }

  async getBillingStatus() {
    return this.request<any>('GET', '/billing/status');
  }

  // Referrals
  async getReferralCode() {
    return this.request<any>('GET', '/referrals/code');
  }

  async getReferralStats() {
    return this.request<any>('GET', '/referrals/stats');
  }

  async applyReferralCode(code: string) {
    return this.request<any>('POST', `/referrals/apply?code=${encodeURIComponent(code)}`);
  }
}

export const api = new ApiClient();
export type { APIResponse };
