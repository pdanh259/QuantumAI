import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.TWELVEDATA_API_KEY;

// ==================== TTL CACHE ====================
let intermarketCache = null;
let intermarketCacheTime = 0;
const INTERMARKET_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Fetch intermarket correlation data (with TTL cache)
 * Gold is inversely correlated with DXY and positively with risk assets
 */
export async function fetchIntermarketData() {
    // Return cached data if still fresh
    if (intermarketCache && (Date.now() - intermarketCacheTime) < INTERMARKET_CACHE_TTL) {
        return intermarketCache;
    }

    const symbols = [
        { symbol: 'DXY', name: 'US Dollar Index', correlation: 'inverse' },
        { symbol: 'SPX', name: 'S&P 500', correlation: 'mixed' },
        { symbol: 'TNX', name: 'US 10Y Yield', correlation: 'inverse' },
        { symbol: 'CL', name: 'Crude Oil', correlation: 'mixed' }
    ];

    const results = {};

    for (const { symbol, name, correlation } of symbols) {
        try {
            const response = await axios.get('https://api.twelvedata.com/time_series', {
                params: {
                    symbol,
                    interval: '1h',
                    outputsize: 24,
                    apikey: API_KEY,
                    format: 'JSON'
                },
                timeout: 8000
            });

            if (response.data.values && response.data.values.length > 0) {
                const values = response.data.values;
                const current = parseFloat(values[0].close);
                const prev24h = parseFloat(values[values.length - 1].close);
                const change = current - prev24h;
                const changePct = ((change / prev24h) * 100).toFixed(2);

                results[symbol] = {
                    name,
                    symbol,
                    current,
                    change: change.toFixed(2),
                    changePct: parseFloat(changePct),
                    correlation,
                    trend: changePct > 0.1 ? 'up' : changePct < -0.1 ? 'down' : 'flat',
                    goldImpact: getGoldImpact(symbol, changePct)
                };
            }

            // Rate limit delay
            await new Promise(r => setTimeout(r, 500));
        } catch (error) {
            console.error(`Error fetching ${symbol}:`, error.message);
            results[symbol] = { name, symbol, error: true, current: null };
        }
    }

    // Cache if we got valid data
    if (Object.keys(results).length > 0) {
        intermarketCache = results;
        intermarketCacheTime = Date.now();
    }

    return results;
}

/**
 * Determine how the intermarket move impacts gold
 */
function getGoldImpact(symbol, changePct) {
    const pct = parseFloat(changePct);

    switch (symbol) {
        case 'DXY':
            // Dollar up = Gold down (inverse)
            if (pct > 0.3) return { direction: 'bearish', strength: 'strong', reason: 'DXY tăng mạnh → Áp lực giảm giá vàng' };
            if (pct > 0.1) return { direction: 'bearish', strength: 'moderate', reason: 'DXY tăng nhẹ → Hơi tiêu cực cho vàng' };
            if (pct < -0.3) return { direction: 'bullish', strength: 'strong', reason: 'DXY giảm mạnh → Hỗ trợ giá vàng' };
            if (pct < -0.1) return { direction: 'bullish', strength: 'moderate', reason: 'DXY giảm nhẹ → Hơi tích cực cho vàng' };
            return { direction: 'neutral', strength: 'weak', reason: 'DXY ổn định → Ít tác động' };

        case 'TNX':
            // Yields up = Gold down (inverse - higher opportunity cost)
            if (pct > 0.5) return { direction: 'bearish', strength: 'strong', reason: 'Lợi suất tăng → Chi phí cơ hội cao, áp lực giảm vàng' };
            if (pct > 0.2) return { direction: 'bearish', strength: 'moderate', reason: 'Lợi suất tăng nhẹ → Hơi tiêu cực cho vàng' };
            if (pct < -0.5) return { direction: 'bullish', strength: 'strong', reason: 'Lợi suất giảm → Hỗ trợ mạnh cho vàng' };
            if (pct < -0.2) return { direction: 'bullish', strength: 'moderate', reason: 'Lợi suất giảm nhẹ → Hỗ trợ vàng' };
            return { direction: 'neutral', strength: 'weak', reason: 'Lợi suất ổn định → Ít tác động' };

        case 'SPX':
            // Risk-on (stock up) can be negative for gold (safe haven flows decrease)
            if (pct > 1) return { direction: 'bearish', strength: 'moderate', reason: 'Chứng khoán tăng mạnh → Giảm nhu cầu trú ẩn an toàn' };
            if (pct < -1) return { direction: 'bullish', strength: 'moderate', reason: 'Chứng khoán giảm mạnh → Tăng nhu cầu trú ẩn vàng' };
            return { direction: 'neutral', strength: 'weak', reason: 'Thị trường chứng khoán ổn định' };

        case 'CL':
            // Oil up = Inflation expectations up = Gold up (both hedge inflation)
            if (pct > 2) return { direction: 'bullish', strength: 'moderate', reason: 'Dầu tăng → Kỳ vọng lạm phát tăng → Hỗ trợ vàng' };
            if (pct < -2) return { direction: 'bearish', strength: 'moderate', reason: 'Dầu giảm → Kỳ vọng lạm phát giảm → Bất lợi cho vàng' };
            return { direction: 'neutral', strength: 'weak', reason: 'Giá dầu ổn định' };

        default:
            return { direction: 'neutral', strength: 'weak', reason: '' };
    }
}
