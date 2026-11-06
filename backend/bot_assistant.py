import os
import discord
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()

intents = discord.Intents.default()
bot = commands.Bot(command_prefix="!", intents=intents)

async def send_hint_to_gm(gm_discord_id: int, secret_word: str, hint_info: str):
    """ส่งข้อมูลคำใบ้ให้ Game Master ช่วยในการตอบคำถาม"""
    try:
        # แปลง ID เป็น integer เพื่อป้องกันกรณีส่ง string เข้ามา
        user_id = int(gm_discord_id)
        gm_user = await bot.fetch_user(user_id)
        
        if gm_user:
            embed = discord.Embed(
                title="👑 ข้อมูลสำหรับผู้ดำเนินเกม (Game Master)",
                description=f"🎯 **คำเฉลย:** {secret_word}",
                color=0xC5A45B
            )
            embed.add_field(
                name="💡 ข้อมูลบริบทสำหรับช่วยตอบผู้เล่น", 
                value=hint_info if hint_info else "ไม่มีข้อมูลบริบทเพิ่มเติม", 
                inline=False
            )
            embed.set_footer(text="ใช้ข้อมูลนี้ประกอบการตอบผู้เล่น: ใช่ / ไม่ใช่ / อาจจะ")
            
            # ส่งเป็น Embed ข้อความส่วนตัว (DM)
            await gm_user.send(embed=embed)
            print(f"✅ ส่งคำใบ้ให้ GM ({gm_user.name}) เรียบร้อยแล้ว")
    except discord.Forbidden:
        print(f"❌ ไม่สามารถส่ง DM หา GM (ID: {gm_discord_id}) ได้ เนื่องจากผู้ใช้ปิดรับ DM จากคนแปลกหน้า")
    except Exception as e:
        print(f"❌ เกิดข้อผิดพลาดในการส่ง DM หา GM: {e}")

@bot.event
async def on_ready():
    print(f"🤖 Bot Assistant Online as {bot.user}")