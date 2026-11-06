"""FastAPI + WebSocket server for The Manipulator."""
from __future__ import annotations

import asyncio
import os
import secrets
import string
import threading
import time
import json
import uuid
import urllib.request
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.game.session import GameSession
from backend.bot_assistant import bot, send_hint_to_gm

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
load_dotenv(BASE_DIR / ".env")

app = FastAPI(title="The Manipulator", version="1.0.0")
rooms: dict[str, GameSession] = {}
app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")


@app.get("/")
async def homepage():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "the-manipulator", "rooms": len(rooms)}


def start_discord_bot():
    token = os.getenv("DISCORD_BOT_TOKEN")
    if not token or not getattr(bot, "available", False):
        print("Discord DM assistant disabled (no bot token or discord.py).")
        return
    try:
        bot.run(token)
    except Exception as exc:
        print(f"Discord bot failed to start: {exc}")


@app.on_event("startup")
async def startup_event():
    if os.getenv("DISCORD_BOT_TOKEN") and getattr(bot, "available", False):
        threading.Thread(target=start_discord_bot, daemon=True, name="discord-bot").start()


def new_room_code():
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        if code not in rooms:
            return code


async def send(ws, payload):
    await ws.send_json(payload)


async def broadcast(session, payload):
    stale = []
    for player in list(session.players):
        ws = player.get("ws")
        if ws is None:
            continue
        try:
            await send(ws, payload)
        except Exception:
            stale.append(player)
    for player in stale:
        player["connected"] = False
        player["ws"] = None


async def broadcast_state(session):
    await broadcast(session, {"type": "room_state", "state": session.public_state()})


async def send_private_state(session, player):
    # Send the secret only to GM and Manipulator over each player's private WebSocket.
    # Ordinary guessers never receive secret data.
    payload = {"type": "private_role", "role": player.get("role")}
    if player.get("role") in {"GM", "MANIPULATOR"}:
        payload["secret_word"] = session.secret_data.get("word", "")
        payload["secret_info"] = session.secret_data.get("info", "")
        payload["category"] = session.secret_data.get("category", "ความรู้ทั่วไป")
        payload["difficulty"] = session.secret_data.get("difficulty", "medium")
        payload["image_url"] = session.secret_data.get("image_url", "")
        payload["image_source_url"] = session.secret_data.get("image_source_url", "")
        payload["image_credit"] = session.secret_data.get("image_credit", "")
        payload["image_license"] = session.secret_data.get("image_license", "")
    await send(player["ws"], payload)


def cancel_timer(session):
    task = session.timer_task
    if task and not task.done() and task is not asyncio.current_task():
        task.cancel()
    session.timer_task = None


def start_turn_timer(session):
    cancel_timer(session)
    room_code = session.room_id
    active_id = session.current_turn_id()

    async def timeout():
        try:
            await asyncio.sleep(session.turn_seconds)
            current = rooms.get(room_code)
            if current is not session or session.phase != "playing" or session.current_turn_id() != active_id:
                return
            player = session.get_player(active_id)
            session.add_history({
                "kind": "system", "text": f"หมดเวลาเทิร์นของ {player['name'] if player else 'ผู้เล่น'}",
                "turn": session.turn_number
            })
            session.advance_turn()
            await broadcast_state(session)
            start_turn_timer(session)
        except asyncio.CancelledError:
            return

    session.timer_task = asyncio.create_task(timeout())



async def finish_voting(session):
    """Close a vote round; ties enter a fresh 60-second runoff."""
    if session.phase != "voting":
        return
    all_voters = [p for p in session.players if p.get("role") != "GM"]
    candidates = [p for p in all_voters if session.runoff_candidates is None or p["id"] in session.runoff_candidates]
    candidate_ids = {p["id"] for p in candidates}
    counts = {pid: 0 for pid in candidate_ids}
    for candidate_id in session.votes.values():
        if candidate_id in counts:
            counts[candidate_id] += 1
    highest = max(counts.values(), default=0)
    leaders = [pid for pid, count in counts.items() if count == highest]
    display_names = session.display_names()
    round_record = {
        "round": session.voting_round or 1,
        "runoff": bool(session.voting_round > 1),
        "votes": dict(counts),
        "vote_details": [
            {"player_id": p["id"], "player_name": display_names[p["id"]], "votes": counts.get(p["id"], 0)}
            for p in candidates
        ],
        "submitted_votes": len(session.votes),
        "eligible_voters": len(all_voters),
        "timed_out": len(session.votes) < len(all_voters),
    }
    session.vote_rounds.append(round_record)

    if len(leaders) > 1:
        # If nobody voted, all candidates remain eligible for the runoff.
        session.runoff_candidates = leaders
        session.voting_round += 1
        session.votes = {}
        session.vote_deadline = None
        cancel_timer(session)
        await broadcast(session, {
            "type": "runoff_started", "round": session.voting_round,
            "candidate_ids": leaders,
            "candidate_names": [display_names.get(pid, "ผู้เล่น") for pid in leaders],
            "seconds": session.vote_seconds,
        })
        start_vote_timer(session)
        await broadcast_state(session)
        return

    suspect_id = leaders[0] if leaders else None
    caught = bool(suspect_id and session.manipulator and suspect_id == session.manipulator["id"])
    session.phase = "finished"
    session.vote_deadline = None
    session.result = {
        "winner": "GUESSERS" if caught else "MANIPULATOR",
        "caught": caught,
        "suspect_id": suspect_id,
        "suspect_name": display_names.get(suspect_id) if suspect_id else None,
        "manipulator_id": session.manipulator["id"],
        "manipulator_name": display_names.get(session.manipulator["id"], session.manipulator["name"]),
        "votes": counts,
        "vote_details": round_record["vote_details"],
        "submitted_votes": len(session.votes),
        "eligible_voters": len(all_voters),
        "timed_out": len(session.votes) < len(all_voters),
        "vote_rounds": session.vote_rounds,
    }
    cancel_timer(session)
    await broadcast(session, {"type": "game_finished", "result": session.result})
    await broadcast_state(session)


def start_vote_timer(session):
    cancel_timer(session)
    room_code = session.room_id
    session.vote_deadline = time.time() + session.vote_seconds

    async def timeout():
        try:
            await asyncio.sleep(session.vote_seconds)
            current = rooms.get(room_code)
            if current is session and session.phase == "voting":
                await finish_voting(session)
        except asyncio.CancelledError:
            return

    session.timer_task = asyncio.create_task(timeout())


def is_gm(session, player_id):
    return bool(session.gm and session.gm["id"] == player_id)


async def discord_identity(access_token: str):
    """Validate an Embedded App OAuth access token with Discord before trusting its user ID."""
    if not access_token:
        return None
    def fetch_user():
        request = urllib.request.Request(
            "https://discord.com/api/users/@me",
            headers={"Authorization": f"Bearer {access_token}", "User-Agent": "TheManipulator/1.0"},
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    try:
        user = await asyncio.to_thread(fetch_user)
        return str(user.get("id") or "") or None
    except Exception:
        return None


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    player_id = None
    session = None
    try:
        while True:
            message = await websocket.receive_json()
            action = message.get("type") or message.get("action")

            if action == "register":
                if player_id is not None:
                    await send(websocket, {"type": "error", "message": "เชื่อมต่อผู้เล่นแล้ว"})
                    continue
                name = str(message.get("username", "ผู้เล่น")).strip()[:32] or "ผู้เล่น"
                access_token = str(message.get("discord_access_token", "")).strip()
                verified_discord_id = await discord_identity(access_token) if access_token else None
                if access_token and not verified_discord_id:
                    await send(websocket, {"type": "error", "message": "ยืนยันตัวตน Discord ไม่สำเร็จ กรุณาเชื่อมต่อใหม่"})
                    await websocket.close(code=4401)
                    return
                # Never accept a client-supplied player ID. Guest IDs are server-issued.
                player_id = verified_discord_id or f"guest_{uuid.uuid4().hex}"
                await send(websocket, {"type": "registered", "user_id": player_id, "username": name,
                                       "identity": "discord" if verified_discord_id else "guest"})

            elif action == "create_room":
                if not player_id:
                    await send(websocket, {"type": "error", "message": "กรุณาเชื่อมต่อผู้เล่นก่อน"})
                    continue
                # A user can host only one room per connection.
                code = new_room_code()
                name = str(message.get("username", "ผู้เล่น")).strip()[:32] or "ผู้เล่น"
                session = GameSession(code, player_id, name)
                session.players[0]["ws"] = websocket
                rooms[code] = session
                await send(websocket, {"type": "room_created", "room_code": code})
                await broadcast_state(session)

            elif action == "join_room":
                if not player_id:
                    await send(websocket, {"type": "error", "message": "กรุณาเชื่อมต่อผู้เล่นก่อน"})
                    continue
                code = str(message.get("room_code", "")).strip().upper()
                target = rooms.get(code)
                if not target:
                    await send(websocket, {"type": "error", "message": "ไม่พบห้องนี้ กรุณาตรวจสอบรหัสห้อง"})
                    continue
                if target.phase != "lobby":
                    await send(websocket, {"type": "error", "message": "เกมเริ่มแล้ว ไม่สามารถเข้าร่วมได้"})
                    continue
                if target.get_player(player_id):
                    await send(websocket, {"type": "error", "message": "คุณอยู่ในห้องนี้แล้ว"})
                    continue
                if len(target.players) >= 12:
                    await send(websocket, {"type": "error", "message": "ห้องเต็มแล้ว (สูงสุด 12 คน)"})
                    continue
                session = target
                name = str(message.get("username", "ผู้เล่น")).strip()[:32] or "ผู้เล่น"
                target.players.append({
                    "id": player_id, "name": name, "ws": websocket,
                    "role": None, "connected": True, "vote": None
                })
                await send(websocket, {"type": "room_joined", "room_code": code})
                await broadcast_state(target)

            elif action == "leave_room":
                code = str(message.get("room_code", "")).strip().upper()
                target = rooms.get(code) or session
                if target and player_id:
                    target.players = [p for p in target.players if p["id"] != player_id]
                    if not target.players:
                        cancel_timer(target)
                        rooms.pop(target.room_id, None)
                    else:
                        if target.host_id == player_id:
                            target.host_id = target.players[0]["id"]
                        await broadcast_state(target)
                session = None
                await send(websocket, {"type": "left_room"})

            elif action == "start_game":
                code = str(message.get("room_code", "")).strip().upper()
                target = rooms.get(code) or session
                if not target:
                    await send(websocket, {"type": "error", "message": "ยังไม่ได้อยู่ในห้องเกม"})
                    continue
                if target.host_id != player_id:
                    await send(websocket, {"type": "error", "message": "เฉพาะเจ้าของห้องเท่านั้นที่เริ่มเกมได้"})
                    continue
                if len(target.players) < 3:
                    await send(websocket, {"type": "error", "message": "ต้องมีผู้เล่นอย่างน้อย 3 คนจึงเริ่มเกมได้"})
                    continue
                try:
                    started = target.assign_roles()
                except Exception as exc:
                    print("Could not load secret word:", exc)
                    await send(websocket, {"type": "error", "message": "โหลดคลังคำศัพท์ไม่สำเร็จ"})
                    continue
                if not started:
                    await send(websocket, {"type": "error", "message": "ไม่สามารถเริ่มเกมได้"})
                    continue
                for player in target.players:
                    await send_private_state(target, player)
                await broadcast_state(target)
                start_turn_timer(target)

                # Optional private DM to the GM when the Discord bot is configured.
                if target.gm and os.getenv("DISCORD_BOT_TOKEN") and getattr(bot, "available", False):
                    try:
                        gm_id = int(target.gm["id"])
                        if bot.loop and bot.loop.is_running():
                            future = asyncio.run_coroutine_threadsafe(
                                send_hint_to_gm(
                                    gm_discord_id=gm_id,
                                    secret_word=target.secret_data.get("word", ""),
                                    hint_info=target.secret_data.get("info", "")
                                ),
                                bot.loop
                            )
                            await asyncio.wrap_future(future)
                    except (ValueError, TypeError):
                        print("GM is using a browser guest account; skipped Discord DM.")
                    except Exception as exc:
                        print(f"Could not send GM hint: {exc}")

            elif action == "ask_question":
                target = rooms.get(str(message.get("room_code", "")).upper()) or session
                if not target or target.phase != "playing":
                    await send(websocket, {"type": "error", "message": "ขณะนี้ยังถามคำถามไม่ได้"})
                    continue
                if target.current_turn_id() != player_id:
                    await send(websocket, {"type": "error", "message": "ยังไม่ใช่เทิร์นของคุณ"})
                    continue
                question = str(message.get("question", "")).strip()[:300]
                if not question:
                    await send(websocket, {"type": "error", "message": "กรุณาพิมพ์คำถามก่อนส่ง"})
                    continue
                if target.active_question or target.pending_guess:
                    await send(websocket, {"type": "error", "message": "กรุณารอให้ GM จัดการรายการก่อน"})
                    continue
                cancel_timer(target)
                display_name = target.display_names().get(player_id, target.get_player(player_id)["name"])
                target.active_question = {"player_id": player_id, "question": question}
                target.add_history({"kind": "question", "player_id": player_id,
                                    "player_name": display_name, "text": question, "turn": target.turn_number})
                await broadcast(target, {"type": "gm_question", "question": question,
                                          "player_id": player_id, "player_name": display_name})
                await broadcast_state(target)

            elif action == "gm_answer":
                target = rooms.get(str(message.get("room_code", "")).upper()) or session
                if not target or target.phase != "playing" or not is_gm(target, player_id):
                    await send(websocket, {"type": "error", "message": "เฉพาะ GM เท่านั้นที่ตอบคำถามได้"})
                    continue
                answer = str(message.get("answer", "")).strip()
                if not target.active_question:
                    await send(websocket, {"type": "error", "message": "ยังไม่มีคำถามรอคำตอบ"})
                    continue
                if answer not in ("ใช่", "ไม่ใช่", "อาจจะ"):
                    await send(websocket, {"type": "error", "message": "เลือกคำตอบที่กำหนด"})
                    continue
                # Attach the GM's answer to its question so the public history stays readable.
                for entry in reversed(target.history):
                    if entry.get("kind") == "question" and "answer" not in entry:
                        entry["answer"] = answer
                        break
                target.active_question = None
                await broadcast(target, {"type": "gm_answered", "answer": answer})
                target.advance_turn()
                await broadcast_state(target)
                start_turn_timer(target)

            elif action == "submit_guess":
                target = rooms.get(str(message.get("room_code", "")).upper()) or session
                if not target or target.phase != "playing" or target.current_turn_id() != player_id:
                    await send(websocket, {"type": "error", "message": "ยังไม่ใช่เทิร์นของคุณ"})
                    continue
                if target.pending_guess or target.active_question:
                    await send(websocket, {"type": "error", "message": "กรุณารอ GM จัดการรายการก่อน"})
                    continue
                guess = str(message.get("guess", "")).strip()[:100]
                if not guess:
                    await send(websocket, {"type": "error", "message": "กรุณาพิมพ์คำที่ต้องการเดา"})
                    continue
                player = target.get_player(player_id)
                cancel_timer(target)
                target.pending_guess = {"player_id": player_id, "player_name": player["name"], "guess": guess}
                display_name = target.display_names().get(player_id, player["name"])
                target.pending_guess["player_name"] = display_name
                target.add_history({"kind": "guess", "player_id": player_id,
                                    "player_name": display_name, "text": guess,
                                    "turn": target.turn_number})
                await broadcast(target, {"type": "guess_submitted", "guess": target.pending_guess})
                await broadcast_state(target)

            elif action == "gm_guess_result":
                target = rooms.get(str(message.get("room_code", "")).upper()) or session
                if not target or not is_gm(target, player_id) or not target.pending_guess:
                    await send(websocket, {"type": "error", "message": "ไม่มีคำเดาที่รอ GM ตรวจ"})
                    continue
                correct = bool(message.get("correct"))
                pending = target.pending_guess
                target.add_history({"kind": "guess_result", "text": "เดาถูก" if correct else "ยังไม่ถูก",
                                    "player_name": pending["player_name"], "turn": target.turn_number})
                target.pending_guess = None
                await broadcast(target, {"type": "guess_judged", "correct": correct,
                                         "player_name": pending["player_name"]})
                if correct:
                    cancel_timer(target)
                    target.phase = "voting"
                    target.votes = {}
                    target.vote_rounds = []
                    target.voting_round = 1
                    target.runoff_candidates = None
                    await broadcast(target, {"type": "voting_started", "guesser": pending["player_name"], "round": 1})
                    start_vote_timer(target)
                else:
                    target.advance_turn()
                    start_turn_timer(target)
                await broadcast_state(target)

            elif action == "cast_vote":
                target = rooms.get(str(message.get("room_code", "")).upper()) or session
                if not target or target.phase != "voting":
                    await send(websocket, {"type": "error", "message": "ขณะนี้ยังไม่อยู่ในช่วงโหวต"})
                    continue
                if target.vote_deadline is not None and time.time() >= target.vote_deadline:
                    await finish_voting(target)
                    await send(websocket, {"type": "error", "message": "หมดเวลาโหวตรอบนี้แล้ว"})
                    continue
                voter = target.get_player(player_id)
                candidate_id = str(message.get("candidate_id", ""))
                candidate = target.get_player(candidate_id)
                if not voter or voter.get("role") == "GM":
                    await send(websocket, {"type": "error", "message": "GM ไม่มีสิทธิ์ลงคะแนน"})
                    continue
                if voter["id"] in target.votes:
                    await send(websocket, {"type": "error", "message": "คุณลงคะแนนไปแล้ว"})
                    continue
                if not candidate or candidate.get("role") == "GM":
                    await send(websocket, {"type": "error", "message": "เลือกผู้เล่นที่ต้องการโหวต"})
                    continue
                if candidate_id == voter["id"]:
                    await send(websocket, {"type": "error", "message": "ไม่สามารถโหวตตัวเองได้"})
                    continue
                if target.runoff_candidates is not None and candidate_id not in target.runoff_candidates:
                    await send(websocket, {"type": "error", "message": "รอบ Runoff โหวตได้เฉพาะผู้เล่นที่คะแนนเสมอกัน"})
                    continue
                target.votes[voter["id"]] = candidate_id
                await broadcast(target, {"type": "vote_update", "count": len(target.votes)})
                await broadcast_state(target)
                eligible = [p for p in target.players if p.get("role") != "GM"]
                if len(target.votes) >= len(eligible):
                    await finish_voting(target)

            elif action == "return_to_lobby":
                code = str(message.get("room_code", "")).strip().upper()
                target = rooms.get(code) or session
                if not target or target.phase != "finished":
                    await send(websocket, {"type": "error", "message": "ยังไม่สามารถกลับ Lobby ได้"})
                    continue
                if target.host_id != player_id:
                    await send(websocket, {"type": "error", "message": "เฉพาะเจ้าของห้องเท่านั้นที่เริ่มรอบใหม่ได้"})
                    continue
                cancel_timer(target)
                target.reset_to_lobby()
                await broadcast_state(target)

            else:
                await send(websocket, {"type": "error", "message": f"ไม่รู้จักคำสั่ง: {action}"})

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"WebSocket error: {exc}")
        try:
            await send(websocket, {"type": "error", "message": "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์"})
        except Exception:
            pass
    finally:
        if session and player_id:
            player = session.get_player(player_id)
            if player and player.get("ws") is websocket:
                player["ws"] = None
                player["connected"] = False
            if session.phase == "lobby":
                session.players = [p for p in session.players if p["id"] != player_id]
                if not session.players:
                    rooms.pop(session.room_id, None)
                else:
                    if session.host_id == player_id:
                        session.host_id = session.players[0]["id"]
                    await broadcast_state(session)
            else:
                await broadcast_state(session)
