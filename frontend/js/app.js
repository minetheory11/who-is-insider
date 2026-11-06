// 1. ดึง DiscordSDK จาก CDN script ที่โหลดมาใน index.html (ไม่ต้องใช้ import)
const { DiscordSDK } = window.DiscordSDK;

const CLIENT_ID = "1568214504951652372";
const discordSdk = new DiscordSDK(CLIENT_ID);

let socket = null;
let currentUser = null;
const roomId = "default_room";

// 2. ฟังก์ชันเริ่มต้นใช้งาน Discord SDK
async function setupDiscord() {
    try {
        await discordSdk.ready();

        // ขอสิทธิ์ OAuth2 เพื่อดึงข้อมูลโปรไฟล์
        const { code } = await discordSdk.commands.authorize({
            client_id: CLIENT_ID,
            response_type: "code",
            state: "",
            prompt: "none",
            scope: ["identify", "guilds"],
        });

        // ดึงข้อมูลผู้เล่น
        const auth = await discordSdk.commands.authenticate({ code });
        currentUser = auth.user;

        console.log(`เข้าร่วมเกมโดย: ${currentUser.username} (ID: ${currentUser.id})`);

        // เชื่อมต่อ WebSocket
        connectWebSocket(currentUser.id, currentUser.username);

    } catch (error) {
        console.error("ไม่สามารถเชื่อมต่อ Discord SDK ได้:", error);
        // Fallback สำหรับทดสอบบน Web Browser ทั่วไปนอก Discord
        const mockId = "user_" + Math.floor(Math.random() * 1000);
        connectWebSocket(mockId, "Guest_" + mockId);
    }
}

// 3. ฟังก์ชันเชื่อมต่อ WebSocket
function connectWebSocket(userId, username) {
    // ใช้ localhost:8000 สำหรับการทดสอบในเครื่อง
    const wsUrl = `ws://localhost:8000/ws/${roomId}/${userId}/${encodeURIComponent(username)}`;
    
    socket = new WebSocket(wsUrl);

    socket.onopen = () => { 
        console.log("เชื่อมต่อกับ Backend Server สำเร็จ!"); 
    };

    socket.onmessage = (event) => { 
        const data = JSON.parse(event.data); 
        handleServerMessage(data); 
    };

    socket.onclose = () => { 
        console.log("หลุดจากการเชื่อมต่อกับ Server"); 
    };
}

// 4. จัดการข้อความตอบกลับจาก Backend
function handleServerMessage(data) {
    switch (data.type) {
        case "game_started":
            alert(`เกมเริ่มแล้ว! บทบาทของคุณคือ: ${data.role}`);
            if (data.secret_word) {
                alert(`🎯 คำเฉลยของคุณคือ: ${data.secret_word}`);
            }
            break;
        case "turn_update":
            console.log(`ถึงตาของ: ${data.current_player}`);
            break;
    }
}

// เริ่มทำงานเมื่อโหลดหน้าเว็บเสร็จ
document.addEventListener("DOMContentLoaded", setupDiscord);