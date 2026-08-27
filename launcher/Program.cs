using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using Microsoft.Win32;

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
    private readonly CancellationTokenSource lifetime = new();
    private readonly Label statusLabel;
    private readonly ProgressBar progressBar;
    private readonly Button stopButton;
    private Process? ownedServer;
    private Uri? ownedServerUri;
    private string? apiToken;
    private bool detachServer;
    private bool allowClose;
    private bool closeRequested;

    public LauncherForm()
    {
        Text = "灵感工作台";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(440, 184);
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
            Size = new Size(382, 38),
        };
        progressBar = new ProgressBar {
            Style = ProgressBarStyle.Marquee,
            MarqueeAnimationSpeed = 25,
            Location = new Point(29, 126),
            Size = new Size(382, 7),
        };
        stopButton = new Button {
            AutoSize = true,
            Text = "停止服务并退出",
            Location = new Point(287, 145),
            Visible = false,
        };
        stopButton.Click += (_, _) => Close();
        Controls.AddRange(new Control[] { eyebrow, title, statusLabel, progressBar, stopButton });
        FormClosing += HandleFormClosing;
        Shown += async (_, _) => await StartAsync();
    }

    private async Task StartAsync()
    {
        Exception? startupError = null;
        try
        {
            await RunAsync(lifetime.Token);
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
        {
            // The user closed the launcher while it was starting or in browser fallback mode.
        }
        catch (Exception error)
        {
            startupError = error;
        }
        finally
        {
            if (!detachServer)
            {
                SetStatus("正在安全停止本地服务…");
                await StopOwnedServerAsync();
            }
            allowClose = true;
        }

        if (startupError is not null && !closeRequested)
        {
            progressBar.Style = ProgressBarStyle.Continuous;
            progressBar.Value = 0;
            SetStatus("启动失败");
            MessageBox.Show(
                this,
                startupError.Message + "\n\n可重新运行本文件；如仍失败，请在 GitHub 提交问题。",
                "灵感工作台启动失败",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
        if (!IsDisposed) Close();
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        SetStatus("首次启动会自动释放程序文件，请稍候…");
        var appDirectory = await Task.Run(PrepareApplication, cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        var dataDirectory = ResolveDataDirectory();
        var port = ReadPort();
        var serverUri = new Uri($"http://127.0.0.1:{port}/");

        SetStatus("正在检查本地服务…");
        var doctorCode = Directory.Exists(dataDirectory)
            ? await RunDoctorAsync(appDirectory, dataDirectory, port, cancellationToken)
            : 0;
        if (doctorCode == 2)
        {
            if (NoOpenRequested()) return;
            SetStatus("看板已运行，正在打开桌面窗口…");
            using var existingWindow = LaunchDesktopWindow(serverUri, dataDirectory, false);
            if (existingWindow is null) return;
            Hide();
            await existingWindow.WaitForExitAsync(cancellationToken);
            return;
        }
        if (doctorCode != 0)
        {
            throw new InvalidOperationException("启动自检未通过。可能存在端口占用、数据目录不可写或程序文件不完整。");
        }

        SetStatus("正在启动本地服务…");
        apiToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        ownedServerUri = serverUri;
        ownedServer = StartServer(appDirectory, dataDirectory, port, apiToken);
        if (!await WaitForServerAsync(serverUri, ownedServer, cancellationToken))
        {
            throw new InvalidOperationException("本地服务未能在预期时间内启动。");
        }

        if (NoOpenRequested())
        {
            DetachOwnedServer();
            return;
        }

        SetStatus("正在打开独立桌面窗口…");
        using var desktopWindow = LaunchDesktopWindow(serverUri, dataDirectory, true);
        if (desktopWindow is null)
        {
            progressBar.Style = ProgressBarStyle.Continuous;
            progressBar.Value = 0;
            stopButton.Visible = true;
            SetStatus("已在默认浏览器打开；关闭此启动器即可安全停止本地服务。");
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return;
        }

        Hide();
        await desktopWindow.WaitForExitAsync(cancellationToken);
    }

    private void HandleFormClosing(object? sender, FormClosingEventArgs eventArgs)
    {
        if (allowClose) return;
        eventArgs.Cancel = true;
        if (closeRequested) return;
        closeRequested = true;
        stopButton.Enabled = false;
        SetStatus("正在关闭灵感工作台…");
        lifetime.Cancel();
    }

    private void SetStatus(string text)
    {
        if (IsDisposed) return;
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

    private static string ResolveDataDirectory()
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
        return dataDirectory;
    }

    private static int ReadPort()
    {
        return int.TryParse(Environment.GetEnvironmentVariable("PORT"), out var port) && port is > 0 and < 65536
            ? port
            : 3865;
    }

    private static bool NoOpenRequested()
    {
        return Environment.GetEnvironmentVariable("LINGGAN_NO_OPEN") == "1";
    }

    private static ProcessStartInfo NodeStartInfo(
        string appDirectory,
        string dataDirectory,
        int port,
        string script,
        string? token = null
    )
    {
        var info = new ProcessStartInfo {
            FileName = Path.Combine(appDirectory, "runtime", "node.exe"),
            WorkingDirectory = appDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        info.ArgumentList.Add(script);
        info.Environment["PORT"] = port.ToString();
        info.Environment["HOST"] = "127.0.0.1";
        info.Environment["README_FILE"] = Path.Combine(dataDirectory, "DATA.md");
        info.Environment["ENTRIES_DIR"] = Path.Combine(dataDirectory, "entries");
        info.Environment["AUDIT_LOG_FILE"] = Path.Combine(dataDirectory, ".linggan", "audit.log");
        info.Environment["NO_OPEN"] = "1";
        if (!string.IsNullOrEmpty(token)) info.Environment["LINGGAN_API_TOKEN"] = token;
        return info;
    }

    private static async Task<int> RunDoctorAsync(
        string appDirectory,
        string dataDirectory,
        int port,
        CancellationToken cancellationToken
    )
    {
        var info = NodeStartInfo(appDirectory, dataDirectory, port, Path.Combine("scripts", "doctor.js"));
        info.ArgumentList.Add("--startup");
        using var process = Process.Start(info) ?? throw new InvalidOperationException("无法运行启动自检。");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
            return process.ExitCode;
        }
        catch (OperationCanceledException)
        {
            TryStopProcess(process);
            throw;
        }
    }

    private static Process StartServer(string appDirectory, string dataDirectory, int port, string token)
    {
        var info = NodeStartInfo(appDirectory, dataDirectory, port, "server.js", token);
        return Process.Start(info) ?? throw new InvalidOperationException("无法启动本地服务。");
    }

    private static async Task<bool> WaitForServerAsync(Uri uri, Process server, CancellationToken cancellationToken)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(700) };
        for (var attempt = 0; attempt < 30; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (server.HasExited) return false;
            try
            {
                using var response = await client.GetAsync(uri, cancellationToken);
                if (response.StatusCode == HttpStatusCode.OK) return true;
            }
            catch (HttpRequestException) { }
            catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested) { }
            await Task.Delay(300, cancellationToken);
        }
        return false;
    }

    private Process? LaunchDesktopWindow(Uri uri, string dataDirectory, bool ownsServer)
    {
        var edgePath = FindEdgeExecutable();
        if (edgePath is null)
        {
            OpenDefaultBrowser(uri, dataDirectory, ownsServer, null);
            return null;
        }

        try
        {
            var profileDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "LingganKanban",
                "edge-profile"
            );
            Directory.CreateDirectory(profileDirectory);
            var info = new ProcessStartInfo {
                FileName = edgePath,
                WorkingDirectory = Path.GetDirectoryName(edgePath)!,
                UseShellExecute = false,
            };
            info.ArgumentList.Add("--app=" + uri.AbsoluteUri);
            info.ArgumentList.Add("--user-data-dir=" + profileDirectory);
            info.ArgumentList.Add("--no-first-run");
            info.ArgumentList.Add("--no-default-browser-check");
            info.ArgumentList.Add("--disable-background-mode");
            return Process.Start(info) ?? throw new InvalidOperationException("Microsoft Edge 未返回桌面窗口进程。");
        }
        catch (Exception error)
        {
            OpenDefaultBrowser(uri, dataDirectory, ownsServer, error);
            return null;
        }
    }

    private void OpenDefaultBrowser(Uri uri, string dataDirectory, bool ownsServer, Exception? edgeError)
    {
        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true })?.Dispose();
        var reason = edgeError is null
            ? "未找到 Microsoft Edge。"
            : "Microsoft Edge 无法创建桌面窗口：" + edgeError.Message;
        var lifecycle = ownsServer
            ? "\n\n已改用系统默认浏览器。此启动器会继续运行；关闭启动器即可安全停止本地服务。"
            : "\n\n已改用系统默认浏览器。";
        Show();
        Activate();
        MessageBox.Show(
            this,
            reason + lifecycle + "\n\n数据仍保存在：" + dataDirectory,
            "灵感工作台 · 浏览器兼容模式",
            MessageBoxButtons.OK,
            MessageBoxIcon.Warning
        );
    }

    private static string? FindEdgeExecutable()
    {
        var candidates = new List<string?> {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe"),
        };
        candidates.Add(ReadEdgeFromRegistry(RegistryHive.CurrentUser, RegistryView.Default));
        candidates.Add(ReadEdgeFromRegistry(RegistryHive.LocalMachine, RegistryView.Registry64));
        candidates.Add(ReadEdgeFromRegistry(RegistryHive.LocalMachine, RegistryView.Registry32));
        return candidates
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(path => path!.Trim().Trim('"'))
            .Where(path => string.Equals(Path.GetFileName(path), "msedge.exe", StringComparison.OrdinalIgnoreCase))
            .FirstOrDefault(File.Exists);
    }

    private static string? ReadEdgeFromRegistry(RegistryHive hive, RegistryView view)
    {
        try
        {
            using var baseKey = RegistryKey.OpenBaseKey(hive, view);
            using var key = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe");
            return key?.GetValue(null) as string;
        }
        catch
        {
            return null;
        }
    }

    private void DetachOwnedServer()
    {
        detachServer = true;
        ownedServer?.Dispose();
        ownedServer = null;
        ownedServerUri = null;
        apiToken = null;
    }

    private async Task StopOwnedServerAsync()
    {
        var server = ownedServer;
        ownedServer = null;
        if (server is null) return;

        try
        {
            if (server.HasExited) return;
            var accepted = false;
            if (ownedServerUri is not null && !string.IsNullOrEmpty(apiToken))
            {
                try
                {
                    using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
                    using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(ownedServerUri, "api/control/shutdown"));
                    request.Headers.TryAddWithoutValidation("X-Linggan-Token", apiToken);
                    using var response = await client.SendAsync(request);
                    accepted = response.StatusCode == HttpStatusCode.Accepted;
                }
                catch (HttpRequestException) { }
                catch (TaskCanceledException) { }
            }

            if (!server.HasExited)
            {
                using var timeout = new CancellationTokenSource(accepted ? TimeSpan.FromSeconds(5) : TimeSpan.FromSeconds(1));
                try
                {
                    await server.WaitForExitAsync(timeout.Token);
                }
                catch (OperationCanceledException)
                {
                    TryStopProcess(server);
                }
            }
        }
        finally
        {
            server.Dispose();
            ownedServerUri = null;
            apiToken = null;
        }
    }

    private static void TryStopProcess(Process process)
    {
        try
        {
            if (!process.HasExited) process.Kill(true);
        }
        catch
        {
            // Only the exact child process started by this launcher is targeted.
        }
    }
}
