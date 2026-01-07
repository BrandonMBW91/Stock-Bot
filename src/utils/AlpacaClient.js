import Alpaca from '@alpacahq/alpaca-trade-api';
import { config } from './ConfigManager.js';
import { discordNotifier } from './DiscordNotifier.js';
import { appendFileSync } from 'fs';

function debugLog(msg) {
  try {
    appendFileSync('./bot-debug.txt', `[${new Date().toLocaleTimeString()}] ${msg}\n`);
  } catch (e) {}
}

class AlpacaClient {
  constructor() {
    this.alpaca = new Alpaca({
      keyId: config.alpaca.apiKey,
      secretKey: config.alpaca.apiSecret,
      paper: config.alpaca.paper,
      usePolygon: false
    });

    this.account = null;
    this.positions = new Map();
    this.orders = new Map();
  }

  async initialize() {
    try {
      this.account = await this.alpaca.getAccount();
      await this.updatePositions();
      await this.updateOrders();
      return true;
    } catch (error) {
      await discordNotifier.sendError('Alpaca Client Initialization Failed', error);
      throw error;
    }
  }

  async getAccount() {
    try {
      this.account = await this.alpaca.getAccount();
      return this.account;
    } catch (error) {
      await discordNotifier.sendError('Failed to get account info', error);
      throw error;
    }
  }

  async updatePositions() {
    try {
      const positions = await this.alpaca.getPositions();
      this.positions.clear();
      positions.forEach(pos => {
        this.positions.set(pos.symbol, pos);
      });
      return this.positions;
    } catch (error) {
      await discordNotifier.sendError('Failed to update positions', error);
      throw error;
    }
  }

  async updateOrders() {
    try {
      const orders = await this.alpaca.getOrders({ status: 'open' });
      this.orders.clear();
      orders.forEach(order => {
        this.orders.set(order.id, order);
      });
      return this.orders;
    } catch (error) {
      await discordNotifier.sendError('Failed to update orders', error);
      throw error;
    }
  }

  async getPosition(symbol) {
    await this.updatePositions();
    return this.positions.get(symbol);
  }

  async getBars(symbol, timeframe, limit = 100) {
    // Simple cache to reduce duplicate API calls within same scan cycle (1 minute TTL)
    const cacheKey = `${symbol}_${timeframe}_${limit}`;
    const now = Date.now();

    if (this._barsCache && this._barsCache[cacheKey]) {
      const cached = this._barsCache[cacheKey];
      if (now - cached.timestamp < 60000) { // 1 minute cache
        return cached.data;
      }
    }

    try {
      // Add feed parameter for crypto - Alpaca requires this for crypto symbols
      const options = {
        limit: limit,
        timeframe: timeframe,
        adjustment: 'raw'
      };

      // If crypto symbol (contains /), add feed parameter
      if (symbol.includes('/')) {
        options.feed = 'us';  // Try 'us' feed for crypto
      }

      const bars = await this.alpaca.getBarsV2(symbol, options);

      const barData = [];
      for await (let bar of bars) {
        barData.push(bar);
      }

      if (barData.length === 0) {
        debugLog(`⚠️  NO BARS returned for ${symbol} ${timeframe} (limit=${limit})`);
      } else {
        // Debug: Log bar structure for first bar
        if (barData.length > 0) {
          const { appendFileSync } = await import('fs');
          try {
            const firstBar = barData[0];
            appendFileSync('./bot-debug.txt', `[${new Date().toLocaleTimeString()}] 📊 ${symbol} bar keys: ${Object.keys(firstBar).join(', ')}\n`);
          } catch (e) {}
        }

        // Cache successful results
        if (!this._barsCache) this._barsCache = {};
        this._barsCache[cacheKey] = { data: barData, timestamp: now };
      }

      return barData;
    } catch (error) {
      const errorMsg = `❌ Failed to get bars for ${symbol}: ${error.message}`;

      // Log to file but DON'T spam console or Discord during after-hours
      const { appendFileSync } = await import('fs');
      try {
        appendFileSync('./bot-debug.txt', `[${new Date().toLocaleTimeString()}] ${errorMsg}\n`);
      } catch (e) {}

      // Only send critical errors to Discord (rate limits and crypto 404s)
      // Skip Discord notifications for empty bars during after-hours
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        debugLog(`🚨 RATE LIMIT HIT! Alpaca is blocking API requests.`);
        await discordNotifier.sendError('Alpaca Rate Limit Hit', error);
      } else if ((error.message.includes('404') || error.message.includes('Not Found')) && symbol.includes('/')) {
        // Only notify for crypto 404s since those indicate config issues
        debugLog(`🚨 Symbol ${symbol} NOT FOUND - Check if crypto trading is enabled`);
        await discordNotifier.sendError(`Crypto Symbol ${symbol} Not Found`, error);
      }
      // Silently handle empty bars for stocks during after-hours (expected behavior)

      return [];
    }
  }

  async getHistoricalBars(symbol, timeframe, startDate, endDate, limit = 1000) {
    try {
      const bars = await this.alpaca.getBarsV2(symbol, {
        start: startDate,
        end: endDate,
        limit: limit,
        timeframe: timeframe,
        adjustment: 'raw'
      });

      const barData = [];
      for await (let bar of bars) {
        barData.push(bar);
      }
      return barData;
    } catch (error) {
      debugLog(`Failed to get historical bars for ${symbol}: ${error.message}`);
      return [];
    }
  }

  async getLatestTrade(symbol) {
    try {
      const trade = await this.alpaca.getLatestTrade(symbol);
      return trade;
    } catch (error) {
      debugLog(`Failed to get latest trade for ${symbol}: ${error.message}`);
      return null;
    }
  }

  async placeOrder(orderParams) {
    try {
      const order = await this.alpaca.createOrder(orderParams);
      await this.updateOrders();

      await discordNotifier.sendTradeNotification({
        action: orderParams.side.toUpperCase(),
        symbol: orderParams.symbol,
        qty: orderParams.qty,
        type: orderParams.type,
        orderClass: orderParams.order_class,
        stopLoss: orderParams.stop_loss?.stop_price,
        takeProfit: orderParams.take_profit?.limit_price
      });

      return order;
    } catch (error) {
      await discordNotifier.sendError(`Failed to place order for ${orderParams.symbol}`, error);
      throw error;
    }
  }

  async buyMarket(symbol, qty, stopLoss, takeProfit) {
    // For quantities >= 1, use bracket orders with whole shares
    // For fractional quantities, use simple market orders with separate stop-loss/take-profit
    const roundedQty = Math.floor(qty);

    let orderParams;
    let needsSeparateOrders = false;

    if (roundedQty >= 1) {
      // Whole shares: use bracket order with stop-loss and take-profit
      orderParams = {
        symbol: symbol,
        qty: roundedQty,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
        order_class: 'bracket',
        stop_loss: {
          stop_price: parseFloat(stopLoss.toFixed(2))
        },
        take_profit: {
          limit_price: parseFloat(takeProfit.toFixed(2))
        }
      };
    } else {
      // Fractional shares: use simple market order
      debugLog(`Using fractional order for ${symbol}: ${qty.toFixed(4)} shares`);
      orderParams = {
        symbol: symbol,
        qty: parseFloat(qty.toFixed(4)), // Support up to 4 decimal places
        side: 'buy',
        type: 'market',
        time_in_force: 'day'
      };
      needsSeparateOrders = true;
    }

    const mainOrder = await this.placeOrder(orderParams);

    // For fractional shares, create separate stop-loss and take-profit orders
    if (needsSeparateOrders) {
      try {
        // Wait a moment for the main order to fill
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Create stop-loss order
        const stopLossOrder = {
          symbol: symbol,
          qty: parseFloat(qty.toFixed(4)),
          side: 'sell',
          type: 'stop',
          time_in_force: 'gtc',
          stop_price: parseFloat(stopLoss.toFixed(2))
        };

        // Create take-profit order
        const takeProfitOrder = {
          symbol: symbol,
          qty: parseFloat(qty.toFixed(4)),
          side: 'sell',
          type: 'limit',
          time_in_force: 'gtc',
          limit_price: parseFloat(takeProfit.toFixed(2))
        };

        await this.alpaca.createOrder(stopLossOrder);
        await this.alpaca.createOrder(takeProfitOrder);

        debugLog(`Created separate SL ($${stopLoss.toFixed(2)}) and TP ($${takeProfit.toFixed(2)}) orders for ${symbol}`);
      } catch (error) {
        debugLog(`Failed to create stop-loss/take-profit orders for ${symbol}: ${error.message}`);
        // Don't fail the main order if SL/TP creation fails
      }
    }

    return mainOrder;
  }

  async sellMarket(symbol, qty = null) {
    try {
      const position = await this.getPosition(symbol);
      if (!position) {
        throw new Error(`No position found for ${symbol}`);
      }

      const orderParams = {
        symbol: symbol,
        qty: qty || Math.abs(position.qty),
        side: 'sell',
        type: 'market',
        time_in_force: 'gtc'
      };

      return await this.placeOrder(orderParams);
    } catch (error) {
      await discordNotifier.sendError(`Failed to sell ${symbol}`, error);
      throw error;
    }
  }

  async closePosition(symbol) {
    try {
      await this.alpaca.closePosition(symbol);
      await this.updatePositions();

      await discordNotifier.sendTradeNotification({
        action: 'CLOSE',
        symbol: symbol,
        qty: 'ALL',
        type: 'market'
      });

      return true;
    } catch (error) {
      // Enhanced error logging to capture exact Alpaca API response
      const errorDetails = {
        message: error.message,
        statusCode: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        fullError: JSON.stringify(error, null, 2)
      };

      debugLog(`❌ CLOSE POSITION ERROR for ${symbol}:`);
      debugLog(`   Status: ${errorDetails.statusCode} ${errorDetails.statusText}`);
      debugLog(`   Message: ${errorDetails.message}`);
      debugLog(`   Response: ${JSON.stringify(errorDetails.responseData)}`);

      await discordNotifier.sendError(`Failed to close position for ${symbol}`, error);
      throw error;
    }
  }

  async cancelOrder(orderId) {
    try {
      await this.alpaca.cancelOrder(orderId);
      await this.updateOrders();
      return true;
    } catch (error) {
      await discordNotifier.sendError(`Failed to cancel order ${orderId}`, error);
      throw error;
    }
  }

  async cancelAllOrders() {
    try {
      await this.alpaca.cancelAllOrders();
      this.orders.clear();
      return true;
    } catch (error) {
      await discordNotifier.sendError('Failed to cancel all orders', error);
      throw error;
    }
  }

  getPortfolioValue() {
    return this.account ? parseFloat(this.account.equity) : 0;
  }

  getBuyingPower() {
    return this.account ? parseFloat(this.account.buying_power) : 0;
  }

  getDayPL() {
    return this.account ? parseFloat(this.account.equity) - parseFloat(this.account.last_equity) : 0;
  }

  getDayPLPercent() {
    if (!this.account) return 0;
    const lastEquity = parseFloat(this.account.last_equity);
    if (lastEquity === 0) return 0;
    return ((parseFloat(this.account.equity) - lastEquity) / lastEquity) * 100;
  }
}

export const alpacaClient = new AlpacaClient();
