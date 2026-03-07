import React from 'react';

export default function SignalPanel({ signal, analyzing }) {
    if (analyzing) {
        return (
            <div className="card signal-card animate-in">
                <div className="card-header">
                    <div className="card-title">
                        <span className="icon">🤖</span>
                        AI Signal
                    </div>
                </div>
                <div className="empty-state">
                    <div className="spinner" style={{ width: 40, height: 40, borderWidth: 3, borderColor: 'rgba(59,130,246,0.3)', borderTopColor: '#3b82f6' }}></div>
                    <p className="text" style={{ marginTop: 16 }}>Đang thu thập dữ liệu & phân tích AI...</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Quá trình này mất khoảng 15-30 giây</p>
                </div>
            </div>
        );
    }

    if (!signal) {
        return (
            <div className="card signal-card animate-in">
                <div className="card-header">
                    <div className="card-title">
                        <span className="icon">🤖</span>
                        AI Signal
                    </div>
                </div>
                <div className="empty-state">
                    <span className="icon">📡</span>
                    <p className="text">Nhấn "Phân tích & Gửi Signal" để bắt đầu</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        AI sẽ phân tích 5 nguồn dữ liệu trên 4 timeframe
                    </p>
                </div>
            </div>
        );
    }

    const isNoTrade = signal.action === 'NO_TRADE';
    const isBuy = signal.action === 'BUY';

    return (
        <div className={`card signal-card ${isBuy ? 'buy' : isNoTrade ? '' : 'sell'} animate-in`}>
            <div className="card-header">
                <div className="card-title">
                    <span className="icon">🤖</span>
                    AI Signal
                </div>
                <span className={`card-badge ${isBuy ? 'badge-bullish' : isNoTrade ? 'badge-neutral' : 'badge-bearish'}`}>
                    {signal.source === 'gemini-pro' ? 'Gemini' : signal.source === 'fallback' ? 'Fallback' : 'AI'}
                </span>
            </div>

            {isNoTrade ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{ fontSize: '2rem', marginBottom: 8 }}>⏸️</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent-amber)', marginBottom: 8 }}>
                        NO TRADE
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {signal.reasons?.[0] || 'Không đủ điều kiện vào lệnh'}
                    </p>
                </div>
            ) : (
                <>
                    {/* Direction */}
                    <div className="signal-direction">
                        <span style={{ fontSize: '2.5rem' }}>{isBuy ? '📈' : '📉'}</span>
                        <div>
                            <div className={`dir-label ${isBuy ? 'buy' : 'sell'}`}>
                                {signal.action}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                {signal.symbol} • {signal.marketCondition || ''}
                            </div>
                        </div>
                    </div>

                    {/* Prices */}
                    <div className="signal-prices">
                        <div className="signal-price-item entry">
                            <div className="label">Entry</div>
                            <div className="value">{signal.entry}</div>
                        </div>
                        <div className="signal-price-item sl">
                            <div className="label">Stop Loss</div>
                            <div className="value">{signal.stopLoss}</div>
                            {signal.slPips && <div className="pips">{signal.slPips} pips</div>}
                        </div>
                        <div className="signal-price-item tp">
                            <div className="label">Take Profit 1</div>
                            <div className="value">{signal.tp1}</div>
                            {signal.tp1Pips && <div className="pips">+{signal.tp1Pips} pips</div>}
                        </div>
                        <div className="signal-price-item tp">
                            <div className="label">Take Profit 2</div>
                            <div className="value">{signal.tp2}</div>
                            {signal.tp2Pips && <div className="pips">+{signal.tp2Pips} pips</div>}
                        </div>
                    </div>

                    {/* R:R */}
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 12px', background: 'var(--bg-glass)', borderRadius: 8,
                        marginBottom: 8, fontSize: '0.85rem'
                    }}>
                        <span style={{ color: 'var(--text-muted)' }}>Risk : Reward</span>
                        <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent-cyan)' }}>
                            1 : {signal.riskReward}
                        </span>
                    </div>

                    {/* Confidence */}
                    <div className="confidence-bar">
                        <div className="bar-header">
                            <span className="bar-label">Confidence</span>
                            <span className="bar-value" style={{
                                color: signal.confidence >= 70 ? 'var(--accent-green)' :
                                    signal.confidence >= 50 ? 'var(--accent-amber)' : 'var(--accent-red)'
                            }}>
                                {signal.confidence}%
                            </span>
                        </div>
                        <div className="confidence-track">
                            <div
                                className={`confidence-fill ${signal.confidence >= 70 ? 'high' : signal.confidence < 50 ? 'low' : ''}`}
                                style={{ width: `${signal.confidence}%` }}
                            />
                        </div>
                    </div>

                    {/* Reasons */}
                    {signal.reasons && signal.reasons.length > 0 && (
                        <div className="signal-reasons">
                            <h4>💡 Lý do vào lệnh</h4>
                            {signal.reasons.map((reason, i) => (
                                <div key={i} className="reason-item">
                                    <span className="bullet">●</span>
                                    <span>{reason}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Warnings */}
                    {signal.warnings && signal.warnings.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                            <h4 style={{ fontSize: '0.8rem', color: 'var(--accent-amber)', marginBottom: 6 }}>⚠️ Cảnh báo</h4>
                            {signal.warnings.map((w, i) => (
                                <div key={i} className="warning-item">{w}</div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* Timestamp */}
            {signal.timestamp && (
                <div style={{
                    marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--border-color)',
                    fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center'
                }}>
                    {new Date(signal.timestamp).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                </div>
            )}
        </div>
    );
}
