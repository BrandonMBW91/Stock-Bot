import { alpacaClient } from '../utils/AlpacaClient.js';
import { adaptiveRiskManager } from './AdaptiveRiskManager.js';
import { portfolioTracker } from './PortfolioTracker.js';
import { marketHours } from '../utils/MarketHours.js';
import { dashboard } from '../ui/InPlaceDashboard.js';
import { discordNotifier } from '../utils/DiscordNotifier.js';
import { config } from '../utils/ConfigManager.js';
import { ScalpingStrategy } from '../strategies/ScalpingStrategy.js';
import { DayTradingStrategy } from '../strategies/DayTradingStrategy.js';
import { SwingTradingStrategy } from '../strategies/SwingTradingStrategy.js';
import { trendAnalyzer } from '../analysis/TrendAnalyzer.js';
import { appendFileSync } from 'fs';

function debugLog(msg) {
  try {
    appendFileSync('./bot-debug.txt', `[${new Date().toLocaleTimeString()}] ${msg}\n`);
  } catch (e) {}
}

export class TradingEngine {
  constructor() {
    this.strategies = [];
    this.isRunning = false;
    this.cryptoAssets = config.assets.crypto;
    this.stockAssets = config.assets.stocks;
    this.allAssets = [...this.cryptoAssets, ...this.stockAssets];
    this.updateInterval = null;
    this.analysisInterval = null;
    this.trendRotationInterval = null;
    this.lockCleanupInterval = null;
    this.activeTradingAssets = [];
  }

  async initialize() {
    console.log('Initializing Trading Engine...');

    dashboard.initialize();
    dashboard.log('Initializing Trading Engine...', 'info');

    await alpacaClient.initialize();
    dashboard.log('Alpaca client connected', 'success');

    await adaptiveRiskManager.initialize();
    dashboard.log('Adaptive risk manager initialized', 'success');

    await portfolioTracker.initialize();
    dashboard.log('Portfolio tracker initialized', 'success');

    if (config.strategies.scalping.enabled) {
      this.strategies.push(new ScalpingStrategy());
      dashboard.log('Scalping strategy loaded', 'success');
    }

    if (config.strategies.dayTrading.enabled) {
      this.strategies.push(new DayTradingStrategy());
      dashboard.log('Day trading strategy loaded', 'success');
    }

    if (config.strategies.swingTrading.enabled) {
      this.strategies.push(new SwingTradingStrategy());
      dashboard.log('Swing trading strategy loaded', 'success');
    }

    const account = await alpacaClient.getAccount();

    await discordNotifier.sendStartup({
      mode: config.alpaca.paper ? 'PAPER TRADING' : 'LIVE TRADING',
      portfolioValue: parseFloat(account.equity),
      buyingPower: parseFloat(account.buying_power),
      cryptoAssets: this.cryptoAssets,
      stockAssets: this.stockAssets,
      strategies: this.strategies.map(s => s.name)
    });

    dashboard.log('Trading bot started successfully', 'success');
  }

  async start() {
    this.isRunning = true;

    // Initial trend analysis to select best assets
    // console.log('Running initial trend analysis...');
    await this.rotateTrendingSymbols();

    this.updateInterval = setInterval(async () => {
      await this.updateDashboard();
    }, 1000); // Update every 1 second

    this.analysisInterval = setInterval(async () => {
      dashboard.clearHotSignals();
      await this.analyzeMarkets();
      dashboard.setNextAnalysisTime(Date.now() + 60000);
    }, 60000);

    // Set initial next analysis time
    dashboard.setNextAnalysisTime(Date.now() + 60000);

    // Rotate symbols every 4 hours based on trending analysis
    this.trendRotationInterval = setInterval(async () => {
      await this.rotateTrendingSymbols();
    }, 4 * 60 * 60 * 1000); // 4 hours

    // Clean expired symbol locks every minute
    this.lockCleanupInterval = setInterval(() => {
      adaptiveRiskManager.cleanExpiredLocks();
    }, 60000); // 1 minute

    dashboard.clearHotSignals();
    await this.analyzeMarkets();
    dashboard.setNextAnalysisTime(Date.now() + 60000);

    // console.log('Trading Engine started');
    dashboard.log('Trading Engine started - analyzing markets', 'success');
  }

  async updateDashboard() {
    try {
      const summary = await portfolioTracker.getPortfolioSummary();
      const stats = portfolioTracker.getDailyStats();

      dashboard.updatePortfolio({
        ...summary,
        maxPositions: config.trading.maxConcurrentPositions,
        emergencyStop: adaptiveRiskManager.isEmergencyStop
      });

      dashboard.updateDailyStats(stats);

      dashboard.updatePositions(summary.openPositions);

      await adaptiveRiskManager.checkDailyLossLimit();

      dashboard.render();
    } catch (error) {
      dashboard.log(`Error updating dashboard: ${error.message}`, 'error');
    }
  }

  async analyzeMarkets() {
    if (!this.isRunning) return;

    try {
      const tradableAssets = this.getTradableAssets();

      dashboard.log(`Analyzing ${tradableAssets.length} assets...`, 'info');

      const allHeatData = [];

      for (const symbol of tradableAssets) {
        const heatItems = await this.analyzeSymbol(symbol);
        allHeatData.push(...heatItems);
      }

      // TEMPORARY: Add fake signals to test Market Heat display
      const fakeSignals = [
        { symbol: 'BTCUSD', direction: 'BUY', strength: 52, indicator: 'Test: RSI+MACD' },
        { symbol: 'ETHUSD', direction: 'SELL', strength: 48, indicator: 'Test: Momentum' },
        { symbol: 'SOLUSD', direction: 'BUY', strength: 45, indicator: 'Test: BB bounce' },
        { symbol: 'AVAXUSD', direction: 'BUY', strength: 38, indicator: 'Test: Trend' },
        { symbol: 'LINKUSD', direction: 'SELL', strength: 35, indicator: 'Test: Overbought' }
      ];
      allHeatData.push(...fakeSignals);

      // Update dashboard with market heat
      debugLog(`✓ Analysis: ${allHeatData.length} signals (${fakeSignals.length} TEST) from ${tradableAssets.length} assets`);
      if (allHeatData.length > 0) {
        const strongest = allHeatData.sort((a, b) => b.strength - a.strength).slice(0, 3);
        debugLog(`Top 3: ${strongest.map(h => `${h.symbol}=${h.strength.toFixed(0)}`).join(', ')}`);
      }
      dashboard.updateMarketHeat(allHeatData);

    } catch (error) {
      dashboard.log(`Error analyzing markets: ${error.message}`, 'error');
      await discordNotifier.sendError('Market Analysis Error', error);
    }
  }

  async rotateTrendingSymbols() {
    try {
      console.log('Analyzing market trends for symbol rotation...');
      dashboard.log('🔄 Rotating symbols based on market trends...', 'info');

      await trendAnalyzer.analyzeAllAssets();

      const trendingAssets = trendAnalyzer.getTrendingAssets();
      this.activeTradingAssets = trendingAssets;

      const sentiment = await trendAnalyzer.getMarketSentiment();

      // Update adaptive risk manager with market sentiment
      adaptiveRiskManager.updateSentiment(sentiment);

      // console.log(`Market Sentiment - Crypto: ${sentiment.cryptoSentiment}, Stocks: ${sentiment.stocksSentiment}`);
      dashboard.log(`📊 Market Sentiment - Crypto: ${sentiment.cryptoSentiment}, Stocks: ${sentiment.stocksSentiment}`, 'info');
      dashboard.log(`✅ Now trading ${this.activeTradingAssets.length} trending assets`, 'success');

      await discordNotifier.sendWebhook(config.discord.tradeWebhook, {
        title: '🔄 Symbol Rotation Complete',
        color: 0x00D9FF,
        fields: [
          { name: 'Active Assets', value: this.activeTradingAssets.join(', '), inline: false },
          { name: 'Crypto Sentiment', value: sentiment.cryptoSentiment, inline: true },
          { name: 'Stock Sentiment', value: sentiment.stocksSentiment, inline: true },
          { name: 'Top Crypto', value: trendAnalyzer.getTopCrypto(3).join(', ') || 'None', inline: true },
          { name: 'Top Stocks', value: trendAnalyzer.getTopStocks(3).join(', ') || 'None', inline: true }
        ],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error rotating symbols:', error);
      dashboard.log(`Error rotating symbols: ${error.message}`, 'error');
    }
  }

  getTradableAssets() {
    // Use trending assets if available, otherwise fall back to all assets
    if (this.activeTradingAssets.length > 0) {
      const tradableAssets = [];

      if (marketHours.shouldTradeCrypto()) {
        const trendingCrypto = this.activeTradingAssets.filter(symbol =>
          this.cryptoAssets.includes(symbol)
        );
        tradableAssets.push(...trendingCrypto);
      }

      if (marketHours.shouldTradeStocks()) {
        const trendingStocks = this.activeTradingAssets.filter(symbol =>
          this.stockAssets.includes(symbol)
        );
        tradableAssets.push(...trendingStocks);
      }

      return tradableAssets;
    }

    // Fallback to all assets
    const tradableAssets = [];

    if (marketHours.shouldTradeCrypto()) {
      tradableAssets.push(...this.cryptoAssets);
    }

    if (marketHours.shouldTradeStocks()) {
      tradableAssets.push(...this.stockAssets);
    }

    return tradableAssets;
  }

  async analyzeSymbol(symbol) {
    try {
      const heatItems = [];

      debugLog(`Analyzing ${symbol} with ${this.strategies.length} strategies`);

      for (const strategy of this.strategies) {
        if (!strategy.isEnabled()) continue;

        let bars = null;

        if (strategy.timeframe === '1Min') {
          bars = await alpacaClient.getBars(symbol, '1Min', 100);
        } else if (strategy.timeframe === '5Min') {
          bars = await alpacaClient.getBars(symbol, '5Min', 100);
        } else if (strategy.timeframe === '4Hour') {
          bars = await alpacaClient.getBars(symbol, '1Hour', 200);
        }

        if (!bars || bars.length === 0) {
          continue;
        }

        const signal = await strategy.analyze(symbol, bars, alpacaClient);

        debugLog(`${symbol} ${strategy.name}: signal=${signal.signal}, strength=${signal.strength}`);

        if (signal.signal !== 'NEUTRAL' && signal.price) {
          dashboard.addSignal({
            symbol: symbol,
            signal: signal.signal,
            strength: signal.strength,
            strategy: strategy.name,
            timestamp: new Date()
          });

          // Add to heat tracking
          heatItems.push({
            symbol: symbol,
            direction: signal.signal,
            strength: signal.strength,
            indicator: `${strategy.name}: ${signal.reason || 'Multi-indicator confluence'}`
          });

          // dashboard.log(`${strategy.name} signal for ${symbol}: ${signal.signal} (${signal.strength.toFixed(0)})`, 'info');

          if (signal.strength >= 55) {
            await this.executeSignal(symbol, signal, strategy);
          }
        }
      }

      return heatItems;
    } catch (error) {
      dashboard.log(`Error analyzing ${symbol}: ${error.message}`, 'error');
      return [];
    }
  }

  async executeSignal(symbol, signal, strategy) {
    try {
      const order = await strategy.execute(symbol, signal, alpacaClient, adaptiveRiskManager);

      if (order) {
        dashboard.addTrade({
          symbol: symbol,
          action: signal.signal,
          qty: order.qty || 'N/A',
          timestamp: new Date()
        });

        portfolioTracker.recordTrade({
          symbol: symbol,
          action: signal.signal,
          strategy: strategy.name
        });

        dashboard.log(`Executed ${signal.signal} order for ${symbol}`, 'success');
      }
    } catch (error) {
      dashboard.log(`Error executing signal for ${symbol}: ${error.message}`, 'error');
      await discordNotifier.sendError(`Order Execution Failed for ${symbol}`, error);
    }
  }

  async stop() {
    this.isRunning = false;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
    }

    if (this.trendRotationInterval) {
      clearInterval(this.trendRotationInterval);
    }

    if (this.lockCleanupInterval) {
      clearInterval(this.lockCleanupInterval);
    }

    await portfolioTracker.sendDailySummary();

    await discordNotifier.sendShutdown('Trading bot stopped by user');

    dashboard.log('Trading Engine stopped', 'warn');
    console.log('Trading Engine stopped');
  }
}

export const tradingEngine = new TradingEngine();
