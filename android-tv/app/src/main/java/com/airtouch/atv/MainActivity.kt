package com.airtouch.atv

import android.os.Bundle
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.*
import okhttp3.*
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private var ws: WebSocket? = null
    private val scope = CoroutineScope(Dispatchers.Main)
    private lateinit var relayEt: EditText
    private lateinit var roomEt: EditText
    private lateinit var statusTv: TextView
    private lateinit var toggleBtn: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40,40,40,40) }
        relayEt = EditText(this).apply { hint="wss://your-relay.example.com"; setText("") }
        roomEt = EditText(this).apply { hint="room 5576"; setText("") }
        toggleBtn = Button(this).apply { text="Start Global Mouse" }
        statusTv = TextView(this).apply { text="Accessibility: check Settings → Accessibility → AirMouse ON" }
        val hint = TextView(this).apply { text="Phone keeps using https://.../airmouse.html?room=5576\nThis TV app moves SYSTEM cursor via AccessibilityService." }
        pad.addView(relayEt); pad.addView(roomEt); pad.addView(toggleBtn); pad.addView(statusTv); pad.addView(hint)
        setContentView(pad)
        toggleBtn.setOnClickListener { if(ws==null) connect() else disconnect() }
    }
    private fun connect(){
        val relay = relayEt.text.toString().trim().trimEnd('/')
        val room = roomEt.text.toString().trim()
        if(AirMouseService.instance==null){ statusTv.text="Enable Accessibility first!"; return }
        val req = Request.Builder().url("$relay?room=$room&role=tv-global").build()
        ws = OkHttpClient().newWebSocket(req, object: WebSocketListener(){
            override fun onOpen(ws: WebSocket, r: Response){ runOnUiThread{ statusTv.text="Connected $room"; toggleBtn.text="Stop" } }
            override fun onMessage(ws: WebSocket, text: String){
                try{
                    val j = JSONObject(text)
                    when(j.optString("type")){
                        "move" -> AirMouseService.move(j.optDouble("dx",0.0).toFloat(), j.optDouble("dy",0.0).toFloat())
                        "click" -> AirMouseService.click()
                        "key" -> {
                            val k=j.optString("key")
                            val code=mapOf("back" to 4,"home" to 3)[k] ?: 4
                            AirMouseService.key(code)
                        }
                        "up"-> AirMouseService.key(19); "down"-> AirMouseService.key(20); "left"->AirMouseService.key(21); "right"->AirMouseService.key(22)
                    }
                }catch(e:Exception){ runOnUiThread{ statusTv.text="err ${e.message}" } }
            }
            override fun onFailure(ws: WebSocket, t: Throwable, r: Response?){ runOnUiThread{ statusTv.text="fail ${t.message}" } }
        })
    }
    private fun disconnect(){ ws?.close(1000,null); ws=null; statusTv.text="Disconnected"; toggleBtn.text="Start Global Mouse" }
    override fun onDestroy(){ disconnect(); super.onDestroy() }
}
