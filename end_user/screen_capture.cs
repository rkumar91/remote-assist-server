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

        const int SM_CXSCREEN = 0;
        const int SM_CYSCREEN = 1;

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
            using (MemoryStream ms = new MemoryStream(65536))
            {
                // Signal resolution
                byte[] header = System.Text.Encoding.UTF8.GetBytes(string.Format("META:{0}:{1}\n", screenWidth, screenHeight));
                writer.Write(header);
                writer.Flush();

                while (true)
                {
                    try
                    {
                        var start = DateTime.UtcNow;
                        g.CopyFromScreen(0, 0, 0, 0, new Size(screenWidth, screenHeight), CopyPixelOperation.SourceCopy);

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
                        // Frame Protocol: 4 bytes length (Big Endian), then JPEG payload
                        int len = frameBytes.Length;
                        byte[] lenPrefix = new byte[4];
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
                    catch (Exception)
                    {
                        break;
                    }
                }
            }
        }
    }
}
