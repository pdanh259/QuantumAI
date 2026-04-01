/**
 * QuantumAI Backtesting Engine
 * Tests the MTF + Quant signal strategy on historical data
 * 
 * Usage: node server/backtest/backtester.js [symbol] [days]
 * Example: node server/backtest/backtester.js XAU/USD 30
 */
import dotenv from 'dotenv';
import { fetchPriceData } from '../services/priceService.js';
import { runTechnicalAnalysis } from '../analysis/technicalAnalysis.js';
import { runQuantAnalysis } from '../analysis/quantAnalysis.js';

dotenv.config();

// ==================== CONFIG ====================
const SYMBOL = process.argv[2] || 'XAU/USD';
const DAYS = parseInt(process.argv[3]) || 30;

function getSymbolConfig(symbol) {
    const sym = symbol.toUpperCase();
    if (sym.includes('XAU')) return { pipSize: 0.1, decimals: 2 };
    if (sym.includes('JPY')) return { pipSize: 0.01, decimals: 3 };
    // GBP/USD uses standard forex pip size — falls through to default
    if (sym.includes('ETH')) return { pipSize: 0.1, decimals: 2 };
    return { pipSize: 0.0001, decimals: 5 };
}

function roundTo(val, d = 2) {
    const f = Math.pow(10, d);
    return Math.round(val * f) / f;
}

// ==================== BACKTEST CORE ====================
async function runBacktest() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🧪 QuantumAI Backtesting Engine`);
    console.log(`  📊 Symbol: ${SYMBOL}`);
    console.log(`  📅 Period: Last ${DAYS} days`);
    console.log(`${'═'.repeat(60)}\n`);

    const config = getSymbolConfig(SYMBOL);

    // Fetch historical data (all timeframes)
    console.log('📡 Fetching historical data...');
    const barsNeeded = Math.min(DAYS * 24, 500); // H1 bars
    const barsH4 = Math.min(DAYS * 6, 300);
    const barsD1 = Math.min(DAYS, 200);

    let pricesH1, pricesH4, pricesD1;
    try {
        pricesH1 = await fetchPriceData(SYMBOL, '1h', barsNeeded);
        await sleep(2000); // Rate limit
        pricesH4 = await fetchPriceData(SYMBOL, '4h', barsH4);
        await sleep(2000);
        pricesD1 = await fetchPriceData(SYMBOL, '1day', barsD1);
    } catch (err) {
        console.error('❌ Failed to fetch data:', err.message);
        return;
    }

    if (!pricesH1 || pricesH1.length < 100) {
        console.error('❌ Not enough H1 data. Got:', pricesH1?.length || 0);
        return;
    }

    console.log(`✅ Data loaded: H1=${pricesH1.length}, H4=${pricesH4?.length || 0}, D1=${pricesD1?.length || 0} bars\n`);

    // Sliding window backtest
    const lookback = 100; // Minimum bars needed for indicators
    const trades = [];
    let scanCount = 0;

    // Simulate scanning every 4 H1 bars (every 4 hours)
    const step = 4;

    for (let i = lookback; i < pricesH1.length - 20; i += step) {
        scanCount++;

        // Slice data up to current point (no look-ahead)
        const h1Slice = pricesH1.slice(0, i + 1);
        const currentTime = h1Slice[h1Slice.length - 1].time;
        const currentPrice = h1Slice[h1Slice.length - 1].close;

        // Find matching H4 and D1 data up to this point
        const h4Slice = pricesH4 ? pricesH4.filter(c => new Date(c.time) <= new Date(currentTime)) : [];
        const d1Slice = pricesD1 ? pricesD1.filter(c => new Date(c.time) <= new Date(currentTime)) : [];

        // Run technical analysis on each timeframe
        const technicalData = {};
        technicalData.H1 = runTechnicalAnalysis(h1Slice.slice(-200), 'H1');

        if (h4Slice.length >= 30) {
            technicalData.H4 = runTechnicalAnalysis(h4Slice.slice(-200), 'H4');
        }
        if (d1Slice.length >= 30) {
            technicalData.D1 = runTechnicalAnalysis(d1Slice.slice(-200), 'D1');
        }

        // Run quant analysis
        const marketData = {
            pricesH1: h1Slice.slice(-200),
            pricesH4: h4Slice.slice(-200),
            pricesD1: d1Slice.slice(-200),
        };
        const quantData = runQuantAnalysis(marketData, {}, technicalData);

        // Generate signal using MTF logic
        const signal = generateBacktestSignal(SYMBOL, technicalData, quantData, config);

        if (signal && signal.action !== 'NO_TRADE') {
            // Simulate trade outcome using future candles
            const futureCandles = pricesH1.slice(i + 1, i + 1 + 48); // Next 48 H1 candles (48h)
            const outcome = simulateTrade(signal, futureCandles, config);

            trades.push({
                time: currentTime,
                action: signal.action,
                entry: signal.entry,
                stopLoss: signal.stopLoss,
                tp1: signal.tp1,
                tp2: signal.tp2,
                confidence: signal.confidence,
                mtfAgreement: signal.mtfAgreement,
                ...outcome,
            });
        }
    }

    // ==================== RESULTS ====================
    printResults(trades, scanCount, config);
}

/**
 * Generate signal using MTF + Quant logic (same as live engine)
 */
function generateBacktestSignal(symbol, technicalData, quantData, config) {
    const h1 = technicalData?.H1;
    if (!h1 || h1.error) return { action: 'NO_TRADE' };

    const currentPrice = h1.currentPrice;
    if (!currentPrice || currentPrice <= 0) return { action: 'NO_TRADE' };

    let atr = h1.volatility?.atr;
    if (!atr || atr <= 0) atr = currentPrice * 0.002;

    // MTF Analysis
    const mtf = analyzeMultiTimeframeBT(technicalData);
    if (!mtf.hasConsensus) return { action: 'NO_TRADE', reason: 'MTF no consensus' };

    const techBullish = mtf.direction === 'BULLISH';

    // Quant validation
    const quantScore = quantData?.compositeScore?.score || null;
    let finalAction;
    let confidence;

    if (quantScore !== null) {
        const quantBullish = quantScore >= 55;
        const quantBearish = quantScore <= 45;
        const quantNeutral = quantScore > 45 && quantScore < 55;
        const quantStrongBuy = quantScore >= 65;
        const quantStrongSell = quantScore <= 35;

        if (techBullish && quantBullish) {
            finalAction = 'BUY';
            confidence = mtf.confidence + (quantStrongBuy ? 10 : 5);
        } else if (!techBullish && quantBearish) {
            finalAction = 'SELL';
            confidence = mtf.confidence + (quantStrongSell ? 10 : 5);
        } else if (quantNeutral) {
            return { action: 'NO_TRADE', reason: 'Quant neutral' };
        } else if ((techBullish && quantStrongSell) || (!techBullish && quantStrongBuy)) {
            return { action: 'NO_TRADE', reason: 'MTF vs Quant conflict' };
        } else {
            finalAction = techBullish ? 'BUY' : 'SELL';
            confidence = mtf.confidence - 10;
        }
    } else {
        finalAction = techBullish ? 'BUY' : 'SELL';
        confidence = mtf.confidence - 5;
    }

    confidence = Math.min(90, Math.max(35, confidence));
    if (confidence < 50) return { action: 'NO_TRADE', reason: 'Low confidence' };

    const isBuy = finalAction === 'BUY';
    const entry = currentPrice;

    return {
        action: finalAction,
        entry: roundTo(entry, config.decimals),
        stopLoss: roundTo(isBuy ? entry - atr * 1.5 : entry + atr * 1.5, config.decimals),
        tp1: roundTo(isBuy ? entry + atr * 1.5 : entry - atr * 1.5, config.decimals),
        tp2: roundTo(isBuy ? entry + atr * 3 : entry - atr * 3, config.decimals),
        confidence,
        mtfAgreement: mtf.agreement,
    };
}

/**
 * MTF analysis (same logic as live)
 */
function analyzeMultiTimeframeBT(technicalData) {
    function getDir(tf) {
        if (!tf || tf.error || !tf.bias) return 'NONE';
        if (tf.bias.direction.includes('BULLISH')) return 'BULL';
        if (tf.bias.direction.includes('BEARISH')) return 'BEAR';
        return 'SIDE';
    }

    const dirs = [getDir(technicalData?.H1), getDir(technicalData?.H4), getDir(technicalData?.D1)];
    let bull = 0, bear = 0, avail = 0;

    for (const d of dirs) {
        if (d === 'NONE') continue;
        avail++;
        if (d === 'BULL') bull++;
        if (d === 'BEAR') bear++;
    }

    if (avail < 2) {
        if (dirs[0] === 'BULL' || dirs[0] === 'BEAR') {
            return { direction: dirs[0] === 'BULL' ? 'BULLISH' : 'BEARISH', hasConsensus: true, agreement: 1, confidence: 45 };
        }
        return { hasConsensus: false, agreement: 0, confidence: 0 };
    }

    const agreement = Math.max(bull, bear);
    const hasConsensus = agreement >= 2;
    const direction = bull >= 2 ? 'BULLISH' : bear >= 2 ? 'BEARISH' : 'MIXED';

    let confidence;
    if (agreement === 3) confidence = 75;
    else if (agreement === 2 && avail === 3) confidence = 60;
    else if (agreement === 2 && avail === 2) confidence = 55;
    else confidence = 40;

    const h1 = technicalData?.H1;
    if (h1?.trend?.adx?.trendStrength === 'strong') confidence += 5;

    const rsi = h1?.momentum?.rsi?.value;
    if (rsi) {
        if (direction === 'BULLISH' && rsi > 75) confidence -= 10;
        if (direction === 'BEARISH' && rsi < 25) confidence -= 10;
    }

    return { direction, hasConsensus, agreement, confidence };
}

/**
 * Simulate a trade outcome using future price data
 */
function simulateTrade(signal, futureCandles, config) {
    if (!futureCandles || futureCandles.length === 0) {
        return { outcome: 'NO_DATA', status: 'UNKNOWN', pnlPips: 0, duration: 0 };
    }

    const isBuy = signal.action === 'BUY';

    for (let i = 0; i < futureCandles.length; i++) {
        const candle = futureCandles[i];

        // Check SL hit
        if (isBuy && candle.low <= signal.stopLoss) {
            return {
                outcome: 'LOSS',
                status: 'SL_HIT',
                pnlPips: roundTo(-Math.abs(signal.entry - signal.stopLoss) / config.pipSize, 1),
                closePrice: signal.stopLoss,
                duration: i + 1,
            };
        }
        if (!isBuy && candle.high >= signal.stopLoss) {
            return {
                outcome: 'LOSS',
                status: 'SL_HIT',
                pnlPips: roundTo(-Math.abs(signal.stopLoss - signal.entry) / config.pipSize, 1),
                closePrice: signal.stopLoss,
                duration: i + 1,
            };
        }

        // Check TP2 hit first (better outcome)
        if (isBuy && candle.high >= signal.tp2) {
            return {
                outcome: 'WIN',
                status: 'TP2_HIT',
                pnlPips: roundTo(Math.abs(signal.tp2 - signal.entry) / config.pipSize, 1),
                closePrice: signal.tp2,
                duration: i + 1,
            };
        }
        if (!isBuy && candle.low <= signal.tp2) {
            return {
                outcome: 'WIN',
                status: 'TP2_HIT',
                pnlPips: roundTo(Math.abs(signal.entry - signal.tp2) / config.pipSize, 1),
                closePrice: signal.tp2,
                duration: i + 1,
            };
        }

        // Check TP1 hit
        if (isBuy && candle.high >= signal.tp1) {
            return {
                outcome: 'WIN',
                status: 'TP1_HIT',
                pnlPips: roundTo(Math.abs(signal.tp1 - signal.entry) / config.pipSize, 1),
                closePrice: signal.tp1,
                duration: i + 1,
            };
        }
        if (!isBuy && candle.low <= signal.tp1) {
            return {
                outcome: 'WIN',
                status: 'TP1_HIT',
                pnlPips: roundTo(Math.abs(signal.entry - signal.tp1) / config.pipSize, 1),
                closePrice: signal.tp1,
                duration: i + 1,
            };
        }
    }

    // Expired - calculate P&L at last candle
    const lastPrice = futureCandles[futureCandles.length - 1].close;
    const rawPnl = isBuy
        ? (lastPrice - signal.entry) / config.pipSize
        : (signal.entry - lastPrice) / config.pipSize;

    return {
        outcome: rawPnl > 0 ? 'WIN' : 'LOSS',
        status: 'EXPIRED',
        pnlPips: roundTo(rawPnl, 1),
        closePrice: lastPrice,
        duration: futureCandles.length,
    };
}

/**
 * Print backtest results
 */
function printResults(trades, scanCount, config) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  📊 BACKTEST RESULTS — ${SYMBOL}`);
    console.log(`${'═'.repeat(60)}\n`);

    console.log(`  Scans: ${scanCount}`);
    console.log(`  Signals generated: ${trades.length}`);
    console.log(`  Signal rate: ${((trades.length / scanCount) * 100).toFixed(1)}%\n`);

    if (trades.length === 0) {
        console.log('  ⚠️ No trades generated during backtest period.');
        console.log('  This means the strategy is very conservative (good!)');
        console.log('  Try increasing the backtest period.\n');
        return;
    }

    const wins = trades.filter(t => t.outcome === 'WIN');
    const losses = trades.filter(t => t.outcome === 'LOSS');
    const tp1Hits = trades.filter(t => t.status === 'TP1_HIT');
    const tp2Hits = trades.filter(t => t.status === 'TP2_HIT');
    const slHits = trades.filter(t => t.status === 'SL_HIT');
    const expired = trades.filter(t => t.status === 'EXPIRED');

    const totalPnl = trades.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
    const avgPnl = totalPnl / trades.length;
    const winRate = (wins.length / trades.length * 100).toFixed(1);

    const buys = trades.filter(t => t.action === 'BUY');
    const sells = trades.filter(t => t.action === 'SELL');
    const buyWins = buys.filter(t => t.outcome === 'WIN');
    const sellWins = sells.filter(t => t.outcome === 'WIN');

    // Max drawdown
    let maxDD = 0, runningPnl = 0, peak = 0;
    for (const t of trades) {
        runningPnl += t.pnlPips || 0;
        if (runningPnl > peak) peak = runningPnl;
        const dd = peak - runningPnl;
        if (dd > maxDD) maxDD = dd;
    }

    // Consecutive stats
    let maxConsWins = 0, maxConsLoss = 0, cw = 0, cl = 0;
    for (const t of trades) {
        if (t.outcome === 'WIN') { cw++; cl = 0; maxConsWins = Math.max(maxConsWins, cw); }
        else { cl++; cw = 0; maxConsLoss = Math.max(maxConsLoss, cl); }
    }

    const avgDuration = (trades.reduce((s, t) => s + (t.duration || 0), 0) / trades.length).toFixed(1);

    console.log(`  ┌──────────────────────────────────────────┐`);
    console.log(`  │  OVERALL PERFORMANCE                     │`);
    console.log(`  ├──────────────────────────────────────────┤`);
    console.log(`  │  Win Rate:        ${winRate.padStart(6)}%               │`);
    console.log(`  │  Total PnL:       ${roundTo(totalPnl, 1).toString().padStart(6)} pips            │`);
    console.log(`  │  Avg PnL/trade:   ${roundTo(avgPnl, 1).toString().padStart(6)} pips            │`);
    console.log(`  │  Max Drawdown:    ${roundTo(maxDD, 1).toString().padStart(6)} pips            │`);
    console.log(`  │  Avg Duration:    ${avgDuration.padStart(6)} bars (H1)       │`);
    console.log(`  │  Max Cons Wins:   ${String(maxConsWins).padStart(6)}                  │`);
    console.log(`  │  Max Cons Losses: ${String(maxConsLoss).padStart(6)}                  │`);
    console.log(`  └──────────────────────────────────────────┘`);

    console.log(`\n  📈 Trade Breakdown:`);
    console.log(`     TP1:     ${tp1Hits.length} (${(tp1Hits.length / trades.length * 100).toFixed(0)}%)`);
    console.log(`     TP2:     ${tp2Hits.length} (${(tp2Hits.length / trades.length * 100).toFixed(0)}%)`);
    console.log(`     SL:      ${slHits.length} (${(slHits.length / trades.length * 100).toFixed(0)}%)`);
    console.log(`     Expired: ${expired.length} (${(expired.length / trades.length * 100).toFixed(0)}%)`);

    console.log(`\n  📊 Direction:`);
    console.log(`     BUY:  ${buys.length} trades, ${buys.length > 0 ? (buyWins.length / buys.length * 100).toFixed(0) : 0}% win`);
    console.log(`     SELL: ${sells.length} trades, ${sells.length > 0 ? (sellWins.length / sells.length * 100).toFixed(0) : 0}% win`);

    // Print individual trades
    console.log(`\n  📋 Trade Log:`);
    console.log(`  ${'─'.repeat(80)}`);
    console.log(`  ${'Time'.padEnd(22)} ${'Action'.padEnd(6)} ${'Entry'.padEnd(10)} ${'Exit'.padEnd(10)} ${'PnL'.padEnd(8)} ${'Status'.padEnd(10)} ${'Dur'.padEnd(5)} Conf`);
    console.log(`  ${'─'.repeat(80)}`);

    for (const t of trades) {
        const pnlStr = (t.pnlPips > 0 ? '+' : '') + roundTo(t.pnlPips, 1);
        const icon = t.outcome === 'WIN' ? '✅' : '❌';
        console.log(
            `  ${icon} ${String(t.time).substring(0, 19).padEnd(20)} ${t.action.padEnd(6)} ${String(t.entry).padEnd(10)} ${String(t.closePrice || '').padEnd(10)} ${pnlStr.padEnd(8)} ${t.status.padEnd(10)} ${String(t.duration || '').padEnd(5)} ${t.confidence}%`
        );
    }

    console.log(`\n${'═'.repeat(60)}`);

    // Rating
    let rating = '';
    const wr = parseFloat(winRate);
    if (wr >= 60 && totalPnl > 0) rating = '🟢 GOOD — Strategy có tiềm năng';
    else if (wr >= 50 && totalPnl > 0) rating = '🟡 OK — Cần thêm dữ liệu';
    else if (wr >= 40) rating = '🟠 WEAK — Cần cải thiện logic';
    else rating = '🔴 POOR — Xem lại strategy';

    console.log(`\n  📊 Rating: ${rating}`);
    console.log(`${'═'.repeat(60)}\n`);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ==================== RUN ====================
runBacktest().catch(err => {
    console.error('Backtest error:', err);
    process.exit(1);
});
