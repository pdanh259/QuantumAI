import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generate AI trading signal using Gemini Pro
 * Aggregates all data sources and uses structured prompt engineering
 */
export async function generateSignal({ symbol, marketData, technicalData, quantData, news, calendar, intermarket, sentiment }) {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const currentPrice = marketData.pricesH1.length > 0 ?
            marketData.pricesH1[marketData.pricesH1.length - 1].close : 0;

        const prompt = buildAnalysisPrompt({
            symbol, currentPrice, technicalData, quantData, news, calendar, intermarket, sentiment
        });

        console.log('📤 Sending prompt to Gemini...');

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log('📥 Gemini response received');

        // Parse AI response into structured signal
        const signal = parseAIResponse(text, symbol, currentPrice);

        return signal;
    } catch (error) {
        console.error('AI Engine error:', error.message);

        // Fallback: generate signal from technical analysis alone
        return generateFallbackSignal(symbol, technicalData, marketData, quantData);
    }
}

/**
 * Build comprehensive analysis prompt for Gemini
 */
function buildAnalysisPrompt({ symbol, currentPrice, technicalData, quantData, news, calendar, intermarket, sentiment }) {
    let prompt = `Bạn là một chuyên gia phân tích Forex chuyên nghiệp. Hãy phân tích dữ liệu sau và đưa ra đề xuất giao dịch.

⚠️ QUAN TRỌNG: Trả lời ĐÚNG THEO FORMAT JSON bên dưới, KHÔNG thêm markdown code block.

📊 THÔNG TIN THỊ TRƯỜNG:
- Cặp tiền: ${symbol}
- Giá hiện tại: ${currentPrice}
- Thời gian phân tích: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}

`;

    // Add Technical Analysis data
    if (technicalData) {
        prompt += `📈 PHÂN TÍCH KỸ THUẬT:\n`;
        for (const [tf, data] of Object.entries(technicalData)) {
            if (data && !data.error) {
                prompt += `\n--- Timeframe ${tf} ---\n`;
                prompt += `Xu hướng (Bias): ${data.bias?.summary || 'N/A'}\n`;

                if (data.trend) {
                    prompt += `EMA 20: ${data.trend.ema20}, EMA 50: ${data.trend.ema50}, EMA 200: ${data.trend.ema200 || 'N/A'}\n`;
                    prompt += `EMA Alignment: ${data.trend.emaAlignment}\n`;
                    if (data.trend.macd) {
                        prompt += `MACD: ${data.trend.macd.macd}, Signal: ${data.trend.macd.signal}, Histogram: ${data.trend.macd.histogram}, Crossover: ${data.trend.macd.crossover}\n`;
                    }
                    if (data.trend.adx) {
                        prompt += `ADX: ${data.trend.adx.adx}, +DI: ${data.trend.adx.pdi}, -DI: ${data.trend.adx.mdi}, Trend Strength: ${data.trend.adx.trendStrength}\n`;
                    }
                }

                if (data.momentum) {
                    prompt += `RSI(14): ${data.momentum.rsi?.value} (${data.momentum.rsi?.condition})\n`;
                    if (data.momentum.stochastic) {
                        prompt += `Stochastic: K=${data.momentum.stochastic.k}, D=${data.momentum.stochastic.d} (${data.momentum.stochastic.condition})\n`;
                    }
                    prompt += `CCI(20): ${data.momentum.cci?.value} (${data.momentum.cci?.condition})\n`;
                }

                if (data.volatility) {
                    prompt += `ATR(14): ${data.volatility.atr}, Volatility: ${data.volatility.volatilityLevel}\n`;
                    if (data.volatility.bollingerBands) {
                        prompt += `Bollinger: Upper=${data.volatility.bollingerBands.upper}, Mid=${data.volatility.bollingerBands.middle}, Lower=${data.volatility.bollingerBands.lower}, Position: ${data.volatility.bollingerBands.position}\n`;
                    }
                }

                if (data.supportResistance) {
                    prompt += `Support: ${data.supportResistance.support?.join(', ')}\n`;
                    prompt += `Resistance: ${data.supportResistance.resistance?.join(', ')}\n`;
                }

                if (data.candlePatterns && data.candlePatterns.length > 0) {
                    prompt += `Candlestick Patterns: ${data.candlePatterns.map(p => `${p.name} (${p.direction})`).join(', ')}\n`;
                }
            }
        }
    }

    // Add News data
    if (news && news.length > 0) {
        prompt += `\n📰 TIN TỨC GẦN ĐÂY:\n`;
        news.slice(0, 8).forEach((n, i) => {
            prompt += `${i + 1}. [${n.impact?.toUpperCase() || 'LOW'}] ${n.title} (Sentiment: ${n.sentiment})\n`;
        });
    }

    // Add Economic Calendar
    if (calendar && calendar.length > 0) {
        prompt += `\n📅 LỊCH KINH TẾ SẮP TỚI:\n`;
        calendar.slice(0, 5).forEach(e => {
            prompt += `- ${e.event} (${e.currency}, Impact: ${e.impact}, Còn ${e.daysUntil || '?'} ngày)\n`;
        });
    }

    // Add Intermarket data
    if (intermarket && Object.keys(intermarket).length > 0) {
        prompt += `\n🌐 DỮ LIỆU LIÊN THỊ TRƯỜNG:\n`;
        for (const [sym, data] of Object.entries(intermarket)) {
            if (data && !data.error) {
                prompt += `- ${data.name} (${sym}): ${data.current} (${data.changePct > 0 ? '+' : ''}${data.changePct}%) → Tác động vàng: ${data.goldImpact?.reason || 'N/A'}\n`;
            }
        }
    }

    // Add Sentiment data
    if (sentiment) {
        prompt += `\n💭 TÂM LÝ THỊ TRƯỜNG:\n`;
        prompt += `Fear & Greed Index: ${sentiment.fearGreedIndex?.value || 'N/A'} (${sentiment.fearGreedIndex?.label || 'N/A'})\n`;
        prompt += `Overall Sentiment: ${sentiment.overallSentiment || 'N/A'}\n`;
    }

    // Add Quant Analysis data
    if (quantData && !quantData.error) {
        prompt += `\n📐 PHÂN TÍCH QUANT:\n`;
        if (quantData.compositeScore) {
            prompt += `Composite Score: ${quantData.compositeScore.score}/100 → ${quantData.compositeScore.signal}\n`;
            if (quantData.compositeScore.breakdown) {
                const b = quantData.compositeScore.breakdown;
                prompt += `  Breakdown: Momentum=${b.momentum}, Technical=${b.technical}, Correlation=${b.correlation}, Z-Score=${b.zScore}, ROC=${b.roc}, Volatility=${b.volatility}, WinProb=${b.winProbability}\n`;
            }
        }
        if (quantData.momentum?.overall) {
            prompt += `Multi-TF Momentum: ${quantData.momentum.overall.score} (${quantData.momentum.overall.direction}, ${quantData.momentum.overall.alignment}% aligned)\n`;
        }
        if (quantData.volatilityRegime) {
            prompt += `Volatility Regime: ${quantData.volatilityRegime.regime} (ATR percentile: P${quantData.volatilityRegime.avgPercentile})\n`;
        }
        if (quantData.zScore) {
            prompt += `Mean Reversion Z-Score: ${quantData.zScore.zScore20} (${quantData.zScore.condition}) – Reversion Prob: ${quantData.zScore.reversionProbability}%\n`;
        }
        if (quantData.rateOfChange?.periods) {
            prompt += `ROC: 5p=${quantData.rateOfChange.periods.roc5}%, 10p=${quantData.rateOfChange.periods.roc10}%, Acceleration: ${quantData.rateOfChange.acceleration}\n`;
        }
        if (quantData.volumeProfile) {
            prompt += `Volume POC: ${quantData.volumeProfile.poc}, Value Area: ${quantData.volumeProfile.valow}-${quantData.volumeProfile.vahigh}, Position: ${quantData.volumeProfile.position}\n`;
        }
        if (quantData.correlation) {
            prompt += `Intermarket Correlation: ${quantData.correlation.overall} (Score: ${quantData.correlation.score})\n`;
        }
        if (quantData.winProbability) {
            prompt += `Win Probability: ${quantData.winProbability.probability}% (${quantData.winProbability.confidence})\n`;
        }
        if (quantData.positionSize) {
            prompt += `Suggested Risk: ${quantData.positionSize.riskPerTrade}% | Kelly: ${quantData.positionSize.kellyPct}%\n`;
        }
    }

    // Response format instruction
    prompt += `
🎯 YÊU CẦU: Phân tích tất cả dữ liệu trên và trả lời CHÍNH XÁC theo JSON format sau (KHÔNG có markdown code block, KHÔNG có backtick):

{
  "action": "BUY hoặc SELL hoặc NO_TRADE",
  "entry": giá_entry_số,
  "stopLoss": giá_stop_loss_số,
  "tp1": giá_take_profit_1_số,
  "tp2": giá_take_profit_2_số,
  "confidence": số_từ_0_đến_100,
  "riskReward": "tỷ_lệ_ví_dụ_1.5",
  "reasons": [
    "Lý do 1 bằng tiếng Việt",
    "Lý do 2 bằng tiếng Việt",
    "Lý do 3 bằng tiếng Việt",
    "Lý do 4 bằng tiếng Việt"
  ],
  "warnings": [
    "Cảnh báo 1 bằng tiếng Việt",
    "Cảnh báo 2 nếu có"
  ],
  "marketCondition": "TRENDING hoặc RANGING hoặc VOLATILE",
  "timeframeAlignment": "mô tả ngắn sự đồng thuận giữa các timeframe"
}

Quy tắc:
1. Stop Loss phải dựa trên ATR hoặc Support/Resistance gần nhất
2. TP1 ít nhất R:R 1:1, TP2 ít nhất R:R 1:2  
3. Nếu các timeframe mâu thuẫn nhau hoặc không rõ ràng, chọn NO_TRADE
4. Confidence < 60% → nên chọn NO_TRADE
5. Entry price nên là giá hiện tại hoặc giá limit gần S/R
6. Trả lời bằng Tiếng Việt cho reasons và warnings
7. CHỈ trả về JSON, KHÔNG có text giải thích bên ngoài
`;

    return prompt;
}

/**
 * Parse AI response text into structured signal object
 */
function parseAIResponse(text, symbol, currentPrice) {
    try {
        // Remove markdown code blocks if present
        let cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        // Try to find JSON in the response
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('No JSON found in AI response');
            return createNoTradeSignal(symbol, 'AI không trả về JSON hợp lệ');
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // Calculate pips (for gold, 1 pip = 0.1)
        const pipSize = 0.1;
        const entry = parsed.entry || currentPrice;

        return {
            symbol,
            action: parsed.action || 'NO_TRADE',
            entry: round(entry),
            stopLoss: round(parsed.stopLoss),
            tp1: round(parsed.tp1),
            tp2: round(parsed.tp2),
            slPips: parsed.stopLoss ? round(Math.abs(entry - parsed.stopLoss) / pipSize) : null,
            tp1Pips: parsed.tp1 ? round(Math.abs(parsed.tp1 - entry) / pipSize) : null,
            tp2Pips: parsed.tp2 ? round(Math.abs(parsed.tp2 - entry) / pipSize) : null,
            confidence: parsed.confidence || 0,
            riskReward: parsed.riskReward || 'N/A',
            reasons: parsed.reasons || [],
            warnings: parsed.warnings || [],
            marketCondition: parsed.marketCondition || 'UNKNOWN',
            timeframeAlignment: parsed.timeframeAlignment || '',
            reasoning: (parsed.reasons || []).join('; '),
            timestamp: new Date().toISOString(),
            source: 'gemini-pro'
        };
    } catch (error) {
        console.error('Error parsing AI response:', error.message);
        console.error('Raw response:', text.substring(0, 500));
        return createNoTradeSignal(symbol, 'Lỗi phân tích phản hồi AI');
    }
}

function createNoTradeSignal(symbol, reason) {
    return {
        symbol,
        action: 'NO_TRADE',
        entry: null,
        stopLoss: null,
        tp1: null,
        tp2: null,
        confidence: 0,
        riskReward: 'N/A',
        reasons: [reason],
        warnings: [],
        marketCondition: 'UNKNOWN',
        timestamp: new Date().toISOString(),
        source: 'fallback'
    };
}

/**
 * Fallback signal generation from technical data when AI is unavailable
 */
function generateFallbackSignal(symbol, technicalData, marketData, quantData) {
    console.log('⚠️ Using fallback signal generation (no AI)');

    const h1 = technicalData?.H1;
    if (!h1 || h1.error) {
        return createNoTradeSignal(symbol, 'Không đủ dữ liệu kỹ thuật');
    }

    const currentPrice = h1.currentPrice;
    const atr = h1.volatility?.atr || 10;
    const bias = h1.bias;

    if (!bias || bias.direction === 'SIDEWAYS') {
        return createNoTradeSignal(symbol, 'Thị trường đi ngang, không có tín hiệu rõ ràng');
    }

    const isBuy = bias.direction.includes('BULLISH');
    const entry = currentPrice;
    const sl = isBuy ? round(entry - atr * 1.5) : round(entry + atr * 1.5);
    const tp1 = isBuy ? round(entry + atr * 1.5) : round(entry - atr * 1.5);
    const tp2 = isBuy ? round(entry + atr * 3) : round(entry - atr * 3);

    const confidence = Math.min(90, Math.max(30,
        bias.bullishPct > 65 || bias.bullishPct < 35 ? 65 : 45
    ));

    // Use quant composite score if available
    const quantScore = quantData?.compositeScore?.score || null;
    const quantSignal = quantData?.compositeScore?.signal || null;

    // Override direction if quant strongly disagrees
    let finalAction = isBuy ? 'BUY' : 'SELL';
    let finalConfidence = confidence;
    if (quantScore !== null) {
        // Boost confidence if quant agrees
        if ((isBuy && quantScore >= 55) || (!isBuy && quantScore <= 45)) {
            finalConfidence = Math.min(85, confidence + 10);
        }
        // Reduce confidence if quant disagrees
        if ((isBuy && quantScore <= 40) || (!isBuy && quantScore >= 60)) {
            finalConfidence = Math.max(30, confidence - 15);
        }
    }

    return {
        symbol,
        action: finalAction,
        entry: round(entry),
        stopLoss: round(sl),
        tp1: round(tp1),
        tp2: round(tp2),
        slPips: round(Math.abs(entry - sl) / 0.1),
        tp1Pips: round(Math.abs(tp1 - entry) / 0.1),
        tp2Pips: round(Math.abs(tp2 - entry) / 0.1),
        confidence: finalConfidence,
        riskReward: '1:2',
        reasons: [
            `Bias ${h1.timeframe}: ${bias.summary}`,
            `RSI(14): ${h1.momentum?.rsi?.value} (${h1.momentum?.rsi?.condition})`,
            `EMA Alignment: ${h1.trend?.emaAlignment}`,
            `SL/TP dựa trên ATR(14): ${atr}`,
            quantScore !== null ? `Quant Score: ${quantScore}/100 → ${quantSignal}` : null,
            quantData?.winProbability ? `Win Probability: ${quantData.winProbability.probability}%` : null
        ].filter(Boolean),
        warnings: [
            'Signal từ fallback engine (không có AI)',
            'Cần xác nhận thêm trước khi vào lệnh',
            quantData?.volatilityRegime?.regime === 'EXTREME' ? 'Volatility cực cao — giảm khối lượng' : null
        ].filter(Boolean),
        marketCondition: bias.trendStrong ? 'TRENDING' : 'RANGING',
        timestamp: new Date().toISOString(),
        source: 'fallback'
    };
}

function round(val) {
    if (val === null || val === undefined) return null;
    return Math.round(val * 100) / 100;
}
