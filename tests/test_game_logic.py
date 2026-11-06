import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.game import session as session_module
from backend.game.session import GameSession
import backend.main as main


class GameLogicTests(unittest.TestCase):
    def test_duplicate_names_are_disambiguated_without_changing_ids(self):
        game = GameSession("ABC123", "p1", "Player")
        game.players.extend([
            {"id": "p2", "name": "Player"},
            {"id": "p3", "name": "Player"},
        ])
        self.assertEqual(game.display_names(), {"p1": "Player", "p2": "Player (2)", "p3": "Player (3)"})

    def test_word_history_persists_per_room(self):
        with tempfile.TemporaryDirectory() as tmp:
            original = session_module.USAGE_DB
            session_module.USAGE_DB = Path(tmp) / "history.sqlite3"
            try:
                base_players = [
                    {"id": pid, "name": pid, "ws": None, "role": None, "connected": True, "vote": None}
                    for pid in ("host", "p2", "p3")
                ]
                first = GameSession("ROOM01", "host", "host")
                first.players = [dict(p) for p in base_players]
                self.assertTrue(first.assign_roles())
                first_word = first.secret_data["word"]
                second = GameSession("ROOM01", "host", "host")
                second.players = [dict(p) for p in base_players]
                self.assertTrue(second.assign_roles())
                self.assertNotEqual(first_word, second.secret_data["word"])
            finally:
                session_module.USAGE_DB = original

    def test_public_state_does_not_contain_secret_during_game(self):
        game = GameSession("ABC123", "p1", "Player")
        game.phase = "playing"
        game.secret_data = {"word": "SECRETWORD", "info": "SECRETINFO"}
        self.assertNotIn("SECRETWORD", repr(game.public_state()))
        self.assertNotIn("SECRETINFO", repr(game.public_state()))
        game.phase = "finished"
        game.result = {"winner": "GUESSERS", "manipulator_name": "Player"}
        self.assertNotIn("SECRETWORD", repr(game.public_state()))

    def test_private_secret_payload_is_sent_to_gm_and_manipulator_only(self):
        class Socket:
            payload = None
        async def run():
            original = main.send
            async def capture(ws, payload):
                ws.payload = payload
            main.send = capture
            try:
                game = GameSession("ABC123", "gm", "GM")
                game.secret_data = {"word": "SECRETWORD", "info": "SECRETINFO"}
                gm = {"id": "gm", "role": "GM", "ws": Socket()}
                manipulator = {"id": "m", "role": "MANIPULATOR", "ws": Socket()}
                await main.send_private_state(game, gm)
                await main.send_private_state(game, manipulator)
                self.assertEqual(gm["ws"].payload["secret_word"], "SECRETWORD")
                self.assertEqual(manipulator["ws"].payload["secret_word"], "SECRETWORD")
                self.assertEqual(manipulator["ws"].payload["secret_info"], "SECRETINFO")
                self.assertEqual(manipulator["ws"].payload["category"], "ความรู้ทั่วไป")
                guesser = {"id": "p2", "role": "GUESSER", "ws": Socket()}
                await main.send_private_state(game, guesser)
                self.assertNotIn("secret_word", guesser["ws"].payload)
                self.assertNotIn("secret_info", guesser["ws"].payload)
            finally:
                main.send = original
        asyncio.run(run())

    def test_tie_enters_runoff_and_keeps_round_scores_separate(self):
        async def run():
            game = GameSession("RUN001", "g", "GM")
            game.players = [
                {"id": pid, "name": pid, "ws": None, "role": role, "connected": True}
                for pid, role in (("g", "GM"), ("a", "MANIPULATOR"), ("b", "GUESSER"), ("c", "GUESSER"), ("d", "GUESSER"))
            ]
            game.gm, game.manipulator = game.players[0], game.players[1]
            game.secret_data = {"word": "ANSWER"}
            game.phase, game.voting_round = "voting", 1
            game.votes = {"a": "b", "b": "a", "c": "a", "d": "b"}
            main.rooms[game.room_id] = game
            async def noop(*args, **kwargs):
                return None
            try:
                with patch.object(main, "broadcast", noop), patch.object(main, "broadcast_state", noop), patch.object(main, "start_vote_timer", lambda _s: None):
                    await main.finish_voting(game)
                    self.assertEqual(game.phase, "voting")
                    self.assertEqual(game.voting_round, 2)
                    self.assertEqual(set(game.runoff_candidates), {"a", "b"})
                    game.votes = {"a": "b", "b": "a", "c": "a", "d": "a"}
                    await main.finish_voting(game)
                    self.assertEqual(game.phase, "finished")
                    self.assertTrue(game.result["caught"])
                    self.assertEqual(len(game.result["vote_rounds"]), 2)
            finally:
                main.rooms.pop(game.room_id, None)
        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
