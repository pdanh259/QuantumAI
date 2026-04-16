import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { generateLearningContext } from '../services/signalHistory.js';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ===== AI CALL CACHE (prevent quota exhaustion) =====
// Cache AI results per symbol for AI_CACHE_MINUTES minutes
// Default: 15 minutes → scan mỗi 15 phút, signal luôn được generate mới
const AI_CACHE_MINUTES = parseInt(process.env.AI_CACHE_MINUTES || '15', 10);
const aiCache = {}; // { symbol: { signal, timestamp } }

function getCachedSignal(symbol) {
    const entry = aiCache[symbol];
    if (!entry) return null;
    const ageMs = Date.now() - entry.timestamp;
    if (ageMs < AI_CACHE_MINUTES * 60 * 1000) {
        console.log(`💾 [AI Cache] ${symbol} → Using cached AI signal (age: ${Math.round(ageMs / 60000)}m / ${AI_CACHE_MINUTES}m TTL)`);
        return entry.signal;
    }
    return null; // cache expired
}

function setCachedSignal(symbol, signal) {
    aiCache[symbol] = { signal, timestamp: Date.now() };
    console.log(`💾 [AI Cache] ${symbol} → Signal cached for ${AI_CACHE_MINUTES} minutes`);
}


/**
 * Generate AI trading signal using Gemini Pro
 * Aggregates all data sources and uses structured prompt engineering
 */
export async function generateSignal({ symbol, marketData, technicalData, quantData, news, calendar, intermarket, sentiment }) {
    // ---- Check AI cache first ----
    const cached = getCachedSignal(symbol);
    if (cached) return cached;

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const currentPrice = marketData.pricesH1.length > 0 ?
            marketData.pricesH1[marketData.pricesH1.length - 1].close : 0;

        const prompt = buildAnalysisPrompt({
            symbol, currentPrice, technicalData, quantData, news, calendar, intermarket, sentiment
        });

        // Append learning context from past performance
        const learningCtx = generateLearningContext();
        const fullPrompt = learningCtx ? prompt + learningCtx : prompt;

        console.log('📤 Sending prompt to Gemini...');

        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text();

        console.log('📥 Gemini response received');

        // Parse AI response into structured signal
        const signal = parseAIResponse(text, symbol, currentPrice);

        // Cache successful AI result
        setCachedSignal(symbol, signal);

        return signal;
    } catch (error) {
        console.error('❌ AI Engine error:', error.message);
        if (error.status) console.error('   HTTP Status:', error.status);
        if (error.errorDetails) console.error('   Error Details:', JSON.stringify(error.errorDetails));

        // Xác định lý do lỗi cụ thể
        let reason;
        if (error.message?.includes('quota') || error.message?.includes('429')) {
            console.error('   ⚠️ QUOTA EXCEEDED: Gemini API quota đã hết!');
            reason = '⚠️ Gemini API quota đã hết – Không vào lệnh để đảm bảo an toàn';
        } else if (error.message?.includes('API_KEY') || error.message?.includes('401') || error.message?.includes('403')) {
            console.error('   ⚠️ API KEY ERROR: Kiểm tra lại GEMINI_API_KEY!');
            reason = '⚠️ Lỗi API Key Gemini – Kiểm tra lại GEMINI_API_KEY';
        } else if (error.message?.includes('not found') || error.message?.includes('404')) {
            console.error('   ⚠️ MODEL NOT FOUND: Model name không đúng!');
            reason = '⚠️ Model Gemini không tìm thấy – Kiểm tra lại model name';
        } else {
            reason = `⚠️ AI lỗi: ${error.message} – Không vào lệnh`;
        }

        // Không vào lệnh khi không có AI
        return createNoTradeSignal(symbol, reason);
    }
}

/**
 * Build comprehensive analysis prompt for Gemini
 */
function buildAnalysisPrompt({ symbol, currentPrice, technicalData, quantData, news, calendar, intermarket, sentiment }) {
    let prompt = `Bạn là một chuyên gia phân tích Forex chuyên nghiệp, chuyên giao dịch INTRADAY.

⚠️ QUAN TRỌNG: Trả lời ĐÚNG THEO FORMAT JSON bên dưới, KHÔNG thêm markdown code block.

🎯 CHIẾN LƯỢC INTRADAY:
- H4 xác định xu hướng chính trong ngày (BẮT BUỘC)
- H1 xác nhận điểm vào lệnh cụ thể (BẮT BUỘC)
- D1 chỉ là context tổng quan (KHÔNG bắt buộc đồng thuận)
- Nếu H4 và H1 đồng thuận → vào lệnh, D1 ngược chỉ làm giảm confidence
- Ưu tiên phiên London (14:00-20:00 VN) và NY (20:00-02:00 VN) cho XAU/USD

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
2. TP1 tối thiểu R:R 1:1.33 (SL × 1.33), TP2 tối thiểu R:R 1:2.67 (SL × 2.67)
   Ví dụ: SL=15 pip → TP1 ≥ 20 pip, TP2 ≥ 40 pip
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
        let stopLoss = parsed.stopLoss;
        let tp1 = parsed.tp1;
        let tp2 = parsed.tp2;

        // Post-processing: Correct skewed SL/TP logic
        if (entry && stopLoss && tp1 && (parsed.action === 'BUY' || parsed.action === 'SELL')) {
            const isBuy = parsed.action === 'BUY';
            const isSell = parsed.action === 'SELL';
            const slDistance = Math.abs(entry - stopLoss);
            const tp1Distance = Math.abs(tp1 - entry);
            const tp2Distance = tp2 ? Math.abs(tp2 - entry) : tp1Distance * 2;
            
            // PA1: SL ≤ TP1/1.33 và SL ≤ TP2/2.67
            // Đảm bảo Gemini không đặt SL quá rộng so với mục tiêu
            const maxSlDistance = Math.min(tp1Distance / 1.33, tp2Distance / 2.67);
            
            if (slDistance > maxSlDistance && maxSlDistance > 0) {
                if (isBuy) {
                    stopLoss = entry - maxSlDistance;
                } else if (isSell) {
                    stopLoss = entry + maxSlDistance;
                }
                const warningMsg = `Auto-adjusted SL from ${parsed.stopLoss} to ${round(stopLoss)} to enforce R:R 1:1.33 (TP1) and 1:2.67 (TP2)`;
                console.log(`⚠️ ${symbol}: ${warningMsg}`);
                
                // Add to warnings
                if (!parsed.warnings) parsed.warnings = [];
                parsed.warnings.push(warningMsg);
            }
        }

        return {
            symbol,
            action: parsed.action || 'NO_TRADE',
            entry: round(entry),
            stopLoss: round(stopLoss),
            tp1: round(tp1),
            tp2: round(tp2),
            slPips: stopLoss ? round(Math.abs(entry - stopLoss) / pipSize) : null,
            tp1Pips: tp1 ? round(Math.abs(tp1 - entry) / pipSize) : null,
            tp2Pips: tp2 ? round(Math.abs(tp2 - entry) / pipSize) : null,
            confidence: parsed.confidence || 0,
            riskReward: parsed.riskReward || 'N/A',
            reasons: parsed.reasons || [],
            warnings: parsed.warnings || [],
            marketCondition: parsed.marketCondition || 'UNKNOWN',
            timeframeAlignment: parsed.timeframeAlignment || '',
            reasoning: (parsed.reasons || []).join('; '),
            timestamp: new Date().toISOString(),
            source: 'gemini-2.0-flash'
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
 * Fallback signal generation with Multi-Timeframe Confirmation
 * Requires at least 2/3 timeframes (H1, H4, D1) to agree on direction
 */
function generateFallbackSignal(symbol, technicalData, marketData, quantData) {
    console.log('⚠️ Using fallback signal generation (no AI)');

    const h1 = technicalData?.H1;
    if (!h1 || h1.error) {
        return createNoTradeSignal(symbol, 'Không đủ dữ liệu kỹ thuật');
    }

    const currentPrice = h1.currentPrice;
    if (!currentPrice || currentPrice <= 0) {
        return createNoTradeSignal(symbol, 'Giá không hợp lệ');
    }

    // Symbol-aware pip size and decimal places
    const symbolConfig = getSymbolConfig(symbol, currentPrice);
    const pipSize = symbolConfig.pipSize;
    const decimals = symbolConfig.decimals;

    // ATR: use actual computed value, fallback to % of price
    let atr = h1.volatility?.atr;
    if (!atr || atr <= 0) {
        atr = currentPrice * 0.002;
    }

    // ========== HARD NEWS FILTER ==========
    if (marketData.calendar && marketData.calendar.length > 0) {
        const now = new Date();
        const upcomingHighImpact = marketData.calendar.find(e => {
            if (e.impact === 'high') {
                const eventTime = new Date(e.time);
                const diffMins = Math.abs(eventTime - now) / (1000 * 60);
                return diffMins <= 30; // within 30 mins
            }
            return false;
        });

        if (upcomingHighImpact) {
            return createNoTradeSignal(symbol, 
                `Bảo vệ tài khoản: Tạm dừng do có tin tức Đỏ (${upcomingHighImpact.event}) trong vòng 30 phút`
            );
        }
    }

    // ========== MULTI-TIMEFRAME CONFIRMATION (INTRADAY MODE) ==========
    // INTRADAY: H4 + H1 phải đồng thuận (bắt buộc), D1 là context filter
    const mtf = analyzeMultiTimeframe(technicalData);

    if (!mtf.h4h1Agreement) {
        return createNoTradeSignal(symbol,
            `H4+H1 không đồng thuận: H1=${mtf.h1Dir}, H4=${mtf.h4Dir}, D1=${mtf.d1Dir} (context)`
        );
    }

    // H4 hoặc H1 sideways → không vào
    if (mtf.h4Dir === 'SIDE' || mtf.h1Dir === 'SIDE') {
        return createNoTradeSignal(symbol,
            `Không có xu hướng rõ: H1=${mtf.h1Dir}, H4=${mtf.h4Dir}`
        );
    }

    const techBullish = mtf.direction === 'BULLISH';
    let mtfConfidence = mtf.confidence;

    // ========== QUANT VALIDATION ==========
    const quantScore = quantData?.compositeScore?.score || null;
    const quantSignal = quantData?.compositeScore?.signal || null;
    
    // QUANT VETO: Reject if score is too low
    if (quantScore !== null && quantScore < 45) {
        return createNoTradeSignal(symbol,
            `Quant Score quá yếu (${quantScore}/100) - Rủi ro nhiễu cao`
        );
    }

    let finalAction;
    let confidence;

    if (quantScore !== null) {
        const quantBullish = quantScore >= 55;
        const quantBearish = quantScore <= 45;
        const quantStrongBuy = quantScore >= 65;
        const quantStrongSell = quantScore <= 35;
        const quantNeutral = quantScore > 45 && quantScore < 55;

        if (techBullish && quantBullish) {
            finalAction = 'BUY';
            confidence = mtfConfidence + (quantStrongBuy ? 10 : 5);
        } else if (!techBullish && quantBearish) {
            finalAction = 'SELL';
            confidence = mtfConfidence + (quantStrongSell ? 10 : 5);
        } else if (quantNeutral) {
            return createNoTradeSignal(symbol,
                `Quant NEUTRAL (${quantScore}/100), MTF=${mtf.direction}`
            );
        } else if (techBullish && quantStrongSell) {
            return createNoTradeSignal(symbol,
                `MTF BUY vs Quant STRONG_SELL (${quantScore}/100)`
            );
        } else if (!techBullish && quantStrongBuy) {
            return createNoTradeSignal(symbol,
                `MTF SELL vs Quant STRONG_BUY (${quantScore}/100)`
            );
        } else {
            finalAction = techBullish ? 'BUY' : 'SELL';
            confidence = mtfConfidence - 10;
        }
    } else {
        finalAction = techBullish ? 'BUY' : 'SELL';
        confidence = mtfConfidence - 5;
    }

    confidence = Math.min(90, Math.max(35, confidence));

    if (confidence < 50) {
        return createNoTradeSignal(symbol, `Confidence thấp (${confidence}%)`);
    }

    const isBuy = finalAction === 'BUY';
    const entry = currentPrice;
    // Phương án 1: SL=1.5×ATR | TP1=2.0×ATR (R:R 1:1.33) | TP2=4.0×ATR (R:R 1:2.67)
    const sl  = isBuy ? roundTo(entry - atr * 1.5, decimals) : roundTo(entry + atr * 1.5, decimals);
    const tp1 = isBuy ? roundTo(entry + atr * 2.0, decimals) : roundTo(entry - atr * 2.0, decimals);
    const tp2 = isBuy ? roundTo(entry + atr * 4.0, decimals) : roundTo(entry - atr * 4.0, decimals);

    const slPips = roundTo(Math.abs(entry - sl) / pipSize, 1);
    const tp1Pips = roundTo(Math.abs(tp1 - entry) / pipSize, 1);
    const tp2Pips = roundTo(Math.abs(tp2 - entry) / pipSize, 1);

    return {
        symbol,
        action: finalAction,
        entry: roundTo(entry, decimals),
        stopLoss: roundTo(sl, decimals),
        tp1: roundTo(tp1, decimals),
        tp2: roundTo(tp2, decimals),
        slPips, tp1Pips, tp2Pips,
        confidence,
        riskReward: '1:2',
        reasons: [
            `MTF: H4=${mtf.h4Dir} | H1=${mtf.h1Dir} | D1=${mtf.d1Dir} [context:${mtf.d1Alignment}]`,
            `Bias H1: ${h1.bias?.summary || 'N/A'}`,
            `RSI(14): ${h1.momentum?.rsi?.value} (${h1.momentum?.rsi?.condition})`,
            `EMA: ${h1.trend?.emaAlignment}`,
            `ATR(14): ${roundTo(atr, decimals)}`,
            quantScore !== null ? `Quant: ${quantScore}/100 → ${quantSignal}` : null,
            quantData?.winProbability ? `Win Prob: ${quantData.winProbability.probability}%` : null
        ].filter(Boolean),
        warnings: [
            'Fallback engine (no AI)',
            mtf.agreement < 3 ? `Chỉ ${mtf.agreement}/3 TF đồng thuận` : null,
            quantData?.volatilityRegime?.regime === 'EXTREME' ? 'Volatility cực cao' : null
        ].filter(Boolean),
        marketCondition: h1.bias?.trendStrong ? 'TRENDING' : 'RANGING',
        timestamp: new Date().toISOString(),
        source: 'fallback_mtf'
    };
}

/**
 * Analyze bias across multiple timeframes - INTRADAY MODE
 * H4 + H1 are MANDATORY entry conditions.
 * D1 is a context filter that adjusts confidence only.
 */
function analyzeMultiTimeframe(technicalData) {
    const h1 = technicalData?.H1;
    const h4 = technicalData?.H4;
    const d1 = technicalData?.D1;

    function getDirection(tf) {
        if (!tf || tf.error || !tf.bias) return 'NONE';
        if (tf.bias.direction.includes('BULLISH')) return 'BULL';
        if (tf.bias.direction.includes('BEARISH')) return 'BEAR';
        return 'SIDE';
    }

    const h1Dir = getDirection(h1);
    const h4Dir = getDirection(h4);
    const d1Dir = getDirection(d1);

    // ---- H4 + H1 must agree (bắt buộc) ----
    const h4h1Agreement = (h4Dir !== 'NONE' && h1Dir !== 'NONE' && h4Dir === h1Dir);

    // Determine direction from H4+H1
    let direction = 'NONE';
    if (h4h1Agreement) {
        direction = h4Dir === 'BULL' ? 'BULLISH' : h4Dir === 'BEAR' ? 'BEARISH' : 'NONE';
    }

    // ---- Base confidence from H4+H1 strength ----
    let confidence = 60; // base when H4+H1 agree

    // ADX H4 amplifier
    if (h4?.trend?.adx?.trendStrength === 'strong') confidence += 8;
    else if (h4?.trend?.adx?.trendStrength === 'moderate') confidence += 3;

    // ADX H1 amplifier
    if (h1?.trend?.adx?.trendStrength === 'strong') confidence += 5;

    // ---- D1 context filter (not mandatory but adjusts confidence) ----
    let d1Alignment = 'neutral';
    if (d1Dir !== 'NONE' && d1Dir !== 'SIDE') {
        if (d1Dir === h4Dir) {
            confidence += 10;  // D1 xác nhận cùng chiều → boost
            d1Alignment = 'aligned';
        } else {
            confidence -= 15; // D1 ngược chiều → cảnh báo
            d1Alignment = 'counter';
        }
    }

    // RSI extreme filter (H1)
    const rsi = h1?.momentum?.rsi?.value;
    if (rsi) {
        if (direction === 'BULLISH' && rsi > 75) confidence -= 10;
        if (direction === 'BEARISH' && rsi < 25) confidence -= 10;
    }

    confidence = Math.min(90, Math.max(0, confidence));

    return {
        direction,
        h4h1Agreement,
        agreement: h4h1Agreement ? 2 : 0, // kept for logging compat
        hasConsensus: h4h1Agreement,
        h1Dir, h4Dir, d1Dir,
        d1Alignment,
        confidence
    };
}

/**
 * Get symbol-specific configuration for pip size and decimal places
 */
function getSymbolConfig(symbol, currentPrice) {
    const sym = symbol.toUpperCase();

    // Gold
    if (sym.includes('XAU')) {
        return { pipSize: 0.1, decimals: 2 };
    }
    // JPY pairs
    if (sym.includes('JPY')) {
        return { pipSize: 0.01, decimals: 3 };
    }
    // GBP/USD uses standard forex pip size — falls through to default below
    if (sym.includes('ETH')) {
        return { pipSize: 0.1, decimals: 2 };
    }
    // Standard forex (EUR/USD, GBP/USD, etc.)
    return { pipSize: 0.0001, decimals: 5 };
}

function roundTo(val, decimals = 2) {
    if (val === null || val === undefined) return null;
    const factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
}

function round(val) {
    if (val === null || val === undefined) return null;
    return Math.round(val * 100) / 100;
}

