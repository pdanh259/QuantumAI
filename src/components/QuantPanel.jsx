import React from 'react';

export default function QuantPanel({ data }) {
    if (!data || data.error) {
        return (
            <div className="card quant-card animate-in">
                <div className="card-header">
                    <div className="card-title">
                        <span className="icon">📐</span>
                        Quant Analysis
                    </div>
                </div>
                <div className="empty-state">
                    <span className="icon">📊</span>
                    <p className="text">Chạy phân tích để xem dữ liệu Quant</p>
                </div>
            </div>
        );
    }

    const { compositeScore, momentum, volatilityRegime, zScore, rateOfChange, volumeProfile, winProbability, positionSize, correlation } = data;

    const getScoreColor = (score) => {
        if (score >= 70) return 'var(--accent-green)';
        if (score >= 55) return 'var(--accent-cyan)';
        if (score >= 45) return 'var(--accent-amber)';
        if (score >= 30) return 'var(--accent-orange, #f97316)';
        return 'var(--accent-red)';
    };

    const getMomentumColor = (dir) => {
        if (dir === 'bullish') return 'var(--accent-green)';
        if (dir === 'bearish') return 'var(--accent-red)';
        return 'var(--text-muted)';
    };

    const getRegimeColor = (regime) => {
        if (regime === 'LOW') return 'var(--accent-cyan)';
        if (regime === 'NORMAL') return 'var(--accent-green)';
        if (regime === 'HIGH') return 'var(--accent-amber)';
        if (regime === 'EXTREME') return 'var(--accent-red)';
        return 'var(--text-muted)';
    };

    const zScoreClamp = Math.max(-3, Math.min(3, zScore?.zScore20 || 0));
    const zPosPercent = ((zScoreClamp + 3) / 6) * 100;

    return (
        <div className="card quant-card animate-in">
            <div className="card-header">
                <div className="card-title">
                    <span className="icon">📐</span>
                    Quant Analysis
                </div>
                {compositeScore && (
                    <span className={`card-badge ${compositeScore.score >= 55 ? 'badge-bullish' :
                            compositeScore.score <= 45 ? 'badge-bearish' : 'badge-neutral'
                        }`}>
                        {compositeScore.signal?.replace('_', ' ')}
                    </span>
                )}
            </div>

            {/* ── Composite Score Gauge ── */}
            {compositeScore && (
                <div className="quant-composite">
                    <div className="composite-gauge">
                        <svg viewBox="0 0 120 70" className="gauge-svg">
                            <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" strokeLinecap="round" />
                            <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none"
                                stroke={getScoreColor(compositeScore.score)}
                                strokeWidth="8" strokeLinecap="round"
                                strokeDasharray={`${(compositeScore.score / 100) * 157} 157`}
                                style={{ filter: `drop-shadow(0 0 6px ${getScoreColor(compositeScore.score)})` }}
                            />
                            <text x="60" y="55" textAnchor="middle" fill={getScoreColor(compositeScore.score)}
                                fontSize="22" fontWeight="800" fontFamily="'JetBrains Mono', monospace">
                                {compositeScore.score}
                            </text>
                            <text x="60" y="67" textAnchor="middle" fill="var(--text-muted)" fontSize="7">
                                COMPOSITE SCORE
                            </text>
                        </svg>
                    </div>
                    <div className="composite-label" style={{ color: getScoreColor(compositeScore.score) }}>
                        {compositeScore.label}
                    </div>
                </div>
            )}

            {/* ── Multi-TF Momentum Heatmap ── */}
            {momentum?.timeframes && (
                <div className="quant-section">
                    <div className="quant-section-title">⚡ Momentum đa Timeframe</div>
                    <div className="momentum-heatmap">
                        {Object.entries(momentum.timeframes).map(([tf, val]) => (
                            <div key={tf} className="momentum-cell" style={{
                                borderColor: getMomentumColor(val.direction),
                                background: `${getMomentumColor(val.direction)}10`
                            }}>
                                <div className="tf-label">{tf}</div>
                                <div className="tf-score" style={{ color: getMomentumColor(val.direction) }}>
                                    {val.score > 0 ? '+' : ''}{val.score}
                                </div>
                                <div className="tf-dir">{val.direction === 'bullish' ? '▲' : val.direction === 'bearish' ? '▼' : '●'}</div>
                            </div>
                        ))}
                    </div>
                    {momentum.overall && (
                        <div className="momentum-summary">
                            <span>Tổng hợp: <b style={{ color: getMomentumColor(momentum.overall.direction) }}>
                                {momentum.overall.score > 0 ? '+' : ''}{momentum.overall.score}
                            </b></span>
                            <span className="alignment-badge">
                                {momentum.overall.alignment}% aligned
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* ── Z-Score Bar ── */}
            {zScore && zScore.zScore20 !== undefined && (
                <div className="quant-section">
                    <div className="quant-section-title">📏 Mean Reversion Z-Score</div>
                    <div className="zscore-bar-container">
                        <div className="zscore-labels">
                            <span style={{ color: 'var(--accent-green)', fontSize: '0.65rem' }}>Oversold</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>Neutral</span>
                            <span style={{ color: 'var(--accent-red)', fontSize: '0.65rem' }}>Overbought</span>
                        </div>
                        <div className="zscore-track">
                            <div className="zscore-gradient" />
                            <div className="zscore-marker" style={{ left: `${zPosPercent}%` }}>
                                <div className="zscore-dot" />
                                <div className="zscore-value">{zScore.zScore20}</div>
                            </div>
                            <div className="zscore-center" />
                        </div>
                        <div className="zscore-labels-num">
                            <span>-3</span><span>-2</span><span>-1</span><span>0</span><span>+1</span><span>+2</span><span>+3</span>
                        </div>
                    </div>
                    {zScore.reversionProbability > 40 && (
                        <div className="zscore-reversion">
                            Xác suất đảo chiều: <b>{zScore.reversionProbability}%</b>
                        </div>
                    )}
                </div>
            )}

            {/* ── Volatility Regime ── */}
            {volatilityRegime && (
                <div className="quant-section">
                    <div className="quant-row">
                        <span className="quant-label">Volatility Regime</span>
                        <span className="quant-badge" style={{
                            color: getRegimeColor(volatilityRegime.regime),
                            borderColor: getRegimeColor(volatilityRegime.regime),
                            background: `${getRegimeColor(volatilityRegime.regime)}15`
                        }}>
                            {volatilityRegime.regime}
                        </span>
                    </div>
                    <div className="quant-row sub">
                        <span>ATR: {volatilityRegime.atr}</span>
                        <span>Percentile: P{volatilityRegime.avgPercentile}</span>
                    </div>
                </div>
            )}

            {/* ── Win Probability ── */}
            {winProbability && (
                <div className="quant-section">
                    <div className="quant-row">
                        <span className="quant-label">Win Probability</span>
                        <span style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontWeight: 700,
                            color: winProbability.probability >= 60 ? 'var(--accent-green)' :
                                winProbability.probability >= 45 ? 'var(--accent-amber)' : 'var(--accent-red)'
                        }}>
                            {winProbability.probability}%
                        </span>
                    </div>
                    <div className="win-bar-track">
                        <div className="win-bar-fill" style={{
                            width: `${winProbability.probability}%`,
                            background: winProbability.probability >= 60 ?
                                'linear-gradient(90deg, var(--accent-green), var(--accent-cyan))' :
                                winProbability.probability >= 45 ?
                                    'linear-gradient(90deg, var(--accent-amber), var(--accent-orange, #f97316))' :
                                    'linear-gradient(90deg, var(--accent-red), var(--accent-orange, #f97316))'
                        }} />
                    </div>
                </div>
            )}

            {/* ── ROC & Volume Profile ── */}
            <div className="quant-section quant-grid-2">
                {rateOfChange?.periods && (
                    <div className="quant-mini-card">
                        <div className="mini-title">ROC (5p)</div>
                        <div className="mini-value" style={{
                            color: rateOfChange.periods.roc5 > 0 ? 'var(--accent-green)' :
                                rateOfChange.periods.roc5 < 0 ? 'var(--accent-red)' : 'var(--text-muted)'
                        }}>
                            {rateOfChange.periods.roc5 > 0 ? '+' : ''}{rateOfChange.periods.roc5}%
                        </div>
                        <div className="mini-sub">
                            {rateOfChange.accelerating ? '⚡ Tăng tốc' : '🔄 Giảm tốc'}
                        </div>
                    </div>
                )}
                {positionSize && (
                    <div className="quant-mini-card">
                        <div className="mini-title">Position Size</div>
                        <div className="mini-value" style={{ color: 'var(--accent-cyan)' }}>
                            {positionSize.riskPerTrade}%
                        </div>
                        <div className="mini-sub">
                            Kelly: {positionSize.kellyPct}%
                        </div>
                    </div>
                )}
            </div>

            {/* ── Volume Profile ── */}
            {volumeProfile && volumeProfile.poc > 0 && (
                <div className="quant-section">
                    <div className="quant-row">
                        <span className="quant-label">Volume POC</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: 'var(--accent-purple, #a855f7)' }}>
                            {volumeProfile.poc}
                        </span>
                    </div>
                    <div className="quant-row sub">
                        <span>VA: {volumeProfile.valow} – {volumeProfile.vahigh}</span>
                        <span style={{ textTransform: 'capitalize' }}>{volumeProfile.position?.replace(/_/g, ' ')}</span>
                    </div>
                </div>
            )}

            {/* ── Score Breakdown ── */}
            {compositeScore?.breakdown && (
                <div className="quant-section">
                    <div className="quant-section-title" style={{ marginBottom: 6 }}>🧬 Score Breakdown</div>
                    {Object.entries(compositeScore.breakdown).map(([key, val]) => (
                        <div key={key} className="breakdown-row">
                            <span className="breakdown-label">{formatLabel(key)}</span>
                            <div className="breakdown-bar-track">
                                <div className="breakdown-bar-fill" style={{
                                    width: `${val}%`,
                                    background: val >= 60 ? 'var(--accent-green)' :
                                        val >= 40 ? 'var(--accent-amber)' : 'var(--accent-red)'
                                }} />
                            </div>
                            <span className="breakdown-val">{val}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function formatLabel(key) {
    const map = {
        momentum: 'Momentum',
        technical: 'Technical',
        correlation: 'Correlation',
        zScore: 'Z-Score',
        roc: 'ROC',
        volatility: 'Volatility',
        winProbability: 'Win Prob'
    };
    return map[key] || key;
}
