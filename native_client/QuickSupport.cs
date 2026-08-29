using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace RemoteAssistQuickSupport
{
    static class Program
    {
        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main()
        {
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }

    public class MainForm : Form
    {
        // Win32 Input APIs
        [DllImport("user32.dll")]
        static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        static extern int GetSystemMetrics(int nIndex);

        const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        const uint MOUSEEVENTF_LEFTUP = 0x0004;
        const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        const uint MOUSEEVENTF_WHEEL = 0x0800;
        const uint KEYEVENTF_KEYUP = 0x0002;

        // Config & State
        private string serverUrl = "wss://remote-assist-server-ulus.onrender.com";
        private string deviceId = "";
        private string pin = "";
        private bool runInBackground = true;

        private ClientWebSocket ws = null;
        private CancellationTokenSource cts = null;
        private bool isConnected = false;
        private bool inActiveSession = false;
        private string partnerId = "";
        private Thread captureThread = null;
        private bool isCapturing = false;

        // UI Controls
        private Label lblStatus;
        private Label lblDeviceId;
        private Label lblPin;
        private Panel bannerSession;
        private Label lblSessionInfo;
        private Button btnDisconnect;
        private Button btnRefreshPin;
        private Button btnCopyAll;
        private CheckBox chkBgMode;

        private string configPath;

        public MainForm()
        {
            this.Text = "RemoteAssist QuickSupport";
            this.Size = new Size(460, 560);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedSingle;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(12, 16, 23);
            this.ForeColor = Color.White;
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RemoteAssist");
            if (!Directory.Exists(appData)) Directory.CreateDirectory(appData);
            configPath = Path.Combine(appData, "client_config.json");

            LoadConfig();
            InitUI();

            this.FormClosing += (s, e) => {
                isCapturing = false;
                if (cts != null) cts.Cancel();
            };

            this.Shown += (s, e) => {
                StartWebSocketConnection();
            };
        }

        private void LoadConfig()
        {
            if (File.Exists(configPath))
            {
                try
                {
                    string json = File.ReadAllText(configPath);
                    deviceId = ExtractJsonValue(json, "deviceId");
                    pin = ExtractJsonValue(json, "pin");
                    string sUrl = ExtractJsonValue(json, "serverUrl");
                    if (!string.IsNullOrEmpty(sUrl)) serverUrl = sUrl;
                }
                catch { }
            }

            if (string.IsNullOrEmpty(deviceId) || deviceId.Length < 6)
            {
                deviceId = GenerateDeviceId();
                SaveConfig();
            }

            if (string.IsNullOrEmpty(pin) || pin.Length < 4)
            {
                pin = GeneratePin();
                SaveConfig();
            }
        }

        private void SaveConfig()
        {
            try
            {
                string json = string.Format("{{\n  \"serverUrl\": \"{0}\",\n  \"deviceId\": \"{1}\",\n  \"pin\": \"{2}\",\n  \"runInBackground\": {3}\n}}",
                    serverUrl, deviceId, pin, runInBackground ? "true" : "false");
                File.WriteAllText(configPath, json);
            }
            catch { }
        }

        private string GenerateDeviceId()
        {
            Random r = new Random();
            int num = r.Next(100000000, 999999999);
            string s = num.ToString();
            return s.Substring(0, 3) + " " + s.Substring(3, 3) + " " + s.Substring(6, 3);
        }

        private string GeneratePin()
        {
            Random r = new Random();
            return r.Next(100000, 999999).ToString();
        }

        private string ExtractJsonValue(string json, string key)
        {
            string search = "\"" + key + "\":";
            int idx = json.IndexOf(search);
            if (idx == -1) return "";
            int start = json.IndexOf("\"", idx + search.Length);
            if (start == -1) return "";
            int end = json.IndexOf("\"", start + 1);
            if (end == -1) return "";
            return json.Substring(start + 1, end - start - 1);
        }

        private void InitUI()
        {
            // App Header
            Panel header = new Panel { Location = new Point(0, 0), Size = new Size(460, 75), BackColor = Color.FromArgb(17, 24, 39) };
            
            Label logo = new Label { Text = "RemoteAssist", Font = new Font("Segoe UI", 16f, FontStyle.Bold), ForeColor = Color.FromArgb(56, 189, 248), Location = new Point(24, 14), AutoSize = true };
            Label subtitle = new Label { Text = "QuickSupport Client", Font = new Font("Segoe UI", 9f), ForeColor = Color.FromArgb(156, 163, 175), Location = new Point(26, 44), AutoSize = true };
            
            lblStatus = new Label { Text = "● Connecting...", Font = new Font("Segoe UI", 9f, FontStyle.Bold), ForeColor = Color.FromArgb(250, 204, 21), Location = new Point(280, 24), Size = new Size(150, 25), TextAlign = ContentAlignment.MiddleRight };

            header.Controls.Add(logo);
            header.Controls.Add(subtitle);
            header.Controls.Add(lblStatus);
            this.Controls.Add(header);

            // Active Session Alert Banner (Hidden by default)
            bannerSession = new Panel { Location = new Point(24, 85), Size = new Size(400, 50), BackColor = Color.FromArgb(30, 41, 59), Visible = false };
            lblSessionInfo = new Label { Text = "🔴 Controller Active (Host connected)", Font = new Font("Segoe UI", 9f, FontStyle.Bold), ForeColor = Color.FromArgb(248, 113, 113), Location = new Point(12, 14), AutoSize = true };
            btnDisconnect = new Button { Text = "Disconnect", Size = new Size(95, 30), Location = new Point(292, 10), BackColor = Color.FromArgb(220, 38, 38), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
            btnDisconnect.FlatAppearance.BorderSize = 0;
            btnDisconnect.Click += (s, e) => TerminateSession();
            bannerSession.Controls.Add(lblSessionInfo);
            bannerSession.Controls.Add(btnDisconnect);
            this.Controls.Add(bannerSession);

            // Card 1: Your ID
            Panel cardId = new Panel { Location = new Point(24, 145), Size = new Size(192, 110), BackColor = Color.FromArgb(20, 29, 44) };
            Label lblIdTitle = new Label { Text = "YOUR ID", Font = new Font("Segoe UI", 8.5f, FontStyle.Bold), ForeColor = Color.FromArgb(148, 163, 184), Location = new Point(16, 14), AutoSize = true };
            lblDeviceId = new Label { Text = deviceId, Font = new Font("Consolas", 15f, FontStyle.Bold), ForeColor = Color.FromArgb(241, 245, 249), Location = new Point(14, 40), AutoSize = true };
            Button btnCopyId = new Button { Text = "Copy ID", Size = new Size(160, 28), Location = new Point(16, 72), BackColor = Color.FromArgb(30, 41, 59), ForeColor = Color.FromArgb(226, 232, 240), FlatStyle = FlatStyle.Flat };
            btnCopyId.FlatAppearance.BorderSize = 0;
            btnCopyId.Click += (s, e) => { Clipboard.SetText(deviceId.Replace(" ", "")); ShowToast("Device ID copied!"); };
            cardId.Controls.Add(lblIdTitle);
            cardId.Controls.Add(lblDeviceId);
            cardId.Controls.Add(btnCopyId);
            this.Controls.Add(cardId);

            // Card 2: One-Time PIN
            Panel cardPin = new Panel { Location = new Point(232, 145), Size = new Size(192, 110), BackColor = Color.FromArgb(20, 29, 44) };
            Label lblPinTitle = new Label { Text = "ONE-TIME PIN", Font = new Font("Segoe UI", 8.5f, FontStyle.Bold), ForeColor = Color.FromArgb(148, 163, 184), Location = new Point(16, 14), AutoSize = true };
            lblPin = new Label { Text = pin, Font = new Font("Consolas", 16f, FontStyle.Bold), ForeColor = Color.FromArgb(56, 189, 248), Location = new Point(14, 40), AutoSize = true };
            
            btnRefreshPin = new Button { Text = "🔄", Size = new Size(32, 28), Location = new Point(16, 72), BackColor = Color.FromArgb(30, 41, 59), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
            btnRefreshPin.FlatAppearance.BorderSize = 0;
            btnRefreshPin.Click += (s, e) => RefreshPin();

            Button btnCopyPin = new Button { Text = "Copy PIN", Size = new Size(122, 28), Location = new Point(54, 72), BackColor = Color.FromArgb(30, 41, 59), ForeColor = Color.FromArgb(226, 232, 240), FlatStyle = FlatStyle.Flat };
            btnCopyPin.FlatAppearance.BorderSize = 0;
            btnCopyPin.Click += (s, e) => { Clipboard.SetText(pin); ShowToast("PIN copied!"); };

            cardPin.Controls.Add(lblPinTitle);
            cardPin.Controls.Add(lblPin);
            cardPin.Controls.Add(btnRefreshPin);
            cardPin.Controls.Add(btnCopyPin);
            this.Controls.Add(cardPin);

            // Big Action Button: Copy All
            btnCopyAll = new Button {
                Text = "📋  Copy ID & Password to Clipboard",
                Location = new Point(24, 275),
                Size = new Size(400, 46),
                BackColor = Color.FromArgb(14, 116, 144),
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                FlatStyle = FlatStyle.Flat
            };
            btnCopyAll.FlatAppearance.BorderSize = 0;
            btnCopyAll.Click += (s, e) => {
                string text = string.Format("RemoteAssist Access Info:\nID: {0}\nPIN: {1}", deviceId.Replace(" ", ""), pin);
                Clipboard.SetText(text);
                ShowToast("Connection credentials copied to clipboard!");
            };
            this.Controls.Add(btnCopyAll);

            // Unattended mode toggle
            chkBgMode = new CheckBox {
                Text = "Unattended Background Mode (Allow reconnect anytime)",
                Location = new Point(26, 345),
                Size = new Size(400, 25),
                Checked = runInBackground,
                ForeColor = Color.FromArgb(203, 213, 225)
            };
            chkBgMode.CheckedChanged += (s, e) => {
                runInBackground = chkBgMode.Checked;
                SaveConfig();
            };
            this.Controls.Add(chkBgMode);

            // Security note
            Panel securityPanel = new Panel { Location = new Point(24, 385), Size = new Size(400, 90), BackColor = Color.FromArgb(15, 23, 42) };
            Label lblSecTitle = new Label { Text = "🔒 Secure End-to-End Encryption", Font = new Font("Segoe UI", 9f, FontStyle.Bold), ForeColor = Color.FromArgb(56, 189, 248), Location = new Point(14, 10), AutoSize = true };
            Label lblSecDesc = new Label { Text = "Share your ID and PIN only with trusted support technicians. You can terminate remote control anytime with the red Disconnect button above.", Font = new Font("Segoe UI", 8.5f), ForeColor = Color.FromArgb(148, 163, 184), Location = new Point(14, 32), Size = new Size(370, 50) };
            securityPanel.Controls.Add(lblSecTitle);
            securityPanel.Controls.Add(lblSecDesc);
            this.Controls.Add(securityPanel);
        }

        private void ShowToast(string message)
        {
            MessageBox.Show(this, message, "RemoteAssist", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void RefreshPin()
        {
            pin = GeneratePin();
            lblPin.Text = pin;
            SaveConfig();
            if (ws != null && ws.State == WebSocketState.Open)
            {
                string msg = string.Format("{{\"type\":\"register_target\",\"id\":\"{0}\",\"pin\":\"{1}\"}}", deviceId.Replace(" ", ""), pin);
                SendWebSocketText(msg);
            }
            ShowToast("New One-Time PIN generated: " + pin);
        }

        private async void StartWebSocketConnection()
        {
            cts = new CancellationTokenSource();
            while (!cts.IsCancellationRequested)
            {
                try
                {
                    UpdateStatus("● Connecting...", Color.FromArgb(250, 204, 21));
                    ws = new ClientWebSocket();
                    await ws.ConnectAsync(new Uri(serverUrl), cts.Token);

                    isConnected = true;
                    UpdateStatus("● Online / Ready", Color.FromArgb(34, 197, 94));

                    // Register target
                    string registerPayload = string.Format("{{\"type\":\"register_target\",\"id\":\"{0}\",\"pin\":\"{1}\"}}", deviceId.Replace(" ", ""), pin);
                    await SendWebSocketTextAsync(registerPayload);

                    // Start receive loop & heartbeat
                    var heartbeatTask = StartHeartbeatAsync(cts.Token);
                    await ReceiveLoopAsync(cts.Token);
                }
                catch
                {
                    isConnected = false;
                    UpdateStatus("● Disconnected (Retrying...)", Color.FromArgb(239, 68, 68));
                }

                if (!cts.IsCancellationRequested)
                {
                    await Task.Delay(3000);
                }
            }
        }

        private async Task StartHeartbeatAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested && ws != null && ws.State == WebSocketState.Open)
            {
                await Task.Delay(10000, token);
                if (ws != null && ws.State == WebSocketState.Open)
                {
                    await SendWebSocketTextAsync("{\"type\":\"ping\"}");
                }
            }
        }

        private async Task ReceiveLoopAsync(CancellationToken token)
        {
            byte[] buffer = new byte[65536];
            while (!token.IsCancellationRequested && ws != null && ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    break;
                }
                else if (result.MessageType == WebSocketMessageType.Text)
                {
                    string msgText = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    HandleServerMessage(msgText);
                }
            }
        }

        private void HandleServerMessage(string msg)
        {
            try
            {
                string type = ExtractJsonValue(msg, "type");
                if (type == "register_success")
                {
                    UpdateStatus("● Online / Ready", Color.FromArgb(34, 197, 94));
                }
                else if (type == "session_started")
                {
                    partnerId = ExtractJsonValue(msg, "partnerId");
                    inActiveSession = true;
                    this.Invoke((MethodInvoker)delegate {
                        lblSessionInfo.Text = string.Format("🔴 Controlled by {0}", partnerId);
                        bannerSession.Visible = true;
                        UpdateStatus("● Controlled", Color.FromArgb(239, 68, 68));
                    });
                    StartScreenCapture();
                }
                else if (type == "session_ended")
                {
                    inActiveSession = false;
                    StopScreenCapture();
                    this.Invoke((MethodInvoker)delegate {
                        bannerSession.Visible = false;
                        UpdateStatus("● Online / Ready", Color.FromArgb(34, 197, 94));
                    });
                }
                else if (type == "control_event")
                {
                    HandleControlEvent(msg);
                }
            }
            catch { }
        }

        private void HandleControlEvent(string json)
        {
            try
            {
                int screenW = GetSystemMetrics(0);
                int screenH = GetSystemMetrics(1);

                string evtType = ExtractJsonValue(json, "type");
                if (evtType == "mousemove")
                {
                    int x = int.Parse(ExtractJsonValue(json, "x"));
                    int y = int.Parse(ExtractJsonValue(json, "y"));
                    SetCursorPos(Math.Max(0, Math.Min(screenW - 1, x)), Math.Max(0, Math.Min(screenH - 1, y)));
                }
                else if (evtType == "mousedown")
                {
                    string btn = ExtractJsonValue(json, "button").ToUpper();
                    if (btn == "LEFT") mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                    else if (btn == "RIGHT") mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
                    else if (btn == "MIDDLE") mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, UIntPtr.Zero);
                }
                else if (evtType == "mouseup")
                {
                    string btn = ExtractJsonValue(json, "button").ToUpper();
                    if (btn == "LEFT") mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                    else if (btn == "RIGHT") mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
                    else if (btn == "MIDDLE") mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, UIntPtr.Zero);
                }
                else if (evtType == "wheel")
                {
                    int delta = int.Parse(ExtractJsonValue(json, "delta"));
                    mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, UIntPtr.Zero);
                }
                else if (evtType == "keydown")
                {
                    byte vk = byte.Parse(ExtractJsonValue(json, "vkCode"));
                    keybd_event(vk, 0, 0, UIntPtr.Zero);
                }
                else if (evtType == "keyup")
                {
                    byte vk = byte.Parse(ExtractJsonValue(json, "vkCode"));
                    keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                }
            }
            catch { }
        }

        private void TerminateSession()
        {
            if (ws != null && ws.State == WebSocketState.Open)
            {
                SendWebSocketText("{\"type\":\"disconnect_session\"}");
            }
            inActiveSession = false;
            StopScreenCapture();
            bannerSession.Visible = false;
            UpdateStatus("● Online / Ready", Color.FromArgb(34, 197, 94));
        }

        private void StartScreenCapture()
        {
            if (isCapturing) return;
            isCapturing = true;

            captureThread = new Thread(() => {
                ImageCodecInfo jpgEncoder = GetEncoder(ImageFormat.Jpeg);
                EncoderParameters encParams = new EncoderParameters(1);
                encParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 55L);

                int screenW = GetSystemMetrics(0);
                int screenH = GetSystemMetrics(1);

                using (Bitmap bmp = new Bitmap(screenW, screenH, PixelFormat.Format24bppRgb))
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    while (isCapturing && inActiveSession)
                    {
                        try
                        {
                            g.CopyFromScreen(0, 0, 0, 0, new Size(screenW, screenH), CopyPixelOperation.SourceCopy);
                            using (MemoryStream ms = new MemoryStream())
                            {
                                bmp.Save(ms, jpgEncoder, encParams);
                                byte[] frameBytes = ms.ToArray();
                                if (ws != null && ws.State == WebSocketState.Open)
                                {
                                    ws.SendAsync(new ArraySegment<byte>(frameBytes), WebSocketMessageType.Binary, true, CancellationToken.None).Wait(200);
                                }
                            }
                        }
                        catch { }

                        Thread.Sleep(50); // ~20 FPS
                    }
                }
            });
            captureThread.IsBackground = true;
            captureThread.Start();
        }

        private void StopScreenCapture()
        {
            isCapturing = false;
            if (captureThread != null && captureThread.IsAlive)
            {
                try { captureThread.Join(500); } catch { }
                captureThread = null;
            }
        }

        private static ImageCodecInfo GetEncoder(ImageFormat format)
        {
            ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
            foreach (ImageCodecInfo codec in codecs)
            {
                if (codec.FormatID == format.Guid) return codec;
            }
            return null;
        }

        private void SendWebSocketText(string text)
        {
            if (ws != null && ws.State == WebSocketState.Open)
            {
                byte[] bytes = Encoding.UTF8.GetBytes(text);
                ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
            }
        }

        private async Task SendWebSocketTextAsync(string text)
        {
            if (ws != null && ws.State == WebSocketState.Open)
            {
                byte[] bytes = Encoding.UTF8.GetBytes(text);
                await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
            }
        }

        private void UpdateStatus(string text, Color color)
        {
            if (lblStatus.InvokeRequired)
            {
                lblStatus.Invoke((MethodInvoker)delegate {
                    lblStatus.Text = text;
                    lblStatus.ForeColor = color;
                });
            }
            else
            {
                lblStatus.Text = text;
                lblStatus.ForeColor = color;
            }
        }
    }
}
