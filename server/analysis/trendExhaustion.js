import { EMA, RSI, MACD, ATR, ADX, BollingerBands } from 'technicalindicators';

/**
 * QuantumAI – Trend Exhaustion Detection Module
 * 
 * Phát hiện khi một xu hướng đang kiệt sức (exhaustion) để tránh
 * vào lệnh ở cuối trend — nguyên nhân chính gây SL.
 * 
 * Trả về exhaustionScore (0-100):
 *   0-30:  Trend còn mạnh, an toàn vào lệnh
 *   31-49: Trend bắt đầu yếu, cẩn trọng
 *   50-69: Trend yếu đáng kể, giảm confidence
 *   70-100: Trend kiệt sức → HARD BLOCK, không vào lệnh
 */

/**
 * Main entry: Detect trend exhaustion across a single timeframe's candles
 * @param {Array} candles - OHLCV candle array
 * @param {string} direction - 'BULLISH' or 'BEARISH' (detected trend direction)
 * @returns {Object} { exhaustionScore, isExhausted, signals[], details }
 */
export function detectTrendExhaustion(candles, direction) {
    if (!candles || candles.length < 50) {
        return {
            exhaustionScore: 0,
            isExhausted: false,
            signals: [],
            details: {},
            label: 'Insufficient data'
        };
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const isBullish = direction === 'BULLISH';

    const signals = [];
    let totalScore = 0;
    const details = {};

    // ============================================================
    // 1. RSI DIVERGENCE (Weight: 25 points max)
    // ============================================================
    const rsiDiv = detectRsiDivergence(closes, highs, lows, isBullish);
    details.rsiDivergence = rsiDiv;
    if (rsiDiv.hasDivergence) {
        const score = rsiDiv.strength === 'strong' ? 25 : 15;
        totalScore += score;
        signals.push(`RSI ${rsiDiv.type} divergence (${rsiDiv.strength}) → +${score}`);
    }

    // ============================================================
    // 2. MACD HISTOGRAM FADING (Weight: 20 points max)
    // ============================================================
    const macdFade = detectMacdHistogramFading(closes, isBullish);
    details.macdFading = macdFade;
    if (macdFade.isFading) {
        const score = macdFade.fadingBars >= 4 ? 20 : macdFade.fadingBars >= 3 ? 15 : 10;
        totalScore += score;
        signals.push(`MACD Histogram fading ${macdFade.fadingBars} bars → +${score}`);
    }

    // ============================================================
    // 3. TREND DISTANCE / Z-SCORE (Weight: 20 points max)
    // ============================================================
    const trendDist = measureTrendDistance(closes, isBullish);
    details.trendDistance = trendDist;
    if (trendDist.isOverextended) {
        const score = Math.abs(trendDist.zScore) >= 2.5 ? 20 :
                      Math.abs(trendDist.zScore) >= 2.0 ? 15 : 10;
        totalScore += score;
        signals.push(`Trend overextended: Z-Score=${trendDist.zScore} → +${score}`);
    }

    // ============================================================
    // 4. ADX DECLINING (Weight: 15 points max)
    // ============================================================
    const adxDecl = detectAdxDeclining(closes, highs, lows);
    details.adxDeclining = adxDecl;
    if (adxDecl.isDeclining) {
        const score = adxDecl.fromAbove30 ? 15 : 10;
        totalScore += score;
        signals.push(`ADX declining from ${round(adxDecl.recentHigh)} → ${round(adxDecl.currentAdx)} → +${score}`);
    }

    // ============================================================
    // 5. MOMENTUM DECELERATION (Weight: 10 points max)
    // ============================================================
    const momDecel = detectMomentumDeceleration(closes, isBullish);
    details.momentumDecel = momDecel;
    if (momDecel.isDecelerating) {
        const score = momDecel.consecutiveBars >= 4 ? 10 : 7;
        totalScore += score;
        signals.push(`Momentum decelerating ${momDecel.consecutiveBars} bars → +${score}`);
    }

    // ============================================================
    // 6. BOLLINGER BAND SQUEEZE-BACK (Weight: 10 points max)
    // ============================================================
    const bbSqueeze = detectBBSqueezeBack(closes, isBullish);
    details.bbSqueezeBack = bbSqueeze;
    if (bbSqueeze.isSqueezing) {
        totalScore += 10;
        signals.push(`BB squeeze-back detected → +10`);
    }

    // ============================================================
    // FINAL SCORE
    // ============================================================
    const exhaustionScore = Math.min(100, totalScore);
    const isExhausted = exhaustionScore >= 70;

    let label;
    if (exhaustionScore >= 70) label = '🔴 KIỆT SỨC - KHÔNG VÀO LỆNH';
    else if (exhaustionScore >= 50) label = '🟡 Trend yếu đáng kể';
    else if (exhaustionScore >= 30) label = '🟢 Trend bắt đầu yếu';
    else label = '✅ Trend còn mạnh';

    return {
        exhaustionScore,
        isExhausted,
        signals,
        details,
        label,
        direction
    };
}

// ============================================================
// DETECTION FUNCTIONS
// ============================================================

/**
 * 1. Detect RSI Divergence (giá tạo HH nhưng RSI tạo LH, hoặc ngược lại)
 */
function detectRsiDivergence(closes, highs, lows, isBullish) {
    const rsiResult = RSI.calculate({ period: 14, values: closes });
    if (rsiResult.length < 20) {
        return { hasDivergence: false, type: 'none', strength: 'none' };
    }

    // Align RSI with price data (RSI starts 14 bars later)
    const offset = closes.length - rsiResult.length;
    const lookback = 20; // Look back 20 bars for swing points

    if (isBullish) {
        // Bearish divergence: price makes Higher High, RSI makes Lower High
        const swingHighs = findSwingHighs(highs, offset, lookback);
        if (swingHighs.length >= 2) {
            const [prev, curr] = swingHighs.slice(-2);
            const priceHH = highs[curr.index] > highs[prev.index];
            const rsiLH = rsiResult[curr.index - offset] < rsiResult[prev.index - offset];

            if (priceHH && rsiLH) {
                const rsiDiff = Math.abs(rsiResult[curr.index - offset] - rsiResult[prev.index - offset]);
                return {
                    hasDivergence: true,
                    type: 'bearish',
                    strength: rsiDiff > 10 ? 'strong' : 'moderate',
                    priceSwings: { prev: round(highs[prev.index]), curr: round(highs[curr.index]) },
                    rsiSwings: { prev: round(rsiResult[prev.index - offset]), curr: round(rsiResult[curr.index - offset]) }
                };
            }
        }
    } else {
        // Bullish divergence: price makes Lower Low, RSI makes Higher Low
        const swingLows = findSwingLows(lows, offset, lookback);
        if (swingLows.length >= 2) {
            const [prev, curr] = swingLows.slice(-2);
            const priceLL = lows[curr.index] < lows[prev.index];
            const rsiHL = rsiResult[curr.index - offset] > rsiResult[prev.index - offset];

            if (priceLL && rsiHL) {
                const rsiDiff = Math.abs(rsiResult[curr.index - offset] - rsiResult[prev.index - offset]);
                return {
                    hasDivergence: true,
                    type: 'bullish',
                    strength: rsiDiff > 10 ? 'strong' : 'moderate',
                    priceSwings: { prev: round(lows[prev.index]), curr: round(lows[curr.index]) },
                    rsiSwings: { prev: round(rsiResult[prev.index - offset]), curr: round(rsiResult[curr.index - offset]) }
                };
            }
        }
    }

    return { hasDivergence: false, type: 'none', strength: 'none' };
}

/**
 * 2. Detect MACD Histogram Fading (histogram bars getting smaller)
 */
function detectMacdHistogramFading(closes, isBullish) {
    const macdResult = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });

    if (macdResult.length < 5) {
        return { isFading: false, fadingBars: 0 };
    }

    // Check last 5 histogram bars for consistent fading
    const recent = macdResult.slice(-6);
    let fadingCount = 0;

    for (let i = recent.length - 1; i > 0; i--) {
        const curr = recent[i].histogram;
        const prev = recent[i - 1].histogram;

        if (isBullish) {
            // In uptrend: histogram should be positive and shrinking
            if (curr > 0 && prev > 0 && Math.abs(curr) < Math.abs(prev)) {
                fadingCount++;
            } else {
                break;
            }
        } else {
            // In downtrend: histogram should be negative and shrinking (becoming less negative)
            if (curr < 0 && prev < 0 && Math.abs(curr) < Math.abs(prev)) {
                fadingCount++;
            } else {
                break;
            }
        }
    }

    const currentHist = macdResult[macdResult.length - 1].histogram;
    const peakHist = isBullish
        ? Math.max(...recent.map(r => r.histogram))
        : Math.min(...recent.map(r => r.histogram));

    return {
        isFading: fadingCount >= 3,
        fadingBars: fadingCount,
        currentHistogram: round(currentHist),
        peakHistogram: round(peakHist),
        fadeRatio: peakHist !== 0 ? round(Math.abs(currentHist / peakHist)) : 1
    };
}

/**
 * 3. Measure how far price is from the mean (EMA50) using Z-Score
 */
function measureTrendDistance(closes, isBullish) {
    const ema50 = EMA.calculate({ period: 50, values: closes });
    if (ema50.length < 20) {
        return { zScore: 0, isOverextended: false, distancePct: 0 };
    }

    const currentPrice = closes[closes.length - 1];
    const currentEma50 = ema50[ema50.length - 1];

    // Calculate standard deviation of closes around EMA50
    const recentCloses = closes.slice(-50);
    const mean = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
    const stdDev = Math.sqrt(
        recentCloses.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / recentCloses.length
    );

    const zScore = stdDev > 0 ? round((currentPrice - currentEma50) / stdDev) : 0;
    const distancePct = round(((currentPrice - currentEma50) / currentEma50) * 100);

    // Count consecutive bars above/below EMA50
    let barsFromEma = 0;
    const offset = closes.length - ema50.length;
    for (let i = ema50.length - 1; i >= 0; i--) {
        if (isBullish && closes[i + offset] > ema50[i]) barsFromEma++;
        else if (!isBullish && closes[i + offset] < ema50[i]) barsFromEma++;
        else break;
    }

    // Overextended if:
    // - Z-Score > 1.5 in trend direction
    // - OR price has been on one side for 25+ bars
    const isOverextended = (isBullish && zScore > 1.5) ||
                           (!isBullish && zScore < -1.5) ||
                           barsFromEma >= 25;

    return {
        zScore,
        distancePct,
        currentPrice: round(currentPrice),
        ema50: round(currentEma50),
        barsFromEma,
        isOverextended
    };
}

/**
 * 4. Detect ADX declining from strong trend territory
 */
function detectAdxDeclining(closes, highs, lows) {
    const adxResult = ADX.calculate({ close: closes, high: highs, low: lows, period: 14 });
    if (adxResult.length < 5) {
        return { isDeclining: false, currentAdx: 0, recentHigh: 0, fromAbove30: false };
    }

    const recent = adxResult.slice(-8);
    const currentAdx = recent[recent.length - 1].adx;
    const recentHigh = Math.max(...recent.map(r => r.adx));

    // ADX is declining if:
    // 1. Recent high was above 25 (there WAS a trend)
    // 2. Current ADX is lower than recent high by significant margin
    // 3. ADX has been consistently declining for 3+ bars
    let decliningBars = 0;
    for (let i = recent.length - 1; i > 0; i--) {
        if (recent[i].adx < recent[i - 1].adx) decliningBars++;
        else break;
    }

    const isDeclining = recentHigh > 25 && decliningBars >= 3 && (recentHigh - currentAdx) > 5;
    const fromAbove30 = recentHigh > 30;

    return {
        isDeclining,
        currentAdx: round(currentAdx),
        recentHigh: round(recentHigh),
        decliningBars,
        fromAbove30
    };
}

/**
 * 5. Detect momentum deceleration (ROC getting smaller while still in trend direction)
 */
function detectMomentumDeceleration(closes, isBullish) {
    if (closes.length < 15) {
        return { isDecelerating: false, consecutiveBars: 0 };
    }

    // Calculate 5-period ROC for last 8 bars
    const rocValues = [];
    for (let i = closes.length - 1; i >= closes.length - 8 && i >= 5; i--) {
        const roc = ((closes[i] - closes[i - 5]) / closes[i - 5]) * 100;
        rocValues.unshift(round(roc));
    }

    if (rocValues.length < 4) {
        return { isDecelerating: false, consecutiveBars: 0, rocValues };
    }

    // Check if ROC is consistently decreasing (in absolute terms, while still in trend direction)
    let consecutiveBars = 0;
    for (let i = rocValues.length - 1; i > 0; i--) {
        const curr = rocValues[i];
        const prev = rocValues[i - 1];

        if (isBullish) {
            // In uptrend: ROC should be positive but getting smaller
            if (curr > 0 && prev > 0 && curr < prev) consecutiveBars++;
            else break;
        } else {
            // In downtrend: ROC should be negative but getting less negative
            if (curr < 0 && prev < 0 && curr > prev) consecutiveBars++;
            else break;
        }
    }

    return {
        isDecelerating: consecutiveBars >= 3,
        consecutiveBars,
        currentRoc: rocValues[rocValues.length - 1],
        rocValues
    };
}

/**
 * 6. Detect Bollinger Band squeeze-back (price was outside BB, now coming back in)
 */
function detectBBSqueezeBack(closes, isBullish) {
    const bbResult = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
    if (bbResult.length < 5) {
        return { isSqueezing: false };
    }

    const recent = bbResult.slice(-5);
    const curr = recent[recent.length - 1];
    const currentPrice = closes[closes.length - 1];

    if (isBullish) {
        // Check if price was above upper BB recently, but now back inside
        const wasAboveBB = recent.slice(0, -1).some((bb, idx) => {
            const priceIdx = closes.length - 5 + idx;
            return closes[priceIdx] > bb.upper;
        });
        const nowInsideBB = currentPrice <= curr.upper && currentPrice > curr.middle;

        return {
            isSqueezing: wasAboveBB && nowInsideBB,
            currentPrice: round(currentPrice),
            upperBB: round(curr.upper),
            middleBB: round(curr.middle),
            wasOutside: wasAboveBB
        };
    } else {
        // Check if price was below lower BB recently, but now back inside
        const wasBelowBB = recent.slice(0, -1).some((bb, idx) => {
            const priceIdx = closes.length - 5 + idx;
            return closes[priceIdx] < bb.lower;
        });
        const nowInsideBB = currentPrice >= curr.lower && currentPrice < curr.middle;

        return {
            isSqueezing: wasBelowBB && nowInsideBB,
            currentPrice: round(currentPrice),
            lowerBB: round(curr.lower),
            middleBB: round(curr.middle),
            wasOutside: wasBelowBB
        };
    }
}

// ============================================================
// SWING DETECTION HELPERS
// ============================================================

/**
 * Find swing highs in price data (local maxima with at least 2 bars on each side)
 */
function findSwingHighs(highs, startIdx, lookback) {
    const swings = [];
    const endIdx = highs.length - 1;
    const searchStart = Math.max(startIdx + 2, endIdx - lookback);

    for (let i = searchStart; i <= endIdx - 2; i++) {
        if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] &&
            highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) {
            swings.push({ index: i, price: highs[i] });
        }
    }

    // Also check the most recent bar if it's higher than previous 2
    if (highs[endIdx] > highs[endIdx - 1] && highs[endIdx] > highs[endIdx - 2]) {
        swings.push({ index: endIdx, price: highs[endIdx] });
    }

    return swings;
}

/**
 * Find swing lows in price data (local minima with at least 2 bars on each side)
 */
function findSwingLows(lows, startIdx, lookback) {
    const swings = [];
    const endIdx = lows.length - 1;
    const searchStart = Math.max(startIdx + 2, endIdx - lookback);

    for (let i = searchStart; i <= endIdx - 2; i++) {
        if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] &&
            lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) {
            swings.push({ index: i, price: lows[i] });
        }
    }

    // Also check the most recent bar if it's lower than previous 2
    if (lows[endIdx] < lows[endIdx - 1] && lows[endIdx] < lows[endIdx - 2]) {
        swings.push({ index: endIdx, price: lows[endIdx] });
    }

    return swings;
}

// ============================================================
// UTILITY
// ============================================================

function round(val) {
    if (val === null || val === undefined) return null;
    return Math.round(val * 100) / 100;
}
