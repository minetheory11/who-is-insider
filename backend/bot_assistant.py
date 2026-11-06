from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

try:
    import discord
    from discord.ext import commands
    intents = discord.Intents.default()
    bot = commands.Bot(command_prefix="!", intents=intents)
    bot.available = True
except ImportError:
    discord = None

    class _UnavailableBot:
        loop = None
        available = False

        def run(self, token):
            raise RuntimeError("discord.py is not installed")

    bot = _UnavailableBot()


async def send_hint_to_gm(gm_discord_id: int, secret_word: str, hint_info: str):
    """Send the private answer and context to the Game Master via Discord DM."""
    if discord is None:
        print("discord.py is not installed; skipped GM DM.")
        return
    try:
        gm_user = await bot.fetch_user(int(gm_discord_id))
        embed = discord.Embed(
            title="ข้อมูลลับสำหรับ Game Master",
            description=f"คำเฉลย: **{secret_word}**",
            color=0xC5A45B,
        )
        embed.add_field(
            name="ข้อมูลบริบท",
            value=(hint_info or "ไม่มีข้อมูลบริบทเพิ่มเติม")[:1024],
            inline=False,
        )
        embed.set_footer(text="ใช้ข้อมูลนี้ประกอบการตอบ: ใช่ / ไม่ใช่ / อาจจะ")
        await gm_user.send(embed=embed)
        print(f"Sent private game hint to GM {gm_user.id}")
    except discord.Forbidden:
        print(f"Cannot DM GM {gm_discord_id}; the user may have DMs disabled.")
    except Exception as exc:
        print(f"Failed to send GM hint: {exc}")


if discord is not None:
    @bot.event
    async def on_ready():
        print(f"Discord Bot Assistant online as {bot.user}")
