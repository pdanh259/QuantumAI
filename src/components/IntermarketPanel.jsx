import React from 'react';

export default function IntermarketPanel({ data }) {
    if (!data || Object.keys(data).length === 0) {
        return (
            <div className="card animate-in animate-delay-4">
                <div className="card-header">
                    <div className="card-title">
                        <span className="icon">🌐</span>
                        Intermarket
                    </div>
                </div>
                <div className="empty-state">
                    <span className="icon">🌐</span>
                    <p className="text">Chạy phân tích để xem dữ liệu liên thị trường</p>
                </div>
            </div>
        );
    }

    return (
        <div className="card animate-in animate-delay-4">
            <div className="card-header">
                <div className="card-title">
                    <span className="icon">🌐</span>
                    Intermarket → Gold Impact
                </div>
            </div>
            <div className="intermarket-grid">
                {Object.entries(data).map(([sym, item]) => {
                    if (!item || item.error) return null;
                    return (
                        <div key={sym} className="intermarket-item">
                            <div className="im-name">{item.name}</div>
                            <div className="im-price">{item.current}</div>
                            <div className={`im-change ${item.changePct > 0 ? 'up' : 'down'}`}>
                                {item.changePct > 0 ? '▲' : '▼'} {Math.abs(item.changePct)}%
                            </div>
                            {item.goldImpact && (
                                <div className="im-impact">{item.goldImpact.reason}</div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
