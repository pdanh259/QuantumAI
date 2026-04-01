import React, { useState, useCallback, useEffect } from 'react';
import PriceChart from './components/PriceChart';
import SignalPanel from './components/SignalPanel';
import TechnicalIndicators from './components/TechnicalIndicators';
import NewsFeed from './components/NewsFeed';
import SentimentGauge from './components/SentimentGauge';
import EconomicCalendar from './components/EconomicCalendar';
import IntermarketPanel from './components/IntermarketPanel';
import QuantPanel from './components/QuantPanel';
import PerformancePanel from './components/PerformancePanel';
import AIEvaluationPanel from './components/AIEvaluationPanel';

const DEFAULT_SYMBOLS = [
    { symbol: 'XAU/USD', name: 'Gold', type: 'commodity', icon: '🥇' },
    { symbol: 'EUR/USD', name: 'Euro/USD', type: 'forex', icon: '💶' },
    { symbol: 'GBP/USD', name: 'Pound/USD', type: 'forex', icon: '💷' },
    { symbol: 'USD/JPY', name: 'USD/Yen', type: 'forex', icon: '💴' },


    { symbol: 'ETH/USD', name: 'Ethereum', type: 'crypto', icon: 'Ξ' },
];

export default function App() {
    const [analyzing, setAnalyzing] = useState(false);
    const [signal, setSignal] = useState(null);
    const [technicalData, setTechnicalData] = useState(null);
    const [marketData, setMarketData] = useState(null);
    const [quantData, setQuantData] = useState(null);
    const [lastUpdate, setLastUpdate] = useState(null);
    const [error, setError] = useState(null);
    const [timeframe, setTimeframe] = useState('1h');
    const [activeSymbol, setActiveSymbol] = useState('XAU/USD');
    const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
    const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);

    // Load supported symbols from backend
    useEffect(() => {
        fetch('/api/symbols')
            .then(r => r.json())
            .then(d => { if (d.success) setSymbols(d.symbols); })
            .catch(() => { });
    }, []);

    // Reset signal when symbol changes (indicators will auto-reload via useEffect)
    const handleSymbolChange = useCallback((sym) => {
        setActiveSymbol(sym);
        setShowSymbolDropdown(false);
        setSignal(null);
        setError(null);
    }, []);

    // ═══════ AUTO-LOAD: Indicators + Market Data on mount & symbol change ═══════
    useEffect(() => {
        let cancelled = false;
        const loadIndicators = async () => {
            try {
                const res = await fetch(`/api/indicators?symbol=${encodeURIComponent(activeSymbol)}`);
                const data = await res.json();
                if (!cancelled && data.success) {
                    setTechnicalData(data.technicalAnalysis);
                    setQuantData(data.quantData || null);
                    setMarketData(prev => ({
                        ...prev,
                        intermarket: data.marketData?.intermarket,
                        sentiment: data.marketData?.sentiment
                    }));
                }
            } catch (err) {
                console.warn('Auto-load indicators failed:', err.message);
            }
        };
        loadIndicators();
        return () => { cancelled = true; };
    }, [activeSymbol]);

    useEffect(() => {
        let cancelled = false;
        const loadMarketData = async () => {
            try {
                const res = await fetch(`/api/market-data?symbol=${encodeURIComponent(activeSymbol)}`);
                const data = await res.json();
                if (!cancelled && data.success) {
                    setMarketData(prev => ({
                        ...prev,
                        news: data.data?.news,
                        calendar: data.data?.calendar,
                        intermarket: prev?.intermarket || data.data?.intermarket,
                        sentiment: prev?.sentiment || data.data?.sentiment
                    }));
                }
            } catch (err) {
                console.warn('Auto-load market data failed:', err.message);
            }
        };
        loadMarketData();
        return () => { cancelled = true; };
    }, [activeSymbol]);

    const handleAnalyze = useCallback(async () => {
        setAnalyzing(true);
        setError(null);
        try {
            const res = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol: activeSymbol })
            });
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
    }, [activeSymbol]);

    const currentSymbolInfo = symbols.find(s => s.symbol === activeSymbol) || symbols[0];

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
                    {/* Symbol Selector */}
                    <div className="symbol-selector" onClick={() => setShowSymbolDropdown(!showSymbolDropdown)}>
                        <span className="symbol-icon">{currentSymbolInfo?.icon}</span>
                        <span className="symbol-name">{activeSymbol}</span>
                        <span className="symbol-arrow">{showSymbolDropdown ? '▲' : '▼'}</span>

                        {showSymbolDropdown && (
                            <div className="symbol-dropdown" onClick={e => e.stopPropagation()}>
                                <div className="symbol-group-label">Commodity</div>
                                {symbols.filter(s => s.type === 'commodity').map(s => (
                                    <div key={s.symbol}
                                        className={`symbol-option ${activeSymbol === s.symbol ? 'active' : ''}`}
                                        onClick={() => handleSymbolChange(s.symbol)}>
                                        <span>{s.icon}</span>
                                        <span>{s.symbol}</span>
                                        <span className="symbol-opt-name">{s.name}</span>
                                    </div>
                                ))}
                                <div className="symbol-group-label">Forex</div>
                                {symbols.filter(s => s.type === 'forex').map(s => (
                                    <div key={s.symbol}
                                        className={`symbol-option ${activeSymbol === s.symbol ? 'active' : ''}`}
                                        onClick={() => handleSymbolChange(s.symbol)}>
                                        <span>{s.icon}</span>
                                        <span>{s.symbol}</span>
                                        <span className="symbol-opt-name">{s.name}</span>
                                    </div>
                                ))}
                                <div className="symbol-group-label">Crypto</div>
                                {symbols.filter(s => s.type === 'crypto').map(s => (
                                    <div key={s.symbol}
                                        className={`symbol-option ${activeSymbol === s.symbol ? 'active' : ''}`}
                                        onClick={() => handleSymbolChange(s.symbol)}>
                                        <span>{s.icon}</span>
                                        <span>{s.symbol}</span>
                                        <span className="symbol-opt-name">{s.name}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="header-status">
                        <span className="status-dot"></span>
                        <span>{activeSymbol}</span>
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

            {/* ═══════ MAIN LAYOUT ═══════ */}

            {/* Row 1: Chart + Signal Panel */}
            <div className="layout-row-1">
                <section className="chart-section">
                    <div className="card animate-in">
                        <div className="card-header">
                            <div className="card-title">
                                <span className="icon">📊</span>
                                {activeSymbol} Chart
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
                        <PriceChart timeframe={timeframe} signal={signal} symbol={activeSymbol} />
                    </div>
                </section>

                <aside className="sidebar-right">
                    <SignalPanel signal={signal} analyzing={analyzing} />
                </aside>
            </div>

            {/* Row 2: Quant Analysis + Technical Indicators */}
            <div className="layout-row-2">
                <section className="quant-section-layout">
                    <QuantPanel data={quantData} />
                </section>
                <section className="indicators-section-layout">
                    <TechnicalIndicators data={technicalData} />
                </section>
            </div>

            {/* Row 3: News + Intermarket/Sentiment + Calendar */}
            <div className="layout-row-3">
                <NewsFeed news={marketData?.news} />
                <div className="market-overview-col">
                    <IntermarketPanel intermarket={marketData?.intermarket} />
                    <SentimentGauge
                        sentiment={marketData?.sentiment}
                        intermarket={marketData?.intermarket}
                    />
                </div>
                <EconomicCalendar calendar={marketData?.calendar} />
            </div>

            {/* Row 4: Performance & Learning + AI Evaluation */}
            <div className="layout-row-4">
                <PerformancePanel />
                <AIEvaluationPanel />
            </div>
        </div>
    );
}



