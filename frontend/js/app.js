// 1. นำเข้า Discord Embedded App SDK (ต้องใส่แท็ก script ใน index.html ไว้ด้วย)
import { DiscordSDK } from "@discord/embedded-app-sdk";

// แทนที่ด้วย CLIENT_ID ที่ได้จาก Discord Developer Portal
const CLIENT_ID = "1568214504951652372";
const discordSdk = new DiscordSDK(CLIENT_ID);

let socket = null;
let currentUser = null;
const roomId = "default_room"; // สามารถปรับระบบสร้างห้องแยกตาม Voice Channel ID ได้

// 2. ฟังก์ชันเริ่มต้นใช้งาน Discord SDK
async function setupDiscord() {
    try {
        await discordSdk.ready();

        // ร้องขอสิทธิ์ authorize เพื่อเอา Code ไปดึงโปรไฟล์ผู้เล่น
        const { code } = await discordSdk.commands.authorize({
            client_id: CLIENT_ID,
            response_type: "code",
            state: "",
            prompt: "none",
            scope: ["identify", "guilds"],
        });

        // ดึงข้อมูลผู้ใช้งานที่เปิด App อยู่
        const auth = await discordSdk.commands.authenticate({ code });
        currentUser = auth.user;

        console.log(`เข้าร่วมเกมโดย: ${currentUser.username} (ID:${currentUser.id})`);

        // เมื่อยืนยันตัวตนผ่าน ให้ทำการเปิด WebSocket เชื่อมต่อไปยัง Python Backend
        connectWebSocket(currentUser.id, currentUser.username);

    } catch (error) {
        console.error("ไม่สามารถเชื่อมต่อ Discord SDK ได้ (ลองเปิดนอก Discord หรือยังไม่ตั้งค่า Client ID):", error);
    }
}

// 3. ฟังก์ชันเชื่อมต่อ Real-time WebSocket กับ Python Backend
function connectWebSocket(userId, username) {
    const wsUrl = `ws://localhost:8000/ws/${roomId}/${userId}/${encodeURIComponent(username)}`; socket = new WebSocket(wsUrl);  socket.onopen = () => { console.log("เชื่อมต่อกับ Backend Server สำเร็จ!"); };  socket.onmessage = (event) => { const data = JSON.parse(event.data); handleServerMessage(data); };  socket.onclose = () => { console.log("หลุดจากการเชื่อมต่อกับ Server"); }; }  // 4. จัดการข้อความที่ตอบกลับมาจาก Python Backend function handleServerMessage(data) { switch (data.type) { case "game_started": alert(`เกมเริ่มแล้ว! บทบาทของคุณคือ: ${data.role}`);
            if (data.secret_word) {
                alert(`🎯 คำเฉลยของคุณคือ: ${data.secret_word}`); } break;  case "turn_update": console.log(`ถึงตาของ: ${data.current_player_