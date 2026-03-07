import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
dotenv.config();

let bot = null;

/**
 * Initialize Telegram bot
 */
export function initTelegramBot() {
    try {
        bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            bot.sendMessage(chatId,
                `🚀 *QuantumAI Forex Signal Bot*\n\n` +
                `Chat ID của bạn: \`${chatId}\`\n\n` +
                `Hãy copy Chat ID này vào file .env (TELEGRAM_CHAT_ID)\n\n` +
                `Commands:\n` +
                `/start - Hiển thị thông tin\n` +
                `/status - Trạng thái hệ thống\n` +
                `/signal - Yêu cầu phân tích mới`,
                { parse_mode: 'Markdown' }
            );
            console.log(`📱 Telegram user connected: chatId=${chatId}`);
        });

        bot.onText(/\/status/, (msg) => {
            bot.sendMessage(msg.chat.id,
                `📊 *QuantumAI Status*\n\n` +
                `✅ Server: Online\n` +
                `⏰ Time: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}\n` +
                `📈 Symbol: ${process.env.SYMBOL || 'XAU/USD'}\n` +
                `🤖 AI Engine: Gemini Pro`,
                { parse_mode: 'Markdown' }
            );
        });

        console.log('✅ Telegram bot initialized');
    } catch (error) {
        console.error('❌ Telegram bot initialization error:', error.message);
    }
}

/**
 * Send formatted signal to Telegram
 */
export async function sendTelegramSignal(signal) {
    if (!bot || !process.env.TELEGRAM_CHAT_ID) {
        console.log('⚠️ Telegram not configured (no bot or chat ID)');
        return false;
    }

    try {
        const message = formatSignalMessage(signal);
        await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        return true;
    } catch (error) {
        console.error('Telegram send error:', error.message);
        return false;
    }
}

/**
 * Format signal into beautiful Telegram message
 */
function formatSignalMessage(signal) {
    if (!signal || signal.action === 'NO_TRADE') {
        return `⏸️ <b>QUANTUM AI - NO TRADE</b>\n\n` +
            `📊 ${signal?.symbol || 'XAU/USD'}\n` +
            `⏰ ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}\n\n` +
            `💡 <i>${signal?.reasoning || 'Không đủ điều kiện vào lệnh'}</i>\n\n` +
            `#NoTrade #QuantumAI`;
    }

    const directionEmoji = signal.action === 'BUY' ? '🟢' : '🔴';
    const directionIcon = signal.action === 'BUY' ? '📈' : '📉';

    let msg = `${directionEmoji} <b>QUANTUM AI SIGNAL</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `${directionIcon} <b>${signal.symbol} | ${signal.action}</b>\n`;
    msg += `⏰ ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}\n\n`;

    msg += `🎯 Entry: <code>${signal.entry}</code>\n`;
    msg += `🛑 Stop Loss: <code>${signal.stopLoss}</code>`;
    if (signal.slPips) msg += ` (${signal.slPips} pips)`;
    msg += `\n`;
    msg += `✅ TP1: <code>${signal.tp1}</code>`;
    if (signal.tp1Pips) msg += ` (+${signal.tp1Pips} pips)`;
    msg += `\n`;
    msg += `✅ TP2: <code>${signal.tp2}</code>`;
    if (signal.tp2Pips) msg += ` (+${signal.tp2Pips} pips)`;
    msg += `\n\n`;

    msg += `📏 R:R = 1:${signal.riskReward || 'N/A'}\n`;
    msg += `📊 Confidence: <b>${signal.confidence}%</b>\n\n`;

    msg += `━━━━━━━━━━━━━━━━━━\n`;
    msg += `💡 <b>Lý do vào lệnh:</b>\n`;

    if (Array.isArray(signal.reasons)) {
        signal.reasons.forEach(r => {
            msg += `• ${r}\n`;
        });
    } else if (signal.reasoning) {
        msg += `${signal.reasoning}\n`;
    }

    if (signal.warnings && signal.warnings.length > 0) {
        msg += `\n⚠️ <b>Cảnh báo:</b>\n`;
        signal.warnings.forEach(w => {
            msg += `• ${w}\n`;
        });
    }

    msg += `\n#${signal.symbol?.replace('/', '')} #${signal.action} #QuantumAI`;

    return msg;
}
