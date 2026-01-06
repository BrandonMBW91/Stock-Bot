<img width="1022" height="593" alt="image" src="https://github.com/user-attachments/assets/53b81443-5e3f-4b9d-b54a-b0493dffcb01" />


# Alpaca Trading Bot v2.0

A sophisticated multi-strategy trading bot for Alpaca Markets supporting both cryptocurrency and stock trading with real-time monitoring, adaptive risk management, and Discord notifications.

## Features

- **🔥 Hot Signal Indicator** ⭐ NEW!
  - Real-time countdown to next market scan
  - Visual alert when signals approach trade threshold
  - 1-second dashboard updates

- **🔄 Auto-Restart Wrapper** ⭐ NEW!
  - Automatic recovery from crashes
  - Rate limiting (max 10 restarts/hour)
  - Graceful shutdown handling

- **📊 Backtesting Mode** ⭐ NEW!
  - Test strategies on historical data
  - Comprehensive performance metrics
  - Strategy comparison and recommendations

- **🎯 Intelligent Trend Rotation**
  - Analyzes ALL assets every 4 hours
  - 100-point scoring system (momentum, trend, volume, technicals, volatility)
  - Focuses trading on top 50% trending assets
  - Market sentiment analysis (BULLISH/BEARISH)
  - Discord notifications on each rotation

- **Multi-Strategy Trading**
  - Scalping (1-minute timeframe)
  - Day Trading (5-minute timeframe)
  - Swing Trading (4-hour timeframe)

- **Advanced Technical Analysis**
  - RSI Slope Analysis (momentum detection)
  - Multi-timeframe confirmation
  - Correlation analysis (max 2 positions per group)
  - MACD, Moving Averages, Bollinger Bands, ATR
  - Volume analysis

- **Adaptive Risk Management**
  - ATR-based stop-loss and take-profit
  - Drawdown protection with consecutive loss limits
  - Portfolio heat management (max 40% exposure)
  - Sentiment-based position sizing
  - Symbol locking to prevent strategy conflicts
  - Time-of-day filtering for optimal trading hours

- **Real-Time Monitoring**
  - In-place dashboard updates (no scrolling)
  - Live portfolio tracking with color coding
  - Position monitoring with P/L visualization
  - Signal detection display
  - Recent trades log
  - Hot signal alerts

- **Discord Integration**
  - Trade notifications
  - Error alerts
  - Daily performance summaries
  - Trend rotation updates

## Supported Assets

### Cryptocurrencies
- BTC/USD, ETH/USD, DOGE/USD, LTC/USD, SOL/USD
- AVAX/USD, AAVE/USD, LINK/USD, DOT/USD, UNI/USD, SHIB/USD

### Stocks
- SPY, QQQ, AAPL, MSFT, GOOGL, AMZN, TSLA, NVDA, META, AMD

## Installation

1. Install Node.js (version 18 or higher)

2. Install dependencies:
```bash
npm install
```

3. Configure your settings in `config.json`:
   - Alpaca API credentials
   - Discord webhook URLs
   - Trading parameters
   - Asset lists
   - Strategy settings

## Usage

### Normal Start
```bash
npm start
```

### Auto-Restart Mode (Recommended for Live Trading)
```bash
npm run restart
```
- Automatically restarts if bot crashes
- Logs all restarts to `restart.log`
- Press Ctrl+C to stop gracefully

### Backtesting Mode
```bash
npm run backtest
```
- Tests strategies on last 30 days of data
- Shows win rate, profit factor, drawdown
- Provides recommendations before live trading

## New Features Explained

### Hot Signal Indicator
The dashboard now shows:
- **Countdown timer**: "Next scan in 45s" between market analysis cycles
- **Hot signal alert**: 🔥 when signals with strength ≥65 are detected (approaching trade threshold of 70)
- Helps you anticipate when trades are about to happen

### Auto-Restart Wrapper
- Monitors the bot process
- Automatically restarts on crashes (max 10/hour)
- 5-second delay between restarts
- Logs all events to `restart.log`
- Won't restart if you manually stop (Ctrl+C or exit code 0)

### Backtesting Mode
Test your strategies before risking real money:
- Simulates trades on historical data
- Calculates performance metrics
- Shows strategy breakdown
- Provides actionable recommendations
- Customize test period and symbols in `backtest.js`

## Risk Management

The bot includes multiple safety mechanisms:

1. **Adaptive Stop-Loss**: ATR-based (2x ATR or min 2%)
2. **Adaptive Take-Profit**: 2:1 reward-to-risk ratio
3. **Drawdown Protection**: Reduces position size after 3 consecutive losses
4. **Portfolio Heat**: Maximum 40% of capital at risk
5. **Correlation Limits**: Max 2 positions per correlation group
6. **Time-of-Day Filtering**: Avoids poor trading hours
7. **Daily Loss Limit**: Emergency stop at 5% daily loss
8. **Symbol Locking**: Prevents multiple strategies trading same symbol

## Strategy Details

### Scalping Strategy
- Timeframe: 1 minute
- Uses RSI slope for momentum detection
- Multi-timeframe confirmation required
- Time filter: Trades only during PRIME/GOOD hours
- Target: Quick gains with tight stops

### Day Trading Strategy
- Timeframe: 5 minutes
- RSI slope + MACD + trend confirmation
- Multi-timeframe confirmation required
- Correlation-aware position management
- ATR-based adaptive stops

### Swing Trading Strategy
- Timeframe: 4 hours
- Bollinger Bands + SMA trend confirmation
- Multi-timeframe analysis
- Wider stops for trend following
- Target: Larger moves with patience

## Warning

**IMPORTANT**: This bot trades with REAL MONEY.

- **RUN BACKTESTING FIRST**: `npm run backtest`
- Start with small amounts
- Monitor the bot regularly
- Understand the strategies before running
- Be aware that trading involves risk of loss
- Past performance does not guarantee future results

## Trading Mode

The bot is currently configured for **LIVE TRADING**. To switch to paper trading:

1. Open `config.json`
2. Change `"paper": false` to `"paper": true`
3. Restart the bot

## Architecture

```
Bot/
├── config.json                      # Configuration
├── package.json                     # Dependencies
├── restart.js                       # Auto-restart wrapper
├── backtest.js                      # Backtesting engine
├── src/
│   ├── index.js                    # Entry point
│   ├── analysis/
│   │   ├── TechnicalAnalysis.js    # Indicators
│   │   ├── TrendAnalyzer.js        # Trend scoring
│   │   ├── RSISlope.js             # Momentum detection
│   │   ├── MultiTimeframeAnalyzer.js
│   │   └── CorrelationAnalyzer.js
│   ├── core/
│   │   ├── TradingEngine.js        # Main logic
│   │   ├── AdaptiveRiskManager.js  # Dynamic risk management
│   │   └── PortfolioTracker.js     # Portfolio tracking
│   ├── strategies/
│   │   ├── BaseStrategy.js
│   │   ├── ScalpingStrategy.js
│   │   ├── DayTradingStrategy.js
│   │   └── SwingTradingStrategy.js
│   ├── ui/
│   │   └── InPlaceDashboard.js     # Real-time HUD
│   └── utils/
│       ├── AlpacaClient.js
│       ├── ConfigManager.js
│       ├── DiscordNotifier.js
│       ├── MarketHours.js
│       └── TimeOfDayFilter.js
└── logs/                            # Log files
```

## License

MIT

## Disclaimer

This software is for educational purposes. Use at your own risk. The authors are not responsible for any financial losses incurred through the use of this bot.

---

🤖 Built with Claude Code
