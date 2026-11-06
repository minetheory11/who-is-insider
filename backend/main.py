from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import json
import asyncio
from game.session import GameSession
from bot_assistant import send_hint_to_gm, bot
import threading

app = FastAPI()

# เก็บ Session ของแต่ละห้องเกม
rooms = {}

# รัน Discord Bot Assistant ใน background thread
def run_bot():
    import os
    token = os.getenv("DISCORD_BOT_TOKEN")
    if token:
        bot.run(token)

threading.Thread(target=run_bot, daemon=True).start()

@app.websocket("/ws/{room_id}/{player_id}/{player_name}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, player_id: str, player_name: str):
    await websocket.accept()

    if room_id not in rooms:
        rooms[room_id] = GameSession(room_id)

    session = rooms[room_id]
    
    # เพิ่มผู้เล่นเข้าห้อง
    player_data = {"id": player_id, "name": player_name, "ws": websocket}
    session.players.append(player_data)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            # คำสั่งเริ่มเกม
            if message.get("action") == "start_game":
                if len(session.players) >= 3:
                    session.assign_roles()
                    
                    # 1. ส่งข้อมูลบริบทจาก API ไปให้ GM ทาง Discord DM
                    await send_hint_to_gm(
                        gm_discord_id=int(session.gm["id"]),
                        word=session.secret_data["word"],
                        info=session.secret_data["info"]
                    )

                    # 2. แจ้งสถานะเริ่มต้นเกมไปยังทุกผู้เล่นในห้อง
                    for p in session.players:
                        role = "GUESSER"
                        if p["id"] == session.gm["id"]:
                            role = "GM"
                        elif p["id"] == session.manipulator["id"]:
                            role = "MANIPULATOR"

                        await p["ws"].send_json({
                            "type": "game_started",
                            "role": role,
                            "secret_word": session.secret_data["word"] if role in ["GM", "MANIPULATOR"] else None
                        })

    except WebSocketDisconnect:
        session.players = [p for p in session.players if p["id"] != player_id]