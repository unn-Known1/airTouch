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
        fun move(dx: Float, dy: Float) {
            if (!dx.isFinite() || !dy.isFinite()) return
            val ndx = dx.coerceIn(-100f, 100f)
            val ndy = dy.coerceIn(-100f, 100f)
            val s = instance ?: return
            cursorX = (cursorX + ndx).coerceIn(0f, 1920f)
            cursorY = (cursorY + ndy).coerceIn(0f, 1080f)
            // hover gesture: tiny swipe at cursor pos to move system pointer (no click)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                val path = Path().apply { moveTo(cursorX, cursorY) }
                val g = GestureDescription.Builder()
                    .addStroke(GestureDescription.StrokeDescription(path, 0, 10))
                    .build()
                s.dispatchGesture(g, null, null)
            }
        }
        fun click() {
            val s = instance ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                val path = Path().apply { moveTo(cursorX, cursorY) }
                val g = GestureDescription.Builder()
                    .addStroke(GestureDescription.StrokeDescription(path, 0, 80))
                    .build()
                s.dispatchGesture(g, null, null)
            }
        }
        fun key(code: Int) {
            val s = instance ?: return
            when(code){
                4 -> s.performGlobalAction(GLOBAL_ACTION_BACK)
                3 -> s.performGlobalAction(GLOBAL_ACTION_HOME)
                else -> {} // extend with Instrumentation if needed
            }
        }
    }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}
    override fun onServiceConnected() { instance = this }
    override fun onDestroy() { instance = null; super.onDestroy() }
}
