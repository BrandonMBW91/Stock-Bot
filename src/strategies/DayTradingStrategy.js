import { BaseStrategy } from './BaseStrategy.js';
import { technicalAnalysis } from '../analysis/TechnicalAnalysis.js';
import { config } from '../utils/ConfigManager.js';
import { adaptiveRiskManager } from '../core/AdaptiveRiskManager.js';
import { multiTimeframeAnalyzer } from '../analysis/MultiTimeframeAnalyzer.js';
import { timeOfDayFilter } from '../utils/TimeOfDayFilter.js';
import { correlationAnalyzer } from '../analysis/CorrelationAnalyzer.js';
import { rsiSlope } from '../analysis/RSISlope.js';

export class DayTradingStrategy extends BaseStrategy {
  constructor() {
    super('Day Trading', '5Min');
    this.minSignalStrength = 45; // Lowered to generate more signals for Market Heat
  }

  async analyze(symbol, bars, alpacaClient) {
    if (!bars || bars.length < 50) {
      return { signal: 'NEUTRAL', strength: 0 };
    }

    // Get multiple timeframes for confirmation
    const bars5m = bars; // Already have 5m
    const bars1h = await alpacaClient.getBars(symbol, '1Hour', 100);

    // Multi-timeframe confirmation
    const mtfAnalysis = await multiTimeframeAnalyzer.analyzeWithConfirmation(
      symbol, bars5m, bars5m, bars1h, alpacaClient
    );

    if (!mtfAnalysis.confirmed) {
      return { signal: 'NEUTRAL', strength: 0 };
    }

    // Use RSI slope instead of simple range checks
    const rsiAnalysis = rsiSlope.analyze(bars, 14, 3);
    const macd = technicalAnalysis.calculateMACD(bars);
    const trend = technicalAnalysis.detectTrend(bars);
    const volume = technicalAnalysis.analyzeVolume(bars);

    let signal = 'NEUTRAL';
    let strength = 0;

    // RSI slope-based signals
    if (rsiSlope.isBullish(rsiAnalysis)) {
      signal = 'BUY';
      strength = rsiAnalysis.strength || 60;
    } else if (rsiSlope.isBearish(rsiAnalysis)) {
      signal = 'SELL';
      strength = rsiAnalysis.strength || 60;
    }

    // MACD confirmation
    if (macd && macd.MACD > macd.signal && signal === 'BUY') {
      strength += 10;
    } else if (macd && macd.MACD < macd.signal && signal === 'SELL') {
      strength += 10;
    }

    // Trend confirmation
    if (trend === 'UPTREND' && signal === 'BUY') {
      strength += 10;
    } else if (trend === 'DOWNTREND' && signal === 'SELL') {
      strength += 10;
    }

    // Volume confirmation
    if (volume.isHighVolume) {
      strength += 5;
    }

    // Multi-timeframe bonus
    strength += mtfAnalysis.strength ? 10 : 0;

    if (strength >= this.minSignalStrength) {
      return {
        signal: signal,
        strength: Math.min(strength, 100),
        price: bars[bars.length - 1].c,
        rsi: rsiAnalysis.current,
        rsiSlope: rsiAnalysis.slope,
        rsiDirection: rsiAnalysis.direction,
        macd: macd,
        trend: trend,
        mtfReasoning: mtfAnalysis.reasoning,
        strategy: this.name
      };
    }

    return { signal: 'NEUTRAL', strength: 0 };
  }

  async execute(symbol, signal, alpacaClient, riskManager) {
    try {
      // Determine asset type
      const assetType = symbol.includes('USD') ? 'crypto' : 'stock';

      // Check time quality (day trading prefers PRIME/GOOD)
      if (timeOfDayFilter.shouldSkipTrade(assetType, this.name)) {
        console.log(`Time filter blocked ${this.name} for ${symbol}`);
        return null;
      }

      const existingPosition = await alpacaClient.getPosition(symbol);

      if (signal.signal === 'BUY' && !existingPosition) {
        // Try to acquire symbol lock
        if (!adaptiveRiskManager.acquireLock(symbol, this.name)) {
          console.log(`${symbol} locked by another strategy`);
          return null;
        }

        try {
          // Get current positions for correlation check
          await alpacaClient.updatePositions();
          const positions = Array.from(alpacaClient.positions.values());

          // Check correlation limits
          const correlationCheck = correlationAnalyzer.canAddPosition(symbol, positions);
          if (!correlationCheck.allowed) {
            console.log(`Correlation block for ${symbol}: ${correlationCheck.reason}`);
            adaptiveRiskManager.releaseLock(symbol);
            return null;
          }

          // Use adaptive risk manager
          const canTrade = await adaptiveRiskManager.canOpenPosition();
          if (!canTrade) {
            console.log(`Adaptive risk manager blocked ${this.name} BUY for ${symbol}`);
            adaptiveRiskManager.releaseLock(symbol);
            return null;
          }

          // Get bars for adaptive calculations
          const bars = await alpacaClient.getBars(symbol, this.timeframe, 100);

          const positionSize = await adaptiveRiskManager.calculatePositionSize(signal.price);
          const qty = Math.floor(positionSize / signal.price);

          if (qty < 1) {
            console.log(`Position size too small for ${symbol}`);
            adaptiveRiskManager.releaseLock(symbol);
            return null;
          }

          // Validate signal price
          if (!signal.price || isNaN(signal.price)) {
            console.log(`Invalid price for ${symbol}, skipping trade`);
            adaptiveRiskManager.releaseLock(symbol);
            return null;
          }

          // Use adaptive stop-loss and take-profit
          const stopLoss = await adaptiveRiskManager.calculateAdaptiveStopLoss(
            symbol, signal.price, bars
          );
          const takeProfit = await adaptiveRiskManager.calculateAdaptiveTakeProfit(
            symbol, signal.price, bars
          );

          // Validate SL/TP
          if (!stopLoss || !takeProfit || isNaN(stopLoss) || isNaN(takeProfit)) {
            console.log(`Invalid stop-loss or take-profit for ${symbol}, skipping trade`);
            adaptiveRiskManager.releaseLock(symbol);
            return null;
          }

          // console.log(`Day Trading ${symbol}:`);
          // console.log(`  Price: $${signal.price.toFixed(2)}`);
          // console.log(`  Stop Loss: $${stopLoss.toFixed(2)} (${(((signal.price - stopLoss) / signal.price) * 100).toFixed(2)}%)`);
          // console.log(`  Take Profit: $${takeProfit.toFixed(2)} (${(((takeProfit - signal.price) / signal.price) * 100).toFixed(2)}%)`);
          // console.log(`  Correlation: ${correlationCheck.reason}`);
          // console.log(`  Multi-timeframe: ${signal.mtfReasoning}`);

          const order = await alpacaClient.buyMarket(symbol, qty, stopLoss, takeProfit);

          this.recordTrade({
            symbol: symbol,
            side: 'BUY',
            qty: qty,
            price: signal.price,
            strategy: this.name,
            rsi: signal.rsi,
            rsiSlope: signal.rsiSlope,
            trend: signal.trend,
            stopLoss: stopLoss,
            takeProfit: takeProfit
          });

          // Release lock after successful execution
          adaptiveRiskManager.releaseLock(symbol);

          return order;
        } catch (error) {
          // Release lock on error
          adaptiveRiskManager.releaseLock(symbol);
          throw error;
        }
      } else if (signal.signal === 'SELL' && existingPosition) {
        // Determine if position was profitable
        const entryPrice = parseFloat(existingPosition.avg_entry_price);
        const exitPrice = signal.price;
        const isWin = exitPrice > entryPrice;

        // Record result for drawdown protection
        adaptiveRiskManager.recordTradeResult(isWin);

        console.log(`Closing ${symbol}: ${isWin ? 'WIN' : 'LOSS'} (Entry: $${entryPrice.toFixed(2)}, Exit: $${exitPrice.toFixed(2)})`);

        const order = await alpacaClient.closePosition(symbol);

        this.recordTrade({
          symbol: symbol,
          side: 'SELL',
          qty: Math.abs(existingPosition.qty),
          price: signal.price,
          strategy: this.name,
          isWin: isWin
        });

        return order;
      }

      return null;
    } catch (error) {
      console.error(`Error executing ${this.name} for ${symbol}:`, error.message);
      return null;
    }
  }
}
