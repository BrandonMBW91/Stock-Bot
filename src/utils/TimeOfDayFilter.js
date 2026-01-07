import moment from 'moment-timezone';
import { config } from './ConfigManager.js';

export class TimeOfDayFilter {
  constructor() {
    this.timezone = config.schedule.timezone;
  }

  shouldTradeNow(assetType) {
    const now = moment().tz(this.timezone);
    const hour = now.hour();
    const minute = now.minute();
    const dayOfWeek = now.day();

    // Weekend check
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return assetType === 'crypto'; // Only crypto on weekends
    }

    if (assetType === 'crypto') {
      return this.shouldTradeCrypto(hour, minute);
    } else if (assetType === 'stock') {
      return this.shouldTradeStock(hour, minute);
    }

    return false;
  }

  shouldTradeCrypto(hour, minute) {
    // TEMPORARY: Allow 24/7 crypto trading for testing
    return true;

    // Best crypto trading hours: US trading session (9am-5pm ET)
    // High volume, better liquidity, tighter spreads

    // Prime time: 9:30 AM - 4:00 PM ET
    if (hour >= 9 && hour < 16) {
      // Skip 9:00-9:30 (waiting for stock market open volatility)
      if (hour === 9 && minute < 30) {
        return false;
      }
      return true;
    }

    // Extended hours: 7 AM - 9 AM (pre-market activity)
    if (hour >= 7 && hour < 9) {
      return true;
    }

    // Extended hours: 4 PM - 8 PM (after-market activity)
    if (hour >= 16 && hour < 20) {
      return true;
    }

    // Night trading allowed but less ideal (lower volume)
    // Still allow 24/7 for swing trades, but log warning
    if (hour >= 20 || hour < 7) {
      return true; // Allow but strategies should be more conservative
    }

    return true; // Default: always allow crypto
  }

  shouldTradeStock(hour, minute) {
    // Stock market hours: 9:30 AM - 4:00 PM ET
    // Best trading: First hour (9:30-10:30) and last hour (3:00-4:00)

    // Market not open
    if (hour < 9 || hour >= 16) {
      return false;
    }

    // Before market open
    if (hour === 9 && minute < 30) {
      return false;
    }

    // PRIME TIME: Opening hour (9:30-10:30)
    if ((hour === 9 && minute >= 30) || hour === 10) {
      return true;
    }

    // PRIME TIME: Closing hour (3:00-4:00)
    if (hour === 15) {
      return true;
    }

    // MID-DAY: Lower volume, wider spreads
    // Still allow but less ideal
    if (hour >= 11 && hour < 15) {
      return true; // Allow but be more selective
    }

    return true; // Within market hours
  }

  getTradeQuality(assetType) {
    const now = moment().tz(this.timezone);
    const hour = now.hour();
    const minute = now.minute();

    if (assetType === 'crypto') {
      // PRIME
      if ((hour >= 9 && hour < 16) || (hour >= 7 && hour < 9) || (hour >= 16 && hour < 20)) {
        return 'PRIME';
      }
      // GOOD
      if ((hour >= 20 && hour < 23) || (hour >= 6 && hour < 7)) {
        return 'GOOD';
      }
      // LOW (night hours)
      return 'LOW';
    }

    if (assetType === 'stock') {
      // PRIME: First and last hour
      if ((hour === 9 && minute >= 30) || hour === 10 || hour === 15) {
        return 'PRIME';
      }
      // GOOD: Mid-day
      if (hour >= 11 && hour < 15) {
        return 'GOOD';
      }
      // Market closed
      return 'CLOSED';
    }

    return 'UNKNOWN';
  }

  getQualityMultiplier(quality) {
    switch (quality) {
      case 'PRIME':
        return 1.2; // Increase position size 20% in prime hours
      case 'GOOD':
        return 1.0;
      case 'LOW':
        return 0.7; // Decrease position size 30% in low volume hours
      case 'CLOSED':
        return 0;
      default:
        return 1.0;
    }
  }

  shouldSkipTrade(assetType, strategy) {
    const quality = this.getTradeQuality(assetType);

    // Scalping needs PRIME time only (tight spreads required)
    if (strategy === 'Scalping' && quality !== 'PRIME') {
      console.log(`Skipping scalping trade - time quality: ${quality}`);
      return true;
    }

    // Day trading prefers PRIME/GOOD
    if (strategy === 'Day Trading' && quality === 'LOW') {
      console.log(`Skipping day trade - time quality: ${quality}`);
      return true;
    }

    // Swing trading is OK anytime
    return false;
  }
}

export const timeOfDayFilter = new TimeOfDayFilter();
