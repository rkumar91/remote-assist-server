#!/bin/bash
# ============================================================
#  START_END_USER.command
#  Double-clickable startup script for macOS end users
# ============================================================

# Navigate to script's directory
cd "$(dirname "$0")"

echo "========================================================="
echo "      REMOTE ASSIST - END USER SHARING UTILITY (macOS)   "
echo "========================================================="
echo ""

# 1. Check for Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed!"
    echo "Please download and install Node.js from https://nodejs.org"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

# 2. Check for Python 3 & PyObjC (Built-in on macOS or installed via pip)
if command -v python3 &> /dev/null; then
    python3 -c "import Quartz, objc" &> /dev/null
    if [ $? -ne 0 ]; then
        echo "[Setup] Installing PyObjC native framework bindings..."
        pip3 install --quiet pyobjc-framework-Quartz pyobjc-core || pip install --quiet pyobjc-framework-Quartz pyobjc-core
    fi
fi

# 3. Ensure permissions
chmod +x mac_helper.py 2>/dev/null

# 4. Install npm dependencies if missing
if [ ! -d "node_modules" ]; then
    echo "[Setup] Installing Node dependencies..."
    npm install --silent
fi

echo ""
echo "========================================================="
echo " IMPORTANT PERMISSIONS NOTE:"
echo " If this is your first time running, please ensure"
echo " 'Screen Recording' and 'Accessibility' permissions are"
echo " granted in macOS System Settings > Privacy & Security."
echo "========================================================="
echo ""
echo "Starting Remote Assist End-User Agent..."
node agent.js

