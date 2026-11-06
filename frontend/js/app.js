// ==========================================
// 1. ตั้งค่า Discord SDK & ตัวแปรหลัก
// ==========================================
const CLIENT_ID = "1568214504951652372";
const WEBSOCKET_URL = "wss://who-is-insider.onrender.com"; // Backend URL บน Render

let discordSdk = null;
let socket = null;
let currentUser = {
  id: "guest_" + Math.floor(Math.random() * 1000),
  username: "Player"
};

// ==========================================
// 2. ฟังก์ชันเริ่มการทำงาน Discord SDK Handshake
// ==========================================
async function initDiscordSDK() {
  try {
    if (window.DiscordSDK) {
      const { DiscordSDK } = window.DiscordSDK;
      discordSdk = new DiscordSDK(CLIENT_ID);

      // ส่งสัญญาณ Handshake บอก Discord ให้ปลดล็อก UI iframe
      await discordSdk.ready();
      console.log("Discord SDK ready!");

      // ขอ Authentication สิทธิ์ยูสเซอร์จาก Discord
      const auth = await discordSdk.commands.authenticate();
      if (auth && auth.user) {
        currentUser.id = auth.user.id;
        currentUser.username = auth.user.username;
        console.log(`Logged in as: ${currentUser.username} (${currentUser.id})`);
      }
    } else {
      console.warn("Discord SDK ไม่ได้ถูกโหลด (อาจกำลังทดสอบนอก Discord)");
    }
  } catch (error) {
    console.error("Discord SDK Initialization Error:", error);
  }
}

// ==========================================
// 3. ฟังก์ชันเชื่อมต่อ WebSocket กับ Render Backend
// ==========================================
function connectwebsocket(userid, username) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    console.log("WebSocket connected already.");
    return;
  }

  console.log(`Connecting to WebSocket: ${WEBSOCKET_URL}...`);
  socket = new WebSocket(WEBSOCKET_URL);

  socket.onopen = () => {
    console.log("WebSocket Connection Established!");
    // ส่งข้อมูลลงทะเบียนผู้ใช้เข้า Server
    socket.send(JSON.stringify({
      type: "register",
      user_id: userid,
      username: username
    }));
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (err) {
      console.error("Error parsing WebSocket message:", err);
    }
  };

  socket.onerror = (error) => {
    console.error("WebSocket Error:", error);
  };

  socket.onclose = () => {
    console.log("WebSocket Disconnected. Reconnecting in 3 seconds...");
    setTimeout(() => connectwebsocket(userid, username), 3000);
  };
}

// ==========================================
// 4. จัดการข้อความตอบกลับจาก Backend
// ==========================================
function handleServerMessage(data) {
  console.log("Server Message Received:", data);

  switch (data.type) {
    case "game_started":
      if (typeof scrollToGameZone === "function") {
        scrollToGameZone();
      }
      alert(`เกมเริ่มแล้ว! บทบาทของคุณคือ: ${data.role}`);
      if (data.secret_word) {
        alert(`คำเฉลยของคุณคือ: ${data.secret_word}`);
      }
      break;

    case "turn_update":
      console.log(`ถึงตาของ: ${data.current_player}`);
      break;

    case "room_created":
      alert(`สร้างห้องสำเร็จ! รหัสห้อง: ${data.room_code}`);
      break;

    case "room_joined":
      alert(`เข้าร่วมห้อง ${data.room_code} สำเร็จ!`);
      break;

    case "error":
      alert(`เกิดข้อผิดพลาด: ${data.message}`);
      break;

    default:
      console.log("Unhandled message type:", data.type);
      break;
  }
}

// ==========================================
// 5. ผูกปุ่มกดเมื่อ DOM โหลดเสร็จสิ้น
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  // รัน Discord SDK ปลดล็อกหน้าจอ
  await initDiscordSDK();

  // ดึง Element ปุ่มกดบน UI
  const createRoomBtn = document.getElementById("createRoomBtn");
  const joinRoomBtn = document.getElementById("joinRoomBtn");
  const loginBtn = document.getElementById("loginBtn");

  if (createRoomBtn) {
    createRoomBtn.addEventListener("click", () => {
      connectwebsocket(currentUser.id, currentUser.username);
      // ส่งคำสั่งสร้างห้อง
      setTimeout(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: "create_room",
            user_id: currentUser.id
          }));
        }
      }, 500);
    });
  }

  if (joinRoomBtn) {
    joinRoomBtn.addEventListener("click", () => {
      const roomCode = prompt("กรุณากรอกรหัสห้อง (Room Code):");
      if (roomCode) {
        connectwebsocket(currentUser.id, currentUser.username);
        setTimeout(() => {
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              type: "join_room",
              room_code: roomCode,
              user_id: currentUser.id
            }));
          }
        }, 500);
      }
    });
  }

  if (loginBtn) {
    loginBtn.addEventListener("click", () => {
      alert(`ล็อกอินในชื่อ: ${currentUser.username} (${currentUser.id})`);
    });
  }
});