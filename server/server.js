import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchPriceData, fetchMultiTimeframeData } from './services/priceService.js';
import { fetchNews } from './services/newsService.js';
import { fetchEconomicCalendar } from './services/calendarService.js';
import { fetchIntermarketData } from './services/intermarketService.js';
import { fetchSentiment } from './services/sentimentService.js';
import { runTechnicalAnalysis } from './analysis/technicalAnalysis.js';
import { generateSignal } from './analysis/aiEngine.js';
import { runQuantAnalysis } from './analysis/quantAnalysis.js';
import { sendTelegramSignal, initTelegramBot } from './services/telegramBot.js';

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

// Cache for data to avoid hitting API limits
let dataCache = {
    prices: null,
    multiTf: null,
    news: null,
    calendar: null,
    intermarket: null,
    sentiment: null,
    technicalAnalysis: null,
    lastSignal: null,
    lastUpdate: null
};

// ==================== API ROUTES ====================

// Get all market data
app.get('/api/market-data', async (req, res) => {
    try {
        const symbol = process.env.SYMBOL || 'XAU/USD';

        // Fetch all data in parallel
        const [prices, news, calendar, intermarket, sentiment] = await Promise.allSettled([
            fetchPriceData(symbol, '1h', 100),
            fetchNews(),
            fetchEconomicCalendar(),
            fetchIntermarketData(),
            fetchSentiment()
        ]);

        dataCache.prices = prices.status === 'fulfilled' ? prices.value : dataCache.prices;
        dataCache.news = news.status === 'fulfilled' ? news.value : dataCache.news;
        dataCache.calendar = calendar.status === 'fulfilled' ? calendar.value : dataCache.calendar;
        dataCache.intermarket = intermarket.status === 'fulfilled' ? intermarket.value : dataCache.intermarket;
        dataCache.sentiment = sentiment.status === 'fulfilled' ? sentiment.value : dataCache.sentiment;
        dataCache.lastUpdate = new Date().toISOString();

        res.json({
            success: true,
            data: {
                prices: dataCache.prices,
                news: dataCache.news,
                calendar: dataCache.calendar,
                intermarket: dataCache.intermarket,
                sentiment: dataCache.sentiment,
                lastUpdate: dataCache.lastUpdate
            }
        });
    } catch (error) {
        console.error('Error fetching market data:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get multi-timeframe price data
app.get('/api/prices/:timeframe', async (req, res) => {
    try {
        const symbol = process.env.SYMBOL || 'XAU/USD';
        const { timeframe } = req.params;
        const data = await fetchPriceData(symbol, timeframe, 200);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Run full AI analysis and generate signal
app.post('/api/analyze', async (req, res) => {
    try {
        const symbol = process.env.SYMBOL || 'XAU/USD';
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

        dataCache.lastSignal = signal;
        dataCache.technicalAnalysis = technicalData;
        dataCache.quantData = quantData;

        // Step 5: Send to Telegram if configured
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
            console.log('📱 Step 5: Sending signal to Telegram...');
            try {
                await sendTelegramSignal(signal);
                console.log('✅ Signal sent to Telegram!');
            } catch (tgError) {
                console.log('⚠️ Telegram send failed:', tgError.message);
            }
        } else {
            console.log('⏭️ Step 5: Telegram not configured, skipping...');
        }

        console.log('✅ Analysis complete!');
        console.log(`📐 Quant Score: ${quantData.compositeScore?.score}/100 → ${quantData.compositeScore?.signal}`);

        res.json({
            success: true,
            signal,
            technicalAnalysis: technicalData,
            quantData,
            marketData: {
                currentPrice: marketData.pricesH1.length > 0 ? marketData.pricesH1[marketData.pricesH1.length - 1] : null,
                news: marketData.news.slice(0, 5),
                calendar: marketData.calendar,
                intermarket: marketData.intermarket,
                sentiment: marketData.sentiment
            }
        });
    } catch (error) {
        console.error('❌ Analysis error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get last generated signal
app.get('/api/signal', (req, res) => {
    res.json({
        success: true,
        signal: dataCache.lastSignal,
        technicalAnalysis: dataCache.technicalAnalysis,
        lastUpdate: dataCache.lastUpdate
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve React app for all non-API routes (SPA fallback)
app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║     🚀 QuantumAI Server Running         ║
║     📡 Port: ${PORT}                        ║
║     📊 Symbol: ${process.env.SYMBOL || 'XAU/USD'}                 ║
║     ⏰ ${new Date().toLocaleString()}          ║
╚══════════════════════════════════════════╝
  `);

    // Initialize Telegram bot if configured
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
        initTelegramBot();
    }
});
