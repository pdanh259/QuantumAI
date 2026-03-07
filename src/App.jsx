import React, { useState, useCallback } from 'react';
import PriceChart from './components/PriceChart';
import SignalPanel from './components/SignalPanel';
import TechnicalIndicators from './components/TechnicalIndicators';
import NewsFeed from './components/NewsFeed';
import SentimentGauge from './components/SentimentGauge';
import EconomicCalendar from './components/EconomicCalendar';
import IntermarketPanel from './components/IntermarketPanel';
import QuantPanel from './components/QuantPanel';

export default function App() {
    const [analyzing, setAnalyzing] = useState(false);
    const [signal, setSignal] = useState(null);
    const [technicalData, setTechnicalData] = useState(null);
    const [marketData, setMarketData] = useState(null);
    const [quantData, setQuantData] = useState(null);
    const [lastUpdate, setLastUpdate] = useState(null);
    const [error, setError] = useState(null);
    const [timeframe, setTimeframe] = useState('1h');

    const handleAnalyze = useCallback(async () => {
        setAnalyzing(true);
        setError(null);
        try {
            const res = await fetch('/api/analyze', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setSignal(data.signal);
                setTechnicalData(data.technicalAnalysis);
                setMarketData(data.marketData);
                setQuantData(data.quantData || null);
                setLastUpdate(new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
            } else {
                setError(data.error || 'Analysis failed');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setAnalyzing(false);
        }
    }, []);

    return (
        <div className="app-container">
            {/* Header */}
            <header className="app-header">
                <div className="app-logo">
                    <div className="logo-icon">⚡</div>
                    <div>
                        <h1>QuantumAI</h1>
                        <p className="subtitle">AI-Powered Forex Trading Dashboard</p>
                    </div>
                </div>
                <div className="header-actions">
                    <div className="header-status">
                        <span className="status-dot"></span>
                        <span>XAU/USD</span>
                        {lastUpdate && <span>• {lastUpdate}</span>}
                    </div>
                    <button
                        className="btn-analyze"
                        onClick={handleAnalyze}
                        disabled={analyzing}
                        id="btn-analyze"
                    >
                        {analyzing ? (
                            <>
                                <span className="spinner"></span>
                                Đang phân tích...
                            </>
                        ) : (
                            <>🤖 Phân tích & Gửi Signal</>
                        )}
                    </button>
                </div>
            </header>

            {/* Error Banner */}
            {error && (
                <div style={{
                    padding: '12px 20px',
                    marginBottom: 20,
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 12,
                    color: '#ef4444',
                    fontSize: '0.85rem'
                }}>
                    ⚠️ {error}
                </div>
            )}

            {/* Dashboard Grid */}
            <div className="dashboard-grid">
                {/* Chart Section */}
                <section className="chart-section">
                    <div className="card animate-in">
                        <div className="card-header">
                            <div className="card-title">
                                <span className="icon">📊</span>
                                XAU/USD Chart
                            </div>
                            <div className="tf-tabs">
                                {['15min', '1h', '4h', '1day'].map(tf => (
                                    <button
                                        key={tf}
                                        className={`tf-tab ${timeframe === tf ? 'active' : ''}`}
                                        onClick={() => setTimeframe(tf)}
                                    >
                                        {tf === '15min' ? 'M15' : tf === '1h' ? 'H1' : tf === '4h' ? 'H4' : 'D1'}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <PriceChart timeframe={timeframe} signal={signal} />
                    </div>
                </section>

                {/* Signal Panel */}
                <section className="signal-section">
                    <SignalPanel signal={signal} analyzing={analyzing} />
                </section>

                {/* Technical Indicators */}
                <section className="indicators-section">
                    <TechnicalIndicators data={technicalData} />
                    <QuantPanel data={quantData} />
                </section>

                {/* Bottom Grid */}
                <div className="bottom-grid">
                    <NewsFeed news={marketData?.news} />
                    <SentimentGauge
                        sentiment={marketData?.sentiment}
                        intermarket={marketData?.intermarket}
                    />
                    <EconomicCalendar calendar={marketData?.calendar} />
                </div>
            </div>
        </div>
    );
}
