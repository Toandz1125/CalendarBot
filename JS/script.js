import { getCurrentLogin } from './auth.js';
import { API_URL } from './config.js';

//#region intinial

const messageForm = document.querySelector(".prompt__form");
const chatHistoryContainer = document.querySelector(".chats");
const suggestionItems = document.querySelectorAll(".suggests__item");

const themeToggleButton = document.getElementById("themeToggler");
const voiceButton = document.getElementById("voiceButton");
const inputEl = document.querySelector(".prompt__form-input");
// Sidebar toggle (collapse / expand)
const sidebar = document.getElementById("sidebar");
const toggleSidebarBtn = document.getElementById("toggleSidebar");
const ACCOUNTS_KEY = "calendar_accounts";
const accountToggle = document.getElementById("accountToggle");
const accountDropdown = document.getElementById("accountDropdown");
const accountList = document.getElementById("accountList");
const addAccountBtn = document.getElementById("addAccountBtn");
const accountsContainer = document.getElementById("accountsContainer");
// CONTACTS MODAL HANDLER
const importContactsBtn = document.getElementById('importContactsBtn');
const contactsModal = document.getElementById('contactsModal');
const contactRows = document.getElementById('contactRows');
const addRowBtn = document.getElementById('addRowBtn');
const saveContactsBtn = document.getElementById('saveContactsBtn');
const cancelContactsBtn = document.getElementById('cancelContactsBtn');

const sidebarList = document.getElementById('sidebarList'); // where contacts will show

// Tạo khung hiển thị lỗi dưới vùng nhập (nếu chưa có)
let contactsErrorBox = document.getElementById('contactsError');
const ACCOUNTS_FILE = "data/accounts.json";

let accounts = []; // in-memory

// State variables
let currentUserMessage = null;
let isGeneratingResponse = false;
let autoAskQuestionSent = false; // guard initial auto-question
let autoAskAttemptInFlight = false;
// Feature detect
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
// recording state
let isRecording = false;
let interimTranscript = "";
let finalTranscript = "";

// Session token check (redirect if missing)
const existingSessionToken = sessionStorage.getItem("sessionToken");
if (!existingSessionToken || existingSessionToken.trim() === "") {
  alert("Chưa đăng nhập. Vui lòng đăng nhập để sử dụng ứng dụng.");
  window.location.href = "Partials/login.html";
  // Dừng thêm logic (trình duyệt sẽ chuyển trang)
}

(function initLogout(){
  const btn = document.getElementById('logoutBtn');
  const ONE_DAY = 24 * 60 * 60 * 1000;
  let autoLogoutTimerId = null;

  async function performLogout() {
    const sessionToken = sessionStorage.getItem('sessionToken');
    if (!sessionToken) {
      console.warn('No session token');
      cleanupAndReload();
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.classList.add('loading');
    }

    try {
      const res = await fetch(`${API_URL}/Auth/logout?sessionToken=${encodeURIComponent(sessionToken)}`, {
        method: 'POST'
      });
      if (!res.ok) {
        console.warn('Server logout failed', res.status);
      }
    } catch (e) {
      console.warn('Logout request error', e);
    } finally {
      cleanupAndReload();
    }
  }

  function cleanupAndReload(){
    sessionStorage.removeItem('sessionToken');
    sessionStorage.removeItem('sessionLoginAt'); // reset session start time
    location.reload();
  }

  function scheduleAutoLogout(){
    let loginAt = Number(sessionStorage.getItem('sessionLoginAt'));
    if (!loginAt) {
      loginAt = Date.now();
      sessionStorage.setItem('sessionLoginAt', String(loginAt));
    }

    const elapsed = Date.now() - loginAt;
    const remaining = ONE_DAY - elapsed;

    // Nếu đã quá 1 ngày, logout ngay; ngược lại lên lịch
    if (remaining <= 0) {
      performLogout();
    } else {
      autoLogoutTimerId = setTimeout(() => {
        performLogout();
      }, remaining);
    }
  }

  // Gắn sự kiện click nếu có nút
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!confirm('Bạn có chắc chắn muốn đăng xuất?')) return;
      performLogout();
    });
  }

  // Lên lịch tự động logout
  scheduleAutoLogout();
})();

//#endregion




//#region Event Listeners


messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  handleOutgoingMessage();
});

themeToggleButton.addEventListener("click", () => {
  const isLightTheme = document.body.classList.toggle("light_mode");
  localStorage.setItem("themeColor", isLightTheme ? "light_mode" : "dark_mode");

  const newIconClass = isLightTheme ? "bx bx-moon" : "bx bx-sun";
  themeToggleButton.querySelector("i").className = newIconClass;
});


suggestionItems.forEach((suggestion) => {
  suggestion.addEventListener("click", () => {
    currentUserMessage = suggestion.querySelector(
      ".suggests__item-text"
    ).innerText;
    handleOutgoingMessage();
  });
});

// Hàm tải HTML template từ file
async function loadTemplate(path, data = {}) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Không thể load template: ${path}`);
  let html = await res.text();
  
  // Thay thế {{placeholder}} bằng dữ liệu truyền vào
  for (const key in data) {
    html = html.replaceAll(`{{${key}}}`, data[key]);
  }
  return html;
}
//#endregion



//#region Chat UI helpers and unified send flow (SignalR only)
// Create a message container element with provided inner HTML and CSS classes
function createChatMessageElement(innerHtml, ...classes) {
  const el = document.createElement('div');
  el.className = ['message', ...classes].join(' ');
  el.innerHTML = innerHtml;
  return el;
}

// Ensure chat view stays scrolled to the latest message
function scrollChatToBottom(smooth = true) {
  try {
    if (chatHistoryContainer) {
      const top = chatHistoryContainer.scrollHeight;
      chatHistoryContainer.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    } else {
      // fallback to page scroll
      window.scrollTo({ top: document.body.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }
  } catch {}
}

// Minimal typing effect: set content, highlight code, reveal copy icon
function showTypingEffect(rawText, html, textEl, messageEl, isUser = false) {
  if (!textEl) return;
  textEl.innerHTML = html || '';
  try {
    if (window.hljs) {
      messageEl.querySelectorAll('pre code').forEach((block) => {
        try { window.hljs.highlightElement(block); } catch {}
      });
    }
  } catch {}
  const copyBtn = messageEl.querySelector('.message__icon');
  if (copyBtn) copyBtn.classList.remove('hide');
  // Keep newest content in view as messages expand
  scrollChatToBottom(true);
}

// Persisted history is not scoped here; for now just clear UI
function loadSavedChatHistory() {
  if (chatHistoryContainer) chatHistoryContainer.innerHTML = '';
}

// Copy helper (wired by onClick in partials)
function copyMessageToClipboard(el) {
  try {
    const root = el?.closest('.message');
    const p = root?.querySelector('.message__text');
    const text = p?.innerText || '';
    if (!text) return;
    navigator.clipboard.writeText(text).catch(() => {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  } catch {}
}
// expose globally for inline onClick
window.copyMessageToClipboard = copyMessageToClipboard;

// Centralized send: take either currentUserMessage (e.g., suggest/voice) or input field
async function handleOutgoingMessage() {
  try {
    const text = (currentUserMessage && currentUserMessage.trim()) || inputEl.value.trim();
    if (!text) return;

    // reset state now to avoid duplicate sends
    currentUserMessage = null;
    inputEl.value = '';

    // Render user message
    const userHtml = await loadTemplate('Partials/user-message.html', { text: escapeHtml(text) });
    const userEl = createChatMessageElement(userHtml, 'message--outgoing');
    chatHistoryContainer.appendChild(userEl);
  scrollChatToBottom(true);

    // Ensure WS connection and send via SignalR only
    await wsConnectIfPossible();
    if (isWsConnected()) {
      await sendViaSignalR(text);
    } else {
      // Show a single incoming error bubble when offline
      const incomingEl = await createIncomingLoadingMessage();
      incomingEl.classList.remove('message--loading');
      incomingEl.classList.add('message--error');
      const textEl = incomingEl.querySelector('.message__text');
      if (textEl) textEl.innerText = 'Không thể kết nối máy chủ chat. Vui lòng thử lại.';
    }
  } catch (err) {
    console.warn('handleOutgoingMessage error:', err);
  }
}
//#endregion



//#region Voice Recognition Logic

voiceButton.addEventListener("dblclick", () => {
  if (confirm("Are you sure you want to delete all chat history?")) {
    localStorage.removeItem("saved-api-chats");
    loadSavedChatHistory();
    currentUserMessage = null;
    isGeneratingResponse = false;
    alert("Chat history cleared.");
  }
});

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.lang = "vi-VN";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
} else {
  recognition = null;
}

// UI helpers
const setRecordingUI = (recording) => {
  if (recording) {
    voiceButton.classList.add("recording");
    voiceButton.querySelector("i").className = "bx bx-microphone";
    voiceButton.setAttribute("aria-pressed", "true");
  } else {
    voiceButton.classList.remove("recording");
    voiceButton.querySelector("i").className = "bx bx-microphone";
    voiceButton.removeAttribute("aria-pressed");
  }
};

// start recognition
const startRecognition = () => {
  if (!recognition) {
    alert("Speech Recognition not supported in this browser.");
    return;
  }
  if (isRecording) return;
  interimTranscript = "";
  finalTranscript = "";
  recognition.start();
  isRecording = true;
  setRecordingUI(true);
};

// stop recognition
const stopRecognition = (andSubmit = true) => {
  if (!recognition || !isRecording) return;
  recognition.stop();
  isRecording = false;
  setRecordingUI(false);

  // set final text to input and submit (if any)
  const transcript = finalTranscript || interimTranscript;
  if (transcript && transcript.trim().length > 0) {
    inputEl.value = transcript.trim();
    // gửi message tự động
    // call the same handler as submit
    handleOutgoingMessage();
  }
};

// Recognition event handlers
if (recognition) {
  recognition.onstart = () => {
    // optional: show indicator
  };

  recognition.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const res = event.results[i];
      if (res.isFinal) {
        final += res[0].transcript;
      } else {
        interim += res[0].transcript;
      }
    }
    interimTranscript = interim.trim();
    finalTranscript = (finalTranscript + " " + final).trim();
    // update input with interim so user sees words live
    inputEl.value = (finalTranscript + " " + interimTranscript).trim();
  };

  recognition.onerror = (e) => {
    console.error("Speech recognition error:", e);
    // stop UI
    isRecording = false;
    setRecordingUI(false);
  };

  recognition.onend = () => {
    // recognition ended by itself (safety)
    // do nothing here, final handling is in stopRecognition flow
  };
}

let spaceDown = false;
window.addEventListener("keydown", (e) => {
  const tag = (document.activeElement?.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;

  if (e.code === "Space" && !spaceDown) {
    e.preventDefault(); // ngăn scroll xuống trang
    spaceDown = true;
    startRecognition();
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space" && spaceDown) {
    e.preventDefault();
    spaceDown = false;
    stopRecognition(true);
  }
});

// Mouse / touch support on the mic button (hold)
voiceButton.addEventListener("mousedown", (e) => {
  e.preventDefault();
  startRecognition();
});
window.addEventListener("mouseup", (e) => {
  if (isRecording) stopRecognition(true);
});

// For mobile touch events
voiceButton.addEventListener("touchstart", (e) => {
  e.preventDefault();
  startRecognition();
}, {passive:false});
voiceButton.addEventListener("touchend", (e) => {
  e.preventDefault();
  if (isRecording) stopRecognition(true);
}, {passive:false});

//#endregion



//#region Account
async function loadAccounts() {
  try {
    const sessionToken = sessionStorage.getItem("sessionToken");
    const res = await fetch(`${API_URL}/User/Refresh?sessionToken=${sessionToken}`);
    const loginInfo = res.body ? await res.json() : null;
    if (!loginInfo || !loginInfo.data || !loginInfo.data.user) throw new Error("Chưa đăng nhập.");
    const response = loginInfo.data.user.authProviders.map(p => ({
      id: p.providerUserId,
      name: p.displayName,
      email: p.providerEmail,
      avatar: "Picture/profile.png"
    }));
    accounts = response;
  } catch (e) {
    console.warn("Không đọc được accounts.json:", e);
    accounts = [];
  }
  renderAccounts();
  updateAccountButtonLabel();
}

async function refreshOAuthSession(id) {
  const sessionToken = sessionStorage.getItem("sessionToken");
  if (!sessionToken) {
    console.warn("Không có session token để gọi refresh OAuth.");
    return;
  }
  if (!id) {
    console.warn("Không có account id để gọi refresh OAuth.");
    return;
  }

  const url = `${API_URL}/OAuth/Refresh?SessionToken=${encodeURIComponent(sessionToken)}&providerUserId=${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      console.warn("Refresh OAuth thất bại", res.status, res.statusText);
    }
  } catch (err) {
    console.warn("Refresh OAuth lỗi", err);
  }
}

async function OAuthAccounts() {

  const sessionToken = sessionStorage.getItem("sessionToken");
  const url = `${API_URL}/OAuth?sessionToken=` + sessionToken.toString();
  const win = window.open(url, "_blank", "width=500,height=700");
  if (!win) {
    alert("Không thể mở cửa sổ OAuth. Hãy kiểm tra popup blocker của trình duyệt.");
    return;
  }

  // Determine expected origin for postMessage from the OAuth flow (same host as API_URL)
  let apiOrigin = null;
  try { apiOrigin = new URL(API_URL).origin; } catch { apiOrigin = null; }

  // Handler when popup notifies success via postMessage
  const onMessage = (event) => {
    try {
      if (apiOrigin && event.origin !== apiOrigin) return; // ignore unknown origins
      const data = event.data || {};
      if (data && (data.type === 'oauth-success' || data.type === 'oauth-complete')) {
        window.removeEventListener('message', onMessage);
        try { win.close(); } catch {}
        // Refresh accounts UI
        loadAccounts();
        updateAccountButtonLabel();
      }
    } catch {}
  };
  window.addEventListener('message', onMessage);

  // Fallback: poll until the popup is closed, then refresh
  const poll = setInterval(() => {
    try {
      if (win.closed) {
        clearInterval(poll);
        window.removeEventListener('message', onMessage);
        loadAccounts();
        updateAccountButtonLabel();
      }
    } catch {
      // if cross-origin access throws, keep polling; closed flag still works
    }
  }, 600);
}

async function renderAccounts() {
  accountList.innerHTML = "";
  if (accounts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "account-item";
    empty.style.opacity = "0.7";
    empty.innerHTML = `
      <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.03)"></div>
      <div class="account-item__meta">
        <div class="account-item__name">No accounts</div>
        <div class="account-item__email">Click Add account to create one</div>
      </div>`;
    accountList.appendChild(empty);
    return;
  }

  accounts.forEach(async (acc) => {
    const it = document.createElement("div");
    it.className = "account-item";
    it.dataset.id = acc.id;

    const html = await loadTemplate("Partials/accounts.html", {
      avatar: acc.avatar || "Picture/profile.png",
      name: acc.name || "Unnamed",
      email: acc.email || ""
    });
    it.innerHTML = html;


    // chọn tài khoản
    it.querySelector(".account-item__avatar").addEventListener("click", () => {
      selectAccount(acc.id);
      closeAccountDropdown();
    });
    it.querySelector(".account-item__meta").addEventListener("click", () => {
      selectAccount(acc.id);
      closeAccountDropdown();
    });

    // nút xóa
    it.querySelector(".account-item__delete").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Xóa tài khoản "${acc.name}"?`)) {
        deleteAccount(acc.id);
      }
    });

    accountList.appendChild(it);
  });
}

// hàm xóa tài khoản
function deleteAccount(id) {
  accounts = accounts.filter((a) => a.id !== id);
  renderAccounts();
  updateAccountButtonLabel();
}

// when user chooses an account
function selectAccount(id) {
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return;
  // update button label
  const nameSpan = accountToggle.querySelector(".account-btn__name");
  const avatarImg = accountToggle.querySelector(".account-btn__avatar");
  nameSpan.innerText = acc.name || "Account";
  avatarImg.src = acc.avatar || "Picture/profile.png";

  // set currently selected account id to localStorage
  // localStorage.setItem("calendar_selected_account", id);

  // optional: trigger event so other parts of app can react
  const evt = new CustomEvent("accountChanged", { detail: acc });
  window.dispatchEvent(evt);

  refreshOAuthSession(id);
}

// add account (simple prompt flow)
function addAccountFlow() {
  // Mở flow OAuth; danh sách tài khoản sẽ tự reload khi popup đóng hay báo thành công
  OAuthAccounts();
}

// dropdown open/close helpers
function openAccountDropdown() {
  accountDropdown.classList.remove("hide");
  accountDropdown.setAttribute("aria-hidden", "false");
  accountToggle.setAttribute("aria-expanded", "true");
}
function closeAccountDropdown() {
  accountDropdown.classList.add("hide");
  accountDropdown.setAttribute("aria-hidden", "true");
  accountToggle.setAttribute("aria-expanded", "false");
}
function toggleAccountDropdown() {
  if (accountDropdown.classList.contains("hide")) openAccountDropdown();
  else closeAccountDropdown();
}

// update account button label from selected account; fallback to first account or generic
function updateAccountButtonLabel() {
  const selId = localStorage.getItem("calendar_selected_account");
  let chosen = accounts.find(a => a.id === selId) || accounts[0] || null;
  const nameSpan = accountToggle.querySelector(".account-btn__name");
  const avatarImg = accountToggle.querySelector(".account-btn__avatar");
  if (chosen) {
    nameSpan.innerText = chosen.name || "Account";
    avatarImg.src = chosen.avatar || "Picture/profile.png";
  } else {
    nameSpan.innerText = "Account";
    avatarImg.src = "Picture/profile.png";
  }
}

/* Event listeners */
accountToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleAccountDropdown();
});

// add account button
addAccountBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  addAccountFlow();
});

// close dropdown when clicking outside
document.addEventListener("click", (e) => {
  if (!accountsContainer.contains(e.target)) closeAccountDropdown();
});

// keyboard: Escape to close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAccountDropdown();
});

// init accounts after loading existing history
loadAccounts();
loadContactsFromStorage();
// expose helper for other modules if needed
window.AccountsAPI = {
  list: () => accounts,
  add: (obj) => { accounts.unshift(obj); saveAccounts(); renderAccounts(); },
  select: (id) => selectAccount(id),
};



//#endregion



//#region Contacts Modal Logic

// Tạo khung hiển thị lỗi dưới vùng nhập (nếu chưa có)
if (!contactsErrorBox) {
  contactsErrorBox = document.createElement('div');
  contactsErrorBox.id = 'contactsError';
  contactsErrorBox.className = 'contacts-error hide';
  // chèn ngay sau contactRows
  contactRows.parentNode.insertBefore(contactsErrorBox, contactRows.nextSibling);
}

// Helpers lỗi
function showContactsError(msg) {
  contactsErrorBox.textContent = msg;
  contactsErrorBox.classList.remove('hide');
}
function clearContactsError() {
  contactsErrorBox.textContent = '';
  contactsErrorBox.classList.add('hide');
}

// open/close helpers
function openModal() {
  contactsModal.classList.remove('hide');
  contactsModal.removeAttribute('aria-hidden');
  clearContactsError();
}
function closeModal() {
  contactsModal.classList.add('hide');
  contactsModal.setAttribute('aria-hidden', 'true');
}

// NEW: create a contact row (+ remove handler)
function createContactRow(initial = { email: '', name: '' }) {
  const row = document.createElement('div');
  row.className = 'contact-row';
  row.innerHTML = `
    <input type="email" class="contact-email" placeholder="Email" />
    <input type="text" class="contact-name" placeholder="Tên gợi nhớ" />
    <button type="button" class="icon-btn contact-row__remove" title="Xóa dòng" aria-label="Xóa dòng">
      <i class='bx bx-x'></i>
    </button>
  `;

  // set initial values via property to avoid HTML injection concerns
  row.querySelector('.contact-email').value = initial.email || '';
  row.querySelector('.contact-name').value = initial.name || '';

  // remove row (keep at least one row)
  row.querySelector('.contact-row__remove').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rows = contactRows.querySelectorAll('.contact-row');
    if (rows.length > 1) {
      row.remove();
    } else {
      row.querySelector('.contact-email').value = '';
      row.querySelector('.contact-name').value = '';
    }
  });

  return row;
}

// init: ensure at least one row
function ensureOneRow() {
  if (!contactRows.querySelector('.contact-row')) {
    contactRows.appendChild(createContactRow());
  }
}
ensureOneRow();

// wire buttons
importContactsBtn.addEventListener('click', (e) => {
  e.preventDefault();
  openModal();
});

// FIX: prevent default so "+" doesn’t submit the form
addRowBtn.addEventListener('click', (e) => {
  e.preventDefault();
  contactRows.appendChild(createContactRow());
});

cancelContactsBtn.addEventListener('click', (e) => {
  e.preventDefault();
  // optional: clear extra rows and keep one blank
  // reset to single empty row
  contactRows.innerHTML = '';
  contactRows.appendChild(createContactRow());
  closeModal();
});

// close when clicking backdrop or close icon
contactsModal.addEventListener('click', (e) => {
  // FIX: use closest to catch clicks on child <i> inside the close button
  const closer = e.target.closest('[data-close]');
  if (closer) {
    contactRows.innerHTML = '';
    contactRows.appendChild(createContactRow());
    clearContactsError();
    closeModal();
  }
});

// save contacts
function isValidEmail(email) {
  // simple regex
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function loadContactsFromStorage() {
  try {
    const sessionToken = sessionStorage.getItem("sessionToken");
    const res = await fetch(`${API_URL}/Contacts?sessionToken=${sessionToken}&search=&page=1&pageSize=20`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) return data.data;
    else throw new Error(data.message || 'API Error');
  } catch (err) { return []; }
}
async function saveContactsToStorage(list) {
  try {
    const sessionToken = sessionStorage.getItem("sessionToken");
    const res = await fetch(`${API_URL}/Contacts?sessionToken=${sessionToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(list)
    });

    // Luôn cố gắng đọc JSON từ server (kể cả khi HTTP status không OK)
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      // fallback khi server không trả JSON
      const txt = await res.text().catch(() => '');
      throw new Error(`Lỗi lưu contacts: ${res.status} ${res.statusText} ${txt}`);
    }

    // Trả về payload cho caller tự quyết định theo statusCode/success
    return payload;
  } catch (error) {
    throw error; // để caller xử lý hiển thị
  }
}

// Helper to prevent HTML injection in names/emails
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function renderSidebarContacts() {
  const list = await loadContactsFromStorage();
  sidebarList.innerHTML = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'sidebar__empty';
    p.innerText = 'No contacts yet';
    sidebarList.appendChild(p);
    return;
  }

  list.forEach((c, idx) => {
    const item = document.createElement('div');
    item.className = 'contact-item';
    item.innerHTML = `
      <div class="contact-item__meta">
        <div class="contact-item__name">${escapeHtml(c.name || c.email)}</div>
        <div class="contact-item__email">${escapeHtml(c.email)}</div>
      </div>
      <button class="icon-btn contact-delete-btn" data-index="${idx}" title="Xóa contact" aria-label="Xóa contact">
        <i class='bx bx-trash'></i>
      </button>
    `;
    sidebarList.appendChild(item);
  });

  // attach delete handlers (await the load, update, save, re-render)
  sidebarList.querySelectorAll('.contact-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = Number(e.currentTarget.dataset.index);
      const current = await loadContactsFromStorage();
      const target = current[idx];
      const label = target?.name || target?.email || `#${idx+1}`;
      if (!confirm(`Xóa contact "${label}"?`)) return;
      try {
        const sessionToken = sessionStorage.getItem("sessionToken");
        const res = await fetch(`${API_URL}/Contacts/${target.id}?sessionToken=${sessionToken}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(list)
        });
        if (!res.ok) throw new Error(`Lỗi xóa contacts: ${res.statusText}`);
      } catch (error) {
        console.warn("Không thể xóa contacts:", error);
      }
      await renderSidebarContacts();
    });
  });
}

// Save button logic
saveContactsBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  clearContactsError();
  const rows = Array.from(contactRows.querySelectorAll('.contact-row'));
  const toAdd = [];
  for (const r of rows) {
    const email = r.querySelector('.contact-email').value.trim();
    const name = r.querySelector('.contact-name').value.trim();
    if (!email) continue;
    if (!isValidEmail(email)) {
      showContactsError(`Email không hợp lệ: ${email}`);
      return;
    }
    toAdd.push({ email, name });
  }
  if (!toAdd.length) {
    showContactsError('Vui lòng nhập ít nhất 1 email hợp lệ.');
    return;
  }

  saveContactsBtn.disabled = true;
  try {
    const result = await saveContactsToStorage(toAdd);

    const createdCount = result?.data?.createdCount ?? 0;
    const errorCount = result?.data?.errorCount ?? 0;
    const errors = Array.isArray(result?.data?.errors) ? result.data.errors : [];

    // Nếu có mục tạo thành công thì refresh sidebar
    if (createdCount > 0) {
      await renderSidebarContacts();
    }

    if (errorCount > 0) {
      // Hiển thị lỗi chi tiết theo index/email/message
      const msg = errors.map(err => {
        const rowNo = typeof err.index === 'number' ? err.index + 1 : '?';
        const email = err.email || '';
        const m = err.message || 'Không thể tạo contact';
        return `Dòng ${rowNo}${email ? ` (${email})` : ''}: ${m}`;
      }).join(' ; ');
      showContactsError(msg || result?.message || 'Không thể lưu contacts.');
      // Giữ modal mở để người dùng sửa lỗi, không reset các dòng nhập
      return;
    }

    // Tất cả thành công -> reset và đóng modal
    contactRows.innerHTML = '';
    contactRows.appendChild(createContactRow());
    clearContactsError();
    closeModal();
  } catch (err) {
    showContactsError(err?.message || 'Không thể lưu contacts.');
  } finally {
    saveContactsBtn.disabled = false;
  }
});

// initial render
renderSidebarContacts();
// ===== Auto-enable scrolling when contact rows exceed 2/3 viewport =====
(function () {
  const modalPanel = document.querySelector('.modal__panel');
  const modalHeader = document.querySelector('.modal__header');
  const modalFooter = document.querySelector('.modal__footer');
  const actionsRow = document.querySelector('.modal__actions-row');

  function refreshContactRowsLimit() {
    if (!contactRows || !modalPanel) return;
    // compute available height: 66% viewport minus header/footer and extra padding
    const viewport2_3 = Math.floor(window.innerHeight * 0.66);
    const headerH = modalHeader ? modalHeader.getBoundingClientRect().height : 56;
    const footerH = modalFooter ? modalFooter.getBoundingClientRect().height : 64;
    const otherPadding = 120; // safe margin for modal body text + spacing
    // ensure at least 200px for rows
    const maxH = Math.max(200, viewport2_3 - Math.round(headerH + footerH + 20));
    contactRows.style.maxHeight = `${maxH}px`;

    // toggle scrollable class if content height bigger than allowed
    // use scrollHeight vs clientHeight to detect overflow
    // small timeout to ensure DOM updated when adding rows
    requestAnimationFrame(() => {
      const isOverflowing = contactRows.scrollHeight > contactRows.clientHeight + 4;
      if (isOverflowing) {
        contactRows.classList.add('scrollable');
        actionsRow.classList.add('scroll-on-top');
      } else {
        contactRows.classList.remove('scrollable');
        actionsRow.classList.remove('scroll-on-top');
      }
    });
  }

  // call when modal opens and on window resize and when rows change
  const modalObserver = new MutationObserver(() => {
    refreshContactRowsLimit();
  });

  // observe rows container for child changes (add/remove)
  modalObserver.observe(contactRows, { childList: true, subtree: false });

  // when opening modal (ensure calculation)
  const originalOpenModal = openModal;
  window.openModal = function () {
    originalOpenModal();
    // small delay to let CSS/layout settle
    setTimeout(refreshContactRowsLimit, 50);
  };

  // also refresh on window resize
  window.addEventListener('resize', refreshContactRowsLimit);

  // refresh after initial load (in case there are prefilled rows)
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(refreshContactRowsLimit, 50);
  });

  // If rows are edited or typed, recalc (optional)
  contactRows.addEventListener('input', () => {
    refreshContactRowsLimit();
  });
})();

toggleSidebarBtn.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
  document.body.classList.toggle("sidebar-collapsed");
});


//#endregion




//#region SignalR realtime (WS chat to backend)
const WS_AUTHORIZE_URL = `${API_URL}/ws`;
let hubConnection = null;
let hubReady = false;
const pendingWs = new Map(); // messageId -> { incomingEl, statusHtml? }
const userId = sessionStorage.getItem("userId");

async function ensurePendingMessageElement(msgId) {
  let entry = pendingWs.get(msgId);
  if (entry?.incomingEl) return entry.incomingEl;
  const incomingEl = await createIncomingLoadingMessage();
  if (entry) {
    entry.incomingEl = incomingEl;
    pendingWs.set(msgId, entry);
  } else {
    pendingWs.set(msgId, { incomingEl, statusHtml: null });
  }
  return incomingEl;
}

function isSignalRAvailable() {
  return typeof window !== 'undefined' && !!window.signalR && !!window.signalR.HubConnectionBuilder;
}

function genMessageId() {
  if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  // fallback hex
  const arr = new Uint8Array(16);
  (crypto?.getRandomValues ? crypto.getRandomValues(arr) : arr.fill(0));
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function wsAuthorize(sessionToken) {
  const res = await fetch(WS_AUTHORIZE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionToken)
  });
  if (!res.ok) throw new Error(`Authorize WS failed: ${res.status}`);
  const payload = await res.json().catch(() => ({}));
  const data = payload?.data ?? payload?.Data;
  if (!data) throw new Error(payload?.message || payload?.Message || 'WS authorize payload invalid.');
  const url = data.url || data.Url;
  if (!url) throw new Error('WS authorize missing Url.');
  return url;
}

function payloadToHtml(payload) {
  if (typeof payload === 'string') {
    return marked.parse(payload);
  }
  const pretty = JSON.stringify(payload, null, 2);
  return `<pre><code class="language-json">${escapeHtml(pretty)}</code></pre>`;
}

// Extract only a human-readable message from diverse payload shapes
function extractMessage(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  // common keys to probe (case variants & nested)
  const candidates = [
    payload.message,
    payload.Message,
    payload.msg,
    payload.error?.message,
    payload.error?.Message,
    payload.data?.message,
    payload.data?.Message,
    payload.result?.message,
    payload.result?.Message,
  ].filter(v => typeof v === 'string' && v.trim());
  if (candidates.length) return candidates[0];
  // fallback: if payload has 'data' that is string
  if (typeof payload.data === 'string') return payload.data;
  // final fallback: concise JSON (truncated)
  try {
    const json = JSON.stringify(payload);
    return json.length > 500 ? json.slice(0, 500) + '…' : json;
  } catch { return ''; }
}

function toDatetimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const tzOffset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - tzOffset * 60000);
  return local.toISOString().slice(0, 16);
}

function datetimeLocalInputToIso(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

// Build and show a confirmation modal for preview payloads
async function showConfirmPreviewModal({ msgId, resultType, preview }) {
  const html = await loadTemplate('Partials/confirm-preview.html');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();
  const modalRoot = wrapper.firstElementChild;
  if (!modalRoot) throw new Error('Modal template invalid');

  document.body.appendChild(modalRoot);

  const qs = (sel) => modalRoot.querySelector(sel);
  const setText = (sel, val, fallback = '—') => {
    const el = qs(sel);
    if (el) el.textContent = val && String(val).trim() ? String(val) : fallback;
  };
  const setInputValue = (sel, value = '') => {
    const el = qs(sel);
    if (el && 'value' in el) {
      el.value = value ?? '';
    }
    return el;
  };

  const data = (preview && (preview.data || preview)) || {};
  const title = data.title || data.summary || data.name || 'Yêu cầu thực thi';
  const description = data.description || data.details || data.note || '';
  const start = data.start || data.startsAt || data.startTime || data.begin || '';
  const end = data.end || data.endsAt || data.endTime || data.finish || '';
  const location = data.location || data.where || data.place || '';
  const warnings = Array.isArray(data.warnings) ? data.warnings
    : Array.isArray(data.Warnings) ? data.Warnings
    : [];

  setText('[data-field="resultType"]', resultType || 'Không xác định', 'Không xác định');
  setText('[data-field="description"]', description || '—', '—');
  setText('[data-field="location"]', location || 'Không có', 'Không có');

  const titleInput = setInputValue('[data-field="titleInput"]', title || '');
  const startInput = setInputValue('[data-field="startInput"]', toDatetimeLocalValue(start));
  const endInput = setInputValue('[data-field="endInput"]', toDatetimeLocalValue(end));

  const warningList = qs('[data-field="warnings"]');
  if (warningList) {
    warningList.innerHTML = '';
    if (warnings.length) {
      warnings.slice(0, 6).forEach((item) => {
        const li = document.createElement('li');
        li.className = 'warning-row';
        li.innerHTML = `<i class='bx bx-error-circle'></i><span>${escapeHtml(typeof item === 'string' ? item : JSON.stringify(item))}</span>`;
        warningList.appendChild(li);
      });
    } else {
      const li = document.createElement('li');
      li.className = 'warning-row warning-row--empty';
      li.innerText = 'Không có cảnh báo nào.';
      warningList.appendChild(li);
    }
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      document.removeEventListener('keydown', onKeyDown);
      try { modalRoot.remove(); } catch {}
    };
    const collectUpdates = () => {
      const titleVal = titleInput?.value?.trim() || '';
      const startLocal = startInput?.value || '';
      const endLocal = endInput?.value || '';
      return {
        title: titleVal || null,
        start: startLocal ? datetimeLocalInputToIso(startLocal) : null,
        startLocal,
        end: endLocal ? datetimeLocalInputToIso(endLocal) : null,
        endLocal,
      };
    };

    const onConfirm = () => {
      const updates = collectUpdates();
      cleanup();
      resolve({ confirmed: true, updates });
    };
    const onCancel = () => { cleanup(); resolve({ confirmed: false }); };

    const btnConfirm = qs('[data-action="confirm"]');
    const btnCancel = qs('[data-action="cancel"]');
    const closeTriggers = modalRoot.querySelectorAll('[data-close]');
    btnConfirm?.addEventListener('click', onConfirm, { once: true });
    btnCancel?.addEventListener('click', onCancel, { once: true });
    closeTriggers.forEach((el) => el.addEventListener('click', onCancel, { once: true }));

    modalRoot.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal__backdrop')) {
        onCancel();
      }
    });

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    setTimeout(() => {
      (btnConfirm || btnCancel)?.focus?.();
    }, 0);
  });
}
// expose globally (optional for other modules/templates)
window.showConfirmPreviewModal = showConfirmPreviewModal;

async function showDeletePreviewModal({ resultType, events }) {
  const html = await loadTemplate('Partials/confirm-delete.html');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();
  const modalRoot = wrapper.firstElementChild;
  if (!modalRoot) throw new Error('Delete modal template invalid');

  document.body.appendChild(modalRoot);

  const qs = (sel) => modalRoot.querySelector(sel);
  const listEl = qs('[data-field="eventList"]');
  const emptyEl = qs('[data-field="emptyState"]');
  const errorEl = qs('[data-field="error"]');
  const resultTypeField = qs('[data-field="resultType"]');
  const btnConfirm = qs('[data-action="confirm"]');
  const btnCancel = qs('[data-action="cancel"]');
  const closeTriggers = modalRoot.querySelectorAll('[data-close]');

  if (resultTypeField) {
    resultTypeField.textContent = resultType || 'update_event';
  }

  const checkboxSelector = '.delete-event-row__checkbox';

  const renderEventRow = (evt, idx) => {
    const label = document.createElement('label');
    label.className = 'delete-event-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'delete-event-row__checkbox';
    checkbox.checked = true;
    checkbox.dataset.eventId = evt.eventId || '';
    checkbox.dataset.index = String(evt.index ?? idx);
    checkbox.disabled = !evt.eventId;

    const content = document.createElement('div');
    content.className = 'delete-event-row__content';

    const title = document.createElement('p');
    title.className = 'delete-event-row__title';
    title.textContent = evt.title || `Sự kiện #${idx + 1}`;

    const range = document.createElement('p');
    range.className = 'delete-event-row__time';
    range.textContent = evt.timeRange || 'Thời gian không xác định';

    const location = document.createElement('p');
    location.className = 'delete-event-row__meta';
    location.textContent = evt.location || 'Không có địa điểm';

    content.appendChild(title);
    content.appendChild(range);
    content.appendChild(location);

    label.appendChild(checkbox);
    label.appendChild(content);
    return label;
  };

  if (events.length) {
    events.forEach((evt, idx) => {
      listEl?.appendChild(renderEventRow(evt, idx));
    });
    emptyEl?.classList.add('hide');
    btnConfirm?.removeAttribute('disabled');
  } else {
    emptyEl?.classList.remove('hide');
    btnConfirm?.setAttribute('disabled', 'true');
  }

  const showError = (msg) => {
    if (!errorEl) return;
    errorEl.textContent = msg || '';
    if (msg) errorEl.classList.remove('hide');
    else errorEl.classList.add('hide');
  };

  return new Promise((resolve) => {
    const cleanup = () => {
      document.removeEventListener('keydown', onKeyDown);
      try { modalRoot.remove(); } catch {}
    };

    const onConfirm = () => {
      const selected = Array.from(listEl?.querySelectorAll(checkboxSelector) || [])
        .filter((input) => input.checked && input.dataset.eventId)
        .map((input) => input.dataset.eventId);

      if (!selected.length) {
        showError('Vui lòng chọn ít nhất một sự kiện để xóa.');
        return;
      }

      cleanup();
      resolve({ confirmed: true, selectedEventIds: selected });
    };

    const onCancel = () => {
      cleanup();
      resolve({ confirmed: false });
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    btnConfirm?.addEventListener('click', onConfirm);
    btnCancel?.addEventListener('click', onCancel);
    closeTriggers.forEach((el) => el.addEventListener('click', onCancel));
    modalRoot.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal__backdrop')) {
        onCancel();
      }
    });
    document.addEventListener('keydown', onKeyDown);
  });
}
window.showDeletePreviewModal = showDeletePreviewModal;

async function showUpdatePreviewModal({ resultType, events }) {
  const html = await loadTemplate('Partials/update-preview.html');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();
  const modalRoot = wrapper.firstElementChild;
  if (!modalRoot) throw new Error('Update modal template invalid');

  document.body.appendChild(modalRoot);

  const qs = (sel) => modalRoot.querySelector(sel);
  const listEl = qs('[data-field="eventList"]');
  const emptyEl = qs('[data-field="emptyState"]');
  const errorEl = qs('[data-field="error"]');
  const btnConfirm = qs('[data-action="confirm"]');
  const btnCancel = qs('[data-action="cancel"]');
  const closeTriggers = modalRoot.querySelectorAll('[data-close]');

  const renderWarnings = (container, warnings = []) => {
    if (!container) return;
    container.innerHTML = '';
    if (!warnings.length) {
      const li = document.createElement('li');
      li.className = 'update-event-row__warning update-event-row__warning--empty';
      li.innerText = 'Không có cảnh báo nào.';
      container.appendChild(li);
      return;
    }
    warnings.slice(0, 4).forEach((warning) => {
      const li = document.createElement('li');
      li.className = 'update-event-row__warning';
      li.innerHTML = `<i class='bx bx-error-circle'></i><span>${escapeHtml(typeof warning === 'string' ? warning : JSON.stringify(warning))}</span>`;
      container.appendChild(li);
    });
  };

  const renderEventRow = (evt, idx) => {
    const row = document.createElement('div');
    row.className = 'update-event-row';
    row.dataset.eventId = evt.eventId || '';
    row.innerHTML = `
      <div class="update-event-row__header">
        <label class="update-event-row__select">
          <input type="checkbox" class="update-event-row__checkbox" ${evt.eventId ? 'checked' : 'disabled'} />
        </label>
        <div class="update-event-row__meta">
          <p class="update-event-row__title">${escapeHtml(evt.title || `Sự kiện #${idx + 1}`)}</p>
          <p class="update-event-row__time">${escapeHtml(evt.timeRange || 'Thời gian không xác định')}</p>
          <p class="update-event-row__location">${escapeHtml(evt.location || 'Không có địa điểm')}</p>
        </div>
      </div>
      <div class="update-event-row__fields">
        <label class="field-block">
          <span class="field-label">Tiêu đề mới</span>
          <input type="text" class="field-input" data-field="newTitle" />
        </label>
        <label class="field-block">
          <span class="field-label">Bắt đầu mới</span>
          <input type="datetime-local" class="field-input" data-field="newStart" />
        </label>
        <label class="field-block">
          <span class="field-label">Kết thúc mới</span>
          <input type="datetime-local" class="field-input" data-field="newEnd" />
        </label>
      </div>
      <ul class="update-event-row__warnings" data-field="warnings"></ul>
    `;

    const newTitleInput = row.querySelector('[data-field="newTitle"]');
    const newStartInput = row.querySelector('[data-field="newStart"]');
    const newEndInput = row.querySelector('[data-field="newEnd"]');
    if (newTitleInput) newTitleInput.value = evt.payload?.NewTitle || evt.payload?.newTitle || evt.title || '';
    if (newStartInput) newStartInput.value = toDatetimeLocalValue(evt.payload?.NewStart || evt.payload?.newStart);
    if (newEndInput) newEndInput.value = toDatetimeLocalValue(evt.payload?.NewEnd || evt.payload?.newEnd);

    const warningsList = row.querySelector('[data-field="warnings"]');
    renderWarnings(warningsList, evt.warnings);

    return row;
  };

  if (events.length) {
    events.forEach((evt, idx) => {
      const row = renderEventRow(evt, idx);
      listEl?.appendChild(row);
    });
    emptyEl?.classList.add('hide');
    btnConfirm?.removeAttribute('disabled');
  } else {
    emptyEl?.classList.remove('hide');
    btnConfirm?.setAttribute('disabled', 'true');
  }

  const showError = (msg) => {
    if (!errorEl) return;
    errorEl.textContent = msg || '';
    if (msg) errorEl.classList.remove('hide');
    else errorEl.classList.add('hide');
  };

  return new Promise((resolve) => {
    const cleanup = () => {
      document.removeEventListener('keydown', onKeyDown);
      try { modalRoot.remove(); } catch {}
    };

    const onConfirm = () => {
      showError('');
      const rows = Array.from(listEl?.querySelectorAll('.update-event-row') || []);
      const payloads = rows
        .map((row) => {
          const checkbox = row.querySelector('.update-event-row__checkbox');
          const eventId = row.dataset.eventId;
          if (!checkbox?.checked || !eventId) return null;
          const newTitle = row.querySelector('[data-field="newTitle"]')?.value?.trim() || null;
          const startLocal = row.querySelector('[data-field="newStart"]')?.value || '';
          const endLocal = row.querySelector('[data-field="newEnd"]')?.value || '';
          return {
            EventId: eventId,
            NewTitle: newTitle,
            NewStart: startLocal ? datetimeLocalInputToIso(startLocal) : null,
            NewEnd: endLocal ? datetimeLocalInputToIso(endLocal) : null,
          };
        })
        .filter(Boolean);

      if (!payloads.length) {
        showError('Vui lòng chọn ít nhất một sự kiện để cập nhật.');
        return;
      }

      cleanup();
      resolve({ confirmed: true, payloads });
    };

    const onCancel = () => {
      cleanup();
      resolve({ confirmed: false });
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    btnConfirm?.addEventListener('click', onConfirm);
    btnCancel?.addEventListener('click', onCancel);
    closeTriggers.forEach((el) => el.addEventListener('click', onCancel));
    modalRoot.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal__backdrop')) {
        onCancel();
      }
    });
    document.addEventListener('keydown', onKeyDown);
  });
}
window.showUpdatePreviewModal = showUpdatePreviewModal;

async function createIncomingLoadingMessage() {
  const loadingHtml = await loadTemplate("Partials/loading-message.html");
  const el = createChatMessageElement(loadingHtml, "message--incoming", "message--loading");
  chatHistoryContainer.appendChild(el);
  scrollChatToBottom(true);
  return el;
}

async function renderServerMessage(text, options = {}) {
  const { variantClass = '', allowHtml = false } = options;
  const incomingEl = await createIncomingLoadingMessage();
  incomingEl.classList.remove('message--loading');
  if (variantClass) incomingEl.classList.add(variantClass);
  const textEl = incomingEl.querySelector('.message__text');
  if (textEl) {
    const safeContent = allowHtml
      ? (text ?? '')
      : escapeHtml(String(text ?? '')).replace(/\n/g, '<br>');
    textEl.innerHTML = safeContent;
  }
  return incomingEl;
}

async function handleCalendarReminderNotification(payload) {
  const reminderMessage = payload?.message ?? payload?.Message ?? 'Bạn có một nhắc nhở lịch mới.';
  const eventTimeRaw = payload?.eventTime ?? payload?.EventTime ?? payload?.time ?? payload?.Time ?? null;
  const formattedTime = eventTimeRaw ? formatDateForDisplay(eventTimeRaw) : '';
  const parts = [
    '<strong>Nhắc nhở lịch</strong>',
    `<span>${escapeHtml(String(reminderMessage || ''))}</span>`
  ];
  if (formattedTime) {
    parts.push(`<span class="message__meta">Thời gian: ${escapeHtml(formattedTime)}</span>`);
  }
  const html = parts.join('<br>');
  await renderServerMessage(html, { variantClass: 'message--reminder', allowHtml: true });
}

async function wsConnectIfPossible() {
  const sessionToken = sessionStorage.getItem("sessionToken");
  if (!sessionToken) return;
  if (!isSignalRAvailable()) {
    console.warn("SignalR library not found. Ensure <script src='.../signalr.min.js'> is included.");
    return;
  }
  if (hubConnection && (hubConnection.state === signalR.HubConnectionState.Connected ||
                        hubConnection.state === signalR.HubConnectionState.Connecting)) {
    return; // already connecting/connected
  }

  try {
    let hubUrl = null;
    try {
      hubUrl = await wsAuthorize(sessionToken);
    } catch (authErr) {
      console.warn('WS authorize failed, will try fallback hub URL.', authErr);
      // Fallback hub URL: derive from API_URL by stripping trailing '/api'
      const base = API_URL.replace(/\/?api\/?$/i, '');
      hubUrl = `${base}/hubs/notifications`;
    }

    const useDirectWs = /^wss?:/i.test(hubUrl);
    const connectOpts = {
      accessTokenFactory: () => sessionToken,
    };
    if (useDirectWs) {
      // If we get a ws/wss URL, skip negotiation and go straight to WebSockets
      connectOpts.transport = signalR.HttpTransportType.WebSockets;
      connectOpts.skipNegotiation = true;
    }

    console.info('[SignalR] Connecting to hub:', hubUrl, 'opts:', {
      skipNegotiation: !!connectOpts.skipNegotiation,
      transport: connectOpts.transport === signalR.HttpTransportType.WebSockets ? 'WebSockets' : 'Auto',
    });

    hubConnection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, connectOpts)
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Information)
      .build();

    // expose for cleanup
    window.hubConnection = hubConnection;

    hubConnection.on('notification', async (raw) => {
      try {
        const root = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const type = root?.type || root?.Type;
        if (!type) return;

        switch (type) {
          case 'greeting':
            // optional: show system message
            break;
          case 'ack': {
            const msgId = root?.messageId ?? root?.MessageId ?? '?';
            const item = pendingWs.get(msgId);
            if (item?.incomingEl) {
              const textEl = item.incomingEl.querySelector(".message__text");
              if (textEl && !item.acked) {
                textEl.innerText = "Server đã nhận yêu cầu, đang xử lý...";
                item.acked = true;
              }
            }
            break;
          }
          case 'preview': {
            // { type, messageId, resultType, expiresAt, preview, traceId, connectionId }
            const msgId = root?.messageId ?? root?.MessageId ?? '?';
            const resultType = root?.resultType ?? root?.ResultType ?? 'create_event';
            const preview = root?.preview ?? root?.Preview;
            const expiresAt = root?.expiresAt ?? root?.ExpiresAt ?? root?.expiration ?? root?.Expiration ?? null;
            const resultTypeKey = (resultType || '').toLowerCase();
            const previewList = getPreviewDataArray(preview);

            if (resultTypeKey === 'update_event' && previewList?.length) {
              const candidates = buildUpdateEventCandidates(preview);
              if (!candidates.length) {
                const incomingEl = await ensurePendingMessageElement(msgId);
                incomingEl.classList.remove('message--loading');
                incomingEl.classList.add('message--error');
                const textEl = incomingEl.querySelector('.message__text');
                if (textEl) textEl.innerText = 'Không tìm thấy dữ liệu hợp lệ để cập nhật.';
                pendingWs.delete(msgId);
                break;
              }

              try {
                const decision = await showUpdatePreviewModal({ resultType, events: candidates });
                if (!decision?.confirmed) break;

                const execJson = JSON.stringify(decision.payloads);
                await hubConnection.invoke('ConfirmOperation', msgId, resultType, true, execJson, null);

                const incomingEl = await ensurePendingMessageElement(msgId);
                incomingEl.classList.remove('message--loading');
                const textEl = incomingEl.querySelector('.message__text');
                if (textEl) textEl.innerText = `Đã gửi yêu cầu cập nhật ${decision.payloads.length} sự kiện.`;
              } catch (err) {
                console.warn('Xử lý update_event preview lỗi:', err);
              }

              break;
            }

            if (resultTypeKey === 'delete_event') {
              const candidates = buildDeleteEventCandidates(preview).filter((c) => !!c.eventId);
              if (!candidates.length) {
                console.warn('Không có eventId hợp lệ trong preview delete_event');
                const incomingEl = await ensurePendingMessageElement(msgId);
                incomingEl.classList.remove('message--loading');
                incomingEl.classList.add('message--error');
                const textEl = incomingEl.querySelector('.message__text');
                if (textEl) textEl.innerText = 'Không tìm thấy sự kiện hợp lệ để xóa.';
                pendingWs.delete(msgId);
                break;
              }

              try {
                const decision = await showDeletePreviewModal({ resultType, events: candidates });
                if (!decision?.confirmed) break;

                const deletePayload = decision.selectedEventIds.map((eventId) => ({ EventId: eventId }));
                const execJson = JSON.stringify(deletePayload);
                await hubConnection.invoke('ConfirmOperation', msgId, resultType, true, execJson, null);

                const incomingEl = await ensurePendingMessageElement(msgId);
                incomingEl.classList.remove('message--loading');
                const textEl = incomingEl.querySelector('.message__text');
                if (textEl) textEl.innerText = `Đã gửi yêu cầu xóa ${deletePayload.length} sự kiện.`;
              } catch (err) {
                console.warn('Xử lý delete_event preview lỗi:', err);
              }

              break;
            }

            const execHandle = normalizeExecutionPayload(preview);

            // Build and show confirmation modal
            showConfirmPreviewModal({ msgId, resultType, preview, expiresAt })
              .then(async (decision) => {
                try {
                  if (!decision) return;
                  const sanitizedUpdates = {
                    title: decision.updates?.title?.trim() || null,
                    start: decision.updates?.start || null,
                    end: decision.updates?.end || null,
                  };
                  const hasUserEdits = !!(sanitizedUpdates.title || sanitizedUpdates.start || sanitizedUpdates.end);

                  if (decision.confirmed && hasUserEdits) {
                    [preview, preview?.data, execHandle.payload].forEach((target) => {
                      applyUserEdits(target, sanitizedUpdates);
                    });
                  }

                  const execJson = execHandle.serialize();
                  await hubConnection.invoke('ConfirmOperation', msgId, resultType, decision.confirmed, execJson, null);
                  // Optional user feedback bubble
                  const incomingEl = await createIncomingLoadingMessage();
                  const textEl = incomingEl.querySelector('.message__text');
                  incomingEl.classList.remove('message--loading');
                  textEl.innerText = decision.confirmed ? 'Đã xác nhận thực thi.' : 'Đã hủy thao tác.';
                } catch (err) {
                  console.warn('Gửi ConfirmOperation lỗi:', err);
                }
              })
              .catch(() => {/* user dismissed */});
            break;
          }
          case 'decision-ack': {
            // Server acknowledges our confirmation/cancellation
            const msgId = root?.messageId ?? root?.MessageId ?? '?';
            const confirmed = root?.confirmed ?? root?.Confirmed ?? false;
            const serverMsg = root?.message || root?.Message || '';
            const statusText = confirmed
              ? (serverMsg || 'Máy chủ đã ghi nhận xác nhận. Đang thực thi...')
              : (serverMsg || 'Máy chủ đã ghi nhận hủy thao tác.');

            // Try to find existing placeholder (if still pending)
            let target = pendingWs.get(msgId)?.incomingEl;
            if (!target) {
              // Create a new incoming message bubble if none exists
              const wrapper = document.createElement('div');
              wrapper.className = 'message message--incoming';
              wrapper.innerHTML = `
                <div class="message__content">
                  <img class="message__avatar" src="Picture/profile.png" alt="server" />
                  <div class="message__text"></div>
                  <button class="message__icon hide" onclick="copyMessageToClipboard(this)" title="Copy" aria-label="Copy"><i class='bx bx-copy'></i></button>
                </div>`;
              chatHistoryContainer.appendChild(wrapper);
              target = wrapper;
              pendingWs.set(msgId, { incomingEl: target, statusHtml: null });
            }
            const entry = pendingWs.get(msgId) ?? { incomingEl: target, statusHtml: null };
            const sanitizedStatus = escapeHtml(statusText).replace(/\n/g, '<br>');
            entry.incomingEl = target;
            entry.statusHtml = sanitizedStatus;
            pendingWs.set(msgId, entry);

            const textEl = target.querySelector('.message__text');
            if (textEl) {
              textEl.innerHTML = `<p>${sanitizedStatus}</p>`;
            }
            scrollChatToBottom(true);
            break;
          }
          case 'processed': {
            const msgId = root?.messageId ?? root?.MessageId ?? '?';
            const payload = root?.payload ?? root?.Payload;
            const item = pendingWs.get(msgId);
            if (item?.incomingEl) {
              const el = item.incomingEl;
              const textEl = el.querySelector(".message__text");
              // Only display the message field (not entire JSON)
              const hasIsCreatedFlag = !!(payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object' && 'isCreated' in payload.data);
              let rawText = '';
              if (hasIsCreatedFlag) {
                rawText = extractMessage(payload);
              } else if (typeof payload === 'string') {
                rawText = payload;
              } else {
                try {
                  if (payload.data.results){
                    rawText = payload.data.results;
                  }
                  else{
                    rawText = JSON.stringify(payload, null, 2);
                  }
                } catch {
                  rawText = String(payload ?? '');
                }
              }
              const safeHtml = escapeHtml(rawText).replace(/\n/g, '<br>');
              const html = `<p>${safeHtml}</p>`;
              // stop loading state
              el.classList.remove("message--loading");
              // type effect + highlight + copy buttons
              showTypingEffect(rawText, html, textEl, el, false);
            }
            pendingWs.delete(msgId);
            isGeneratingResponse = false;
            break;
          }
          case 'CalendarEventReminder': {
            await handleCalendarReminderNotification(root);
            break;
          }
          default:
            // unknown type
            break;
        }
      } catch (ex) {
        console.warn('Parse notification lỗi:', ex);
      }
    });

    hubConnection.onreconnecting(() => {
      hubReady = false;
      // optional: UI indicator
    });
    hubConnection.onreconnected(() => {
      hubReady = true;
    });
    hubConnection.onclose(() => {
      hubReady = false;
    });

    await hubConnection.start();
    hubReady = true;
  } catch (err) {
    hubReady = false;
    console.warn("Không thể kết nối WS:", err?.message || err);
  }
}

const TITLE_FIELDS = ['title', 'Title', 'summary', 'Summary', 'name', 'Name', 'subject', 'Subject'];
const START_FIELDS = ['start', 'Start', 'startTime', 'StartTime', 'startsAt', 'StartsAt', 'begin', 'Begin', 'beginTime', 'BeginTime', 'startDateTime', 'StartDateTime', 'startDate', 'StartDate'];
const END_FIELDS = ['end', 'End', 'endTime', 'EndTime', 'endsAt', 'EndsAt', 'finish', 'Finish', 'finishTime', 'FinishTime', 'endDateTime', 'EndDateTime', 'endDate', 'EndDate'];
const DATE_VALUE_KEYS = ['dateTime', 'DateTime', 'value', 'Value', 'text', 'Text', 'date', 'Date'];

function setFieldIfPresent(target, fields, value, treatAsDate = false) {
  if (!target || typeof target !== 'object' || !value) return;
  fields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(target, field)) return;
    const current = target[field];
    if (current && typeof current === 'object') {
      if (treatAsDate) {
        let applied = false;
        DATE_VALUE_KEYS.forEach((prop) => {
          if (prop in current && typeof current[prop] === 'string') {
            current[prop] = value;
            applied = true;
          }
        });
        if (!applied) current.value = value;
      } else if ('value' in current && typeof current.value === 'string') {
        current.value = value;
      } else {
        target[field] = value;
      }
    } else {
      target[field] = value;
    }
  });
}

function applyUserEdits(target, updates, seen = new WeakSet()) {
  if (!target || typeof target !== 'object' || seen.has(target)) return;
  seen.add(target);

  if (updates?.title) setFieldIfPresent(target, TITLE_FIELDS, updates.title);
  if (updates?.start) setFieldIfPresent(target, START_FIELDS, updates.start, true);
  if (updates?.end) setFieldIfPresent(target, END_FIELDS, updates.end, true);

  if (Array.isArray(target)) {
    target.forEach((item) => applyUserEdits(item, updates, seen));
    return;
  }

  Object.keys(target).forEach((key) => {
    const value = target[key];
    if (!value || typeof value !== 'object') return;
    applyUserEdits(value, updates, seen);
  });
}

function normalizeExecutionPayload(preview) {
  const locations = [];
  if (preview && 'executionPayload' in preview) {
    locations.push({ parent: preview, key: 'executionPayload' });
  }
  if (preview?.data && 'executionPayload' in preview.data) {
    locations.push({ parent: preview.data, key: 'executionPayload' });
  }

  let sourceValue = null;
  for (const loc of locations) {
    const candidate = loc.parent?.[loc.key];
    if (candidate != null) {
      sourceValue = candidate;
      break;
    }
  }

  if (!sourceValue) {
    return {
      payload: null,
      serialize: () => null,
    };
  }

  let parsed = sourceValue;
  let parsedOk = typeof parsed === 'object' && parsed !== null;
  if (!parsedOk && typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
      parsedOk = true;
    } catch (err) {
      console.warn('executionPayload parse error:', err?.message || err);
    }
  }

  if (parsedOk) {
    locations.forEach(({ parent, key }) => {
      if (parent[key] === sourceValue) parent[key] = parsed;
    });
  }

  return {
    payload: parsedOk ? parsed : null,
    serialize: () => {
      if (parsedOk) {
        try {
          return JSON.stringify(parsed);
        } catch {
          return null;
        }
      }
      if (typeof sourceValue === 'string') return sourceValue;
      try {
        return JSON.stringify(sourceValue);
      } catch {
        return null;
      }
    },
  };
}

const EVENT_ID_KEYS = ['eventId', 'EventId', 'targetEventId', 'TargetEventId', 'id', 'Id'];

function buildDeleteEventCandidates(preview) {
  const list = getPreviewDataArray(preview);
  if (!list?.length) return [];
  return list.map((item, index) => {
    const eventId = extractEventIdFromItem(item);
    const title = item?.title || item?.summary || item?.name || `Sự kiện #${index + 1}`;
    const start = extractDateValue(item?.start || item?.startTime || item?.startsAt || item?.begin || item?.startDateTime);
    const end = extractDateValue(item?.end || item?.endTime || item?.endsAt || item?.finish || item?.endDateTime);
    const location = item?.location || item?.where || item?.place || '';
    return {
      index,
      eventId,
      title,
      timeRange: formatEventTimeRange(start, end),
      location,
    };
  });
}

function buildUpdateEventCandidates(preview) {
  const list = getPreviewDataArray(preview);
  if (!list?.length) return [];
  return list.map((item, index) => {
    const eventId = extractEventIdFromItem(item);
    const execPayloadRaw = item?.executionPayload || item?.ExecutionPayload;
    const execPayload = parseJsonSoft(execPayloadRaw) || {};
    const normalizedPayload = {
      EventId: execPayload.eventId || execPayload.EventId || eventId,
      NewTitle: execPayload.newTitle || execPayload.NewTitle || null,
      NewStart: execPayload.newStart || execPayload.NewStart || null,
      NewEnd: execPayload.newEnd || execPayload.NewEnd || null,
    };

    const start = extractDateValue(item?.start || item?.startTime || item?.startsAt || item?.begin || item?.startDateTime);
    const end = extractDateValue(item?.end || item?.endTime || item?.endsAt || item?.finish || item?.endDateTime);
    const warnings = Array.isArray(item?.warnings) ? item.warnings
      : Array.isArray(item?.Warnings) ? item.Warnings
      : [];

    return {
      index,
      eventId: normalizedPayload.EventId,
      title: item?.title || item?.summary || item?.name || `Sự kiện #${index + 1}`,
      timeRange: formatEventTimeRange(start, end),
      location: item?.location || item?.where || item?.place || '',
      warnings,
      payload: normalizedPayload,
    };
  }).filter((evt) => !!evt.eventId);
}

function getPreviewDataArray(preview) {
  if (!preview) return null;
  if (Array.isArray(preview)) return preview;
  if (Array.isArray(preview?.data)) return preview.data;
  return null;
}

function extractEventIdFromItem(item) {
  if (!item || typeof item !== 'object') return null;
  const direct = pickStringFromKeys(item, EVENT_ID_KEYS);
  if (direct) return direct;

  const execPayload = parseJsonSoft(item.executionPayload || item.ExecutionPayload || item.target || item.Target);
  if (execPayload) {
    const execId = pickStringFromKeys(execPayload, EVENT_ID_KEYS);
    if (execId) return execId;
  }

  if (item.targetEvent && typeof item.targetEvent === 'object') {
    const nested = pickStringFromKeys(item.targetEvent, EVENT_ID_KEYS);
    if (nested) return nested;
  }

  return null;
}

function pickStringFromKeys(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const val = normalizeEventIdValue(obj[key]);
    if (val) return val;
  }
  return null;
}

function normalizeEventIdValue(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'object') {
    if (typeof value.id === 'string') return value.id.trim() || null;
    if (typeof value.value === 'string') return value.value.trim() || null;
  }
  return null;
}

function parseJsonSoft(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function extractDateValue(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    if (typeof raw.dateTime === 'string') return raw.dateTime;
    if (typeof raw.DateTime === 'string') return raw.DateTime;
    if (typeof raw.value === 'string') return raw.value;
    if (typeof raw.Value === 'string') return raw.Value;
    if (typeof raw.date === 'string') return raw.date;
    if (typeof raw.Date === 'string') return raw.Date;
  }
  return null;
}

function formatEventTimeRange(start, end) {
  const startLabel = formatDateForDisplay(start);
  const endLabel = formatDateForDisplay(end);
  if (startLabel && endLabel) return `${startLabel} → ${endLabel}`;
  return startLabel || endLabel || 'Thời gian không xác định';
}

function formatDateForDisplay(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function isWsConnected() {
  return !!hubConnection && hubConnection.state === signalR.HubConnectionState.Connected && hubReady;
}

async function sendViaSignalR(userText) {
  // create incoming placeholder
  const incomingEl = await createIncomingLoadingMessage();
  const messageId = genMessageId();
  pendingWs.set(messageId, { incomingEl, statusHtml: null });

  try {
    await hubConnection.invoke('ProcessMessage', userText, messageId, userId);
  } catch (err) {
    // on error, convert to error UI
    const textEl = incomingEl.querySelector(".message__text");
    incomingEl.classList.remove("message--loading");
    incomingEl.classList.add("message--error");
    textEl.innerText = `Gửi WS lỗi: ${err?.message || err}`;
    pendingWs.delete(messageId);
    isGeneratingResponse = false;
    alert(`Không thể gửi tin nhắn qua WS: ${err?.message || err}`);
  }
}

// Bootstrap WS on load (if logged in)
wsConnectIfPossible();
//#endregion
 
//#region Auto-ask question on load
(function autoAskOnLoad(){
  const QUESTION_TEXT = "ngày hôm nay có lịch gì không";
  let attempts = 0;
  const maxAttempts = 5; // ~10s with 200ms interval
  const intervalMs = 200;
  let timerId = null;

  const stopTimer = () => {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  };

  const trySend = async () => {
    if (autoAskQuestionSent) {
      stopTimer();
      return;
    }
    if (autoAskAttemptInFlight) return;

    autoAskAttemptInFlight = true;
    attempts++;
    try {
      await wsConnectIfPossible();
      if (!isWsConnected()) return;

      try {
        await sendViaSignalR(QUESTION_TEXT);
        autoAskQuestionSent = true;
      } catch {}
    } finally {
      autoAskAttemptInFlight = false;
      if (autoAskQuestionSent || attempts >= maxAttempts) {
        stopTimer();
      }
    }
  };

  timerId = setInterval(trySend, intervalMs);
})();
//#endregion