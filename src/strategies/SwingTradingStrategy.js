import { BaseStrategy } from './BaseStrategy.js';
import { technicalAnalysis } from '../analysis/TechnicalAnalysis.js';
import { config } from '../utils/ConfigManager.js';
import { adaptiveRiskManager } from '../core/AdaptiveRiskManager.js';
import { multiTimeframeAnalyzer } from '../analysis/MultiTimeframeAnalyzer.js';
import { timeOfDayFilter } from '../utils/TimeOfDayFilter.js';
import { correlationAnalyzer } from '../analysis/CorrelationAnalyzer.js';
import { rsiSlope } from '../analysis/RSISlope.js';

export class SwingTradingStrategy extends BaseStrategy {
  constructor() {
    super('Swing Trading', '4Hour');
    this.minSignalStrength = 50; // Lowered to generate more signals for Market Heat
  }

  async analyze(symbol, bars, alpacaClient) {
    if (!bars || bars.length < 200) {
      return { signal: 'NEUTRAL', strength: 0 };
    }

    // Get multiple timeframes for confirmation
    const bars4h = bars; // Already have 4h
    const bars1d = await alpacaClient.getBars(symbol, '1Day', 100);

    // Multi-timeframe confirmation (4h + daily)
    const mtfAnalysis = await multiTimeframeAnalyzer.analyzeWithConfirmation(
      symbol, bars4h, bars4h, bars1d, alpacaClient
    );

    if (!mtfAnalysis.confirmed) {
      return { signal: 'NEUTRAL', strength: 0 };
    }

    // Use RSI slope for better signal detection
    const rsiAnalysis = rsiSlope.analyze(bars, 14, 3);
    const sma50 = technicalAnalysis.calculateSMA(bars, 50);
    const sma200 = technicalAnalysis.calculateSMA(bars, 200);
    const macd = technicalAnalysis.calculateMACD(bars);
    const trend = technicalAnalysis.detectTrend(bars);
    const volume = technicalAnalysis.analyzeVolume(bars);

    let signal = 'NEUTRAL';
    let strength = 0;

    // RSI slope-based signals
    if (rsiSlope.isBullish(rsiAnalysis)) {
      signal = 'BUY';
      strength = rsiAnalysis.strength || 70;
    } else if (rsiSlope.isBearish(rsiAnalysis)) {
      signal = 'SELL';
      strength = rsiAnalysis.strength || 70;
    }

    // SMA golden/death cross (stronger for swing trading)
    const currentPrice = bars[bars.length - 1].c;
    if (currentPrice > sma50 && sma50 > sma200 && signal === 'BUY') {
      strength += 15; // Golden cross bonus
    } else if (currentPrice < sma50 && sma50 < sma200 && signal === 'SELL') {
      strength += 15; // Death cross bonus
    }

    // MACD confirmation
    if (macd && macd.MACD > macd.signal && signal === 'BUY') {
      strength += 10;
    } else if (macd && macd.MACD < macd.signal && signal === 'SELL') {
      strength += 10;
    }

    // Strong trend confirmation (more important for swing trades)
    if (trend === 'UPTREND' && signal === 'BUY') {
      strength += 15;
    } else if (trend === 'DOWNTREND' && signal === 'SELL') {
      strength += 15;
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
        price: currentPrice,
        rsi: rsiAnalysis.current,
        rsiSlope: rsiAnalysis.slope,
        rsiDirection: rsiAnalysis.direction,
        sma50: sma50,
        sma200: sma200,
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

      // Swing trading is OK anytime (no time filter for swing)
      // But we still check quality for position sizing
      const quality = timeOfDayFilter.getTradeQuality(assetType);
      const qualityMultiplier = timeOfDayFilter.getQualityMultiplier(quality);

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

          let positionSize = await adaptiveRiskManager.calculatePositionSize(signal.price);

          // Apply time quality multiplier
          positionSize *= qualityMultiplier;

          const qty = Math.floor(positionSize / signal.price);

          if (qty < 1) {
            console.log(`Position size too small for ${symbol}`);
            adaptiveRiskManager.releaseLock(symbol);
            return null;
          }

          // Use adaptive stop-loss and take-profit (wider for swing trades)
          let stopLoss = await adaptiveRiskManager.calculateAdaptiveStopLoss(
            symbol, signal.price, bars
          );
          let takeProfit = await adaptiveRiskManager.calculateAdaptiveTakeProfit(
            symbol, signal.price, bars
          );

          // Swing trades need wider stops (1.5x for SL, 2x for TP)
          const stopLossPercent = ((signal.price - stopLoss) / signal.price) * 100;
          const takeProfitPercent = ((takeProfit - signal.price) / signal.price) * 100;

          stopLoss = signal.price * (1 - (stopLossPercent * 1.5) / 100);
          takeProfit = signal.price * (1 + (takeProfitPercent * 2) / 100);

          console.log(`Swing Trading ${symbol}:`);
          console.log(`  Price: $${signal.price.toFixed(2)}`);
          console.log(`  Stop Loss: $${stopLoss.toFixed(2)} (${(((signal.price - stopLoss) / signal.price) * 100).toFixed(2)}%)`);
          console.log(`  Take Profit: $${takeProfit.toFixed(2)} (${(((takeProfit - signal.price) / signal.price) * 100).toFixed(2)}%)`);
          console.log(`  Correlation: ${correlationCheck.reason}`);
          console.log(`  Multi-timeframe: ${signal.mtfReasoning}`);
          console.log(`  Time quality: ${quality} (${qualityMultiplier}x multiplier)`);

          const order = await alpacaClient.buyMarket(symbol, qty, stopLoss, takeProfit);

          this.recordTrade({
            symbol: symbol,
            side: 'BUY',
            qty: qty,
            price: signal.price,
            strategy: this.name,
            rsi: signal.rsi,
            rsiSlope: signal.rsiSlope,
            sma50: signal.sma50,
            sma200: signal.sma200,
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
