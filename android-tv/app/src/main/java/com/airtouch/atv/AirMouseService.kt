package com.airtouch.atv

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.view.accessibility.AccessibilityEvent

class AirMouseService : AccessibilityService() {
    companion object {
        var instance: AirMouseService? = null
        var cursorX = 960f
        var cursorY = 540f
        var screenW = 1920f
        var screenH = 1080f
        fun updateScreenSize(w: Float, h: Float){ screenW=w; screenH=h; cursorX=cursorX.coerceIn(0f,w); cursorY=cursorY.coerceIn(0f,h) }
        fun move(dx: Float, dy: Float) {
            if (!dx.isFinite() || !dy.isFinite()) return
            val ndx = dx.coerceIn(-100f, 100f)
            val ndy = dy.coerceIn(-100f, 100f)
            val s = instance ?: return
            cursorX = (cursorX + ndx).coerceIn(0f, screenW)
            cursorY = (cursorY + ndy).coerceIn(0f, screenH)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                val path = Path().apply { moveTo(cursorX, cursorY) }
                val g = GestureDescription.Builder()
                    .addStroke(GestureDescription.StrokeDescription(path, 0, 10))
                    .build()
                s.dispatchGesture(g, null, null)
            }
        }
        fun click(button: String = "left", longPress: Boolean = false, duration: Int = 80) {
            val s = instance ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                val path = Path().apply { moveTo(cursorX, cursorY) }
                // long press for context menu, right click mapped to long
                val dur = if (longPress || button=="right") (duration.coerceIn(300,2000)) else 80
                val g = GestureDescription.Builder()
                    .addStroke(GestureDescription.StrokeDescription(path, 0, dur.toLong()))
                    .build()
                s.dispatchGesture(g, null, null)
            }
        }
        // expanded key handling: use global actions where possible, fallback to key injection via performGlobalAction + instrumentation
        fun key(code: Int) {
            val s = instance ?: return
            when(code){
                4 -> s.performGlobalAction(GLOBAL_ACTION_BACK)
                3 -> s.performGlobalAction(GLOBAL_ACTION_HOME)
                2, 84 -> s.performGlobalAction(GLOBAL_ACTION_BACK) // legacy
                else -> {
                    // try to inject via Runtime (requires no extra perm on some TVs) or just dispatch as accessibility key
                    try {
                        // use instrumentation via shell fallback handled in MainActivity for non-global codes
                        MainActivity.injectKey(code)
                    } catch (_:Exception) {}
                }
            }
        }
        fun keyByName(name: String){
            val map = mapOf(
                "back" to 4, "home" to 3, "menu" to 82, "power" to 26,
                "up" to 19, "down" to 20, "left" to 21, "right" to 22, "center" to 23, "enter" to 66,
                "vol_up" to 24, "vol_down" to 25, "mute" to 164,
                "media_play_pause" to 85, "media_play" to 126, "media_pause" to 127, "media_next" to 87, "media_prev" to 88, "media_stop" to 86, "media_rewind" to 89, "media_fast_forward" to 90, "captions" to 175,
                "guide" to 172, "info" to 165, "settings_tv" to 176, "search" to 84, "input_hdmi" to 178,
                "channel_up" to 166, "channel_down" to 167,
                "num_0" to 7, "num_1" to 8, "num_2" to 9, "num_3" to 10, "num_4" to 11, "num_5" to 12, "num_6" to 13, "num_7" to 14, "num_8" to 15, "num_9" to 16,
                "num_star" to 17, "num_hash" to 18,
                "color_red" to 183, "color_green" to 184, "color_yellow" to 185, "color_blue" to 186,
                "dpad_center_long" to 23
            )
            val code = map[name] ?: return
            if (name=="dpad_center_long") { click(longPress=true, duration=600); return }
            key(code)
        }
        fun textInput(t: String){
            // Best effort: try to inject via clipboard + paste, or via instrumentation
            try { MainActivity.injectText(t) } catch(_:Exception){}
        }
        fun launchApp(pkg: String){
            try { MainActivity.launchPkg(pkg) } catch(_:Exception){}
        }
    }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}
    override fun onServiceConnected() {
        instance = this
        // detect real screen size
        try {
            val dm = resources.displayMetrics
            screenW = dm.widthPixels.toFloat()
            screenH = dm.heightPixels.toFloat()
        } catch(_:Exception){}
    }
    override fun onDestroy() { instance = null; super.onDestroy() }
}
