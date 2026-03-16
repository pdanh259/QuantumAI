import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { fetchPriceData, fetchMultiTimeframeData } from './services/priceService.js';
import { fetchNews } from './services/newsService.js';
import { fetchEconomicCalendar } from './services/calendarService.js';
import { fetchIntermarketData } from './services/intermarketService.js';
import { fetchSentiment } from './services/sentimentService.js';
import { runTechnicalAnalysis } from './analysis/technicalAnalysis.js';
import { generateSignal } from './analysis/aiEngine.js';
import { runQuantAnalysis } from './analysis/quantAnalysis.js';
import { sendTelegramSignal, sendTelegramMessage, initTelegramBot } from './services/telegramBot.js';
import { saveSignal, updateSignalOutcome, getOpenSignals, calculatePerformanceStats, calculatePeriodStats, getSignalHistory, generateLearningContext } from './services/signalHistory.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static frontend files in production
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// ==================== SUPPORTED SYMBOLS ====================
const SUPPORTED_SYMBOLS = [
    { symbol: 'XAU/USD', name: 'Gold', type: 'commodity', icon: '🥇' },
    { symbol: 'EUR/USD', name: 'Euro/USD', type: 'forex', icon: '💶' },
    { symbol: 'GBP/USD', name: 'Pound/USD', type: 'forex', icon: '💷' },
    { symbol: 'USD/JPY', name: 'USD/Yen', type: 'forex', icon: '💴' },
    { symbol: 'AUD/USD', name: 'AUD/USD', type: 'forex', icon: '🇦🇺' },
    { symbol: 'USD/CHF', name: 'USD/CHF', type: 'forex', icon: '🇨🇭' },
    { symbol: 'BTC/USD', name: 'Bitcoin', type: 'crypto', icon: '₿' },
    { symbol: 'ETH/USD', name: 'Ethereum', type: 'crypto', icon: 'Ξ' },
];

function getSymbol(req) {
    return req.query?.symbol || req.body?.symbol || process.env.SYMBOL || 'XAU/USD';
}

// Cache per symbol
const dataCache = {};

function getCache(symbol) {
    if (!dataCache[symbol]) {
        dataCache[symbol] = {
            prices: null, multiTf: null, news: null,
            calendar: null, intermarket: null, sentiment: null,
            technicalAnalysis: null, quantData: null,
            lastSignal: null, lastUpdate: null
        };
    }
    return dataCache[symbol];
}

// ==================== API ROUTES ====================

// Get supported symbols
app.get('/api/symbols', (req, res) => {
    res.json({ success: true, symbols: SUPPORTED_SYMBOLS });
});

// Get all market data
app.get('/api/market-data', async (req, res) => {
    try {
        const symbol = getSymbol(req);
        const cache = getCache(symbol);

        const [prices, news, calendar, intermarket, sentiment] = await Promise.allSettled([
            fetchPriceData(symbol, '1h', 100),
            fetchNews(),
            fetchEconomicCalendar(),
            fetchIntermarketData(),
            fetchSentiment()
        ]);

        cache.prices = prices.status === 'fulfilled' ? prices.value : cache.prices;
        cache.news = news.status === 'fulfilled' ? news.value : cache.news;
        cache.calendar = calendar.status === 'fulfilled' ? calendar.value : cache.calendar;
        cache.intermarket = intermarket.status === 'fulfilled' ? intermarket.value : cache.intermarket;
        cache.sentiment = sentiment.status === 'fulfilled' ? sentiment.value : cache.sentiment;
        cache.lastUpdate = new Date().toISOString();

        res.json({
            success: true,
            data: {
                prices: cache.prices,
                news: cache.news,
                calendar: cache.calendar,
                intermarket: cache.intermarket,
                sentiment: cache.sentiment,
                lastUpdate: cache.lastUpdate
            }
        });
    } catch (error) {
        console.error('Error fetching market data:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get price data for specific timeframe
app.get('/api/prices/:timeframe', async (req, res) => {
    try {
        const symbol = getSymbol(req);
        const { timeframe } = req.params;
        const data = await fetchPriceData(symbol, timeframe, 200);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== LIGHTWEIGHT INDICATORS (no AI) ====================
app.get('/api/indicators', async (req, res) => {
    try {
        const symbol = getSymbol(req);
        const cache = getCache(symbol);

        // Try to fetch fresh data
        const [pricesH1, pricesH4, pricesD1, intermarket, sentiment] =
            await Promise.allSettled([
                fetchPriceData(symbol, '1h', 100),
                fetchPriceData(symbol, '4h', 100),
                fetchPriceData(symbol, '1day', 100),
                fetchIntermarketData(),
                fetchSentiment()
            ]);

        const h1 = pricesH1.status === 'fulfilled' ? pricesH1.value : [];
        const h4 = pricesH4.status === 'fulfilled' ? pricesH4.value : [];
        const d1 = pricesD1.status === 'fulfilled' ? pricesD1.value : [];

        // Run technical analysis if we have price data
        let technicalData = {};
        if (h1.length > 0) technicalData.H1 = runTechnicalAnalysis(h1, 'H1');
        if (h4.length > 0) technicalData.H4 = runTechnicalAnalysis(h4, 'H4');
        if (d1.length > 0) technicalData.D1 = runTechnicalAnalysis(d1, 'D1');

        // Intermarket + sentiment (use fresh if available, else cache)
        const intermarketData = intermarket.status === 'fulfilled' && Object.keys(intermarket.value || {}).length > 0
            ? intermarket.value : (cache.intermarket || {});
        const sentimentData = sentiment.status === 'fulfilled' && sentiment.value?.fearGreedIndex
            ? sentiment.value : (cache.sentiment || {});

        // Fallback to cache if fresh technical data is empty
        if (Object.keys(technicalData).length === 0 && cache.technicalAnalysis) {
            technicalData = cache.technicalAnalysis;
        }

        // Run quant analysis (or use cache)
        let quantData;
        if (Object.keys(technicalData).length > 0) {
            const marketData = {
                pricesH1: h1, pricesH4: h4, pricesD1: d1, pricesM15: [],
                news: [], calendar: [],
                intermarket: intermarketData, sentiment: sentimentData
            };
            quantData = runQuantAnalysis(marketData, intermarketData, technicalData);
        } else {
            quantData = cache.quantData || null;
        }

        // Update cache only if we got fresh data
        if (Object.keys(technicalData).length > 0 && h1.length > 0) {
            cache.technicalAnalysis = technicalData;
            cache.quantData = quantData;
        }
        if (Object.keys(intermarketData).length > 0) cache.intermarket = intermarketData;
        if (sentimentData?.fearGreedIndex) cache.sentiment = sentimentData;

        res.json({
            success: true,
            technicalAnalysis: technicalData,
            quantData,
            marketData: {
                intermarket: intermarketData,
                sentiment: sentimentData
            },
            cached: h1.length === 0  // indicate if using cached data
        });
    } catch (error) {
        console.error('Error fetching indicators:', error.message);
        // Even on error, try to serve cached data
        const symbol = getSymbol(req);
        const cache = getCache(symbol);
        if (cache.technicalAnalysis) {
            return res.json({
                success: true,
                technicalAnalysis: cache.technicalAnalysis,
                quantData: cache.quantData,
                marketData: {
                    intermarket: cache.intermarket || {},
                    sentiment: cache.sentiment || {}
                },
                cached: true
            });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== CORE ANALYSIS FUNCTION ====================
async function runFullAnalysis(symbol) {
    console.log(`\n🔄 Starting AI analysis for ${symbol}...`);

    // Step 1: Fetch all data
    console.log('📡 Step 1: Fetching market data...');
    const [pricesH1, pricesH4, pricesD1, pricesM15, news, calendar, intermarket, sentiment] =
        await Promise.allSettled([
            fetchPriceData(symbol, '1h', 100),
            fetchPriceData(symbol, '4h', 100),
            fetchPriceData(symbol, '1day', 100),
            fetchPriceData(symbol, '15min', 100),
            fetchNews(),
            fetchEconomicCalendar(),
            fetchIntermarketData(),
            fetchSentiment()
        ]);

    const marketData = {
        pricesH1: pricesH1.status === 'fulfilled' ? pricesH1.value : [],
        pricesH4: pricesH4.status === 'fulfilled' ? pricesH4.value : [],
        pricesD1: pricesD1.status === 'fulfilled' ? pricesD1.value : [],
        pricesM15: pricesM15.status === 'fulfilled' ? pricesM15.value : [],
        news: news.status === 'fulfilled' ? news.value : [],
        calendar: calendar.status === 'fulfilled' ? calendar.value : [],
        intermarket: intermarket.status === 'fulfilled' ? intermarket.value : {},
        sentiment: sentiment.status === 'fulfilled' ? sentiment.value : {}
    };

    // Step 2: Technical Analysis
    console.log('📊 Step 2: Running technical analysis...');
    const technicalData = {};
    if (marketData.pricesH1.length > 0) {
        technicalData.H1 = runTechnicalAnalysis(marketData.pricesH1, 'H1');
    }
    if (marketData.pricesH4.length > 0) {
        technicalData.H4 = runTechnicalAnalysis(marketData.pricesH4, 'H4');
    }
    if (marketData.pricesD1.length > 0) {
        technicalData.D1 = runTechnicalAnalysis(marketData.pricesD1, 'D1');
    }

    // Step 3: Quant Analysis
    console.log('📐 Step 3: Running quant analysis...');
    const quantData = runQuantAnalysis(marketData, marketData.intermarket, technicalData);

    // Step 4: AI Signal Generation
    console.log('🤖 Step 4: AI analyzing and generating signal...');
    const signal = await generateSignal({
        symbol,
        marketData,
        technicalData,
        quantData,
        news: marketData.news,
        calendar: marketData.calendar,
        intermarket: marketData.intermarket,
        sentiment: marketData.sentiment
    });

    // Update cache
    const cache = getCache(symbol);
    cache.lastSignal = signal;
    cache.technicalAnalysis = technicalData;
    cache.quantData = quantData;
    cache.lastUpdate = new Date().toISOString();

    // Signal is NOT saved here anymore.
    // It will only be saved when the EA confirms execution via POST /api/ea/confirm

    console.log('✅ Analysis complete!');
    console.log(`📐 Quant Score: ${quantData.compositeScore?.score}/100 → ${quantData.compositeScore?.signal}`);

    return { signal, technicalData, quantData, marketData };
}

// ==================== API: ANALYZE ====================
app.post('/api/analyze', async (req, res) => {
    try {
        const symbol = getSymbol(req);
        const result = await runFullAnalysis(symbol);

        // Send to Telegram
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
            console.log('📱 Step 5: Sending signal to Telegram...');
            try {
                await sendTelegramSignal(result.signal);
                console.log('✅ Signal sent to Telegram!');
            } catch (tgError) {
                console.log('⚠️ Telegram send failed:', tgError.message);
            }
        }

        res.json({
            success: true,
            signal: result.signal,
            technicalAnalysis: result.technicalData,
            quantData: result.quantData,
            marketData: {
                currentPrice: result.marketData.pricesH1.length > 0 ?
                    result.marketData.pricesH1[result.marketData.pricesH1.length - 1] : null,
                news: result.marketData.news.slice(0, 5),
                calendar: result.marketData.calendar,
                intermarket: result.marketData.intermarket,
                sentiment: result.marketData.sentiment
            }
        });
    } catch (error) {
        console.error('❌ Analysis error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get last generated signal
app.get('/api/signal', (req, res) => {
    const symbol = getSymbol(req);
    const cache = getCache(symbol);
    res.json({
        success: true,
        signal: cache.lastSignal,
        technicalAnalysis: cache.technicalAnalysis,
        lastUpdate: cache.lastUpdate
    });
});

// ==================== EA AUTO-TRADE API ====================

// Get all active signals for EA consumption (multi-symbol)
app.get('/api/ea/signals', (req, res) => {
    const signals = [];
    for (const symInfo of SUPPORTED_SYMBOLS) {
        const cache = getCache(symInfo.symbol);
        if (cache.lastSignal && cache.lastSignal.action !== 'NO_TRADE') {
            const sig = cache.lastSignal;
            // Convert symbol format: "XAU/USD" → "XAUUSD" for MT5
            const mt5Symbol = symInfo.symbol.replace('/', '');
            signals.push({
                signalId: `${mt5Symbol}_${cache.lastUpdate}`,
                symbol: mt5Symbol,
                action: sig.action,             // "BUY" or "SELL"
                entry: sig.entry || 0,
                stopLoss: sig.stopLoss || 0,
                tp1: sig.tp1 || 0,
                tp2: sig.tp2 || 0,
                confidence: sig.confidence || 0,
                timestamp: cache.lastUpdate,
            });
        }
    }
    res.json({
        success: true,
        count: signals.length,
        serverTime: new Date().toISOString(),
        signals
    });
});

// EA confirms a trade was actually executed on MT5
app.post('/api/ea/confirm', express.json(), (req, res) => {
    try {
        const { signalId, symbol, action, entry, sl, tp, ticket, confidence } = req.body;

        if (!symbol || !action || !ticket) {
            return res.status(400).json({ success: false, error: 'Missing required fields: symbol, action, ticket' });
        }

        // Convert MT5 symbol back to API format: "XAUUSD" → "XAU/USD"
        let apiSymbol = symbol;
        const symMap = { XAUUSD: 'XAU/USD', BTCUSD: 'BTC/USD', EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY', AUDUSD: 'AUD/USD', USDCHF: 'USD/CHF', ETHUSD: 'ETH/USD' };
        if (symMap[symbol]) apiSymbol = symMap[symbol];

        // Find the matching cached signal to get full details
        const cache = getCache(apiSymbol);
        const cachedSignal = cache.lastSignal;

        const signalToSave = {
            symbol: apiSymbol,
            action,
            entry: entry || cachedSignal?.entry || 0,
            stopLoss: sl || cachedSignal?.stopLoss || 0,
            tp1: cachedSignal?.tp1 || tp || 0,
            tp2: cachedSignal?.tp2 || 0,
            confidence: confidence || cachedSignal?.confidence || 0,
            source: cachedSignal?.source || 'ea_confirmed',
            reasons: cachedSignal?.reasons || [],
            marketCondition: cachedSignal?.marketCondition || null,
            ticket: ticket,
        };

        const savedRecord = saveSignal(signalToSave);

        if (savedRecord) {
            console.log(`✅ [EA] Trade confirmed: ${symbol} ${action} Ticket:${ticket} → Saved as ${savedRecord.id}`);
            return res.json({ success: true, recordId: savedRecord.id });
        }

        res.json({ success: true, message: 'Signal not saved (NO_TRADE or error)' });
    } catch (error) {
        console.error('❌ [EA] Confirm error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== SIGNAL HISTORY & PERFORMANCE ====================

// Get signal history
app.get('/api/history', (req, res) => {
    const symbol = req.query.symbol || null;
    const limit = parseInt(req.query.limit) || 50;
    const history = getSignalHistory(limit, symbol);
    res.json({ success: true, history });
});

// Get performance stats
app.get('/api/performance', (req, res) => {
    const symbol = req.query.symbol || null;
    const stats = calculatePerformanceStats(symbol);
    res.json({ success: true, stats });
});

// Get AI evaluation stats by period (day/week/month)
app.get('/api/performance/evaluation', (req, res) => {
    const period = req.query.period || 'day';
    if (!['day', 'week', 'month'].includes(period)) {
        return res.status(400).json({ success: false, error: 'Period must be day, week, or month' });
    }
    const evaluation = calculatePeriodStats(period);
    res.json({ success: true, evaluation });
});

// Health check
app.get('/api/health', (req, res) => {
    const stats = calculatePerformanceStats();
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        performance: {
            totalSignals: stats.totalSignals,
            winRate: stats.winRate,
            openSignals: stats.openSignals
        }
    });
});

// Serve React app for all non-API routes (SPA fallback)
app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

// ==================== AUTO-ANALYSIS CRON ====================
const AUTO_SYMBOLS = ['XAU/USD', 'BTC/USD'];  // Reduced to save API credits
let autoAnalysisEnabled = true;
let isAnalysisRunning = false;

async function runAutoAnalysis() {
    if (!autoAnalysisEnabled || isAnalysisRunning) return;
    isAnalysisRunning = true;

    const hasTelegram = process.env.TELEGRAM_BOT_TOKEN &&
        process.env.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE' &&
        process.env.TELEGRAM_CHAT_ID &&
        process.env.TELEGRAM_CHAT_ID !== 'YOUR_CHAT_ID_HERE';

    const timeStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    console.log(`\n⏰ [AUTO] Starting scheduled analysis at ${timeStr}...`);

    // Step 0: Track outcomes of open signals
    console.log('📊 [AUTO] Checking open signal outcomes...');
    await trackOpenSignalOutcomes();

    let signalsSent = 0;

    for (const symbol of AUTO_SYMBOLS) {
        try {
            console.log(`\n🔄 [AUTO] Analyzing ${symbol}...`);
            const result = await runFullAnalysis(symbol);

            if (hasTelegram && result.signal && result.signal.action !== 'NO_TRADE') {
                await sendTelegramSignal(result.signal);
                signalsSent++;
                console.log(`📱 [AUTO] ${symbol} → ${result.signal.action} signal sent to Telegram!`);
            } else {
                console.log(`⏭️ [AUTO] ${symbol} → ${result.signal?.action || 'NO_TRADE'}, skipping Telegram`);
            }

            // Delay between symbols to avoid API rate limits (15s)
            await new Promise(r => setTimeout(r, 15000));
        } catch (err) {
            console.error(`❌ [AUTO] Error analyzing ${symbol}:`, err.message);
        }
    }

    // Log performance stats
    const stats = calculatePerformanceStats();
    console.log(`\n✅ [AUTO] Scan complete! ${signalsSent}/${AUTO_SYMBOLS.length} signals sent`);
    if (stats.totalSignals > 0) {
        console.log(`📈 [PERF] Total: ${stats.totalSignals} | Win: ${stats.winRate}% | PnL: ${stats.totalPnlPips} pips | Open: ${stats.openSignals}`);
    }

    isAnalysisRunning = false;
}

/**
 * Track outcomes of all open signals by checking current prices
 */
async function trackOpenSignalOutcomes() {
    const openSignals = getOpenSignals();
    if (openSignals.length === 0) {
        console.log('📊 No open signals to track');
        return;
    }

    console.log(`📊 Tracking ${openSignals.length} open signals...`);

    // Group by symbol to minimize API calls
    const symbolGroups = {};
    for (const sig of openSignals) {
        if (!symbolGroups[sig.symbol]) symbolGroups[sig.symbol] = [];
        symbolGroups[sig.symbol].push(sig);
    }

    for (const [symbol, signals] of Object.entries(symbolGroups)) {
        try {
            const priceData = await fetchPriceData(symbol, '1h', 1);
            if (priceData && priceData.length > 0) {
                const currentPrice = priceData[priceData.length - 1].close;
                const config = getSymbolPipConfig(symbol);

                for (const sig of signals) {
                    const updated = updateSignalOutcome(sig.id, currentPrice, config);
                    if (updated && updated.status !== 'OPEN') {
                        console.log(`  📌 ${symbol} ${sig.action} → ${updated.outcome} (${updated.pnlPips > 0 ? '+' : ''}${updated.pnlPips} pips) - ${updated.closeReason}`);
                    }
                }
            }
        } catch (err) {
            console.error(`Error tracking ${symbol}:`, err.message);
        }
    }
}

function getSymbolPipConfig(symbol) {
    const sym = symbol.toUpperCase();
    if (sym.includes('XAU')) return { pipSize: 0.1, decimals: 2 };
    if (sym.includes('JPY')) return { pipSize: 0.01, decimals: 3 };
    if (sym.includes('BTC')) return { pipSize: 1, decimals: 2 };
    if (sym.includes('ETH')) return { pipSize: 0.1, decimals: 2 };
    return { pipSize: 0.0001, decimals: 5 };
}

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║     🚀 QuantumAI Server Running                 ║
║     📡 Port: ${PORT}                                ║
║     📊 Auto-monitoring: ${AUTO_SYMBOLS.length} symbols              ║
║     ⏰ Scan every: 30 minutes                   ║
║     📱 Telegram: ${process.env.TELEGRAM_CHAT_ID ? 'Connected' : 'Not configured'}                     ║
╚══════════════════════════════════════════════════╝
  `);

    // Initialize Telegram bot if configured
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
        initTelegramBot();
    }

    // Auto-analysis every 30 minutes (saves API credits)
    cron.schedule('*/30 * * * *', () => {
        runAutoAnalysis();
    });

    // Run first scan 30s after boot (let APIs warm up)
    setTimeout(() => {
        console.log('🚀 Running initial scan...');
        runAutoAnalysis();
    }, 30000);

    console.log('🕐 Auto-analysis: every 30 min (first scan in 30s)');
    console.log(`📊 Monitoring: ${AUTO_SYMBOLS.join(', ')}`);
    console.log('📱 Only BUY/SELL signals will be sent to Telegram');
});

