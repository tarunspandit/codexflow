using Microsoft.Win32;
using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace CodexFlow.Windows;

public partial class MainWindow : Window
{
    private static readonly (string Id, string Icon, string Label)[] Sections =
    [
        ("now", "✦", "Now"), ("projects", "▱", "Projects"), ("environments", "◫", "Environments"),
        ("worktrees", "⑂", "Worktrees"), ("changes", "±", "Changes"), ("tasks", "☷", "Tasks"),
        ("hosts", "⌘", "Hosts"), ("computer", "▣", "Computer"), ("browser", "◉", "Browser"),
        ("connection", "⌁", "Connection"), ("policy", "☷", "Policy")
    ];

    private readonly BrokerClient _broker;
    private readonly BrowserCoordinator _browser;
    private readonly DispatcherTimer _refreshTimer = new() { Interval = TimeSpan.FromSeconds(2.5) };
    private readonly DispatcherTimer _browserTimer = new() { Interval = TimeSpan.FromMilliseconds(450) };
    private readonly Dictionary<string, Button> _nav = [];
    private string _section = "now";
    private bool _refreshing;
    private bool _browserPolling;
    private JsonObject? _overview;
    private JsonObject? _profile;
    private JsonObject? _remotes;
    private JsonObject? _computer;
    private JsonObject? _browserOverview;
    private JsonObject? _changes;

    public MainWindow()
    {
        InitializeComponent();
        var home = ArgumentValue("--home");
        _broker = new BrokerClient(home);
        _browser = new BrowserCoordinator();
        _browser.AnnotationChanged += () => Dispatcher.Invoke(() => { if (_section == "browser") Render(); });
        BuildNavigation();
        Loaded += async (_, _) =>
        {
            await RefreshAsync(true);
            _refreshTimer.Tick += async (_, _) => await RefreshAsync(false);
            _browserTimer.Tick += async (_, _) => await PollBrowserAsync();
            _refreshTimer.Start();
            _browserTimer.Start();
        };
        Closed += async (_, _) => { _refreshTimer.Stop(); _browserTimer.Stop(); await _browser.DisposeAsync(); _broker.Dispose(); };
    }

    private static string? ArgumentValue(string key)
    {
        var args = Environment.GetCommandLineArgs();
        var index = Array.IndexOf(args, key);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    private void BuildNavigation()
    {
        foreach (var section in Sections)
        {
            var button = new Button { Content = $"{section.Icon}     {section.Label}", Tag = section.Id == _section ? "selected" : section.Id, Style = (Style)FindResource("NavButton") };
            button.Click += (_, _) => SelectSection(section.Id);
            NavigationPanel.Children.Add(button);
            _nav[section.Id] = button;
        }
    }

    private void SelectSection(string section)
    {
        _section = section;
        foreach (var pair in _nav) pair.Value.Tag = pair.Key == section ? "selected" : pair.Key;
        Render();
    }

    private async Task RefreshAsync(bool force)
    {
        if (_refreshing) return;
        _refreshing = true;
        try
        {
            _broker.ReloadConfig();
            var previousRoot = _broker.Runtime?.Root;
            var runtimes = _broker.DiscoverRuntimes();
            var selected = runtimes.FirstOrDefault(value => value.Root.Equals(previousRoot, StringComparison.OrdinalIgnoreCase))
                ?? runtimes.FirstOrDefault(value => value.IsAlive)
                ?? runtimes.FirstOrDefault(value => value.Root.Equals(_broker.Config?.DefaultRoot, StringComparison.OrdinalIgnoreCase))
                ?? runtimes.FirstOrDefault();
            _broker.Select(selected);
            ReconcileRuntimePicker(runtimes, selected);
            if (selected?.IsAlive == true)
            {
                var overviewTask = _broker.GetAsync("/api/overview", force ? new Dictionary<string, string?> { ["refresh"] = "1" } : null);
                var profileTask = _broker.GetAsync("/admin/profile");
                await Task.WhenAll(overviewTask, profileTask);
                _overview = await overviewTask;
                _profile = await profileTask;
                _remotes = await TryGet("/admin/remotes");
                _computer = await TryGet("/admin/computer");
                _browserOverview = await TryGet("/admin/browser");
                SetConnectionState(true, selected);
            }
            else
            {
                _overview = _profile = _remotes = _computer = _browserOverview = _changes = null;
                SetConnectionState(false, selected);
            }
            Render();
        }
        catch (Exception error)
        {
            SetConnectionState(false, _broker.Runtime, "Needs attention");
            ShowNotice(error.Message);
            Render();
        }
        finally { _refreshing = false; }
    }

    private async Task<JsonObject?> TryGet(string path)
    {
        try { return await _broker.GetAsync(path); } catch { return null; }
    }

    private void ReconcileRuntimePicker(IReadOnlyList<RuntimeRecord> runtimes, RuntimeRecord? selected)
    {
        RuntimePicker.SelectionChanged -= RuntimePicker_SelectionChanged;
        RuntimePicker.ItemsSource = runtimes;
        RuntimePicker.SelectedItem = runtimes.FirstOrDefault(value => value.FilePath == selected?.FilePath);
        RuntimePicker.SelectionChanged += RuntimePicker_SelectionChanged;
    }

    private void SetConnectionState(bool live, RuntimeRecord? runtime, string? label = null)
    {
        var green = Brush("Success");
        var muted = new SolidColorBrush(Color.FromRgb(112, 128, 141));
        HeaderState.Text = label ?? (live ? "Live" : "Offline");
        RailState.Text = label ?? (live ? "Live" : "Ready to start");
        HeaderStateDot.Fill = RailStateDot.Fill = live ? green : muted;
        var workspaceName = runtime?.Name;
        if (string.IsNullOrWhiteSpace(workspaceName) && _broker.Config?.DefaultRoot is { Length: > 0 } root) workspaceName = System.IO.Path.GetFileName(root);
        HeaderWorkspace.Text = RailWorkspace.Text = workspaceName ?? "No project selected";
        HeaderPath.Text = runtime?.Root ?? _broker.Config?.DefaultRoot ?? "Run codexflow once to connect this app.";
    }

    private async void RuntimePicker_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (RuntimePicker.SelectedItem is RuntimeRecord runtime)
        {
            _broker.Select(runtime);
            await RefreshAsync(true);
        }
    }

    private void Render()
    {
        PageContent.Children.Clear();
        switch (_section)
        {
            case "now": RenderNow(); break;
            case "projects": RenderProjects(); break;
            case "environments": RenderEnvironments(); break;
            case "worktrees": RenderWorktrees(); break;
            case "changes": RenderChanges(); break;
            case "tasks": RenderTasks(); break;
            case "hosts": RenderHosts(); break;
            case "computer": RenderComputer(); break;
            case "browser": RenderBrowser(); break;
            case "connection": RenderConnection(); break;
            case "policy": RenderPolicy(); break;
        }
    }

    private void RenderNow()
    {
        Heading("LOCAL CODING BRIDGE", _broker.Runtime?.IsAlive == true ? $"{_broker.Runtime.Name} is connected." : "Your work, routed clearly.",
            "A private bridge between ChatGPT and the projects, terminals, Git state, approvals, and tools on this computer.");
        var broker = Obj(_overview, "broker");
        var hero = Card();
        hero.Background = new SolidColorBrush(Color.FromRgb(14, 28, 41));
        hero.Child = Vertical(
            Text($"Broker {Str(broker, "version", "—")}", 13, new SolidColorBrush(Color.FromRgb(155, 210, 243)), FontWeights.SemiBold),
            Text(_broker.Runtime?.IsAlive == true ? "One private endpoint. Every task stays isolated." : "Start the selected project when you are ready.", 24, Brushes.White, FontWeights.SemiBold),
            Text(_broker.Runtime?.IsAlive == true ? $"Public routing is {(_broker.Runtime.Tunnel is { Length: > 0 } ? "available" : "local-only")}; each web task receives its own route." : "CodexFlow will discover projects automatically and expose only the capabilities you approve.", 13, new SolidColorBrush(Color.FromArgb(170, 255, 255, 255))));
        PageContent.Children.Add(hero);
        var summary = Obj(_overview, "summary");
        var metrics = new UniformGrid { Columns = 4, Margin = new Thickness(0, 14, 0, 20) };
        metrics.Children.Add(Metric(Str(summary, "projects", Arr(_overview, "projects").Count.ToString()), "Projects", "discovered locally"));
        metrics.Children.Add(Metric(Str(summary, "active_sessions", "0"), "Active tasks", "isolated routes"));
        metrics.Children.Add(Metric(Str(summary, "activity_events", Arr(_overview, "activity").Count.ToString()), "Recent actions", "content-free events"));
        metrics.Children.Add(Metric(Duration(Long(broker, "uptime_ms")), "Uptime", "broker available"));
        PageContent.Children.Add(metrics);
        var columns = new Grid(); columns.ColumnDefinitions.Add(new ColumnDefinition()); columns.ColumnDefinitions.Add(new ColumnDefinition());
        var recent = Card(); recent.Margin = new Thickness(0, 0, 8, 0); recent.Child = ListCard("Recent tasks", Arr(_overview, "sessions").Take(6), item => $"{Str(item, "title", "Selecting project")}\n{Str(item, "id", "task")}  ·  {Str(item, "tool_calls", "0")} calls");
        var activity = Card(); activity.Margin = new Thickness(8, 0, 0, 0); activity.Child = ListCard("Live activity", Arr(_overview, "activity").Take(6), item => $"{Str(item, "label", Str(item, "tool", "Activity"))}\n{Str(item, "route_display", "local")}  ·  {Str(item, "duration_ms", "—")} ms");
        Grid.SetColumn(activity, 1); columns.Children.Add(recent); columns.Children.Add(activity); PageContent.Children.Add(columns);
    }

    private void RenderProjects()
    {
        Heading("DISCOVERED WORK", "Projects", "Choose once in ChatGPT. CodexFlow keeps each task bound to that project’s real folder.");
        var values = Arr(_overview, "projects");
        if (values.Count == 0) { Empty("No projects discovered", "Start a broker or refresh discovery from the top bar."); return; }
        foreach (var project in values)
        {
            var card = Card();
            var row = new Grid(); row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.Children.Add(Vertical(Text(Str(project, "name", "Project"), 17, Brush("Ink"), FontWeights.SemiBold), Mono(Str(project, "root", "")), Text(string.Join(" · ", Arr(project, "sources").Select(node => node?.ToString() ?? "")), 11, Brush("InkMuted"))));
            var pill = Pill(Bool(project, "is_default") ? "Default" : "Available", Bool(project, "is_default") ? Brush("Signal") : Brush("Success")); Grid.SetColumn(pill, 1); row.Children.Add(pill);
            card.Child = row; PageContent.Children.Add(card);
        }
    }

    private void RenderEnvironments()
    {
        Heading("REPRODUCIBLE SETUP", "Environments", "Run checked-in setup, cleanup, and project actions in the selected workspace terminal.");
        var values = Arr(_overview, "environments");
        if (values.Count == 0) { Empty("No local environments", "Add a .codex/environments/environment.toml file to define reproducible actions."); return; }
        foreach (var environment in values)
        {
            var body = Vertical(Text(Str(environment, "name", "Environment"), 17, Brush("Ink"), FontWeights.SemiBold), Mono(Str(environment, "config_path", "")), Text($"{Str(environment, "platform", "all")} · {(Bool(environment, "inherited") ? "inherited" : "project")}", 11, Brush("InkMuted")));
            var actions = new WrapPanel { Margin = new Thickness(0, 14, 0, 0) };
            if (Bool(environment, "has_setup")) actions.Children.Add(ActionButton("Set up", async () => await EnvironmentAction(environment, "setup"), true));
            foreach (var action in Arr(environment, "actions")) actions.Children.Add(ActionButton(Str(action, "name", "Run"), async () => await EnvironmentAction(environment, "run", Str(action, "name", ""))));
            if (Bool(environment, "has_cleanup")) actions.Children.Add(ActionButton("Clean up", async () => await EnvironmentAction(environment, "cleanup")));
            body.Children.Add(actions); var card = Card(); card.Child = body; PageContent.Children.Add(card);
        }
    }

    private async Task EnvironmentAction(JsonNode? environment, string action, string? actionName = null)
    {
        var body = new JsonObject { ["action"] = action, ["configPath"] = Str(environment, "config_path", "") };
        if (!string.IsNullOrWhiteSpace(actionName)) body["actionName"] = actionName;
        await Mutate("/admin/environments", body);
    }

    private void RenderWorktrees()
    {
        Heading("PARALLEL WORK", "Worktrees", "Create isolated branches without disturbing the selected project’s working tree.");
        var composer = Card(); var baseRef = Input("HEAD", 200); var include = new CheckBox { Content = "Carry current changes", IsChecked = false, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 12, 0) };
        var create = ActionButton("Create worktree", async () => await Mutate("/admin/worktrees", new JsonObject { ["action"] = "create", ["baseRef"] = baseRef.Text, ["includeChanges"] = include.IsChecked == true }), true);
        composer.Child = Vertical(Text("New managed worktree", 15, Brush("Ink"), FontWeights.SemiBold), Horizontal(baseRef, include, create)); PageContent.Children.Add(composer);
        var values = Arr(_overview, "worktrees");
        if (values.Count == 0) { Empty("No managed worktrees", "Create one above when you want an independent implementation lane."); return; }
        foreach (var worktree in values)
        {
            var remove = ActionButton("Remove", async () => await Mutate("/admin/worktrees", new JsonObject { ["action"] = "remove", ["worktreeId"] = Str(worktree, "id", "") }), danger: true);
            var state = !Bool(worktree, "exists") ? "missing" : Bool(worktree, "dirty") ? "uncommitted changes" : "clean";
            var card = Card(); card.Child = Split(Vertical(Text(Str(worktree, "branch", Str(worktree, "id", "Worktree")), 16, Brush("Ink"), FontWeights.SemiBold), Mono(Str(worktree, "project_root", "")), Text($"{state} · base {Str(worktree, "base_ref", "HEAD")}", 11, Brush("InkMuted"))), remove); PageContent.Children.Add(card);
        }
    }

    private void RenderChanges()
    {
        Heading("REVIEW BEFORE ACTION", "Changes", "Inspect files and hunks, annotate review findings, and mutate Git only through explicit controls.");
        if (_broker.Runtime?.IsAlive != true) { Empty("Workspace offline", "Start the selected project to inspect its Git state."); return; }
        if (_changes is null) { Empty("Loading changes", "Reading the working tree without recording file contents."); _ = LoadChanges(); return; }
        var summary = Obj(_changes, "summary");
        var metrics = new UniformGrid { Columns = 3, Margin = new Thickness(0, 0, 0, 16) };
        metrics.Children.Add(Metric(Str(summary, "files", Arr(_changes, "files").Count.ToString()), "Changed files", "working tree + index"));
        metrics.Children.Add(Metric(Str(summary, "staged", "0"), "Staged", "ready for commit"));
        metrics.Children.Add(Metric(Str(summary, "unstaged", "0"), "Unstaged", "working tree")); PageContent.Children.Add(metrics);
        var layout = new Grid(); layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(320) }); layout.ColumnDefinitions.Add(new ColumnDefinition());
        var filePanel = Vertical(Text("Files", 15, Brush("Ink"), FontWeights.SemiBold));
        foreach (var file in Arr(_changes, "staged").Concat(Arr(_changes, "unstaged")))
        {
            var path = Str(file, "path", ""); var staged = Bool(file, "staged");
            var button = ActionButton($"{Str(file, "status", "M")}  {path}", async () => await LoadChanges(path, staged)); button.HorizontalContentAlignment = HorizontalAlignment.Left; button.Width = 300; filePanel.Children.Add(button);
        }
        var filesCard = Card(); filesCard.Child = filePanel; layout.Children.Add(filesCard);
        var selected = Obj(_changes, "selected");
        FrameworkElement detail;
        if (selected is null) detail = Vertical(Text("Select a file", 18, Brush("Ink"), FontWeights.SemiBold), Text("The bounded diff and review controls will appear here.", 12, Brush("InkMuted")));
        else
        {
            var path = Str(selected, "path", ""); var staged = Bool(selected, "staged");
            var controls = new WrapPanel { Margin = new Thickness(0, 12, 0, 12) };
            controls.Children.Add(ActionButton(staged ? "Unstage file" : "Stage file", async () => await ChangeAction(staged ? "unstage" : "stage", path)));
            if (!staged) controls.Children.Add(ActionButton("Discard", async () => { if (Confirm("Discard this file’s working-tree changes?")) await ChangeAction("discard", path); }, danger: true));
            var diff = new TextBox { Text = Str(selected, "diff", "No textual diff is available."), IsReadOnly = true, FontFamily = new FontFamily("Consolas"), FontSize = 11, TextWrapping = TextWrapping.NoWrap, AcceptsReturn = true, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MinHeight = 380, Background = Brush("GroundRaised"), Foreground = new SolidColorBrush(Color.FromRgb(224, 231, 236)), BorderThickness = new Thickness(0), Padding = new Thickness(16) };
            var content = Vertical(Text(path, 17, Brush("Ink"), FontWeights.SemiBold), controls, diff);
            foreach (var hunk in Arr(selected, "hunks"))
            {
                var hunkId = Str(hunk, "id", ""); var hunkControls = new WrapPanel();
                hunkControls.Children.Add(ActionButton(staged ? "Unstage hunk" : "Stage hunk", async () => await Mutate("/admin/changes", new JsonObject { ["action"] = staged ? "unstage_hunk" : "stage_hunk", ["path"] = path, ["staged"] = staged, ["hunkId"] = hunkId })));
                if (!staged) hunkControls.Children.Add(ActionButton("Revert hunk", async () => { if (Confirm("Revert this hunk from the working tree?")) await Mutate("/admin/changes", new JsonObject { ["action"] = "discard_hunk", ["path"] = path, ["staged"] = false, ["hunkId"] = hunkId }); }, danger: true));
                var note = Input("Review note", 420); var line = Input(Str(hunk, "start_line", "1"), 72);
                hunkControls.Children.Add(line); hunkControls.Children.Add(note);
                hunkControls.Children.Add(ActionButton("Add comment", async () => await Mutate("/admin/changes", new JsonObject { ["action"] = "comment", ["path"] = path, ["staged"] = staged, ["hunkId"] = hunkId, ["line"] = int.TryParse(line.Text, out var value) ? value : 1, ["body"] = note.Text }), true));
                content.Children.Add(Vertical(Mono(Str(hunk, "header", "Hunk")), hunkControls));
            }
            foreach (var comment in Arr(selected, "comments"))
            {
                var commentCard = Card(); commentCard.Child = Split(Vertical(Text($"Line {Str(comment, "line", "—")}", 12, Brush("Ink"), FontWeights.SemiBold), Text(Str(comment, "body", ""), 12, Brush("InkMuted"))), ActionButton("Delete", async () => await Mutate("/admin/changes", new JsonObject { ["action"] = "delete_comment", ["path"] = path, ["staged"] = staged, ["commentId"] = Str(comment, "id", "") }), danger: true)); content.Children.Add(commentCard);
            }
            detail = content;
        }
        var detailCard = Card(); detailCard.Margin = new Thickness(14, 0, 0, 0); detailCard.Child = detail; Grid.SetColumn(detailCard, 1); layout.Children.Add(detailCard); PageContent.Children.Add(layout);
    }

    private async Task LoadChanges(string? path = null, bool staged = false)
    {
        try
        {
            var query = new Dictionary<string, string?>();
            if (!string.IsNullOrWhiteSpace(path)) { query["path"] = path; query["staged"] = staged ? "true" : "false"; }
            _changes = await _broker.GetAsync("/admin/changes", query);
            if (_section == "changes") Render();
        }
        catch (Exception error) { ShowNotice(error.Message); }
    }

    private async Task ChangeAction(string action, string path) => await Mutate("/admin/changes", new JsonObject { ["action"] = action, ["paths"] = new JsonArray(path) });

    private void RenderTasks()
    {
        Heading("INDEPENDENT ROUTES", "Tasks", "Web conversations are isolated by route. Prompt text, file contents, command output, and credentials are not recorded here.");
        var values = Arr(_overview, "sessions");
        if (values.Count == 0) { Empty("No routed tasks", "Invoke CodexFlow from a ChatGPT conversation; the task will appear after its first tool call."); return; }
        foreach (var task in values.OrderByDescending(item => Bool(item, "pinned")))
        {
            var id = Str(task, "id", ""); var taskProgress = Obj(task, "task"); var title = Input(Str(task, "title", Str(taskProgress, "title", "Untitled task")), 260);
            var buttons = new WrapPanel();
            buttons.Children.Add(ActionButton("Rename", async () => await TaskAction(id, "rename", title: title.Text)));
            buttons.Children.Add(ActionButton(Bool(task, "pinned") ? "Unpin" : "Pin", async () => await TaskAction(id, "pin", value: !Bool(task, "pinned"))));
            buttons.Children.Add(ActionButton(Bool(task, "archived") ? "Restore" : "Archive", async () => await TaskAction(id, "archive", value: !Bool(task, "archived")), danger: !Bool(task, "archived")));
            var project = Obj(task, "project"); var metadata = $"{Str(task, "state", "active")} · {Str(task, "tool_calls", "0")} calls · {Str(task, "errors", "0")} errors · {Str(project, "name", "selecting project")}";
            var card = Card(); card.Child = Vertical(Horizontal(title, buttons), Mono(id), Text(metadata, 11, Brush("InkMuted"))); PageContent.Children.Add(card);
        }
    }

    private async Task TaskAction(string chatId, string action, string? title = null, bool? value = null)
    {
        var body = new JsonObject { ["action"] = action, ["chatId"] = chatId };
        if (title is not null) body["title"] = title;
        if (value.HasValue) body["value"] = value.Value;
        await Mutate("/admin/chats", body);
    }

    private void RenderHosts()
    {
        Heading("REMOTE PROJECTS", "Hosts", "Approve SSH aliases, verify their identity and tools, then save only the remote folders you intend to expose.");
        if (_remotes is null) { Empty("Remote discovery unavailable", "Start the broker to inspect SSH aliases from this computer."); return; }
        foreach (var host in Arr(_remotes, "hosts"))
        {
            var alias = Str(host, "alias", ""); var root = Input("Remote project path", 300); var controls = new WrapPanel();
            controls.Children.Add(ActionButton("Verify", async () => await RemoteAction("verify", alias), true));
            if (Bool(host, "approved")) controls.Children.Add(ActionButton("Disconnect", async () => await RemoteAction("disconnect", alias), danger: true));
            controls.Children.Add(root); controls.Children.Add(ActionButton("Save project", async () => await RemoteAction("save_project", alias, root.Text)));
            var detail = $"{Str(host, "user", "user")}@{Str(host, "hostname", "host")}:{Str(host, "port", "22")} · {Str(host, "status", "unverified")}";
            var card = Card(); card.Child = Vertical(Split(Text(alias, 17, Brush("Ink"), FontWeights.SemiBold), Pill(Bool(host, "approved") ? "Approved" : "Discovered", Bool(host, "approved") ? Brush("Success") : Brush("Warning"))), Mono(detail), controls); PageContent.Children.Add(card);
        }
        foreach (var project in Arr(_remotes, "projects"))
        {
            var card = Card(); card.Child = Split(Vertical(Text(Str(project, "name", "Remote project"), 15, Brush("Ink"), FontWeights.SemiBold), Mono($"{Str(project, "host_alias", "host")}:{Str(project, "root", "")}")), ActionButton("Remove", async () => await Mutate("/admin/remotes", new JsonObject { ["action"] = "remove_project", ["projectId"] = Str(project, "id", "") }), danger: true)); PageContent.Children.Add(card);
        }
    }

    private async Task RemoteAction(string action, string alias, string? root = null)
    {
        var body = new JsonObject { ["action"] = action, ["alias"] = alias }; if (!string.IsNullOrWhiteSpace(root)) body["root"] = root; await Mutate("/admin/remotes", body);
    }

    private void RenderComputer()
    {
        Heading("NATIVE APP BOUNDARY", "Computer", "A routed task can inspect and operate one approved Windows app. Every consequential action returns here for confirmation.");
        if (_computer is null) { Empty("Computer Use unavailable", "Install or reopen the Windows CodexFlow app so its signed UI Automation helper is available."); return; }
        var status = Obj(_computer, "status");
        var statusCard = Card(); statusCard.Child = Split(Vertical(Text(Bool(status, "available") ? "Windows UI Automation is ready" : "Native helper needs attention", 17, Brush("Ink"), FontWeights.SemiBold), Text(Str(status, "error", "Screen capture and accessibility are scoped to the approved application."), 12, Brush("InkMuted"))), Pill(Bool(status, "available") ? "Ready" : "Unavailable", Bool(status, "available") ? Brush("Success") : Brush("Danger"))); PageContent.Children.Add(statusCard);
        var access = Arr(_computer, "access_requests"); var actions = Arr(_computer, "action_requests");
        if (access.Count > 0 || actions.Count > 0) PageContent.Children.Add(Label("PENDING APPROVALS"));
        foreach (var request in access)
        {
            var buttons = Horizontal(
                ActionButton("Allow once", async () => await ComputerAction("decide_access", requestId: Str(request, "id", ""), decision: "allow_once"), true),
                ActionButton("Always allow", async () => await ComputerAction("decide_access", requestId: Str(request, "id", ""), decision: "always_allow")),
                ActionButton("Deny", async () => await ComputerAction("decide_access", requestId: Str(request, "id", ""), decision: "deny"), danger: true));
            var card = Card(); card.BorderBrush = Brush("Warning"); card.Child = Vertical(Text(Str(request, "app_name", "Application"), 17, Brush("Ink"), FontWeights.SemiBold), Text(Str(request, "reason", "No reason provided."), 12, Brush("InkMuted")), Mono(Str(request, "route_display", "route")), buttons); PageContent.Children.Add(card);
        }
        foreach (var request in actions)
        {
            var detail = $"{Str(request, "operation", "action")} · {Str(request, "target", "target")}";
            var card = Card(); card.BorderBrush = Brush("Warning"); card.Child = Split(Vertical(Text(Str(request, "app_name", "Application"), 16, Brush("Ink"), FontWeights.SemiBold), Text(detail, 12, Brush("InkMuted")), Text(Str(request, "value_preview", ""), 11, Brush("InkMuted"))), Horizontal(ActionButton("Approve", async () => await ComputerAction("decide_action", requestId: Str(request, "id", ""), approve: true), true), ActionButton("Deny", async () => await ComputerAction("decide_action", requestId: Str(request, "id", ""), approve: false), danger: true))); PageContent.Children.Add(card);
        }
        PageContent.Children.Add(Label("ALWAYS ALLOWED"));
        foreach (var allowed in Arr(_computer, "always_allowed"))
        {
            var card = Card(); card.Child = Split(Vertical(Text(Str(allowed, "app_name", "Application"), 15, Brush("Ink"), FontWeights.SemiBold), Mono(Str(allowed, "bundle_id", ""))), ActionButton("Revoke", async () => await ComputerAction("revoke", bundleId: Str(allowed, "bundle_id", "")), danger: true)); PageContent.Children.Add(card);
        }
        PageContent.Children.Add(Label("RUNNING APPS"));
        var apps = new WrapPanel(); foreach (var app in Arr(_computer, "apps")) apps.Children.Add(Pill(Str(app, "name", "App"), Bool(app, "prohibited") ? Brush("Danger") : Bool(app, "active") ? Brush("Signal") : Brush("Success"))); PageContent.Children.Add(apps);
    }

    private async Task ComputerAction(string action, string? requestId = null, string? decision = null, bool? approve = null, string? bundleId = null)
    {
        var body = new JsonObject { ["action"] = action };
        if (requestId is not null) body["requestId"] = requestId; if (decision is not null) body["decision"] = decision; if (approve.HasValue) body["approve"] = approve.Value; if (bundleId is not null) body["bundleId"] = bundleId;
        _computer = await Mutate("/admin/computer", body, false); Render();
    }

    private void RenderBrowser()
    {
        Heading("EPHEMERAL WEB WORKSPACE", "Browser", "An isolated WebView2 profile with host approvals, per-action confirmation, visual comments, and bounded developer diagnostics.");
        if (_browserOverview is null) { Empty("Browser bridge unavailable", "Start the broker and keep CodexFlow open to service browser commands."); return; }
        var status = Obj(_browserOverview, "status");
        var statusCard = Card(); statusCard.Child = Split(Vertical(Text($"{Str(status, "engine", "WebView2")} · {Str(status, "profile", "ephemeral")}", 17, Brush("Ink"), FontWeights.SemiBold), Text(Bool(status, "native_connected") ? "Native command runner connected." : "Waiting for the Windows browser command runner.", 12, Brush("InkMuted"))), Pill(Bool(status, "native_connected") ? "Connected" : "Connecting", Bool(status, "native_connected") ? Brush("Success") : Brush("Warning"))); PageContent.Children.Add(statusCard);
        foreach (var request in Arr(_browserOverview, "host_requests"))
        {
            var controls = Horizontal(
                ActionButton("Allow once", async () => await BrowserAction("decide_host", requestId: Str(request, "id", ""), decision: "allow_once"), true),
                ActionButton("Always allow", async () => await BrowserAction("decide_host", requestId: Str(request, "id", ""), decision: "always_allow")),
                ActionButton("Deny", async () => await BrowserAction("decide_host", requestId: Str(request, "id", ""), decision: "deny"), danger: true));
            var card = Card(); card.BorderBrush = Brush("Warning"); card.Child = Vertical(Text(Str(request, "origin", "Website"), 17, Brush("Ink"), FontWeights.SemiBold), Text(Str(request, "reason", "No reason supplied."), 12, Brush("InkMuted")), controls); PageContent.Children.Add(card);
        }
        foreach (var request in Arr(_browserOverview, "action_requests"))
        {
            var card = Card(); card.BorderBrush = Brush("Warning"); card.Child = Split(Vertical(Text(Str(request, "origin", "Website"), 16, Brush("Ink"), FontWeights.SemiBold), Text($"{Str(request, "operation", "action")} · {Str(request, "target", "target")}", 12, Brush("InkMuted")), Text(Str(request, "value_preview", ""), 11, Brush("InkMuted"))), Horizontal(ActionButton("Approve", async () => await BrowserAction("decide_action", requestId: Str(request, "id", ""), approve: true), true), ActionButton("Deny", async () => await BrowserAction("decide_action", requestId: Str(request, "id", ""), approve: false), danger: true))); PageContent.Children.Add(card);
        }
        var sessions = Arr(_browserOverview, "sessions");
        if (sessions.Count > 0)
        {
            var shell = Card(); var panel = Vertical(Text("Live browser sessions", 15, Brush("Ink"), FontWeights.SemiBold)); var tabs = new WrapPanel { Margin = new Thickness(0, 10, 0, 10) };
            foreach (var session in sessions)
            {
                var id = Str(session, "id", ""); tabs.Children.Add(ActionButton(Str(session, "title", Str(session, "origin", "Page")), () => { _browser.Select(id); Render(); return Task.CompletedTask; }, _browser.SelectedSessionId == id));
            }
            panel.Children.Add(tabs); var surface = _browser.Surface; Detach(surface); surface.MinHeight = 500; panel.Children.Add(surface);
            panel.Children.Add(Horizontal(
                ActionButton("Select element for comment", async () => { await _browser.BeginAnnotationAsync(); ShowNotice("Click an element in the page, then write the review note here."); }, true),
                ActionButton("Capture diagnostics", async () => { await _browser.CaptureSelectedDiagnosticsAsync(); Render(); })));
            if (_browser.AnnotationTarget is { } target)
            {
                var note = Input("Describe the requested change", 440);
                panel.Children.Add(Vertical(Text(target.Target, 13, Brush("Ink"), FontWeights.SemiBold), Mono(target.Selector), Horizontal(note,
                    ActionButton("Share comment", async () =>
                    {
                        if (string.IsNullOrWhiteSpace(note.Text)) { ShowNotice("Write a review note first."); return; }
                        _browserOverview = await Mutate("/admin/browser", new JsonObject { ["action"] = "add_comment", ["sessionId"] = target.SessionId, ["selector"] = target.Selector, ["target"] = target.Target, ["note"] = note.Text.Trim() }, false);
                        await _browser.ClearAnnotationAsync(); Render();
                    }, true), ActionButton("Cancel", async () => { await _browser.ClearAnnotationAsync(); Render(); }))));
            }
            if (_browser.LastDiagnostics is { } snapshot) panel.Children.Add(DiagnosticsPanel(snapshot));
            var selectedId = _browser.SelectedSessionId;
            foreach (var comment in Arr(_browserOverview, "comments").Where(value => Str(value, "session_id", "") == selectedId))
            {
                var row = Card(); row.Child = Split(Vertical(Text(Str(comment, "target", "Page comment"), 13, Brush("Ink"), FontWeights.SemiBold), Text(Str(comment, "note", ""), 12, Brush("InkMuted")), Mono(Str(comment, "selector", ""))), ActionButton("Remove", async () => { _browserOverview = await Mutate("/admin/browser", new JsonObject { ["action"] = "remove_comment", ["commentId"] = Str(comment, "id", "") }, false); Render(); }, danger: true)); panel.Children.Add(row);
            }
            shell.Child = panel; PageContent.Children.Add(shell);
        }
        PageContent.Children.Add(Label("ALWAYS ALLOWED ORIGINS"));
        foreach (var allowed in Arr(_browserOverview, "always_allowed"))
        {
            var card = Card(); card.Child = Split(Mono(Str(allowed, "origin", "")), ActionButton("Revoke", async () => await BrowserAction("revoke", origin: Str(allowed, "origin", "")), danger: true)); PageContent.Children.Add(card);
        }
    }

    private FrameworkElement DiagnosticsPanel(JsonObject snapshot)
    {
        var tabs = new TabControl { Margin = new Thickness(0, 12, 0, 0), MinHeight = 220 };
        tabs.Items.Add(DiagnosticTab("Console", Arr(snapshot, "console"), item => $"{Str(item, "level", "log"),-6} {Str(item, "message", "")}"));
        tabs.Items.Add(DiagnosticTab("Network", Arr(snapshot, "network"), item => $"{Str(item, "status", "—"),-4} {Str(item, "kind", "resource"),-12} {Str(item, "url", "")}"));
        tabs.Items.Add(DiagnosticTab("Sources", Arr(snapshot, "sources"), item => $"{Str(item, "kind", "source"),-12} {Str(item, "url", "")}")); return tabs;
    }

    private TabItem DiagnosticTab(string title, JsonArray values, Func<JsonObject, string> format)
    {
        var text = string.Join(Environment.NewLine, values.OfType<JsonObject>().Select(format));
        return new TabItem { Header = $"{title}  {values.Count}", Content = new TextBox { Text = text, IsReadOnly = true, FontFamily = new FontFamily("Consolas"), FontSize = 11, Background = Brush("GroundRaised"), Foreground = Brushes.White, BorderThickness = new Thickness(0), Padding = new Thickness(14), VerticalScrollBarVisibility = ScrollBarVisibility.Auto } };
    }

    private async Task BrowserAction(string action, string? requestId = null, string? decision = null, bool? approve = null, string? origin = null)
    {
        var body = new JsonObject { ["action"] = action }; if (requestId is not null) body["requestId"] = requestId; if (decision is not null) body["decision"] = decision; if (approve.HasValue) body["approve"] = approve.Value; if (origin is not null) body["origin"] = origin;
        _browserOverview = await Mutate("/admin/browser", body, false); Render();
    }

    private void RenderConnection()
    {
        Heading("PRIVATE ENDPOINT", "Connection", "One broker can route many simultaneous ChatGPT tasks while every route remains bound to its selected project.");
        var runtime = _broker.Runtime;
        var hero = Card(); hero.Child = Vertical(
            Split(Vertical(Text(runtime?.IsAlive == true ? "Connection is live" : "Connection is offline", 21, Brush("Ink"), FontWeights.SemiBold), Text(runtime?.Tunnel is { Length: > 0 } ? "Permanent Cloudflare tunnel enabled." : "No public tunnel is active for this workspace.", 12, Brush("InkMuted"))), Pill(runtime?.IsAlive == true ? "Live" : "Offline", runtime?.IsAlive == true ? Brush("Success") : Brush("Warning"))),
            Horizontal(ActionButton("Copy private server URL", () => { try { Clipboard.SetText(_broker.PrivateServerUrl()); ShowNotice("Private Server URL copied. Its credential was not displayed."); } catch (Exception error) { ShowNotice(error.Message); } return Task.CompletedTask; }, true), ActionButton("Open ChatGPT settings", () => { Process.Start(new ProcessStartInfo("https://chatgpt.com/#settings/Connectors") { UseShellExecute = true }); return Task.CompletedTask; })));
        PageContent.Children.Add(hero);
        var broker = Obj(_overview, "broker");
        var details = Card(); details.Child = Vertical(
            Info("Local status", Str(broker, "local_base", runtime?.LocalBase ?? "—")),
            Info("MCP endpoint", runtime?.Endpoint ?? "—"), Info("Public host", runtime?.Tunnel ?? "Local only"),
            Info("Authentication", Bool(broker, "auth_enabled") ? "Bearer credential required" : "Disabled"),
            Info("Write mode", Str(broker, "write_mode", "—")), Info("Terminal", Str(broker, "bash_mode", "—")),
            Info("Tool surface", Str(broker, "tool_mode", "—")), Info("Task limit", Str(broker, "max_sessions", "—")));
        PageContent.Children.Add(details);
    }

    private void RenderPolicy()
    {
        Heading("CAPABILITY ENVELOPE", "Policy", "Set the behavior advertised to new tasks. Changes are explicit and take effect only after a broker restart.");
        var effective = Obj(_profile, "effective");
        if (effective is null) { Empty("Policy unavailable", "Start the broker to read and edit its next-launch profile."); return; }
        var tunnel = Select(Str(effective, "tunnel", "cloudflare"), "cloudflare", "cloudflare-named", "ngrok", "tailscale", "none");
        var hostname = Input(Str(effective, "hostname", ""), 300);
        var mode = Select(Str(effective, "mode", "agent"), "agent", "handoff", "pro");
        var write = Select(Str(effective, "write", "workspace"), "workspace", "handoff", "off");
        var bash = Select(Str(effective, "bash", "safe"), "safe", "off", "full");
        var toolMode = Select(Str(effective, "tool_mode", "standard"), "minimal", "standard", "full");
        var transcript = Select(Str(effective, "bash_transcript", "compact"), "compact", "full");
        var sessions = Select(Str(effective, "codex_sessions", "metadata"), "off", "metadata", "read");
        var cards = new CheckBox { Content = "Use host-native tool cards", IsChecked = Bool(effective, "tool_cards"), VerticalAlignment = VerticalAlignment.Center };
        var form = Card(); form.Child = Vertical(
            Text("Connection", 16, Brush("Ink"), FontWeights.SemiBold), Field("Tunnel", tunnel), Field("Hostname", hostname),
            Divider(), Text("Agent behavior", 16, Brush("Ink"), FontWeights.SemiBold), Field("Mode", mode), Field("Write", write), Field("Terminal", bash), Field("Tool surface", toolMode),
            Divider(), Text("Context", 16, Brush("Ink"), FontWeights.SemiBold), Field("Bash transcript", transcript), Field("Codex sessions", sessions), Field("Presentation", cards));
        PageContent.Children.Add(form);
        PageContent.Children.Add(ActionButton("Save for next launch", async () =>
        {
            var body = new JsonObject
            {
                ["tunnel"] = tunnel.Text, ["hostname"] = hostname.Text.Trim(), ["mode"] = mode.Text,
                ["write"] = write.Text, ["bash"] = bash.Text, ["toolMode"] = toolMode.Text,
                ["bashTranscript"] = transcript.Text, ["codexSessions"] = sessions.Text, ["toolCards"] = cards.IsChecked == true
            };
            _profile = await Mutate("/admin/profile", body, false); ShowNotice("Policy saved. Restart CodexFlow to apply it."); Render();
        }, true));
    }

    private async Task PollBrowserAsync()
    {
        if (_browserPolling || _broker.Runtime?.IsAlive != true) return;
        _browserPolling = true;
        try
        {
            var response = await _broker.GetAsync("/admin/browser", new Dictionary<string, string?> { ["take"] = "1", ["engine"] = "WebView2" });
            _browserOverview = response;
            var active = Arr(response, "sessions").Select(node => Str(node as JsonObject, "id", "")).Where(value => value.Length > 0).ToHashSet();
            await _browser.ReconcileAsync(active);
            foreach (var command in Arr(response, "commands").OfType<JsonObject>())
            {
                var id = Str(command, "id", "");
                try
                {
                    var result = await _browser.ExecuteAsync(command);
                    await _broker.PostAsync("/admin/browser/complete", new JsonObject { ["commandId"] = id, ["ok"] = true, ["result"] = result });
                }
                catch (Exception error)
                {
                    try { await _broker.PostAsync("/admin/browser/complete", new JsonObject { ["commandId"] = id, ["ok"] = false, ["error"] = error.Message }); } catch { }
                }
            }
            if (_section == "browser" && Arr(response, "commands").Count > 0) Render();
        }
        catch { }
        finally { _browserPolling = false; }
    }

    private async Task<JsonObject> Mutate(string path, JsonObject body, bool refresh = true)
    {
        try
        {
            var response = await _broker.PostAsync(path, body);
            if (path == "/admin/changes") _changes = response;
            else if (path == "/admin/remotes") _remotes = response;
            else if (path == "/admin/computer") _computer = response;
            else if (path == "/admin/browser") _browserOverview = response;
            else if (path == "/admin/profile") _profile = response;
            var message = Str(response, "message", "Updated."); if (message.Length > 0) ShowNotice(message);
            if (refresh) await RefreshAsync(false);
            return response;
        }
        catch (Exception error) { ShowNotice(error.Message); throw; }
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync(true);
    private async void Start_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var root = _broker.Runtime?.Root ?? _broker.Config?.DefaultRoot;
            if (string.IsNullOrWhiteSpace(root))
            {
                var picker = new OpenFolderDialog { Title = "Choose a CodexFlow project", Multiselect = false };
                if (picker.ShowDialog(this) != true) return; root = picker.FolderName;
            }
            ShowNotice($"Starting CodexFlow for {System.IO.Path.GetFileName(root)}…"); await _broker.StartAsync(root); await RefreshAsync(true);
        }
        catch (Exception error) { ShowNotice(error.Message); }
    }
    private async void Stop_Click(object sender, RoutedEventArgs e) { try { await _broker.StopAsync(); await Task.Delay(350); await RefreshAsync(false); ShowNotice("CodexFlow stopped."); } catch (Exception error) { ShowNotice(error.Message); } }
    private async void Restart_Click(object sender, RoutedEventArgs e)
    {
        var root = _broker.Runtime?.Root ?? _broker.Config?.DefaultRoot; if (string.IsNullOrWhiteSpace(root)) { Start_Click(sender, e); return; }
        try { await _broker.StopAsync(); await Task.Delay(450); await _broker.StartAsync(root); await RefreshAsync(true); ShowNotice("CodexFlow restarted."); } catch (Exception error) { ShowNotice(error.Message); }
    }

    private void ShowNotice(string message) { NoticeText.Text = message; Notice.Visibility = Visibility.Visible; }
    private void DismissNotice_Click(object sender, RoutedEventArgs e) => Notice.Visibility = Visibility.Collapsed;
    private void TitleBar_Drag(object sender, MouseButtonEventArgs e) { if (e.ClickCount == 2) Maximize_Click(sender, e); else DragMove(); }
    private void Minimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
    private void Maximize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    private void Heading(string eyebrow, string title, string detail)
    {
        PageContent.Children.Add(Vertical(Text(eyebrow, 10, Brush("InkMuted"), FontWeights.SemiBold), Text(title, 31, Brush("Ink"), FontWeights.SemiBold), Text(detail, 14, Brush("InkMuted"))));
    }

    private Border Card() => new() { Background = Brush("PaperBright"), BorderBrush = Brush("Line"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(18), Padding = new Thickness(20), Margin = new Thickness(0, 14, 0, 0) };
    private Border Metric(string value, string title, string detail) { var card = Card(); card.Margin = new Thickness(5); card.Child = Vertical(Text(value, 27, Brush("Ink"), FontWeights.SemiBold), Text(title, 13, Brush("Ink"), FontWeights.SemiBold), Text(detail, 11, Brush("InkMuted"))); return card; }
    private void Empty(string title, string detail) { var card = Card(); card.MinHeight = 180; card.Child = Vertical(Text("◇", 28, Brush("Signal")), Text(title, 17, Brush("Ink"), FontWeights.SemiBold), Text(detail, 12, Brush("InkMuted"))); PageContent.Children.Add(card); }
    private StackPanel ListCard(string title, IEnumerable<JsonNode?> values, Func<JsonObject, string> format) { var panel = Vertical(Text(title, 16, Brush("Ink"), FontWeights.SemiBold)); foreach (var value in values.OfType<JsonObject>()) { panel.Children.Add(Divider()); panel.Children.Add(Text(format(value), 12, Brush("Ink"))); } return panel; }
    private static StackPanel Vertical(params UIElement[] children) { var panel = new StackPanel(); foreach (var child in children) { if (child is FrameworkElement value) value.Margin = new Thickness(value.Margin.Left, value.Margin.Top + 5, value.Margin.Right, value.Margin.Bottom + 5); panel.Children.Add(child); } return panel; }
    private static StackPanel Horizontal(params UIElement[] children) { var panel = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 8, 0, 0) }; foreach (var child in children) { if (child is FrameworkElement value) value.Margin = new Thickness(0, 0, 9, 0); panel.Children.Add(child); } return panel; }
    private static Grid Split(UIElement left, UIElement right) { var grid = new Grid(); grid.ColumnDefinitions.Add(new ColumnDefinition()); grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); grid.Children.Add(left); Grid.SetColumn(right, 1); grid.Children.Add(right); return grid; }
    private static void Detach(FrameworkElement element)
    {
        switch (element.Parent)
        {
            case Panel panel: panel.Children.Remove(element); break;
            case ContentControl content when ReferenceEquals(content.Content, element): content.Content = null; break;
            case Decorator decorator when ReferenceEquals(decorator.Child, element): decorator.Child = null; break;
        }
    }
    private TextBlock Text(string value, double size, Brush brush, FontWeight? weight = null) => new() { Text = value, FontSize = size, Foreground = brush, FontWeight = weight ?? FontWeights.Normal, TextWrapping = TextWrapping.Wrap, MaxWidth = 850 };
    private TextBlock Mono(string value) => new() { Text = value, FontFamily = new FontFamily("Consolas"), FontSize = 11, Foreground = Brush("InkMuted"), TextWrapping = TextWrapping.Wrap };
    private TextBlock Label(string value) => new() { Text = value, FontSize = 10, FontWeight = FontWeights.SemiBold, Foreground = Brush("InkMuted"), Margin = new Thickness(0, 24, 0, 2) };
    private Border Pill(string value, Brush color) => new() { Background = new SolidColorBrush(((SolidColorBrush)color).Color) { Opacity = .12 }, BorderBrush = color, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(15), Padding = new Thickness(10, 6, 10, 6), Child = Text(value, 11, Brush("Ink"), FontWeights.SemiBold), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(5) };
    private Button ActionButton(string label, Func<Task> action, bool primary = false, bool danger = false) { var button = new Button { Content = label, Style = (Style)FindResource(danger ? "DangerButton" : primary ? "PrimaryButton" : "FlowButton"), Margin = new Thickness(0, 4, 8, 4) }; button.Click += async (_, _) => { button.IsEnabled = false; try { await action(); } catch { } finally { button.IsEnabled = true; } }; return button; }
    private TextBox Input(string value, double width) => new() { Text = value, Width = width, Style = (Style)FindResource("FlowTextBox"), Margin = new Thickness(0, 4, 8, 4) };
    private ComboBox Select(string value, params string[] values) { var box = new ComboBox { Width = 220, ItemsSource = values, SelectedItem = value, Padding = new Thickness(10, 8, 10, 8), Margin = new Thickness(0, 4, 0, 4) }; if (box.SelectedItem is null) box.SelectedIndex = 0; return box; }
    private Grid Field(string label, UIElement control) { var grid = new Grid { Margin = new Thickness(0, 4, 0, 4) }; grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(180) }); grid.ColumnDefinitions.Add(new ColumnDefinition()); grid.Children.Add(Text(label, 12, Brush("InkMuted"), FontWeights.SemiBold)); Grid.SetColumn(control, 1); grid.Children.Add(control); return grid; }
    private Grid Info(string label, string value) => Field(label, Mono(value));
    private Border Divider() => new() { Height = 1, Background = Brush("Line"), Margin = new Thickness(0, 14, 0, 14) };
    private Brush Brush(string key) => (Brush)FindResource(key);
    private bool Confirm(string message) => MessageBox.Show(this, message, "CodexFlow", MessageBoxButton.OKCancel, MessageBoxImage.Warning) == MessageBoxResult.OK;

    private static JsonNode? Value(JsonNode? parent, string key)
    {
        var value = parent as JsonObject; if (value is null) return null;
        if (value.TryGetPropertyValue(key, out var direct)) return direct;
        var alternate = key.Contains('_')
            ? string.Concat(key.Split('_').Select((part, index) => index == 0 ? part : char.ToUpperInvariant(part[0]) + part[1..]))
            : string.Concat(key.Select((character, index) => char.IsUpper(character) && index > 0 ? "_" + char.ToLowerInvariant(character) : character.ToString()));
        return value[alternate];
    }
    private static JsonObject? Obj(JsonNode? parent, string key) => Value(parent, key) as JsonObject;
    private static JsonArray Arr(JsonNode? parent, string key) => Value(parent, key) as JsonArray ?? [];
    private static string Str(JsonNode? value, string key, string fallback = "") => Value(value, key)?.ToString() is { Length: > 0 } text ? text : fallback;
    private static bool Bool(JsonNode? value, string key) => bool.TryParse(Value(value, key)?.ToString(), out var result) && result;
    private static long Long(JsonNode? value, string key) => long.TryParse(Value(value, key)?.ToString(), out var result) ? result : 0;
    private static string Duration(long milliseconds) { var span = TimeSpan.FromMilliseconds(milliseconds); return span.TotalHours >= 1 ? $"{(int)span.TotalHours}h" : span.TotalMinutes >= 1 ? $"{(int)span.TotalMinutes}m" : $"{Math.Max(0, (int)span.TotalSeconds)}s"; }
}
