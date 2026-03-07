import axios from 'axios';

/**
 * Fetch market sentiment data
 * Combines Fear & Greed index with basic sentiment analysis
 */
export async function fetchSentiment() {
    try {
        const [fearGreed] = await Promise.allSettled([
            fetchFearGreedIndex()
        ]);

        return {
            fearGreedIndex: fearGreed.status === 'fulfilled' ? fearGreed.value : getDefaultFearGreed(),
            overallSentiment: calcOverallSentiment(
                fearGreed.status === 'fulfilled' ? fearGreed.value : getDefaultFearGreed()
            )
        };
    } catch (error) {
        console.error('Error fetching sentiment:', error.message);
        return {
            fearGreedIndex: getDefaultFearGreed(),
            overallSentiment: 'neutral'
        };
    }
}

/**
 * Fetch CNN Fear & Greed Index
 */
async function fetchFearGreedIndex() {
    try {
        const response = await axios.get('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0'
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
        return getDefaultFearGreed();
    } catch (error) {
        console.error('Fear & Greed fetch error:', error.message);
        return getDefaultFearGreed();
    }
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
