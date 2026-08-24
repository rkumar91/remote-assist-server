# 🖥️ RemoteAssist Utility

A lightweight, secure, and fast double-click remote desktop and screen-sharing system designed to connect computers over LAN or the Public Internet using **ID & PIN pairing**.

---

## 🚀 Quick Start (Local or LAN Testing)

Simply double-click the batch launchers in the `RemoteAssistUtility` folder:

| Step | Launcher | What it does |
| :--- | :--- | :--- |
| **1** | `START_END_USER.bat` | Starts the End-User utility. Displays ID & PIN, then auto-hides upon connection. |
| **2** | `START_HOST.bat` | Starts the Host Controller. Enter the Target ID & PIN to take full control. |
| **Server** | `START_SERVER.bat` | Starts the central Signaling & Relay Server on port `9090` (for local hosting). |

> **Quick 1-Click Demo:** Double-click `START_ALL_LOCAL_DEMO.bat` to launch all 3 components automatically in separate windows for testing on a single PC.

---

## 🌐 Connecting Over the Public Internet

To connect two computers across different Wi-Fi networks or over the public internet:

### Option A: Run the Signaling Server on a Cloud VPS
1. Copy the `server/` folder to any cheap Linux or Windows VPS (AWS Lightsail, DigitalOcean, Hetzner, etc.).
2. Run `npm install && npm start` (or use PM2/Docker).
3. On both **End-User** and **Host** clients, click **"Signaling Server Configuration"** in the UI and enter your VPS WebSocket address:
   ```
   ws://YOUR_VPS_PUBLIC_IP:9090
   ```
   *(or `wss://yourdomain.com` if using SSL/TLS)*.

### Option B: Use Ngrok / Cloudflare Tunnel (Free & Instant)
1. On the machine running `START_SERVER.bat`, run:
   ```bash
   ngrok http 9090
   ```
2. Copy the resulting forwarding URL (e.g., `wss://xxxx-xxxx.ngrok-free.app`).
3. Paste that URL into the **Signaling Server** settings on both the End-User and Host machines.

---

## ✨ Features & Architecture

* **Double-Click Experience:** No complicated setup or command-line commands required.
* **Native Low-Latency Input & Screen Capture:**
  * Uses compiled native Windows Win32 API (`user32.dll` `SendInput`) for zero-lag mouse movement, clicks, scrolls, and keystrokes.
  * Uses native GDI+/DXGI screen capture pipeline.
* **Security & Access Control:**
  * **9-Digit Target ID:** Identifies the remote computer.
  * **6-Digit Session PIN:** Dynamic one-time password required for every connection.
  * **Emergency Disconnect:** Both End-User and Host have instant one-click Disconnect buttons.
  * **Active Session Banner:** Clear visual warning whenever a remote controller is active.
* **Silent Background Execution:**
  * **Auto-Hide on Connection:** When the host takes control, the terminal and browser window automatically close/hide so nothing blocks the screen.
  * **Manual Hide:** The End-User can also click **"Hide Terminal"** in the UI anytime.
  * **Stopping:** Stop anytime by ending **Node.js** in Windows Task Manager (`Ctrl + Shift + Esc`).

---

## 📁 Directory Structure

```
RemoteAssistUtility/
├── START_END_USER.bat               # 1-Click End-User Client launcher
├── START_HOST.bat                   # 1-Click Host Controller launcher
├── START_SERVER.bat                 # 1-Click Signaling Server launcher
├── START_ALL_LOCAL_DEMO.bat         # 1-Click complete demo launcher
├── README.md                        # User guide & internet deployment instructions
├── end_user/
│   ├── package.json
│   ├── agent.js                     # End-User agent & local HTTP/WS bridge
│   ├── input_injector.cs            # Native C# SendInput source
│   ├── screen_capture.cs            # Native C# GDI+ screen capturer source
│   ├── RemoteInput.exe              # Compiled native input injector
│   ├── RemoteCapture.exe            # Compiled native screen capturer
│   └── ui/                          # Modern Glassmorphic End-User UI
├── host/
│   ├── package.json
│   ├── controller.js                # Host controller & local UI server
│   └── ui/                          # Fullscreen remote desktop canvas & controls
└── server/
    ├── package.json
    └── server.js                    # WebSocket signaling & relay broker
```
