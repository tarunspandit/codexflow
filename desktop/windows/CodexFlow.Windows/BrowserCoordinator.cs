using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows.Controls;
using System.Windows.Media;

namespace CodexFlow.Windows;

internal sealed class BrowserCoordinator : IAsyncDisposable
{
    internal sealed record AnnotationSelection(string SessionId, string Selector, string Target);
    private sealed class Session
    {
        public required string Id { get; init; }
        public required WebView2 View { get; init; }
        public required string DataPath { get; init; }
        public HashSet<string> AllowedOrigins { get; set; } = new(StringComparer.OrdinalIgnoreCase);
        public string? Error { get; set; }
    }

    private readonly Dictionary<string, Session> _sessions = [];
    private readonly HashSet<string> _inFlight = [];
    public ContentControl Surface { get; } = new() { Background = new SolidColorBrush(Color.FromRgb(17, 20, 25)) };
    public string? SelectedSessionId { get; private set; }
    public JsonObject? LastDiagnostics { get; private set; }
    public AnnotationSelection? AnnotationTarget { get; private set; }
    public event Action? AnnotationChanged;

    public void Select(string sessionId)
    {
        if (!_sessions.TryGetValue(sessionId, out var session)) return;
        SelectedSessionId = sessionId;
        Surface.Content = session.View;
        LastDiagnostics = null;
    }

    public async Task<JsonObject> ExecuteAsync(JsonObject command)
    {
        var commandId = Text(command, "id");
        if (!_inFlight.Add(commandId)) throw new InvalidOperationException("This browser command is already running.");
        try
        {
            var action = Text(command, "action");
            var sessionId = Text(command, "session_id");
            return action switch
            {
                "open" => await OpenAsync(sessionId, Text(command, "url"), Strings(command, "allowed_origins")),
                "observe" => await ObserveAsync(sessionId, Strings(command, "allowed_origins")),
                "act" => await ActAsync(sessionId, command, Strings(command, "allowed_origins")),
                "diagnostics" => await DiagnosticsAsync(sessionId, Strings(command, "allowed_origins")),
                "close" => await CloseAsync(sessionId),
                _ => throw new InvalidOperationException("Unsupported native browser command.")
            };
        }
        finally { _inFlight.Remove(commandId); }
    }

    private async Task<JsonObject> OpenAsync(string sessionId, string rawUrl, string[] allowed)
    {
        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var target) || !IsWeb(target)) throw new InvalidOperationException("The browser URL was invalid.");
        if (!allowed.Contains(Origin(target), StringComparer.OrdinalIgnoreCase)) throw new InvalidOperationException("The requested website origin is not approved.");
        if (_sessions.ContainsKey(sessionId)) await CloseAsync(sessionId);
        var dataPath = Path.Combine(Path.GetTempPath(), "CodexFlow", "WebView2", sessionId + "-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dataPath);
        var view = new WebView2 { DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 251, 248, 244) };
        var session = new Session { Id = sessionId, View = view, DataPath = dataPath, AllowedOrigins = allowed.ToHashSet(StringComparer.OrdinalIgnoreCase) };
        _sessions[sessionId] = session;
        var environment = await CoreWebView2Environment.CreateAsync(null, dataPath, new CoreWebView2EnvironmentOptions("--disable-features=msEdgeAutofill,msEdgePasswordManagerService"));
        await view.EnsureCoreWebView2Async(environment);
        await view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(DiagnosticsBootstrap);
        view.CoreWebView2.Settings.AreDevToolsEnabled = false;
        view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        view.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
        view.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
        view.CoreWebView2.Settings.IsStatusBarEnabled = false;
        view.CoreWebView2.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
        view.CoreWebView2.NewWindowRequested += (_, args) => args.Handled = true;
        view.CoreWebView2.DownloadStarting += (_, args) => args.Cancel = true;
        view.CoreWebView2.BasicAuthenticationRequested += (_, args) => args.Cancel = true;
        view.CoreWebView2.ClientCertificateRequested += (_, args) => args.Handled = true;
        view.CoreWebView2.WebMessageReceived += (_, args) =>
        {
            try
            {
                var message = JsonNode.Parse(args.TryGetWebMessageAsString())?.AsObject();
                var selector = message?["selector"]?.ToString() ?? ""; var target = message?["target"]?.ToString() ?? "";
                if (selector.Length is > 0 and <= 1000 && target.Length is > 0 and <= 300)
                {
                    AnnotationTarget = new AnnotationSelection(sessionId, selector, target); AnnotationChanged?.Invoke();
                }
            }
            catch { }
        };
        view.CoreWebView2.NavigationStarting += (_, args) =>
        {
            if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var destination) || !IsAllowed(session, destination))
            {
                args.Cancel = true; session.Error = "Navigation was blocked because the destination origin is not approved.";
            }
            else session.Error = null;
        };
        Select(sessionId);
        var completion = new TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs>(TaskCreationOptions.RunContinuationsAsynchronously);
        void Completed(object? _, CoreWebView2NavigationCompletedEventArgs args) => completion.TrySetResult(args);
        view.NavigationCompleted += Completed;
        view.Source = target;
        var navigation = await completion.Task.WaitAsync(TimeSpan.FromSeconds(22));
        view.NavigationCompleted -= Completed;
        if (!navigation.IsSuccess) throw new InvalidOperationException(session.Error ?? $"The page failed to load ({navigation.WebErrorStatus}).");
        EnsureCurrentAllowed(session);
        return Identity(session);
    }

    private async Task<JsonObject> ObserveAsync(string sessionId, string[] allowed)
    {
        var session = Require(sessionId); UpdateAllowed(session, allowed); EnsureCurrentAllowed(session);
        var snapshot = "nav_" + Convert.ToHexString(Guid.NewGuid().ToByteArray()[..8]).ToLowerInvariant();
        var script = $$"""
        (() => {
          const snapshot = {{JsonSerializer.Serialize(snapshot)}};
          const clean = value => String(value || '').replace(/\s+/g, ' ').slice(0, 500);
          const visible = element => { const style = getComputedStyle(element); const box = element.getBoundingClientRect(); return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0; };
          const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex]')).filter(visible).slice(0, 300);
          window.__codexflowElements = new Map();
          return { native_snapshot_id:snapshot, elements:candidates.map((element, index) => {
            const id = `dom_${snapshot.slice(4)}_${index}`; window.__codexflowElements.set(id, element);
            const box = element.getBoundingClientRect(); const type = clean(element.getAttribute('type'));
            return {id, role:clean(element.getAttribute('role') || element.tagName.toLowerCase()), name:clean(element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.value), text:type === 'password' ? '' : clean(element.innerText), type, href:element.href || undefined, disabled:Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'), x:Math.round(box.x), y:Math.round(box.y), width:Math.round(box.width), height:Math.round(box.height)};
          })};
        })()
        """;
        var result = await ScriptObject(session.View, script);
        await using var stream = new MemoryStream();
        await session.View.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
        result["screenshot_base64"] = Convert.ToBase64String(stream.ToArray());
        MergeIdentity(result, session); return result;
    }

    private async Task<JsonObject> ActAsync(string sessionId, JsonObject command, string[] allowed)
    {
        var session = Require(sessionId); UpdateAllowed(session, allowed); EnsureCurrentAllowed(session);
        var elementId = Text(command, "element_id"); var operation = Text(command, "operation"); var value = Text(command, "value"); var key = Text(command, "key");
        var script = $$"""
        (() => {
          const element = window.__codexflowElements?.get({{JsonSerializer.Serialize(elementId)}});
          if (!element || !element.isConnected) throw new Error('The selected element is stale. Observe the page again.');
          const operation = {{JsonSerializer.Serialize(operation)}}; const value = {{JsonSerializer.Serialize(value)}}; const key = {{JsonSerializer.Serialize(key)}};
          if (operation === 'click') element.click();
          else if (operation === 'focus') element.focus();
          else if (operation === 'scroll_into_view') element.scrollIntoView({block:'center', inline:'nearest'});
          else if (operation === 'set_value') { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set; setter ? setter.call(element, value) : element.value = value; element.dispatchEvent(new Event('input', {bubbles:true})); element.dispatchEvent(new Event('change', {bubbles:true})); }
          else if (operation === 'key') { const names={return:'Enter',tab:'Tab',escape:'Escape',space:' ',delete:'Delete'}; const resolved=names[key]; if (!resolved) throw new Error('Unsupported key.'); element.dispatchEvent(new KeyboardEvent('keydown',{key:resolved,bubbles:true})); element.dispatchEvent(new KeyboardEvent('keyup',{key:resolved,bubbles:true})); }
          else throw new Error('Unsupported browser operation.');
          return {completed:true};
        })()
        """;
        var result = await ScriptObject(session.View, script); EnsureCurrentAllowed(session);
        return new JsonObject { ["operation"] = operation, ["result"] = result };
    }

    private async Task<JsonObject> DiagnosticsAsync(string sessionId, string[] allowed)
    {
        var session = Require(sessionId); UpdateAllowed(session, allowed); EnsureCurrentAllowed(session);
        var result = await ScriptObject(session.View, DiagnosticsScript); LastDiagnostics = result.DeepClone().AsObject(); return result;
    }

    public async Task CaptureSelectedDiagnosticsAsync()
    {
        if (SelectedSessionId is null) return;
        LastDiagnostics = await DiagnosticsAsync(SelectedSessionId, Require(SelectedSessionId).AllowedOrigins.ToArray());
    }

    public async Task BeginAnnotationAsync()
    {
        if (SelectedSessionId is null) return;
        var session = Require(SelectedSessionId); AnnotationTarget = null;
        await session.View.ExecuteScriptAsync("""
        (() => {
          if (window.__codexflowAnnotationCleanup) window.__codexflowAnnotationCleanup();
          const selectorFor = element => { const parts=[]; let node=element; while(node&&node.nodeType===1&&parts.length<8){let part=node.tagName.toLowerCase();const parent=node.parentElement;if(parent){const siblings=Array.from(parent.children).filter(item=>item.tagName===node.tagName);if(siblings.length>1)part+=`:nth-of-type(${siblings.indexOf(node)+1})`;}parts.unshift(part);if(node===document.body)break;node=parent;}return parts.join(' > ').slice(0,1000); };
          const handler = event => { const element=event.target instanceof Element?event.target:null;if(!element||String(element.type||'').toLowerCase()==='password')return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();cleanup();const box=element.getBoundingClientRect();const overlay=document.createElement('div');overlay.dataset.codexflowAnnotationOverlay='';Object.assign(overlay.style,{position:'fixed',pointerEvents:'none',zIndex:'2147483647',left:`${Math.max(0,box.left)}px`,top:`${Math.max(0,box.top)}px`,width:`${Math.max(1,box.width)}px`,height:`${Math.max(1,box.height)}px`,border:'2px solid #79B5DC',borderRadius:'4px',boxSizing:'border-box',background:'rgba(121,181,220,.10)',boxShadow:'0 0 0 3px rgba(8,9,11,.28)'});document.documentElement.appendChild(overlay);const role=element.getAttribute('role')||element.tagName.toLowerCase();const label=element.getAttribute('aria-label')||element.getAttribute('title')||(element.innerText||'').trim().replace(/\s+/g,' ').slice(0,180);chrome.webview.postMessage(JSON.stringify({selector:selectorFor(element),target:`${role}${label?` · ${label}`:''}`.slice(0,300)})); };
          const cleanup = () => { document.removeEventListener('click',handler,true);document.documentElement.style.cursor=''; };
          window.__codexflowAnnotationCleanup=cleanup;document.documentElement.style.cursor='crosshair';document.addEventListener('click',handler,true);return true;
        })()
        """);
    }

    public async Task ClearAnnotationAsync()
    {
        AnnotationTarget = null;
        if (SelectedSessionId is { } id)
        {
            try { await Require(id).View.ExecuteScriptAsync("window.__codexflowAnnotationCleanup?.();document.querySelectorAll('[data-codexflow-annotation-overlay]').forEach(node=>node.remove());true"); } catch { }
        }
        AnnotationChanged?.Invoke();
    }

    private async Task<JsonObject> CloseAsync(string sessionId)
    {
        if (_sessions.Remove(sessionId, out var session))
        {
            if (Surface.Content == session.View) Surface.Content = null;
            try { await session.View.CoreWebView2.Profile.ClearBrowsingDataAsync(); } catch { }
            session.View.Dispose();
            try { Directory.Delete(session.DataPath, true); } catch { }
        }
        if (SelectedSessionId == sessionId) { SelectedSessionId = _sessions.Keys.FirstOrDefault(); if (SelectedSessionId is not null) Select(SelectedSessionId); }
        if (AnnotationTarget?.SessionId == sessionId) AnnotationTarget = null;
        return new JsonObject { ["closed"] = true };
    }

    public async Task ReconcileAsync(IReadOnlySet<string> active)
    {
        foreach (var id in _sessions.Keys.Where(id => !active.Contains(id)).ToArray()) await CloseAsync(id);
    }

    private Session Require(string id) => _sessions.TryGetValue(id, out var session) ? session : throw new InvalidOperationException("The ephemeral browser session is no longer open.");
    private static void UpdateAllowed(Session session, IEnumerable<string> values) => session.AllowedOrigins = values.ToHashSet(StringComparer.OrdinalIgnoreCase);
    private static bool IsWeb(Uri value) => (value.Scheme == Uri.UriSchemeHttps || value.Scheme == Uri.UriSchemeHttp) && string.IsNullOrEmpty(value.UserInfo);
    private static string Origin(Uri value) => value.GetLeftPart(UriPartial.Authority).ToLowerInvariant();
    private static bool IsAllowed(Session session, Uri value) => IsWeb(value) && session.AllowedOrigins.Contains(Origin(value));
    private static void EnsureCurrentAllowed(Session session) { if (session.View.Source is not Uri source || !IsAllowed(session, source)) throw new InvalidOperationException("The page reached a website origin that is not approved."); }
    private static JsonObject Identity(Session session) => new() { ["url"] = session.View.Source?.AbsoluteUri ?? "about:blank", ["title"] = session.View.CoreWebView2.DocumentTitle ?? session.View.Source?.Host ?? "Untitled" };
    private static void MergeIdentity(JsonObject target, Session session) { foreach (var pair in Identity(session)) target[pair.Key] = pair.Value?.DeepClone(); }

    private static async Task<JsonObject> ScriptObject(WebView2 view, string script)
    {
        var raw = await view.ExecuteScriptAsync(script);
        var node = JsonNode.Parse(raw);
        if (node is JsonValue value && value.TryGetValue<string>(out var serialized)) node = JsonNode.Parse(serialized);
        return node as JsonObject ?? throw new InvalidOperationException("The native browser returned an invalid result.");
    }

    private static string Text(JsonObject value, string key) => value[key]?.ToString() ?? "";
    private static string[] Strings(JsonObject value, string key) => value[key] is JsonArray array ? array.Select(node => node?.ToString() ?? "").Where(item => item.Length > 0).ToArray() : [];

    public async ValueTask DisposeAsync()
    {
        foreach (var id in _sessions.Keys.ToArray()) await CloseAsync(id);
    }

    private const string DiagnosticsBootstrap = """
    (() => {
      const state = window.__codexflowDiagnostics = {console:[]};
      const cleanURL = raw => { try { const value=new URL(String(raw||''), document.baseURI); return ['http:','https:'].includes(value.protocol) ? `${value.origin}${value.pathname}`.slice(0,1000) : null; } catch { return null; } };
      const secret = value => /(bearer\s+[a-z0-9._-]{12,}|api[_-]?key|access[_-]?token|password\s*[:=])/i.test(value);
      for (const level of ['debug','info','log','warn','error']) { const original=console[level]; console[level]=function(...args) { try { const message=args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ').slice(0,2000); if (message && !secret(message)) { state.console.push({at:new Date().toISOString(),level,message,source:cleanURL(location.href)}); if(state.console.length>100)state.console.shift(); } } catch {} return original.apply(console,args); }; }
    })();
    """;

    private const string DiagnosticsScript = """
    (() => {
      const cleanURL=raw=>{try{const value=new URL(String(raw||''),document.baseURI);return ['http:','https:'].includes(value.protocol)?`${value.origin}${value.pathname}`.slice(0,1000):null}catch{return null}};
      const number=(value,max)=>Number.isFinite(Number(value))?Math.max(0,Math.min(max,Math.round(Number(value)))):0;
      const timing=[...performance.getEntriesByType('navigation').slice(-1),...performance.getEntriesByType('resource').slice(-99)];
      const network=timing.map(entry=>{const url=cleanURL(entry.name);if(!url)return null;const status=number(entry.responseStatus,599);return {url,kind:String(entry.initiatorType||entry.entryType||'resource').slice(0,40),status:status||undefined,duration_ms:number(entry.duration,600000),transfer_bytes:number(entry.transferSize,100000000)||undefined}}).filter(Boolean);
      const sources=[];const seen=new Set();const add=(raw,kind)=>{const url=cleanURL(raw);if(!url||seen.has(`${kind}|${url}`))return;seen.add(`${kind}|${url}`);sources.push({url,kind})};add(location.href,'document');document.querySelectorAll('script[src]').forEach(node=>add(node.src,'script'));document.querySelectorAll('link[rel~="stylesheet"][href]').forEach(node=>add(node.href,'stylesheet'));
      return {captured_at:new Date().toISOString(),console:(window.__codexflowDiagnostics?.console||[]).slice(-100),network,sources:sources.slice(0,100)};
    })()
    """;
}
