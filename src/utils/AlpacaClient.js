import Alpaca from '@alpacahq/alpaca-trade-api';
import { config } from './ConfigManager.js';
import { discordNotifier } from './DiscordNotifier.js';

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
      const bars = await this.alpaca.getBarsV2(symbol, {
        limit: limit,
        timeframe: timeframe,
        adjustment: 'raw'
      });

      const barData = [];
      for await (let bar of bars) {
        barData.push(bar);
      }

      if (barData.length === 0) {
        console.log(`⚠️  NO BARS returned for ${symbol} ${timeframe} (limit=${limit})`);
      } else {
        // Cache successful results
        if (!this._barsCache) this._barsCache = {};
        this._barsCache[cacheKey] = { data: barData, timestamp: now };
      }

      return barData;
    } catch (error) {
      console.error(`❌ Failed to get bars for ${symbol}:`, error.message);

      if (error.message.includes('rate limit') || error.message.includes('429')) {
        console.error(`🚨 RATE LIMIT HIT! Alpaca is blocking API requests.`);
      } else if (error.message.includes('404') || error.message.includes('Not Found')) {
        console.error(`🚨 Symbol ${symbol} NOT FOUND - Check if:`);
        console.error(`   1. Your Alpaca account has crypto trading enabled`);
        console.error(`   2. Symbol format is correct (try BTC/USD or BTCUSD)`);
        console.error(`   3. Your region is approved for crypto trading`);
      }

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
      console.error(`Failed to get historical bars for ${symbol}:`, error.message);
      return [];
    }
  }

  async getLatestTrade(symbol) {
    try {
      const trade = await this.alpaca.getLatestTrade(symbol);
      return trade;
    } catch (error) {
      console.error(`Failed to get latest trade for ${symbol}:`, error.message);
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
    const orderParams = {
      symbol: symbol,
      qty: qty,
      side: 'buy',
      type: 'market',
      time_in_force: 'gtc',
      order_class: 'bracket',
      stop_loss: {
        stop_price: stopLoss
      },
      take_profit: {
        limit_price: takeProfit
      }
    };

    return await this.placeOrder(orderParams);
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
