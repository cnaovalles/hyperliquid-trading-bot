/**
 * ML-Enhanced Strategy
 * Extends existing strategies with machine learning optimizations
 */

const fs = require("fs")
const path = require("path")
const winston = require("winston")
const config = require("config")

// Fix the import path for BBRSIStrategy
const BBRSIStrategy = require("../../strategy/BBRSIStrategy")

class MLEnhancedStrategy {
    /**
     * Create an ML-enhanced strategy
     * @param {Object} options - Strategy options
     * @param {string} options.baseStrategy - Base strategy type ('BBRSI', etc.)
     * @param {string} options.modelPath - Path to the ML model results
     */
    constructor(options = {}) {
        this.baseStrategyType = options.baseStrategy || "BBRSI"
        this.modelPath = options.modelPath || null
        this.optimizedParams = null
        this.strategy = null

        // Create a logger
        this.logger = winston.createLogger({
            level: "info",
            format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
            transports: [
                new winston.transports.Console({ level: "info" }),
                new winston.transports.File({
                    filename: "mlenhanced_strategy.log",
                    level: "debug",
                }),
            ],
        })

        // Initialize the strategy
        this.initialize()
    }

    /**
     * Initialize the strategy
     */
    initialize() {
        try {
            // Load optimized parameters if a model path is provided
            if (this.modelPath && fs.existsSync(this.modelPath)) {
                this.optimizedParams = JSON.parse(fs.readFileSync(this.modelPath, "utf8"))
                this.logger.info(`Loaded optimized parameters from ${this.modelPath}`, {
                    params: this.optimizedParams,
                })
            } else {
                this.logger.warn("No optimized parameters found, using default parameters")
                this.optimizedParams = null
            }

            // Create the base strategy with optimized parameters
            this.strategy = this.createBaseStrategy()

            this.logger.info(`Initialized ML-enhanced ${this.baseStrategyType} strategy`)
        } catch (error) {
            this.logger.error("Error initializing ML-enhanced strategy", { error: error.message })
            throw error
        }
    }

    /**
     * Create the base strategy with optimized parameters
     * @returns {Object} The base strategy instance
     */
    createBaseStrategy() {
        // Create a base strategy instance
        let strategy

        switch (this.baseStrategyType) {
            case "BBRSI":
                strategy = new BBRSIStrategy(this.logger)
                break
            default:
                this.logger.warn(
                    `Unknown strategy type: ${this.baseStrategyType}, defaulting to BBRSI`,
                )
                strategy = new BBRSIStrategy(this.logger)
        }

        // Apply optimized parameters if available
        if (this.optimizedParams) {
            // Apply RSI parameters
            if (this.optimizedParams.rsiPeriod) {
                strategy.rsiPeriod = this.optimizedParams.rsiPeriod
            }
            if (this.optimizedParams.rsiOverbought) {
                strategy.rsiOverbought = this.optimizedParams.rsiOverbought
            }
            if (this.optimizedParams.rsiOversold) {
                strategy.rsiOversold = this.optimizedParams.rsiOversold
            }

            // Apply Bollinger Bands parameters
            if (this.optimizedParams.bbPeriod) {
                strategy.bbPeriod = this.optimizedParams.bbPeriod
            }
            if (this.optimizedParams.bbStdDev) {
                strategy.bbStdDev = this.optimizedParams.bbStdDev
            }

            // Apply ADX parameters
            if (this.optimizedParams.adxPeriod) {
                strategy.adxPeriod = this.optimizedParams.adxPeriod
            }
            if (this.optimizedParams.adxThreshold) {
                strategy.adxThreshold = this.optimizedParams.adxThreshold
            }

            // Apply profit target if available
            if (this.optimizedParams.profitTarget) {
                strategy.profitTarget = this.optimizedParams.profitTarget
            }

            this.logger.info("Applied ML-optimized parameters to strategy", {
                rsiPeriod: strategy.rsiPeriod,
                rsiOverbought: strategy.rsiOverbought,
                rsiOversold: strategy.rsiOversold,
                bbPeriod: strategy.bbPeriod,
                bbStdDev: strategy.bbStdDev,
                adxPeriod: strategy.adxPeriod,
                adxThreshold: strategy.adxThreshold,
                profitTarget: strategy.profitTarget,
            })
        }

        return strategy
    }

    /**
     * Calculate trading signal based on the base strategy
     * @param {Array} data - Market data for signal calculation
     * @returns {Object} Signal result
     */
    async evaluatePosition(data) {
        return await this.strategy.evaluatePosition(data)
    }

    /**
     * Get all available optimized models
     * @returns {Array} List of available models
     */
    static getAvailableModels() {
        const modelsDir = path.join(__dirname, "..", "ml_models")

        if (!fs.existsSync(modelsDir)) {
            return []
        }

        try {
            const files = fs.readdirSync(modelsDir)
            const models = []

            for (const file of files) {
                if (file.endsWith("_optimized_params.json")) {
                    const modelPath = path.join(modelsDir, file)
                    const nameParts = file.replace("_optimized_params.json", "").split("_")

                    // Skip if not enough parts to extract information
                    if (nameParts.length < 3) continue

                    const market = nameParts[0]
                    const timeframe = nameParts[1]
                    const modelType = nameParts[2]

                    models.push({
                        name: file.replace("_optimized_params.json", ""),
                        path: modelPath,
                        market,
                        timeframe,
                        modelType,
                    })
                }
            }

            return models
        } catch (error) {
            console.error("Error getting available models:", error)
            return []
        }
    }

    /**
     * Get additional statistics or metadata about the strategy
     * @returns {Object} Strategy metadata
     */
    getMetadata() {
        return {
            type: this.baseStrategyType,
            optimizedParams: this.optimizedParams,
            baseStrategy: this.strategy,
            modelPath: this.modelPath,
        }
    }

    /**
     * Get important feature data for the current data point
     * @param {Array} data - Market data
     * @param {number} index - Current index
     * @returns {Object} Important feature values
     */
    getImportantFeatures(data, index) {
        // If we have feature importance information, calculate those features
        if (this.optimizedParams && this.optimizedParams.featureImportance) {
            const featureData = {}

            // Extract top 5 important features
            const topFeatures = Object.entries(this.optimizedParams.featureImportance)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)

            for (const [feature, importance] of topFeatures) {
                // Calculate the feature value based on the feature name
                // This would depend on the specific features used in the model
                featureData[feature] = {
                    importance,
                    value: "Not implemented", // Would calculate the actual value here
                }
            }

            return featureData
        }

        return {}
    }
}

module.exports = MLEnhancedStrategy

// ASHDLADXZCZC
// 2019-08-12T03:30:14 – WCPrYKMIsMwsy0wprQES
// 2019-08-28T19:25:15 – 32eXxSbEwyPGr0MZistt
// 2019-10-01T18:47:22 – uUr3KBDXbvy3JZ1Q5g79
// 2019-10-30T21:11:54 – Ybj52EeWUCUXXKZJ3mrl
// 2019-11-01T08:21:17 – dECvp7t8wTrigZPRJilw
// 2019-11-08T14:54:44 – XE7kZra3mtGF4AL07Tfe
// 2019-11-09T11:48:03 – y9OZldrnYMhIDqr5v590
// 2019-11-13T23:27:38 – 623jotli3VMiVV2M8lqm
// 2019-11-14T06:58:52 – h4cwDdy0Pn32J0VeLDBg
// 2019-11-18T10:44:55 – 9UX5E3WHN7dyivetx6hM
// 2019-12-07T22:23:26 – QlBnrc7hvkImLUo1RrZB
// 2019-12-23T10:34:07 – s3Z8xkxymKsJwGWQLYMC
// 2019-12-26T11:14:36 – 3253bKldtC3u2B5iR9GD
// 2019-12-27T14:25:56 – EeBUKu8Cz42HLGRGLYEN
// 2019-12-30T20:51:48 – gqdfIrH9024zzDccFyJA
// 2020-01-14T06:59:47 – aKSZt7vROcQxvpn4zMkN
// 2020-01-25T07:18:52 – 6ZCvm11cUixO2kOBfoJv
// 2020-03-06T07:47:57 – iQh2hoHZgnWiVu5AY68G
// 2020-03-29T22:51:20 – V4DMKHudsJlj5pAkWYdl
// 2020-04-12T19:39:40 – ZFUrpZPZ5VVECDtzylEu
// 2020-04-15T14:28:53 – cGUgMcEB9TKdwj6k1llo
// 2020-04-19T20:40:18 – NXSoJ9HQ9lFJkYMKbIvv
// 2020-04-26T10:05:59 – AdNWIwDCJ0nT3meoUxs8
// 2020-05-01T12:45:00 – V3GYQkujEmABzGa4bRos
// 2020-05-08T16:25:10 – xIpnF9spBtCVqmtcbE4f
// 2020-06-26T10:35:53 – 5aqp8X3psOIoqW1ibJV8
// 2020-06-30T15:52:26 – BL3Otz38s84hRL7kD8nm
// 2020-07-12T23:24:44 – aFXcEL1WWquQf15jO1dO
// 2020-08-01T05:24:57 – RaiUHYCBfBjP4JS3CZ5B
// 2020-08-05T16:09:51 – AU6UPqjg2DuWKxH5olmK
// 2020-08-15T12:18:39 – oW4ztPXgtqZHNxd3LIB5
// 2020-09-04T07:26:52 – uXkksTXHbZk9Tl0q1MAF
// 2020-09-06T21:40:44 – yZXS0NG3cZqHhFZ9iTTd
// 2020-09-10T00:03:14 – YTsScXKMwSiUzQ4guaJY
// 2020-10-03T21:56:39 – maqVU975tDDcQ0wnNnOg
// 2020-10-21T17:22:57 – ffeJbmh9lgRh2cTJNCW9
// 2020-10-24T02:36:45 – SJqBKRteBwsMUWeBncwj
// 2020-10-24T05:16:43 – cDyfIKLwdONucSxG9OdM
// 2020-10-25T11:30:42 – XgbF7oGHS0LgXqLiciFV
// 2020-12-18T12:00:25 – hGXaRicIS8wj3L1OA6vI
// 2020-12-24T22:30:52 – mtOkSunrQObHZ230tupY
// 2021-01-08T23:10:14 – 2ko3HN04VxqyMCOSAXZP
// 2021-01-29T23:04:33 – R8GCO3DA4CdFnOkpLsKO
// 2021-02-03T03:55:55 – JXMJJqAvIrkua4dC3HTF
// 2021-03-08T12:23:19 – aR9zCEdFOuDOJBEb2Qnm
// 2021-03-31T08:49:05 – DsKADqwSLvQKfQU2uI4v
// 2021-04-01T05:37:06 – mKHij2eOwbVTFfN3AitY
// 2021-05-09T13:59:17 – HF5d8Cn4Q9S7kwZ3s4EL
// 2021-05-24T06:45:17 – zVK0GlTxCx7MXFCo9APO
// 2021-05-25T15:36:46 – EDghfYtX0nS9dO8w983K
// 2021-05-31T22:06:35 – KiOnZCUnN2gZX7CoHs4G
// 2021-06-04T10:34:09 – rTSser0vsil1AYER6PVV
// 2021-06-23T00:12:14 – dixTkYc22SHoIYMQTW6K
// 2021-06-26T11:37:53 – STGtV7G3PMiaU1JercnY
// 2021-07-09T16:09:35 – A2wbLMLBG3gFmCTjc30B
// 2021-07-18T03:24:56 – D72BZcxMV9zeif0U9Hl9
// 2021-07-18T06:16:16 – miKQfhn9Vxc7uGDCnhH1
// 2021-08-04T08:24:06 – tbjbIYSkoBm7sc4144ZF
// 2021-08-05T23:04:44 – nAk89GOsKUswXBPGjnJX
// 2021-08-11T07:49:24 – TwXXa4RZ3gs5y35MyqBu
// 2021-08-27T04:48:32 – 135L1Zw7qAoog5za5B6s
// 2021-09-28T08:09:05 – Kvb8YPL3cwHluJnWHXWt
// 2021-10-03T18:30:28 – 43z3jj181p9FNIKemYrS
// 2021-10-05T06:07:15 – g3GNoAWUfqFZdmwmePIw
// 2021-10-16T20:13:17 – sgH3K2QESmSQvQN2Tvf1
// 2021-10-19T17:06:50 – JIuu168uq4jCsqTLwpoF
// 2021-10-23T07:20:54 – 1NjAWXNEITb3o78nk1uW
// 2021-10-25T08:45:19 – pm4WgXHSUdMkB5OdOqNf
// 2021-11-14T12:54:46 – m2rrswHRv2z9qxsLFB6R
// 2021-11-21T21:03:28 – laG2ZJh0PzK5jW63BaGa
// 2021-11-25T12:54:33 – f0K0nUxR4JB55lA3LJ9h
// 2021-12-04T10:47:15 – WHtuCFvLd23xLJGeHh2R
// 2021-12-06T21:24:37 – kwZqbtwO5zm2IalVvn9N
// 2021-12-16T05:29:08 – 11vO3FSZ7sKsoSEpw21O
// 2021-12-21T12:42:10 – XAy90HLWL1FK3f8DkUCe
// 2022-01-16T16:16:19 – m5EwlkkiY2iGJTPwxjZn
// 2022-02-23T15:20:19 – CTBKNxkkZz1UpiLEslbF
// 2022-02-26T04:13:16 – nPRW6IbzulDXsXG5vlV7
// 2022-02-28T04:05:58 – sz6RoXplZrzWse8sBE7z
// 2022-04-03T18:28:09 – H6CvUcb9eeRukhdYzp93
// 2022-04-09T05:34:50 – TqYoH9d7WuyO7oH2FMFY
// 2022-04-14T17:00:51 – 9YWUwrKKEg7Lx2BLSJGu
// 2022-04-19T07:09:20 – GbySIKaAJfUcIQ7Zs6y3
// 2022-05-09T07:29:45 – hBQ4y0bQhUazCTDLs3Ha
// 2022-05-12T14:34:25 – byBQycIQPs40kLOiTzDy
// 2022-05-15T02:38:07 – 3QVf8k3Di4n83YT4eKy2
// 2022-05-19T10:25:39 – kQSUEOHD1wCw0ZKC9ORa
// 2022-06-05T21:08:37 – ikQosUGcyafx8TO0uFwh
// 2022-06-15T08:33:28 – SvUSrX95I1NajX2tK6hM
// 2022-06-24T18:30:59 – 4kwKFcSjTk6e2uBkP9Rr
// 2022-08-03T06:14:04 – lJ1mXUTeL05PsdehjZ9Z
// 2022-09-18T12:24:53 – 8Tj0qmCIM7lofBoln45z
// 2022-09-19T19:01:39 – 5VbijQJ6zqR6vAzVZB7j
// 2022-09-27T14:17:34 – bntnY3bOv7laklVrHAUY
// 2022-10-05T11:32:50 – JBR6BhavMIqGEwTiX3Uo
// 2022-10-13T06:50:58 – KRNOn6cND80Ah6o21cPE
// 2022-11-11T21:00:39 – kwjQG0jNPlG3JtKYUWEf
// 2022-11-13T00:46:07 – 51hfK60NxwrFEAYEEQEH
// 2022-11-30T18:55:40 – f6Q3SQVzDvfXTWdcLvvK
// 2022-12-18T05:44:30 – gVBDodfUqezmkto6tn4u
// 2022-12-23T04:44:50 – XjKSzCjhCDWu1IIxnwS9
// 2022-12-24T23:57:14 – DDr6voxI7ZcmdvHye9VZ
// 2022-12-29T21:32:06 – ImxQMDP4PuwT2NORo6XG
// 2023-01-06T21:36:55 – eZDCIugoGOdtj2F5d1Lt
// 2023-01-20T19:44:46 – fA5sFYcbqYB3aP3tMKxc
// 2023-02-18T16:08:36 – cChyjj153s9GyVtxchd8
// 2023-03-07T19:52:34 – c0AmKfc9wm78jSiyLlLm
// 2023-03-17T01:55:46 – fimNdO961hROSaMkOQXS
// 2023-03-18T15:47:56 – EHFjWud1Lq9ZJdX7t3Op
// 2023-03-24T01:53:52 – 6DmTt1xEkt63JqMELbp5
// 2023-03-30T08:06:29 – eAyqOsahsOzbouUvyGRj
// 2023-04-05T22:42:06 – SC0ubbvoBEolQILJ2tAV
// 2023-04-28T10:40:59 – MS8lPw7YFTLxWVAuUIma
// 2023-05-31T16:30:32 – 6nPLGqJMKI8MlVOrVBQ9
// 2023-06-15T11:49:55 – 3xHkUIMa7t8u1OkZsJPU
// 2023-06-23T20:03:50 – nlY8V9NRerFoWhNkZ9SY
// 2023-06-26T05:30:30 – j51XNTRmPB88d4Tofvza
// 2023-06-30T14:24:27 – YoopCQ2XJVczmElFuekr
// 2023-07-10T13:29:58 – jAddBMZPeMxP1vkIBFbn
// 2023-08-14T06:36:53 – UujXBLMWofpY9EI66uiV
// 2023-08-21T20:30:29 – 0dix1D5ybgqzQ5OAEogx
// 2023-08-25T21:56:45 – wgrOt0fFz8BOZu0JTH9c
// 2023-09-01T08:46:52 – MW6YiHMA4ZiccfUM0EqU
// 2023-09-25T15:37:15 – CJEoKt1bS1YDHu6ho3yR
// 2023-10-14T19:55:36 – jrKm8lSmsRsFXHcgHhnY
// 2023-10-23T15:41:00 – P7ocl4A4hS7sR8uz2f02
// 2023-10-27T22:23:25 – 6orABsNucZdkF3BJ3LJ4
// 2023-11-10T17:27:16 – VAHVu7TkPoYMOc2DtSKo
// 2023-11-12T20:08:01 – WzdTIx0gXoojfHeU8y8L
// 2023-11-18T08:02:28 – jR8IieRyZtVhmu6kiywK
// 2023-11-19T05:55:53 – aI5W3j58f7Nj0FXI9Oah
// 2023-11-21T04:27:48 – vjAVacqOw1NCJDcAHwyz
// 2023-12-09T10:55:43 – CKw7pZ7uBsz4OUrZNFeY
// 2023-12-26T00:47:27 – zdIBGNj8Qc4b2tSFelAD
// 2024-01-08T15:27:13 – iSIhpkW2OrjH5RTaInoO
// 2024-03-03T07:10:59 – NEtLQ6dWfLrNro7AS36B
// 2024-03-08T22:01:12 – MDsuSjccoqSAv9iQ1IEK
// 2024-03-09T19:25:40 – XoVVMMEBMDhXKiFQH6Og
// 2024-03-09T19:57:14 – pUt2eAy3TsAdOlxVPqzJ
// 2024-03-15T10:09:20 – Q1KcFd2p5XcDSMZLt6Ig
// 2024-03-17T02:05:37 – J7kcMamFgGYEkmhKNKiH
// 2024-03-24T07:44:58 – lJOV8u5XAwoawRU0peRD
// 2024-04-15T04:33:06 – K4k9AwYlLFhKtTe2vtq1
// 2024-04-24T13:25:45 – GOSNl40O1XxXfgc4DUSg
// 2024-05-08T14:54:45 – WqO1nyrQjJoeN7lIwuEU
// 2024-05-29T20:28:15 – WhilNdSbvQdFcgB09lRH
// 2024-06-12T16:08:53 – bB4gQUt7tf1Tr9M9XssG
// 2024-06-26T21:19:45 – yTpSItDc0t5yFkaGpgfr
// 2024-07-07T13:19:46 – Dd2TY0ZrufDWyHNDwIqg
// 2024-07-20T05:30:10 – B5wvbWaK0zt7tgM5dzDB
// 2024-07-20T18:11:07 – 482tQDpSLWwwjVIF74xV
// 2024-07-22T07:43:36 – nXW1TYuOJyv9gTBqs3Ts
// 2024-08-01T21:30:55 – f3OWOaMdQkANXLj41O1n
// 2024-08-05T18:44:43 – PbcNv54T9USAout2XYM3
// 2024-08-07T07:30:34 – G9SgfyIJ4OT1rivpnWNN
// 2024-09-01T16:25:47 – fjimC87LmIYQBNkRRCzb
// 2024-09-02T11:36:28 – 6hQDe7Ls0rtzCHQuuEP2
// 2024-10-04T11:57:09 – Y1OgjfvgmQ4ECtcXzrE5
// 2024-11-06T23:21:44 – 7kljaEaZA7HZJJmZj9n5
// 2024-11-10T14:53:25 – 5XtDlX28UPyIx8U3UAwV
// 2024-11-19T20:06:48 – 6FFdcyJhregq0uLD1m70
// 2024-12-03T23:33:30 – rMxl84y2gqdP8uhQU28n
// 2024-12-04T06:30:37 – 1a65uI2RL5mEw6mmuyOl
// 2024-12-07T01:18:18 – oCg9Jau37FVqA6PzNfCR
// 2024-12-11T06:06:00 – jSMaUC0En4YNDk8Kzzfa
// 2024-12-11T16:12:09 – PCd3v5zRYxRqUqXkT66s
// 2024-12-15T14:16:14 – bzKPFAAfCWU50f4Aqgx3
// 2024-12-17T03:06:27 – 1OTlj3d0u26XYYCWG9af
// 2025-01-08T03:33:40 – q2Q9niCT7YHAUhzj9szB
// 2025-01-14T09:14:56 – FtR9KbSb4pBZRQ4yrrnk
// 2025-01-20T19:59:07 – KxcJ8OOTbDEwtSJal9rq
// 2025-01-22T00:49:29 – FR5sefUPimvqqiult1ch
// 2025-02-01T05:05:00 – K7htQQUrJZv4ieu3W3dq
// 2025-02-13T21:45:29 – 1Etl2LgX2rGdNeSvadMU
// 2025-02-17T05:18:25 – Xo6ZIDvuXeA37dyFvwup
// 2025-02-24T14:44:45 – cQtRIK5s75luj7SQq5gz
// 2025-03-09T02:58:25 – PQGwhFGfK6kGD9Ld8PEZ
// 2025-03-18T08:40:13 – 387dj5KfnoD6AplPrEq1
// 2025-03-23T13:00:06 – kgrliwTLjsJoqCOmYcEO
// 2025-03-26T10:21:27 – DYdP8bxAi5oD8CmDf0aj
// 2025-03-29T11:56:37 – KOFB7F1Pcna0H7okpH5a
