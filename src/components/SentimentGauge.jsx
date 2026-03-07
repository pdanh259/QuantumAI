import React from 'react';

export default function SentimentGauge({ sentiment, intermarket }) {
    const fg = sentiment?.fearGreedIndex;
    const value = fg?.value ?? 50;
    const label = fg?.label || 'Neutral';

    // SVG arc calculation
    const centerX = 100;
    const centerY = 95;
    const radius = 80;
    const startAngle = Math.PI;
    const endAngle = 0;
    const angle = startAngle - (value / 100) * Math.PI;

    const needleX = centerX + radius * 0.75 * Math.cos(angle);
    const needleY = centerY - radius * 0.75 * Math.sin(angle);

    const getColor = (val) => {
        if (val <= 25) return '#ef4444';
        if (val <= 45) return '#f59e0b';
        if (val <= 55) return '#94a3b8';
        if (val <= 75) return '#10b981';
        return '#06b6d4';
    };

    const color = getColor(value);

    return (
        <div className="card animate-in animate-delay-4">
            <div className="card-header">
                <div className="card-title">
                    <span className="icon">💭</span>
                    Market Sentiment
                </div>
            </div>

            <div className="sentiment-container">
                <div className="gauge-wrapper">
                    <svg className="gauge-svg" viewBox="0 0 200 115">
                        {/* Background arc */}
                        <path
                            d={describeArc(centerX, centerY, radius, 180, 0)}
                            fill="none"
                            stroke="rgba(255,255,255,0.05)"
                            strokeWidth="16"
                            strokeLinecap="round"
                        />

                        {/* Gradient segments */}
                        <path d={describeArc(centerX, centerY, radius, 180, 144)} fill="none" stroke="#ef4444" strokeWidth="16" strokeLinecap="round" opacity="0.3" />
                        <path d={describeArc(centerX, centerY, radius, 144, 108)} fill="none" stroke="#f59e0b" strokeWidth="16" strokeLinecap="round" opacity="0.3" />
                        <path d={describeArc(centerX, centerY, radius, 108, 72)} fill="none" stroke="#94a3b8" strokeWidth="16" strokeLinecap="round" opacity="0.3" />
                        <path d={describeArc(centerX, centerY, radius, 72, 36)} fill="none" stroke="#10b981" strokeWidth="16" strokeLinecap="round" opacity="0.3" />
                        <path d={describeArc(centerX, centerY, radius, 36, 0)} fill="none" stroke="#06b6d4" strokeWidth="16" strokeLinecap="round" opacity="0.3" />

                        {/* Active arc */}
                        <path
                            d={describeArc(centerX, centerY, radius, 180, 180 - (value / 100) * 180)}
                            fill="none"
                            stroke={color}
                            strokeWidth="16"
                            strokeLinecap="round"
                            style={{ filter: `drop-shadow(0 0 8px ${color}40)` }}
                        />

                        {/* Needle */}
                        <line
                            x1={centerX}
                            y1={centerY}
                            x2={needleX}
                            y2={needleY}
                            stroke={color}
                            strokeWidth="3"
                            strokeLinecap="round"
                        />
                        <circle cx={centerX} cy={centerY} r="5" fill={color} />
                    </svg>

                    <div className="gauge-center-text">
                        <div className="gauge-value" style={{ color }}>{value}</div>
                        <div className="gauge-label">{label}</div>
                    </div>
                </div>

                <div className="sentiment-labels">
                    <span>😨 Extreme Fear</span>
                    <span>😎 Extreme Greed</span>
                </div>

                {/* Intermarket summary */}
                {intermarket && Object.keys(intermarket).length > 0 && (
                    <div style={{ width: '100%', marginTop: 8 }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>
                            🌐 Tác động Intermarket → Vàng
                        </div>
                        <div className="intermarket-grid">
                            {Object.entries(intermarket).map(([sym, data]) => {
                                if (!data || data.error) return null;
                                return (
                                    <div key={sym} className="intermarket-item">
                                        <div className="im-name">{data.name}</div>
                                        <div className="im-price">{data.current}</div>
                                        <div className={`im-change ${data.changePct > 0 ? 'up' : 'down'}`}>
                                            {data.changePct > 0 ? '▲' : '▼'} {Math.abs(data.changePct)}%
                                        </div>
                                        {data.goldImpact && (
                                            <div className="im-impact">{data.goldImpact.reason}</div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// SVG arc path helper
function describeArc(cx, cy, r, startDeg, endDeg) {
    const startRad = (startDeg * Math.PI) / 180;
    const endRad = (endDeg * Math.PI) / 180;
    const x1 = cx + r * Math.cos(Math.PI - startRad);
    const y1 = cy - r * Math.sin(Math.PI - startRad);
    const x2 = cx + r * Math.cos(Math.PI - endRad);
    const y2 = cy - r * Math.sin(Math.PI - endRad);
    const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}
