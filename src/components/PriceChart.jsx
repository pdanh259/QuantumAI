import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType } from 'lightweight-charts';

export default function PriceChart({ timeframe, signal }) {
    const chartContainerRef = useRef(null);
    const chartRef = useRef(null);
    const seriesRef = useRef(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        // Create chart
        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#94a3b8',
                fontSize: 12,
                fontFamily: "'Inter', sans-serif",
            },
            grid: {
                vertLines: { color: 'rgba(255,255,255,0.03)' },
                horzLines: { color: 'rgba(255,255,255,0.03)' },
            },
            crosshair: {
                mode: 0,
                vertLine: {
                    color: 'rgba(59,130,246,0.3)',
                    width: 1,
                    style: 2,
                    labelBackgroundColor: '#3b82f6',
                },
                horzLine: {
                    color: 'rgba(59,130,246,0.3)',
                    width: 1,
                    style: 2,
                    labelBackgroundColor: '#3b82f6',
                },
            },
            timeScale: {
                borderColor: 'rgba(255,255,255,0.06)',
                timeVisible: true,
                secondsVisible: false,
            },
            rightPriceScale: {
                borderColor: 'rgba(255,255,255,0.06)',
            },
            width: chartContainerRef.current.clientWidth,
            height: 500,
        });

        const series = chart.addCandlestickSeries({
            upColor: '#10b981',
            downColor: '#ef4444',
            borderDownColor: '#ef4444',
            borderUpColor: '#10b981',
            wickDownColor: '#ef4444',
            wickUpColor: '#10b981',
        });

        chartRef.current = chart;
        seriesRef.current = series;

        // Handle resize
        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []);

    // Fetch data when timeframe changes
    useEffect(() => {
        async function loadData() {
            setLoading(true);
            try {
                const res = await fetch(`/api/prices/${timeframe}`);
                const json = await res.json();
                if (json.success && json.data && seriesRef.current) {
                    const formatted = json.data.map(d => ({
                        time: d.time.includes('T') ? Math.floor(new Date(d.time).getTime() / 1000) :
                            d.time.includes(' ') ? Math.floor(new Date(d.time.replace(' ', 'T')).getTime() / 1000) :
                                Math.floor(new Date(d.time).getTime() / 1000),
                        open: d.open,
                        high: d.high,
                        low: d.low,
                        close: d.close,
                    })).filter(d => !isNaN(d.time)).sort((a, b) => a.time - b.time);

                    // Remove duplicates
                    const unique = formatted.filter((item, index, self) =>
                        index === self.findIndex(t => t.time === item.time)
                    );

                    seriesRef.current.setData(unique);

                    // Add signal markers if available
                    if (signal && signal.action !== 'NO_TRADE' && unique.length > 0) {
                        const lastCandle = unique[unique.length - 1];
                        const markers = [{
                            time: lastCandle.time,
                            position: signal.action === 'BUY' ? 'belowBar' : 'aboveBar',
                            color: signal.action === 'BUY' ? '#10b981' : '#ef4444',
                            shape: signal.action === 'BUY' ? 'arrowUp' : 'arrowDown',
                            text: `${signal.action} @ ${signal.entry}`,
                        }];
                        seriesRef.current.setMarkers(markers);

                        // Add price lines for SL, TP1, TP2
                        if (signal.stopLoss) {
                            seriesRef.current.createPriceLine({
                                price: signal.stopLoss,
                                color: '#ef4444',
                                lineWidth: 1,
                                lineStyle: 2,
                                axisLabelVisible: true,
                                title: 'SL',
                            });
                        }
                        if (signal.tp1) {
                            seriesRef.current.createPriceLine({
                                price: signal.tp1,
                                color: '#10b981',
                                lineWidth: 1,
                                lineStyle: 2,
                                axisLabelVisible: true,
                                title: 'TP1',
                            });
                        }
                        if (signal.tp2) {
                            seriesRef.current.createPriceLine({
                                price: signal.tp2,
                                color: '#06b6d4',
                                lineWidth: 1,
                                lineStyle: 2,
                                axisLabelVisible: true,
                                title: 'TP2',
                            });
                        }
                    }

                    chartRef.current?.timeScale().fitContent();
                }
            } catch (err) {
                console.error('Chart data load error:', err);
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, [timeframe, signal]);

    return (
        <div style={{ position: 'relative' }}>
            {loading && (
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(10,14,26,0.7)', zIndex: 10, borderRadius: 12
                }}>
                    <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }}></div>
                </div>
            )}
            <div ref={chartContainerRef} className="chart-container" />
        </div>
    );
}
