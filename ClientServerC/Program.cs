using Microsoft.AspNetCore.SignalR.Client;
using System;
using System.Collections.Generic;
using System.Linq; 
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;


public class Result<T>
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public T? Data { get; set; }
    public int? StatusCode { get; set; }
    public string? ErrorCode { get; set; }
}

public class WsAuthorizeResponse
{
    public bool Allowed { get; set; }
    public string Message { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string Path { get; set; } = "/hubs/notifications";
    public Guid? UserId { get; set; }
}

public class PayloadEnvelope<T>
{
    public bool Success { get; set; }
    public string ResultType { get; set; } = string.Empty;
    public string? Message { get; set; }
    public T? Data { get; set; }
    public int? StatusCode { get; set; }
    public string? ErrorCode { get; set; }
}

public class IsCreatedData { public bool IsCreated { get; set; } }
public class IsUpdatedData { public bool IsUpdated { get; set; } }
public class IsDeletedData { public bool IsDeleted { get; set; } }

public class UpdateEventExecutionPayload
{
    public string EventId { get; set; } = string.Empty;
    public string? NewTitle { get; set; }
    public DateTime? NewStart { get; set; }
    public DateTime? NewEnd { get; set; }
}

public class DeleteEventExecutionPayload
{
    public string EventId { get; set; } = string.Empty;
}


class Program
{
    public static string sessionToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwODkwODU3NC03YTgwLTQxNTgtOGExYy01NDhmYTRmNTdiOWMiLCJlbWFpbCI6Im5haXRoZXRvYW4yMDA1QGdtYWlsLmNvbSIsImp0aSI6IjY5NjMxMzFjLTc1NjQtNDIyNy1hOTVhLTQwN2I5ZDZhYTM2MCIsIm5iZiI6MTc2NTM3ODc5NSwiZXhwIjoxNzY1NDY1MTk1LCJpc3MiOiJDYWxlbmRhckJvdCIsImF1ZCI6IkNhbGVuZGFyQm90Q2xpZW50In0.ZsQn_xVc2XZ9B8rKNisQgLteCbuNj-RAhR0bEWus6CM";
    public static Guid UserId = Guid.Parse("08908574-7a80-4158-8a1c-548fa4f57b9c");

    static async Task<int> Main(string[] args)
    {
        var apiBase = args.Length > 0 ? args[0] : "https://localhost:7127";

        if (string.IsNullOrWhiteSpace(sessionToken))
        {
            Console.Write("Nhập sessionToken: ");
            sessionToken = Console.ReadLine() ?? "";
        }
        if (string.IsNullOrWhiteSpace(sessionToken))
        {
            Console.WriteLine("sessionToken is required.");
            return 1;
        }

        try
        {
            var wsUrl = await AuthorizeAndGetWsUrlAsync(apiBase, sessionToken);
            if (string.IsNullOrWhiteSpace(wsUrl))
            {
                Console.WriteLine("Authorize thất bại.");
                return 1;
            }

            await RunSignalRAsync(wsUrl);
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Lỗi: {ex.Message}");
            return 1;
        }
    }

    static async Task<string?> AuthorizeAndGetWsUrlAsync(string apiBase, string sessionToken)
    {
        using var http = new HttpClient { BaseAddress = new Uri(apiBase) };
        var res = await http.PostAsJsonAsync("/api/ws", sessionToken);

        if (!res.IsSuccessStatusCode)
        {
            Console.WriteLine($"Authorize thất bại: {(int)res.StatusCode} {res.ReasonPhrase}");
            try { Console.WriteLine($"Response body: {await res.Content.ReadAsStringAsync()}"); } catch { }
            return null;
        }

        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var payload = await res.Content.ReadFromJsonAsync<Result<WsAuthorizeResponse>>(options);
        if (payload?.Data == null || !payload.Data.Allowed || string.IsNullOrWhiteSpace(payload.Data.Url))
        {
            Console.WriteLine($"Authorize trả về không hợp lệ: {payload?.Message ?? "Unknown"}");
            return null;
        }
        Console.WriteLine($"Authorize OK. Hub URL: {payload.Data.Url}");
        return payload.Data.Url;
    }

    static async Task RunSignalRAsync(string wsUrl)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(wsUrl, options =>
            {
                options.AccessTokenProvider = () => Task.FromResult(sessionToken);
            })
            .WithAutomaticReconnect()
            .Build();

        connection.On<string>("notification", async raw =>
        {
            try
            {
                using var doc = JsonDocument.Parse(raw);
                var root = doc.RootElement;
                if (!root.TryGetProperty("type", out var typeProp))
                {
                    Console.WriteLine("[server] Không có field 'type'.");
                    Console.Write("Send: ");
                    return;
                }

                var type = typeProp.GetString();
                switch (type)
                {
                    case "ack":
                        HandleAck(root);
                        break;

                    case "preview":
                        await HandlePreviewAsync(connection, root);
                        break;

                    case "decision-ack":
                        HandleDecisionAck(root);
                        break;

                    case "processed":
                        HandleProcessed(root);
                        break;

                    case "CalendarEventReminder":
                        HandleCalendarReminder(root);
                        break;

                    default:
                        Console.WriteLine($"[server] Unknown type={type}");
                        break;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Parse notification lỗi: {ex.Message}");
            }

            Console.Write("Send: ");
        });

        connection.On<string>("echo", msg =>
        {
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine($"\n[echo] {msg}");
            Console.ResetColor();
            Console.Write("Send: ");
        });

        connection.Closed += async (ex) =>
        {
            Console.WriteLine($"[connection] Closed. Reason: {ex?.Message}");
            await Task.CompletedTask;
        };

        var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (s, e) =>
        {
            e.Cancel = true;
            Console.WriteLine("Cancellation requested... stopping connection.");
            cts.Cancel();
        };

        try
        {
            await connection.StartAsync(cts.Token);
            Console.WriteLine("Connected.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Không thể kết nối hub: {ex.Message}");
            return;
        }

        Console.WriteLine("Nhập dòng: prefix '!' để dùng Echo, còn lại dùng ProcessMessage. Ctrl+C thoát.");

        while (!cts.Token.IsCancellationRequested)
        {
            Console.Write("Send: ");
            string? input = null;
            try { input = await Task.Run(() => Console.ReadLine(), cts.Token); }
            catch (OperationCanceledException) { break; }

            if (string.IsNullOrWhiteSpace(input)) continue;

            try
            {
                if (input.StartsWith("!"))
                {
                    await connection.SendAsync("Echo", input[1..], cts.Token);
                }
                else
                {
                    var messageId = Guid.NewGuid().ToString("N");
                    Console.WriteLine($"Gửi xử lý messageId={messageId}");
                    if (UserId != Guid.Empty)
                        await connection.SendAsync("ProcessMessage", input, messageId, UserId, cts.Token);
                    else
                        await connection.SendAsync("ProcessMessage", input, messageId, cts.Token);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Gửi lỗi: {ex.Message}");
            }
        }

        try
        {
            await connection.StopAsync();
            await connection.DisposeAsync();
            Console.WriteLine("Connection stopped and disposed.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Lỗi khi dừng connection: {ex.Message}");
        }
    }



    private static void HandleAck(JsonElement root)
    {
        var msgId = root.TryGetProperty("messageId", out var mid) ? mid.GetString() : "?";
        Console.WriteLine($"[server] ACK messageId={msgId}");
    }

    private static void HandleDecisionAck(JsonElement root)
    {
        var msgId = root.TryGetProperty("messageId", out var mid) ? mid.GetString() : "?";
        var confirmed = root.TryGetProperty("confirmed", out var cf) && cf.GetBoolean();
        Console.WriteLine($"[server] DECISION-ACK messageId={msgId} confirmed={confirmed}");
    }

    private static void HandleProcessed(JsonElement root)
    {
        var msgId = root.TryGetProperty("messageId", out var mid) ? mid.GetString() : "?";
        Console.WriteLine($"[server] PROCESSED messageId={msgId}");
        if (root.TryGetProperty("payload", out var payloadElement))
        {
            Console.WriteLine("  payload:");
            PrintPayloadDynamic(payloadElement, "    ");
            TryPrintTypedProcessed(payloadElement);
        }
        else
        {
            Console.WriteLine("  Không tìm thấy payload.");
        }
    }

    private static async Task HandlePreviewAsync(HubConnection connection, JsonElement root)
    {
        var msgId = root.GetProperty("messageId").GetString();
        var resultType = root.TryGetProperty("resultType", out var rt) ? rt.GetString() : "create_event";
        var previewElem = root.GetProperty("preview");

        Console.WriteLine("[server] PREVIEW:");
        Console.WriteLine($"  messageId : {msgId}");
        Console.WriteLine($"  resultType: {resultType}");

        object? execPayloadToSend = null;

        if (previewElem.TryGetProperty("success", out var ok) && !ok.GetBoolean())
        {
            var msg = previewElem.TryGetProperty("message", out var mm) ? mm.GetString() : "(no message)";
            Console.WriteLine($"  Preview failed: {msg}");
        }
        else if (previewElem.TryGetProperty("data", out var dataElem))
        {
            if (dataElem.ValueKind == JsonValueKind.Object)
            {
                // Single object preview
                execPayloadToSend = HandleSinglePreviewData(dataElem);
            }
            else if (dataElem.ValueKind == JsonValueKind.Array)
            {
                // --- PHÂN LOẠI XỬ LÝ LIST DỰA VÀO RESULT TYPE ---
                if (resultType == "update_event")
                {
                    // Update: Trả về List<UpdateEventExecutionPayload>
                    execPayloadToSend = HandleUpdateListPreview(dataElem);
                }
                else if (resultType == "delete_event")
                {
                    // Delete: Trả về List<DeleteEventExecutionPayload> (Mới)
                    execPayloadToSend = HandleDeleteListPreview(dataElem);
                }
                else
                {
                    // Mặc định hoặc Create dạng list
                    Console.WriteLine("  (Unknown list resultType), xử lý như delete...");
                    execPayloadToSend = HandleDeleteListPreview(dataElem);
                }
            }
            else
            {
                Console.WriteLine("  (preview.data) không phải object/array.");
            }
        }
        else
        {
            Console.WriteLine("  (preview.data) không tồn tại.");
        }

        // Logic confirm
        bool confirmed;
        if ((resultType == "update_event" || resultType == "delete_event") &&
            previewElem.TryGetProperty("data", out var listElem) &&
            listElem.ValueKind == JsonValueKind.Array)
        {
            confirmed = true; // Auto confirm cho list operations
        }
        else
        {
            confirmed = execPayloadToSend != null;
        }
        // Gửi Confirm kèm payload (nếu có)
        await SendConfirmAsync(connection,
                               msgId!,
                               resultType ?? "create_event",
                               confirmed,
                               execPayloadToSend);
    }

    private static object? HandleDeleteListPreview(JsonElement dataArray)
    {
        try
        {
            if (dataArray.ValueKind != JsonValueKind.Array) return null;
            if (dataArray.GetArrayLength() == 0) return null;

            var deletePayloads = new List<DeleteEventExecutionPayload>();
            int i = 0;

            Console.WriteLine("  Trích xuất ID cho Delete:");

            foreach (var item in dataArray.EnumerateArray())
            {
                string? extractedId = null;

                // Ưu tiên targetEventId
                if (item.TryGetProperty("targetEventId", out var tId))
                {
                    if (tId.ValueKind == JsonValueKind.String) extractedId = tId.GetString();
                    else if (tId.ValueKind == JsonValueKind.Number) extractedId = tId.GetRawText();
                }

                // Fallback sang id
                if (string.IsNullOrEmpty(extractedId) && item.TryGetProperty("id", out var id))
                {
                    if (id.ValueKind == JsonValueKind.String) extractedId = id.GetString();
                    else if (id.ValueKind == JsonValueKind.Number) extractedId = id.GetRawText();
                }

                var title = item.TryGetProperty("title", out var t) ? t.GetString() : "no-title";

                if (!string.IsNullOrEmpty(extractedId))
                {
                    // Tạo object theo class DeleteEventExecutionPayload
                    deletePayloads.Add(new DeleteEventExecutionPayload { EventId = extractedId });
                    Console.WriteLine($"    [{i}] {title} => ID: {extractedId}");
                }
                i++;
            }

            if (deletePayloads.Count == 0)
            {
                Console.WriteLine("  => Không tìm thấy ID nào hợp lệ.");
                return null;
            }

            Console.WriteLine($"  => Tạo payload delete cho {deletePayloads.Count} sự kiện.");
            return deletePayloads; // Trả về List object để SendConfirmAsync serialize thành mảng JSON object
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  Lỗi xử lý list (Delete): {ex.Message}");
            return null;
        }
    }

    private static object? HandleUpdateListPreview(JsonElement dataArray)
    {
        try
        {
            if (dataArray.ValueKind != JsonValueKind.Array) return null;
            if (dataArray.GetArrayLength() == 0) return null;

            var updateList = new List<UpdateEventExecutionPayload>();
            int i = 0;
            var jsonOpts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

            Console.WriteLine("  Danh sách preview (Update):");

            foreach (var item in dataArray.EnumerateArray())
            {
                var title = item.TryGetProperty("title", out var t) ? t.GetString() : "no-title";

                string? eventId = null;
                if (item.TryGetProperty("targetEventId", out var tId) && tId.ValueKind == JsonValueKind.String)
                    eventId = tId.GetString();
                else if (item.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String)
                    eventId = id.GetString();

                Console.WriteLine($"    [{i}] {title} (ID: {eventId})");

                if (!string.IsNullOrEmpty(eventId))
                {
                    if (item.TryGetProperty("executionPayload", out var execPayloadElem))
                    {
                        var payload = JsonSerializer.Deserialize<UpdateEventExecutionPayload>(execPayloadElem.GetRawText(), jsonOpts);
                        if (payload != null)
                        {
                            if (string.IsNullOrEmpty(payload.EventId))
                                payload.EventId = eventId;

                            updateList.Add(payload);
                            Console.WriteLine($"      -> Update Payload: Title='{payload.NewTitle}', Start={payload.NewStart:HH:mm}, End={payload.NewEnd:HH:mm}");
                        }
                    }
                    else
                    {
                        Console.WriteLine("      -> Item này không có executionPayload.");
                    }
                }
                i++;
            }

            if (updateList.Count == 0)
            {
                Console.WriteLine("  Không tạo được payload update nào hợp lệ.");
                return null;
            }

            return updateList;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  Lỗi xử lý list update: {ex.Message}");
            return null;
        }
    }

    private static object? HandleSinglePreviewData(JsonElement dataElem)
    {
        var title = dataElem.TryGetProperty("title", out var t) ? t.GetString() : "(no title)";
        var start = dataElem.TryGetProperty("start", out var st) ? st.GetRawText() : "(no start)";
        var end = dataElem.TryGetProperty("end", out var ed) ? ed.GetRawText() : "(no end)";

        Console.WriteLine($"  title      : {title}");
        Console.WriteLine($"  start      : {start}");
        Console.WriteLine($"  end        : {end}");

        if (dataElem.TryGetProperty("warnings", out var warns) && warns.ValueKind == JsonValueKind.Array)
        {
            Console.WriteLine("  warnings:");
            foreach (var w in warns.EnumerateArray())
                Console.WriteLine($"    - {w.GetString()}");
        }

        if (dataElem.TryGetProperty("executionPayload", out var exec))
        {
            Console.WriteLine("  executionPayload:");
            PrintPayloadDynamic(exec, "    ");
            return exec;
        }

        Console.WriteLine("  (no executionPayload) => không thể thực thi.");
        return null;
    }

    private static void HandleCalendarReminder(JsonElement root)
    {
        // Expecting shape: { type: "CalendarEventReminder", eventTime: "...", message: "..." }
        var msg = root.TryGetProperty("message", out var m) ? m.GetString() : "(no message)";
        DateTime? eventTime = null;
        if (root.TryGetProperty("eventTime", out var t))
        {
            try
            {
                if (t.ValueKind == JsonValueKind.String)
                    eventTime = DateTime.Parse(t.GetString()!);
                else
                    eventTime = DateTime.Parse(t.GetRawText());
            }
            catch { /* ignore parse errors */ }
        }

        Console.ForegroundColor = ConsoleColor.Yellow;
        if (eventTime.HasValue)
            Console.WriteLine($"\n[Reminder] {msg}");
        else
            Console.WriteLine($"\n[Reminder] {msg}");
        Console.ResetColor();
    }


    static async Task SendConfirmAsync(HubConnection connection, string messageId, string resultType, bool confirmed, object? executionPayload)
    {
        try
        {
            string? executionPayloadJson = null;

            if (executionPayload is string strPayload)
            {
                executionPayloadJson = strPayload;
            }
            else if (executionPayload is JsonElement je)
            {
                executionPayloadJson = je.GetRawText();
            }
            else if (executionPayload != null)
            {
                executionPayloadJson = JsonSerializer.Serialize(executionPayload);
            }

            await connection.SendAsync("ConfirmOperation", messageId, resultType, confirmed, executionPayloadJson, null);
            Console.WriteLine("Đã gửi confirm lên hub.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Gửi confirm lỗi: {ex.Message}");
        }
    }


    private static void TryPrintTypedProcessed(JsonElement payloadElement)
    {
        var raw = payloadElement.GetRawText();
        var opts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

        try { var created = JsonSerializer.Deserialize<PayloadEnvelope<IsCreatedData>>(raw, opts); if (created?.Data != null) { Console.WriteLine($"  (typed) isCreated = {created.Data.IsCreated}"); return; } } catch { }
        try { var updated = JsonSerializer.Deserialize<PayloadEnvelope<IsUpdatedData>>(raw, opts); if (updated?.Data != null) { Console.WriteLine($"  (typed) isUpdated = {updated.Data.IsUpdated}"); return; } } catch { }
        try { var deleted = JsonSerializer.Deserialize<PayloadEnvelope<IsDeletedData>>(raw, opts); if (deleted?.Data != null) { Console.WriteLine($"  (typed) isDeleted = {deleted.Data.IsDeleted}"); return; } } catch { }
    }

    private static void PrintPayloadDynamic(JsonElement elem, string indent = "")
    {
        switch (elem.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var prop in elem.EnumerateObject()) { Console.WriteLine($"{indent}{prop.Name}:"); PrintPayloadDynamic(prop.Value, indent + "    "); }
                break;
            case JsonValueKind.Array:
                int idx = 0;
                foreach (var item in elem.EnumerateArray()) { Console.WriteLine($"{indent}[{idx}]"); PrintPayloadDynamic(item, indent + "    "); idx++; }
                break;
            case JsonValueKind.String: Console.WriteLine($"{indent}{elem.GetString()}"); break;
            case JsonValueKind.Number: case JsonValueKind.True: case JsonValueKind.False: case JsonValueKind.Null: Console.WriteLine($"{indent}{elem.GetRawText()}"); break;
        }
    }
}