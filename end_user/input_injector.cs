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

        static void Main(string[] args)
        {
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
                            IntPtr hwnd = FindWindow(null, "Remote Assist - End User Client");
                            if (hwnd != IntPtr.Zero)
                            {
                                ShowWindow(hwnd, SW_HIDE);
                            }
                            break;

                        case "MOVE":
                            if (parts.Length >= 3)
                            {
                                int x = int.Parse(parts[1]);
                                int y = int.Parse(parts[2]);
                                SetCursorPos(x, y);
                            }
                            break;

                        case "MOUSEDOWN":
                            if (parts.Length >= 2)
                            {
                                string btn = parts[1].ToUpper();
                                if (btn == "LEFT") mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                                else if (btn == "RIGHT") mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
                                else if (btn == "MIDDLE") mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, UIntPtr.Zero);
                            }
                            break;

                        case "MOUSEUP":
                            if (parts.Length >= 2)
                            {
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
