import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, '..', '..', 'data', 'signal_history.json');
const STATS_FILE = path.join(__dirname, '..', '..', 'data', 'performance_stats.json');

// Ensure data directory exists
function ensureDataDir() {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Load signal history from JSON file
 */
export function loadHistory() {
    ensureDataDir();
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Error loading signal history:', err.message);
    }
    return [];
}

/**
 * Save signal history to JSON file
 */
export function saveHistory(history) {
    ensureDataDir();
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
    } catch (err) {
        console.error('Error saving signal history:', err.message);
    }
}

/**
 * Add a new signal to history
 * @param {Object} signal - The signal object from AI/fallback engine
 * @returns {Object} The saved signal record with ID
 */
export function saveSignal(signal) {
    if (!signal || signal.action === 'NO_TRADE') return null;

    const history = loadHistory();

    const record = {
        id: `SIG_${Date.now()}`,
        symbol: signal.symbol,
        action: signal.action,
        entry: signal.entry,
        stopLoss: signal.stopLoss,
        tp1: signal.tp1,
        tp2: signal.tp2,
        confidence: signal.confidence,
        source: signal.source || 'unknown',
        reasons: signal.reasons || [],
        marketCondition: signal.marketCondition || null,

        // Outcome tracking
        status: 'OPEN',           // OPEN, TP1_HIT, TP2_HIT, SL_HIT, EXPIRED, MANUAL_CLOSE
        outcome: null,            // WIN, LOSS, BREAKEVEN, null
        highestPrice: signal.entry,
        lowestPrice: signal.entry,
        closePrice: null,
        closeReason: null,
        pnlPips: null,

        // Timestamps
        openTime: new Date().toISOString(),
        closeTime: null,
        lastChecked: new Date().toISOString(),

        // Quant data snapshot
        quantScore: signal.quantScore || null,

        // EA execution details
        ticket: signal.ticket || null,
    };

    history.push(record);

    // Keep last 500 signals max
    if (history.length > 500) {
        history.splice(0, history.length - 500);
    }

    saveHistory(history);
    console.log(`📝 Signal saved: ${record.id} | ${record.symbol} ${record.action} @ ${record.entry}`);
    return record;
}

/**
 * Update signal outcome based on current price
 * @param {string} signalId - Signal record ID
 * @param {number} currentPrice - Current market price
 * @param {Object} symbolConfig - {pipSize, decimals}
 */
export function updateSignalOutcome(signalId, currentPrice, symbolConfig) {
    const history = loadHistory();
    const idx = history.findIndex(s => s.id === signalId);
    if (idx === -1) return null;

    const record = history[idx];
    if (record.status !== 'OPEN') return record;

    const pipSize = symbolConfig?.pipSize || 0.0001;

    // Track high/low
    if (currentPrice > record.highestPrice) record.highestPrice = currentPrice;
    if (currentPrice < record.lowestPrice) record.lowestPrice = currentPrice;
    record.lastChecked = new Date().toISOString();

    const isBuy = record.action === 'BUY';

    // Check SL hit
    if (isBuy && currentPrice <= record.stopLoss) {
        record.status = 'SL_HIT';
        record.outcome = 'LOSS';
        record.closePrice = record.stopLoss;
        record.closeReason = 'Stop Loss hit';
        record.pnlPips = -Math.abs(record.entry - record.stopLoss) / pipSize;
        record.closeTime = new Date().toISOString();
    } else if (!isBuy && currentPrice >= record.stopLoss) {
        record.status = 'SL_HIT';
        record.outcome = 'LOSS';
        record.closePrice = record.stopLoss;
        record.closeReason = 'Stop Loss hit';
        record.pnlPips = -Math.abs(record.stopLoss - record.entry) / pipSize;
        record.closeTime = new Date().toISOString();
    }

    // Check TP2 hit first (better outcome)
    if (record.status === 'OPEN') {
        if (isBuy && currentPrice >= record.tp2) {
            record.status = 'TP2_HIT';
            record.outcome = 'WIN';
            record.closePrice = record.tp2;
            record.closeReason = 'Take Profit 2 hit';
            record.pnlPips = Math.abs(record.tp2 - record.entry) / pipSize;
            record.closeTime = new Date().toISOString();
        } else if (!isBuy && currentPrice <= record.tp2) {
            record.status = 'TP2_HIT';
            record.outcome = 'WIN';
            record.closePrice = record.tp2;
            record.closeReason = 'Take Profit 2 hit';
            record.pnlPips = Math.abs(record.entry - record.tp2) / pipSize;
            record.closeTime = new Date().toISOString();
        }
    }

    // Check TP1 hit
    if (record.status === 'OPEN') {
        if (isBuy && currentPrice >= record.tp1) {
            record.status = 'TP1_HIT';
            record.outcome = 'WIN';
            record.closePrice = record.tp1;
            record.closeReason = 'Take Profit 1 hit';
            record.pnlPips = Math.abs(record.tp1 - record.entry) / pipSize;
            record.closeTime = new Date().toISOString();
        } else if (!isBuy && currentPrice <= record.tp1) {
            record.status = 'TP1_HIT';
            record.outcome = 'WIN';
            record.closePrice = record.tp1;
            record.closeReason = 'Take Profit 1 hit';
            record.pnlPips = Math.abs(record.entry - record.tp1) / pipSize;
            record.closeTime = new Date().toISOString();
        }
    }

    // Expire signals older than 48 hours
    const ageHours = (Date.now() - new Date(record.openTime).getTime()) / (1000 * 60 * 60);
    if (record.status === 'OPEN' && ageHours > 48) {
        record.status = 'EXPIRED';
        record.closePrice = currentPrice;
        record.closeReason = 'Expired after 48 hours';
        record.closeTime = new Date().toISOString();

        const rawPnl = isBuy
            ? (currentPrice - record.entry) / pipSize
            : (record.entry - currentPrice) / pipSize;
        record.pnlPips = Math.round(rawPnl * 10) / 10;
        record.outcome = rawPnl > 0 ? 'WIN' : rawPnl < 0 ? 'LOSS' : 'BREAKEVEN';
    }

    history[idx] = record;
    saveHistory(history);
    return record;
}

/**
 * Close a signal by MT5 ticket number (called when EA reports trade closure)
 * @param {number|string} ticket - MT5 order ticket
 * @param {number} closePrice - Price at which the trade was closed
 * @param {number} profit - Actual profit in account currency
 * @param {string} closeReason - Reason: 'sl', 'tp', 'manual', 'trailing'
 * @returns {Object|null} Updated signal record
 */
export function closeSignalByTicket(ticket, closePrice, profit, closeReason) {
    const history = loadHistory();
    const ticketStr = String(ticket);
    const idx = history.findIndex(s => s.status === 'OPEN' && String(s.ticket) === ticketStr);

    if (idx === -1) {
        console.log(`⚠️ No open signal found for ticket ${ticket}`);
        return null;
    }

    const record = history[idx];
    const pipSize = getSymbolPipSize(record.symbol);
    const isBuy = record.action === 'BUY';

    // Calculate pnlPips from entry vs closePrice
    const rawPnl = isBuy
        ? (closePrice - record.entry) / pipSize
        : (record.entry - closePrice) / pipSize;
    record.pnlPips = Math.round(rawPnl * 10) / 10;

    // Determine status based on closeReason
    const reason = (closeReason || 'manual').toLowerCase();
    if (reason.includes('sl') || reason.includes('stop loss')) {
        record.status = 'SL_HIT';
    } else if (reason.includes('tp') || reason.includes('take profit')) {
        // Check if TP1 or TP2
        if (record.tp2 && Math.abs(closePrice - record.tp2) < pipSize * 5) {
            record.status = 'TP2_HIT';
        } else {
            record.status = 'TP1_HIT';
        }
    } else {
        record.status = 'MANUAL_CLOSE';
    }

    record.outcome = rawPnl > 0 ? 'WIN' : rawPnl < 0 ? 'LOSS' : 'BREAKEVEN';
    record.closePrice = closePrice;
    record.closeReason = closeReason || 'EA reported close';
    record.closeTime = new Date().toISOString();

    history[idx] = record;
    saveHistory(history);

    console.log(`📌 Signal closed by ticket ${ticket}: ${record.symbol} ${record.action} → ${record.status} | ${record.pnlPips > 0 ? '+' : ''}${record.pnlPips} pips`);
    return record;
}

/**
 * Helper: get pip size for a symbol
 */
function getSymbolPipSize(symbol) {
    const sym = (symbol || '').toUpperCase();
    if (sym.includes('XAU')) return 0.1;
    if (sym.includes('JPY')) return 0.01;
    if (sym.includes('BTC')) return 1;
    if (sym.includes('ETH')) return 0.1;
    return 0.0001;
}

/**
 * Get open signals for a given symbol
 */
export function getOpenSignals(symbol = null) {
    const history = loadHistory();
    return history.filter(s =>
        s.status === 'OPEN' && (symbol === null || s.symbol === symbol)
    );
}

/**
 * Calculate performance statistics
 */
export function calculatePerformanceStats(symbol = null) {
    const history = loadHistory();
    const closed = history.filter(s =>
        s.status !== 'OPEN' && (symbol === null || s.symbol === symbol)
    );

    if (closed.length === 0) {
        return {
            totalSignals: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            avgPnlPips: 0,
            totalPnlPips: 0,
            bestTrade: null,
            worstTrade: null,
            bySymbol: {},
            recentPerformance: [],
        };
    }

    const wins = closed.filter(s => s.outcome === 'WIN');
    const losses = closed.filter(s => s.outcome === 'LOSS');
    const totalPnl = closed.reduce((sum, s) => sum + (s.pnlPips || 0), 0);

    // Per symbol stats
    const symbols = [...new Set(closed.map(s => s.symbol))];
    const bySymbol = {};
    for (const sym of symbols) {
        const symTrades = closed.filter(s => s.symbol === sym);
        const symWins = symTrades.filter(s => s.outcome === 'WIN');
        bySymbol[sym] = {
            total: symTrades.length,
            wins: symWins.length,
            losses: symTrades.length - symWins.length,
            winRate: Math.round((symWins.length / symTrades.length) * 100),
            totalPnl: Math.round(symTrades.reduce((sum, s) => sum + (s.pnlPips || 0), 0) * 10) / 10,
        };
    }

    // Last 10 trades performance
    const recent = closed.slice(-10).map(s => ({
        symbol: s.symbol,
        action: s.action,
        outcome: s.outcome,
        pnlPips: s.pnlPips,
        date: s.openTime,
    }));

    const sorted = [...closed].sort((a, b) => (b.pnlPips || 0) - (a.pnlPips || 0));

    return {
        totalSignals: closed.length,
        openSignals: history.filter(s => s.status === 'OPEN').length,
        wins: wins.length,
        losses: losses.length,
        winRate: Math.round((wins.length / closed.length) * 100),
        avgPnlPips: Math.round((totalPnl / closed.length) * 10) / 10,
        totalPnlPips: Math.round(totalPnl * 10) / 10,
        bestTrade: sorted[0] ? { symbol: sorted[0].symbol, pnl: sorted[0].pnlPips } : null,
        worstTrade: sorted[sorted.length - 1] ? { symbol: sorted[sorted.length - 1].symbol, pnl: sorted[sorted.length - 1].pnlPips } : null,
        bySymbol,
        recentPerformance: recent,
    };
}

/**
 * Generate a learning summary for the AI prompt
 * This is the key function that feeds past performance back into the AI
 */
export function generateLearningContext() {
    const stats = calculatePerformanceStats();

    if (stats.totalSignals < 3) {
        return null; // Not enough data to learn from
    }

    let context = `\n=== HISTORICAL PERFORMANCE (Self-Learning Data) ===\n`;
    context += `Total signals: ${stats.totalSignals} | Win rate: ${stats.winRate}% | Avg PnL: ${stats.avgPnlPips} pips\n`;

    // Per symbol insights
    context += `\nPerformance by symbol:\n`;
    for (const [sym, data] of Object.entries(stats.bySymbol)) {
        context += `  ${sym}: ${data.total} trades, ${data.winRate}% win rate, ${data.totalPnl} pips total\n`;
    }

    // Recent trade outcomes for context
    if (stats.recentPerformance.length > 0) {
        context += `\nLast ${stats.recentPerformance.length} trade outcomes:\n`;
        for (const trade of stats.recentPerformance) {
            context += `  ${trade.symbol} ${trade.action} → ${trade.outcome} (${trade.pnlPips > 0 ? '+' : ''}${trade.pnlPips} pips)\n`;
        }
    }

    // Learning instructions
    context += `\n⚠️ LEARNING INSTRUCTIONS:\n`;
    context += `- If win rate < 50%, be MORE conservative with signals\n`;
    context += `- If a symbol has poor performance, increase confidence threshold\n`;
    context += `- Pay attention to which market conditions produce wins vs losses\n`;
    context += `- Avoid repeating patterns that led to losses\n`;

    if (stats.winRate < 40) {
        context += `- CRITICAL: Win rate is very low (${stats.winRate}%). Be extremely selective!\n`;
    }

    // Identify weak symbols
    for (const [sym, data] of Object.entries(stats.bySymbol)) {
        if (data.total >= 3 && data.winRate < 40) {
            context += `- WARNING: ${sym} has poor results (${data.winRate}%). Consider NO_TRADE more often for this symbol.\n`;
        }
    }

    return context;
}

/**
 * Calculate period-based evaluation stats for AI performance
 * @param {string} period - 'day', 'week', or 'month'
 * @returns {Object} Evaluation stats for the period
 */
export function calculatePeriodStats(period = 'day') {
    const history = loadHistory();
    const now = new Date();

    // Calculate period boundaries
    function getPeriodStart(date, p) {
        const d = new Date(date);
        if (p === 'day') {
            d.setHours(0, 0, 0, 0);
        } else if (p === 'week') {
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
            d.setDate(diff);
            d.setHours(0, 0, 0, 0);
        } else if (p === 'month') {
            d.setDate(1);
            d.setHours(0, 0, 0, 0);
        }
        return d;
    }

    function getPreviousPeriodStart(periodStart, p) {
        const d = new Date(periodStart);
        if (p === 'day') {
            d.setDate(d.getDate() - 1);
        } else if (p === 'week') {
            d.setDate(d.getDate() - 7);
        } else if (p === 'month') {
            d.setMonth(d.getMonth() - 1);
        }
        return d;
    }

    const currentPeriodStart = getPeriodStart(now, period);
    const previousPeriodStart = getPreviousPeriodStart(currentPeriodStart, period);

    // Filter signals for current and previous periods
    const currentSignals = history.filter(s => {
        const t = new Date(s.openTime);
        return t >= currentPeriodStart && t <= now;
    });

    const previousSignals = history.filter(s => {
        const t = new Date(s.openTime);
        return t >= previousPeriodStart && t < currentPeriodStart;
    });

    // Calculate stats for a set of signals
    function calcStats(signals) {
        const closed = signals.filter(s => s.status !== 'OPEN');
        const open = signals.filter(s => s.status === 'OPEN');
        const wins = closed.filter(s => s.outcome === 'WIN');
        const losses = closed.filter(s => s.outcome === 'LOSS');
        const totalPnl = closed.reduce((sum, s) => sum + (s.pnlPips || 0), 0);
        const avgConfidence = signals.length > 0
            ? Math.round(signals.reduce((sum, s) => sum + (s.confidence || 0), 0) / signals.length)
            : 0;

        // Status breakdown
        const statusBreakdown = {
            OPEN: open.length,
            TP1_HIT: closed.filter(s => s.status === 'TP1_HIT').length,
            TP2_HIT: closed.filter(s => s.status === 'TP2_HIT').length,
            SL_HIT: closed.filter(s => s.status === 'SL_HIT').length,
            EXPIRED: closed.filter(s => s.status === 'EXPIRED').length,
        };

        // Per symbol stats
        const symbols = [...new Set(signals.map(s => s.symbol))];
        const bySymbol = {};
        for (const sym of symbols) {
            const symSignals = signals.filter(s => s.symbol === sym);
            const symClosed = symSignals.filter(s => s.status !== 'OPEN');
            const symWins = symClosed.filter(s => s.outcome === 'WIN');
            bySymbol[sym] = {
                total: symSignals.length,
                wins: symWins.length,
                losses: symClosed.length - symWins.length,
                winRate: symClosed.length > 0 ? Math.round((symWins.length / symClosed.length) * 100) : 0,
                pnl: Math.round(symClosed.reduce((sum, s) => sum + (s.pnlPips || 0), 0) * 10) / 10,
            };
        }

        // Action distribution
        const buyCount = signals.filter(s => s.action === 'BUY').length;
        const sellCount = signals.filter(s => s.action === 'SELL').length;

        const winRate = closed.length > 0 ? Math.round((wins.length / closed.length) * 100) : 0;

        return {
            totalSignals: signals.length,
            closedSignals: closed.length,
            openSignals: open.length,
            wins: wins.length,
            losses: losses.length,
            winRate,
            totalPnlPips: Math.round(totalPnl * 10) / 10,
            avgPnlPips: closed.length > 0 ? Math.round((totalPnl / closed.length) * 10) / 10 : 0,
            avgConfidence,
            statusBreakdown,
            bySymbol,
            buyCount,
            sellCount,
        };
    }

    const current = calcStats(currentSignals);
    const previous = calcStats(previousSignals);

    // Calculate AI Grade (A-F)
    function calculateGrade(stats) {
        if (stats.totalSignals === 0) return { grade: '-', score: 0, label: 'Chưa có dữ liệu' };

        let score = 0;

        // Win rate contribution (max 40 points)
        score += Math.min(40, stats.winRate * 0.4);

        // PnL contribution (max 25 points)
        if (stats.totalPnlPips > 0) {
            score += Math.min(25, stats.totalPnlPips * 0.5);
        } else {
            score += Math.max(0, 25 + stats.totalPnlPips * 0.3);
        }

        // Confidence accuracy (max 20 points) - higher confidence on wins
        if (stats.closedSignals > 0) {
            score += Math.min(20, stats.avgConfidence * 0.25);
        }

        // Signal volume bonus (max 15 points)
        score += Math.min(15, stats.totalSignals * 2);

        score = Math.round(Math.min(100, Math.max(0, score)));

        let grade, label;
        if (score >= 85) { grade = 'A'; label = 'Xuất sắc'; }
        else if (score >= 70) { grade = 'B'; label = 'Tốt'; }
        else if (score >= 55) { grade = 'C'; label = 'Trung bình'; }
        else if (score >= 40) { grade = 'D'; label = 'Yếu'; }
        else { grade = 'F'; label = 'Kém'; }

        return { grade, score, label };
    }

    const gradeInfo = calculateGrade(current);

    // Trend vs previous period
    const trend = {
        winRate: current.winRate - previous.winRate,
        totalSignals: current.totalSignals - previous.totalSignals,
        totalPnlPips: Math.round((current.totalPnlPips - previous.totalPnlPips) * 10) / 10,
    };

    // Generate AI commentary
    const commentary = [];
    if (current.totalSignals === 0) {
        commentary.push('📊 Chưa có signal nào trong khoảng thời gian này.');
    } else {
        if (current.winRate >= 60) commentary.push(`✅ Win rate ${current.winRate}% - Hiệu suất tốt!`);
        else if (current.winRate >= 45) commentary.push(`⚠️ Win rate ${current.winRate}% - Cần cải thiện.`);
        else if (current.closedSignals > 0) commentary.push(`❌ Win rate ${current.winRate}% - Hiệu suất kém.`);

        if (trend.winRate > 5) commentary.push(`📈 Win rate tăng ${trend.winRate}% so với kỳ trước.`);
        else if (trend.winRate < -5) commentary.push(`📉 Win rate giảm ${Math.abs(trend.winRate)}% so với kỳ trước.`);

        if (current.totalPnlPips > 0) commentary.push(`💰 Lãi ${current.totalPnlPips} pips.`);
        else if (current.totalPnlPips < 0) commentary.push(`💸 Lỗ ${Math.abs(current.totalPnlPips)} pips.`);

        if (current.statusBreakdown.TP2_HIT > 0) {
            commentary.push(`🎯 ${current.statusBreakdown.TP2_HIT} lệnh đạt TP2 - Phân tích chính xác!`);
        }

        if (current.openSignals > 0) {
            commentary.push(`⏳ ${current.openSignals} lệnh đang mở, chờ kết quả.`);
        }
    }

    // Recent signals in period (most recent first)
    const recentSignals = [...currentSignals]
        .sort((a, b) => new Date(b.openTime) - new Date(a.openTime))
        .slice(0, 10)
        .map(s => ({
            id: s.id,
            symbol: s.symbol,
            action: s.action,
            entry: s.entry,
            status: s.status,
            outcome: s.outcome,
            pnlPips: s.pnlPips,
            confidence: s.confidence,
            openTime: s.openTime,
            closeTime: s.closeTime,
        }));

    return {
        period,
        periodStart: currentPeriodStart.toISOString(),
        periodEnd: now.toISOString(),
        ...current,
        grade: gradeInfo,
        trend,
        commentary,
        recentSignals,
        previousPeriod: {
            winRate: previous.winRate,
            totalSignals: previous.totalSignals,
            totalPnlPips: previous.totalPnlPips,
        },
    };
}

/**
 * Get full history for API response
 */
export function getSignalHistory(limit = 50, symbol = null) {
    const history = loadHistory();
    let filtered = symbol ? history.filter(s => s.symbol === symbol) : history;
    return filtered.slice(-limit).reverse(); // Most recent first
}
