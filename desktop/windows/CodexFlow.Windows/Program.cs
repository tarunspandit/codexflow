using System.IO;
using System.Text.Json;

namespace CodexFlow.Windows;

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Contains("--smoke", StringComparer.OrdinalIgnoreCase))
            return RunSmoke(args);

        var app = new App();
        app.InitializeComponent();
        return app.Run();
    }

    private static int RunSmoke(string[] args)
    {
        var index = Array.FindIndex(args, value => value.Equals("--smoke-output", StringComparison.OrdinalIgnoreCase));
        var output = index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
        try
        {
            var app = new App();
            app.InitializeComponent();
            var window = new MainWindow();
            window.Close();
            Write(output, new { ok = true, platform = "win32", surface = "native-management" });
            return 0;
        }
        catch (Exception error)
        {
            Write(output, new { ok = false, platform = "win32", error = error.ToString() });
            return 1;
        }
    }

    private static void Write(string? output, object value)
    {
        if (!string.IsNullOrWhiteSpace(output))
            File.WriteAllText(output, JsonSerializer.Serialize(value) + Environment.NewLine);
    }
}
