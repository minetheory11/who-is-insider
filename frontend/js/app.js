// ดึง DiscordSDK จาก CDN script ที่โหลดใน index.html
const { DiscordSDK } = window.DiscordSDK || {};

const CLIENT_ID = "1568214504951652372";
let discordSdk = null;
if (DiscordSDK) {
    discordSdk = new DiscordSDK(CLIENT_ID);
}

let socket = null;
let currentUser = { id: "guest_" + Math.floor(Math.random() * 1000), username: "Guest" };
const roomId = "default_room";

// 1. เริ่มต้นระบบเมื่อโหลด DOM เสร็จ
document.addEventListener("DOMContentLoaded", async () => {
    // ผูก Event ให้ปุ่มบนหน้าเว็บ HTML
    bindUIEvents();

    // ลองเชื่อมต่อ Discord SDK
    await setupDiscord();
});

// 2. ฟังก์ชันช่วยเลื่อนหน้าจออัตโนมัติ (Auto-Scroll)
function scrollToGameZone() {
    const mainContent = document.querySelector(".hero-content") || document.querySelector("main");
    if (mainContent) {
        mainContent.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

// 3. ฟังก์ชันผูกปุ่มกดบนหน้าเว็บ
function bindUIEvents() {
    const createBtn = document.getElementById("createRoomBtn");
    const joinBtn = document.getElementById("joinRoomBtn");

    if (createBtn) {
        createBtn.addEventListener("click", () => {
            scrollToGameZone();
            alert(`สร้างห้องสำเร็จ! รหัสห้อง: ${roomId}`);
            connectWebSocket(currentUser.id, currentUser.username);
        });
    }

    if (joinBtn) {
        joinBtn.addEventListener("click", () => {
            scrollToGameZone();
            alert(`เข้าร่วมห้อง ${roomId}`);
            connectWebSocket(currentUser.id, currentUser.username);
        });
    }
}

// 4. ฟังก์ชันเริ่มต้นใช้งาน Discord SDK
async function setupDiscord() {
    if (!discordSdk) {
        console.warn("ไม่ได้เปิดใน Discord หรือโหลด SDK ไม่สำเร็จ (รันโหมด Web Fallback)");
        return;
    }

    try {
        await discordSdk.ready();

        const { code } = await discordSdk.commands.authorize({
            client_id: CLIENT_ID,
            response_type: "code",
            state: "",
            prompt: "none",
            scope: ["identify", "guilds"],
        });

        const auth = await discordSdk.commands.authenticate({ code });
        currentUser = auth.user;

        console.log(`เข้าร่วมเกมโดย: ${currentUser.username} (ID: ${currentUser.id})`);
        
        // เมื่อยืนยันตัวตนใน Discord ผ่าน ให้เลื่อนหน้าจอลงมาที่เกมอัตโนมัติ
        scrollToGameZone();

        // เชื่อมต่อ Backend ทันทีเมื่อยืนยันตัวตนสำเร็จ
        connectWebSocket(currentUser.id, currentUser.username);

    } catch (error) {
        console.error("การเชื่อมต่อ Discord SDK ขัดข้อง (จะใช้โหมด Guest แทน):", error);
    }
}

// 5. ฟังก์ชันเชื่อมต่อ WebSocket กับ Python Backend (อัปเดตเป็น Render SSL WSS)
function connectWebSocket(userId, username) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.log("เชื่อมต่ออยู่แล้ว");
        return;
    }

    // ชี้ URL ไปยัง Render Server ที่ปรับใช้ผ่านแล้ว
    const wsUrl = `wss://who-is-insider.onrender.com/ws/${roomId}/${userId}/${encodeURIComponent(username)}`;
    socket = new WebSocket(wsUrl);

    socket.onopen = () => { 
        console.log("🟢 เชื่อมต่อกับ Backend Server บน Render สำเร็จ!"); 
    };

    socket.onmessage = (event) => { 
        const data = JSON.parse(event.data); 
        handleServerMessage(data); 
    };

    socket.onerror = (error) => {
        console.error("🔴 WebSocket Error:", error);
        alert("ไม่สามารถเชื่อมต่อ Render Backend Server ได้ กรุณาตรวจสอบสถานะการทำงานบน Render");
    };

    socket.onclose = () => { 
        console.log("⚪ หลุดจากการเชื่อมต่อกับ Server"); 
    };
}

// 6. จัดการข้อความที่ตอบกลับมาจาก Python Backend
function handleServerMessage(data) {
    switch (data.type) {
        case "game_started":
            scrollToGameZone();
            alert(`🎮 เกมเริ่มแล้ว! บทบาทของคุณคือ: ${data.role}`);
            if (data.secret_word) {
                alert(`🎯 คำเฉลยของคุณคือ: ${data.secret_word}`);
            }
            break;
        case "turn_update":
            console.log(`ถึงตาของ: ${data.current_player}`);
            break;
    }
}