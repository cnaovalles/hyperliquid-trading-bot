const Backtester = require("./Backtester")
const RiskManager = require("./RiskManager")
const fs = require("fs")
const path = require("path")
const yargs = require("yargs/yargs")
const { hideBin } = require("yargs/helpers")

/**
 * Enhanced Backtester that integrates the Risk Manager
 */
class RiskAwareBacktester extends Backtester {
    constructor(options = {}) {
        super(options)

        // Create risk manager with appropriate options
        this.riskManager = new RiskManager({
            initialCapital: this.initialCapital,
            maxRiskPerTrade: options.maxRiskPerTrade || 0.02,
            maxPositionSize: options.maxPositionSize || 0.5,
            maxOpenPositions: options.maxOpenPositions || 1,
            maxDrawdown: options.maxDrawdown || 0.25,
            tradingFee: this.tradingFee,
            useVolatilityAdjustment: options.useVolatilityAdjustment || false,
            pyramiding: options.pyramiding || false,
            pyramidingLevels: options.pyramidingLevels || 3,
            useAntiMartingale: options.useAntiMartingale || false,
            winMultiplier: options.winMultiplier || 1.5,
            lossMultiplier: options.lossMultiplier || 0.7,
            useKellyCriterion: options.useKellyCriterion || false,
            kellyFraction: options.kellyFraction || 0.5,
            volatilityWindow: options.volatilityWindow || 20,
        })

        // Risk-aware statistics
        this.riskStats = []
        this.positionSizes = []
        this.adjustments = []
    }

    /**
     * Override the runBacktest method to add risk management
     */
    async runBacktest() {
        // Load data (same as original)
        this.data = await this.loadMarketData()
        if (!this.data || !this.data.length) {
            throw new Error(`No data found for ${this.market} on ${this.timeframe} timeframe`)
        }

        console.log(`Starting risk-aware backtest with ${this.data.length} bars of data`)
        console.log(`Market: ${this.market}, Timeframe: ${this.timeframe}`)
        console.log(`Initial Capital: $${this.initialCapital}, Leverage: ${this.leverage}`)
        console.log(
            `Position Size: ${this.positionSize * 100}%, Profit Target: ${this.profitTarget}x`,
        )

        // Initialize strategy
        this.strategy = this.createStrategy()

        // Start with initial capital
        this.equity = this.initialCapital
        this.peak = this.initialCapital
        this.position = null
        this.trades = []
        this.equityCurve = []
        this.dailyReturns = []

        // Record start time
        const startTime = new Date()

        // Process each bar
        for (let i = 0; i < this.data.length; i++) {
            // Update risk manager with recent data for volatility calculation
            if (i >= 20) {
                this.riskManager.updateMarketData(this.data.slice(i - 20, i))
            }

            // Get current candle
            const candle = this.data[i]

            // Update equity history
            this.updateEquity(candle.timestamp)

            // Calculate trading signal
            const signal = this.strategy.calculateSignal(this.data, i)

            // Handle open position
            if (this.position) {
                this.handleOpenPosition(candle, signal, i)
            }

            // Check for entry signals if we don't have a position
            if (!this.position && signal !== 0) {
                this.handleEntrySignal(candle, signal, i)
            }

            // Calculate daily returns (for Sharpe ratio)
            if (i > 0) {
                const prevDay = new Date(this.data[i - 1].timestamp).toISOString().split("T")[0]
                const currentDay = new Date(candle.timestamp).toISOString().split("T")[0]

                if (currentDay !== prevDay) {
                    // Store return for the day
                    const dailyReturn =
                        (this.equity - this.previousDayEquity) / this.previousDayEquity
                    this.dailyReturns.push(dailyReturn)
                    this.previousDayEquity = this.equity
                }
            } else {
                this.previousDayEquity = this.equity
            }

            // Capture risk stats periodically
            if (i % 50 === 0 || i === this.data.length - 1) {
                this.riskStats.push({
                    timestamp: candle.timestamp,
                    ...this.riskManager.getRiskStats(),
                })
            }
        }

        // Record end time
        const endTime = new Date()
        const executionTimeMs = endTime - startTime

        // Calculate final metrics
        this.calculateMetrics()

        // Save results
        this.saveResults()

        console.log(`\nBacktest completed in ${executionTimeMs}ms`)
        console.log(`Final Equity: $${this.equity.toFixed(2)}`)
        console.log(`Total Trades: ${this.trades.length}`)
        console.log(`Win Rate: ${(this.metrics.winRate * 100).toFixed(2)}%`)
        console.log(`Profit/Loss: $${this.metrics.totalProfitLoss.toFixed(2)}`)
        console.log(`Max Drawdown: ${(this.metrics.maxDrawdown * 100).toFixed(2)}%`)

        return {
            equity: this.equity,
            trades: this.trades,
            metrics: this.metrics,
            equityCurve: this.equityCurve,
            riskStats: this.riskStats,
            positionSizes: this.positionSizes,
            adjustments: this.adjustments,
        }
    }

    /**
     * Handle entry signals with risk management
     */
    handleEntrySignal(candle, signal, index) {
        // Create trade object
        const trade = {
            entryTime: candle.timestamp,
            entryPrice: signal > 0 ? candle.close : candle.close,
            direction: signal > 0 ? "long" : "short",
            size: null, // To be determined by risk manager
            riskAmount: null,
            stopLoss: null,
        }

        // Get position sizing recommendation from risk manager
        const positionInfo = this.riskManager.calculatePositionSize(trade, this.leverage)

        // Store position size recommendation
        this.positionSizes.push({
            timestamp: candle.timestamp,
            signal: signal,
            direction: trade.direction,
            recommendedSize: positionInfo.size,
            recommendedCapital: positionInfo.capital,
            riskPercentage: positionInfo.riskPercentage,
            reason: positionInfo.reason,
        })

        // Get trade recommendation
        const recommendation = this.riskManager.getTradeRecommendation()

        // Store adjustment
        this.adjustments.push({
            timestamp: candle.timestamp,
            action: recommendation.action,
            reason: recommendation.reason,
            adjustment: recommendation.adjustment,
            severity: recommendation.severity,
        })

        // Check if we should take the trade
        if (positionInfo.size <= 0 || recommendation.action === "stop") {
            // Skip trade due to risk management constraints
            console.log(
                `${new Date(candle.timestamp).toISOString()} - Skipped trade: ${recommendation.reason}`,
            )
            return
        }

        // Apply position size adjustment based on recommendation
        let adjustedSize = positionInfo.size
        if (recommendation.action === "reduce") {
            adjustedSize = positionInfo.size * recommendation.adjustment
        } else if (recommendation.action === "increase") {
            adjustedSize = positionInfo.size * recommendation.adjustment
        }

        // Set trade size and risk amount
        trade.size = adjustedSize
        trade.riskAmount = positionInfo.riskAmount

        // Calculate stop loss price
        let atr = null
        if (index >= 14) {
            // Calculate ATR if we have enough data
            atr = this.calculateATR(this.data.slice(index - 14, index), 14)
        }
        trade.stopLoss = this.riskManager.calculateStopLoss(trade, positionInfo, atr)

        // Open the position
        this.position = trade

        console.log(
            `${new Date(candle.timestamp).toISOString()} - ${trade.direction.toUpperCase()} Entry at ${trade.entryPrice.toFixed(2)} with size ${trade.size.toFixed(2)} (${(positionInfo.riskPercentage * 100).toFixed(2)}% risk)`,
        )
    }

    /**
     * Handle open positions with risk management
     */
    handleOpenPosition(candle, signal, index) {
        // Check for liquidation with open position
        const isLiquidated = this.checkLiquidation(candle)
        if (isLiquidated) {
            // Position was liquidated
            this.position.exitTime = candle.timestamp
            this.position.exitPrice = this.position.liquidationPrice
            this.position.pnl = -this.position.size * this.position.entryPrice // Full loss
            this.position.exitReason = "liquidation"

            // Add to completed trades
            this.trades.push(this.position)

            // Update equity
            this.equity -= this.position.size * this.position.entryPrice

            // Record trade in risk manager
            this.riskManager.recordTrade(this.position)

            // Update risk manager equity
            this.riskManager.updateEquity(this.equity)

            // Clear position
            this.position = null

            console.log(
                `${new Date(candle.timestamp).toISOString()} - LIQUIDATION at ${this.position.liquidationPrice.toFixed(2)} with PnL: $${this.position.pnl.toFixed(2)}`,
            )
            return
        }

        // Check for stop loss hit
        if (this.position.stopLoss) {
            const stopHit =
                this.position.direction === "long"
                    ? candle.low <= this.position.stopLoss
                    : candle.high >= this.position.stopLoss

            if (stopHit) {
                // Stop loss hit
                this.position.exitTime = candle.timestamp
                this.position.exitPrice = this.position.stopLoss

                // Calculate PnL
                const entryValue = this.position.size * this.position.entryPrice
                const exitValue = this.position.size * this.position.exitPrice
                const pnl =
                    this.position.direction === "long"
                        ? exitValue - entryValue
                        : entryValue - exitValue

                // Subtract trading fees
                const entryFee = entryValue * this.tradingFee
                const exitFee = exitValue * this.tradingFee
                this.position.pnl = pnl - entryFee - exitFee
                this.position.exitReason = "stop_loss"

                // Add to completed trades
                this.trades.push(this.position)

                // Update equity
                this.equity += this.position.pnl

                // Record trade in risk manager
                this.riskManager.recordTrade(this.position)

                // Update risk manager equity
                this.riskManager.updateEquity(this.equity)

                // Clear position
                this.position = null

                console.log(
                    `${new Date(candle.timestamp).toISOString()} - Stop Loss hit at ${this.position.stopLoss.toFixed(2)} with PnL: $${this.position.pnl.toFixed(2)}`,
                )
                return
            }
        }

        // Check for take profit hit
        const takeProfitPrice =
            this.position.direction === "long"
                ? this.position.entryPrice * (1 + this.profitTarget / this.leverage)
                : this.position.entryPrice * (1 - this.profitTarget / this.leverage)

        const tpHit =
            this.position.direction === "long"
                ? candle.high >= takeProfitPrice
                : candle.low <= takeProfitPrice

        if (tpHit) {
            // Take profit hit
            this.position.exitTime = candle.timestamp
            this.position.exitPrice = takeProfitPrice

            // Calculate PnL
            const entryValue = this.position.size * this.position.entryPrice
            const exitValue = this.position.size * this.position.exitPrice
            const pnl =
                this.position.direction === "long" ? exitValue - entryValue : entryValue - exitValue

            // Subtract trading fees
            const entryFee = entryValue * this.tradingFee
            const exitFee = exitValue * this.tradingFee
            this.position.pnl = pnl - entryFee - exitFee
            this.position.exitReason = "take_profit"

            // Add to completed trades
            this.trades.push(this.position)

            // Update equity
            this.equity += this.position.pnl

            // Record trade in risk manager
            this.riskManager.recordTrade(this.position)

            // Update risk manager equity
            this.riskManager.updateEquity(this.equity)

            // Clear position
            this.position = null

            console.log(
                `${new Date(candle.timestamp).toISOString()} - Take Profit hit at ${takeProfitPrice.toFixed(2)} with PnL: $${this.position.pnl.toFixed(2)}`,
            )
            return
        }

        // Check for exit signal
        const exitSignal = this.position.direction === "long" ? signal < 0 : signal > 0
        if (exitSignal) {
            // Exit signal triggered
            this.position.exitTime = candle.timestamp
            this.position.exitPrice = candle.close

            // Calculate PnL
            const entryValue = this.position.size * this.position.entryPrice
            const exitValue = this.position.size * this.position.exitPrice
            const pnl =
                this.position.direction === "long" ? exitValue - entryValue : entryValue - exitValue

            // Subtract trading fees
            const entryFee = entryValue * this.tradingFee
            const exitFee = exitValue * this.tradingFee
            this.position.pnl = pnl - entryFee - exitFee
            this.position.exitReason = "signal_exit"

            // Add to completed trades
            this.trades.push(this.position)

            // Update equity
            this.equity += this.position.pnl

            // Record trade in risk manager
            this.riskManager.recordTrade(this.position)

            // Update risk manager equity
            this.riskManager.updateEquity(this.equity)

            // Clear position
            this.position = null

            console.log(
                `${new Date(candle.timestamp).toISOString()} - Signal Exit at ${candle.close.toFixed(2)} with PnL: $${this.position.pnl.toFixed(2)}`,
            )
            return
        }

        // Update unrealized PnL for equity curve
        if (this.position) {
            const entryValue = this.position.size * this.position.entryPrice
            const currentValue = this.position.size * candle.close
            const unrealizedPnl =
                this.position.direction === "long"
                    ? currentValue - entryValue
                    : entryValue - currentValue

            // Trading fees would be deducted on exit, not reflected in unrealized PnL
            this.unrealizedPnl = unrealizedPnl
        }
    }

    /**
     * Calculate Average True Range (ATR)
     */
    calculateATR(data, period = 14) {
        if (!data || data.length < period) {
            return null
        }

        let trValues = []

        // Calculate True Range for each candle
        for (let i = 1; i < data.length; i++) {
            const high = data[i].high
            const low = data[i].low
            const prevClose = data[i - 1].close

            const tr1 = high - low
            const tr2 = Math.abs(high - prevClose)
            const tr3 = Math.abs(low - prevClose)

            const tr = Math.max(tr1, tr2, tr3)
            trValues.push(tr)
        }

        // Calculate simple average of True Range values
        const sum = trValues.slice(-period).reduce((sum, tr) => sum + tr, 0)
        return sum / period
    }

    /**
     * Override saveResults to include risk metrics
     */
    saveResults() {
        // Save trades
        fs.writeFileSync("backtest_trades.json", JSON.stringify(this.trades, null, 2))

        // Save equity curve
        fs.writeFileSync("equity_curve.json", JSON.stringify(this.equityCurve, null, 2))

        // Save trade statistics
        fs.writeFileSync("trade_statistics.json", JSON.stringify(this.metrics, null, 2))

        // Save risk statistics
        fs.writeFileSync("risk_statistics.json", JSON.stringify(this.riskStats, null, 2))

        // Save position sizes
        fs.writeFileSync("position_sizes.json", JSON.stringify(this.positionSizes, null, 2))

        // Save risk adjustments
        fs.writeFileSync("risk_adjustments.json", JSON.stringify(this.adjustments, null, 2))
    }
}

// Run if called directly
if (require.main === module) {
    // Parse command line arguments
    const argv = yargs(hideBin(process.argv))
        .option("market", {
            alias: "m",
            description: "Market to test on (e.g., BTC-PERP)",
            type: "string",
            default: "BTC-PERP",
        })
        .option("timeframe", {
            alias: "t",
            description: "Timeframe to use (e.g., 15m, 1h, 4h)",
            type: "string",
            default: "15m",
        })
        .option("leverage", {
            alias: "l",
            description: "Leverage to use",
            type: "number",
            default: 5,
        })
        .option("initialCapital", {
            description: "Initial capital to start with",
            type: "number",
            default: 10000,
        })
        .option("maxRiskPerTrade", {
            description: "Maximum risk per trade (decimal)",
            type: "number",
            default: 0.02,
        })
        .option("maxDrawdown", {
            description: "Maximum drawdown allowed before stopping (decimal)",
            type: "number",
            default: 0.25,
        })
        .option("useVolatility", {
            description: "Adjust position size based on volatility",
            type: "boolean",
            default: false,
        })
        .option("useKelly", {
            description: "Use Kelly Criterion for position sizing",
            type: "boolean",
            default: false,
        })
        .option("useAntiMartingale", {
            description: "Use Anti-Martingale position sizing (increase after wins)",
            type: "boolean",
            default: false,
        })
        .help()
        .alias("help", "h").argv

    // Create backtester with risk management
    const backtester = new RiskAwareBacktester({
        market: argv.market,
        timeframe: argv.timeframe,
        leverage: argv.leverage,
        initialCapital: argv.initialCapital,
        positionSize: 1.0, // Will be determined by risk manager
        maxRiskPerTrade: argv.maxRiskPerTrade,
        maxDrawdown: argv.maxDrawdown,
        useVolatilityAdjustment: argv.useVolatility,
        useKellyCriterion: argv.useKelly,
        useAntiMartingale: argv.useAntiMartingale,
    })

    // Run backtest
    backtester
        .runBacktest()
        .then(() => {
            console.log("Risk-aware backtest completed successfully")
        })
        .catch((error) => {
            console.error("Risk-aware backtest failed:", error)
            process.exit(1)
        })
}

module.exports = RiskAwareBacktester

// ASHDLADXZCZC
// 2019-07-22T15:16:28 – NUkqJGgRbaK6Rl4AzuNt
// 2019-07-27T08:42:08 – e2NSwiSOQhDkszapZJaY
// 2019-08-01T05:28:00 – AkO1XkWZlxtWko4yPqwb
// 2019-08-05T03:59:47 – 4OV9B0Dw1XnEidB39AIU
// 2019-08-18T14:40:23 – jJwgn4QPTuXlBnIxDpbc
// 2019-09-07T10:20:24 – tWQknNTAVnyh3rNjWAtC
// 2019-09-10T04:54:50 – bMIp3HXaSaUqr8ubCtLx
// 2019-09-14T11:38:12 – OlMfqZk31MPhRhOuWYqA
// 2019-10-04T11:30:55 – pEnD9ZBFFsMfmoCwPzka
// 2019-10-07T14:05:11 – THKjEIGbsG7hcsMymPqO
// 2019-12-11T21:33:11 – yAeehbKDS6l0sp5UeVSF
// 2019-12-11T23:00:29 – GgrV0nvu1rWNq8EeHDdh
// 2019-12-23T06:45:49 – 5AsC8QLDj6CSaLfqzhV0
// 2019-12-23T15:26:41 – 7QzxnhLYsQJvTmYjvqLj
// 2020-01-16T18:44:13 – RGeCXX4wlX8mjtrultQq
// 2020-01-16T19:44:01 – uiRnwcY2gP2iJdiHGf2L
// 2020-02-08T17:22:18 – jOtCGabhEwVsXWAyuF9M
// 2020-03-01T12:23:56 – UcRTzJxLKnheSc3hURE1
// 2020-03-14T09:39:31 – dMyaRlPaBQTH8OF98tM1
// 2020-03-16T09:25:10 – bpB6Zl6YSneSl6q4Z65X
// 2020-03-20T04:52:28 – ouPRaoWzKYlzpfpLr3IR
// 2020-03-24T04:31:44 – FPmAPp9VHtJg6gsJjyoF
// 2020-03-24T07:51:07 – lEVbAUzLLDRgV45naVPC
// 2020-03-26T01:28:15 – vNsF33rkatMsKlQY441T
// 2020-04-07T08:31:37 – VnI5MqJwE6wtBzELK25r
// 2020-05-06T02:05:55 – jYFiS5C1VQtk6mehFeif
// 2020-06-14T00:16:09 – Jw7exxhfyYjNb3E5UGY2
// 2020-07-13T16:03:07 – B3nKkduGC8CQdCthvgZf
// 2020-07-22T04:35:36 – PwWiElwXyQFvmkO2ShqQ
// 2020-08-17T15:04:04 – hJL1Zs6u1CYfUoY1IUrE
// 2020-08-17T19:33:07 – 3xLRXpCzUQQZr4MZYMuo
// 2020-08-20T00:04:46 – F4rwaV5ky9sRGUey6wj6
// 2020-08-20T14:59:18 – qLcw4bRz6JfYMmXJzB83
// 2020-09-02T21:17:41 – IX0GhpZ39ZtRL0UxOe4a
// 2020-09-06T02:34:43 – bzCajYnoNKhKC3rIMtlN
// 2020-09-11T09:44:52 – 8l3znol4RYrplc1OgrNr
// 2020-09-14T12:47:53 – PLgrBqkUUyIEYstFaeT0
// 2020-10-04T09:22:08 – 89LHXnrCfXVsaK8NdsKm
// 2020-10-07T09:52:42 – rUny6VHF1ELaRHJaBHa0
// 2020-10-14T11:57:57 – F50LgUffzp3apE3jgGzi
// 2020-10-31T03:34:35 – KePz6Xg4PLmf4N6iDGKJ
// 2020-11-04T00:21:16 – yrh2IiVAM3V8OMSYd9G2
// 2020-12-14T01:20:10 – kAAnZLZxF9H4MSPojYtv
// 2020-12-16T03:46:33 – l1RZ0XfTwDmb7pboeSoO
// 2020-12-18T05:52:03 – NAU1XodyqSONwszSOA3D
// 2020-12-19T05:41:44 – eMrnjv5qzSnXshARUEK5
// 2021-01-01T05:26:52 – YuhsqaZxKEEiOMNK9uum
// 2021-01-11T01:29:33 – oe3nH8mebVHRxTiAFKIq
// 2021-01-12T01:53:04 – KFPn7aHAGo6oejyMr0HU
// 2021-01-14T04:19:21 – zRNMdF0WfGj4jQM9bzI3
// 2021-01-17T13:45:13 – HIi7zttGrLKmhvnJkhll
// 2021-01-19T00:52:27 – 0lRfpt5VaZlf6DAhESzq
// 2021-02-05T20:38:06 – BXR3nYag9LvDjPbdNo2h
// 2021-02-05T23:56:29 – zSPh6l2UYPKox2jEEd76
// 2021-03-01T01:44:48 – IKwDeHw5j0wvSbd7SvfC
// 2021-04-23T03:45:54 – yiImoqK2AqNe4FXRqulU
// 2021-04-27T00:27:52 – wGxEIvq9Qw1oePDue2pt
// 2021-04-30T19:14:47 – JbO8JvvvS03GVq8vJPBs
// 2021-05-13T07:02:36 – ZcKRD4IsmbyPEgP8kxyD
// 2021-05-25T09:01:28 – u5c7pjtWgDPKPboYthuV
// 2021-06-06T23:29:22 – Pj0JU0pUtU6G0zdMa1FA
// 2021-06-27T23:08:05 – cEGV8czjhvWugMoBDeGB
// 2021-07-06T13:27:01 – dxybREesmuo09YF11WTo
// 2021-07-10T00:52:04 – zZCLT2BbYaH75P1Q13AT
// 2021-08-12T20:33:52 – bj9NMllARssHgH99RpzR
// 2021-08-19T17:52:49 – NzW6X4dCXwpQojvpnG9W
// 2021-08-30T05:05:03 – HYFGbTGzcjblYwK60rI7
// 2021-09-08T21:10:43 – AE0f3N51JO3WyGssIwGr
// 2021-09-16T20:15:42 – WYu2XYPBMQTtKMmDD0B8
// 2021-09-22T03:01:20 – kLLuevwFwLbSwL0Bhu2w
// 2021-10-10T18:41:03 – 0YT8xL6QLOv0n7NzJe4T
// 2021-10-18T21:29:56 – IndbadJP0CNwJxXfqtMr
// 2021-10-23T18:32:12 – woFKN3b9MyloY5lx27YJ
// 2021-11-28T09:45:16 – iG56jh3PnYNvteYKwSKS
// 2021-12-04T22:35:50 – nC9rd2pCmyijcSp5G3V9
// 2021-12-13T09:37:59 – lrLIKLdQR0nIw2lWJPqV
// 2021-12-15T13:01:44 – qi1bCAzvKyNlGobXCQEo
// 2021-12-24T11:00:56 – tHbp5J4FYYfRs55ZtgdX
// 2021-12-29T06:15:10 – YgbKGiJU5OMmumUY77pJ
// 2021-12-29T10:39:35 – pKydNg3VOqpZqAJIz7G7
// 2022-01-20T00:54:36 – 3X3OqNYEDjZeYEA8yGUB
// 2022-01-22T12:16:04 – L8U8ub8PwzwAyO4EFbRm
// 2022-01-27T02:04:29 – R9GvYezrS520xhztDTa1
// 2022-04-08T13:25:54 – lpTXcBQsvZBlfOkb6mtV
// 2022-04-26T00:01:02 – Rqqe6xi6gnk6M4YVCf8B
// 2022-04-29T23:30:18 – vYO8YM2p6vFjuQJZl0oO
// 2022-06-02T00:20:37 – L17H90n7SKFFB50mORNO
// 2022-06-18T16:52:44 – 6UpAe543dOhxUp9I23LQ
// 2022-08-10T03:45:48 – Q8aBfDsCUvlLOkzAiKI9
// 2022-08-21T08:14:20 – mnxaz80RnXGxavvw2z71
// 2022-09-20T03:58:14 – AUmacHLqJB9NIBKcaZrO
// 2022-10-04T17:18:06 – 09C3YIUREXLm03KWPhU4
// 2022-10-10T23:27:41 – SUBhlXXzdSN2t9BWRWDV
// 2022-10-13T00:14:21 – izoSLOG0I0IfwtOrOiPH
// 2022-10-21T21:24:31 – K3oCEvvDW6chmqHhw1oT
// 2022-11-22T19:47:19 – Vd0uNWQtFNXaNndr9vDf
// 2022-11-24T12:30:25 – vyX7Z9iz4oIuCY1D9cjf
// 2022-11-30T03:19:17 – 5ymfOidNHwU1eYMlHtBf
// 2022-12-27T13:37:03 – r7LesmSzog0WtIYOoMSr
// 2022-12-30T16:16:11 – w8qF7aAVXtmgpKdCdpKQ
// 2023-01-13T23:20:36 – es3DAe8K4EkEK0B81bSi
// 2023-01-14T04:56:07 – gr5mOumEwjNTADW2nKB5
// 2023-01-15T11:39:29 – mxvnl7J8xKLU75HcVDtb
// 2023-02-04T03:27:56 – zZfSf7QNL5TLr1QoD6xO
// 2023-03-29T15:38:59 – y3hvDv8OupSCXFBXyb9c
// 2023-04-01T04:46:17 – KcxhCqHrtb2f3VG054ws
// 2023-04-02T09:30:52 – 5c3mfYOH1aQH5EPPbxf7
// 2023-04-03T19:25:42 – oMw3BmEGXwS3QznsOKpv
// 2023-04-14T03:22:07 – nb9bexajIpHDRpJuk9pp
// 2023-04-14T17:55:35 – Udgg0JaxCmBL3LXnHNi0
// 2023-05-03T21:37:24 – L4fQSUJJCPlYHtH9DKsq
// 2023-05-09T20:39:46 – pVj3kwBd2AJjImXsiU4C
// 2023-05-12T00:36:16 – eGTm8X8QmiZbGG6MvIwJ
// 2023-05-24T03:15:49 – VEHmwXUFjJeMUHrQQ9Xg
// 2023-06-02T16:46:15 – xfvfP1kUnWFYZDeu6C2q
// 2023-06-10T09:48:55 – Wwdz5m7GUC3LaxrdSwge
// 2023-06-13T08:23:46 – wYMfKOIruIIpHtyPlGQR
// 2023-06-13T12:34:42 – rCoU4WnPLH1d6Y2VRgPc
// 2023-06-23T02:29:28 – CBtHWj343BolbhzLx5a5
// 2023-06-26T20:42:52 – NzvKzrTwdW2uGdI9O9dP
// 2023-07-04T17:00:29 – TtFRXhPmpaKIiw5M28oH
// 2023-07-18T18:43:07 – 0z4ldJdPVlvGigyYaj9E
// 2023-07-23T05:42:01 – fSkCketsUuYJAvKtkM8v
// 2023-08-24T21:48:54 – WbdSHyqNUlOQaFJC7mqH
// 2023-09-25T01:50:21 – 08vcqQVd6oHkiXxgudjw
// 2023-11-04T10:43:49 – igKdYvPVeggt9pBul1CQ
// 2023-11-10T04:40:12 – cS87rbLPpGo2JznhEkcQ
// 2023-11-24T11:58:08 – TKyZdcyt9Qljjh9yuKKz
// 2023-12-02T04:23:18 – moLuf1x11lX7gH38zquP
// 2023-12-07T06:47:32 – X23TmOanaulgmZYJEZW2
// 2023-12-30T18:06:06 – jVGzrr80q5MLKhHJLa0A
// 2024-01-25T13:07:49 – V8ot9nKtVMM0f7w0TtnZ
// 2024-02-09T00:18:38 – LbGec8oVKkuErVKtfKbj
// 2024-03-10T16:06:30 – npjkA94LAGdszWubZn5h
// 2024-03-23T09:45:53 – pXSwD8uZoRlek3P8WUpF
// 2024-03-24T04:25:23 – FH1tOdxIsSucJOsi4bw6
// 2024-04-01T11:23:21 – ufuSpqSkqHaVt7HQrJoP
// 2024-04-09T13:21:31 – jygdpwBuW3fXu5xkqPBe
// 2024-05-04T21:50:31 – NLfCA0CelHtMx1rZ4BvQ
// 2024-05-28T21:51:58 – KcDfOEzmEJCuJhvUP8KP
// 2024-06-08T13:40:08 – benhHoJngz0MB0K7CQNw
// 2024-06-18T07:52:38 – SbQngcCDmeqLI7s6SN1S
// 2024-07-15T06:36:59 – FBVFJga19yucN9lGpvj9
// 2024-07-19T14:44:00 – l3y7G3mCuLHkHMgjH6a2
// 2024-07-26T17:26:08 – H515E5lGaUeAT0tuckar
// 2024-08-06T08:02:00 – gc8xr8x3cgmqUnuO1gys
// 2024-08-06T12:41:44 – drUBQ26KgAO6rDkNBVwG
// 2024-09-08T18:09:29 – UJdUCYi79jFN2fnkLc20
// 2024-09-14T08:54:13 – DC47CL8XuXQ1LFISeqYp
// 2024-09-29T01:35:33 – fWvw53LaltWuzfK3v0Z3
// 2024-10-01T18:48:19 – T2RLc3KdJv8T4jbOC5Sj
// 2024-10-02T17:32:40 – LbdLAIoO1Y04GRZRooxv
// 2024-10-07T12:59:13 – PpSTvuhRerZLLrq9HdGm
// 2024-10-10T09:23:23 – lCyiBKFyxvAHcVsKQhWe
// 2024-10-13T14:19:17 – gVDHAtFLvIoItgFIppiQ
// 2024-10-20T07:25:23 – eIStKbALjtkcsNMyi9lo
// 2024-10-21T13:40:04 – 6Gg22QeDM7MykhqasB0A
// 2024-11-13T11:36:49 – IxcJFJp3k0NZ0ixlP5Xb
// 2024-11-25T09:24:36 – ZXo5rb8qADyRwyF3tvTJ
// 2024-11-29T01:12:10 – cb7NsMZkdAno7irgVawo
// 2024-12-12T14:11:47 – IM3BGOzTbmfJLO9l1UhC
// 2024-12-17T20:20:59 – jAUBx5UBGwMy47GJw5ZF
// 2024-12-19T11:33:42 – KbekI05RUsiUHPis8gvE
// 2024-12-24T18:06:39 – 85tlPxqp1BpgJUGPksZF
// 2025-01-06T14:58:35 – D71hwbeGX7iodoBnInzF
// 2025-01-24T14:45:05 – r5gmkV0OSCNWL35hsYh4
// 2025-02-05T13:40:11 – JqDlBudN43eGgsK2kvfR
// 2025-02-09T19:41:54 – jpFTzxpkLXYkMgJqJ7JM
// 2025-03-02T16:56:08 – 5BJQbpEGCj5x2pPGVPDK
