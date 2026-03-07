import React from 'react';

export default function TechnicalIndicators({ data }) {
    // Use H1 data by default
    const tf = data?.H1 || data?.H4 || null;

    const indicators = tf ? [
        {
            name: 'EMA 20',
            value: tf.trend?.ema20 || '—',
            signal: tf.currentPrice > tf.trend?.ema20 ? 'buy' : tf.currentPrice < tf.trend?.ema20 ? 'sell' : 'neutral'
        },
        {
            name: 'EMA 50',
            value: tf.trend?.ema50 || '—',
            signal: tf.currentPrice > tf.trend?.ema50 ? 'buy' : tf.currentPrice < tf.trend?.ema50 ? 'sell' : 'neutral'
        },
        {
            name: 'MACD',
            value: tf.trend?.macd?.histogram || '—',
            signal: tf.trend?.macd?.histogram > 0 ? 'buy' : tf.trend?.macd?.histogram < 0 ? 'sell' : 'neutral'
        },
        {
            name: 'RSI (14)',
            value: tf.momentum?.rsi?.value || '—',
            signal: tf.momentum?.rsi?.condition === 'overbought' ? 'sell' :
                tf.momentum?.rsi?.condition === 'oversold' ? 'buy' : 'neutral'
        },
        {
            name: 'Stochastic',
            value: tf.momentum?.stochastic ? `${tf.momentum.stochastic.k}/${tf.momentum.stochastic.d}` : '—',
            signal: tf.momentum?.stochastic?.condition === 'overbought' ? 'sell' :
                tf.momentum?.stochastic?.condition === 'oversold' ? 'buy' : 'neutral'
        },
        {
            name: 'ADX',
            value: tf.trend?.adx?.adx || '—',
            signal: tf.trend?.adx?.trendStrength === 'strong' ?
                (tf.trend?.adx?.pdi > tf.trend?.adx?.mdi ? 'buy' : 'sell') : 'neutral'
        },
        {
            name: 'Bollinger',
            value: tf.volatility?.bollingerBands?.position?.replace('_', ' ') || '—',
            signal: tf.volatility?.bollingerBands?.position === 'below_lower' ? 'buy' :
                tf.volatility?.bollingerBands?.position === 'above_upper' ? 'sell' : 'neutral'
        },
        {
            name: 'ATR (14)',
            value: tf.volatility?.atr || '—',
            signal: 'neutral'
        },
    ] : [];

    const buyCount = indicators.filter(i => i.signal === 'buy').length;
    const sellCount = indicators.filter(i => i.signal === 'sell').length;
    const neutralCount = indicators.filter(i => i.signal === 'neutral').length;

    return (
        <div className="card animate-in animate-delay-2">
            <div className="card-header">
                <div className="card-title">
                    <span className="icon">📐</span>
                    Indicators (H1)
                </div>
                {tf && (
                    <span className={`card-badge ${buyCount > sellCount ? 'badge-bullish' : sellCount > buyCount ? 'badge-bearish' : 'badge-neutral'}`}>
                        {buyCount > sellCount ? 'Bullish' : sellCount > buyCount ? 'Bearish' : 'Neutral'}
                    </span>
                )}
            </div>

            {!tf ? (
                <div className="empty-state">
                    <span className="icon">📊</span>
                    <p className="text">Chạy phân tích để xem indicators</p>
                </div>
            ) : (
                <>
                    {/* Summary bar */}
                    <div style={{
                        display: 'flex', gap: 8, marginBottom: 12, fontSize: '0.75rem'
                    }}>
                        <div style={{
                            flex: buyCount, background: 'rgba(16,185,129,0.2)',
                            padding: '4px 8px', borderRadius: 4, color: '#10b981', fontWeight: 600, textAlign: 'center',
                            minWidth: buyCount > 0 ? 40 : 0
                        }}>
                            {buyCount > 0 && `Buy ${buyCount}`}
                        </div>
                        <div style={{
                            flex: neutralCount, background: 'rgba(148,163,184,0.15)',
                            padding: '4px 8px', borderRadius: 4, color: '#94a3b8', fontWeight: 600, textAlign: 'center',
                            minWidth: neutralCount > 0 ? 40 : 0
                        }}>
                            {neutralCount > 0 && `${neutralCount}`}
                        </div>
                        <div style={{
                            flex: sellCount, background: 'rgba(239,68,68,0.2)',
                            padding: '4px 8px', borderRadius: 4, color: '#ef4444', fontWeight: 600, textAlign: 'center',
                            minWidth: sellCount > 0 ? 40 : 0
                        }}>
                            {sellCount > 0 && `Sell ${sellCount}`}
                        </div>
                    </div>

                    <div className="indicators-grid">
                        {indicators.map((ind, i) => (
                            <div key={i} className="indicator-row">
                                <span className="indicator-name">{ind.name}</span>
                                <span className="indicator-value">{ind.value}</span>
                                <span className={`indicator-signal ${ind.signal}`}>
                                    {ind.signal}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Bias Summary */}
                    {tf.bias && (
                        <div style={{
                            marginTop: 12, padding: '10px 14px',
                            background: 'var(--bg-glass)',
                            borderRadius: 8, borderLeft: '3px solid var(--accent-blue)'
                        }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Overall Bias</div>
                            <div style={{
                                fontSize: '0.9rem', fontWeight: 700,
                                color: tf.bias.direction.includes('BULLISH') ? 'var(--accent-green)' :
                                    tf.bias.direction.includes('BEARISH') ? 'var(--accent-red)' : 'var(--accent-amber)'
                            }}>
                                {tf.bias.summary}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
