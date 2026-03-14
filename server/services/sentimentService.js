import axios from 'axios';

// ==================== TTL CACHE ====================
let sentimentCache = null;
let sentimentCacheTime = 0;
const SENTIMENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch market sentiment data (with TTL cache)
 * Combines Fear & Greed index with basic sentiment analysis
 */
export async function fetchSentiment() {
    // Return cached data if still fresh
    if (sentimentCache && (Date.now() - sentimentCacheTime) < SENTIMENT_CACHE_TTL) {
        return sentimentCache;
    }

    try {
        const [fearGreed] = await Promise.allSettled([
            fetchFearGreedIndex()
        ]);

        const result = {
            fearGreedIndex: fearGreed.status === 'fulfilled' ? fearGreed.value : getDefaultFearGreed(),
            overallSentiment: calcOverallSentiment(
                fearGreed.status === 'fulfilled' ? fearGreed.value : getDefaultFearGreed()
            )
        };

        // Cache if we got real data (not default)
        if (fearGreed.status === 'fulfilled' && fearGreed.value.value !== 50) {
            sentimentCache = result;
            sentimentCacheTime = Date.now();
        }

        return result;
    } catch (error) {
        console.error('Error fetching sentiment:', error.message);
        return {
            fearGreedIndex: getDefaultFearGreed(),
            overallSentiment: 'neutral'
        };
    }
}

/**
 * Fetch Fear & Greed Index from alternative API
 */
async function fetchFearGreedIndex() {
    // Try alternative API (crypto fear & greed - more reliable)
    try {
        const response = await axios.get('https://api.alternative.me/fng/?limit=1', {
            timeout: 5000
        });

        if (response.data && response.data.data && response.data.data.length > 0) {
            const data = response.data.data[0];
            return {
                value: parseInt(data.value),
                label: data.value_classification,
                timestamp: new Date(parseInt(data.timestamp) * 1000).toISOString(),
                previousClose: null,
                weekAgo: null,
                monthAgo: null
            };
        }
    } catch (err) {
        console.error('Alternative Fear & Greed API error:', err.message);
    }

    // Fallback: try CNN endpoint
    try {
        const response = await axios.get('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (response.data && response.data.fear_and_greed) {
            const data = response.data.fear_and_greed;
            return {
                value: Math.round(data.score),
                label: data.rating,
                timestamp: data.timestamp,
                previousClose: data.previous_close,
                weekAgo: data.previous_1_week,
                monthAgo: data.previous_1_month
            };
        }
    } catch (err) {
        console.error('CNN Fear & Greed error:', err.message);
    }

    return getDefaultFearGreed();
}

function getDefaultFearGreed() {
    return {
        value: 50,
        label: 'Neutral',
        timestamp: new Date().toISOString(),
        previousClose: null,
        weekAgo: null,
        monthAgo: null
    };
}

function calcOverallSentiment(fearGreed) {
    const value = fearGreed.value;
    if (value >= 75) return 'extreme_greed';
    if (value >= 60) return 'greed';
    if (value >= 45) return 'neutral';
    if (value >= 25) return 'fear';
    return 'extreme_fear';
}
