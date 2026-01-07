import { RSI } from 'technicalindicators';

export class RSISlope {
  /**
   * Calculate RSI slope and direction for better momentum detection
   * @param {Array} bars - Price bars
   * @param {number} period - RSI period (default 14)
   * @param {number} slopePeriod - Number of periods to calculate slope (default 3)
   * @returns {Object} RSI analysis with slope and direction
   */
  static analyze(bars, period = 14, slopePeriod = 3) {
    const closes = bars.map(b => b.ClosePrice || b.c);

    const rsiValues = RSI.calculate({
      values: closes,
      period: period
    });

    if (rsiValues.length < slopePeriod) {
      return null;
    }

    const currentRSI = rsiValues[rsiValues.length - 1];
    const recentRSI = rsiValues.slice(-slopePeriod);

    // Calculate slope (rate of change)
    const slope = this.calculateSlope(recentRSI);

    // Determine direction
    const direction = this.getDirection(recentRSI);

    // Momentum strength (how strong is the slope)
    const momentum = Math.abs(slope);

    return {
      current: currentRSI,
      slope: slope,
      direction: direction,
      momentum: momentum,
      signal: this.getSignal(currentRSI, slope, direction),
      strength: this.getStrength(currentRSI, slope, direction, momentum)
    };
  }

  /**
   * Calculate linear regression slope
   */
  static calculateSlope(values) {
    const n = values.length;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (values[i] - yMean);
      denominator += Math.pow(i - xMean, 2);
    }

    return numerator / denominator;
  }

  /**
   * Determine overall direction
   */
  static getDirection(values) {
    if (values.length < 2) return 'FLAT';

    const increasing = values.filter((val, i) => i > 0 && val > values[i - 1]).length;
    const decreasing = values.filter((val, i) => i > 0 && val < values[i - 1]).length;

    if (increasing > decreasing) return 'UP';
    if (decreasing > increasing) return 'DOWN';
    return 'FLAT';
  }

  /**
   * Generate trading signal based on RSI slope analysis
   * RELAXED thresholds to generate more signals for Market Heat
   */
  static getSignal(currentRSI, slope, direction) {
    // Strong bullish: RSI rising from oversold
    if (currentRSI < 40 && slope > 1.5 && direction === 'UP') {
      return 'STRONG_BUY';
    }

    // Bullish: RSI trending up with momentum (RELAXED from 1 to 0.5)
    if (currentRSI > 30 && currentRSI < 60 && slope > 0.5 && direction === 'UP') {
      return 'BUY';
    }

    // Weak bullish: RSI rising but approaching overbought (RELAXED from 0.5 to 0.3)
    if (currentRSI > 50 && currentRSI < 70 && slope > 0.3 && direction === 'UP') {
      return 'WEAK_BUY';
    }

    // Strong bearish: RSI falling from overbought (RELAXED from -2 to -1.5)
    if (currentRSI > 60 && slope < -1.5 && direction === 'DOWN') {
      return 'STRONG_SELL';
    }

    // Bearish: RSI trending down with momentum (RELAXED from -1 to -0.5)
    if (currentRSI > 40 && currentRSI < 70 && slope < -0.5 && direction === 'DOWN') {
      return 'SELL';
    }

    // Weak bearish: RSI falling but approaching oversold (RELAXED from -0.5 to -0.3)
    if (currentRSI > 30 && currentRSI < 50 && slope < -0.3 && direction === 'DOWN') {
      return 'WEAK_SELL';
    }

    // Reversal signals (no change, already sensitive)
    if (currentRSI < 30 && slope > 0 && direction === 'UP') {
      return 'REVERSAL_BUY'; // Bouncing from oversold
    }

    if (currentRSI > 70 && slope < 0 && direction === 'DOWN') {
      return 'REVERSAL_SELL'; // Dropping from overbought
    }

    return 'NEUTRAL';
  }

  /**
   * Calculate signal strength (0-100)
   */
  static getStrength(currentRSI, slope, direction, momentum) {
    let strength = 50; // Base neutral

    // Add for slope magnitude
    strength += Math.min(momentum * 5, 20);

    // Add for direction consistency
    if (direction !== 'FLAT') {
      strength += 10;
    }

    // Add for optimal RSI zones
    if (currentRSI > 30 && currentRSI < 70) {
      strength += 10;
    }

    // Bonus for strong momentum in optimal zones
    if ((currentRSI < 40 && slope > 2) || (currentRSI > 60 && slope < -2)) {
      strength += 10;
    }

    return Math.min(strength, 100);
  }

  /**
   * Check if RSI is bullish (better than simple range check)
   */
  static isBullish(analysis) {
    if (!analysis) return false;

    return (
      analysis.signal.includes('BUY') ||
      (analysis.slope > 0 && analysis.direction === 'UP')
    );
  }

  /**
   * Check if RSI is bearish
   */
  static isBearish(analysis) {
    if (!analysis) return false;

    return (
      analysis.signal.includes('SELL') ||
      (analysis.slope < 0 && analysis.direction === 'DOWN')
    );
  }

  /**
   * Check for divergence (price vs RSI)
   */
  static detectDivergence(priceBars, rsiBars) {
    if (priceBars.length < 5 || rsiBars.length < 5) return null;

    const recentPrices = priceBars.slice(-5).map(b => b.ClosePrice || b.c);
    const recentRSI = rsiBars.slice(-5);

    const priceSlope = this.calculateSlope(recentPrices);
    const rsiSlope = this.calculateSlope(recentRSI);

    // Bullish divergence: Price falling but RSI rising
    if (priceSlope < -0.5 && rsiSlope > 0.5) {
      return 'BULLISH_DIVERGENCE';
    }

    // Bearish divergence: Price rising but RSI falling
    if (priceSlope > 0.5 && rsiSlope < -0.5) {
      return 'BEARISH_DIVERGENCE';
    }

    return null;
  }
}

export const rsiSlope = RSISlope;
