import React from 'react';

export default function EconomicCalendar({ calendar }) {
    return (
        <div className="card animate-in animate-delay-5">
            <div className="card-header">
                <div className="card-title">
                    <span className="icon">📅</span>
                    Lịch Kinh Tế
                </div>
            </div>

            {!calendar || calendar.length === 0 ? (
                <div className="empty-state">
                    <span className="icon">📅</span>
                    <p className="text">Chạy phân tích để xem lịch kinh tế</p>
                </div>
            ) : (
                <div className="calendar-list">
                    {calendar.map((event, i) => {
                        const eventDate = event.time ? new Date(event.time) : null;
                        const dateStr = eventDate ? eventDate.toLocaleDateString('vi-VN', {
                            day: '2-digit', month: '2-digit'
                        }) : '—';
                        const timeStr = eventDate ? eventDate.toLocaleTimeString('vi-VN', {
                            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh'
                        }) : '';

                        return (
                            <div key={i} className="calendar-item">
                                <div className="cal-date">
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{dateStr}</div>
                                    <div style={{ fontSize: '0.65rem' }}>{timeStr}</div>
                                </div>
                                <div className="cal-event">
                                    <div>{event.event}</div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                        {event.currency}
                                        {event.daysUntil !== undefined && (
                                            <span> • {event.daysUntil <= 0 ? 'Hôm nay' : `Còn ${event.daysUntil} ngày`}</span>
                                        )}
                                    </div>
                                </div>
                                <span className={`cal-impact ${event.impact}`}>
                                    {event.impact}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
