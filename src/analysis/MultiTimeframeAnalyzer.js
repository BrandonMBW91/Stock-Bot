import { technicalAnalysis } from './TechnicalAnalysis.js';
import { rsiSlope } from './RSISlope.js';

export class MultiTimeframeAnalyzer {
  /**
   * Require confirmation across multiple timeframes
   * Dramatically improves win rate by filtering false signals
   */
  static async analyzeWithConfirmation(symbol, bars1m, bars5m, bars1h, alpacaClient) {
    const analysis = {
      symbol: symbol,
      confirmed: false,
      signal: 'NEUTRAL',
      strength: 0,
      timeframes: {}
    };

    // Analyze each timeframe
    if (bars1m && bars1m.length >= 50) {
      analysis.timeframes.tf1m = this.analyzeTimeframe(bars1m, '1m');
    }

    if (bars5m && bars5m.length >= 50) {
      analysis.timeframes.tf5m = this.analyzeTimeframe(bars5m, '5m');
    }

    if (bars1h && bars1h.length >= 50) {
      analysis.timeframes.tf1h = this.analyzeTimeframe(bars1h, '1h');
    }

    // Check for confirmation
    const confirmation = this.checkConfirmation(analysis.timeframes);
    analysis.confirmed = confirmation.confirmed;
    analysis.signal = confirmation.signal;
    analysis.strength = confirmation.strength;
    analysis.reasoning = confirmation.reasoning;

    return analysis;
  }

  static analyzeTimeframe(bars, timeframe) {
    const rsiAnalysis = rsiSlope.analyze(bars, 14, 3);
    const macd = technicalAnalysis.calculateMACD(bars);
    const trend = technicalAnalysis.detectTrend(bars);
    const volume = technicalAnalysis.analyzeVolume(bars);

    let signal = 'NEUTRAL';
    let strength = 0;

    // RSI slope-based signal
    if (rsiSlope.isBullish(rsiAnalysis)) {
      signal = 'BUY';
      strength += rsiAnalysis.strength || 50;
    } else if (rsiSlope.isBearish(rsiAnalysis)) {
      signal = 'SELL';
      strength += rsiAnalysis.strength || 50;
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
    if (volume.isHighVolume && signal !== 'NEUTRAL') {
      strength += 10;
    }

    return {
      timeframe: timeframe,
      signal: signal,
      strength: Math.min(strength, 100),
      rsi: rsiAnalysis,
      macd: macd,
      trend: trend,
      volume: volume
    };
  }

  static checkConfirmation(timeframes) {
    const signals = Object.values(timeframes).filter(tf => tf);

    if (signals.length === 0) {
      return {
        confirmed: false,
        signal: 'NEUTRAL',
        strength: 0,
        reasoning: 'No timeframe data available'
      };
    }

    const buySignals = signals.filter(tf => tf.signal === 'BUY');
    const sellSignals = signals.filter(tf => tf.signal === 'SELL');

    // Require at least 2 timeframes to agree
    if (buySignals.length >= 2) {
      const avgStrength = buySignals.reduce((sum, tf) => sum + tf.strength, 0) / buySignals.length;

      // Additional confirmation: Higher timeframe must also be bullish
      const higherTF = signals.find(tf => tf.timeframe === '1h' || tf.timeframe === '5m');
      const higherTFBullish = higherTF && higherTF.trend === 'UPTREND';

      return {
        confirmed: true,
        signal: 'BUY',
        strength: higherTFBullish ? avgStrength + 10 : avgStrength,
        reasoning: `${buySignals.length}/${signals.length} timeframes bullish${higherTFBullish ? ' + higher TF confirms' : ''}`
      };
    }

    if (sellSignals.length >= 2) {
      const avgStrength = sellSignals.reduce((sum, tf) => sum + tf.strength, 0) / sellSignals.length;

      const higherTF = signals.find(tf => tf.timeframe === '1h' || tf.timeframe === '5m');
      const higherTFBearish = higherTF && higherTF.trend === 'DOWNTREND';

      return {
        confirmed: true,
        signal: 'SELL',
        strength: higherTFBearish ? avgStrength + 10 : avgStrength,
        reasoning: `${sellSignals.length}/${signals.length} timeframes bearish${higherTFBearish ? ' + higher TF confirms' : ''}`
      };
    }

    return {
      confirmed: false,
      signal: 'NEUTRAL',
      strength: 0,
      reasoning: `Conflicting signals: ${buySignals.length} BUY, ${sellSignals.length} SELL`
    };
  }

  /**
   * Quick check - just need 2 timeframes agreeing
   */
  static quickCheck(signal1m, signal5m) {
    if (signal1m === signal5m && signal1m !== 'NEUTRAL') {
      return {
        confirmed: true,
        signal: signal1m
      };
    }

    return {
      confirmed: false,
      signal: 'NEUTRAL'
    };
  }
}

export const multiTimeframeAnalyzer = MultiTimeframeAnalyzer;
