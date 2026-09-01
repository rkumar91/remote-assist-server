#!/usr/bin/env python3
"""
mac_helper.py - Cross-Platform Native Helper for macOS
Provides Screen Capture & Input Injection for RemoteAssistUtility.
Uses Quartz / CoreGraphics / ImageIO for maximum speed and zero third-party pip dependencies.
"""

import sys
import os
import time
import struct
import objc
from Foundation import NSData, NSDictionary
import Quartz
from Quartz.CoreGraphics import (
    CGMainDisplayID,
    CGDisplayPixelsWide,
    CGDisplayPixelsHigh,
    CGWindowListCreateImage,
    CGRectInfinite,
    kCGWindowListOptionOnScreenOnly,
    kCGNullWindowID,
    kCGWindowImageDefault,
    CGImageDestinationCreateWithData,
    CGImageDestinationAddImage,
    CGImageDestinationFinalize,
    CGEventCreateMouseEvent,
    CGEventCreateKeyboardEvent,
    CGEventCreateScrollWheelEvent,
    CGEventPost,
    CGEventPostToPid,
    CGEventSetIntegerValueField,
    kCGHIDEventTap,
    kCGSessionEventTap,
    kCGAnnotatedSessionEventTap,
    kCGEventMouseMoved,
    kCGEventLeftMouseDown,
    kCGEventLeftMouseUp,
    kCGEventRightMouseDown,
    kCGEventRightMouseUp,
    kCGEventOtherMouseDown,
    kCGEventOtherMouseUp,
    kCGEventScrollWheel,
    kCGScrollWheelEventDeltaAxis1,
    kCGMouseButtonLeft,
    kCGMouseButtonRight,
    kCGMouseButtonCenter,
    CGPoint
)
from Quartz import CGDisplayBounds
from ApplicationServices import AXIsProcessTrusted, AXIsProcessTrustedWithOptions, kAXTrustedCheckOptionPrompt

# Virtual Key (Windows VK -> macOS Virtual Key Code Mapping)
VK_TO_MAC_KEYCODE = {
    8: 51,    # Backspace / Delete
    9: 48,    # Tab
    13: 36,   # Return / Enter
    16: 56,   # Shift
    17: 59,   # Control
    18: 58,   # Option / Alt
    20: 57,   # CapsLock
    27: 53,   # Escape
    32: 49,   # Space
    33: 116,  # PageUp
    34: 121,  # PageDown
    35: 119,  # End
    36: 115,  # Home
    37: 123,  # Left Arrow
    38: 126,  # Up Arrow
    39: 124,  # Right Arrow
    40: 125,  # Down Arrow
    45: 114,  # Help / Insert
    46: 117,  # Forward Delete
    91: 55,   # Command / Meta (Left)
    92: 54,   # Command / Meta (Right)
    # Standard alphanumeric keys (VK 48-57, 65-90)
    48: 29, 49: 18, 50: 19, 51: 20, 52: 21, 53: 23, 54: 22, 55: 26, 56: 28, 57: 25,
    65: 0, 66: 11, 67: 8, 68: 2, 69: 14, 70: 3, 71: 5, 72: 4, 73: 34, 74: 38,
    75: 40, 76: 37, 77: 46, 78: 45, 79: 31, 80: 35, 81: 12, 82: 15, 83: 1, 84: 17,
    85: 32, 86: 9, 87: 13, 88: 7, 89: 16, 90: 6,
    # Function keys (F1-F12)
    112: 122, 113: 120, 114: 99, 115: 118, 116: 96, 117: 97,
    118: 98, 119: 100, 120: 101, 121: 109, 122: 103, 123: 111
}

def post_event(evt):
    if not evt:
        return
    try:
        CGEventPost(kCGHIDEventTap, evt)
    except Exception:
        try:
            CGEventPost(kCGSessionEventTap, evt)
        except Exception:
            pass

def check_accessibility():
    try:
        options = {kAXTrustedCheckOptionPrompt: True}
        trusted = AXIsProcessTrustedWithOptions(options)
        if not trusted:
            sys.stderr.write("[WARNING] Accessibility permissions NOT granted! Please enable Accessibility for Terminal in System Settings > Privacy & Security > Accessibility.\n")
            sys.stderr.flush()
        return trusted
    except Exception:
        return True

def get_screen_info():
    main_display = CGMainDisplayID()
    bounds = CGDisplayBounds(main_display)
    point_width = int(bounds.size.width)
    point_height = int(bounds.size.height)
    pixel_width = int(CGDisplayPixelsWide(main_display))
    pixel_height = int(CGDisplayPixelsHigh(main_display))
    return point_width, point_height, pixel_width, pixel_height

def run_input_loop():
    check_accessibility()
    pt_w, pt_h, px_w, px_h = get_screen_info()
    scale_x = pt_w / float(px_w) if px_w > 0 else 1.0
    scale_y = pt_h / float(px_h) if px_h > 0 else 1.0

    # Tell agent our captured pixel resolution
    sys.stdout.write(f"READY:{px_w}:{px_h}\n")
    sys.stdout.flush()

    current_pos = CGPoint(pt_w / 2.0, pt_h / 2.0)

    for line in sys.stdin:
        line = line.strip()
        if not line or line.upper() == "QUIT":
            break

        try:
            parts = line.split()
            cmd = parts[0].upper()

            if cmd == "MOVE" and len(parts) >= 3:
                x = float(parts[1]) * scale_x
                y = float(parts[2]) * scale_y
                current_pos = CGPoint(x, y)
                evt = CGEventCreateMouseEvent(None, kCGEventMouseMoved, current_pos, kCGMouseButtonLeft)
                post_event(evt)

            elif cmd == "MOUSEDOWN" and len(parts) >= 2:
                btn = parts[1].upper()
                if len(parts) >= 4:
                    x = float(parts[2]) * scale_x
                    y = float(parts[3]) * scale_y
                    current_pos = CGPoint(x, y)
                
                evt_type = kCGEventLeftMouseDown
                mouse_btn = kCGMouseButtonLeft
                if btn == "RIGHT":
                    evt_type = kCGEventRightMouseDown
                    mouse_btn = kCGMouseButtonRight
                elif btn == "MIDDLE":
                    evt_type = kCGEventOtherMouseDown
                    mouse_btn = kCGMouseButtonCenter

                evt = CGEventCreateMouseEvent(None, evt_type, current_pos, mouse_btn)
                post_event(evt)

            elif cmd == "MOUSEUP" and len(parts) >= 2:
                btn = parts[1].upper()
                if len(parts) >= 4:
                    x = float(parts[2]) * scale_x
                    y = float(parts[3]) * scale_y
                    current_pos = CGPoint(x, y)

                evt_type = kCGEventLeftMouseUp
                mouse_btn = kCGMouseButtonLeft
                if btn == "RIGHT":
                    evt_type = kCGEventRightMouseUp
                    mouse_btn = kCGMouseButtonRight
                elif btn == "MIDDLE":
                    evt_type = kCGEventOtherMouseUp
                    mouse_btn = kCGMouseButtonCenter

                evt = CGEventCreateMouseEvent(None, evt_type, current_pos, mouse_btn)
                post_event(evt)

            elif cmd == "WHEEL" and len(parts) >= 2:
                delta = int(parts[1])
                wheel_units = 3 if delta > 0 else -3
                evt = CGEventCreateScrollWheelEvent(None, 0, 1, wheel_units)
                post_event(evt)

            elif cmd == "KEYDOWN" and len(parts) >= 2:
                vk = int(parts[1])
                mac_key = VK_TO_MAC_KEYCODE.get(vk, None)
                if mac_key is not None:
                    evt = CGEventCreateKeyboardEvent(None, mac_key, True)
                    post_event(evt)

            elif cmd == "KEYUP" and len(parts) >= 2:
                vk = int(parts[1])
                mac_key = VK_TO_MAC_KEYCODE.get(vk, None)
                if mac_key is not None:
                    evt = CGEventCreateKeyboardEvent(None, mac_key, False)
                    post_event(evt)

        except Exception as e:
            sys.stderr.write(f"[Mac Input Error] {e}\n")
            sys.stderr.flush()

def run_capture_loop(quality=55, fps=20):
    delay_s = 1.0 / max(1, min(60, fps))
    quality_factor = max(0.1, min(1.0, quality / 100.0))

    # stdout binary stream
    stdout_fd = sys.stdout.buffer

    options_dict = NSDictionary.dictionaryWithObject_forKey_(
        quality_factor,
        Quartz.kCGImageDestinationLossyCompressionQuality
    )

    while True:
        start_time = time.time()
        try:
            # Capture entire desktop with mouse cursor & hardware overlays
            image_ref = CGWindowListCreateImage(
                CGRectInfinite,
                kCGWindowListOptionOnScreenOnly,
                kCGNullWindowID,
                kCGWindowImageDefault
            )

            if image_ref:
                data = Quartz.CFDataCreateMutable(None, 0)
                dest = CGImageDestinationCreateWithData(data, "public.jpeg", 1, None)
                if dest:
                    CGImageDestinationAddImage(dest, image_ref, options_dict)
                    if CGImageDestinationFinalize(dest):
                        jpeg_bytes = bytes(data)
                        length = len(jpeg_bytes)

                        # 4-byte big endian header + payload
                        stdout_fd.write(struct.pack('>I', length))
                        stdout_fd.write(jpeg_bytes)
                        stdout_fd.flush()

            elapsed = time.time() - start_time
            sleep_time = delay_s - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

        except Exception as e:
            sys.stderr.write(f"Mac capture loop error: {e}\n")
            sys.stderr.flush()
            time.sleep(0.1)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--capture":
        q = int(sys.argv[2]) if len(sys.argv) > 2 else 55
        f = int(sys.argv[3]) if len(sys.argv) > 3 else 20
        run_capture_loop(quality=q, fps=f)
    elif len(sys.argv) > 1 and sys.argv[1] == "--input":
        run_input_loop()
    else:
        print("Usage: mac_helper.py --capture [quality] [fps] | --input")
