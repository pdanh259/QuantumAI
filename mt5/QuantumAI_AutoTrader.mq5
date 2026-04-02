//+------------------------------------------------------------------+
//|                                    QuantumAI_AutoTrader.mq5      |
//|                        QuantumAI Auto-Trading EA                  |
//|                    Reads signals from QuantumAI API               |
//+------------------------------------------------------------------+
#property copyright "QuantumAI"
#property link      ""
#property version   "1.00"
#property description "Auto-trading EA that connects to QuantumAI API"
#property description "Reads AI signals and places trades automatically"

//--- Input Parameters
input string   ServerURL        = "http://YOUR_VPS_IP:3001";  // QuantumAI Server URL
input double   RiskPercent      = 1.0;                         // Risk % per Trade (0 = Fixed Lot)
input double   FixedLotSize     = 0.10;                        // Fixed Lot Size (if Risk = 0)
input int      MagicNumber      = 888888;                      // Magic Number
input int      PollIntervalSec  = 60;                          // Poll interval (seconds)
input int      MaxTradesPerSymbol = 1;                         // Max open trades per symbol
input int      MaxTotalTrades   = 5;                           // Max total open trades
input int      MinConfidence    = 60;                          // Minimum confidence (%)
input int      Slippage         = 30;                          // Max slippage (points)
input bool     EnableBuy        = true;                        // Allow BUY trades
input bool     EnableSell       = true;                        // Allow SELL trades
input bool     UseTP2           = false;                       // Use TP2 instead of TP1 (if Scale-Out is off)
input bool     EnableScaleOut   = true;                        // Enable Scale-Out (50% TP1, 50% TP2)
input string   SymbolSuffix     = "";                          // Symbol suffix (e.g. ".r" for TMGM)

//--- Trailing Stop Parameters
input bool     EnableTrailing   = true;                        // Enable Trailing Stop
input double   TrailStart1Pct   = 50.0;                        // Level 1: Start trail at % of TP
input double   TrailSL1Pct      = 0.0;                         // Level 1: Move SL to % of TP (0 = breakeven)
input double   TrailStart2Pct   = 75.0;                        // Level 2: Trail at % of TP
input double   TrailSL2Pct      = 50.0;                        // Level 2: Move SL to % of TP
input double   TrailStart3Pct   = 90.0;                        // Level 3: Trail at % of TP
input double   TrailSL3Pct      = 75.0;                        // Level 3: Move SL to % of TP

//--- Global variables
datetime lastPollTime = 0;
string   lastSignalIds[];    // Track processed signal IDs
int      lastSignalCount = 0;

//+------------------------------------------------------------------+
//| Expert initialization function                                     |
//+------------------------------------------------------------------+
int OnInit()
{
    Print("╔══════════════════════════════════════════════╗");
    Print("║   🤖 QuantumAI AutoTrader v1.0              ║");
    Print("║   📡 Server: ", ServerURL, "                 ");
    if(RiskPercent > 0)
        Print("║   💰 Risk: ", DoubleToString(RiskPercent, 1), " % / Trade ");
    else
        Print("║   💰 Lot: ", DoubleToString(FixedLotSize, 2), " (Fixed)  ");
    Print("║   🔧 Magic: ", MagicNumber, "                ");
    Print("╚══════════════════════════════════════════════╝");

    // Validate URL
    if(StringFind(ServerURL, "YOUR_VPS_IP") >= 0)
    {
        Print("⚠️ ERROR: Please set your QuantumAI server URL!");
        Print("   Go to EA Settings → ServerURL → Enter your VPS IP");
        return INIT_PARAMETERS_INCORRECT;
    }

    // Timer for polling
    EventSetTimer(PollIntervalSec);

    Print("✅ EA initialized. Polling every ", PollIntervalSec, " seconds");
    Print("⚠️ Make sure to add '", ServerURL, "' to:");
    Print("   Tools → Options → Expert Advisors → Allow WebRequest for listed URL");

    return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                    |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
    EventKillTimer();
    Print("🛑 QuantumAI AutoTrader stopped. Reason: ", reason);
}

//+------------------------------------------------------------------+
//| Timer event - polls the API                                        |
//+------------------------------------------------------------------+
void OnTimer()
{
    PollSignals();
}

//+------------------------------------------------------------------+
//| Tick event                                                         |
//+------------------------------------------------------------------+
void OnTick()
{
    // Manage trailing stops on every tick
    if(EnableTrailing)
        ManageOpenTrades();

    // Also poll on first tick if timer hasn't fired yet
    if(lastPollTime == 0)
        PollSignals();
}

//+------------------------------------------------------------------+
//| Trade transaction event - detects when trades are closed           |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                         const MqlTradeRequest &request,
                         const MqlTradeResult &result)
{
    // We only care about deal additions (trade executed)
    if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
        return;

    // Get deal info
    ulong dealTicket = trans.deal;
    if(dealTicket == 0) return;

    // Select the deal to read its properties
    if(!HistoryDealSelect(dealTicket)) return;

    // Only process OUT deals (closing trades), not IN (opening)
    ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
    if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_INOUT)
        return;

    // Check if this deal belongs to our EA
    long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
    if(magic != MagicNumber) return;

    // Get deal details
    string symbol     = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
    double closePrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
    double profit     = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
    double volume     = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
    long   posId      = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
    string comment    = HistoryDealGetString(dealTicket, DEAL_COMMENT);
    ENUM_DEAL_REASON reason = (ENUM_DEAL_REASON)HistoryDealGetInteger(dealTicket, DEAL_REASON);

    // Determine close reason
    string closeReason = "manual";
    if(reason == DEAL_REASON_SL)
        closeReason = "sl";
    else if(reason == DEAL_REASON_TP)
        closeReason = "tp";
    else if(reason == DEAL_REASON_SO)
        closeReason = "stop_out";
    else if(StringFind(comment, "Trail") >= 0 || StringFind(comment, "trail") >= 0)
        closeReason = "trailing";

    // Remove suffix for server reporting
    string cleanSymbol = symbol;
    if(SymbolSuffix != "" && StringFind(symbol, SymbolSuffix) >= 0)
    {
        cleanSymbol = StringSubstr(symbol, 0, StringLen(symbol) - StringLen(SymbolSuffix));
    }

    Print("📊 [CLOSE] Detected: ", cleanSymbol, " | Price: ", DoubleToString(closePrice, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)),
          " | Profit: ", DoubleToString(profit, 2),
          " | Reason: ", closeReason,
          " | PosID: ", posId);

    // ===== FREE TRADE LOGIC =====
    // Khi Order 1 (TP1) đóng có lãi và đóng bởi TP/trail →
    // Dời SL của tất cả lệnh còn mở cùng symbol về breakeven (giá mở lệnh)
    // Kết quả: Order 2 (TP2) không còn rủi ro, chạy miễn phí.
    if(profit > 0 && (reason == DEAL_REASON_TP || closeReason == "trailing"))
    {
        Print("🟢 [FREE-TRADE] TP1 hit on ", cleanSymbol, " | Moving remaining positions to breakeven...");
        MoveSymbolPositionsToBreakeven(symbol);
    }

    // Report to server using position ID as ticket (matches what was sent on open)
    ReportCloseToServer(cleanSymbol, (long)posId, closePrice, profit, closeReason);
}

//+------------------------------------------------------------------+
//| FREE TRADE: Move all EA positions on a symbol to breakeven       |
//| Called when TP1 is hit, so Order 2 (TP2) runs risk-free          |
//+------------------------------------------------------------------+
void MoveSymbolPositionsToBreakeven(string symbol)
{
    int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
    double minStop = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL) * point;

    for(int i = PositionsTotal() - 1; i >= 0; i--)
    {
        ulong ticket = PositionGetTicket(i);
        if(ticket == 0) continue;
        if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
        if(PositionGetString(POSITION_SYMBOL) != symbol) continue;

        double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
        double currentSL = PositionGetDouble(POSITION_SL);
        double currentTP = PositionGetDouble(POSITION_TP);
        long   posType   = PositionGetInteger(POSITION_TYPE);

        double currentPrice;
        if(posType == POSITION_TYPE_BUY)
            currentPrice = SymbolInfoDouble(symbol, SYMBOL_BID);
        else
            currentPrice = SymbolInfoDouble(symbol, SYMBOL_ASK);

        // Calculate breakeven SL (= open price, offset by minStop if needed)
        double newSL = openPrice;
        if(posType == POSITION_TYPE_BUY)
        {
            // For BUY: SL must be below current price by at least minStop
            if(minStop > 0 && currentPrice - newSL < minStop)
                newSL = currentPrice - minStop;
            // Only move SL upward (never worse)
            if(currentSL > 0 && newSL <= currentSL)
            {
                Print("⚠️ [FREE-TRADE] #", ticket, " SL already at or above breakeven (", currentSL, "), skip.");
                continue;
            }
        }
        else // SELL
        {
            // For SELL: SL must be above current price by at least minStop
            if(minStop > 0 && newSL - currentPrice < minStop)
                newSL = currentPrice + minStop;
            // Only move SL downward (never worse)
            if(currentSL > 0 && newSL >= currentSL)
            {
                Print("⚠️ [FREE-TRADE] #", ticket, " SL already at or below breakeven (", currentSL, "), skip.");
                continue;
            }
        }

        newSL = NormalizeDouble(newSL, digits);

        MqlTradeRequest req = {};
        MqlTradeResult  res = {};
        req.action   = TRADE_ACTION_SLTP;
        req.position = ticket;
        req.symbol   = symbol;
        req.sl       = newSL;
        req.tp       = currentTP;

        if(OrderSend(req, res) && res.retcode == TRADE_RETCODE_DONE)
        {
            Print("🔒 [FREE-TRADE] #", ticket, " ", symbol,
                  " | SL: ", NormalizeDouble(currentSL, digits),
                  " → Breakeven: ", NormalizeDouble(newSL, digits),
                  " | Trước đó: ", DoubleToString(currentSL, digits));
        }
        else
        {
            Print("❌ [FREE-TRADE] Failed to move #", ticket, " to breakeven. Retcode: ", res.retcode);
        }
    }
}

void ReportCloseToServer(string symbol, long ticket, double closePrice, double profit, string closeReason)
{
    string baseUrl = ServerURL;
    if(StringGetCharacter(baseUrl, StringLen(baseUrl) - 1) == '/')
        baseUrl = StringSubstr(baseUrl, 0, StringLen(baseUrl) - 1);

    string url = baseUrl + "/api/ea/close";

    // Build JSON payload
    string json = "{";
    json += "\"ticket\":" + IntegerToString(ticket) + ",";
    json += "\"symbol\":\"" + symbol + "\",";
    json += "\"closePrice\":" + DoubleToString(closePrice, 5) + ",";
    json += "\"profit\":" + DoubleToString(profit, 2) + ",";
    json += "\"closeReason\":\"" + closeReason + "\"";
    json += "}";

    string response = "";
    if(HttpPost(url, json, response))
    {
        Print("📡 Trade close reported to server: ", symbol, " Ticket:", ticket, " → ", closeReason);
    }
    else
    {
        Print("⚠️ Failed to report trade close to server (non-critical)");
    }
}

//+------------------------------------------------------------------+
//| Main function: Poll API and process signals                        |
//+------------------------------------------------------------------+
void PollSignals()
{
    // Prevent too-frequent polling
    if(TimeCurrent() - lastPollTime < PollIntervalSec)
        return;

    lastPollTime = TimeCurrent();

    // Build URL - strip trailing slash to avoid double-slash issues
    string baseUrl = ServerURL;
    if(StringGetCharacter(baseUrl, StringLen(baseUrl) - 1) == '/')
        baseUrl = StringSubstr(baseUrl, 0, StringLen(baseUrl) - 1);

    string url = baseUrl + "/api/ea/signals";
    string result = "";

    if(!HttpGet(url, result))
    {
        Print("❌ Failed to connect to QuantumAI server");
        return;
    }

    // Parse signals
    ProcessSignals(result);
}

//+------------------------------------------------------------------+
//| HTTP GET request                                                   |
//+------------------------------------------------------------------+
bool HttpGet(string url, string &response)
{
    char   post[];
    char   resultData[];
    string headers = "";
    string resultHeaders;
    int    timeout = 10000; // 10 seconds

    ResetLastError();

    int res = WebRequest(
        "GET",
        url,
        headers,
        timeout,
        post,
        resultData,
        resultHeaders
    );

    if(res == -1)
    {
        int err = GetLastError();
        Print("⚠️ WebRequest error: ", err);
        if(err == 4014)
        {
            Print("❗ Add URL to allowed list:");
            Print("   Tools → Options → Expert Advisors → Allow WebRequest");
            Print("   Add: ", url);
        }
        return false;
    }

    if(res != 200)
    {
        Print("⚠️ Server returned HTTP ", res);
        return false;
    }

    response = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
    return true;
}

//+------------------------------------------------------------------+
//| Process JSON response with multiple signals                        |
//+------------------------------------------------------------------+
void ProcessSignals(string json)
{
    // Check success (handle both "success":true and "success": true)
    if(StringFind(json, "\"success\":true") < 0 && StringFind(json, "\"success\": true") < 0)
    {
        Print("⚠️ API returned error. Response: ", StringSubstr(json, 0, 500));
        return;
    }

    // Get count
    int countVal = GetJsonInt(json, "count");
    if(countVal == 0)
    {
        // No signals available
        return;
    }

    // Find signals array
    int signalsStart = StringFind(json, "\"signals\":[");
    if(signalsStart < 0) return;

    string signalsStr = StringSubstr(json, signalsStart);

    // Parse each signal object
    int pos = 0;
    while(true)
    {
        int objStart = StringFind(signalsStr, "{", pos);
        if(objStart < 0) break;

        int objEnd = StringFind(signalsStr, "}", objStart);
        if(objEnd < 0) break;

        string sigObj = StringSubstr(signalsStr, objStart, objEnd - objStart + 1);
        pos = objEnd + 1;

        // Parse signal fields
        string signalId  = GetJsonString(sigObj, "signalId");
        string symbol    = GetJsonString(sigObj, "symbol");
        string action    = GetJsonString(sigObj, "action");
        double entry     = GetJsonDouble(sigObj, "entry");
        double sl        = GetJsonDouble(sigObj, "stopLoss");
        double tp1       = GetJsonDouble(sigObj, "tp1");
        double tp2       = GetJsonDouble(sigObj, "tp2");
        int    conf      = GetJsonInt(sigObj, "confidence");

        // Skip if already processed
        if(IsSignalProcessed(signalId))
            continue;

        // Skip if confidence too low
        if(conf < MinConfidence)
        {
            Print("⏭️ Skip ", symbol, " ", action, " - Confidence ", conf, "% < ", MinConfidence, "%");
            MarkSignalProcessed(signalId);
            continue;
        }

        // Process the signal
        string mt5Symbol = symbol + SymbolSuffix;

        // Validate symbol exists on this broker
        if(!SymbolSelect(mt5Symbol, true))
        {
            Print("⚠️ Symbol ", mt5Symbol, " not found on broker. Try adjusting SymbolSuffix.");
            continue;
        }

        // Check trade limits
        if(CountTotalTrades() >= MaxTotalTrades)
        {
            Print("⏭️ Max total trades (", MaxTotalTrades, ") reached. Skipping.");
            continue;
        }

        if(CountSymbolTrades(mt5Symbol) >= MaxTradesPerSymbol)
        {
            Print("⏭️ Max trades for ", mt5Symbol, " reached. Skipping.");
            MarkSignalProcessed(signalId);
            continue;
        }

        // Check action filter
        if(action == "BUY" && !EnableBuy)
        {
            Print("⏭️ BUY disabled, skipping ", mt5Symbol);
            MarkSignalProcessed(signalId);
            continue;
        }
        if(action == "SELL" && !EnableSell)
        {
            Print("⏭️ SELL disabled, skipping ", mt5Symbol);
            MarkSignalProcessed(signalId);
            continue;
        }

        // Execute Trade or Scale-Out
        if(ExecuteSignal(mt5Symbol, action, entry, sl, tp1, tp2, conf, signalId))
        {
            MarkSignalProcessed(signalId);
        }
    }
}

//+------------------------------------------------------------------+
//| Calculate Lot Size and Decide to Split Order or Single Order       |
//+------------------------------------------------------------------+
bool ExecuteSignal(string symbol, string action, double entry, double sl, double tp1, double tp2, 
                   int confidence, string signalId)
{
    // 1. Calculate the TOTAL Dynamic Lot Size
    double totalLot = FixedLotSize;
    if(RiskPercent > 0 && sl > 0)
    {
        double balance = AccountInfoDouble(ACCOUNT_BALANCE);
        double riskAmount = balance * (RiskPercent / 100.0);
        double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
        double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
        double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
        
        double slPoints = MathAbs(entry - sl) / point;
        if(slPoints > 0 && tickValue > 0 && tickSize > 0)
        {
            double tickRisk = slPoints * (tickSize / point) * tickValue;
            if(tickRisk > 0)
            {
                double calcLot = riskAmount / tickRisk;
                double stepLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
                double minLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
                double maxLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
                
                totalLot = MathFloor(calcLot / stepLot) * stepLot;
                if(totalLot < minLot) totalLot = minLot;
                if(totalLot > maxLot) totalLot = maxLot;
            }
        }
    }

    // 2. Decide if Scale-Out is possible
    bool success = false;
    double stepLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double minLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    
    if(EnableScaleOut && totalLot >= minLot * 2 && totalLot >= stepLot * 2)
    {
        double lot1 = MathFloor((totalLot / 2.0) / stepLot) * stepLot;
        double lot2 = totalLot - lot1;
        
        Print("🔀 Scale-Out Activated: Splitting ", DoubleToString(totalLot, 2), " lots into ", 
              DoubleToString(lot1, 2), " (TP1) & ", DoubleToString(lot2, 2), " (TP2)");
              
        bool ok1 = ExecuteTrade(symbol, action, entry, sl, tp1, lot1, confidence, signalId + "_T1");
        bool ok2 = ExecuteTrade(symbol, action, entry, sl, tp2, lot2, confidence, signalId + "_T2");
        success = (ok1 || ok2);
    }
    else
    {
        double targetTp = UseTP2 ? tp2 : tp1;
        success = ExecuteTrade(symbol, action, entry, sl, targetTp, totalLot, confidence, signalId);
    }
    
    return success;
}

//+------------------------------------------------------------------+
//| Execute a single trade (Core execution logic)                      |
//+------------------------------------------------------------------+
bool ExecuteTrade(string symbol, string action, double entry, double sl, double tp, 
                  double lotSize, int confidence, string signalId)
{
    MqlTradeRequest request = {};
    MqlTradeResult  result  = {};

    request.action    = TRADE_ACTION_DEAL;
    request.symbol    = symbol;
    request.volume    = lotSize;
    request.magic     = MagicNumber;
    request.deviation = Slippage;
    request.comment   = "QAI|" + signalId;

    // Determine order type and get current price
    double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
    double bid = SymbolInfoDouble(symbol, SYMBOL_BID);

    if(ask == 0 || bid == 0)
    {
        Print("❌ Cannot get price for ", symbol);
        return false;
    }

    // Normalize prices
    int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    sl = NormalizeDouble(sl, digits);
    tp = NormalizeDouble(tp, digits);

    if(action == "BUY")
    {
        request.type  = ORDER_TYPE_BUY;
        request.price = ask;
        // Validate SL/TP direction for BUY
        if(sl >= ask)
        {
            double slDist = MathAbs(entry - sl);
            if(slDist > 0)
            {
                sl = NormalizeDouble(ask - slDist, digits);
                Print("⚠️ BUY SL recalculated: ", sl, " (distance ", slDist, " from ask ", ask, ")");
            }
            else
                sl = 0;
        }
        if(tp > 0 && tp <= ask)
        {
            double tpDist = MathAbs(tp - entry);
            if(tpDist > 0)
            {
                tp = NormalizeDouble(ask + tpDist, digits);
                Print("⚠️ BUY TP recalculated: ", tp, " (distance ", tpDist, " from ask ", ask, ")");
            }
            else
                tp = 0;
        }
    }
    else if(action == "SELL")
    {
        request.type  = ORDER_TYPE_SELL;
        request.price = bid;
        // Validate SL/TP direction for SELL
        if(sl > 0 && sl <= bid)
        {
            double slDist = MathAbs(sl - entry);
            if(slDist > 0)
            {
                sl = NormalizeDouble(bid + slDist, digits);
                Print("⚠️ SELL SL recalculated: ", sl, " (distance ", slDist, " from bid ", bid, ")");
            }
            else
                sl = 0;
        }
        if(tp >= bid)
        {
            double tpDist = MathAbs(entry - tp);
            if(tpDist > 0)
            {
                tp = NormalizeDouble(bid - tpDist, digits);
                Print("⚠️ SELL TP recalculated: ", tp, " (distance ", tpDist, " from bid ", bid, ")");
            }
            else
                tp = 0;
        }
    }
    else
    {
        Print("⚠️ Unknown action: ", action);
        return false;
    }

    request.sl = sl;
    request.tp = tp;

    // Type filling - try IOC first (common for TMGM), then FOK
    request.type_filling = ORDER_FILLING_IOC;

    Print("📤 Placing ", action, " ", symbol, " @ ", request.price,
          " | SL: ", sl, " | TP: ", tp,
          " | Lot: ", DoubleToString(request.volume, 2), " | Conf: ", confidence, "%");

    if(!OrderSend(request, result))
    {
        Print("❌ OrderSend failed: ", result.retcode, " - ", GetRetcodeDescription(result.retcode));

        // Try with FOK filling if IOC failed
        if(result.retcode == TRADE_RETCODE_INVALID_FILL)
        {
            request.type_filling = ORDER_FILLING_FOK;
            if(!OrderSend(request, result))
            {
                Print("❌ OrderSend (FOK) also failed: ", result.retcode);
                return false;
            }
        }
        else
        {
            return false;
        }
    }

    if(result.retcode == TRADE_RETCODE_DONE || result.retcode == TRADE_RETCODE_PLACED)
    {
        Print("✅ ", action, " ", symbol, " executed! Ticket: ", result.order,
              " | Price: ", result.price, " | Volume: ", result.volume);

        // Confirm trade to server so it's tracked in dashboard
        ConfirmTradeToServer(symbol, action, result.price, sl, tp, (long)result.order, confidence);

        return true;
    }

    Print("⚠️ Unexpected retcode: ", result.retcode);
    return false;
}

//+------------------------------------------------------------------+
//| Manage trailing stops on all open EA trades                        |
//+------------------------------------------------------------------+
void ManageOpenTrades()
{
    for(int i = PositionsTotal() - 1; i >= 0; i--)
    {
        ulong ticket = PositionGetTicket(i);
        if(ticket == 0) continue;
        if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;

        string symbol  = PositionGetString(POSITION_SYMBOL);
        long   posType = PositionGetInteger(POSITION_TYPE);
        double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
        double currentSL = PositionGetDouble(POSITION_SL);
        double currentTP = PositionGetDouble(POSITION_TP);

        // Skip if no TP set (can't calculate trail levels)
        if(currentTP <= 0) continue;

        double currentPrice;
        if(posType == POSITION_TYPE_BUY)
            currentPrice = SymbolInfoDouble(symbol, SYMBOL_BID);
        else
            currentPrice = SymbolInfoDouble(symbol, SYMBOL_ASK);

        if(currentPrice <= 0) continue;

        TrailPosition(ticket, symbol, posType, openPrice, currentSL, currentTP, currentPrice);
    }
}

//+------------------------------------------------------------------+
//| Trail a single position based on TP progress                       |
//+------------------------------------------------------------------+
void TrailPosition(ulong ticket, string symbol, long posType, double openPrice,
                   double currentSL, double currentTP, double currentPrice)
{
    int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
    double minStop = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL) * point;

    // Calculate TP distance in price
    double tpDistance;
    if(posType == POSITION_TYPE_BUY)
        tpDistance = currentTP - openPrice;
    else
        tpDistance = openPrice - currentTP;

    if(tpDistance <= 0) return;

    // Calculate how far price has moved toward TP (as percentage)
    double priceProgress;
    if(posType == POSITION_TYPE_BUY)
        priceProgress = (currentPrice - openPrice) / tpDistance * 100.0;
    else
        priceProgress = (openPrice - currentPrice) / tpDistance * 100.0;

    // Only trail if price is moving in profit direction
    if(priceProgress <= 0) return;

    // Determine best SL level based on progress
    double newSLPct = -1;
    double triggerPct = 0;

    if(priceProgress >= TrailStart3Pct)
    {
        newSLPct = TrailSL3Pct;
        triggerPct = TrailStart3Pct;
    }
    else if(priceProgress >= TrailStart2Pct)
    {
        newSLPct = TrailSL2Pct;
        triggerPct = TrailStart2Pct;
    }
    else if(priceProgress >= TrailStart1Pct)
    {
        newSLPct = TrailSL1Pct;
        triggerPct = TrailStart1Pct;
    }

    if(newSLPct < 0) return; // No trailing level reached

    // Calculate new SL price
    double newSL;
    if(posType == POSITION_TYPE_BUY)
    {
        newSL = openPrice + tpDistance * (newSLPct / 100.0);
        // Ensure minimum distance from current price
        if(minStop > 0 && currentPrice - newSL < minStop)
            newSL = currentPrice - minStop;
        // Only move SL upward (never lower it)
        if(newSL <= currentSL && currentSL > 0) return;
    }
    else
    {
        newSL = openPrice - tpDistance * (newSLPct / 100.0);
        // Ensure minimum distance from current price
        if(minStop > 0 && newSL - currentPrice < minStop)
            newSL = currentPrice + minStop;
        // Only move SL downward (never raise it)
        if(currentSL > 0 && newSL >= currentSL) return;
    }

    newSL = NormalizeDouble(newSL, digits);

    // Modify position
    MqlTradeRequest request = {};
    MqlTradeResult  result  = {};

    request.action   = TRADE_ACTION_SLTP;
    request.position = ticket;
    request.symbol   = symbol;
    request.sl       = newSL;
    request.tp       = currentTP; // Keep TP unchanged

    if(OrderSend(request, result))
    {
        if(result.retcode == TRADE_RETCODE_DONE)
        {
            string level = (triggerPct == TrailStart1Pct) ? "BE" :
                           (triggerPct == TrailStart2Pct) ? "L2" : "L3";
            Print("🔒 [TRAIL-", level, "] ", symbol, " #", ticket,
                  " | Progress: ", DoubleToString(priceProgress, 1), "%",
                  " | SL: ", DoubleToString(currentSL, digits),
                  " → ", DoubleToString(newSL, digits));
        }
    }
}

//+------------------------------------------------------------------+
//| Confirm executed trade to QuantumAI server                        |
//+------------------------------------------------------------------+
void ConfirmTradeToServer(string symbol, string action, double entry,
                          double sl, double tp, long ticket, int confidence)
{
    string baseUrl = ServerURL;
    if(StringGetCharacter(baseUrl, StringLen(baseUrl) - 1) == '/')
        baseUrl = StringSubstr(baseUrl, 0, StringLen(baseUrl) - 1);

    string url = baseUrl + "/api/ea/confirm";

    // Build JSON payload
    string json = "{";
    json += "\"symbol\":\"" + symbol + "\",";
    json += "\"action\":\"" + action + "\",";
    json += "\"entry\":" + DoubleToString(entry, 5) + ",";
    json += "\"sl\":" + DoubleToString(sl, 5) + ",";
    json += "\"tp\":" + DoubleToString(tp, 5) + ",";
    json += "\"ticket\":" + IntegerToString(ticket) + ",";
    json += "\"confidence\":" + IntegerToString(confidence);
    json += "}";

    string response = "";
    if(HttpPost(url, json, response))
    {
        Print("📡 Trade confirmed to server: ", symbol, " ", action, " Ticket:", ticket);
    }
    else
    {
        Print("⚠️ Failed to confirm trade to server (non-critical)");
    }
}

//+------------------------------------------------------------------+
//| HTTP POST request                                                  |
//+------------------------------------------------------------------+
bool HttpPost(string url, string jsonBody, string &response)
{
    char   postData[];
    char   resultData[];
    string headers = "Content-Type: application/json\r\n";
    string resultHeaders;
    int    timeout = 5000; // 5 seconds

    StringToCharArray(jsonBody, postData, 0, WHOLE_ARRAY, CP_UTF8);
    // Remove null terminator that StringToCharArray adds
    ArrayResize(postData, ArraySize(postData) - 1);

    ResetLastError();

    int res = WebRequest(
        "POST",
        url,
        headers,
        timeout,
        postData,
        resultData,
        resultHeaders
    );

    if(res == -1)
    {
        int err = GetLastError();
        Print("⚠️ HttpPost error: ", err);
        return false;
    }

    if(res != 200 && res != 201)
    {
        Print("⚠️ HttpPost returned HTTP ", res);
        return false;
    }

    response = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
    return true;
}

//+------------------------------------------------------------------+
//| Count total open trades by this EA                                 |
//+------------------------------------------------------------------+
int CountTotalTrades()
{
    int count = 0;
    for(int i = PositionsTotal() - 1; i >= 0; i--)
    {
        if(PositionGetTicket(i) > 0)
        {
            if(PositionGetInteger(POSITION_MAGIC) == MagicNumber)
                count++;
        }
    }
    return count;
}

//+------------------------------------------------------------------+
//| Count open trades for a specific symbol                            |
//+------------------------------------------------------------------+
int CountSymbolTrades(string symbol)
{
    int count = 0;
    for(int i = PositionsTotal() - 1; i >= 0; i--)
    {
        if(PositionGetTicket(i) > 0)
        {
            if(PositionGetInteger(POSITION_MAGIC) == MagicNumber &&
               PositionGetString(POSITION_SYMBOL) == symbol)
                count++;
        }
    }
    return count;
}

//+------------------------------------------------------------------+
//| Check if signal was already processed                              |
//+------------------------------------------------------------------+
bool IsSignalProcessed(string signalId)
{
    for(int i = 0; i < lastSignalCount; i++)
    {
        if(lastSignalIds[i] == signalId)
            return true;
    }
    return false;
}

//+------------------------------------------------------------------+
//| Mark signal as processed                                           |
//+------------------------------------------------------------------+
void MarkSignalProcessed(string signalId)
{
    // Keep last 100 signal IDs
    if(lastSignalCount >= 100)
    {
        // Shift array
        for(int i = 0; i < lastSignalCount - 1; i++)
            lastSignalIds[i] = lastSignalIds[i + 1];
        lastSignalCount--;
    }

    ArrayResize(lastSignalIds, lastSignalCount + 1);
    lastSignalIds[lastSignalCount] = signalId;
    lastSignalCount++;
}

//+------------------------------------------------------------------+
//| JSON Helper: Get string value                                      |
//+------------------------------------------------------------------+
string GetJsonString(string json, string key)
{
    string search = "\"" + key + "\":\"";
    int start = StringFind(json, search);
    if(start < 0) return "";

    start += StringLen(search);
    int end = StringFind(json, "\"", start);
    if(end < 0) return "";

    return StringSubstr(json, start, end - start);
}

//+------------------------------------------------------------------+
//| JSON Helper: Get double value                                      |
//+------------------------------------------------------------------+
double GetJsonDouble(string json, string key)
{
    string search1 = "\"" + key + "\":";
    int start = StringFind(json, search1);
    if(start < 0) return 0;

    start += StringLen(search1);

    // Skip whitespace
    while(start < StringLen(json) && StringGetCharacter(json, start) == ' ')
        start++;

    // Find end of number
    int end = start;
    while(end < StringLen(json))
    {
        ushort ch = StringGetCharacter(json, end);
        if(ch != '.' && ch != '-' && (ch < '0' || ch > '9'))
            break;
        end++;
    }

    string numStr = StringSubstr(json, start, end - start);
    return StringToDouble(numStr);
}

//+------------------------------------------------------------------+
//| JSON Helper: Get int value                                         |
//+------------------------------------------------------------------+
int GetJsonInt(string json, string key)
{
    return (int)GetJsonDouble(json, key);
}

//+------------------------------------------------------------------+
//| Get trade error description                                        |
//+------------------------------------------------------------------+
string GetRetcodeDescription(uint retcode)
{
    switch(retcode)
    {
        case TRADE_RETCODE_REQUOTE:      return "Requote";
        case TRADE_RETCODE_REJECT:       return "Rejected";
        case TRADE_RETCODE_CANCEL:       return "Canceled";
        case TRADE_RETCODE_PLACED:       return "Order placed";
        case TRADE_RETCODE_DONE:         return "Done";
        case TRADE_RETCODE_DONE_PARTIAL: return "Partial fill";
        case TRADE_RETCODE_ERROR:        return "General error";
        case TRADE_RETCODE_TIMEOUT:      return "Timeout";
        case TRADE_RETCODE_INVALID:      return "Invalid request";
        case TRADE_RETCODE_INVALID_VOLUME:   return "Invalid volume";
        case TRADE_RETCODE_INVALID_PRICE:    return "Invalid price";
        case TRADE_RETCODE_INVALID_STOPS:    return "Invalid stops";
        case TRADE_RETCODE_TRADE_DISABLED:   return "Trade disabled";
        case TRADE_RETCODE_MARKET_CLOSED:    return "Market closed";
        case TRADE_RETCODE_NO_MONEY:         return "Not enough money";
        case TRADE_RETCODE_INVALID_FILL:     return "Invalid fill type";
        case TRADE_RETCODE_TOO_MANY_REQUESTS: return "Too many requests";
        default: return "Unknown (" + IntegerToString(retcode) + ")";
    }
}
//+------------------------------------------------------------------+
