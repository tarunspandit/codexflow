using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows.Automation;

namespace CodexFlowComputer;

internal static class Program
{
    private const int MaxElements = 240;
    private const int MaxDepth = 20;

    [STAThread]
    private static int Main()
    {
        try
        {
            using var reader = new StreamReader(Console.OpenStandardInput());
            var request = JsonNode.Parse(reader.ReadToEnd())?.AsObject() ?? throw new InvalidOperationException("The helper request was invalid.");
            var result = Handle(request); result["ok"] = true;
            Console.Write(result.ToJsonString()); return 0;
        }
        catch (Exception error)
        {
            Console.Write(new JsonObject { ["ok"] = false, ["error"] = Clean(error.Message) }.ToJsonString()); return 1;
        }
    }

    private static JsonObject Handle(JsonObject request) => Text(request, "action") switch
    {
        "status" or "request_permissions" => Status(),
        "list_apps" => new JsonObject { ["apps"] = new JsonArray(ListApps().Select(value => (JsonNode)value.Json).ToArray()) },
        "snapshot" => Snapshot(request),
        "perform" => Perform(request),
        _ => throw new InvalidOperationException("Unsupported Computer Use helper action.")
    };

    private static JsonObject Status() => new() { ["available"] = true, ["platform"] = "win32", ["screen_recording"] = true, ["accessibility"] = true };

    private sealed record AppRecord(Process Process, AutomationElement Element, string BundleId, string Identity, string Name, JsonObject Json);

    private static List<AppRecord> ListApps()
    {
        var result = new List<AppRecord>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var walker = TreeWalker.RawViewWalker;
        for (var element = walker.GetFirstChild(AutomationElement.RootElement); element is not null; element = walker.GetNextSibling(element))
        {
            try
            {
                var pid = element.Current.ProcessId;
                if (pid <= 0 || pid == Environment.ProcessId) continue;
                using var process = Process.GetProcessById(pid);
                if (process.HasExited || process.MainWindowHandle == IntPtr.Zero) continue;
                var path = process.MainModule?.FileName; if (string.IsNullOrWhiteSpace(path)) continue;
                var bundle = BundleId(process.ProcessName, path); if (!seen.Add(bundle)) continue;
                var identity = Identity(path); var name = Clean(element.Current.Name);
                if (string.IsNullOrWhiteSpace(name)) name = process.ProcessName;
                var prohibited = ProhibitedReason(process.ProcessName, path);
                var json = new JsonObject
                {
                    ["bundle_id"] = bundle, ["name"] = name, ["pid"] = pid,
                    ["active"] = process.MainWindowHandle == GetForegroundWindow(), ["identity"] = identity,
                    ["prohibited"] = prohibited is not null
                };
                if (prohibited is not null) json["prohibited_reason"] = prohibited;
                result.Add(new AppRecord(Process.GetProcessById(pid), element, bundle, identity, name, json));
            }
            catch { }
        }
        return result.OrderByDescending(value => value.Json["active"]?.GetValue<bool>() == true).ThenBy(value => value.Name).Take(200).ToList();
    }

    private static JsonObject Snapshot(JsonObject request)
    {
        var app = FindApp(Text(request, "bundleId"), Text(request, "expectedIdentity"));
        var elements = new JsonArray(); var path = new List<int>();
        Walk(app.Element, path, elements, 0);
        return new JsonObject
        {
            ["platform"] = "win32", ["bundle_id"] = app.BundleId, ["app_name"] = app.Name,
            ["pid"] = app.Process.Id, ["identity"] = app.Identity, ["elements"] = elements,
            ["screenshot_base64"] = Capture(app.Process.MainWindowHandle)
        };
    }

    private static void Walk(AutomationElement parent, List<int> path, JsonArray output, int depth)
    {
        if (depth >= MaxDepth || output.Count >= MaxElements) return;
        AutomationElementCollection children;
        try { children = parent.FindAll(TreeScope.Children, Condition.TrueCondition); } catch { return; }
        for (var index = 0; index < children.Count && output.Count < MaxElements; index++)
        {
            var element = children[index]; path.Add(index);
            try
            {
                var current = element.Current; var bounds = current.BoundingRectangle; var role = Role(current.ControlType);
                if (!current.IsOffscreen && bounds.Width > 0 && bounds.Height > 0 && role.Length > 0)
                {
                    var actions = new JsonArray();
                    if (Supports(element, InvokePattern.Pattern)) actions.Add("press");
                    if (current.IsKeyboardFocusable) actions.Add("focus");
                    if (!current.IsPassword && Supports(element, ValuePattern.Pattern)) actions.Add("set_value");
                    if (current.IsKeyboardFocusable) actions.Add("key");
                    string value = "";
                    if (!current.IsPassword && Supports(element, ValuePattern.Pattern)) { try { value = Clean(((ValuePattern)element.GetCurrentPattern(ValuePattern.Pattern)).Current.Value); } catch { } }
                    output.Add(new JsonObject
                    {
                        ["path"] = new JsonArray(path.Select(value => (JsonNode)value).ToArray()), ["role"] = role,
                        ["subrole"] = Clean(current.LocalizedControlType), ["title"] = Clean(current.Name), ["value"] = value,
                        ["x"] = Math.Round(bounds.X), ["y"] = Math.Round(bounds.Y), ["width"] = Math.Round(bounds.Width), ["height"] = Math.Round(bounds.Height), ["actions"] = actions
                    });
                }
            }
            catch { }
            Walk(element, path, output, depth + 1); path.RemoveAt(path.Count - 1);
        }
    }

    private static JsonObject Perform(JsonObject request)
    {
        var app = FindApp(Text(request, "bundleId"), Text(request, "expectedIdentity"));
        var indices = request["elementPath"] is JsonArray values ? values.Select(value => value?.GetValue<int>() ?? -1).ToArray() : [];
        var element = Resolve(app.Element, indices); var expectedRole = Text(request, "expectedRole");
        if (!Role(element.Current.ControlType).Equals(expectedRole, StringComparison.Ordinal)) throw new InvalidOperationException("The interface changed. Observe the application again.");
        var expectedTitle = Text(request, "expectedTitle");
        if (expectedTitle.Length > 0 && !Clean(element.Current.Name).Equals(expectedTitle, StringComparison.Ordinal)) throw new InvalidOperationException("The target label changed. Observe the application again.");
        var operation = Text(request, "operation");
        switch (operation)
        {
            case "press": ((InvokePattern)element.GetCurrentPattern(InvokePattern.Pattern)).Invoke(); break;
            case "focus": element.SetFocus(); break;
            case "set_value":
                if (element.Current.IsPassword) throw new InvalidOperationException("CodexFlow will not type into secure fields.");
                var input = Text(request, "value"); if (input.Length > 4000) throw new InvalidOperationException("Text input exceeded its safety limit.");
                ((ValuePattern)element.GetCurrentPattern(ValuePattern.Pattern)).SetValue(input); break;
            case "key":
                element.SetFocus(); System.Windows.Forms.SendKeys.SendWait(Text(request, "key") switch { "return" => "{ENTER}", "tab" => "{TAB}", "escape" => "{ESC}", "space" => " ", "delete" => "{DELETE}", _ => throw new InvalidOperationException("Unsupported key.") }); break;
            default: throw new InvalidOperationException("Unsupported Computer Use operation.");
        }
        return new JsonObject { ["completed"] = true, ["operation"] = operation };
    }

    private static AppRecord FindApp(string bundleId, string expectedIdentity)
    {
        var app = ListApps().SingleOrDefault(value => value.BundleId.Equals(bundleId, StringComparison.OrdinalIgnoreCase)) ?? throw new InvalidOperationException("The approved application is no longer running.");
        if (!CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(app.Identity), System.Text.Encoding.UTF8.GetBytes(expectedIdentity))) throw new InvalidOperationException("The application identity changed.");
        if (ProhibitedReason(app.Process.ProcessName, app.Process.MainModule?.FileName ?? "") is not null) throw new InvalidOperationException("This protected application cannot be automated.");
        return app;
    }

    private static AutomationElement Resolve(AutomationElement root, IReadOnlyList<int> path)
    {
        var current = root;
        foreach (var index in path)
        {
            var children = current.FindAll(TreeScope.Children, Condition.TrueCondition);
            if (index < 0 || index >= children.Count) throw new InvalidOperationException("The interface changed. Observe the application again.");
            current = children[index];
        }
        return current;
    }

    private static bool Supports(AutomationElement element, AutomationPattern pattern) { try { return element.TryGetCurrentPattern(pattern, out _); } catch { return false; } }
    private static string Role(ControlType type) => type.ProgrammaticName.Replace("ControlType.", "", StringComparison.Ordinal).ToLowerInvariant();
    private static string BundleId(string processName, string path)
    {
        var name = processName.ToLowerInvariant();
        if (name is "cmd" or "powershell" or "pwsh" or "windowsterminal") return "com.microsoft.terminal";
        if (name.Contains("chatgpt")) return "com.openai.chat";
        if (name.Contains("codexflow")) return "com.flow7.codexflow";
        if (name is "msedge" or "chrome" or "firefox" or "brave") return "com.windows.browser." + name;
        return "win32." + Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(Path.GetFullPath(path).ToLowerInvariant())))[..24].ToLowerInvariant();
    }

    private static string Identity(string path)
    {
        try
        {
            using var certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(path));
            return "signed:" + certificate.Thumbprint + ":" + Path.GetFullPath(path).ToLowerInvariant();
        }
        catch { using var stream = File.OpenRead(path); return "sha256:" + Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant(); }
    }

    private static string? ProhibitedReason(string processName, string path)
    {
        var name = processName.ToLowerInvariant();
        if (name is "cmd" or "powershell" or "pwsh" or "windowsterminal") return "Terminal apps cannot be automated because that could bypass CodexFlow shell policy.";
        if (name.Contains("chatgpt") || name.Contains("codex")) return "ChatGPT and Codex cannot be automated because that could bypass host approvals.";
        if (name.Contains("codexflow")) return "CodexFlow cannot automate its own approval surface.";
        if (name is "msedge" or "chrome" or "firefox" or "brave") return "Browser apps require the separate website-host permission boundary.";
        if (path.Contains("SystemSettings", StringComparison.OrdinalIgnoreCase)) return "System security settings must be changed by the user.";
        return null;
    }

    private static string Capture(IntPtr handle)
    {
        if (!GetWindowRect(handle, out var rect)) return "";
        var width = Math.Clamp(rect.Right - rect.Left, 1, 4096); var height = Math.Clamp(rect.Bottom - rect.Top, 1, 4096);
        using var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            var device = graphics.GetHdc();
            try { if (!PrintWindow(handle, device, 2)) throw new InvalidOperationException("Windows could not capture the approved application window."); }
            finally { graphics.ReleaseHdc(device); }
        }
        using var stream = new MemoryStream(); bitmap.Save(stream, ImageFormat.Png); return Convert.ToBase64String(stream.ToArray());
    }

    private static string Text(JsonObject value, string key) => value[key]?.ToString() ?? "";
    private static string Clean(string? value) => string.Join(" ", (value ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).Trim()[..Math.Min(500, string.Join(" ", (value ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).Trim().Length)];

    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
}
