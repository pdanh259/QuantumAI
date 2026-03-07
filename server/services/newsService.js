import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.NEWSAPI_KEY;

/**
 * Fetch financial news from NewsAPI
 * Returns top articles related to forex, gold, economy
 */
export async function fetchNews() {
    try {
        const queries = ['forex gold XAUUSD', 'federal reserve interest rate', 'economy inflation'];
        const allArticles = [];

        // Fetch with the primary query
        const response = await axios.get('https://newsapi.org/v2/everything', {
            params: {
                q: 'gold OR XAUUSD OR "federal reserve" OR forex',
                language: 'en',
                sortBy: 'publishedAt',
                pageSize: 20,
                apiKey: API_KEY
            },
            timeout: 10000
        });

        if (response.data.articles) {
            for (const article of response.data.articles) {
                allArticles.push({
                    title: article.title,
                    description: article.description,
                    source: article.source?.name || 'Unknown',
                    url: article.url,
                    publishedAt: article.publishedAt,
                    sentiment: analyzeNewsSentiment(article.title + ' ' + (article.description || '')),
                    impact: estimateImpact(article.title)
                });
            }
        }

        return allArticles.slice(0, 15);
    } catch (error) {
        console.error('Error fetching news:', error.message);
        return [];
    }
}

/**
 * Simple keyword-based sentiment analysis for news
 */
function analyzeNewsSentiment(text) {
    if (!text) return 'neutral';
    const lower = text.toLowerCase();

    const bullishKeywords = ['surge', 'rally', 'gain', 'rise', 'bullish', 'record high',
        'safe haven', 'dovish', 'rate cut', 'stimulus', 'demand', 'buying', 'upside'];
    const bearishKeywords = ['fall', 'drop', 'decline', 'bearish', 'sell-off', 'crash',
        'hawkish', 'rate hike', 'taper', 'strong dollar', 'downside', 'selling'];

    let bullScore = 0, bearScore = 0;
    bullishKeywords.forEach(kw => { if (lower.includes(kw)) bullScore++; });
    bearishKeywords.forEach(kw => { if (lower.includes(kw)) bearScore++; });

    if (bullScore > bearScore) return 'bullish';
    if (bearScore > bullScore) return 'bearish';
    return 'neutral';
}

/**
 * Estimate news impact level
 */
function estimateImpact(title) {
    if (!title) return 'low';
    const lower = title.toLowerCase();

    const highImpact = ['federal reserve', 'fed ', 'fomc', 'interest rate', 'nfp', 'non-farm',
        'cpi', 'inflation', 'gdp', 'central bank', 'ecb', 'boj', 'war', 'crisis'];
    const mediumImpact = ['employment', 'jobs', 'pmi', 'retail sales', 'trade', 'tariff',
        'sanctions', 'oil', 'crude'];

    for (const kw of highImpact) {
        if (lower.includes(kw)) return 'high';
    }
    for (const kw of mediumImpact) {
        if (lower.includes(kw)) return 'medium';
    }
    return 'low';
}
