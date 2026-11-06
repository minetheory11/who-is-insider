"""Game state and persistent per-room word rotation for The Manipulator."""
from __future__ import annotations

import json
import random
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
WORD_DB = BASE_DIR / "database" / "words.json"
USAGE_DB = BASE_DIR / "database" / "room_word_history.sqlite3"


def _word_key(word: dict) -> str:
    return str(word.get("id") or word.get("word") or "").strip()


class GameSession:
    def __init__(self, room_id: str, host_id: str, host_name: str):
        self.room_id = room_id
        self.host_id = host_id
        self.players = [{"id": host_id, "name": host_name, "ws": None, "role": None,
                         "connected": True, "vote": None}]
        self.gm = None
        self.manipulator = None
        self.secret_data = {}
        self.is_started = False
        self.phase = "lobby"
        self.turn_order = []
        self.turn_index = 0
        self.turn_seconds = 30
        self.turn_number = 1
        self.history = []
        self.pending_guess = None
        self.active_question = None
        self.votes = {}
        self.vote_rounds = []
        self.voting_round = 0
        self.runoff_candidates = None
        self.result = None
        self.timer_task = None
        self.vote_seconds = 60
        self.vote_deadline = None
        self.used_word_ids = set()
        self.difficulty_counts = {"easy": 0, "medium": 0, "hard": 0}

    def display_names(self):
        totals, seen, result = {}, {}, {}
        for player in self.players:
            totals[player["name"]] = totals.get(player["name"], 0) + 1
        for player in self.players:
            name = player["name"]
            seen[name] = seen.get(name, 0) + 1
            result[player["id"]] = f"{name} ({seen[name]})" if totals[name] > 1 and seen[name] > 1 else name
        return result

    def public_state(self):
        display_names = self.display_names()
        candidates = [p for p in self.players if p.get("role") != "GM"]
        vote_counts = {p["id"]: 0 for p in candidates}
        for candidate_id in self.votes.values():
            if candidate_id in vote_counts:
                vote_counts[candidate_id] += 1
        public_history = []
        for item in self.history[-200:]:
            entry = dict(item)
            if entry.get("player_id") in display_names:
                entry["player_name"] = display_names[entry["player_id"]]
            public_history.append(entry)
        public_result = None
        if self.phase == "finished" and self.result:
            public_result = self.result
        return {
            "room_code": self.room_id, "host_id": self.host_id,
            "players": [{"id": p["id"], "name": p["name"], "display_name": display_names[p["id"]],
                         "connected": p.get("connected", True),
                         "role": "GM" if self.gm and p["id"] == self.gm["id"] else None}
                        for p in self.players],
            "phase": self.phase, "is_started": self.is_started,
            "turn_seconds": self.turn_seconds, "turn_number": self.turn_number,
            "current_turn_id": self.current_turn_id(),
            "current_turn_name": display_names.get(self.current_turn_id()),
            "history": public_history, "pending_guess": self.pending_guess,
            "vote_count": len(self.votes),
            "voter_count": max(0, len(self.players) - (1 if self.gm else 0)),
            "vote_counts": vote_counts, "vote_seconds": self.vote_seconds,
            "vote_deadline": self.vote_deadline, "voting_round": self.voting_round,
            "runoff_candidates": list(self.runoff_candidates) if self.runoff_candidates is not None else None,
            "vote_rounds": self.vote_rounds if self.phase == "finished" else [],
            "result": public_result,
        }

    def current_turn_id(self):
        if self.phase != "playing" or not self.turn_order:
            return None
        return self.turn_order[self.turn_index % len(self.turn_order)]

    def get_player(self, player_id):
        return next((p for p in self.players if p["id"] == player_id), None)

    def load_random_word(self):
        with WORD_DB.open("r", encoding="utf-8") as file:
            words = json.load(file)
        if not words:
            raise ValueError("words.json ไม่มีคำศัพท์")
        valid = [w for w in words if w.get("word") and w.get("info")]
        if not valid:
            raise ValueError("ไม่พบคำศัพท์ที่มีคำอธิบายครบ")
        USAGE_DB.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(USAGE_DB, timeout=10) as db:
            db.execute("CREATE TABLE IF NOT EXISTS room_words (room_id TEXT NOT NULL, word_key TEXT NOT NULL, used_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(room_id, word_key))")
            used = {row[0] for row in db.execute("SELECT word_key FROM room_words WHERE room_id = ?", (self.room_id,))}
            available = [w for w in valid if _word_key(w) not in used]
            if not available:
                db.execute("DELETE FROM room_words WHERE room_id = ?", (self.room_id,))
                available = valid[:]
            least_used = min(self.difficulty_counts.get(w.get("difficulty", "medium"), 0) for w in available)
            balanced = [w for w in available if self.difficulty_counts.get(w.get("difficulty", "medium"), 0) == least_used]
            chosen = random.choice(balanced or available)
            db.execute("INSERT OR IGNORE INTO room_words(room_id, word_key) VALUES (?, ?)", (self.room_id, _word_key(chosen)))
        self.secret_data = chosen.copy()
        difficulty = self.secret_data.get("difficulty", "medium")
        self.difficulty_counts[difficulty] = self.difficulty_counts.get(difficulty, 0) + 1
        self.used_word_ids.add(_word_key(chosen))

    def assign_roles(self):
        if len(self.players) < 3 or self.is_started:
            return False
        shuffled = self.players.copy()
        random.shuffle(shuffled)
        self.gm, self.manipulator = shuffled[0], shuffled[1]
        self.turn_order = [p["id"] for p in shuffled[2:]] + [self.manipulator["id"]]
        random.shuffle(self.turn_order)
        for player in self.players:
            player["role"] = "GM" if player["id"] == self.gm["id"] else ("MANIPULATOR" if player["id"] == self.manipulator["id"] else "GUESSER")
            player["vote"] = None
        self.load_random_word()
        self.is_started, self.phase = True, "playing"
        self.turn_index, self.turn_number = 0, 1
        self.history, self.pending_guess, self.active_question = [], None, None
        self.votes, self.vote_rounds = {}, []
        self.voting_round, self.runoff_candidates = 0, None
        self.vote_deadline, self.result = None, None
        return True

    def reset_to_lobby(self):
        self.gm = self.manipulator = None
        self.secret_data = {}
        self.is_started, self.phase = False, "lobby"
        self.turn_order, self.turn_index, self.turn_number = [], 0, 1
        self.history, self.pending_guess, self.active_question = [], None, None
        self.votes, self.vote_rounds = {}, []
        self.voting_round, self.runoff_candidates = 0, None
        self.vote_deadline, self.result = None, None
        for player in self.players:
            player["role"], player["vote"] = None, None

    def advance_turn(self):
        if self.turn_order:
            self.turn_index = (self.turn_index + 1) % len(self.turn_order)
            self.turn_number += 1

    def add_history(self, entry):
        self.history.append(entry)
        self.history = self.history[-200:]
