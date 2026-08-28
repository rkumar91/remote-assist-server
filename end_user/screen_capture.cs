using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace RemoteAssistCapture
{
    class Program
    {
        [DllImport("user32.dll")]
        static extern int GetSystemMetrics(int nIndex);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

        [StructLayout(LayoutKind.Sequential)]
        struct POINT
        {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct CURSORINFO
        {
            public Int32 cbSize;
            public Int32 flags;
            public IntPtr hCursor;
            public POINT ptScreenPos;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct ICONINFO
        {
            public bool fIcon;
            public int xHotspot;
            public int yHotspot;
            public IntPtr hbmMask;
            public IntPtr hbmColor;
        }

        [DllImport("user32.dll")]
        static extern bool GetCursorInfo(out CURSORINFO pci);

        [DllImport("user32.dll")]
        static extern bool GetIconInfo(IntPtr hIcon, out ICONINFO piconinfo);

        [DllImport("user32.dll")]
        static extern bool DrawIcon(IntPtr hdc, int x, int y, IntPtr hIcon);

        [DllImport("gdi32.dll")]
        static extern bool DeleteObject(IntPtr hObject);

        private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);
        private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE = new IntPtr(-3);

        const int SM_CXSCREEN = 0;
        const int SM_CYSCREEN = 1;
        const Int32 CURSOR_SHOWING = 0x00000001;

        static void EnableDpiAwareness()
        {
            try
            {
                if (Environment.OSVersion.Version.Major >= 10)
                {
                    if (!SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2))
                    {
                        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE);
                    }
                }
                else
                {
                    SetProcessDPIAware();
                }
            }
            catch
            {
                try { SetProcessDPIAware(); } catch { }
            }
        }

        static ImageCodecInfo GetEncoder(ImageFormat format)
        {
            ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
            foreach (ImageCodecInfo codec in codecs)
            {
                if (codec.FormatID == format.Guid) return codec;
            }
            return null;
        }

        static void Main(string[] args)
        {
            EnableDpiAwareness();

            long quality = 65; // Default JPEG quality 65%
            int targetFps = 25; // Target FPS
            int targetWidth = 0;
            int targetHeight = 0;

            if (args.Length >= 1) long.TryParse(args[0], out quality);
            if (args.Length >= 2) int.TryParse(args[1], out targetFps);
            if (args.Length >= 3) int.TryParse(args[2], out targetWidth);
            if (args.Length >= 4) int.TryParse(args[3], out targetHeight);

            int screenWidth = GetSystemMetrics(SM_CXSCREEN);
            int screenHeight = GetSystemMetrics(SM_CYSCREEN);

            if (targetWidth <= 0) targetWidth = screenWidth;
            if (targetHeight <= 0) targetHeight = screenHeight;

            int delayMs = 1000 / Math.Max(1, Math.Min(60, targetFps));

            ImageCodecInfo jpgEncoder = GetEncoder(ImageFormat.Jpeg);
            EncoderParameters encParams = new EncoderParameters(1);
            encParams.Param[0] = new EncoderParameter(Encoder.Quality, quality);

            Stream stdout = Console.OpenStandardOutput();
            BinaryWriter writer = new BinaryWriter(stdout);

            using (Bitmap rawBmp = new Bitmap(screenWidth, screenHeight, PixelFormat.Format32bppArgb))
            using (Graphics g = Graphics.FromImage(rawBmp))
            using (MemoryStream ms = new MemoryStream(131072))
            {
                byte[] lenPrefix = new byte[4];

                while (true)
                {
                    try
                    {
                        var start = DateTime.UtcNow;
                        g.CopyFromScreen(0, 0, 0, 0, new Size(screenWidth, screenHeight), CopyPixelOperation.SourceCopy);

                        // Capture and overlay hardware mouse pointer with accurate hotspot
                        try
                        {
                            CURSORINFO pci;
                            pci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
                            if (GetCursorInfo(out pci))
                            {
                                if (pci.flags == CURSOR_SHOWING && pci.hCursor != IntPtr.Zero)
                                {
                                    ICONINFO iconInfo;
                                    int curX = pci.ptScreenPos.x;
                                    int curY = pci.ptScreenPos.y;
                                    if (GetIconInfo(pci.hCursor, out iconInfo))
                                    {
                                        curX -= iconInfo.xHotspot;
                                        curY -= iconInfo.yHotspot;
                                        if (iconInfo.hbmMask != IntPtr.Zero) DeleteObject(iconInfo.hbmMask);
                                        if (iconInfo.hbmColor != IntPtr.Zero) DeleteObject(iconInfo.hbmColor);
                                    }

                                    IntPtr hdc = g.GetHdc();
                                    try
                                    {
                                        DrawIcon(hdc, curX, curY, pci.hCursor);
                                    }
                                    finally
                                    {
                                        g.ReleaseHdc(hdc);
                                    }
                                }
                            }
                        }
                        catch { }

                        ms.SetLength(0);

                        if (targetWidth != screenWidth || targetHeight != screenHeight)
                        {
                            using (Bitmap resized = new Bitmap(rawBmp, new Size(targetWidth, targetHeight)))
                            {
                                resized.Save(ms, jpgEncoder, encParams);
                            }
                        }
                        else
                        {
                            rawBmp.Save(ms, jpgEncoder, encParams);
                        }

                        byte[] frameBytes = ms.ToArray();
                        int len = frameBytes.Length;

                        // Frame Protocol: 4 bytes length (Big Endian), then JPEG payload
                        lenPrefix[0] = (byte)((len >> 24) & 0xFF);
                        lenPrefix[1] = (byte)((len >> 16) & 0xFF);
                        lenPrefix[2] = (byte)((len >> 8) & 0xFF);
                        lenPrefix[3] = (byte)(len & 0xFF);

                        writer.Write(lenPrefix);
                        writer.Write(frameBytes);
                        writer.Flush();

                        int elapsed = (int)(DateTime.UtcNow - start).TotalMilliseconds;
                        int sleep = delayMs - elapsed;
                        if (sleep > 0) Thread.Sleep(sleep);
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine("Capture error: " + ex.Message);
                        break;
                    }
                }
            }
        }
    }
}
