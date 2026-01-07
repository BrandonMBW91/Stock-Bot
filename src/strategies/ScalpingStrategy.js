import { BaseStrategy } from './BaseStrategy.js';
import { technicalAnalysis } from '../analysis/TechnicalAnalysis.js';
import { config } from '../utils/ConfigManager.js';
import { portfolioTracker } from '../core/PortfolioTracker.js';
import { adaptiveRiskManager } from '../core/AdaptiveRiskManager.js';
import { multiTimeframeAnalyzer } from '../analysis/MultiTimeframeAnalyzer.js';
import { timeOfDayFilter } from '../utils/TimeOfDayFilter.js';
import { correlationAnalyzer } from '../analysis/CorrelationAnalyzer.js';
import { rsiSlope } from '../analysis/RSISlope.js';

export class ScalpingStrategy extends BaseStrategy {
  constructor() {
    super('Scalping', '1Min');
    this.minSignalStrength = 45; // Lowered to generate more signals for Market Heat
  }

  async analyze(symbol, bars, alpacaClient) {
    if (!bars || bars.length < 50) {
      return { signal: 'NEUTRAL', strength: 0 };
    }

    // Get multiple timeframes for confirmation
    const bars5m = await alpacaClient.getBars(symbol, '5Min', 100);

    // Multi-timeframe confirmation
    if (bars5m && bars5m.length >= 50) {
      const quick = multiTimeframeAnalyzer.quickCheck(
        this.getSignalFromBars(bars),
        this.getSignalFromBars(bars5m)
      );

      if (!quick.confirmed) {
        return { signal: 'NEUTRAL', strength: 0 };
      }
    }

    // Use RSI slope instead of simple range checks
    const rsiAnalysis = rsiSlope.analyze(bars, 14, 3);

    const analysis = technicalAnalysis.analyzeScalping(bars);

    // Combine RSI slope with regular analysis
    let finalSignal = analysis.signal;
    let finalStrength = analysis.strength;

    // RSI slope confirmation
    if (rsiSlope.isBullish(rsiAnalysis) && analysis.signal === 'BUY') {
      finalStrength += 10; // Bonus for slope confirmation
    } else if (rsiSlope.isBearish(rsiAnalysis) && analysis.signal === 'SELL') {
      finalStrength += 10;
    } else if (rsiSlope.isBullish(rsiAnalysis) && analysis.signal === 'SELL') {
      // Conflicting signals - reduce strength
      finalStrength -= 20;
    } else if (rsiSlope.isBearish(rsiAnalysis) && analysis.signal === 'BUY') {
      finalStrength -= 20;
    }

    if (finalStrength >= this.minSignalStrength) {
      return {
        signal: finalSignal,
        strength: finalStrength,
        price: analysis.price,
        rsi: analysis.rsi,
        rsiSlope: rsiAnalysis,
        ema: analysis.ema,
        strategy: this.name,
        bars: bars // Pass bars for adaptive SL/TP
      };
    }

    return { signal: 'NEUTRAL', strength: 0 };
  }

  getSignalFromBars(bars) {
    const analysis = technicalAnalysis.analyzeScalping(bars);
    return analysis.signal;
  }

  async execute(symbol, signal, alpacaClient, riskManager) {
    try {
      // Determine asset type
      const assetType = symbol.includes('USD') ? 'crypto' : 'stock';

      // Time-of-day filter
      if (timeOfDayFilter.shouldSkipTrade(assetType, this.name)) {
        console.log(`⏰ Time filter blocked ${this.name} for ${symbol}`);
        return null;
      }

      const existingPosition = await alpacaClient.getPosition(symbol);

      if (signal.signal === 'BUY' && !existingPosition) {
        // Symbol locking - prevent conflicts
        if (!adaptiveRiskManager.acquireLock(symbol, this.name)) {
          console.log(`🔒 ${symbol} locked by another strategy`);
          return null;
        }

        try {
          // Correlation check
          await alpacaClient.updatePositions();
          const positions = Array.from(alpacaClient.positions.values());
          const correlationCheck = correlationAnalyzer.canAddPosition(symbol, positions);

          if (!correlationCheck.allowed) {
            console.log(`🔗 Correlation block: ${correlationCheck.reason}`);
            adaptiveRiskManager.releaseLock(symbol);
            return null;
          }

          // Use adaptive risk manager
          const canTrade = await adaptiveRiskManager.canOpenPosition();
          if (!canTrade) {
            console.log(`Risk manager blocked ${this.name} BUY for ${symbol}`);
            adaptiveRiskManager.releaseLock(symbol);
            return null;
          }

          const positionSize = await adaptiveRiskManager.calculatePositionSize(signal.price);
          let qty = Math.floor(positionSize / signal.price);

          // Apply time-of-day multiplier
          const timeQuality = timeOfDayFilter.getTradeQuality(assetType);
          const timeMultiplier = timeOfDayFilter.getQualityMultiplier(timeQuality);
          qty = Math.floor(qty * timeMultiplier);

          if (qty < 1) {
            console.log(`Position size too small for ${symbol}`);
            adaptiveRiskManager.releaseLock(symbol);
            return null;
          }

          // Adaptive stop-loss and take-profit
          const stopLoss = await adaptiveRiskManager.calculateAdaptiveStopLoss(
            symbol, signal.price, signal.bars
          );
          const takeProfit = await adaptiveRiskManager.calculateAdaptiveTakeProfit(
            symbol, signal.price, signal.bars
          );

          const order = await alpacaClient.buyMarket(symbol, qty, stopLoss, takeProfit);

          this.recordTrade({
            symbol: symbol,
            side: 'BUY',
            qty: qty,
            price: signal.price,
            strategy: this.name,
            rsi: signal.rsi,
            rsiSlope: signal.rsiSlope?.slope
          });

          portfolioTracker.recordTrade({
            symbol: symbol,
            action: 'BUY',
            side: 'buy',
            qty: qty,
            price: signal.price
          });

          // Release lock after successful execution
          adaptiveRiskManager.releaseLock(symbol);

          return order;
        } catch (error) {
          adaptiveRiskManager.releaseLock(symbol);
          throw error;
        }
      } else if (signal.signal === 'SELL' && existingPosition) {
        const exitPrice = signal.price;
        const entryPrice = parseFloat(existingPosition.avg_entry_price);
        const qty = Math.abs(existingPosition.qty);

        const order = await alpacaClient.closePosition(symbol);

        this.recordTrade({
          symbol: symbol,
          side: 'SELL',
          qty: qty,
          price: exitPrice,
          strategy: this.name
        });

        // Track realized P/L
        portfolioTracker.recordClosedPosition(symbol, exitPrice, qty);

        // Record trade result for drawdown protection
        const isWin = exitPrice > entryPrice;
        adaptiveRiskManager.recordTradeResult(isWin);

        return order;
      }

      return null;
    } catch (error) {
      console.error(`Error executing ${this.name} for ${symbol}:`, error.message);
      return null;
    }
  }
}
