using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;

namespace LingganLauncher;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new LauncherForm());
    }
}

internal sealed class LauncherForm : Form
{
    private const string PayloadResource = "Linggan.Payload.zip";
    private readonly Label statusLabel;
    private readonly ProgressBar progressBar;

    public LauncherForm()
    {
        Text = "灵感工作台";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(440, 164);
        BackColor = Color.FromArgb(250, 248, 245);
        Font = new Font("Microsoft YaHei UI", 9F);

        var eyebrow = new Label {
            AutoSize = true,
            Text = "LINGGAN WORKSPACE",
            ForeColor = Color.FromArgb(194, 65, 12),
            Font = new Font("Segoe UI", 8F, FontStyle.Bold),
            Location = new Point(28, 22),
        };
        var title = new Label {
            AutoSize = true,
            Text = "正在启动灵感工作台",
            ForeColor = Color.FromArgb(34, 29, 22),
            Font = new Font("Microsoft YaHei UI", 15F, FontStyle.Bold),
            Location = new Point(25, 43),
        };
        statusLabel = new Label {
            AutoEllipsis = true,
            Text = "正在准备内置运行环境…",
            ForeColor = Color.FromArgb(105, 96, 86),
            Location = new Point(29, 83),
            Size = new Size(382, 22),
        };
        progressBar = new ProgressBar {
            Style = ProgressBarStyle.Marquee,
            MarqueeAnimationSpeed = 25,
            Location = new Point(29, 116),
            Size = new Size(382, 7),
        };
        Controls.AddRange([eyebrow, title, statusLabel, progressBar]);
        Shown += async (_, _) => await StartAsync();
    }

    private async Task StartAsync()
    {
        try
        {
            SetStatus("首次启动会自动释放程序文件，请稍候…");
            var appDirectory = await Task.Run(PrepareApplication);
            var dataDirectory = PrepareDataDirectory(appDirectory);
            var port = ReadPort();
            var url = $"http://127.0.0.1:{port}/";

            SetStatus("正在检查本地服务…");
            var doctorCode = await RunDoctorAsync(appDirectory, dataDirectory, port);
            if (doctorCode == 2)
            {
                SetStatus("看板已运行，正在打开浏览器…");
                OpenBrowserIfAllowed(url);
                await Task.Delay(350);
                Close();
                return;
            }
            if (doctorCode != 0)
            {
                throw new InvalidOperationException("启动自检未通过。可能存在端口占用、数据目录不可写或程序文件不完整。");
            }

            SetStatus("正在启动服务并打开浏览器…");
            using var server = StartServer(appDirectory, dataDirectory, port);
            if (!await WaitForServerAsync(url, server))
            {
                throw new InvalidOperationException("本地服务未能在预期时间内启动。");
            }
            OpenBrowserIfAllowed(url);
            await Task.Delay(350);
            Close();
        }
        catch (Exception error)
        {
            progressBar.Style = ProgressBarStyle.Continuous;
            progressBar.Value = 0;
            SetStatus("启动失败");
            MessageBox.Show(
                this,
                error.Message + "\n\n可重新运行本文件；如仍失败，请在 GitHub 提交问题。",
                "灵感工作台启动失败",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            Close();
        }
    }

    private void SetStatus(string text)
    {
        statusLabel.Text = text;
        statusLabel.Refresh();
    }

    private static string PrepareApplication()
    {
        var installRoot = Environment.GetEnvironmentVariable("LINGGAN_INSTALL_DIR");
        if (string.IsNullOrWhiteSpace(installRoot))
        {
            installRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "LingganKanban",
                "app"
            );
        }
        installRoot = Path.GetFullPath(installRoot);
        Directory.CreateDirectory(installRoot);

        using var mutex = new Mutex(false, "Local\\LingganKanbanInstaller");
        if (!mutex.WaitOne(TimeSpan.FromSeconds(60)))
        {
            throw new TimeoutException("另一个启动器仍在准备程序文件，请稍后重试。");
        }
        try
        {
            var zipPath = Path.Combine(Path.GetTempPath(), "LingganKanban-" + Guid.NewGuid().ToString("N") + ".zip");
            try
            {
                using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResource)
                    ?? throw new InvalidOperationException("启动器中缺少内置程序包。"))
                using (var output = File.Create(zipPath))
                {
                    resource.CopyTo(output);
                }
                var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(zipPath)));
                var installDirectory = Path.Combine(installRoot, hash[..16]);
                var readyFile = Path.Combine(installDirectory, ".ready");
                if (File.Exists(readyFile) && File.ReadAllText(readyFile).Trim() == hash)
                {
                    return ValidateApplicationDirectory(installDirectory);
                }

                if (Directory.Exists(installDirectory)) Directory.Delete(installDirectory, true);
                var stagingDirectory = installDirectory + ".tmp-" + Guid.NewGuid().ToString("N");
                Directory.CreateDirectory(stagingDirectory);
                try
                {
                    ZipFile.ExtractToDirectory(zipPath, stagingDirectory);
                    var roots = Directory.GetDirectories(stagingDirectory);
                    var extractedRoot = roots.Length == 1 ? roots[0] : stagingDirectory;
                    if (extractedRoot == stagingDirectory)
                    {
                        Directory.Move(stagingDirectory, installDirectory);
                    }
                    else
                    {
                        Directory.Move(extractedRoot, installDirectory);
                        Directory.Delete(stagingDirectory, true);
                    }
                    File.WriteAllText(readyFile, hash);
                }
                catch
                {
                    if (Directory.Exists(stagingDirectory)) Directory.Delete(stagingDirectory, true);
                    if (Directory.Exists(installDirectory)) Directory.Delete(installDirectory, true);
                    throw;
                }
                return ValidateApplicationDirectory(installDirectory);
            }
            finally
            {
                if (File.Exists(zipPath)) File.Delete(zipPath);
            }
        }
        finally
        {
            mutex.ReleaseMutex();
        }
    }

    private static string ValidateApplicationDirectory(string directory)
    {
        var required = new[] {
            Path.Combine(directory, "runtime", "node.exe"),
            Path.Combine(directory, "server.js"),
            Path.Combine(directory, "DATA.example.md"),
        };
        if (required.Any(path => !File.Exists(path)))
        {
            throw new InvalidOperationException("释放后的程序文件不完整。");
        }
        return directory;
    }

    private static string PrepareDataDirectory(string appDirectory)
    {
        var dataDirectory = Environment.GetEnvironmentVariable("LINGGAN_DATA_DIR");
        if (string.IsNullOrWhiteSpace(dataDirectory))
        {
            dataDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "LingganKanban"
            );
        }
        dataDirectory = Path.GetFullPath(dataDirectory);
        Directory.CreateDirectory(dataDirectory);
        Directory.CreateDirectory(Path.Combine(dataDirectory, "entries"));
        var dataFile = Path.Combine(dataDirectory, "DATA.md");
        if (!File.Exists(dataFile))
        {
            File.Copy(Path.Combine(appDirectory, "DATA.example.md"), dataFile);
        }
        return dataDirectory;
    }

    private static int ReadPort()
    {
        return int.TryParse(Environment.GetEnvironmentVariable("PORT"), out var port) && port is > 0 and < 65536
            ? port
            : 3865;
    }

    private static ProcessStartInfo NodeStartInfo(string appDirectory, string dataDirectory, int port, string script)
    {
        var info = new ProcessStartInfo {
            FileName = Path.Combine(appDirectory, "runtime", "node.exe"),
            WorkingDirectory = appDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        info.ArgumentList.Add(script);
        info.Environment["PORT"] = port.ToString();
        info.Environment["README_FILE"] = Path.Combine(dataDirectory, "DATA.md");
        info.Environment["ENTRIES_DIR"] = Path.Combine(dataDirectory, "entries");
        info.Environment["AUDIT_LOG_FILE"] = Path.Combine(dataDirectory, ".linggan", "audit.log");
        info.Environment["NO_OPEN"] = "1";
        return info;
    }

    private static async Task<int> RunDoctorAsync(string appDirectory, string dataDirectory, int port)
    {
        var info = NodeStartInfo(appDirectory, dataDirectory, port, Path.Combine("scripts", "doctor.js"));
        info.ArgumentList.Add("--startup");
        using var process = Process.Start(info) ?? throw new InvalidOperationException("无法运行启动自检。");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await process.WaitForExitAsync(timeout.Token);
        return process.ExitCode;
    }

    private static Process StartServer(string appDirectory, string dataDirectory, int port)
    {
        var info = NodeStartInfo(appDirectory, dataDirectory, port, "server.js");
        return Process.Start(info) ?? throw new InvalidOperationException("无法启动本地服务。");
    }

    private static async Task<bool> WaitForServerAsync(string url, Process server)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(700) };
        for (var attempt = 0; attempt < 30; attempt++)
        {
            if (server.HasExited) return false;
            try
            {
                using var response = await client.GetAsync(url);
                if (response.StatusCode == HttpStatusCode.OK) return true;
            }
            catch (HttpRequestException) { }
            catch (TaskCanceledException) { }
            await Task.Delay(300);
        }
        return false;
    }

    private static void OpenBrowserIfAllowed(string url)
    {
        if (Environment.GetEnvironmentVariable("LINGGAN_NO_OPEN") == "1") return;
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
}
