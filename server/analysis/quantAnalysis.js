import { EMA, RSI, SMA, ATR, BollingerBands, ROC as ROCIndicator } from 'technicalindicators';

/**
 * QuantumAI – Quantitative Forex Analysis Module
 * Provides advanced quant metrics for improved BUY/SELL decisions
 */

/**
 * Main entry point: Run full quant analysis across multiple timeframes
 * @param {Object} multiTfData - { M15: candles[], H1: candles[], H4: candles[], D1: candles[] }
 * @param {Object} intermarketData - DXY, SPX, TNX, CL data
 * @param {Object} technicalData - Technical analysis results per timeframe
 * @returns {Object} Complete quant analysis results
 */
export function runQuantAnalysis(multiTfData, intermarketData, technicalData) {
    try {
        const momentum = calcMultiTfMomentum(multiTfData);
        const volatility = detectVolatilityRegime(multiTfData);
        const zScore = calcMeanReversionZScore(multiTfData);
        const roc = calcRateOfChange(multiTfData);
        const volumeProfile = analyzeVolumeProfile(multiTfData);
        const correlation = calcCorrelationScore(multiTfData, intermarketData);
        const winProb = calcWinProbability(technicalData, momentum, volatility, zScore);
        const composite = calcCompositeScore(momentum, volatility, zScore, roc, correlation, winProb, technicalData);
        const positionSize = calcOptimalPositionSize(winProb, composite, volatility);

        return {
            compositeScore: composite,
            momentum,
            volatilityRegime: volatility,
            zScore,
            rateOfChange: roc,
            volumeProfile,
            correlation,
            winProbability: winProb,
            positionSize,
            signal: composite.signal,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error('Quant analysis error:', error.message);
        return {
            compositeScore: { score: 50, signal: 'NEUTRAL', label: 'Insufficient Data' },
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

// ============================================================
// 1. MULTI-TIMEFRAME MOMENTUM SCORE
// ============================================================

function calcMultiTfMomentum(multiTfData) {
    const timeframes = [
        { key: 'M15', data: multiTfData.pricesM15, weight: 0.1 },
        { key: 'H1', data: multiTfData.pricesH1, weight: 0.25 },
        { key: 'H4', data: multiTfData.pricesH4, weight: 0.35 },
        { key: 'D1', data: multiTfData.pricesD1, weight: 0.3 }
    ];

    const results = {};
    let weightedScore = 0;
    let totalWeight = 0;
    let aligned = 0;
    let totalTf = 0;

    for (const { key, data, weight } of timeframes) {
        if (!data || data.length < 20) {
            results[key] = { score: 0, direction: 'neutral', label: 'N/A' };
            continue;
        }

        const closes = data.map(c => c.close);
        const len = closes.length;

        // ROC-based momentum (5-period and 10-period)
        const roc5 = (closes[len - 1] - closes[Math.max(0, len - 6)]) / closes[Math.max(0, len - 6)] * 100;
        const roc10 = (closes[len - 1] - closes[Math.max(0, len - 11)]) / closes[Math.max(0, len - 11)] * 100;

        // EMA slope momentum
        const ema20 = EMA.calculate({ period: 20, values: closes });
        const emaSlope = ema20.length >= 3 ?
            (ema20[ema20.length - 1] - ema20[ema20.length - 3]) / ema20[ema20.length - 3] * 100 : 0;

        // RSI momentum
        const rsi = RSI.calculate({ period: 14, values: closes });
        const currentRsi = rsi.length > 0 ? rsi[rsi.length - 1] : 50;
        const rsiMomentum = (currentRsi - 50) / 50; // -1 to +1

        // Combined momentum score: -100 to +100
        const momentumRaw = (roc5 * 30 + roc10 * 25 + emaSlope * 25 + rsiMomentum * 20);
        const score = Math.max(-100, Math.min(100, momentumRaw * 10));

        const direction = score > 20 ? 'bullish' : score < -20 ? 'bearish' : 'neutral';

        results[key] = {
            score: round(score),
            direction,
            roc5: round(roc5),
            roc10: round(roc10),
            emaSlope: round(emaSlope),
            rsi: round(currentRsi),
            label: direction === 'bullish' ? '🟢 Tăng' : direction === 'bearish' ? '🔴 Giảm' : '🟡 Trung lập'
        };

        weightedScore += score * weight;
        totalWeight += weight;
        totalTf++;
        if (direction !== 'neutral') aligned += direction === 'bullish' ? 1 : -1;
    }

    const overallScore = totalWeight > 0 ? round(weightedScore / totalWeight) : 0;
    const alignment = totalTf > 0 ? round(Math.abs(aligned) / totalTf * 100) : 0;

    return {
        timeframes: results,
        overall: {
            score: overallScore,
            direction: overallScore > 15 ? 'bullish' : overallScore < -15 ? 'bearish' : 'neutral',
            alignment, // 0-100% how aligned timeframes are
            label: `${overallScore > 15 ? 'BULLISH' : overallScore < -15 ? 'BEARISH' : 'NEUTRAL'} (${alignment}% aligned)`
        }
    };
}

// ============================================================
// 2. VOLATILITY REGIME DETECTION
// ============================================================

function detectVolatilityRegime(multiTfData) {
    const h1 = multiTfData.pricesH1;
    if (!h1 || h1.length < 30) {
        return { regime: 'UNKNOWN', atr: 0, percentile: 50, label: 'N/A' };
    }

    const closes = h1.map(c => c.close);
    const highs = h1.map(c => c.high);
    const lows = h1.map(c => c.low);

    // ATR analysis
    const atrResult = ATR.calculate({ close: closes, high: highs, low: lows, period: 14 });
    const currentAtr = atrResult.length > 0 ? atrResult[atrResult.length - 1] : 0;

    // ATR percentile over history
    const atrValues = atrResult.slice(-50);
    const sortedAtr = [...atrValues].sort((a, b) => a - b);
    const percentile = round(sortedAtr.findIndex(v => v >= currentAtr) / sortedAtr.length * 100);

    // Bollinger Band Width
    const bbResult = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
    const currentBB = bbResult.length > 0 ? bbResult[bbResult.length - 1] : null;
    const bbWidth = currentBB ? round((currentBB.upper - currentBB.lower) / currentBB.middle * 100) : 0;

    // Historical BB Width percentile
    const bbWidths = bbResult.map(b => (b.upper - b.lower) / b.middle * 100);
    const sortedBBW = [...bbWidths].sort((a, b) => a - b);
    const bbPercentile = sortedBBW.length > 0 ?
        round(sortedBBW.findIndex(v => v >= bbWidth) / sortedBBW.length * 100) : 50;

    // True Range streak (consecutive expanding/contracting ranges)
    const ranges = h1.slice(-10).map(c => c.high - c.low);
    let expanding = 0;
    for (let i = ranges.length - 1; i > 0; i--) {
        if (ranges[i] > ranges[i - 1]) expanding++;
        else break;
    }

    // Determine regime
    const avgPercentile = (percentile + bbPercentile) / 2;
    let regime, riskMultiplier;
    if (avgPercentile >= 85) {
        regime = 'EXTREME';
        riskMultiplier = 0.5; // Reduce position size
    } else if (avgPercentile >= 65) {
        regime = 'HIGH';
        riskMultiplier = 0.75;
    } else if (avgPercentile >= 35) {
        regime = 'NORMAL';
        riskMultiplier = 1.0;
    } else {
        regime = 'LOW';
        riskMultiplier = 1.25; // Can increase size in low vol
    }

    return {
        regime,
        atr: round(currentAtr),
        atrPercentile: percentile,
        bbWidth: round(bbWidth),
        bbPercentile,
        avgPercentile: round(avgPercentile),
        expanding: expanding >= 3,
        riskMultiplier,
        label: `${regime} (ATR: ${round(currentAtr)}, P${round(avgPercentile)})`
    };
}

// ============================================================
// 3. MEAN REVERSION Z-SCORE
// ============================================================

function calcMeanReversionZScore(multiTfData) {
    const h1 = multiTfData.pricesH1;
    if (!h1 || h1.length < 30) {
        return { zScore20: 0, zScore50: 0, condition: 'neutral', label: 'N/A' };
    }

    const closes = h1.map(c => c.close);
    const currentPrice = closes[closes.length - 1];

    // Z-Score relative to EMA20
    const ema20 = EMA.calculate({ period: 20, values: closes });
    const mean20 = ema20.length > 0 ? ema20[ema20.length - 1] : currentPrice;
    const std20 = calcStdDev(closes.slice(-20));
    const zScore20 = std20 > 0 ? round((currentPrice - mean20) / std20) : 0;

    // Z-Score relative to EMA50
    const ema50 = EMA.calculate({ period: 50, values: closes });
    const mean50 = ema50.length > 0 ? ema50[ema50.length - 1] : currentPrice;
    const std50 = calcStdDev(closes.slice(-50));
    const zScore50 = std50 > 0 ? round((currentPrice - mean50) / std50) : 0;

    // Condition
    let condition;
    if (zScore20 > 2) condition = 'extreme_overbought';
    else if (zScore20 > 1) condition = 'overbought';
    else if (zScore20 < -2) condition = 'extreme_oversold';
    else if (zScore20 < -1) condition = 'oversold';
    else condition = 'neutral';

    // Mean reversion probability
    const reversionProb = Math.abs(zScore20) > 2 ? 75 :
        Math.abs(zScore20) > 1.5 ? 60 :
            Math.abs(zScore20) > 1 ? 45 : 20;

    return {
        zScore20: round(zScore20),
        zScore50: round(zScore50),
        condition,
        reversionProbability: reversionProb,
        priceVsEma20: round(((currentPrice - mean20) / mean20) * 100),
        priceVsEma50: round(((currentPrice - mean50) / mean50) * 100),
        label: `Z=${round(zScore20)} (${condition.replace(/_/g, ' ')})`
    };
}

// ============================================================
// 4. RATE OF CHANGE (MULTI-PERIOD)
// ============================================================

function calcRateOfChange(multiTfData) {
    const h1 = multiTfData.pricesH1;
    if (!h1 || h1.length < 30) {
        return { periods: {}, acceleration: 0, label: 'N/A' };
    }

    const closes = h1.map(c => c.close);
    const len = closes.length;
    const current = closes[len - 1];

    const periods = {
        roc5: round(((current - closes[Math.max(0, len - 6)]) / closes[Math.max(0, len - 6)]) * 100),
        roc10: round(((current - closes[Math.max(0, len - 11)]) / closes[Math.max(0, len - 11)]) * 100),
        roc20: round(((current - closes[Math.max(0, len - 21)]) / closes[Math.max(0, len - 21)]) * 100),
        roc50: len > 50 ? round(((current - closes[len - 51]) / closes[len - 51]) * 100) : null
    };

    // Acceleration: ROC of ROC (is momentum increasing or decreasing?)
    const roc5Prev = len > 10 ?
        ((closes[len - 6] - closes[Math.max(0, len - 11)]) / closes[Math.max(0, len - 11)]) * 100 : 0;
    const acceleration = round(periods.roc5 - roc5Prev);

    // Momentum direction
    const direction = periods.roc5 > 0.1 ? 'bullish' : periods.roc5 < -0.1 ? 'bearish' : 'flat';
    const accelerating = acceleration > 0 && periods.roc5 > 0 ? true :
        acceleration < 0 && periods.roc5 < 0 ? true : false;

    return {
        periods,
        acceleration,
        direction,
        accelerating,
        label: `ROC5: ${periods.roc5 > 0 ? '+' : ''}${periods.roc5}% ${accelerating ? '⚡ Tăng tốc' : '🔄 Giảm tốc'}`
    };
}

// ============================================================
// 5. VOLUME PROFILE ANALYSIS
// ============================================================

function analyzeVolumeProfile(multiTfData) {
    const h1 = multiTfData.pricesH1;
    if (!h1 || h1.length < 20) {
        return { poc: 0, vahigh: 0, valow: 0, position: 'neutral', label: 'N/A' };
    }

    const closes = h1.map(c => c.close);
    const volumes = h1.map(c => c.volume || 1);
    const highs = h1.map(c => c.high);
    const lows = h1.map(c => c.low);

    const highestPrice = Math.max(...highs);
    const lowestPrice = Math.min(...lows);
    const range = highestPrice - lowestPrice;

    if (range === 0) {
        return { poc: closes[closes.length - 1], vahigh: highestPrice, valow: lowestPrice, position: 'neutral', label: 'N/A' };
    }

    // Create price bins (20 levels)
    const numBins = 20;
    const binSize = range / numBins;
    const bins = new Array(numBins).fill(0);
    const binPrices = new Array(numBins).fill(0);

    for (let i = 0; i < h1.length; i++) {
        const avgPrice = (h1[i].high + h1[i].low + h1[i].close) / 3;
        const binIndex = Math.min(numBins - 1, Math.floor((avgPrice - lowestPrice) / binSize));
        bins[binIndex] += volumes[i];
        binPrices[binIndex] = lowestPrice + (binIndex + 0.5) * binSize;
    }

    // Point of Control (highest volume price)
    const maxBin = bins.indexOf(Math.max(...bins));
    const poc = round(binPrices[maxBin]);

    // Value Area (70% of total volume)
    const totalVolume = bins.reduce((a, b) => a + b, 0);
    const targetVolume = totalVolume * 0.7;
    let vaVolume = bins[maxBin];
    let vaHigh = maxBin;
    let vaLow = maxBin;

    while (vaVolume < targetVolume && (vaHigh < numBins - 1 || vaLow > 0)) {
        const highVol = vaHigh < numBins - 1 ? bins[vaHigh + 1] : 0;
        const lowVol = vaLow > 0 ? bins[vaLow - 1] : 0;
        if (highVol >= lowVol && vaHigh < numBins - 1) {
            vaHigh++;
            vaVolume += bins[vaHigh];
        } else if (vaLow > 0) {
            vaLow--;
            vaVolume += bins[vaLow];
        } else break;
    }

    const vahigh = round(lowestPrice + (vaHigh + 1) * binSize);
    const valow = round(lowestPrice + vaLow * binSize);
    const currentPrice = closes[closes.length - 1];

    // Position relative to value area
    let position;
    if (currentPrice > vahigh) position = 'above_va';
    else if (currentPrice < valow) position = 'below_va';
    else if (currentPrice > poc) position = 'upper_va';
    else position = 'lower_va';

    return {
        poc,
        vahigh,
        valow,
        position,
        priceVsPoc: round(((currentPrice - poc) / poc) * 100),
        label: `POC: ${poc} | VA: ${valow}-${vahigh} (${position.replace(/_/g, ' ')})`
    };
}

// ============================================================
// 6. CORRELATION SCORE
// ============================================================

function calcCorrelationScore(multiTfData, intermarketData) {
    const h1 = multiTfData.pricesH1;
    if (!h1 || h1.length < 20 || !intermarketData) {
        return { dxy: 0, overall: 'neutral', score: 0, label: 'N/A' };
    }

    let bullishFactors = 0;
    let bearishFactors = 0;
    let totalFactors = 0;
    const details = {};

    for (const [sym, data] of Object.entries(intermarketData)) {
        if (!data || data.error) continue;

        const impact = data.goldImpact?.direction;
        const strength = data.goldImpact?.strength;

        if (impact === 'bullish') {
            bullishFactors += strength === 'strong' ? 2 : 1;
        } else if (impact === 'bearish') {
            bearishFactors += strength === 'strong' ? 2 : 1;
        }
        totalFactors += 2; // max possible per factor

        details[sym] = {
            direction: impact || 'neutral',
            strength: strength || 'weak',
            changePct: data.changePct || 0,
            reason: data.goldImpact?.reason || ''
        };
    }

    const score = totalFactors > 0 ?
        round(((bullishFactors - bearishFactors) / totalFactors) * 100) : 0;

    const overall = score > 25 ? 'bullish' : score < -25 ? 'bearish' : 'neutral';

    return {
        score,
        overall,
        bullishFactors,
        bearishFactors,
        details,
        label: `${overall.toUpperCase()} (${score > 0 ? '+' : ''}${score})`
    };
}

// ============================================================
// 7. COMPOSITE QUANT SCORE (0-100)
// ============================================================

function calcCompositeScore(momentum, volatility, zScore, roc, correlation, winProb, technicalData) {
    // Weights for each factor
    const weights = {
        momentum: 0.25,
        technical: 0.25,
        correlation: 0.15,
        zScore: 0.10,
        roc: 0.10,
        volatility: 0.05,
        winProb: 0.10
    };

    // Normalize momentum to 0-100
    const momentumNorm = (momentum.overall?.score || 0 + 100) / 2;

    // Technical bias from technicalData
    let techScore = 50;
    if (technicalData?.H1?.bias) {
        techScore = technicalData.H1.bias.bullishPct || 50;
    }

    // Correlation to 0-100
    const corrNorm = ((correlation.score || 0) + 100) / 2;

    // Z-Score contribution (extreme = contrarian signal)
    let zScoreNorm = 50;
    const z = zScore.zScore20 || 0;
    if (z > 2) zScoreNorm = 20; // Overbought = bearish for mean reversion
    else if (z > 1) zScoreNorm = 35;
    else if (z < -2) zScoreNorm = 80; // Oversold = bullish for mean reversion
    else if (z < -1) zScoreNorm = 65;
    else zScoreNorm = 50;

    // For trend-following, flip z-score if strong trend
    const trendStrong = momentum.overall?.score ? Math.abs(momentum.overall.score) > 40 : false;
    if (trendStrong) {
        // In strong trends, follow the trend not the z-score
        zScoreNorm = momentumNorm;
    }

    // ROC to 0-100
    const rocScore = roc.periods?.roc5 || 0;
    const rocNorm = Math.max(0, Math.min(100, (rocScore + 2) / 4 * 100));

    // Volatility (favors normal volatility)
    let volNorm = 60;
    if (volatility.regime === 'EXTREME') volNorm = 30;
    else if (volatility.regime === 'HIGH') volNorm = 45;
    else if (volatility.regime === 'NORMAL') volNorm = 65;
    else if (volatility.regime === 'LOW') volNorm = 50;

    // Win probability
    const wpNorm = winProb.probability || 50;

    // Compute weighted composite
    const composite = round(
        momentumNorm * weights.momentum +
        techScore * weights.technical +
        corrNorm * weights.correlation +
        zScoreNorm * weights.zScore +
        rocNorm * weights.roc +
        volNorm * weights.volatility +
        wpNorm * weights.winProb
    );

    // Determine signal
    let signal, label;
    if (composite >= 70) { signal = 'STRONG_BUY'; label = '🟢 Mua Mạnh'; }
    else if (composite >= 60) { signal = 'BUY'; label = '🟢 Mua'; }
    else if (composite >= 55) { signal = 'LEAN_BUY'; label = '🟡 Nghiêng Mua'; }
    else if (composite >= 45) { signal = 'NEUTRAL'; label = '⚪ Trung Lập'; }
    else if (composite >= 40) { signal = 'LEAN_SELL'; label = '🟡 Nghiêng Bán'; }
    else if (composite >= 30) { signal = 'SELL'; label = '🔴 Bán'; }
    else { signal = 'STRONG_SELL'; label = '🔴 Bán Mạnh'; }

    return {
        score: composite,
        signal,
        label,
        breakdown: {
            momentum: round(momentumNorm),
            technical: round(techScore),
            correlation: round(corrNorm),
            zScore: round(zScoreNorm),
            roc: round(rocNorm),
            volatility: round(volNorm),
            winProbability: round(wpNorm)
        },
        weights
    };
}

// ============================================================
// 8. WIN PROBABILITY
// ============================================================

function calcWinProbability(technicalData, momentum, volatility, zScore) {
    let probability = 50;
    const factors = [];

    // Technical alignment
    if (technicalData?.H1?.bias) {
        const bias = technicalData.H1.bias;
        const alignment = Math.abs(bias.bullishPct - 50) * 2; // 0-100
        probability += alignment * 0.15;
        factors.push(`Technical alignment: ${round(alignment)}%`);
    }

    // Momentum strength
    if (momentum.overall) {
        const momStrength = Math.abs(momentum.overall.score) / 100;
        probability += momStrength * 10;
        factors.push(`Momentum strength: ${round(momStrength * 100)}%`);
    }

    // Multi-TF alignment bonus
    if (momentum.overall?.alignment > 60) {
        probability += 8;
        factors.push('Multi-TF alignment bonus: +8%');
    }

    // Volatility penalty for extreme
    if (volatility.regime === 'EXTREME') {
        probability -= 10;
        factors.push('Extreme volatility penalty: -10%');
    }

    // Z-Score mean reversion edge
    if (Math.abs(zScore.zScore20 || 0) > 2) {
        probability += 5; // Extreme z-score = likely reversion
        factors.push('Z-Score extreme: +5%');
    }

    // Clamp to 20-85% (never 0% or 100%)
    probability = Math.max(20, Math.min(85, round(probability)));

    return {
        probability,
        factors,
        confidence: probability >= 65 ? 'high' :
            probability >= 50 ? 'moderate' : 'low',
        label: `${probability}% (${probability >= 65 ? 'Cao' : probability >= 50 ? 'Trung bình' : 'Thấp'})`
    };
}

// ============================================================
// 9. OPTIMAL POSITION SIZE (Kelly Criterion)
// ============================================================

function calcOptimalPositionSize(winProb, composite, volatility) {
    const W = (winProb.probability || 50) / 100; // Win rate
    const R = 2; // Assumed R:R = 1:2
    const accountRisk = 2; // Default 2% account risk

    // Kelly Criterion: f* = W - (1-W)/R
    const kellyCriterion = W - (1 - W) / R;
    const kellyPct = Math.max(0, round(kellyCriterion * 100));

    // Half-Kelly (conservative)
    const halfKelly = round(kellyPct / 2);

    // Adjust by volatility regime
    const adjustedRisk = round(Math.min(accountRisk, halfKelly) * (volatility.riskMultiplier || 1));

    // Lot size suggestion (assuming $10,000 account, Gold $100/pip for 1 lot)
    const accountBalance = 10000; // Default
    const riskAmount = round(accountBalance * adjustedRisk / 100);
    const atr = volatility.atr || 10;
    const slPips = round(atr * 1.5 * 10); // ATR * 1.5 in pips
    const lotSize = slPips > 0 ? round(riskAmount / (slPips * 1)) : 0.01; // $1/pip for 0.01 lot

    return {
        kellyCriterion: round(kellyCriterion),
        kellyPct,
        halfKelly,
        riskPerTrade: adjustedRisk,
        suggestedLots: Math.max(0.01, Math.min(1, round(lotSize / 100))),
        riskAmount,
        stopPips: slPips,
        label: `${adjustedRisk}% risk | Kelly: ${kellyPct}%`
    };
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function calcStdDev(values) {
    if (!values || values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sqDiffs = values.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function round(val) {
    if (val === null || val === undefined) return null;
    return Math.round(val * 100) / 100;
}
