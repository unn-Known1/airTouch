package com.airtouch.atv

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.*
import okhttp3.*
import org.json.JSONObject
import android.content.ClipboardManager
import android.content.ClipData
import android.content.Context
import android.os.SystemClock
import android.view.InputDevice
import java.lang.reflect.Method

class MainActivity : AppCompatActivity() {
    private var ws: WebSocket? = null
    private val scope = CoroutineScope(Dispatchers.Main)
    private lateinit var relayEt: EditText
    private lateinit var roomEt: EditText
    private lateinit var statusTv: TextView
    private lateinit var toggleBtn: Button
    private lateinit var logTv: TextView

    companion object {
        var appContext: Context? = null
        fun injectKey(code: Int){
            try {
                val ctx = appContext ?: AirMouseService.instance?.applicationContext ?: return
                // Preferred: use Instrumentation via reflection to avoid extra permission
                val inst = Class.forName("android.app.Instrumentation").getDeclaredConstructor().newInstance()
                val m: Method = inst.javaClass.getMethod("sendKeyDownUpSync", Int::class.javaPrimitiveType)
                m.invoke(inst, code)
            } catch (e: Exception) {
                // Fallback: try via shell (may need root on some TVs, but we try)
                try { Runtime.getRuntime().exec(arrayOf("input","keyevent",code.toString())) } catch(_:Exception){}
            }
        }
        fun injectText(t: String){
            try {
                val ctx = appContext ?: AirMouseService.instance?.applicationContext ?: return
                // Try clipboard paste approach
                val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("airtouch", t))
                // Send paste key (279) or try input text via shell
                try { Runtime.getRuntime().exec(arrayOf("input","text", t.replace(" ", "%s"))) } catch(_:Exception){
                    injectKey(279) // KEYCODE_PASTE
                }
            } catch(_:Exception){
                try { Runtime.getRuntime().exec(arrayOf("input","text", t.replace(" ", "%s"))) } catch(_:Exception){}
            }
        }
        fun launchPkg(pkg: String){
            try {
                val ctx = appContext ?: AirMouseService.instance?.applicationContext ?: return
                val pm = ctx.packageManager
                val intent = pm.getLaunchIntentForPackage(pkg) ?: Intent(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER); `package` = pkg }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(intent)
            } catch(_:Exception){
                // fallback: try am start via shell
                try { Runtime.getRuntime().exec(arrayOf("am","start","-n","$pkg/.MainActivity")) } catch(_:Exception){}
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appContext = applicationContext
        val pad = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40,40,40,40) }
        relayEt = EditText(this).apply { hint="wss://your-relay.example.com"; setText("") }
        roomEt = EditText(this).apply { hint="room 5576"; setText("") }
        toggleBtn = Button(this).apply { text="Start Global Mouse" }
        statusTv = TextView(this).apply { text="Accessibility: check Settings → Accessibility → AirMouse ON\nIf OFF, open Settings → Accessibility → AirMouse → ON" }
        logTv = TextView(this).apply { text="Log: —"; textSize=11f; setPadding(0,12,0,0) }
        val hint = TextView(this).apply { text="Phone: https://unn-known1.github.io/airTouch/?room=CODE&mode=remote\nNow with TV remote: D-Pad, Media, Keyboard, Apps, Numpad.\nGlobal cursor needs Accessibility ON."; textSize=11f }
        // restore saved
        try {
            relayEt.setText(getSharedPreferences("airtouch", MODE_PRIVATE).getString("relay",""))
            roomEt.setText(getSharedPreferences("airtouch", MODE_PRIVATE).getString("room",""))
        } catch(_:Exception){}
        pad.addView(relayEt); pad.addView(roomEt); pad.addView(toggleBtn); pad.addView(statusTv); pad.addView(hint); pad.addView(logTv)
        setContentView(pad)
        toggleBtn.setOnClickListener { if(ws==null) connect() else disconnect() }
    }
    private fun log(msg: String){ runOnUiThread{ logTv.text = msg + "\n" + logTv.text.toString().take(400) } }
    private fun connect(){
        val relay = relayEt.text.toString().trim().trimEnd('/')
        val room = roomEt.text.toString().trim()
        if(relay.isEmpty() || room.isEmpty()){ statusTv.text="Enter relay + room"; return }
        if(AirMouseService.instance==null){ statusTv.text="Enable Accessibility first! Settings → Accessibility → AirMouse ON"; return }
        try { getSharedPreferences("airtouch", MODE_PRIVATE).edit().putString("relay",relay).putString("room",room).apply() } catch(_:Exception){}
        val req = Request.Builder().url("$relay?room=$room&role=tv-global").build()
        log("Connecting $relay room $room")
        ws = OkHttpClient().newWebSocket(req, object: WebSocketListener(){
            override fun onOpen(ws: WebSocket, r: Response){ runOnUiThread{ statusTv.text="Connected $room ● Global"; toggleBtn.text="Stop" }; log("Connected") }
            override fun onMessage(ws: WebSocket, text: String){
                try{
                    val j = JSONObject(text)
                    val type = j.optString("type")
                    log("recv $type")
                    when(type){
                        "move" -> AirMouseService.move(j.optDouble("dx",0.0).toFloat(), j.optDouble("dy",0.0).toFloat())
                        "click" -> {
                            val btn=j.optString("button","left")
                            AirMouseService.click(button=btn)
                        }
                        "long_click" -> AirMouseService.click(button=j.optString("button","left"), longPress=true, duration=j.optInt("duration",600))
                        "key" -> AirMouseService.keyByName(j.optString("key"))
                        "text","keyboard" -> {
                            val t=j.optString("text","")
                            if(t.isNotEmpty()) AirMouseService.textInput(t)
                            val action=j.optString("action","")
                            if(action=="enter") AirMouseService.key(66)
                            else if(action=="search") AirMouseService.key(84)
                            else if(action=="delete") AirMouseService.key(67)
                        }
                        "launch" -> {
                            val pkg=j.optString("pkg", j.optString("app",""))
                            if(pkg.isNotEmpty()) AirMouseService.launchApp(pkg)
                        }
                        "up"-> AirMouseService.key(19); "down"-> AirMouseService.key(20); "left"->AirMouseService.key(21); "right"->AirMouseService.key(22)
                        "center"-> AirMouseService.key(23)
                        "media_play_pause"-> AirMouseService.key(85); "media_play"-> AirMouseService.key(126); "media_pause"-> AirMouseService.key(127)
                        "media_next"-> AirMouseService.key(87); "media_prev"-> AirMouseService.key(88); "media_stop"-> AirMouseService.key(86)
                        "media_rewind"-> AirMouseService.key(89); "media_fast_forward"-> AirMouseService.key(90); "captions"-> AirMouseService.key(175)
                        "num_0"-> AirMouseService.key(7); "num_1"-> AirMouseService.key(8); "num_2"-> AirMouseService.key(9); "num_3"-> AirMouseService.key(10); "num_4"-> AirMouseService.key(11)
                        "num_5"-> AirMouseService.key(12); "num_6"-> AirMouseService.key(13); "num_7"-> AirMouseService.key(14); "num_8"-> AirMouseService.key(15); "num_9"-> AirMouseService.key(16)
                        "channel_up"-> AirMouseService.key(166); "channel_down"-> AirMouseService.key(167)
                        "guide"-> AirMouseService.key(172); "info"-> AirMouseService.key(165); "settings_tv"-> AirMouseService.key(176); "search"-> AirMouseService.key(84); "input_hdmi"-> AirMouseService.key(178)
                        "power"-> AirMouseService.key(26); "menu"-> AirMouseService.key(82)
                        "color_red"-> AirMouseService.key(183); "color_green"-> AirMouseService.key(184); "color_yellow"-> AirMouseService.key(185); "color_blue"-> AirMouseService.key(186)
                        "scroll"-> {
                            val dy=j.optDouble("dy",0.0).toFloat()
                            // map scroll to dpad up/down
                            if(dy>2) AirMouseService.key(20) else if(dy<-2) AirMouseService.key(19)
                        }
                    }
                }catch(e:Exception){ log("err ${e.message}") }
            }
            override fun onFailure(ws: WebSocket, t: Throwable, r: Response?){ runOnUiThread{ statusTv.text="fail ${t.message}" }; log("fail ${t.message}") }
            override fun onClosed(ws: WebSocket, c:Int, r:String){ runOnUiThread{ statusTv.text="Closed"; toggleBtn.text="Start Global Mouse" } }
        })
    }
    private fun disconnect(){ try{ ws?.close(1000,null)}catch(_:Exception){}; ws=null; statusTv.text="Disconnected"; toggleBtn.text="Start Global Mouse" }
    override fun onDestroy(){ disconnect(); super.onDestroy() }
}
