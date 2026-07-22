using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CodexFlow.Windows;

internal sealed record DesktopConfig(
    int Version,
    string NodePath,
    string LauncherPath,
    string DefaultRoot,
    string CodexflowHome,
    string Path,
    string PackageVersion,
    string UpdatedAt);

internal sealed record RuntimeRecord(
    string FilePath,
    string Root,
    int? Pid,
    string? UpdatedAt,
    string? Endpoint,
    string? LocalAuthToken,
    string? LocalBase,
    string? Tunnel,
    bool IsAlive)
{
    public string Name => System.IO.Path.GetFileName(Root.TrimEnd(System.IO.Path.DirectorySeparatorChar)) is { Length: > 0 } value ? value : Root;
    public override string ToString() => $"{Name}  ·  {(IsAlive ? "Live" : "Offline")}";
}

internal sealed class BrokerClient : IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(60) };
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = true };
    private Process? _launched;

    public string Home { get; }
    public DesktopConfig? Config { get; private set; }
    public RuntimeRecord? Runtime { get; private set; }

    public BrokerClient(string? explicitHome = null)
    {
        Home = explicitHome
            ?? Environment.GetEnvironmentVariable("CODEXFLOW_HOME")
            ?? System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codexflow");
        ReloadConfig();
    }

    public void ReloadConfig()
    {
        var path = System.IO.Path.Combine(Home, "desktop.json");
        try { Config = JsonSerializer.Deserialize<DesktopConfig>(File.ReadAllText(path), _json); }
        catch { Config = null; }
    }

    public IReadOnlyList<RuntimeRecord> DiscoverRuntimes()
    {
        var directory = System.IO.Path.Combine(Home, "runtime");
        if (!Directory.Exists(directory)) return [];
        var values = new List<RuntimeRecord>();
        foreach (var file in Directory.EnumerateFiles(directory, "*.json"))
        {
            try
            {
                var node = JsonNode.Parse(File.ReadAllText(file))?.AsObject();
                var root = node?["root"]?.GetValue<string>()?.Trim();
                if (string.IsNullOrWhiteSpace(root)) continue;
                var pid = node?["pid"]?.GetValue<int?>();
                values.Add(new RuntimeRecord(
                    file, root, pid, node?["updatedAt"]?.GetValue<string>(), node?["endpoint"]?.GetValue<string>(),
                    node?["localAuthToken"]?.GetValue<string>(), node?["localBase"]?.GetValue<string>(),
                    node?["tunnel"]?.GetValue<string>(), IsProcessAlive(pid)));
            }
            catch { }
        }
        return values.OrderByDescending(value => value.IsAlive).ThenByDescending(value => value.UpdatedAt).ToArray();
    }

    public void Select(RuntimeRecord? runtime) => Runtime = runtime;

    public async Task<JsonObject> GetAsync(string path, IReadOnlyDictionary<string, string?>? query = null, CancellationToken cancellationToken = default)
    {
        using var request = CreateRequest(HttpMethod.Get, path, query, null);
        return await SendAsync(request, cancellationToken);
    }

    public async Task<JsonObject> PostAsync(string path, JsonObject body, CancellationToken cancellationToken = default)
    {
        using var request = CreateRequest(HttpMethod.Post, path, null, body);
        return await SendAsync(request, cancellationToken);
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string path, IReadOnlyDictionary<string, string?>? query, JsonObject? body)
    {
        var runtime = Runtime ?? throw new InvalidOperationException("Choose a live CodexFlow workspace first.");
        if (!runtime.IsAlive || string.IsNullOrWhiteSpace(runtime.LocalBase)) throw new InvalidOperationException("This CodexFlow workspace is offline.");
        var builder = new UriBuilder(new Uri(new Uri(runtime.LocalBase.EndsWith('/') ? runtime.LocalBase : runtime.LocalBase + "/"), path.TrimStart('/')));
        if (query is { Count: > 0 })
            builder.Query = string.Join("&", query.Where(pair => pair.Value is not null).Select(pair => $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value!)}"));
        var request = new HttpRequestMessage(method, builder.Uri);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (!string.IsNullOrWhiteSpace(runtime.LocalAuthToken)) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", runtime.LocalAuthToken);
        if (body is not null) request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        return request;
    }

    private async Task<JsonObject> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        using var response = await _http.SendAsync(request, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        JsonObject? parsed = null;
        try { parsed = JsonNode.Parse(text)?.AsObject(); } catch { }
        if (!response.IsSuccessStatusCode)
        {
            var message = parsed?["error"]?["message"]?.GetValue<string>() ?? parsed?["message"]?.GetValue<string>() ?? $"Broker request failed ({(int)response.StatusCode}).";
            throw new InvalidOperationException(message);
        }
        return parsed ?? throw new InvalidOperationException("The broker returned an invalid response.");
    }

    public async Task StartAsync(string root)
    {
        ReloadConfig();
        var config = Config ?? throw new InvalidOperationException("Run codexflow once so the desktop app can locate its broker.");
        Directory.CreateDirectory(System.IO.Path.Combine(Home, "logs"));
        var log = System.IO.Path.Combine(Home, "logs", $"desktop-{SafeName(root)}.log");
        var start = new ProcessStartInfo
        {
            FileName = config.NodePath,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = root
        };
        start.ArgumentList.Add(config.LauncherPath);
        foreach (var argument in new[] { "start", "--root", root, "--non-interactive", "--no-copy-url", "--no-open-app" }) start.ArgumentList.Add(argument);
        start.Environment["CODEXFLOW_HOME"] = config.CodexflowHome;
        start.Environment["PATH"] = config.Path;
        start.Environment["CODEXFLOW_DESKTOP_PARENT"] = Environment.ProcessId.ToString();
        _launched = Process.Start(start) ?? throw new InvalidOperationException("The broker process could not be started.");
        _ = PumpLogAsync(_launched, log);
        for (var attempt = 0; attempt < 30; attempt++)
        {
            await Task.Delay(500);
            var runtime = DiscoverRuntimes().FirstOrDefault(value => value.Root.Equals(root, StringComparison.OrdinalIgnoreCase) && value.IsAlive);
            if (runtime is not null) { Select(runtime); return; }
        }
        throw new InvalidOperationException($"The broker did not become ready. Review {log}.");
    }

    public async Task StopAsync()
    {
        if (Runtime?.Pid is not int pid || pid <= 1) return;
        try
        {
            using var process = Process.GetProcessById(pid);
            process.Kill(entireProcessTree: false);
            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
        }
        catch (ArgumentException) { }
    }

    public string PrivateServerUrl()
    {
        var runtime = Runtime ?? throw new InvalidOperationException("Choose a workspace first.");
        var endpoint = runtime.Endpoint ?? throw new InvalidOperationException("This runtime does not expose an MCP endpoint.");
        if (string.IsNullOrWhiteSpace(runtime.LocalAuthToken)) return endpoint;
        return endpoint + (endpoint.Contains('?') ? "&" : "?") + "codexflow_token=" + Uri.EscapeDataString(runtime.LocalAuthToken);
    }

    private static bool IsProcessAlive(int? pid)
    {
        if (pid is null or <= 1) return false;
        try { using var process = Process.GetProcessById(pid.Value); return !process.HasExited; }
        catch { return false; }
    }

    private static async Task PumpLogAsync(Process process, string path)
    {
        try
        {
            await using var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
            await using var writer = new StreamWriter(stream) { AutoFlush = true };
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            await Task.WhenAll(stdout, stderr);
            await writer.WriteAsync(await stdout);
            await writer.WriteAsync(await stderr);
        }
        catch { }
    }

    private static string SafeName(string root)
    {
        var value = string.Concat(root.Select(ch => char.IsLetterOrDigit(ch) ? ch : '-')).Trim('-');
        return value[..Math.Min(80, value.Length)];
    }

    public void Dispose()
    {
        _http.Dispose();
        _launched?.Dispose();
    }
}
