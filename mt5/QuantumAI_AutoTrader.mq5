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
input double   LotSize          = 0.10;                        // Lot Size
input int      MagicNumber      = 888888;                      // Magic Number
input int      PollIntervalSec  = 60;                          // Poll interval (seconds)
input int      MaxTradesPerSymbol = 1;                         // Max open trades per symbol
input int      MaxTotalTrades   = 5;                           // Max total open trades
input int      MinConfidence    = 60;                          // Minimum confidence (%)
input int      Slippage         = 30;                          // Max slippage (points)
input bool     EnableBuy        = true;                        // Allow BUY trades
input bool     EnableSell       = true;                        // Allow SELL trades
input bool     UseTP2           = false;                       // Use TP2 instead of TP1
input string   SymbolSuffix     = "";                          // Symbol suffix (e.g. ".r" for TMGM)

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
    Print("║   💰 Lot: ", DoubleToString(LotSize, 2), "   ");
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
    // Also poll on first tick if timer hasn't fired yet
    if(lastPollTime == 0)
        PollSignals();
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

        // Execute trade
        double tp = UseTP2 ? tp2 : tp1;
        if(ExecuteTrade(mt5Symbol, action, entry, sl, tp, conf, signalId))
        {
            MarkSignalProcessed(signalId);
        }
    }
}

//+------------------------------------------------------------------+
//| Execute a trade                                                    |
//+------------------------------------------------------------------+
bool ExecuteTrade(string symbol, string action, double entry, double sl, double tp,
                  int confidence, string signalId)
{
    MqlTradeRequest request = {};
    MqlTradeResult  result  = {};

    request.action    = TRADE_ACTION_DEAL;
    request.symbol    = symbol;
    request.volume    = LotSize;
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
          " | Lot: ", LotSize, " | Conf: ", confidence, "%");

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
