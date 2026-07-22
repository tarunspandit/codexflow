using System.IO;
using System.Windows;

namespace CodexFlow.Windows;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (e.Args.Contains("--smoke", StringComparer.OrdinalIgnoreCase))
        {
            var index = Array.FindIndex(e.Args, value => value.Equals("--smoke-output", StringComparison.OrdinalIgnoreCase));
            if (index >= 0 && index + 1 < e.Args.Length)
                File.WriteAllText(e.Args[index + 1], "{\"ok\":true,\"platform\":\"win32\",\"surface\":\"native-management\"}\n");
            Shutdown(0);
            return;
        }
        new MainWindow().Show();
    }
}
