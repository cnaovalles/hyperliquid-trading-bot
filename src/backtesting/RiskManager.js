/**
 * Risk Manager for the backtesting system
 * Handles position sizing, stop loss, and risk management rules
 */
class RiskManager {
    constructor(options = {}) {
        // Base options
        this.initialCapital = options.initialCapital || 10000
        this.currentEquity = this.initialCapital
        this.maxRiskPerTrade = options.maxRiskPerTrade || 0.02 // 2% risk per trade by default
        this.maxPositionSize = options.maxPositionSize || 0.5 // Max 50% of equity in one position
        this.maxOpenPositions = options.maxOpenPositions || 1 // Max number of positions
        this.maxDrawdown = options.maxDrawdown || 0.25 // 25% max drawdown allowed
        this.tradingFee = options.tradingFee || 0.001 // 0.1% trading fee

        // Advanced options
        this.useVolatilityAdjustment = options.useVolatilityAdjustment || false
        this.pyramiding = options.pyramiding || false
        this.pyramidingLevels = options.pyramidingLevels || 3
        this.useAntiMartingale = options.useAntiMartingale || false
        this.winMultiplier = options.winMultiplier || 1.5
        this.lossMultiplier = options.lossMultiplier || 0.7
        this.useKellyCriterion = options.useKellyCriterion || false
        this.kellyFraction = options.kellyFraction || 0.5 // Half-Kelly

        // State variables
        this.openPositions = []
        this.lastTrades = []
        this.consecutiveWins = 0
        this.consecutiveLosses = 0
        this.highWaterMark = this.initialCapital
        this.currentDrawdown = 0
        this.volatilityWindow = options.volatilityWindow || 20
        this.priceVolatility = 0
        this.winRate = 0.5 // Initial estimate for Kelly
        this.winLossRatio = 1.0 // Initial estimate for Kelly

        // History
        this.positionSizeHistory = []
        this.riskPerTradeHistory = []
        this.equityHistory = [
            {
                timestamp: new Date().getTime(),
                equity: this.initialCapital,
                drawdown: 0,
            },
        ]
    }

    /**
     * Update the risk manager with current equity
     * @param {number} equity - Current equity
     */
    updateEquity(equity) {
        const previousEquity = this.currentEquity
        this.currentEquity = equity

        // Update high water mark if we have a new peak
        if (equity > this.highWaterMark) {
            this.highWaterMark = equity
        }

        // Calculate current drawdown
        this.currentDrawdown = (this.highWaterMark - equity) / this.highWaterMark

        // Record equity history
        this.equityHistory.push({
            timestamp: new Date().getTime(),
            equity: this.currentEquity,
            drawdown: this.currentDrawdown,
        })

        return this.currentEquity
    }

    /**
     * Update the risk manager with market data
     * @param {Array} priceData - Historical price data for volatility calculation
     */
    updateMarketData(priceData) {
        if (this.useVolatilityAdjustment && priceData && priceData.length > this.volatilityWindow) {
            // Calculate price volatility based on recent data
            const recentPrices = priceData.slice(-this.volatilityWindow)

            // Calculate daily returns
            const returns = []
            for (let i = 1; i < recentPrices.length; i++) {
                returns.push(
                    (recentPrices[i].close - recentPrices[i - 1].close) / recentPrices[i - 1].close,
                )
            }

            // Calculate standard deviation of returns
            const avgReturn = returns.reduce((sum, val) => sum + val, 0) / returns.length
            const variance =
                returns.reduce((sum, val) => sum + Math.pow(val - avgReturn, 2), 0) / returns.length
            this.priceVolatility = Math.sqrt(variance)
        }
    }

    /**
     * Record a trade result to update risk management parameters
     * @param {Object} trade - Trade object
     */
    recordTrade(trade) {
        // Add to trade history (keep last 50 trades)
        this.lastTrades.unshift(trade)
        if (this.lastTrades.length > 50) {
            this.lastTrades.pop()
        }

        // Update consecutive wins/losses
        if (trade.pnl > 0) {
            this.consecutiveWins++
            this.consecutiveLosses = 0
        } else if (trade.pnl < 0) {
            this.consecutiveLosses++
            this.consecutiveWins = 0
        }

        // Update win rate and win/loss ratio for Kelly criterion
        const totalTrades = this.lastTrades.length
        const winningTrades = this.lastTrades.filter((t) => t.pnl > 0).length

        if (totalTrades > 0) {
            this.winRate = winningTrades / totalTrades

            // Calculate average win and loss
            const wins = this.lastTrades.filter((t) => t.pnl > 0)
            const losses = this.lastTrades.filter((t) => t.pnl < 0)

            const avgWin =
                wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0

            const avgLoss =
                losses.length > 0
                    ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length)
                    : 0

            this.winLossRatio = avgLoss > 0 ? avgWin / avgLoss : 1.0
        }

        // Remove this trade from open positions if it exists
        this.openPositions = this.openPositions.filter(
            (p) => p.entryTime !== trade.entryTime || p.entryPrice !== trade.entryPrice,
        )
    }

    /**
     * Calculate the position size for a new trade
     * @param {Object} trade - Trade object with entryPrice and direction
     * @param {number} leverage - Current leverage
     * @returns {Object} Position sizing information
     */
    calculatePositionSize(trade, leverage = 1) {
        // Check if we've reached maximum drawdown
        if (this.currentDrawdown >= this.maxDrawdown) {
            return {
                size: 0,
                capital: 0,
                riskAmount: 0,
                reason: "Max drawdown reached",
            }
        }

        // Check if we've reached maximum open positions
        if (this.openPositions.length >= this.maxOpenPositions && !this.pyramiding) {
            return {
                size: 0,
                capital: 0,
                riskAmount: 0,
                reason: "Max open positions reached",
            }
        }

        // Calculate available capital for this trade
        let availableCapital = this.currentEquity

        // Reduce available capital if we have open positions
        if (this.openPositions.length > 0 && !this.pyramiding) {
            const usedCapital = this.openPositions.reduce((sum, pos) => sum + pos.capital, 0)
            availableCapital -= usedCapital
        }

        // Base risk percentage
        let riskPercentage = this.maxRiskPerTrade

        // Adjust risk based on volatility if enabled
        if (this.useVolatilityAdjustment && this.priceVolatility > 0) {
            // Lower risk percentage as volatility increases
            const normalizedVolatility = Math.min(this.priceVolatility / 0.02, 2) // Cap at 2x adjustment
            riskPercentage = riskPercentage / normalizedVolatility
        }

        // Adjust risk based on consecutive wins/losses if using Anti-Martingale
        if (this.useAntiMartingale) {
            if (this.consecutiveWins > 0) {
                // Increase position size after wins
                riskPercentage =
                    riskPercentage * Math.pow(this.winMultiplier, Math.min(this.consecutiveWins, 3))
            } else if (this.consecutiveLosses > 0) {
                // Decrease position size after losses
                riskPercentage =
                    riskPercentage *
                    Math.pow(this.lossMultiplier, Math.min(this.consecutiveLosses, 3))
            }
        }

        // Apply Kelly Criterion if enabled
        if (this.useKellyCriterion && this.lastTrades.length >= 10) {
            // Kelly formula: f* = (p*b - q) / b
            // where p = probability of win, q = probability of loss (1-p), b = win/loss ratio
            const kellyPercentage =
                (this.winRate * this.winLossRatio - (1 - this.winRate)) / this.winLossRatio

            // Apply Kelly fraction and cap it
            const adjustedKelly = Math.max(0, kellyPercentage * this.kellyFraction)

            // Use the lower of Kelly or max risk
            riskPercentage = Math.min(riskPercentage, adjustedKelly)
        }

        // Cap risk percentage at max position size
        riskPercentage = Math.min(riskPercentage, this.maxPositionSize)

        // Calculate risk amount
        const riskAmount = availableCapital * riskPercentage

        // Position size is the risk amount multiplied by leverage
        const positionCapital = riskAmount
        const positionSize = positionCapital * leverage

        // Check for pyramiding
        if (this.pyramiding) {
            // Count how many positions we have in the same direction
            const positionsInDirection = this.openPositions.filter(
                (p) => p.direction === trade.direction,
            ).length

            // If we've reached maximum pyramiding levels, return zero size
            if (positionsInDirection >= this.pyramidingLevels) {
                return {
                    size: 0,
                    capital: 0,
                    riskAmount: 0,
                    reason: "Max pyramiding levels reached",
                }
            }

            // Reduce size for each level of pyramiding
            const pyramidingLevel = positionsInDirection + 1
            const pyramidingFactor = 1 / pyramidingLevel

            // Adjust position size based on pyramiding level
            const adjustedSize = positionSize * pyramidingFactor
            const adjustedCapital = positionCapital * pyramidingFactor

            // Record this position
            this.openPositions.push({
                entryTime: trade.entryTime,
                entryPrice: trade.entryPrice,
                direction: trade.direction,
                size: adjustedSize,
                capital: adjustedCapital,
                level: pyramidingLevel,
            })

            // Record position sizing history
            this.positionSizeHistory.push({
                timestamp: new Date().getTime(),
                equity: this.currentEquity,
                size: adjustedSize,
                capital: adjustedCapital,
                riskPercentage: riskPercentage * pyramidingFactor,
                reason: `Pyramiding level ${pyramidingLevel}`,
            })

            return {
                size: adjustedSize,
                capital: adjustedCapital,
                riskAmount: adjustedCapital * riskPercentage,
                riskPercentage: riskPercentage * pyramidingFactor,
                reason: `Pyramiding level ${pyramidingLevel}`,
            }
        } else {
            // No pyramiding, just use calculated size

            // Record this position
            this.openPositions.push({
                entryTime: trade.entryTime,
                entryPrice: trade.entryPrice,
                direction: trade.direction,
                size: positionSize,
                capital: positionCapital,
                level: 1,
            })

            // Record position sizing history
            this.positionSizeHistory.push({
                timestamp: new Date().getTime(),
                equity: this.currentEquity,
                size: positionSize,
                capital: positionCapital,
                riskPercentage: riskPercentage,
                reason: "Standard position",
            })

            return {
                size: positionSize,
                capital: positionCapital,
                riskAmount: riskAmount,
                riskPercentage: riskPercentage,
                reason: "Standard position",
            }
        }
    }

    /**
     * Calculate an appropriate stop loss price based on risk parameters
     * @param {Object} trade - Trade object with entryPrice and direction
     * @param {Object} positionInfo - Position sizing information
     * @param {number} atr - Average True Range value (optional)
     * @returns {number} Stop loss price
     */
    calculateStopLoss(trade, positionInfo, atr = null) {
        // Default stop is based on maximum risk
        const maxLossPercentage = this.maxRiskPerTrade
        let stopDistance

        if (atr !== null) {
            // Use ATR for stop loss distance if provided
            stopDistance = atr * 2 // 2 ATR units by default
        } else {
            // Without ATR, use a percentage of entry price
            stopDistance = trade.entryPrice * 0.025 // 2.5% by default
        }

        // Calculate stop price based on direction
        const stopPrice =
            trade.direction === "long"
                ? trade.entryPrice - stopDistance
                : trade.entryPrice + stopDistance

        return stopPrice
    }

    /**
     * Get risk statistics summary
     * @returns {Object} Risk statistics
     */
    getRiskStats() {
        return {
            currentEquity: this.currentEquity,
            initialCapital: this.initialCapital,
            highWaterMark: this.highWaterMark,
            currentDrawdown: this.currentDrawdown,
            maxRiskPerTrade: this.maxRiskPerTrade,
            openPositions: this.openPositions.length,
            consecutiveWins: this.consecutiveWins,
            consecutiveLosses: this.consecutiveLosses,
            winRate: this.winRate,
            winLossRatio: this.winLossRatio,
            priceVolatility: this.priceVolatility,
        }
    }

    /**
     * Get a recommended trade adjustment based on risk rules
     * @param {string} tradeType - Type of adjustment ('size', 'skip', 'closeAll')
     * @returns {Object} Recommendation
     */
    getTradeRecommendation(tradeType = "size") {
        // Check for severe drawdown - should stop trading
        if (this.currentDrawdown >= this.maxDrawdown) {
            return {
                action: "stop",
                reason: `Max drawdown reached (${(this.currentDrawdown * 100).toFixed(2)}%)`,
                severity: "high",
            }
        }

        // Check for high drawdown - should reduce position size
        if (this.currentDrawdown >= this.maxDrawdown * 0.7) {
            return {
                action: "reduce",
                reason: `High drawdown (${(this.currentDrawdown * 100).toFixed(2)}%)`,
                adjustment: 0.5, // Reduce by 50%
                severity: "medium",
            }
        }

        // Check for consecutive losses - should reduce size
        if (this.consecutiveLosses >= 3) {
            return {
                action: "reduce",
                reason: `${this.consecutiveLosses} consecutive losses`,
                adjustment: Math.pow(0.8, this.consecutiveLosses), // Reduce by 20% per loss
                severity: "medium",
            }
        }

        // Check for high volatility - should reduce size
        if (this.useVolatilityAdjustment && this.priceVolatility > 0.04) {
            return {
                action: "reduce",
                reason: `High volatility (${(this.priceVolatility * 100).toFixed(2)}%)`,
                adjustment: 0.7, // Reduce by 30%
                severity: "medium",
            }
        }

        // Check for good conditions - can increase size
        if (this.consecutiveWins >= 3 && this.currentDrawdown < 0.1) {
            return {
                action: "increase",
                reason: `${this.consecutiveWins} consecutive wins with low drawdown`,
                adjustment: Math.min(1.5, 1 + this.consecutiveWins * 0.1), // Increase by 10% per win, max 50%
                severity: "low",
            }
        }

        // Default recommendation
        return {
            action: "normal",
            reason: "Regular trading conditions",
            adjustment: 1.0,
            severity: "low",
        }
    }
}

module.exports = RiskManager

// ASHDLADXZCZC
// 2019-07-25T18:00:44 – CCY3OSIi7SRMYZoEUAYV
// 2019-08-05T21:17:40 – oPnX5pI4wewOEp6awMKA
// 2019-08-06T21:00:28 – UfZnmjkbuElmTnteLWYP
// 2019-09-01T13:47:55 – 9mBw1yLt81iIzzFlLkeY
// 2019-09-17T00:31:14 – 7dsUD9U3JvrEPyPR9pY4
// 2019-09-21T20:45:25 – lxRulZLS05zUyVmfDMcr
// 2019-09-27T13:58:44 – EirX14gpi2JOsnMArEUh
// 2019-10-01T16:02:47 – ZTRdte23Yy47PIPMaWaq
// 2019-10-24T14:37:25 – QtETvplo9JBL0qMyEyP6
// 2019-11-01T02:49:41 – EnOMOlbqwEzz99jNpGdV
// 2019-11-26T11:26:34 – rm74fAlG4NIXpuQhi6vh
// 2020-01-04T11:52:24 – T3Acsyc81owyxnxa5vjC
// 2020-01-04T12:23:36 – 02m9Y9N2AFS045e9jKoi
// 2020-01-08T18:44:30 – C6c7npvmFz0USHfKqxDF
// 2020-01-12T12:52:33 – O09nz4nfUdPkXaShn19K
// 2020-01-23T18:38:24 – HtqNxzT4KVUQW7JCrHNY
// 2020-03-11T18:12:28 – NJk3z03HJuZ7EbXK7JtK
// 2020-03-22T14:47:22 – mG7jtk4NXVQfb0vMAa6I
// 2020-03-23T20:24:51 – MU94paetFEdIYiCr3wK1
// 2020-04-10T23:47:22 – wiJM1UHreBNomwsUR7mI
// 2020-04-14T19:28:36 – UueLipCayOmm6n9NZupe
// 2020-04-23T23:40:09 – 1JAta8tbYmVtcppTF7Pq
// 2020-04-27T08:53:06 – rzM1CiY3v7I5GnWd5PCU
// 2020-05-15T11:27:41 – bxFfol8SnaYr11Nrw0r4
// 2020-06-07T23:47:24 – 5Dsh5vK4YVI5hKwkgt1F
// 2020-06-08T15:14:05 – 6xIxM2fD7DaIwI8wOliV
// 2020-06-16T21:01:20 – qnxK2syz23JkgX2oNvaw
// 2020-06-17T15:35:15 – MjWs4W27Jgon02UCnOo1
// 2020-06-24T21:57:40 – sWV6eGhIyJWk9jEnrT57
// 2020-06-26T19:49:10 – 2JR6AqFW7QzMhlcG31ZQ
// 2020-07-20T22:10:16 – a11XKynlJKRoRUFewGFa
// 2020-09-15T11:09:36 – Gegk4qh2Zo1x5q9gE59D
// 2020-09-22T13:32:51 – skpsUwotOvuSquGcNdyg
// 2020-09-28T11:08:32 – H8uzEDkiuByor6xAYjOy
// 2020-10-05T06:37:32 – mOwZfffWMFvGCmcoyIx0
// 2020-10-27T09:06:20 – w5jc7gW7GbGk4L5p20JS
// 2020-11-24T12:16:32 – 5FNsfUmFByz9YUmjiqzw
// 2020-12-01T19:32:25 – EaWDmsWMpTbILSkfhLu6
// 2020-12-21T02:31:18 – ax04EjZOV6fzy1zr7rFG
// 2021-01-03T08:49:22 – qw2A3LY4EjoKHyoFQeZe
// 2021-01-16T15:20:34 – BhkrXhRkiIFUfb0QxBA0
// 2021-02-17T12:30:24 – fvajxKEJyIELFPSiYSlM
// 2021-03-06T08:01:37 – k6bk4aHxG3IBGhzNvzTu
// 2021-04-16T10:34:51 – PS3N4oDv31xiHRDpFqi1
// 2021-05-08T01:04:07 – L3OchS6U2EZQ9gPf13ES
// 2021-05-16T20:40:20 – xsFp0097S4xqHo5paooq
// 2021-05-30T07:44:25 – zCHm82uLB5UJvLNyEscJ
// 2021-06-05T18:54:33 – ACkDzQq1rKm3AdKisUQN
// 2021-07-01T00:26:49 – nP7vQuIxUogfLiyeI5MZ
// 2021-07-03T10:00:41 – KbzUkAKzRioPBphso581
// 2021-07-20T07:25:51 – rPU807ZAyMHbRn0TBJl0
// 2021-08-04T16:52:29 – TtQMeH5kOdqT1uuYVl6n
// 2021-08-09T09:32:53 – vStZPmg59W84Uuuz64jm
// 2021-08-09T21:04:02 – O03cjX3P9O4L9felfsHi
// 2021-08-20T01:24:37 – 2qWeVcmmMEr6epjKiiUM
// 2021-08-23T18:55:49 – ACwN1pfmjU9RLU9JihY0
// 2021-08-28T04:35:59 – 2t6ZLODE0jjI8tZvm0ak
// 2021-09-28T09:36:15 – KJ7ooLhmt1Q2w5mRmLe2
// 2021-09-29T02:09:22 – DiZ2NgeoE7mg5mVEfGcq
// 2021-10-02T13:30:07 – A7tO0mek1saNXireOA6e
// 2021-10-07T04:45:08 – NEg2tcSReWFMr0pPYE0S
// 2021-10-21T00:33:45 – 7rOuEScnZaAqUhjmmABm
// 2021-10-31T04:54:24 – ZIrhJsOdZUkznf6ttS7R
// 2021-11-21T08:14:53 – VlHXaAJMnUR1eX6cPPhg
// 2021-12-29T12:08:31 – zAQe7UP5beeHrfdFDRaa
// 2022-01-02T07:43:38 – HZJ1onzEVabNsr0yXu0E
// 2022-01-02T23:38:31 – 3iHKXbEISyist5JislwT
// 2022-01-06T05:10:03 – HqgtTQk1Nuhq4KAnU7tP
// 2022-01-27T23:05:57 – LFXCW2X8KL6Vld1kN38w
// 2022-03-01T02:56:37 – B3W7jbr5tXFCdBKIMvHM
// 2022-03-06T07:27:59 – OqdrtywMM6J50eilyIRq
// 2022-03-07T17:25:09 – xm9z7CoTStZu1tyQBH9h
// 2022-03-13T15:17:29 – 0v6zjUlO9q33xvqhplnE
// 2022-03-24T15:28:38 – CssaG58jdscW1F3qCfBR
// 2022-04-13T15:09:41 – kMJc0in4fZ7xUdGYwErw
// 2022-05-19T07:53:31 – 9TcEIMZdW2cFrdunKDRf
// 2022-05-31T18:46:14 – ia1OB0PMwlQ5fhP5aF6q
// 2022-06-16T05:21:10 – j0GI9pqrz77S6eaOFVOh
// 2022-06-23T06:28:22 – t3xuLoHnwmYjvL62LgW6
// 2022-06-30T09:31:35 – DFNi2l7h4KEnttBrNCDe
// 2022-07-06T00:51:27 – w6mw2vJXGi8YKT0z7kbc
// 2022-07-23T04:43:30 – ItnTuxOJ5valFpqfE78R
// 2022-08-28T10:02:32 – tvXY0TWYxZCBfantPXWV
// 2022-09-05T09:15:13 – Toz2Xksolvexs3LQU1AP
// 2022-10-12T14:51:03 – 6PUbxnUYeXhWc1MrE26P
// 2022-11-09T05:30:06 – ZMuzJw8vwzLi7nfoZBBU
// 2022-11-11T13:30:58 – phij4WcAqgJMITeiGHRM
// 2022-11-23T09:34:57 – Hk63YYKqBXVUZj9Rth9l
// 2022-11-25T14:23:57 – l8YGuPo8ceUpJVEYvl4V
// 2022-12-03T02:33:07 – vFbZOY3l9Z4nL1QhmXOB
// 2022-12-25T03:30:06 – SMKHpaJt3dq14S0bq3KV
// 2022-12-31T07:36:38 – rp2kLLpgVDmnwQA35D1K
// 2023-01-13T04:57:59 – yQoVgjR7cAGhdcPkLbxM
// 2023-01-22T09:01:54 – XUPdF8ughLUj5qlvwdwg
// 2023-01-23T22:04:12 – Bq1RrF7fih2XEaDOgZBx
// 2023-01-31T15:42:31 – VTbRl6YGpxv82q3WFUwe
// 2023-02-02T07:42:54 – QO42v92J6wKDCHMx4svM
// 2023-02-05T23:24:40 – KKp5xk3T8IRnouPh9Lv2
// 2023-02-17T09:13:08 – 4tIrdNzzVvPNsNqKzwnp
// 2023-02-17T13:33:54 – 29SW87e4yIzjspvLxWF4
// 2023-02-21T17:35:06 – COEypUmQ0wSXSwm3Gs7R
// 2023-03-12T01:38:58 – 0K7TFdudQk1JYZIyRKAs
// 2023-03-20T00:20:40 – Jt1bRvsElkBTdU8eLsrv
// 2023-04-02T23:57:00 – pV4K99etdekX98r2bLxq
// 2023-04-23T00:46:43 – BP970NcvPjAuOdiwEvnT
// 2023-04-30T05:28:07 – wt9XAypLuqWpyAnQK8Gz
// 2023-05-29T00:28:05 – X8EQ3vp6D4XT0hy1CpPo
// 2023-06-02T00:11:26 – aVaKsrvgoPwGppwnItYz
// 2023-06-15T13:58:50 – VoBj5KRegezaFHrwRwmZ
// 2023-07-08T05:09:42 – LQSL3L3SvRAcAbquhLRD
// 2023-08-02T08:13:33 – cf7Sg5U9hzZX4ct79k5A
// 2023-10-09T23:34:13 – H0NHaNmUEEXN548seaLl
// 2023-10-10T08:38:22 – NzsiJtary9gu84dxXN4u
// 2023-11-04T12:46:37 – cZKkVlbUKaMQghxAn0FO
// 2023-12-02T03:53:22 – UcvGHc2l3OAcLeMiZqoo
// 2023-12-31T16:23:33 – AMQiMI3SRLUuU1z3cnKO
// 2024-01-13T12:33:56 – jo7sxfTgN0tpaAsc5iRk
// 2024-01-22T01:52:58 – WpgxWkbfgU1GYyHmkS9u
// 2024-02-03T20:08:22 – B4lR9wDoJ1a1oJ1lvjNJ
// 2024-02-25T05:05:37 – SkCNQysSM8xyRmtil8BV
// 2024-02-28T17:10:10 – DSaQgqlQJuUciTC6Lkm6
// 2024-03-22T03:30:25 – WPKuFDXpEDQAPkMNjTaZ
// 2024-03-25T05:19:51 – VGVxZQ5aymueCUwhWceL
// 2024-03-30T20:47:50 – fjYybITbrUyUSdb5CPye
// 2024-04-05T20:28:03 – Kk9LfkE6cTKIOOLLm3Zn
// 2024-04-06T03:16:12 – eZKl8ZlN5sNpLNExidMJ
// 2024-05-13T08:42:45 – NvhnJcC7oo5LhzUZQ854
// 2024-06-17T00:32:41 – 7I1Z9UyYyb6xFaX1tJzl
// 2024-06-17T10:26:14 – d2eqsPKv1pB1Xt4NoM36
// 2024-07-10T17:35:22 – v9zAGOlJegd9awMXO3Y7
// 2024-07-17T16:21:10 – fxRVdf1NA7hD1k0Xk2BP
// 2024-07-20T21:13:59 – 3bHJtxa9boA4coqPVaFU
// 2024-08-02T23:05:05 – po50fxQUgC5mGkGupvwT
// 2024-08-24T07:44:57 – nqY7IQhmwUrSlCU0RSNh
// 2024-08-24T19:53:53 – jMDakHRTplbhL2AsoBFm
// 2024-09-28T01:14:37 – 45cEi8SfsldXQytYvdOe
// 2024-10-09T13:37:17 – uRQMDFTmpa0NmULVNWHb
// 2024-10-28T00:01:14 – zzLxeMjeu7MBuLySBk0g
// 2024-10-28T09:26:40 – MW8izPbJoIOj2xa3ZzKK
// 2024-11-12T16:14:42 – xLZnRzgzZlbi4maCVbKE
// 2024-11-21T21:04:24 – Haky2s0atK45HwrtDj33
// 2024-12-13T17:26:50 – XcyIDeD3VLwivaBBs9Gi
// 2024-12-16T07:05:46 – cF09TGHTIgg3GeDugo3M
// 2024-12-23T08:36:33 – O6Sh5WflSiFwj4byqBqI
// 2024-12-25T20:22:57 – DuvaFt62aCYqt9j2yVIa
// 2025-01-15T03:27:04 – 6IcDOjdWgfAyUUV1rolE
// 2025-01-16T22:29:00 – h9UH9pQErXqit17WyNrI
// 2025-01-19T14:20:55 – PUuQpK1OiPCfUAJ8zbVW
// 2025-01-20T22:04:31 – iq9KIVSJJNOBGQAi49Vq
// 2025-02-20T06:34:22 – bGDGDLp3DlFVjdOyivcO
// 2025-03-03T07:59:22 – UO7G1ukkNIfBV671JwmN
// 2025-03-03T15:09:49 – oD5YnsrVkbQtVg7KMvHz
// 2025-03-12T19:41:54 – BSmv1gP2kixHG1grpLwd
// 2025-04-13T03:36:06 – h5WXgIKL72IHDMcwc9eD
// 2025-05-23T15:59:05 – p6MlGB6dytm1c7a73qKp
// 2025-06-09T19:39:21 – lhD9wyXqa3BuiZG8lGjt
// 2025-06-12T13:25:08 – U4YRYT2rsp3ntANj12Gd
// 2025-06-12T14:12:36 – EkzGiBwrbkGY6eYDfpfi
