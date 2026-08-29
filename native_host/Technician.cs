using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace RemoteAssistTechnician
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
            Application.Run(new HostMainForm());
        }
    }

    public class HostMainForm : Form
    {
        private string serverUrl = "wss://remote-assist-server-ulus.onrender.com";
        private string lastTargetId = "";
        private string hostId = "host_" + new Random().Next(100000, 999999);

        private ClientWebSocket ws = null;
        private CancellationTokenSource cts = null;
        private bool isConnected = false;
        private bool inSession = false;

        // UI Panels
        private Panel pnlConnect;
        private Panel pnlViewer;
        private Panel pnlConnectBox;  // the centered login card
        private TextBox txtTargetId;
        private TextBox txtPin;
        private Button btnConnect;
        private Label lblServerStatus;

        // Viewer UI
        private PictureBox pbScreen;
        private Label lblFps;
        private Label lblSessionTarget;
        private Button btnDisconnectViewer;
        private Button btnSendWin;

        private int frameCount = 0;
        private DateTime lastFpsCheck = DateTime.Now;
        private string configPath;

        public HostMainForm()
        {
            this.Text = "RemoteAssist Technician Dashboard";
            this.Size = new Size(1280, 820);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(12, 16, 23);
            this.ForeColor = Color.White;
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RemoteAssist");
            if (!Directory.Exists(appData)) Directory.CreateDirectory(appData);
            configPath = Path.Combine(appData, "host_config.json");

            LoadConfig();
            InitUI();

            this.FormClosing += (s, e) => {
                if (cts != null) cts.Cancel();
            };

            this.Shown += (s, e) => {
                // Set initial center position on first display
                CenterConnectBox();
                ConnectToSignalingServer();
            };
        }

        private void LoadConfig()
        {
            if (File.Exists(configPath))
            {
                try
                {
                    string json = File.ReadAllText(configPath);
                    lastTargetId = ExtractJsonValue(json, "lastTargetId");
                }
                catch { }
            }
        }

        private void SaveConfig()
        {
            try
            {
                string json = string.Format("{{\n  \"serverUrl\": \"{0}\",\n  \"lastTargetId\": \"{1}\"\n}}", serverUrl, lastTargetId);
                File.WriteAllText(configPath, json);
            }
            catch { }
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
            // Connect Panel
            pnlConnect = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(12, 16, 23) };
            
            pnlConnectBox = new Panel { Size = new Size(440, 420), BackColor = Color.FromArgb(17, 24, 39) };
            Panel box = pnlConnectBox;

            // Re-center whenever the panel resizes (e.g. window resize)
            pnlConnect.Resize += (s, e) => CenterConnectBox();

            Label title = new Label { Text = "RemoteAssist Technician", Font = new Font("Segoe UI", 16f, FontStyle.Bold), ForeColor = Color.FromArgb(56, 189, 248), Location = new Point(30, 25), AutoSize = true };
            Label sub = new Label { Text = "Connect to Client by Partner ID & One-Time PIN", Font = new Font("Segoe UI", 9f), ForeColor = Color.FromArgb(156, 163, 175), Location = new Point(32, 60), AutoSize = true };

            lblServerStatus = new Label { Text = "● Connecting to Server...", Font = new Font("Segoe UI", 9f, FontStyle.Bold), ForeColor = Color.FromArgb(250, 204, 21), Location = new Point(32, 95), AutoSize = true };

            Label lblTarget = new Label { Text = "PARTNER ID (9 Digits)", Font = new Font("Segoe UI", 8.5f, FontStyle.Bold), ForeColor = Color.FromArgb(148, 163, 184), Location = new Point(32, 130), AutoSize = true };
            txtTargetId = new TextBox { Text = lastTargetId, Location = new Point(32, 155), Size = new Size(376, 32), Font = new Font("Consolas", 14f, FontStyle.Bold), BackColor = Color.FromArgb(12, 16, 23), ForeColor = Color.FromArgb(241, 245, 249), BorderStyle = BorderStyle.FixedSingle };

            Label lblPass = new Label { Text = "SESSION PIN (Password)", Font = new Font("Segoe UI", 8.5f, FontStyle.Bold), ForeColor = Color.FromArgb(148, 163, 184), Location = new Point(32, 205), AutoSize = true };
            txtPin = new TextBox { Location = new Point(32, 230), Size = new Size(376, 32), Font = new Font("Consolas", 14f, FontStyle.Bold), BackColor = Color.FromArgb(12, 16, 23), ForeColor = Color.FromArgb(56, 189, 248), BorderStyle = BorderStyle.FixedSingle };

            btnConnect = new Button {
                Text = "Connect & Take Control",
                Location = new Point(32, 290),
                Size = new Size(376, 48),
                BackColor = Color.FromArgb(2, 132, 199),
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 11f, FontStyle.Bold),
                FlatStyle = FlatStyle.Flat
            };
            btnConnect.FlatAppearance.BorderSize = 0;
            btnConnect.Click += (s, e) => RequestConnection();

            box.Controls.Add(title);
            box.Controls.Add(sub);
            box.Controls.Add(lblServerStatus);
            box.Controls.Add(lblTarget);
            box.Controls.Add(txtTargetId);
            box.Controls.Add(lblPass);
            box.Controls.Add(txtPin);
            box.Controls.Add(btnConnect);
            pnlConnect.Controls.Add(box);
            this.Controls.Add(pnlConnect);

            // Viewer Panel (Canvas)
            pnlViewer = new Panel { Dock = DockStyle.Fill, BackColor = Color.Black, Visible = false };

            // Toolbar
            Panel toolbar = new Panel { Dock = DockStyle.Top, Height = 45, BackColor = Color.FromArgb(17, 24, 39) };
            lblSessionTarget = new Label { Text = "Target: None", Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), ForeColor = Color.FromArgb(56, 189, 248), Location = new Point(16, 12), AutoSize = true };
            lblFps = new Label { Text = "0 FPS", Font = new Font("Consolas", 9.5f), ForeColor = Color.FromArgb(34, 197, 94), Location = new Point(220, 14), AutoSize = true };

            btnSendWin = new Button { Text = "⊞ Win Key", Size = new Size(95, 30), Location = new Point(320, 7), BackColor = Color.FromArgb(30, 41, 59), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
            btnSendWin.FlatAppearance.BorderSize = 0;
            btnSendWin.Click += (s, e) => {
                SendControlJson("{\"type\":\"keydown\",\"vkCode\":91}");
                Task.Delay(80).ContinueWith(_ => SendControlJson("{\"type\":\"keyup\",\"vkCode\":91}"));
            };

            btnDisconnectViewer = new Button { Text = "⛔ Disconnect", Size = new Size(110, 30), Location = new Point(430, 7), BackColor = Color.FromArgb(220, 38, 38), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
            btnDisconnectViewer.FlatAppearance.BorderSize = 0;
            btnDisconnectViewer.Click += (s, e) => EndSession();

            toolbar.Controls.Add(lblSessionTarget);
            toolbar.Controls.Add(lblFps);
            toolbar.Controls.Add(btnSendWin);
            toolbar.Controls.Add(btnDisconnectViewer);
            pnlViewer.Controls.Add(toolbar);

            // Screen PictureBox
            pbScreen = new PictureBox { Dock = DockStyle.Fill, SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.Black };
            SetupMouseAndKeyboardInput(pbScreen);
            pnlViewer.Controls.Add(pbScreen);

            this.Controls.Add(pnlViewer);
        }

        private void CenterConnectBox()
        {
            if (pnlConnectBox == null || pnlConnect == null) return;
            pnlConnectBox.Location = new Point(
                (pnlConnect.ClientSize.Width - pnlConnectBox.Width) / 2,
                (pnlConnect.ClientSize.Height - pnlConnectBox.Height) / 2
            );
        }

        private void SetupMouseAndKeyboardInput(Control canvas)
        {
            canvas.MouseMove += (s, e) => {
                if (!inSession || pbScreen.Image == null) return;
                Point imgCoords = GetImageCoordinates(e.Location);
                SendControlJson(string.Format("{{\"type\":\"mousemove\",\"x\":{0},\"y\":{1}}}", imgCoords.X, imgCoords.Y));
            };

            canvas.MouseDown += (s, e) => {
                if (!inSession || pbScreen.Image == null) return;
                Point imgCoords = GetImageCoordinates(e.Location);
                string btn = e.Button == MouseButtons.Right ? "RIGHT" : (e.Button == MouseButtons.Middle ? "MIDDLE" : "LEFT");
                SendControlJson(string.Format("{{\"type\":\"mousedown\",\"button\":\"{0}\",\"x\":{1},\"y\":{2}}}", btn, imgCoords.X, imgCoords.Y));
            };

            canvas.MouseUp += (s, e) => {
                if (!inSession || pbScreen.Image == null) return;
                Point imgCoords = GetImageCoordinates(e.Location);
                string btn = e.Button == MouseButtons.Right ? "RIGHT" : (e.Button == MouseButtons.Middle ? "MIDDLE" : "LEFT");
                SendControlJson(string.Format("{{\"type\":\"mouseup\",\"button\":\"{0}\",\"x\":{1},\"y\":{2}}}", btn, imgCoords.X, imgCoords.Y));
            };

            canvas.MouseWheel += (s, e) => {
                if (!inSession) return;
                SendControlJson(string.Format("{{\"type\":\"wheel\",\"delta\":{0}}}", e.Delta));
            };

            this.KeyPreview = true;
            this.KeyDown += (s, e) => {
                if (!inSession) return;
                SendControlJson(string.Format("{{\"type\":\"keydown\",\"vkCode\":{0}}}", (byte)e.KeyCode));
            };

            this.KeyUp += (s, e) => {
                if (!inSession) return;
                SendControlJson(string.Format("{{\"type\":\"keyup\",\"vkCode\":{0}}}", (byte)e.KeyCode));
            };
        }

        private Point GetImageCoordinates(Point mousePos)
        {
            if (pbScreen.Image == null) return mousePos;

            int imgW = pbScreen.Image.Width;
            int imgH = pbScreen.Image.Height;
            int pbW = pbScreen.ClientSize.Width;
            int pbH = pbScreen.ClientSize.Height;

            float ratioW = (float)pbW / imgW;
            float ratioH = (float)pbH / imgH;
            float ratio = Math.Min(ratioW, ratioH);

            float displayW = imgW * ratio;
            float displayH = imgH * ratio;

            float offsetX = (pbW - displayW) / 2;
            float offsetY = (pbH - displayH) / 2;

            float relativeX = (mousePos.X - offsetX) / ratio;
            float relativeY = (mousePos.Y - offsetY) / ratio;

            return new Point((int)Math.Max(0, Math.Min(imgW - 1, relativeX)), (int)Math.Max(0, Math.Min(imgH - 1, relativeY)));
        }

        private async void ConnectToSignalingServer()
        {
            cts = new CancellationTokenSource();
            while (!cts.IsCancellationRequested)
            {
                try
                {
                    UpdateServerStatus("● Connecting to Cloud Relay...", Color.FromArgb(250, 204, 21));
                    ws = new ClientWebSocket();
                    await ws.ConnectAsync(new Uri(serverUrl), cts.Token);

                    isConnected = true;
                    UpdateServerStatus("● Connected to Cloud Relay", Color.FromArgb(34, 197, 94));

                    var heartbeat = StartHeartbeatAsync(cts.Token);
                    await ReceiveLoopAsync(cts.Token);
                }
                catch
                {
                    isConnected = false;
                    UpdateServerStatus("● Server Disconnected (Retrying...)", Color.FromArgb(239, 68, 68));
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
                    SendWebSocketText("{\"type\":\"ping\"}");
                }
            }
        }

        private async Task ReceiveLoopAsync(CancellationToken token)
        {
            byte[] buffer = new byte[2 * 1024 * 1024]; // 2MB frame buffer
            while (!token.IsCancellationRequested && ws != null && ws.State == WebSocketState.Open)
            {
                int totalBytes = 0;
                WebSocketReceiveResult result;
                do
                {
                    result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer, totalBytes, buffer.Length - totalBytes), token);
                    totalBytes += result.Count;
                }
                while (!result.EndOfMessage);

                if (result.MessageType == WebSocketMessageType.Binary && totalBytes > 0)
                {
                    // Render incoming screen JPEG frame
                    try
                    {
                        using (MemoryStream ms = new MemoryStream(buffer, 0, totalBytes))
                        {
                            Image frame = Image.FromStream(ms);
                            pbScreen.Invoke((MethodInvoker)delegate {
                                Image old = pbScreen.Image;
                                pbScreen.Image = frame;
                                if (old != null) old.Dispose();

                                frameCount++;
                                if ((DateTime.Now - lastFpsCheck).TotalSeconds >= 1.0)
                                {
                                    lblFps.Text = string.Format("{0} FPS", frameCount);
                                    frameCount = 0;
                                    lastFpsCheck = DateTime.Now;
                                }
                            });
                        }
                    }
                    catch { }
                }
                else if (result.MessageType == WebSocketMessageType.Text && totalBytes > 0)
                {
                    string msg = Encoding.UTF8.GetString(buffer, 0, totalBytes);
                    HandleJsonMessage(msg);
                }
            }
        }

        private void HandleJsonMessage(string msg)
        {
            try
            {
                string type = ExtractJsonValue(msg, "type");
                if (type == "connect_success")
                {
                    inSession = true;
                    this.Invoke((MethodInvoker)delegate {
                        lblSessionTarget.Text = string.Format("Target: {0}", txtTargetId.Text);
                        pnlConnect.Visible = false;
                        pnlViewer.Visible = true;
                    });
                }
                else if (type == "connect_error")
                {
                    inSession = false;
                    string reason = ExtractJsonValue(msg, "reason");
                    this.Invoke((MethodInvoker)delegate {
                        btnConnect.Enabled = true;
                        MessageBox.Show(this, "Connection Failed:\n" + reason, "RemoteAssist", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    });
                }
                else if (type == "session_ended")
                {
                    inSession = false;
                    string reason = ExtractJsonValue(msg, "reason");
                    this.Invoke((MethodInvoker)delegate {
                        pnlViewer.Visible = false;
                        pnlConnect.Visible = true;
                        btnConnect.Enabled = true;
                        MessageBox.Show(this, "Session Ended: " + reason, "RemoteAssist", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    });
                }
            }
            catch { }
        }

        private void RequestConnection()
        {
            string cleanId = txtTargetId.Text.Replace(" ", "").Trim();
            string pin = txtPin.Text.Trim();

            if (string.IsNullOrEmpty(cleanId) || string.IsNullOrEmpty(pin))
            {
                MessageBox.Show(this, "Please enter both Partner ID and Session PIN.", "RemoteAssist", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            lastTargetId = txtTargetId.Text.Trim();
            SaveConfig();

            if (ws != null && ws.State == WebSocketState.Open)
            {
                btnConnect.Enabled = false;
                string payload = string.Format("{{\"type\":\"connect_request\",\"hostId\":\"{0}\",\"targetId\":\"{1}\",\"pin\":\"{2}\"}}", hostId, cleanId, pin);
                SendWebSocketText(payload);
            }
            else
            {
                MessageBox.Show(this, "Signaling server is not connected.", "RemoteAssist", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void EndSession()
        {
            if (ws != null && ws.State == WebSocketState.Open)
            {
                SendWebSocketText("{\"type\":\"disconnect_session\"}");
            }
            inSession = false;
            pnlViewer.Visible = false;
            pnlConnect.Visible = true;
            btnConnect.Enabled = true;
        }

        private void SendControlJson(string json)
        {
            if (ws != null && ws.State == WebSocketState.Open && inSession)
            {
                string payload = string.Format("{{\"type\":\"control_event\",\"event\":{0}}}", json);
                SendWebSocketText(payload);
            }
        }

        private void SendWebSocketText(string text)
        {
            if (ws != null && ws.State == WebSocketState.Open)
            {
                byte[] bytes = Encoding.UTF8.GetBytes(text);
                ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
            }
        }

        private void UpdateServerStatus(string text, Color color)
        {
            if (lblServerStatus.InvokeRequired)
            {
                lblServerStatus.Invoke((MethodInvoker)delegate {
                    lblServerStatus.Text = text;
                    lblServerStatus.ForeColor = color;
                });
            }
            else
            {
                lblServerStatus.Text = text;
                lblServerStatus.ForeColor = color;
            }
        }
    }
}
