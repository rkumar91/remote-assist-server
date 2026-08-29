using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace RemoteAssistInput
{
    class Program
    {
        [DllImport("user32.dll")]
        static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        static extern int GetSystemMetrics(int nIndex);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("kernel32.dll")]
        static extern IntPtr GetConsoleWindow();

        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

        [DllImport("shcore.dll", SetLastError = true)]
        private static extern int SetProcessDpiAwareness(int awareness);

        private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);
        private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE = new IntPtr(-3);

        const int SW_HIDE = 0;

        const int SM_CXSCREEN = 0;
        const int SM_CYSCREEN = 1;

        const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        const uint MOUSEEVENTF_LEFTUP = 0x0004;
        const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        const uint MOUSEEVENTF_WHEEL = 0x0800;

        const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        const uint KEYEVENTF_KEYUP = 0x0002;

        static void EnableDpiAwareness()
        {
            try
            {
                if (SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) return;
            }
            catch { }

            try
            {
                if (SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE)) return;
            }
            catch { }

            try
            {
                if (SetProcessDpiAwareness(2) == 0) return;
            }
            catch { }

            try
            {
                SetProcessDPIAware();
            }
            catch { }
        }

        static void Main(string[] args)
        {
            EnableDpiAwareness();

            // Set input encoding to UTF-8
            Console.InputEncoding = System.Text.Encoding.UTF8;
            Console.OutputEncoding = System.Text.Encoding.UTF8;

            int screenWidth = GetSystemMetrics(SM_CXSCREEN);
            int screenHeight = GetSystemMetrics(SM_CYSCREEN);

            Console.WriteLine(string.Format("READY:{0}:{1}", screenWidth, screenHeight));
            Console.Out.Flush();

            string line;
            while ((line = Console.ReadLine()) != null)
            {
                if (string.IsNullOrEmpty(line)) continue;
                if (line.Trim().Equals("QUIT", StringComparison.OrdinalIgnoreCase)) break;

                try
                {
                    string[] parts = line.Split(' ');
                    string cmd = parts[0].ToUpper();

                    switch (cmd)
                    {
                        case "HIDE_CONSOLE":
                            IntPtr consoleHwnd = GetConsoleWindow();
                            if (consoleHwnd != IntPtr.Zero)
                            {
                                ShowWindow(consoleHwnd, SW_HIDE);
                            }
                            IntPtr titleHwnd = FindWindow(null, "Remote Assist - End User Client");
                            if (titleHwnd != IntPtr.Zero)
                            {
                                ShowWindow(titleHwnd, SW_HIDE);
                            }
                            break;

                        case "MOVE":
                            if (parts.Length >= 3)
                            {
                                int x = int.Parse(parts[1]);
                                int y = int.Parse(parts[2]);
                                x = Math.Max(0, Math.Min(screenWidth - 1, x));
                                y = Math.Max(0, Math.Min(screenHeight - 1, y));
                                SetCursorPos(x, y);
                            }
                            break;

                        case "MOUSEDOWN":
                            if (parts.Length >= 2)
                            {
                                if (parts.Length >= 4)
                                {
                                    int x = int.Parse(parts[2]);
                                    int y = int.Parse(parts[3]);
                                    x = Math.Max(0, Math.Min(screenWidth - 1, x));
                                    y = Math.Max(0, Math.Min(screenHeight - 1, y));
                                    SetCursorPos(x, y);
                                }
                                string btn = parts[1].ToUpper();
                                if (btn == "LEFT") mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                                else if (btn == "RIGHT") mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
                                else if (btn == "MIDDLE") mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, UIntPtr.Zero);
                            }
                            break;

                        case "MOUSEUP":
                            if (parts.Length >= 2)
                            {
                                if (parts.Length >= 4)
                                {
                                    int x = int.Parse(parts[2]);
                                    int y = int.Parse(parts[3]);
                                    x = Math.Max(0, Math.Min(screenWidth - 1, x));
                                    y = Math.Max(0, Math.Min(screenHeight - 1, y));
                                    SetCursorPos(x, y);
                                }
                                string btn = parts[1].ToUpper();
                                if (btn == "LEFT") mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                                else if (btn == "RIGHT") mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
                                else if (btn == "MIDDLE") mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, UIntPtr.Zero);
                            }
                            break;

                        case "WHEEL":
                            if (parts.Length >= 2)
                            {
                                int delta = int.Parse(parts[1]);
                                mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, UIntPtr.Zero);
                            }
                            break;

                        case "KEYDOWN":
                            if (parts.Length >= 2)
                            {
                                byte vk = byte.Parse(parts[1]);
                                keybd_event(vk, 0, 0, UIntPtr.Zero);
                            }
                            break;

                        case "KEYUP":
                            if (parts.Length >= 2)
                            {
                                byte vk = byte.Parse(parts[1]);
                                keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                            }
                            break;
                    }
                }
                catch
                {
                    // Ignore malformed lines silently to maintain ultra low latency stream
                }
            }
        }
    }
}
