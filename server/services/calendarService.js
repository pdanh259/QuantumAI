import axios from 'axios';

/**
 * Fetch upcoming high-impact economic events
 * Uses a curated list approach since free economic calendar APIs are limited
 */
export async function fetchEconomicCalendar() {
    try {
        // Use Twelve Data economic events endpoint or fallback to curated data
        const events = await fetchFromTwelveData();
        if (events.length > 0) return events;

        // Fallback: Return placeholder with guidance
        return getStaticHighImpactEvents();
    } catch (error) {
        console.error('Error fetching economic calendar:', error.message);
        return getStaticHighImpactEvents();
    }
}

async function fetchFromTwelveData() {
    try {
        const response = await axios.get('https://api.twelvedata.com/earnings_calendar', {
            params: { apikey: process.env.TWELVEDATA_API_KEY },
            timeout: 5000
        });
        if (response.data && response.data.earnings) {
            return response.data.earnings.slice(0, 10).map(e => ({
                event: e.title || 'Earnings',
                currency: 'USD',
                impact: 'medium',
                time: e.date,
                forecast: e.estimate || 'N/A',
                previous: e.previous || 'N/A'
            }));
        }
        return [];
    } catch {
        return [];
    }
}

/**
 * Static high-impact events that typically affect gold (for demo / fallback)
 */
function getStaticHighImpactEvents() {
    const now = new Date();
    const upcoming = [];

    // Common recurring high-impact USD events
    const recurringEvents = [
        { event: 'FOMC Meeting Minutes', currency: 'USD', impact: 'high', dayOfMonth: [15, 28] },
        { event: 'Non-Farm Payrolls (NFP)', currency: 'USD', impact: 'high', dayOfMonth: [5] },
        { event: 'CPI (Consumer Price Index)', currency: 'USD', impact: 'high', dayOfMonth: [13] },
        { event: 'GDP Release', currency: 'USD', impact: 'high', dayOfMonth: [26] },
        { event: 'Fed Interest Rate Decision', currency: 'USD', impact: 'high', dayOfMonth: [18] },
        { event: 'PPI (Producer Price Index)', currency: 'USD', impact: 'medium', dayOfMonth: [14] },
        { event: 'Retail Sales', currency: 'USD', impact: 'medium', dayOfMonth: [16] },
        { event: 'Initial Jobless Claims', currency: 'USD', impact: 'medium', dayOfMonth: [7, 14, 21, 28] }
    ];

    for (const evt of recurringEvents) {
        for (const day of evt.dayOfMonth) {
            const eventDate = new Date(now.getFullYear(), now.getMonth(), day, 20, 30);
            const diffDays = (eventDate - now) / (1000 * 60 * 60 * 24);

            if (diffDays >= -1 && diffDays <= 14) {
                upcoming.push({
                    ...evt,
                    time: eventDate.toISOString(),
                    daysUntil: Math.ceil(diffDays),
                    forecast: 'TBD',
                    previous: 'TBD'
                });
            }
        }
    }

    return upcoming.sort((a, b) => new Date(a.time) - new Date(b.time)).slice(0, 8);
}
