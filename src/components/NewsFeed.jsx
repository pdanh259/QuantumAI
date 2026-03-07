import React from 'react';

export default function NewsFeed({ news }) {
    return (
        <div className="card animate-in animate-delay-3">
            <div className="card-header">
                <div className="card-title">
                    <span className="icon">📰</span>
                    Tin tức Forex
                </div>
                {news && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{news.length} tin</span>}
            </div>

            {!news || news.length === 0 ? (
                <div className="empty-state">
                    <span className="icon">📰</span>
                    <p className="text">Chạy phân tích để xem tin tức</p>
                </div>
            ) : (
                <div className="news-list">
                    {news.map((item, i) => (
                        <a
                            key={i}
                            className="news-item"
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ textDecoration: 'none' }}
                        >
                            <div className="news-title">{item.title}</div>
                            <div className="news-meta">
                                <span className={`news-impact ${item.impact || 'low'}`}>
                                    {item.impact || 'low'}
                                </span>
                                <span className={`news-sentiment ${item.sentiment || 'neutral'}`}>
                                    {item.sentiment === 'bullish' ? '🟢 Bullish' :
                                        item.sentiment === 'bearish' ? '🔴 Bearish' : '⚪ Neutral'}
                                </span>
                                <span>{item.source}</span>
                                {item.publishedAt && (
                                    <span>{getTimeAgo(item.publishedAt)}</span>
                                )}
                            </div>
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
}

function getTimeAgo(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const diff = Math.floor((now - date) / 1000 / 60);
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return `${Math.floor(diff / 1440)}d ago`;
}
