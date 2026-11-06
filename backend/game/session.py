import random
import asyncio
import json
import os
import urllib.request
import urllib.parse

class GameSession:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.players = []
        self.gm = None
        self.manipulator = None
        self.guessers = []
        self.secret_data = {}
        self.current_turn_index = 0
        self.is_started = False

    def fetch_word_from_api(self):
        """ดึงคำศัพท์สุ่มและคำใบ้บริบทจาก Wikipedia API ภาษาไทย"""
        try:
            # 1. สุ่มบทความจาก Wikipedia ภาษาไทย
            random_url = "https://th.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json"
            req = urllib.request.Request(random_url, headers={'User-Agent': 'TheManipulatorBot/1.0'})
            
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode())
                page_title = data['query']['random'][0]['title']

            # 2. ดึงข้อมูลคำใบ้บริบท (Summary Extract) ของบทความนั้น
            summary_url = f"https://th.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles={urllib.parse.quote(page_title)}&format=json"
            req_summary = urllib.request.Request(summary_url, headers={'User-Agent': 'TheManipulatorBot/1.0'})
            
            with urllib.request.urlopen(req_summary) as response:
                summary_data = json.loads(response.read().decode())
                pages = summary_data['query']['pages']
                page_id = list(pages.keys())[0]
                extract = pages[page_id].get('extract', '')

            # กรองและทำความสะอาดคำใบ้ (ตัดคำเฉลยออกจากคำใบ้เพื่อไม่ให้หลุดเฉลยง่ายเกินไป)
            clean_info = extract.replace(page_title, "___").strip()
            if len(clean_info) > 150:
                clean_info = clean_info[:150] + "..."

            if page_title and clean_info:
                self.secret_data = {
                    "word": page_title,
                    "info": clean_info if clean_info else "ไม่มีข้อมูลบริบทเพิ่มเติม",
                    "source": "Wikipedia API"
                }
                return True
        except Exception as e:
            print(f"API Error, switching to local words.json: {e}")
        
        return False

    def load_random_word(self):
        """ถ้าดึง API ไม่สำเร็จ ให้ใช้คำจาก words.json ในเครื่อง"""
        if not self.fetch_word_from_api():
            json_path = os.path.join(os.path.dirname(__file__), '../database/words.json')
            with open(json_path, 'r', encoding='utf-8') as f:
                words = json.load(f)
            self.secret_data = random.choice(words)

    def assign_roles(self):
        if len(self.players) < 3:
            return False

        shuffled = self.players.copy()
        random.shuffle(shuffled)

        self.gm = shuffled.pop(0)
        self.manipulator = shuffled.pop(0)
        self.guessers = shuffled
        
        self.load_random_word()
        self.is_started = True
        return True