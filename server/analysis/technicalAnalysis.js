import {
    EMA, RSI, MACD, BollingerBands, ATR, ADX, Stochastic, CCI, SMA
} from 'technicalindicators';

/**
 * Run full technical analysis on OHLCV data
 * @param {Array} candles - Array of {open, high, low, close, volume, time}
 * @param {string} timeframe - Timeframe label (M15, H1, H4, D1)
 * @returns {Object} Complete technical analysis results
 */
export function runTechnicalAnalysis(candles, timeframe) {
    if (!candles || candles.length < 30) {
        return { error: 'Insufficient data', timeframe };
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);
    const currentPrice = closes[closes.length - 1];

    // ===== TREND INDICATORS =====
    const ema20 = EMA.calculate({ period: 20, values: closes });
    const ema50 = EMA.calculate({ period: 50, values: closes });
    const ema200 = candles.length >= 200 ? EMA.calculate({ period: 200, values: closes }) : [];

    const currentEma20 = ema20.length > 0 ? ema20[ema20.length - 1] : null;
    const currentEma50 = ema50.length > 0 ? ema50[ema50.length - 1] : null;
    const currentEma200 = ema200.length > 0 ? ema200[ema200.length - 1] : null;

    // EMA Alignment
    let emaAlignment = 'mixed';
    if (currentEma20 && currentEma50) {
        if (currentEma20 > currentEma50 && (currentEma200 === null || currentEma50 > currentEma200)) {
            emaAlignment = 'bullish';
        } else if (currentEma20 < currentEma50 && (currentEma200 === null || currentEma50 < currentEma200)) {
            emaAlignment = 'bearish';
        }
    }

    // MACD
    const macdResult = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });
    const currentMacd = macdResult.length > 0 ? macdResult[macdResult.length - 1] : null;
    const prevMacd = macdResult.length > 1 ? macdResult[macdResult.length - 2] : null;

    // ADX (Trend Strength)
    const adxResult = ADX.calculate({ close: closes, high: highs, low: lows, period: 14 });
    const currentAdx = adxResult.length > 0 ? adxResult[adxResult.length - 1] : null;

    // ===== MOMENTUM INDICATORS =====
    const rsiResult = RSI.calculate({ values: closes, period: 14 });
    const currentRsi = rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : null;

    const stochResult = Stochastic.calculate({
        high: highs, low: lows, close: closes,
        period: 14, signalPeriod: 3
    });
    const currentStoch = stochResult.length > 0 ? stochResult[stochResult.length - 1] : null;

    const cciResult = CCI.calculate({ close: closes, high: highs, low: lows, period: 20 });
    const currentCCI = cciResult.length > 0 ? cciResult[cciResult.length - 1] : null;

    // ===== VOLATILITY =====
    const atrResult = ATR.calculate({ close: closes, high: highs, low: lows, period: 14 });
    const currentAtr = atrResult.length > 0 ? atrResult[atrResult.length - 1] : null;
    const avgAtr = atrResult.length > 5 ?
        atrResult.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, atrResult.length) : currentAtr;

    const bbResult = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
    const currentBB = bbResult.length > 0 ? bbResult[bbResult.length - 1] : null;

    // ===== SUPPORT & RESISTANCE =====
    const sr = calculateSupportResistance(candles);

    // ===== CANDLESTICK PATTERNS =====
    const patterns = detectCandlePatterns(candles);

    // ===== OVERALL BIAS =====
    const bias = calculateBias({
        emaAlignment, currentRsi, currentMacd, currentStoch, currentAdx, currentPrice,
        currentEma20, currentEma50, currentBB
    });

    return {
        timeframe,
        currentPrice,

        trend: {
            ema20: round(currentEma20),
            ema50: round(currentEma50),
            ema200: round(currentEma200),
            emaAlignment,
            macd: currentMacd ? {
                macd: round(currentMacd.MACD),
                signal: round(currentMacd.signal),
                histogram: round(currentMacd.histogram),
                crossover: prevMacd ?
                    (prevMacd.MACD < prevMacd.signal && currentMacd.MACD > currentMacd.signal ? 'bullish_cross' :
                        prevMacd.MACD > prevMacd.signal && currentMacd.MACD < currentMacd.signal ? 'bearish_cross' : 'none')
                    : 'none'
            } : null,
            adx: currentAdx ? {
                adx: round(currentAdx.adx),
                pdi: round(currentAdx.pdi),
                mdi: round(currentAdx.mdi),
                trendStrength: currentAdx.adx > 25 ? 'strong' : currentAdx.adx > 20 ? 'moderate' : 'weak'
            } : null
        },

        momentum: {
            rsi: {
                value: round(currentRsi),
                condition: currentRsi > 70 ? 'overbought' : currentRsi < 30 ? 'oversold' : 'neutral'
            },
            stochastic: currentStoch ? {
                k: round(currentStoch.k),
                d: round(currentStoch.d),
                condition: currentStoch.k > 80 ? 'overbought' : currentStoch.k < 20 ? 'oversold' : 'neutral'
            } : null,
            cci: {
                value: round(currentCCI),
                condition: currentCCI > 100 ? 'overbought' : currentCCI < -100 ? 'oversold' : 'neutral'
            }
        },

        volatility: {
            atr: round(currentAtr),
            atrAvg: round(avgAtr),
            atrRatio: currentAtr && avgAtr ? round(currentAtr / avgAtr) : 1,
            volatilityLevel: currentAtr > avgAtr * 1.3 ? 'high' : currentAtr < avgAtr * 0.7 ? 'low' : 'normal',
            bollingerBands: currentBB ? {
                upper: round(currentBB.upper),
                middle: round(currentBB.middle),
                lower: round(currentBB.lower),
                bandwidth: round((currentBB.upper - currentBB.lower) / currentBB.middle * 100),
                position: currentPrice > currentBB.upper ? 'above_upper' :
                    currentPrice < currentBB.lower ? 'below_lower' :
                        currentPrice > currentBB.middle ? 'upper_half' : 'lower_half'
            } : null
        },

        supportResistance: sr,
        candlePatterns: patterns,
        bias
    };
}

/**
 * Calculate Support and Resistance levels using pivot points
 */
function calculateSupportResistance(candles) {
    const recent = candles.slice(-50);
    const highs = recent.map(c => c.high);
    const lows = recent.map(c => c.low);
    const closes = recent.map(c => c.close);

    const highestHigh = Math.max(...highs);
    const lowestLow = Math.min(...lows);
    const currentClose = closes[closes.length - 1];

    // Simple pivot point calculation
    const lastCandle = recent[recent.length - 1];
    const pivot = (lastCandle.high + lastCandle.low + lastCandle.close) / 3;

    const r1 = 2 * pivot - lastCandle.low;
    const s1 = 2 * pivot - lastCandle.high;
    const r2 = pivot + (lastCandle.high - lastCandle.low);
    const s2 = pivot - (lastCandle.high - lastCandle.low);

    // Find cluster-based S/R
    const levels = findPriceClusters(recent);

    return {
        pivot: round(pivot),
        resistance: [round(r1), round(r2), round(highestHigh)],
        support: [round(s1), round(s2), round(lowestLow)],
        keyLevels: levels,
        range: round(highestHigh - lowestLow)
    };
}

/**
 * Find price clusters that act as S/R
 */
function findPriceClusters(candles) {
    const prices = [];
    candles.forEach(c => {
        prices.push(c.high);
        prices.push(c.low);
    });

    prices.sort((a, b) => a - b);
    const clusters = [];
    const threshold = (Math.max(...prices) - Math.min(...prices)) * 0.01;

    let i = 0;
    while (i < prices.length) {
        const clusterPrices = [prices[i]];
        let j = i + 1;
        while (j < prices.length && prices[j] - prices[i] < threshold) {
            clusterPrices.push(prices[j]);
            j++;
        }
        if (clusterPrices.length >= 3) {
            clusters.push({
                price: round(clusterPrices.reduce((a, b) => a + b) / clusterPrices.length),
                touches: clusterPrices.length
            });
        }
        i = j;
    }

    return clusters.sort((a, b) => b.touches - a.touches).slice(0, 5);
}

/**
 * Detect basic candlestick patterns
 */
function detectCandlePatterns(candles) {
    const patterns = [];
    const len = candles.length;
    if (len < 3) return patterns;

    const c = candles[len - 1]; // Current candle
    const p = candles[len - 2]; // Previous candle
    const pp = candles[len - 3]; // Prev-previous

    const bodyC = Math.abs(c.close - c.open);
    const bodyP = Math.abs(p.close - p.open);
    const rangeC = c.high - c.low;
    const rangeP = p.high - p.low;
    const isBullishC = c.close > c.open;
    const isBullishP = p.close > p.open;

    // Doji
    if (bodyC < rangeC * 0.1 && rangeC > 0) {
        patterns.push({ name: 'Doji', type: 'reversal', direction: 'neutral' });
    }

    // Hammer (bullish reversal)
    const lowerShadow = Math.min(c.open, c.close) - c.low;
    const upperShadow = c.high - Math.max(c.open, c.close);
    if (lowerShadow > bodyC * 2 && upperShadow < bodyC * 0.5 && bodyC > 0) {
        patterns.push({ name: 'Hammer', type: 'reversal', direction: 'bullish' });
    }

    // Shooting Star (bearish reversal)
    if (upperShadow > bodyC * 2 && lowerShadow < bodyC * 0.5 && bodyC > 0) {
        patterns.push({ name: 'Shooting Star', type: 'reversal', direction: 'bearish' });
    }

    // Bullish Engulfing
    if (!isBullishP && isBullishC && c.open <= p.close && c.close >= p.open && bodyC > bodyP) {
        patterns.push({ name: 'Bullish Engulfing', type: 'reversal', direction: 'bullish' });
    }

    // Bearish Engulfing
    if (isBullishP && !isBullishC && c.open >= p.close && c.close <= p.open && bodyC > bodyP) {
        patterns.push({ name: 'Bearish Engulfing', type: 'reversal', direction: 'bearish' });
    }

    // Morning Star (3-candle bullish reversal)
    const bodyPP = Math.abs(pp.close - pp.open);
    if (!pp.close > pp.open && bodyP < bodyPP * 0.3 && isBullishC && bodyC > bodyPP * 0.5) {
        patterns.push({ name: 'Morning Star', type: 'reversal', direction: 'bullish' });
    }

    return patterns;
}

/**
 * Calculate overall bias from all indicators
 */
function calculateBias({ emaAlignment, currentRsi, currentMacd, currentStoch, currentAdx, currentPrice, currentEma20, currentEma50, currentBB }) {
    let bullPoints = 0;
    let bearPoints = 0;

    // EMA alignment (weight: 2)
    if (emaAlignment === 'bullish') bullPoints += 2;
    else if (emaAlignment === 'bearish') bearPoints += 2;

    // Price vs EMA20 (weight: 1)
    if (currentPrice && currentEma20) {
        if (currentPrice > currentEma20) bullPoints += 1;
        else bearPoints += 1;
    }

    // RSI (weight: 1)
    if (currentRsi) {
        if (currentRsi > 55) bullPoints += 1;
        else if (currentRsi < 45) bearPoints += 1;
    }

    // MACD (weight: 2)
    if (currentMacd) {
        if (currentMacd.MACD > currentMacd.signal) bullPoints += 2;
        else bearPoints += 2;
        if (currentMacd.histogram > 0) bullPoints += 1;
        else bearPoints += 1;
    }

    // Stochastic (weight: 1)
    if (currentStoch) {
        if (currentStoch.k > 50) bullPoints += 1;
        else bearPoints += 1;
    }

    // ADX (amplifier)
    const trendStrong = currentAdx && currentAdx.adx > 25;

    const total = bullPoints + bearPoints;
    const bullPct = total > 0 ? (bullPoints / total * 100).toFixed(0) : 50;

    let direction = 'SIDEWAYS';
    if (bullPoints > bearPoints + 2) direction = 'BULLISH';
    else if (bearPoints > bullPoints + 2) direction = 'BEARISH';
    else if (bullPoints > bearPoints) direction = 'SLIGHTLY_BULLISH';
    else if (bearPoints > bullPoints) direction = 'SLIGHTLY_BEARISH';

    return {
        direction,
        bullishScore: bullPoints,
        bearishScore: bearPoints,
        bullishPct: parseInt(bullPct),
        trendStrong,
        summary: `${direction} (Bull: ${bullPoints} / Bear: ${bearPoints})${trendStrong ? ' [Strong Trend]' : ''}`
    };
}

function round(val) {
    if (val === null || val === undefined) return null;
    return Math.round(val * 100) / 100;
}
