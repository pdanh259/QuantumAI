import React, { useState, useEffect } from 'react';

export default function PerformancePanel() {
    const [stats, setStats] = useState(null);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadData() {
            setLoading(true);
            try {
                const [perfRes, histRes] = await Promise.all([
                    fetch('/api/performance').then(r => r.json()),
                    fetch('/api/history?limit=20').then(r => r.json())
                ]);
                if (perfRes.success) setStats(perfRes.stats);
                if (histRes.success) setHistory(histRes.history);
            } catch (err) {
                console.error('Error loading performance:', err);
            } finally {
                setLoading(false);
            }
        }
        loadData();
        // Refresh every 5 min
        const interval = setInterval(loadData, 300000);
        return () => clearInterval(interval);
    }, []);

    if (loading || !stats) {
        return (
            <div className="card animate-in">
                <div className="card-header">
                    <div className="card-title">
                        <span className="icon">📈</span>
                        Performance & Learning
                    </div>
                </div>
                <div className="perf-empty">
                    <div className="perf-empty-icon">📊</div>
                    <p>Đang tải dữ liệu hiệu suất...</p>
                </div>
            </div>
        );
    }

    if (stats.totalSignals === 0) {
        return (
            <div className="card animate-in">
                <div className="card-header">
                    <div className="card-title">
                        <span className="icon">📈</span>
                        Performance & Learning
                    </div>
                </div>
                <div className="perf-empty">
                    <div className="perf-empty-icon">🧠</div>
                    <p>Chưa có dữ liệu. Hệ thống sẽ học từ các signal đã tạo.</p>
                    {stats.openSignals > 0 && (
                        <p style={{ color: 'var(--accent-blue)', fontSize: '0.8rem' }}>
                            📌 {stats.openSignals} signal đang mở, chờ kết quả...
                        </p>
                    )}
                </div>
            </div>
        );
    }

    const winRateColor = stats.winRate >= 60 ? '#10b981' : stats.winRate >= 45 ? '#f59e0b' : '#ef4444';

    return (
        <div className="card animate-in">
            <div className="card-header">
                <div className="card-title">
                    <span className="icon">📈</span>
                    Performance & Learning
                </div>
                <div className="perf-badge" style={{
                    background: stats.totalPnlPips >= 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                    color: stats.totalPnlPips >= 0 ? '#10b981' : '#ef4444'
                }}>
                    {stats.totalPnlPips >= 0 ? '+' : ''}{stats.totalPnlPips} pips
                </div>
            </div>

            {/* Summary Stats */}
            <div className="perf-stats-grid">
                <div className="perf-stat">
                    <div className="perf-stat-label">Win Rate</div>
                    <div className="perf-stat-value" style={{ color: winRateColor }}>
                        {stats.winRate}%
                    </div>
                </div>
                <div className="perf-stat">
                    <div className="perf-stat-label">Tổng lệnh</div>
                    <div className="perf-stat-value">{stats.totalSignals}</div>
                </div>
                <div className="perf-stat">
                    <div className="perf-stat-label">Thắng / Thua</div>
                    <div className="perf-stat-value">
                        <span style={{ color: '#10b981' }}>{stats.wins}</span>
                        {' / '}
                        <span style={{ color: '#ef4444' }}>{stats.losses}</span>
                    </div>
                </div>
                <div className="perf-stat">
                    <div className="perf-stat-label">Đang mở</div>
                    <div className="perf-stat-value" style={{ color: 'var(--accent-blue)' }}>
                        {stats.openSignals || 0}
                    </div>
                </div>
            </div>

            {/* Win Rate Bar */}
            <div className="perf-winrate-bar">
                <div className="perf-winrate-fill"
                    style={{
                        width: `${stats.winRate}%`,
                        background: `linear-gradient(90deg, ${winRateColor}, ${winRateColor}88)`
                    }}
                />
            </div>

            {/* Per Symbol Performance */}
            {Object.keys(stats.bySymbol).length > 0 && (
                <div className="perf-symbols">
                    <div className="perf-section-title">Hiệu suất theo cặp tiền</div>
                    {Object.entries(stats.bySymbol).map(([sym, data]) => (
                        <div key={sym} className="perf-symbol-row">
                            <span className="perf-sym-name">{sym}</span>
                            <span className="perf-sym-trades">{data.total} lệnh</span>
                            <span className="perf-sym-winrate" style={{
                                color: data.winRate >= 55 ? '#10b981' : data.winRate >= 40 ? '#f59e0b' : '#ef4444'
                            }}>
                                {data.winRate}%
                            </span>
                            <span className="perf-sym-pnl" style={{
                                color: data.totalPnl >= 0 ? '#10b981' : '#ef4444'
                            }}>
                                {data.totalPnl >= 0 ? '+' : ''}{data.totalPnl}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* Recent Trade History */}
            {history.length > 0 && (
                <div className="perf-history">
                    <div className="perf-section-title">Lịch sử gần nhất</div>
                    {history.slice(0, 8).map((trade, i) => (
                        <div key={trade.id || i} className="perf-trade-row">
                            <span className={`perf-trade-action ${trade.action === 'BUY' ? 'buy' : 'sell'}`}>
                                {trade.action}
                            </span>
                            <span className="perf-trade-symbol">{trade.symbol}</span>
                            <span className="perf-trade-entry">@ {trade.entry}</span>
                            <span className={`perf-trade-status ${trade.status === 'OPEN' ? 'open' : trade.outcome === 'WIN' ? 'win' : 'loss'}`}>
                                {trade.status === 'OPEN' ? '⏳ OPEN' :
                                    trade.outcome === 'WIN' ? `✅ +${trade.pnlPips}` :
                                        `❌ ${trade.pnlPips}`}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
