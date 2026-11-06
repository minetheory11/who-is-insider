const CLIENT_ID = "1568214504951652372";
const WS_URL = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;

let discordSdk = null;
let socket = null;
let currentRoomCode = null;
let currentState = null;
let myRole = null;
let activeQuestion = null;
let pendingGuess = null;
let hasVoted = false;
let timerDeadline = null;
let voteDeadline = null;
let timerTurnKey = "";
let toastTimer = null;
const gmImageCache = new Map();

const currentUser = {
  id: null,
  username: "ผู้เล่น",
  discordAccessToken: null
};

const $ = (id) => document.getElementById(id);

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function setConnection(connected, label) {
  const el = document.querySelector(".connection");
  el.classList.toggle("connected", connected);
  el.classList.toggle("disconnected", !connected);
  $("connectionText").textContent = label;
}

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
  const screen = $(`${name}Screen`);
  if (screen) screen.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getPlayerName() {
  const name = $("playerNameInput")?.value.trim().slice(0, 24);
  if (!name) { toast("กรุณากรอกชื่อที่ใช้ในการเล่นก่อน"); $("playerNameInput")?.focus(); return null; }
  currentUser.username = name;
  return name;
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    toast("ยังไม่ได้เชื่อมต่อเซิร์ฟเวอร์ กรุณาลองใหม่");
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function connectWebSocket() {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve();
  if (socket?.readyState === WebSocket.CONNECTING) {
    return new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
  }

  socket = new WebSocket(WS_URL);
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => {
      setConnection(true, "เชื่อมต่อแล้ว");
      socket.send(JSON.stringify({
        type: "register",
        username: currentUser.username,
        discord_access_token: currentUser.discordAccessToken || ""
      }));
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      setConnection(false, "เชื่อมต่อไม่ได้");
      reject(new Error("WebSocket connection failed"));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      try {
        handleServerMessage(JSON.parse(event.data));
      } catch (error) {
        console.error("Invalid server message", error);
      }
    });
    socket.addEventListener("close", () => {
      setConnection(false, "ขาดการเชื่อมต่อ");
      socket = null;
    });
  });
}

async function initDiscordSDK() {
  const SDK = window.DiscordSDK;
  if (!SDK?.DiscordSDK) {
    setConnection(false, "โหมดเว็บทดลอง");
    return;
  }
  try {
    discordSdk = new SDK.DiscordSDK(CLIENT_ID);
    await discordSdk.ready();
    const auth = await discordSdk.commands.authenticate();
    if (auth?.user) {
      currentUser.username = auth.user.global_name || auth.user.username;
      currentUser.discordAccessToken = auth.access_token || null;
    }
    setConnection(true, `เชื่อมต่อในชื่อ ${currentUser.username}`);
  } catch (error) {
    console.warn("Discord SDK authentication unavailable; using browser guest mode.", error);
    setConnection(false, "โหมดผู้เยี่ยมชม");
  }
}

function handleServerMessage(data) {
  switch (data.type) {
    case "registered":
      currentUser.id = data.user_id;
      if (data.username && currentUser.username === "ผู้เล่น") currentUser.username = data.username;
      break;
    case "room_created":
    case "room_joined":
      currentRoomCode = data.room_code;
      $("lobbyRoomCode").textContent = currentRoomCode;
      $("joinGate").classList.add("hidden");
      $("lobbyContent").classList.remove("hidden");
      showScreen("lobby");
      toast(data.type === "room_created" ? "สร้างห้องสำเร็จ" : "เข้าร่วมห้องสำเร็จ");
      break;
    case "room_state":
      currentState = data.state;
      currentRoomCode = data.state.room_code;
      renderRoomState(data.state);
      break;
    case "private_role":
      myRole = data.role;
      renderRole(data);
      break;
    case "gm_question":
      activeQuestion = data;
      $("incomingQuestion").textContent = `${data.player_name}: ${data.question}`;
      updateGameControls();
      break;
    case "gm_answered":
      activeQuestion = null;
      $("incomingQuestion").textContent = "ยังไม่มีคำถาม";
      updateGameControls();
      break;
    case "guess_submitted":
      pendingGuess = data.guess;
      $("incomingGuess").textContent = `${data.guess.player_name}: ${data.guess.guess}`;
      $("guessReview").classList.remove("hidden");
      break;
    case "guess_judged":
      pendingGuess = null;
      $("guessReview").classList.add("hidden");
      if (!data.correct) toast("GM ตรวจแล้ว: คำเดายังไม่ถูก เทิร์นถัดไปเริ่มแล้ว");
      break;
    case "voting_started":
      pendingGuess = null;
      hasVoted = false;
      $("guessReview").classList.add("hidden");
      voteDeadline = Date.now() + 60000;
      toast(`${data.guesser} เดาคำเฉลยถูกต้อง! เริ่มโหวต 60 วินาที`);
      break;
    case "runoff_started":
      hasVoted = false;
      voteDeadline = Date.now() + (data.seconds || 60) * 1000;
      toast(`คะแนนเสมอ! เริ่ม Runoff รอบที่ ${data.round} — โหวตเฉพาะผู้ที่คะแนนเสมอกัน`);
      if (currentState) renderRoomState(currentState);
      break;
    case "vote_update":
      $("voteStatus").textContent = `ลงคะแนนแล้ว ${data.count} คน`;
      break;
    case "game_finished":
      voteDeadline = null;
      renderResult(data.result);
      break;
    case "left_room":
      currentRoomCode = null;
      currentState = null;
      myRole = null;
      showScreen("home");
      toast("ออกจากห้องแล้ว");
      break;
    case "error":
      toast(data.message || "เกิดข้อผิดพลาด");
      break;
    default:
      console.debug("Server message:", data);
  }
}

function renderRoomState(state) {
  if (state.phase === "lobby") {
    myRole = null; activeQuestion = null; pendingGuess = null; hasVoted = false; voteDeadline = null;
    // The result overlay uses a fixed full-screen ::before backdrop; always dismiss it when returning to Lobby.
    $("resultPanel").classList.add("hidden");
    $("votingPanel").classList.add("hidden");
    $("secretBox").classList.add("hidden");
    $("joinGate").classList.add("hidden");
    $("lobbyContent").classList.remove("hidden");
    showScreen("lobby");
    $("lobbyRoomCode").textContent = state.room_code;
    $("playerCount").textContent = `${state.players.length} / 12`;
    $("lobbyPlayers").innerHTML = state.players.map((p) => `
      <div class="player-row">
        <div class="player-avatar">${escapeHtml(p.name.slice(0, 1).toUpperCase())}</div>
        <span class="player-name">${escapeHtml(p.display_name || p.name)}</span>
        ${p.id === currentUser.id ? '<span class="you-tag">YOU</span>' : ""}
        ${p.id === state.host_id ? '<span class="host-tag">HOST</span>' : ""}
        <i class="online-dot" title="${p.connected ? "ออนไลน์" : "ออฟไลน์"}"></i>
      </div>`).join("");
    const isHost = state.host_id === currentUser.id;
    $("startGameBtn").disabled = !isHost || state.players.length < 3;
    $("startHint").textContent = !isHost
      ? "รอเจ้าของห้องเริ่มเกม"
      : state.players.length < 3
        ? `ต้องมีผู้เล่นอีก ${3 - state.players.length} คนจึงเริ่มได้`
        : "ผู้เล่นครบแล้ว พร้อมเริ่มเกม";
    return;
  }

  if (state.phase === "playing" || state.phase === "voting" || state.phase === "finished") {
    showScreen("game");
    $("gameRoomCode").textContent = state.room_code;
    $("gamePlayers").innerHTML = state.players.map((p) => `
      <div class="player-row ${p.id === state.current_turn_id && state.phase === "playing" ? "current-turn" : ""}">
        <div class="player-avatar">${escapeHtml((p.display_name || p.name).slice(0, 1).toUpperCase())}</div>
        <span class="player-name">${escapeHtml(p.display_name || p.name)}</span>
        ${p.id === currentUser.id ? '<span class="you-tag">YOU</span>' : ""}
        ${p.id === state.current_turn_id && state.phase === "playing" ? '<span class="turn-tag">YOUR TURN</span>' : ""}
        ${p.role === "GM" ? '<span class="host-tag">GM</span>' : ""}
        ${p.id === state.host_id ? '<span class="host-tag">HOST</span>' : ""}
      </div>`).join("");
    const isMyTurnNow = state.current_turn_id === currentUser.id && state.phase === "playing";
    $("currentTurnName").textContent = `${state.current_turn_name || "—"}${isMyTurnNow ? " · YOUR TURN" : ""}`;
    $("gamePhaseTitle").textContent = state.phase === "voting" ? "ลงคะแนนหาผู้บงการ" : state.phase === "finished" ? "ปิดคดีแล้ว" : "กำลังสืบสวน";
    $("gamePhaseSubtitle").textContent = state.phase === "voting"
      ? "พิจารณาหลักฐานและเลือกผู้ที่คุณสงสัย"
      : "รวบรวมข้อมูลและจับพิรุธจากคำตอบ";
    $("votingPanel").classList.toggle("hidden", state.phase !== "voting");
    $("resultPanel").classList.toggle("hidden", state.phase !== "finished");
    if (state.phase === "voting") {
      if (state.vote_deadline) voteDeadline = state.vote_deadline * 1000;
      renderVoteOptions(state);
      renderVoteBars(state.vote_counts || {}, state.players);
    }
    if (state.phase === "finished" && state.result) renderResult(state.result);
    renderHistory(state.history || []);

    const turnKey = `${state.turn_number}:${state.current_turn_id}`;
    if (turnKey !== timerTurnKey) {
      timerTurnKey = turnKey;
      timerDeadline = state.phase === "playing" ? Date.now() + state.turn_seconds * 1000 : null;
    }
    updateGameControls();
  }
}

function renderRole(data) {
  const roles = {
    GM: ["ผู้ดำเนินเกม (GM)", "คุณเป็นผู้ถือคำเฉลย ตอบคำถามด้วย ใช่ / ไม่ใช่ / อาจจะ และเป็นผู้ตัดสินคำเดา"],
    MANIPULATOR: ["ผู้บงการ", "คุณรู้คำเฉลยตั้งแต่เริ่มเกม แต่ต้องแสร้งทำเป็นไม่รู้ กลมกลืนกับกลุ่ม และหลีกเลี่ยงการถูกจับได้"],
    GUESSER: ["ผู้เล่นทั่วไป", "ร่วมกันถามคำถาม GM วิเคราะห์คำตอบ และค้นหาผู้บงการ"]
  };
  const role = roles[data.role] || ["ไม่ทราบบทบาท", ""];
  $("myRoleTitle").textContent = role[0];
  $("myRoleDescription").textContent = role[1];
  const secretVisible = data.role === "GM" || data.role === "MANIPULATOR";
  $("secretBox").classList.toggle("hidden", !secretVisible);
  if (secretVisible) {
    $("secretBox").querySelector("span").textContent =
      data.role === "GM" ? "ข้อมูลลับสำหรับ GM" : "ข้อมูลลับสำหรับผู้บงการ";
    $("secretWord").textContent = data.secret_word || "—";
    $("secretInfo").textContent = data.secret_info || "ไม่มีข้อมูลประกอบ";
    $("secretMeta").textContent = `${data.category || "ความรู้ทั่วไป"} · ระดับ ${({easy:"ง่าย",medium:"ปานกลาง",hard:"ยาก"})[data.difficulty] || "ปานกลาง"}`;
    loadGmImage(data.secret_word, data.image_url, data.image_credit, data.image_license, data.image_source_url);
  } else {
    $("secretWord").textContent = "—";
    $("secretInfo").textContent = "";
    $("secretMeta").textContent = "";
    $("secretImageLink").classList.add("hidden");
    $("secretImageCredit").textContent = "";
  }
  updateGameControls();
}

async function loadGmImage(word, suppliedUrl = "", credit = "", license = "", sourceUrl = "") {
  const link = $("secretImageLink");
  const image = $("secretImage");
  link.classList.add("hidden");
  $("secretImageCredit").textContent = "กำลังค้นหารูปภาพประกอบจาก Wikimedia Commons…";
  if (suppliedUrl) {
    image.src = suppliedUrl; link.href = sourceUrl || suppliedUrl; link.classList.remove("hidden");
    $("secretImageCredit").textContent = credit ? `ภาพ: ${credit}${license ? ` · ${license}` : ""}` : "ภาพประกอบ";
    return;
  }
  if (!word) { $("secretImageCredit").textContent = "ไม่มีภาพประกอบ"; return; }
  try {
    let item = gmImageCache.get(word);
    if (!item) {
      const query = new URLSearchParams({
        action: "query", generator: "search", gsrsearch: word, gsrnamespace: "6",
        gsrlimit: "1", prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "720",
        format: "json", origin: "*"
      });
      const response = await fetch(`https://commons.wikimedia.org/w/api.php?${query.toString()}`);
      if (!response.ok) throw new Error("Wikimedia request failed");
      const payload = await response.json();
      const page = Object.values(payload.query?.pages || {})[0];
      const info = page?.imageinfo?.[0];
      if (!info?.thumburl && !info?.url) throw new Error("No image found");
      const meta = info.extmetadata || {};
      const strip = (value) => String(value || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").trim();
      item = {
        url: info.thumburl || info.url,
        page: info.descriptionurl || info.url,
        artist: strip(meta.Artist?.value) || "ไม่ระบุผู้สร้าง",
        license: strip(meta.LicenseShortName?.value) || "โปรดตรวจสอบสัญญาอนุญาต",
        title: page.title || word
      };
      gmImageCache.set(word, item);
    }
    if (myRole !== "GM" || $("secretWord").textContent !== word) return;
    image.src = item.url; image.alt = `ภาพประกอบ ${word}`; link.href = item.page;
    link.classList.remove("hidden");
    $("secretImageCredit").textContent = `ภาพ: ${item.title} · ${item.artist} · ${item.license}`;
  } catch (error) {
    console.warn("Could not load GM reference image:", error);
    $("secretImageCredit").textContent = "ไม่พบภาพประกอบในขณะนี้ (GM ยังใช้คำอธิบายได้ตามปกติ)";
  }
}

function updateGameControls() {
  if (!currentState || currentState.phase !== "playing") {
    $("questionControls").classList.add("hidden");
    $("gmControls").classList.add("hidden");
    return;
  }
  const isMyTurn = currentState.current_turn_id === currentUser.id;
  const isGM = myRole === "GM";
  $("questionControls").classList.toggle("hidden", !isMyTurn || isGM || Boolean(pendingGuess));
  $("gmControls").classList.toggle("hidden", !isGM);
  if (isGM) {
    $("guessReview").classList.toggle("hidden", !pendingGuess);
  }
  $("turnNotice").textContent = isGM
    ? (activeQuestion ? "มีคำถามใหม่รอคำตอบจากคุณ" : "คุณคือ GM รอรับคำถามจากผู้เล่นและตอบตามข้อมูลที่ทราบ")
    : isMyTurn ? "YOUR TURN — ถึงเทิร์นของคุณแล้ว ถาม GM หรือส่งคำเดาได้" : `รอเทิร์นของ ${currentState.current_turn_name || "ผู้เล่น"} อยู่`;
}

function renderHistory(history) {
  if (!history.length) {
    $("gameHistory").innerHTML = '<p class="empty-state">ยังไม่มีประวัติการถามตอบ</p>';
    return;
  }
  const answerBadge = (answer) => {
    if (answer === "ใช่") return '<span class="answer-mark answer-yes" title="ใช่">✓</span>';
    if (answer === "ไม่ใช่") return '<span class="answer-mark answer-no" title="ไม่ใช่">✕</span>';
    if (answer === "อาจจะ") return '<span class="answer-mark answer-maybe" title="อาจจะ">?</span>';
    return '<span class="answer-mark answer-pending" title="รอคำตอบ">…</span>';
  };
  $("gameHistory").innerHTML = history.map((entry) => {
    if (entry.kind === "question") return `
      <div class="history-entry question-entry">
        <span class="history-kind">Q${entry.turn || ""}</span>
        <span class="history-text"><b>${escapeHtml(entry.player_name || "ผู้เล่น")}:</b> ${escapeHtml(entry.text || "")}</span>
        ${answerBadge(entry.answer)}
      </div>`;
    if (entry.kind === "guess") return `<div class="history-entry"><span class="history-kind">เดาคำ</span><span class="history-text"><b>${escapeHtml(entry.player_name || "ผู้เล่น")}:</b> ${escapeHtml(entry.text || "")}</span></div>`;
    if (entry.kind === "guess_result") return `<div class="history-entry"><span class="history-kind">ผลคำเดา</span><span class="history-text">${entry.text === "เดาถูก" ? "✓ เดาคำเฉลยถูกต้อง" : "✕ คำเดายังไม่ถูก"}</span></div>`;
    return `<div class="history-entry"><span class="history-kind">SYSTEM</span><span class="history-text">${escapeHtml(entry.text || "")}</span></div>`;
  }).join("");
}

function renderVoteOptions(state) {
  const canVote = myRole !== "GM" && !hasVoted;
  const allowed = Array.isArray(state.runoff_candidates) ? new Set(state.runoff_candidates) : null;
  const candidates = state.players.filter((p) => p.role !== "GM" && (!allowed || allowed.has(p.id)));
  $("voteOptions").innerHTML = myRole === "GM"
    ? '<p class="muted">GM ไม่มีสิทธิ์ลงคะแนน</p>'
    : candidates.map((p) => `
      <button class="vote-option" data-vote="${escapeHtml(p.id)}" ${!canVote || p.id === currentUser.id ? "disabled" : ""}>
        ◉ &nbsp; ${escapeHtml(p.display_name || p.name)} ${p.id === currentUser.id ? '<span class="you-tag">YOU · โหวตตัวเองไม่ได้</span>' : ""}
      </button>`).join("");
  $("voteOptions").querySelectorAll("[data-vote]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled || button.dataset.vote === currentUser.id) return;
      if (send({ type: "cast_vote", room_code: currentRoomCode, candidate_id: button.dataset.vote })) {
        hasVoted = true;
        $("voteOptions").querySelectorAll("button").forEach((b) => b.disabled = true);
        $("voteStatus").textContent = "ส่งคะแนนแล้ว — คะแนนรวมจะแสดงระหว่างรอ";
      }
    });
  });
  const roundLabel = state.voting_round > 1 ? ` · RUNOFF รอบ ${state.voting_round}` : "";
  $("voteStatus").textContent = myRole === "GM" ? "คุณเป็น GM จึงไม่มีสิทธิ์ลงคะแนน" : `ลงคะแนนแล้ว ${state.vote_count} / ${state.voter_count} คน${roundLabel}`;
  $("voteProgress").textContent = `${state.vote_count} / ${state.voter_count} คน${roundLabel}`;
}

function renderVoteBars(counts, players) {
  const allowed = Array.isArray(currentState?.runoff_candidates) ? new Set(currentState.runoff_candidates) : null;
  const candidates = players.filter((p) => p.role !== "GM" && (!allowed || allowed.has(p.id)));
  const max = Math.max(1, ...candidates.map((p) => counts[p.id] || 0));
  $("voteBars").innerHTML = candidates.map((p) => {
    const count = counts[p.id] || 0;
    return `<div class="vote-bar-row"><div class="vote-bar-label"><span>${escapeHtml(p.display_name || p.name)}</span><b>${count} คะแนน</b></div><div class="vote-bar-track"><i style="width:${count / max * 100}%"></i></div></div>`;
  }).join("");
}

function renderResult(result) {
  $("resultPanel").classList.remove("hidden");
  $("resultTitle").textContent = result.winner === "GUESSERS" ? "ฝ่ายผู้เล่นจับผู้บงการได้!" : "ผู้บงการชนะคดีนี้";
  let outcome = result.suspect_name
    ? `คะแนนสูงสุด: ${result.suspect_name}. `
    : "ไม่มีผู้เล่นคนใดได้คะแนนสูงสุดอย่างชัดเจน (คะแนนเสมอหรือไม่มีผู้ลงคะแนน). ";
  $("resultDescription").textContent = `${outcome}ผู้บงการตัวจริงคือ ${result.manipulator_name || "ไม่ทราบชื่อ"}${result.timed_out ? ` · หมดเวลาโหวต (${result.submitted_votes}/${result.eligible_voters} คนลงคะแนน)` : ""}`;
  const details = result.vote_details || [];
  const rounds = (result.vote_rounds || []).map((round) => `
    <section class="result-round"><h4>${round.runoff ? `Runoff รอบ ${round.round}` : `รอบโหวต ${round.round}`}</h4>
      ${(round.vote_details || []).map((item) => `<div class="final-vote-row"><span>${escapeHtml(item.player_name)}</span><strong>${item.votes} คะแนน</strong></div>`).join("")}
      <p class="vote-total">ลงคะแนน ${round.submitted_votes || 0} จาก ${round.eligible_voters || 0} คน</p>
    </section>`).join("");
  $("finalVoteResults").innerHTML = `<h3>ผลคะแนนแยกตามรอบ</h3>${rounds || details.map((item) => `<div class="final-vote-row"><span>${escapeHtml(item.player_name)}</span><strong>${item.votes} คะแนน</strong></div>`).join("")}`;
  $("returnLobbyBtn").disabled = currentState?.host_id !== currentUser.id;
  $("returnLobbyBtn").textContent = currentState?.host_id === currentUser.id ? "กลับ Lobby / เริ่มรอบใหม่" : "รอเจ้าของห้องกลับ Lobby";
  $("gamePhaseTitle").textContent = "ประกาศผลแล้ว";
  $("gamePhaseSubtitle").textContent = result.winner === "GUESSERS" ? "ฝ่ายผู้เล่นชนะ" : "ผู้บงการเป็นฝ่ายชนะ";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

async function sendAction(payload) {
  try {
    await connectWebSocket();
    send(payload);
  } catch (error) {
    console.error(error);
    toast("เชื่อมต่อเซิร์ฟเวอร์เกมไม่ได้ กรุณาลองใหม่");
  }
}

function bindEvents() {
  $("createRoomBtn").addEventListener("click", () => {
    const username = getPlayerName();
    if (username) sendAction({ type: "create_room", username });
  });
  $("openJoinBtn").addEventListener("click", () => {
    if (!getPlayerName()) return;
    $("joinGate").classList.remove("hidden");
    $("lobbyContent").classList.add("hidden");
    showScreen("lobby");
    $("roomCodeInput").focus();
  });
  $("joinRoomBtn").addEventListener("click", () => {
    const username = getPlayerName();
    if (!username) return;
    const code = $("roomCodeInput").value.trim().toUpperCase();
    if (code.length !== 6) return toast("กรุณากรอกรหัสห้องให้ครบ 6 ตัว");
    sendAction({ type: "join_room", room_code: code, username });
  });
  $("cancelJoinBtn").addEventListener("click", () => { $("joinGate").classList.add("hidden"); showScreen("home"); });
  $("roomCodeInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("joinRoomBtn").click();
  });
  $("copyRoomBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(currentRoomCode || "");
      toast("คัดลอกรหัสห้องแล้ว");
    } catch {
      toast(`รหัสห้อง: ${currentRoomCode}`);
    }
  });
  $("startGameBtn").addEventListener("click", () => {
    send({ type: "start_game", room_code: currentRoomCode });
  });
  $("leaveRoomBtn").addEventListener("click", () => {
    if (currentRoomCode) send({ type: "leave_room", room_code: currentRoomCode });
  });
  $("sendQuestionBtn").addEventListener("click", () => {
    const question = $("questionInput").value.trim();
    if (!question) return toast("กรุณาพิมพ์คำถาม");
    if (send({ type: "ask_question", room_code: currentRoomCode, question })) {
      $("questionInput").value = "";
      toast("ส่งคำถามให้ GM แล้ว");
    }
  });
  $("sendGuessBtn").addEventListener("click", () => {
    const guess = $("guessInput").value.trim();
    if (!guess) return toast("กรุณาพิมพ์คำเดา");
    if (send({ type: "submit_guess", room_code: currentRoomCode, guess })) {
      $("guessInput").value = "";
      toast("ส่งคำเดาให้ GM ตรวจแล้ว");
    }
  });
  document.querySelectorAll("[data-answer]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!activeQuestion) return toast("ยังไม่มีคำถามรอคำตอบ");
      send({ type: "gm_answer", room_code: currentRoomCode, answer: button.dataset.answer });
    });
  });
  $("guessWrongBtn").addEventListener("click", () => {
    send({ type: "gm_guess_result", room_code: currentRoomCode, correct: false });
    pendingGuess = null;
    $("guessReview").classList.add("hidden");
  });
  $("guessCorrectBtn").addEventListener("click", () => {
    send({ type: "gm_guess_result", room_code: currentRoomCode, correct: true });
    pendingGuess = null;
    $("guessReview").classList.add("hidden");
  });
  $("returnLobbyBtn").addEventListener("click", () => {
    if (currentState?.host_id !== currentUser.id) return toast("รอเจ้าของห้องกลับ Lobby เพื่อเริ่มรอบใหม่");
    myRole = null; hasVoted = false; voteDeadline = null;
    send({ type: "return_to_lobby", room_code: currentRoomCode });
  });
  $("backHomeBtn").addEventListener("click", () => {
    if (currentRoomCode) send({ type: "leave_room", room_code: currentRoomCode });
    currentRoomCode = null;
    currentState = null;
    myRole = null;
    hasVoted = false;
    showScreen("home");
  });
  document.querySelectorAll("[data-open-help]").forEach((button) => button.addEventListener("click", openHelp));
  $("closeHelpBtn").addEventListener("click", closeHelp);
  $("helpModal").addEventListener("click", (event) => { if (event.target === $("helpModal")) closeHelp(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeHelp(); });
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (link.dataset.nav === "home") {
        event.preventDefault();
        showScreen("home");
      }
    });
  });
}

function openHelp() { $("helpModal").classList.remove("hidden"); }
function closeHelp() { $("helpModal").classList.add("hidden"); }

function updateClock() {
  if (timerDeadline && currentState?.phase === "playing") {
    $("turnClock").textContent = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
  } else { $("turnClock").textContent = "—"; }
  if (voteDeadline && currentState?.phase === "voting") {
    const remaining = Math.max(0, Math.ceil((voteDeadline - Date.now()) / 1000));
    $("voteClock").textContent = remaining;
    $("voteClock").parentElement.classList.toggle("urgent", remaining <= 10);
  } else if ($("voteClock")) { $("voteClock").textContent = currentState?.phase === "finished" ? "0" : "60"; }
}

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await initDiscordSDK();
  $("playerNameInput").value = currentUser.username === "ผู้เล่น" ? "" : currentUser.username;
  try {
    await connectWebSocket();
  } catch (error) {
    console.warn("Server connection will be retried when a room action is used.", error);
  }
  setInterval(updateClock, 250);
});
