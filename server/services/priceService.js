import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.TWELVEDATA_API_KEY;
const BASE_URL = 'https://api.twelvedata.com';

// ==================== TTL CACHE ====================
const priceCache = {};
const CACHE_TTL = {
    '1h': 10 * 60 * 1000,  // 10 minutes
    '4h': 30 * 60 * 1000,  // 30 minutes
    '1day': 60 * 60 * 1000,  // 1 hour
    '15min': 5 * 60 * 1000,  // 5 minutes
};

function getCacheKey(symbol, interval) {
    return `${symbol}_${interval}`;
}

function getCachedPrice(symbol, interval) {
    const key = getCacheKey(symbol, interval);
    const entry = priceCache[key];
    if (!entry) return null;

    const ttl = CACHE_TTL[interval] || 10 * 60 * 1000;
    if (Date.now() - entry.timestamp > ttl) return null; // expired

    return entry.data;
}

function setCachedPrice(symbol, interval, data) {
    const key = getCacheKey(symbol, interval);
    priceCache[key] = { data, timestamp: Date.now() };
}

// ==================== API FUNCTIONS ====================

/**
 * Fetch OHLCV price data from Twelve Data API (with TTL cache)
 * @param {string} symbol - Trading symbol (e.g., 'XAU/USD')
 * @param {string} interval - Timeframe ('1min','5min','15min','30min','1h','4h','1day')
 * @param {number} outputsize - Number of candles to fetch
 * @returns {Array} Array of OHLCV candles
 */
export async function fetchPriceData(symbol, interval, outputsize = 100) {
    // Check cache first
    const cached = getCachedPrice(symbol, interval);
    if (cached) {
        return cached;
    }

    try {
        const response = await axios.get(`${BASE_URL}/time_series`, {
            params: {
                symbol,
                interval,
                outputsize,
                apikey: API_KEY,
                format: 'JSON'
            },
            timeout: 10000
        });

        if (response.data.status === 'error') {
            console.error(`Price API error for ${symbol} ${interval}:`, response.data.message);
            return [];
        }

        const values = response.data.values || [];

        // Convert and reverse to chronological order (oldest first)
        const result = values.reverse().map(v => ({
            time: v.datetime,
            open: parseFloat(v.open),
            high: parseFloat(v.high),
            low: parseFloat(v.low),
            close: parseFloat(v.close),
            volume: parseFloat(v.volume || 0)
        }));

        // Cache the result
        if (result.length > 0) {
            setCachedPrice(symbol, interval, result);
        }

        return result;
    } catch (error) {
        console.error(`Error fetching ${symbol} ${interval}:`, error.message);
        return [];
    }
}

/**
 * Fetch multi-timeframe data for a symbol
 */
export async function fetchMultiTimeframeData(symbol) {
    const timeframes = ['15min', '1h', '4h', '1day'];
    const results = {};

    for (const tf of timeframes) {
        results[tf] = await fetchPriceData(symbol, tf, 100);
        // Small delay to avoid rate limiting (only if not cached)
        if (!getCachedPrice(symbol, tf)) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    return results;
}

/**
 * Get current real-time price
 */
export async function fetchCurrentPrice(symbol) {
    try {
        const response = await axios.get(`${BASE_URL}/price`, {
            params: { symbol, apikey: API_KEY },
            timeout: 5000
        });
        return parseFloat(response.data.price);
    } catch (error) {
        console.error('Error fetching current price:', error.message);
        return null;
    }
}
