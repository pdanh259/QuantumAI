import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.TWELVEDATA_API_KEY;
const BASE_URL = 'https://api.twelvedata.com';

/**
 * Fetch OHLCV price data from Twelve Data API
 * @param {string} symbol - Trading symbol (e.g., 'XAU/USD')
 * @param {string} interval - Timeframe ('1min','5min','15min','30min','1h','4h','1day')
 * @param {number} outputsize - Number of candles to fetch
 * @returns {Array} Array of OHLCV candles
 */
export async function fetchPriceData(symbol, interval, outputsize = 100) {
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
        return values.reverse().map(v => ({
            time: v.datetime,
            open: parseFloat(v.open),
            high: parseFloat(v.high),
            low: parseFloat(v.low),
            close: parseFloat(v.close),
            volume: parseFloat(v.volume || 0)
        }));
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
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
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
