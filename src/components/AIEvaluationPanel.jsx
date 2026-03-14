import React, { useState, useEffect, useCallback } from 'react';

const PERIOD_LABELS = {
    day: { label: 'Ngày', icon: '📅' },
    week: { label: 'Tuần', icon: '📆' },
    month: { label: 'Tháng', icon: '🗓️' },
};

const STATUS_CONFIG = {
    TP2_HIT: { label: 'TP2', color: '#10b981', icon: '🎯' },
    TP1_HIT: { label: 'TP1', color: '#06b6d4', icon: '✅' },
    OPEN: { label: 'Đang mở', color: '#3b82f6', icon: '⏳' },
    EXPIRED: { label: 'Hết hạn', color: '#f59e0b', icon: '⏰' },
    SL_HIT: { label: 'SL', color: '#ef4444', icon: '❌' },
};

const GRADE_COLORS = {
    'A': { bg: 'rgba(16, 185, 129, 0.15)', ring: '#10b981', text: '#10b981' },
    'B': { bg: 'rgba(6, 182, 212, 0.15)', ring: '#06b6d4', text: '#06b6d4' },
    'C': { bg: 'rgba(245, 158, 11, 0.15)', ring: '#f59e0b', text: '#f59e0b' },
    'D': { bg: 'rgba(239, 68, 68, 0.15)', ring: '#ef4444', text: '#ef4444' },
    'F': { bg: 'rgba(239, 68, 68, 0.15)', ring: '#ef4444', text: '#ef4444' },
    '-': { bg: 'rgba(100, 116, 139, 0.15)', ring: '#64748b', text: '#64748b' },
};

export default function AIEvaluationPanel() {
    const [period, setPeriod] = useState('day');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const loadEvaluation = useCallback(async (p) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/performance/evaluation?period=${p}`);
            const json = await res.json();
            if (json.success) setData(json.evaluation);
        } catch (err) {
            console.error('Error loading evaluation:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadEvaluation(period);
        const interval = setInterval(() => loadEvaluation(period), 300000);
        return () => clearInterval(interval);
    }, [period, loadEvaluation]);

    const handlePeriodChange = (p) => {
        setPeriod(p);
    };

    const gradeColor = data?.grade ? (GRADE_COLORS[data.grade.grade] || GRADE_COLORS['-']) : GRADE_COLORS['-'];
    const totalStatusCount = data ? Object.values(data.statusBreakdown || {}).reduce((s, v) => s + v, 0) : 0;

    return (
        <div className="card animate-in eval-panel">
            <div className="card-header">
                <div className="card-title">
                    <span className="icon">🧠</span>
                    Đánh giá năng lực AI
                </div>
                {/* Period Tabs */}
                <div className="eval-period-tabs">
                    {Object.entries(PERIOD_LABELS).map(([key, { label, icon }]) => (
                        <button
                            key={key}
                            className={`eval-period-tab ${period === key ? 'active' : ''}`}
                            onClick={() => handlePeriodChange(key)}
                            id={`eval-tab-${key}`}
                        >
                            <span>{icon}</span> {label}
                        </button>
                    ))}
                </div>
            </div>

            {loading && !data ? (
                <div className="perf-empty">
                    <div className="perf-empty-icon">⏳</div>
                    <p>Đang tải đánh giá...</p>
                </div>
            ) : (
                <div className="eval-content">
                    {/* Top Section: Grade + Metrics */}
                    <div className="eval-top-section">
                        {/* AI Grade Ring */}
                        <div className="eval-grade-container">
                            <div className="eval-grade-ring" style={{
                                '--ring-color': gradeColor.ring,
                                '--ring-progress': `${data?.grade?.score || 0}%`,
                            }}>
                                <svg viewBox="0 0 120 120" className="eval-grade-svg">
                                    <circle cx="60" cy="60" r="52" className="eval-ring-bg" />
                                    <circle cx="60" cy="60" r="52"
                                        className="eval-ring-progress"
                                        style={{
                                            stroke: gradeColor.ring,
                                            strokeDasharray: `${(data?.grade?.score || 0) * 3.267} 326.7`,
                                        }}
                                    />
                                </svg>
                                <div className="eval-grade-inner">
                                    <span className="eval-grade-letter" style={{ color: gradeColor.text }}>
                                        {data?.grade?.grade || '-'}
                                    </span>
                                    <span className="eval-grade-score">{data?.grade?.score || 0}/100</span>
                                </div>
                            </div>
                            <div className="eval-grade-label" style={{ color: gradeColor.text }}>
                                {data?.grade?.label || 'Chưa có dữ liệu'}
                            </div>
                        </div>

                        {/* Key Metrics */}
                        <div className="eval-metrics-grid">
                            <div className="eval-metric">
                                <div className="eval-metric-label">Win Rate</div>
                                <div className="eval-metric-value" style={{
                                    color: (data?.winRate || 0) >= 60 ? '#10b981' : (data?.winRate || 0) >= 45 ? '#f59e0b' : '#ef4444'
                                }}>
                                    {data?.winRate || 0}%
                                </div>
                                {data?.trend && data.trend.winRate !== 0 && (
                                    <div className={`eval-trend ${data.trend.winRate > 0 ? 'up' : 'down'}`}>
                                        {data.trend.winRate > 0 ? '▲' : '▼'} {Math.abs(data.trend.winRate)}%
                                    </div>
                                )}
                            </div>
                            <div className="eval-metric">
                                <div className="eval-metric-label">Tổng lệnh</div>
                                <div className="eval-metric-value">{data?.totalSignals || 0}</div>
                                <div className="eval-metric-sub">
                                    <span style={{ color: '#10b981' }}>{data?.buyCount || 0} B</span>
                                    {' / '}
                                    <span style={{ color: '#ef4444' }}>{data?.sellCount || 0} S</span>
                                </div>
                            </div>
                            <div className="eval-metric">
                                <div className="eval-metric-label">PnL (pips)</div>
                                <div className="eval-metric-value" style={{
                                    color: (data?.totalPnlPips || 0) >= 0 ? '#10b981' : '#ef4444'
                                }}>
                                    {(data?.totalPnlPips || 0) >= 0 ? '+' : ''}{data?.totalPnlPips || 0}
                                </div>
                                {data?.trend && data.trend.totalPnlPips !== 0 && (
                                    <div className={`eval-trend ${data.trend.totalPnlPips > 0 ? 'up' : 'down'}`}>
                                        {data.trend.totalPnlPips > 0 ? '▲' : '▼'} {Math.abs(data.trend.totalPnlPips)}
                                    </div>
                                )}
                            </div>
                            <div className="eval-metric">
                                <div className="eval-metric-label">Confidence TB</div>
                                <div className="eval-metric-value" style={{ color: 'var(--accent-purple)' }}>
                                    {data?.avgConfidence || 0}%
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Status Breakdown */}
                    <div className="eval-status-section">
                        <div className="eval-section-title">Tình trạng lệnh</div>
                        <div className="eval-status-bars">
                            {Object.entries(STATUS_CONFIG).map(([key, config]) => {
                                const count = data?.statusBreakdown?.[key] || 0;
                                const pct = totalStatusCount > 0 ? Math.round((count / totalStatusCount) * 100) : 0;
                                return (
                                    <div key={key} className="eval-status-row">
                                        <div className="eval-status-label">
                                            <span>{config.icon}</span>
                                            <span>{config.label}</span>
                                        </div>
                                        <div className="eval-status-bar-track">
                                            <div
                                                className="eval-status-bar-fill"
                                                style={{
                                                    width: `${pct}%`,
                                                    background: config.color,
                                                }}
                                            />
                                        </div>
                                        <div className="eval-status-count" style={{ color: config.color }}>
                                            {count} <span className="eval-status-pct">({pct}%)</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* AI Commentary */}
                    {data?.commentary && data.commentary.length > 0 && (
                        <div className="eval-commentary-section">
                            <div className="eval-section-title">Nhận xét AI</div>
                            <div className="eval-commentary-list">
                                {data.commentary.map((comment, i) => (
                                    <div key={i} className="eval-commentary-item">{comment}</div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Per-Symbol Performance */}
                    {data?.bySymbol && Object.keys(data.bySymbol).length > 0 && (
                        <div className="eval-symbols-section">
                            <div className="eval-section-title">Hiệu suất theo cặp tiền</div>
                            <div className="eval-symbols-table">
                                <div className="eval-sym-header">
                                    <span>Symbol</span>
                                    <span>Lệnh</span>
                                    <span>Win%</span>
                                    <span>PnL</span>
                                </div>
                                {Object.entries(data.bySymbol).map(([sym, info]) => (
                                    <div key={sym} className="eval-sym-row">
                                        <span className="eval-sym-name">{sym}</span>
                                        <span className="eval-sym-count">{info.total}</span>
                                        <span className="eval-sym-wr" style={{
                                            color: info.winRate >= 55 ? '#10b981' : info.winRate >= 40 ? '#f59e0b' : '#ef4444'
                                        }}>
                                            {info.winRate}%
                                        </span>
                                        <span className="eval-sym-pnl" style={{
                                            color: info.pnl >= 0 ? '#10b981' : '#ef4444'
                                        }}>
                                            {info.pnl >= 0 ? '+' : ''}{info.pnl}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Recent Signals in Period */}
                    {data?.recentSignals && data.recentSignals.length > 0 && (
                        <div className="eval-recent-section">
                            <div className="eval-section-title">Lệnh gần nhất trong kỳ</div>
                            <div className="eval-recent-list">
                                {data.recentSignals.slice(0, 6).map((sig, i) => (
                                    <div key={sig.id || i} className="eval-recent-row">
                                        <span className={`eval-recent-action ${sig.action === 'BUY' ? 'buy' : 'sell'}`}>
                                            {sig.action}
                                        </span>
                                        <span className="eval-recent-symbol">{sig.symbol}</span>
                                        <span className="eval-recent-entry">@ {sig.entry}</span>
                                        <span className={`eval-recent-status ${sig.status === 'OPEN' ? 'open' : sig.outcome === 'WIN' ? 'win' : 'loss'}`}>
                                            {sig.status === 'OPEN' ? '⏳' :
                                                sig.outcome === 'WIN' ? `✅ +${sig.pnlPips}` :
                                                    `❌ ${sig.pnlPips}`}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Previous Period Comparison */}
                    {data?.previousPeriod && data.previousPeriod.totalSignals > 0 && (
                        <div className="eval-prev-section">
                            <div className="eval-section-title">
                                So sánh với {period === 'day' ? 'hôm qua' : period === 'week' ? 'tuần trước' : 'tháng trước'}
                            </div>
                            <div className="eval-prev-grid">
                                <div className="eval-prev-item">
                                    <span className="eval-prev-label">Lệnh</span>
                                    <span>{data.previousPeriod.totalSignals}</span>
                                </div>
                                <div className="eval-prev-item">
                                    <span className="eval-prev-label">Win Rate</span>
                                    <span>{data.previousPeriod.winRate}%</span>
                                </div>
                                <div className="eval-prev-item">
                                    <span className="eval-prev-label">PnL</span>
                                    <span style={{
                                        color: data.previousPeriod.totalPnlPips >= 0 ? '#10b981' : '#ef4444'
                                    }}>
                                        {data.previousPeriod.totalPnlPips >= 0 ? '+' : ''}{data.previousPeriod.totalPnlPips}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
