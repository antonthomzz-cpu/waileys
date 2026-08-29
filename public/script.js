const MAX_MEDIA_UPLOAD = 64 * 1024 * 1024;

const MOBILE_BREAKPOINT = 768;
const MAX_INPUT_HEIGHT = 128;
const MESSAGE_STATUS = Object.freeze({
    ERROR: 0,
    PENDING: 1,
    SERVER_ACK: 2,
    DELIVERY_ACK: 3,
    READ: 4,
    PLAYED: 5
});

const state = {
    chats: [],
    searchResults: [],
    currentJid: null,
    currentMessages: [],
    selectedJid: null,
    deleteJid: null,
    replyId: null,
    connected: false,
    syncing: false,
    features: {
        markChatAsRead: false
    },
    terminal: {
        logs: [],
        zoom: 11,
        max: 500
    }
};

let socket = null;
let searchTimer = null;
let uiInitialized = false;

const sidebar = document.getElementById("sidebar");
const chatArea = document.getElementById("chatArea");
const chatList = document.getElementById("chatList");
const welcomeScreen = document.getElementById("welcomeScreen");
const activeChat = document.getElementById("activeChat");
const messages = document.getElementById("messages");
const messageContainer = document.getElementById("messageContainer");
const headerName = document.getElementById("headerName");
const headerJid = document.getElementById("headerJid");
const headerAvatar = document.getElementById("headerAvatar");
const messageInput = document.getElementById("messageInput");
const messageForm = document.getElementById("messageForm");
const replyBar = document.getElementById("replyBar");
const replyText = document.getElementById("replyText");
const cancelReplyButton = document.getElementById("cancelReply");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const syncBar = document.getElementById("syncBar");
const syncText = document.getElementById("syncText");
const syncModal = document.getElementById("syncModal");
const modalSyncText = document.getElementById("modalSyncText");
const syncProgress = document.getElementById("syncProgress");
const syncProcessed = document.getElementById("syncProcessed");
const syncTotal = document.getElementById("syncTotal");
const backButton = document.getElementById("backBtn");
const toastContainer = document.getElementById("toastContainer");

const deleteChatModal = document.getElementById("deleteChatModal");
const deleteChatName = document.getElementById("deleteChatName");
const cancelDeleteChatButton = document.getElementById("cancelDeleteChat");
const confirmDeleteChatButton = document.getElementById("confirmDeleteChat");

const searchInput = document.getElementById("searchInput");
const searchClear = document.getElementById("searchClear");
const searchShortcut = document.getElementById("searchShortcut");
const searchMeta = document.getElementById("searchMeta");
const searchResultText = document.getElementById("searchResultText");
const searchResultCount = document.getElementById("searchResultCount");

const mediaButton = document.getElementById("mediaButton");
const mediaInput = document.getElementById("mediaInput");

const terminalPreview = document.getElementById("terminalPreview");
const terminalPreviewOutput = document.getElementById("terminalPreviewOutput");
const terminalModal = document.getElementById("terminalModal");
const terminalOutput = document.getElementById("terminalOutput");
const terminalScroll = document.getElementById("terminalScroll");
const terminalClose = document.getElementById("terminalClose");
const terminalClear = document.getElementById("terminalClear");
const terminalZoomIn = document.getElementById("terminalZoomIn");
const terminalZoomOut = document.getElementById("terminalZoomOut");
const terminalZoomText = document.getElementById("terminalZoomText");
const terminalLogCount = document.getElementById("terminalLogCount");

function escapeHTML(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


function getDateFromTimestamp(timestamp) {
    if (!timestamp) {
        return null;
    }

    const date = new Date(Number(timestamp) * 1000);

    return Number.isNaN(date.getTime())
        ? null
        : date;
}


function formatTime(timestamp) {
    const date = getDateFromTimestamp(timestamp);

    if (!date) {
        return "";
    }

    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}


function formatDate(timestamp) {
    const date = getDateFromTimestamp(timestamp);

    if (!date) {
        return "";
    }

    const now = new Date();
    const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();

    if (isToday) {
        return formatTime(timestamp);
    }

    return date.toLocaleDateString([], {
        day: "2-digit",
        month: "short"
    });
}


function getInitial(name="?") {
    const value = String(name).trim();

    if (!value) {
        return "?";
    }

    return value
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
}


function avatarHTML(name, picture, size="w-11 h-11") {
    const initial = getInitial(name);

    const fallback = document.createElement("span");
    fallback.className = `${size} waton-avatar-fallback rounded-full bg-zinc-900 flex items-center justify-center text-xs font-semibold text-zinc-500`;
    fallback.textContent = initial;

    if (!picture) {
        fallback.classList.add("border", "border-white/[0.06]");
        return fallback.outerHTML;
    }

    const wrapper = document.createElement("div");
    wrapper.className = `${size} relative shrink-0`;

    const image = document.createElement("img");
    image.src = picture;
    image.className = `${size} rounded-full object-cover`;
    image.loading = "lazy";

    fallback.classList.add("hidden", "absolute", "inset-0");

    image.setAttribute(
        "onerror",
        "this.style.display='none';this.nextElementSibling.classList.remove('hidden')"
    );

    wrapper.append(image, fallback);

    return wrapper.innerHTML;
}


function previewText(chat) {
    const last = chat?.last;
    if (!last) return "";
    switch (last.type) {
        case "image":
            return "📷 Image";
        case "video":
            return "🎬 Video";
        case "audio":
            return last.isVoiceNote ? "🎤 Voice message" : "🎵 Audio";
        case "document":
            return `📄 ${last.filename || "Document"}`;
        case "sticker":
            return "Sticker";
        default:
            return last.text || "Message";
    }
}


function getMediaMeta(message) {
    switch (message.type) {
        case "image":
            return { icon: "image", title: "Image" };
        case "video":
            return { icon: "play-circle", title: "Video" };
        case "audio":
            return {
                icon: message.isVoiceNote ? "mic" : "music-2",
                title: message.isVoiceNote ? "Voice message" : "Audio"
            };
        case "document":
            return {
                icon: "file-text",
                title: message.filename || "Document"
            };
        case "sticker":
            return { icon: "sticker", title: "Sticker" };
        default:
            return { icon: "file", title: "Media" };
    }
}

let messageActionMenu = null;

function closeMessageActions() {
    messageActionMenu?.remove();
    messageActionMenu = null;
}

function openMessageActions(message) {
    closeMessageActions();

    const overlay = document.createElement("div");

    overlay.className = [
        "waton-action-overlay",
        "fixed",
        "inset-0",
        "z-[100]",
        "flex",
        "items-end",
        "justify-center",
        "bg-black/40",
        "p-3",
        "backdrop-blur-[2px]"
    ].join(" ");

    overlay.innerHTML = `
        <div class="waton-action-sheet w-full max-w-sm overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111] p-1 shadow-2xl">
            <button data-action="reply" class="waton-action-item flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-xs text-zinc-300 transition hover:bg-white/[0.05]">
                <i data-lucide="reply" class="h-4 w-4"></i>
                Reply
            </button>

            <button data-action="delete-me" class="waton-action-item flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-xs text-zinc-300 transition hover:bg-white/[0.05]">
                <i data-lucide="trash-2" class="h-4 w-4"></i>
                Hapus untuk saya
            </button>

            ${message.fromMe && !message.deletedForEveryone ? `
                <button data-action="delete-everyone" class="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-xs text-red-400 transition hover:bg-red-500/[0.06]">
                    <i data-lucide="trash" class="h-4 w-4"></i>
                    Hapus untuk semua orang
                </button>
            ` : ""}
        </div>
    `;

    overlay.addEventListener("click", event => {
        if (event.target === overlay) closeMessageActions();
    });

    overlay.querySelector("[data-action='reply']")?.addEventListener("click", () => {
        closeMessageActions();
        startReply(message);
    });

    overlay.querySelector("[data-action='delete-me']")?.addEventListener("click", () => {
        closeMessageActions();
        deleteMessage(message, false);
    });

    overlay.querySelector("[data-action='delete-everyone']")?.addEventListener("click", () => {
        closeMessageActions();
        deleteMessage(message, true);
    });

    document.body.appendChild(overlay);
    messageActionMenu = overlay;

    lucide.createIcons();
}


function getReplyPreview(message) {
    if (message.text) return message.text;

    switch (message.type) {
        case "image":
            return "Image";
        case "video":
            return "Video";
        case "audio":
            return "Audio";
        default:
            return message.filename || message.type || "Message";
    }
}


function sortChats() {
    state.chats.sort((a, b) => {
        const aTimestamp = Number(a.last?.timestamp || 0);
        const bTimestamp = Number(b.last?.timestamp || 0);

        return bTimestamp - aTimestamp;
    });
}

function scrollToBottom(smooth=false) {
    requestAnimationFrame(() => {
        messages.scrollTo({
            top: messages.scrollHeight,
            behavior: smooth ? "smooth" : "auto"
        });
    });
}

function autoResize() {
    messageInput.style.height = "auto";
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, MAX_INPUT_HEIGHT)}px`;
}

function resetState() {
    state.chats = [];

    state.currentJid = null;
    state.currentMessages = [];
    state.selectedJid = null;
    state.deleteJid = null;
    state.replyId = null;
    state.connected = false;
    state.syncing = false;

    cancelReply();
    renderChatList();

    if (searchInput) {
        searchInput.value = "";
        updateSearchUI();
    }

    updateStatus(false, false);

    headerName.textContent = "—";
    headerJid.textContent = "";
    headerAvatar.innerHTML = `<span class="text-xs font-semibold text-zinc-600">?</span>`;

    messageContainer.innerHTML = "";

    activeChat.classList.add("hidden");
    activeChat.classList.remove("flex");
    welcomeScreen.classList.remove("hidden");

    if (window.innerWidth >= MOBILE_BREAKPOINT) {
        chatArea.classList.remove("hidden");
        chatArea.classList.add("flex");
        sidebar.classList.remove("hidden");
    }
}

function openDeleteChatModal(jid) {
    jid = String(jid || "");
    if (!jid) return;

    const chat = state.chats.find((item) => item.jid === jid);
    if (!chat) return;

    state.deleteJid = jid;
    deleteChatName.textContent = chat.name || jid;

    deleteChatModal.classList.remove("hidden");
    deleteChatModal.classList.add("flex");

    lucide.createIcons();
}

function closeDeleteChatModal() {
    state.deleteJid = null;
    deleteChatModal.classList.add("hidden");
    deleteChatModal.classList.remove("flex");
}

function confirmDeleteChat() {
    if (!state.deleteJid) return;

    if (!socket?.connected) {
        showToast("Socket is not connected", "error");
        return;
    }

    socket.emit("wa:chat:delete", state.deleteJid);
}

function bindMessageSwipe(wrapper, bubble, message) {
    const MAX_SWIPE = 70;
    const THRESHOLD = 45;

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let dragging = false;
    let horizontal = false;

    wrapper.style.touchAction = "pan-y";

    const reset = () => {
        bubble.style.transition = "transform 180ms ease";
        bubble.style.transform = "";

        pointerId = null;
        currentX = 0;
        dragging = false;
        horizontal = false;
    };

    const finish = () => {
        if (!dragging) return;

        const shouldReply = message.fromMe
            ? currentX <= -THRESHOLD
            : currentX >= THRESHOLD;

        reset();

        if (!shouldReply) return;

        wrapper.dataset.swiped = "true";
        startReply(message);

        setTimeout(() => {
            delete wrapper.dataset.swiped;
        }, 300);
    };

    wrapper.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;

        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        dragging = true;

        bubble.style.transition = "none";

        try {
            wrapper.setPointerCapture(pointerId);
        } catch {}
    });

    wrapper.addEventListener("pointermove", (event) => {
        if (!dragging || event.pointerId !== pointerId) return;

        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;

        if (!horizontal) {
            if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 6) {
                reset();
                return;
            }

            if (Math.abs(deltaX) > 6) horizontal = true;
        }

        if (!horizontal) return;

        currentX = message.fromMe
            ? Math.max(-MAX_SWIPE, Math.min(0, deltaX))
            : Math.min(MAX_SWIPE, Math.max(0, deltaX));

        bubble.style.transform = `translate3d(${currentX}px, 0, 0)`;
    });

    wrapper.addEventListener("pointerup", finish);
    wrapper.addEventListener("pointercancel", reset);
}

function bindSwipeDelete(button, jid) {
    const MAX_SWIPE = 92;
    const DELETE_THRESHOLD = 55;

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let dragging = false;
    let horizontal = false;

    button.style.touchAction = "pan-y";
    button.style.userSelect = "none";
    button.style.webkitUserSelect = "none";

    const reset = () => {
        button.style.transition = "transform 180ms cubic-bezier(.22,1,.36,1)";
        button.style.transform = "";

        pointerId = null;
        startX = 0;
        startY = 0;
        currentX = 0;
        dragging = false;
        horizontal = false;
    };

    const finish = () => {
        if (!dragging) return;

        const shouldDelete = horizontal && currentX <= -DELETE_THRESHOLD;

        reset();

        if (!shouldDelete) return;

        button.dataset.swiped = "true";

        requestAnimationFrame(() => {
            openDeleteChatModal(jid);
        });

        setTimeout(() => {
            delete button.dataset.swiped;
        }, 400);
    };

    button.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;

        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        currentX = 0;
        dragging = true;
        horizontal = false;

        button.style.transition = "none";

        try {
            button.setPointerCapture(pointerId);
        } catch {}
    });

    button.addEventListener("pointermove", (event) => {
        if (!dragging || event.pointerId !== pointerId) return;

        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;

        if (!horizontal) {
            if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 5) {
                reset();
                return;
            }

            if (Math.abs(deltaX) > 5) {
                horizontal = true;
            }
        }

        if (!horizontal) return;

        if (deltaX >= 0) {
            currentX = 0;
        } else {
            currentX = Math.max(deltaX, -MAX_SWIPE);
        }

        button.style.transform = `translate3d(${currentX}px, 0, 0)`;
    });

    button.addEventListener("pointerup", (event) => {
        if (event.pointerId !== pointerId) return;

        try {
            button.releasePointerCapture(pointerId);
        } catch {}

        finish();
    });

    button.addEventListener("pointercancel", () => {
        reset();
    });

    button.addEventListener("lostpointercapture", () => {
        if (dragging) finish();
    });
}


function updateStatus(connected, syncing = false) {
    state.connected = Boolean(connected);
    state.syncing = Boolean(syncing);

    if (state.connected) {
        statusDot.className = "h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,.35)]";
        statusText.textContent = state.syncing ? "Syncing..." : "Connected";
        return;
    }

    statusDot.className = "h-1.5 w-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,.35)]";
    statusText.textContent = "Offline";
}


function renderEmptyChatList() {
    chatList.innerHTML = `
        <div id="emptyChats" class="flex h-full flex-col items-center justify-center px-8 text-center">
            <div class="mb-4 h-14 w-14 shrink-0">
                <img
                    src="/icon.png"
                    alt="WATon"
                    width="56"
                    height="56"
                    draggable="false"
                    decoding="async"
                    class="waton-logo rounded-[18px]"
                >
            </div>

            <p class="text-[12px] font-medium text-zinc-500">No conversations</p>
            <p class="mt-1 max-w-[190px] text-[10px] leading-relaxed text-zinc-700">Your recent conversations will appear here.</p>
        </div>`;

    lucide.createIcons();
}

function messageStatusHTML(m) {
    if (!m?.fromMe) return "";

    switch (m.status) {
        case "read":
        case "READ":
        case 4:
            return `<span class="inline-flex shrink-0 text-sky-400"><i data-lucide="check-check" class="h-3 w-3"></i></span>`;

        case "delivered":
        case "delivery":
        case "DELIVERY_ACK":
        case 3:
            return `<span class="inline-flex shrink-0 text-zinc-500"><i data-lucide="check-check" class="h-3 w-3"></i></span>`;

        default:
            return `<span class="inline-flex shrink-0 text-zinc-500"><i data-lucide="check" class="h-3 w-3"></i></span>`;
    }
}


function getSearchQuery() {
    return searchInput?.value.trim().toLowerCase() || "";
}

function updateSearchUI(count = null) {
    if (!searchInput) return;

    const query = getSearchQuery();
    const active = Boolean(query);

    searchClear?.classList.toggle("hidden", !active);
    searchClear?.classList.toggle("flex", active);
    searchShortcut?.classList.toggle("hidden", active);
    searchMeta?.classList.toggle("hidden", !active);
    searchMeta?.classList.toggle("flex", active);

    if (!active || count === null) return;

    searchResultCount.textContent = count;
    searchResultText.textContent = count
        ? `${count} conversation${count > 1 ? "s" : ""} found`
        : "No conversations found";
}

function clearSearch(focus = true) {
    if (!searchInput) return;

    searchInput.value = "";
    state.searchResults = [];

    updateSearchUI();
    renderChatList();

    if (focus) searchInput.focus();
}



function renderSearchResults() {
    const query = getSearchQuery();

    if (!query) {
        renderChatList();
        return;
    }

    updateSearchUI(state.searchResults.length);

    if (!state.searchResults.length) {
        chatList.innerHTML = `
            <div class="flex h-full flex-col items-center justify-center px-8 text-center">
                <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.025]">
                    <i data-lucide="user-x" class="h-5 w-5 text-zinc-700"></i>
                </div>

                <p class="text-[12px] font-medium text-zinc-500">
                    Contact not found
                </p>

                <p class="mt-1 max-w-[210px] text-[10px] leading-relaxed text-zinc-700">
                    Tidak ada kontak yang cocok dengan
                    <span class="text-zinc-500">"${escapeHTML(query)}"</span>
                </p>
            </div>
        `;

        lucide.createIcons();
        return;
    }

    chatList.innerHTML = state.searchResults.map(contact => {
        const jid = contact.jid || "";
        const name =
            contact.name ||
            contact.username ||
            jid.split("@")[0] ||
            "Unknown";

        const number = String(contact.jid || "")
            .split("@")[0];

        return `
            <button
                type="button"
                data-search-jid="${escapeHTML(jid)}"
                class="waton-chat-item group mb-1 flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-white/[0.04] active:scale-[.99]"
            >
                <div class="waton-avatar-shell flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/[0.06] bg-zinc-900">${avatarHTML(name, contact.profilePicture, "w-11 h-11")}</div>
                <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-2">
                        <h3 class="truncate text-[13px] font-medium text-zinc-300">${escapeHTML(name)}</h3>
                        ${contact.username ? `<span class="truncate font-mono text-[7px] text-zinc-700">@${escapeHTML(contact.username)}</span>` : ""}
                    </div>
                    <p class="mt-1 truncate font-mono text-[9px] text-zinc-700">${escapeHTML(number || jid)}</p>
                </div>

                <div class="h-8 w-8 shrink-0 transition duration-200 group-hover:scale-105">
                    <img
                        src="/icon.png"
                        alt="WATon"
                        width="32"
                        height="32"
                        draggable="false"
                        decoding="async"
                        class="waton-logo rounded-[10px]"
                    >
                </div>
            </button>`;
    }).join("");

    chatList.querySelectorAll("[data-search-jid]").forEach(button => {
        button.addEventListener("click", () => {
            openSearchContact(button.dataset.searchJid);
        });
    });

    lucide.createIcons();
}


function openSearchContact(jid) {
    jid = String(jid || "");
    if (!jid) return;

    const contact = state.searchResults.find(contact => {
        return contact.jid === jid;
    });

    if (!contact) return;

    const existingChat = state.chats.find(chat => {
        return chat.jid === contact.jid || chat.jid === contact.lid;
    });

    if (existingChat) {
        clearSearch(false);
        openChat(existingChat.jid);
        return;
    }

    state.currentJid = contact.jid || contact.lid;
    state.currentMessages = [];

    headerName.textContent =
        contact.name ||
        contact.username ||
        state.currentJid;

    headerJid.textContent = state.currentJid;

    headerAvatar.innerHTML = avatarHTML(
        headerName.textContent,
        contact.profilePicture,
        "w-10 h-10"
    );

    welcomeScreen.classList.add("hidden");
    activeChat.classList.remove("hidden");
    activeChat.classList.add("flex");

    messageContainer.innerHTML = "";

    requestOpenChat(state.currentJid);

    clearSearch(false);

    if (window.innerWidth < MOBILE_BREAKPOINT) {
        sidebar.classList.add("hidden");
        chatArea.classList.remove("hidden");
        chatArea.classList.add("flex");
    }

    messageInput.focus();
}


function renderChatList() {
    const chats = state.chats.filter(chat => chat?.jid);

    if (!chats.length) {
        renderEmptyChatList();
        return;
    }

    chatList.innerHTML = chats.map(chat => {
        const active = state.currentJid === chat.jid;
        const unread = Number(chat.unreadCount || 0);

        const activeClass = active
            ? "waton-chat-active bg-white/[0.07]"
            : "hover:bg-white/[0.04]";

        const nameClass = unread > 0
            ? "waton-chat-unread-name text-white"
            : "text-zinc-300";

        const previewClass = unread > 0
            ? "text-zinc-400"
            : "text-zinc-600";

        return `
            <button
                type="button"
                data-jid="${escapeHTML(chat.jid)}"
                class="waton-chat-item group relative z-10 mb-1 flex w-full select-none items-center gap-3 rounded-xl bg-[#080808] px-2 py-2 text-left transition ${activeClass}"
            >
                <div class="relative shrink-0">
                    <div class="waton-avatar-shell flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-white/[0.06] bg-zinc-900">
                        ${avatarHTML(chat.name, chat.profilePicture, "w-11 h-11")}
                    </div>

                    ${unread > 0 ? `
                        <span class="waton-unread-badge absolute -bottom-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-[#080808] bg-white px-1 text-[9px] font-bold text-black">
                            ${unread > 99 ? "99+" : unread}
                        </span>
                    ` : ""}
                </div>

                <div class="min-w-0 flex-1">
                    <h3 class="truncate text-[13px] font-medium ${nameClass}">
                        ${escapeHTML(chat.name || chat.jid)}
                    </h3>

                    <div class="mt-1 flex min-w-0 items-center gap-1">
                        ${messageStatusHTML(chat.last)}

                        <p class="min-w-0 flex-1 truncate text-[11px] ${previewClass}">
                            ${escapeHTML(previewText(chat))}
                        </p>
                    </div>
                </div>

                <span class="shrink-0 font-mono text-[9px] text-zinc-700">
                    ${formatDate(chat.last?.timestamp)}
                </span>
            </button>`;
    }).join("");

    chatList.querySelectorAll("[data-jid]").forEach(button => {
        const jid = button.dataset.jid;

        bindSwipeDelete(button, jid);

        button.addEventListener("mouseenter", () => {
            state.selectedJid = jid;
        });

        button.addEventListener("focus", () => {
            state.selectedJid = jid;
        });

        button.addEventListener("click", () => {
            if (button.dataset.swiped === "true") return;

            state.selectedJid = jid;
            openChat(jid);
        });
    });

    lucide.createIcons();
}


/* =========================================================
 * CHAT
 * ======================================================= */

function openChat(jid) {
    jid = String(jid);

    state.currentJid = jid;

    welcomeScreen.classList.add("hidden");
    activeChat.classList.remove("hidden");
    activeChat.classList.add("flex");
    chatArea.classList.remove("hidden");
    chatArea.classList.add("flex");

    const chat = state.chats.find((item) => item.jid === jid);

    if (chat) {
        headerName.textContent = chat.name || jid;
        headerAvatar.innerHTML = avatarHTML(chat.name, chat.profilePicture, "w-10 h-10");
    }

    renderChatList();
    requestOpenChat(jid);
    markChatAsRead(jid);

    if (window.innerWidth < MOBILE_BREAKPOINT) {
        sidebar.classList.add("hidden");
        chatArea.classList.remove("hidden");
        chatArea.classList.add("flex");
    }

    setTimeout(() => {
        messageInput.focus();
    }, 50);
}

function closeChat() {
    state.currentJid = null;
    state.currentMessages = [];

    activeChat.classList.add("hidden");
    activeChat.classList.remove("flex");

    if (window.innerWidth < MOBILE_BREAKPOINT) {
        chatArea.classList.add("hidden");
        chatArea.classList.remove("flex");
        sidebar.classList.remove("hidden");
    } else {
        welcomeScreen.classList.remove("hidden");
    }

    renderChatList();
}

function openMedia(url) {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
}


/* =========================================================
 * MESSAGE RENDERING
 * ======================================================= */

function getQuotedMessage(message) {
    const quoted = message?.quoted || null;

    if (quoted?.id) {
        const full = state.currentMessages.find(item => item.id === quoted.id);
        return full || quoted;
    }

    return null;
}

function getQuotedContent(message) {
    if (!message) return "Message";

    if (message.text) return message.text;

    switch (message.type) {
        case "image":
            return "📷 Image";

        case "video":
            return "🎬 Video";

        case "audio":
            return message.isVoiceNote
                ? "🎤 Voice message"
                : "🎵 Audio";

        case "document":
            return `📄 ${message.filename || "Document"}`;

        case "sticker":
            return "Sticker";

        default:
            return message.filename || "Message";
    }
}

function buildQuotedReply(message, mine) {
    const quoted = getQuotedMessage(message);
    if (!quoted?.id) return null;

    const content = getQuotedContent(quoted);
    const icon = mine ? "corner-up-left" : "corner-up-right";
    const button = document.createElement("button");

    button.type = "button";
    button.dataset.quotedId = quoted.id;

    button.className = [
        "waton-quoted-reply",
        "group/reply",
        "mb-1",
        "flex",
        "max-w-[88%]",
        "flex-col",
        "transition-all",
        "duration-200",
        "hover:opacity-80",
        mine ? "items-end" : "items-start"
    ].join(" ");

    button.innerHTML = `
        <span class="flex items-center gap-1.5 text-[11px] leading-[1.35] text-zinc-500 transition-colors duration-200 group-hover/reply:text-zinc-300 ${mine ? "flex-row" : "flex-row-reverse"}">
            <span class="max-w-[220px] truncate">
                ${escapeHTML(content)}
            </span>

            <span class="flex h-5 w-5 shrink-0 items-center justify-center">
                <i data-lucide="${icon}" class="h-3.5 w-3.5 stroke-[1.7]"></i>
            </span>
        </span>
    `;

    return button;
}

function renderMessages() {
    messageContainer.innerHTML = "";

    let previousDate = null;

    for (const message of state.currentMessages) {
        const date = getDateFromTimestamp(message.timestamp);
        const dateLabel = date ? date.toLocaleDateString() : null;

        if (message.timestamp && dateLabel && dateLabel !== previousDate) {
            renderDateSeparator(dateLabel);
            previousDate = dateLabel;
        }

        renderMessage(message);
    }

    lucide.createIcons();
}

function renderDateSeparator(date) {
    const separator = document.createElement("div");

    separator.className = "date-separator";

    separator.innerHTML = `
        <span class="waton-date-pill rounded-full border border-white/[0.05] bg-white/[0.03] px-3 py-1 font-mono text-[9px] text-zinc-700">
            ${escapeHTML(date)}
        </span>
    `;

    messageContainer.appendChild(separator);
}

function createMessageBubble(message, mine) {
    const bubble = document.createElement("div");

    const baseClass = [
        "waton-bubble",
        "group/message",
        "relative",
        "isolate",
        "w-fit",
        "min-w-[72px]",
        "max-w-[88%]",
        "overflow-visible",
        "border",
        "text-zinc-100",
        "backdrop-blur-xl",
        "transition-[border-color,box-shadow,background-color]",
        "duration-300",
        "ease-out",
        "before:pointer-events-none",
        "before:absolute",
        "before:inset-x-[1px]",
        "before:top-[1px]",
        "before:h-px",
        "before:rounded-full",
        "before:bg-gradient-to-r",
        "before:from-transparent",
        "before:via-white/[0.10]",
        "before:to-transparent"
    ];

    if (message.deletedForEveryone) {
        baseClass.push(
            "waton-bubble-deleted",
            "rounded-[18px]",
            "border-red-400/[0.12]",
            "bg-gradient-to-br",
            "from-red-500/[0.08]",
            "via-red-500/[0.045]",
            "to-black/40",
            "shadow-[0_10px_30px_-18px_rgba(239,68,68,0.35),inset_0_1px_0_rgba(255,255,255,0.035)]",
            "hover:border-red-400/[0.18]"
        );
    } else if (mine) {
        baseClass.push(
            "waton-bubble-mine",
            "rounded-[20px]",
            "rounded-br-[6px]",
            "border-white/[0.105]",
            "bg-[linear-gradient(145deg,rgba(24,29,38,0.98)_0%,rgba(17,21,28,0.98)_45%,rgba(12,15,20,0.99)_100%)]",
            "shadow-[0_12px_38px_-18px_rgba(0,0,0,0.95),0_4px_12px_-8px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.07),inset_-1px_-1px_0_rgba(255,255,255,0.018)]",
            "hover:border-white/[0.15]",
            "after:pointer-events-none",
            "after:absolute",
            "after:-bottom-[1px]",
            "after:-right-[5px]",
            "after:h-[10px]",
            "after:w-[10px]",
            "after:rounded-br-[3px]",
            "after:border-b",
            "after:border-r",
            "after:border-white/[0.08]",
            "after:bg-[#0d1117]",
            "after:[clip-path:polygon(0_0,100%_100%,0_100%)]"
        );
    } else {
        baseClass.push(
            "waton-bubble-other",
            "rounded-[20px]",
            "rounded-bl-[6px]",
            "border-white/[0.075]",
            "bg-[linear-gradient(145deg,rgba(16,16,18,0.98)_0%,rgba(12,12,14,0.99)_50%,rgba(9,9,11,1)_100%)]",
            "shadow-[0_12px_34px_-18px_rgba(0,0,0,0.95),0_3px_10px_-8px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.045)]",
            "hover:border-white/[0.12]",
            "after:pointer-events-none",
            "after:absolute",
            "after:-bottom-[1px]",
            "after:-left-[5px]",
            "after:h-[10px]",
            "after:w-[10px]",
            "after:rounded-bl-[3px]",
            "after:border-b",
            "after:border-l",
            "after:border-white/[0.055]",
            "after:bg-[#0a0a0c]",
            "after:[clip-path:polygon(100%_0,100%_100%,0_100%)]"
        );
    }

    bubble.className = baseClass.join(" ");

    return bubble;
}

function renderDeletedMessage(wrapper, bubble, message, mine) {
    bubble.innerHTML = `
        <div class="flex items-center gap-1.5 px-2 pb-1.5 pt-1.5">
            <span class="-translate-y-[1.5px] whitespace-pre-wrap break-words text-[12px] leading-[1.45] text-red-500/70 [overflow-wrap:anywhere]">${escapeHTML(message.text || "Pesan")}</span>
            ${buildMessageMeta(message)}
        </div>`;

    const deletedWrapper = document.createElement("div");
    deletedWrapper.className = ["flex", "items-center", "gap-1.5", mine ? "flex-row-reverse" : "flex-row"].join(" ");

    const trash = document.createElement("i");
    trash.setAttribute("data-lucide", "trash-2");
    trash.className = ["flex", "h-6", "w-6", "shrink-0", "items-center", "justify-center", "rounded-full", "border", "border-red-500/[0.10]", "bg-red-500/[0.06]", "p-1", "text-red-500/60"].join(" ");

    deletedWrapper.appendChild(bubble);
    deletedWrapper.appendChild(trash);

    wrapper.appendChild(deletedWrapper);
    messageContainer.appendChild(wrapper);
}

function buildMediaContent(message) {
    if (!message.hasMedia) return "";

    const { icon, title } = getMediaMeta(message);

    return `
        <button
            type="button"
            data-media-url="${escapeHTML(message.mediaUrl || "")}"
            class="
                group/media
                relative
                m-[5px]
                mb-1
                flex
                min-w-[210px]
                max-w-[320px]
                items-center
                gap-3
                overflow-hidden
                rounded-[15px]
                border
                border-white/[0.055]
                bg-black/[0.18]
                px-2.5
                py-2.5
                text-left
                shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]
                outline-none
                backdrop-blur-lg
                transition-[background-color,border-color,box-shadow]
                duration-300
                hover:border-white/[0.10]
                hover:bg-white/[0.025]
                hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_8px_24px_-18px_rgba(0,0,0,0.8)]
            "
        >
            <span class="
                pointer-events-none
                absolute
                inset-x-4
                top-0
                h-px
                bg-gradient-to-r
                from-transparent
                via-white/[0.05]
                to-transparent
            "></span>

            <div class="
                relative
                flex
                h-10
                w-10
                shrink-0
                items-center
                justify-center
                overflow-hidden
                rounded-[12px]
                border
                border-white/[0.06]
                bg-gradient-to-br
                from-white/[0.065]
                to-white/[0.015]
                text-zinc-400
                shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]
                transition-all
                duration-300
                group-hover/media:border-white/[0.10]
                group-hover/media:text-zinc-200
            ">
                <i data-lucide="${icon}" class="h-[17px] w-[17px] stroke-[1.6]"></i>
            </div>

            <div class="min-w-0 flex-1">
                <div class="truncate text-[11px] font-medium tracking-[-0.01em] text-zinc-300">${escapeHTML(title)}</div>
                <div class="mt-[3px] flex items-center gap-1 text-[9px] text-zinc-600 transition-colors duration-300 group-hover/media:text-zinc-500">
                    <span>Tap to open</span>
                    <span class="h-[2px] w-[2px] rounded-full bg-zinc-700"></span>
                    <span>${escapeHTML(message.mimetype || "Media")}</span>
                </div>
            </div>

            <div class="
                flex
                h-7
                w-7
                shrink-0
                items-center
                justify-center
                rounded-full
                border
                border-white/[0.04]
                bg-white/[0.02]
                text-zinc-600
                transition-all
                duration-300
                group-hover/media:border-white/[0.08]
                group-hover/media:bg-white/[0.04]
                group-hover/media:text-zinc-400
            ">
                <i data-lucide="chevron-right" class="h-3.5 w-3.5 stroke-[1.7]"></i>
            </div>
        </button>
    `;
}

function buildMessageStatus(message) {
    if (!message?.fromMe) return "";

    const status = Number(message.status);

    let icon = "clock-3";
    let color = "text-zinc-600/80";
    let glow = "";
    let label = "Menunggu dikirim";

    if (status === MESSAGE_STATUS.ERROR) {
        icon = "circle-alert";
        color = "text-red-400/90";
        glow = "drop-shadow-[0_0_4px_rgba(248,113,113,0.18)]";
        label = "Gagal dikirim";
    } else if (status >= MESSAGE_STATUS.READ) {
        icon = "check-check";
        color = "text-sky-400";
        glow = "drop-shadow-[0_0_4px_rgba(56,189,248,0.22)]";
        label = status >= MESSAGE_STATUS.PLAYED
            ? "Sudah diputar"
            : "Sudah dibaca";
    } else if (status >= MESSAGE_STATUS.DELIVERY_ACK) {
        icon = "check-check";
        color = "text-zinc-400/75";
        label = "Sudah diterima";
    } else if (status >= MESSAGE_STATUS.SERVER_ACK) {
        icon = "check";
        color = "text-zinc-400/75";
        label = "Sudah dikirim";
    }

    return `
        <span data-message-status title="${label}" aria-label="${label}" class="inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center ${color} ${glow}">
            <i data-lucide="${icon}" class="h-[11px] w-[11px] stroke-[1.9]"></i>
        </span>
    `;
}

function buildMessageMeta(message) {
    return `
        <span class="ml-auto inline-flex h-[14px] shrink-0 translate-y-[1px] select-none items-center justify-end gap-[3px] whitespace-nowrap">
            <span class="font-mono text-[8px] font-medium leading-none tracking-[-0.03em] text-zinc-500/70">${formatTime(message.timestamp)}
            </span>${buildMessageStatus(message)}
        </span>
    `;
}

function buildMessageTextContent(message) {
    const meta = buildMessageMeta(message);

    if (message.text) {
        return `
            <div class="relative flex items-end gap-2 px-3 pb-[7px] pt-[7px]">
                <span class="min-w-0 whitespace-pre-wrap break-words text-[12px] font-normal leading-[1.52] tracking-[-0.005em] text-zinc-200/90 [overflow-wrap:anywhere] [text-rendering:optimizeLegibility]">${escapeHTML(message.text)}</span>${meta}
            </div>`;
    }

    if (message.hasMedia) {
        return `<div class="flex items-center justify-end px-3 pb-2 pt-[1px]">${meta}</div>`;
    }

    return `
        <div class="flex items-end gap-2 px-3 py-2">
            <span class="text-[12px] leading-[1.5] text-zinc-300">${escapeHTML(message.text || "")}</span>${meta}
        </div>`;
}

function scrollToQuotedMessage(id) {
    if (!id) return;

    const target = messageContainer.querySelector(`.message-row[data-id="${CSS.escape(id)}"]`);

    if (!target) return;

    target.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

    target.classList.add(
        "rounded-xl",
        "bg-white/[0.06]",
        "transition-colors",
        "duration-500"
    );

    setTimeout(() => {
        target.classList.remove(
            "bg-white/[0.06]"
        );
    }, 900);
}

function bindMessageInteractions(wrapper, bubble, message) {
    bindMessageSwipe(wrapper, bubble, message);

    wrapper.addEventListener("click", event => {
        if (wrapper.dataset.swiped === "true") return;
        if (event.target.closest("[data-media-url], [data-quoted-id]")) return;
        openMessageActions(message);
    });

    wrapper.addEventListener("contextmenu", event => {
        event.preventDefault();
        openMessageActions(message);
    });

    wrapper.querySelectorAll("[data-media-url]").forEach(button => {
        button.addEventListener("click", event => {
            event.stopPropagation();
            openMedia(button.dataset.mediaUrl);
        });
    });

    wrapper.querySelectorAll("[data-quoted-id]").forEach(button => {
        button.addEventListener("click", event => {
            event.stopPropagation();
            scrollToQuotedMessage(button.dataset.quotedId);
        });
    });
}

function renderMessage(message) {
    if (!message?.id) return;

    const mine = Boolean(message.fromMe);
    const wrapper = document.createElement("div");
    const bubble = createMessageBubble(message, mine);
    const quoted = buildQuotedReply(message, mine);

    wrapper.className = ["message-row", "flex", "flex-col", mine ? "items-end" : "items-start"].join(" ");
    wrapper.dataset.id = message.id;

    if (quoted) {
        wrapper.appendChild(quoted);
    }

    if (message.deletedForEveryone) {
        bubble.innerHTML = `<div class="flex items-center gap-1.5 px-2 pb-1.5 pt-1.5"><span class="-translate-y-[1.5px] whitespace-pre-wrap break-words text-[12px] leading-[1.45] text-red-500/70 [overflow-wrap:anywhere]">${escapeHTML(message.text || "Pesan")}</span>${buildMessageMeta(message)}</div>`;

        const deletedWrapper = document.createElement("div");
        deletedWrapper.className = [
            "flex",
            "items-center",
            "gap-1.5",
            mine ? "flex-row-reverse" : "flex-row"
        ].join(" ");

        const trash = document.createElement("i");
        trash.setAttribute("data-lucide", "trash-2");
        trash.className = [
            "flex",
            "h-6",
            "w-6",
            "shrink-0",
            "items-center",
            "justify-center",
            "rounded-full",
            "border",
            "border-red-500/[0.10]",
            "bg-red-500/[0.06]",
            "p-1",
            "text-red-500/60"
        ].join(" ");

        deletedWrapper.appendChild(bubble);
        deletedWrapper.appendChild(trash);
        wrapper.appendChild(deletedWrapper);
    } else {
        bubble.innerHTML = [
            buildMediaContent(message),
            buildMessageTextContent(message)
        ].join("");

        wrapper.appendChild(bubble);
    }

    messageContainer.appendChild(wrapper);
    bindMessageInteractions(wrapper, bubble, message);
    lucide.createIcons();
}


/* =========================================================
 * REPLY
 * ======================================================= */

function startReply(message) {
    if (!message?.id) return;

    state.replyId = message.id;
    replyText.textContent = getReplyPreview(message);
    replyBar.classList.remove("hidden");

    messageInput.focus();
}

function cancelReply() {
    state.replyId = null;
    replyBar.classList.add("hidden");
    replyText.textContent = "";
}


/* =========================================================
 * SYNC
 * ======================================================= */

function showSyncModal() {
    syncModal.classList.remove("hidden");
    syncModal.classList.add("flex");
}

function hideSyncModal() {
    syncModal.classList.add("hidden");
    syncModal.classList.remove("flex");
    syncBar.classList.add("hidden");
}

function resetSyncProgress(total) {
    syncProcessed.textContent = "0";
    syncTotal.textContent = total;
    syncProgress.style.width = "0%";
    modalSyncText.textContent = `Loading ${total} messages...`;
}

function updateSyncProgress(data) {
    const processed = Number(data.processed || 0);
    const skipped = Number(data.skipped || 0);
    const total = Number(data.total || 0);

    syncProcessed.textContent = processed;
    syncTotal.textContent = total;
    modalSyncText.textContent = `${processed} messages processed · ${skipped} skipped`;
    syncText.textContent = `Syncing ${processed}/${total}`;

    if (total <= 0) return;

    const percent = Math.min(100, Math.round((processed / total) * 100));
    syncProgress.style.width = `${percent}%`;
}

function completeSyncProgress(data) {
    syncProcessed.textContent = data.processed || 0;
    syncTotal.textContent = data.total || 0;
    syncProgress.style.width = "100%";
    modalSyncText.textContent = "Synchronization complete.";
    syncText.textContent = "Sync complete";
}


/* =========================================================
 * TOAST
 * ======================================================= */

function showToast(message, type = "info") {
    const toast = document.createElement("div");

    const icon =
        type === "success"
            ? "check-circle"
            : type === "error"
                ? "circle-alert"
                : "info";

    const iconColor =
        type === "error"
            ? "text-red-400"
            : type === "success"
                ? "text-emerald-400"
                : "text-zinc-400";

    toast.className = [
        "waton-toast",
        "pointer-events-auto",
        "flex",
        "min-w-[220px]",
        "max-w-[320px]",
        "items-center",
        "gap-3",
        "rounded-xl",
        "border",
        "border-white/[0.08]",
        "bg-[#101010]",
        "px-4",
        "py-3",
        "shadow-2xl",
        "transition-all",
        "duration-300"
    ].join(" ");

    toast.innerHTML = `
        <div class="waton-toast-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
            <i data-lucide="${icon}" class="h-4 w-4 ${iconColor}"></i>
        </div>

        <p class="text-xs leading-relaxed text-zinc-300">
            ${escapeHTML(message)}
        </p>
    `;

    toastContainer.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
        toast.classList.add("translate-y-2", "opacity-0");

        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function setFeatureToggle(feature, enabled) {
    const toggle = document.querySelector(`.feature-toggle[data-feature="${CSS.escape(feature)}"]`);
    if (!toggle) return;

    enabled = Boolean(enabled);

    toggle.setAttribute("aria-checked", String(enabled));
    toggle.classList.toggle("active", enabled);
}

function handleFeatureToggleClick(event) {
    const toggle = event.currentTarget;

    if (!socket?.connected) {
        showToast("Socket is not connected", "error");
        return;
    }

    const feature = toggle.dataset.feature;
    const enabled = toggle.getAttribute("aria-checked") === "true";
    const nextState = !enabled;

    setFeatureToggle(feature, nextState);

    socket.emit("bot:feature", {
        feature,
        enabled: nextState
    });
}

function handleBotFeature(data = {}) {
    if (!data.feature) return;

    state.features[data.feature] = Boolean(data.enabled);
    setFeatureToggle(data.feature, data.enabled);
}

function handleBotFeatures(features = {}) {
    state.features = {
        ...state.features,
        ...features
    };

    document.querySelectorAll(".feature-toggle").forEach(toggle => {
        const feature = toggle.dataset.feature;
        if (!(feature in features)) return;

        setFeatureToggle(feature, features[feature]);
    });
}

async function handleMediaSelect(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!state.currentJid) {
        showToast("Select a conversation first", "error");
        return;
    }

    if (!state.connected) {
        showToast("WhatsApp is not connected", "error");
        return;
    }

    const type = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
            ? "video"
            : null;

    if (!type) {
        showToast("Hanya foto dan video yang didukung", "error");
        return;
    }

    if (file.size > MAX_MEDIA_UPLOAD) {
        showToast("Ukuran media terlalu besar", "error");
        return;
    }

    try {
        mediaButton.disabled = true;

        socket.emit("wa:media", {
            jid: state.currentJid,
            type,
            data: await file.arrayBuffer(),
            mimetype: file.type,
            filename: file.name,
            caption: messageInput.value.trim(),
            replyId: state.replyId
        }, response => {
            mediaButton.disabled = false;

            if (!response?.success) {
                showToast(response?.message || "Gagal mengirim media", "error");
                return;
            }

            messageInput.value = "";
            autoResize();
            cancelReply();
            messageInput.blur();
        });
    } catch (error) {
        mediaButton.disabled = false;
        showToast(error.message, "error");
    }
}

/* =========================================================
 * DOM EVENTS
 * ======================================================= */

function handleMessageSubmit(event) {
    event.preventDefault();

    const text = messageInput.value.trim();
    if (!text) return;

    if (!state.currentJid) {
        showToast("Select a conversation first", "error");
        return;
    }

    if (!state.connected) {
        showToast("WhatsApp is not connected", "error");
        return;
    }

    sendChatMessage({
        jid: state.currentJid,
        text,
        replyId: state.replyId
    }, response => {
        if (!response?.success) {
            showToast(response?.message || "Gagal mengirim pesan", "error");
            return;
        }

        messageInput.value = "";
        autoResize();
        cancelReply();

        messageInput.blur();
    });
}

function handleMessageKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey) {
        return;
    }

    event.preventDefault();
    messageForm.requestSubmit();
}

function handleDocumentKeyDown(event) {
    if (event.key === "Escape") {
        if (!terminalModal.classList.contains("hidden")) {
            terminalModal.classList.add("hidden");
            terminalModal.classList.remove("flex");
        }

        if (!deleteChatModal.classList.contains("hidden")) {
            closeDeleteChatModal();
            return;
        }
        renderChatList();
        return;
    }

    if (event.key !== "Delete") return;

    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;

    const focusedChat = document.activeElement?.closest?.("[data-jid]");
    const jid = focusedChat?.dataset?.jid || state.selectedJid || state.currentJid;

    if (!jid) return;

    event.preventDefault();
    openDeleteChatModal(jid);
}

function handleWindowResize() {
    if (window.innerWidth < MOBILE_BREAKPOINT) return;

    sidebar.classList.remove("hidden");
    chatArea.classList.remove("hidden");
    chatArea.classList.add("flex");

    if (state.currentJid) {
        activeChat.classList.remove("hidden");
        activeChat.classList.add("flex");
        welcomeScreen.classList.add("hidden");
        return;
    }

    activeChat.classList.add("hidden");
    activeChat.classList.remove("flex");
    welcomeScreen.classList.remove("hidden");
}

function handleWhatsAppAuthRequest(event) {
    const data = event.detail || {};
    requestWhatsAppAuth({
        method: data.method,
        phone: data.phone
    });
}

function terminalColor(level) {
    switch (level) {
        case "fatal":
            return "text-red-400";
        case "error":
            return "text-red-400/80";
        case "warn":
            return "text-amber-400/80";
        case "success":
            return "text-emerald-400/80";
        case "debug":
            return "text-sky-400/70";
        default:
            return "text-zinc-500";
    }
}

function addTerminalLog(data = {}) {
    const log = {
        time: data.time || new Date().toLocaleTimeString("en-GB"),
        level: String(data.level || "info").toLowerCase(),
        message: String(data.message || "")
    };

    state.terminal.logs.push(log);

    if (state.terminal.logs.length > state.terminal.max) {
        state.terminal.logs.shift();
    }

    const line = document.createElement("div");
    line.className = "flex min-w-0 gap-3";

    line.innerHTML = `
        <span class="shrink-0 text-zinc-800">${escapeHTML(log.time)}</span>
        <span class="w-[48px] shrink-0 uppercase ${terminalColor(log.level)}">${escapeHTML(log.level)}</span>
        <span class="whitespace-pre-wrap break-all text-zinc-500">${escapeHTML(log.message)}</span>
    `;

    terminalOutput.appendChild(line);

    while (terminalOutput.children.length > state.terminal.max) {
        terminalOutput.firstElementChild?.remove();
    }

    const preview = line.cloneNode(true);
    terminalPreviewOutput.appendChild(preview);

    while (terminalPreviewOutput.children.length > 5) {
        terminalPreviewOutput.firstElementChild?.remove();
    }

    terminalLogCount.textContent = `${state.terminal.logs.length} logs`;

    if (!terminalModal.classList.contains("hidden")) {
        terminalScroll.scrollTop = terminalScroll.scrollHeight;
    }
}

function setTerminalZoom(value) {
    state.terminal.zoom = Math.min(22, Math.max(7, value));
    terminalOutput.style.fontSize = `${state.terminal.zoom}px`;
    terminalZoomText.textContent = `${Math.round(state.terminal.zoom / 11 * 73)}%`;
}

function bindDomEvents() {
    cancelReplyButton.addEventListener("click", cancelReply);
    messageForm.addEventListener("submit", handleMessageSubmit);
    messageInput.addEventListener("keydown", handleMessageKeyDown);
    messageInput.addEventListener("input", autoResize);
    backButton.addEventListener("click", closeChat);
    document.addEventListener("keydown", handleDocumentKeyDown);
    window.addEventListener("resize", handleWindowResize);
    window.addEventListener("waton:wa-auth-start", handleWhatsAppAuthRequest);

    terminalPreview?.addEventListener("click", () => {
        terminalModal.classList.remove("hidden");
        terminalModal.classList.add("flex");

        requestAnimationFrame(() => {
            terminalScroll.scrollTop = terminalScroll.scrollHeight;
        });
    });

    terminalClose?.addEventListener("click", () => {
        terminalModal.classList.add("hidden");
        terminalModal.classList.remove("flex");
    });

    terminalClear?.addEventListener("click", () => {
        state.terminal.logs.length = 0;
        terminalOutput.replaceChildren();
        terminalPreviewOutput.replaceChildren();
        terminalLogCount.textContent = "0 logs";
    });

    terminalZoomIn?.addEventListener("click", () => {
        setTerminalZoom(state.terminal.zoom + 1);
    });

    terminalZoomOut?.addEventListener("click", () => {
        setTerminalZoom(state.terminal.zoom - 1);
    });

    terminalScroll?.addEventListener("wheel", event => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        setTerminalZoom(state.terminal.zoom + (event.deltaY < 0 ? 1 : -1));
    }, { passive: false });

    document.querySelectorAll(".feature-toggle").forEach((toggle) => {
        toggle.addEventListener(
            "click",
            handleFeatureToggleClick
        );
    });

    cancelDeleteChatButton.addEventListener("click", closeDeleteChatModal);
    confirmDeleteChatButton.addEventListener("click", confirmDeleteChat);

    deleteChatModal.addEventListener("click", (event) => {
        if (event.target === deleteChatModal) {
            closeDeleteChatModal();
        }
    });

    searchInput?.addEventListener("input", searchContacts);
    searchClear?.addEventListener("click", () => clearSearch());
    mediaButton.addEventListener("click", () => {
        if (!state.currentJid) {
            showToast("Select a conversation first", "error");
            return;
        }

        mediaInput.click();
    });

    mediaInput.addEventListener("change", handleMediaSelect);
}

function handleChatDeleted(data) {
    const jid = String(data?.jid || "");
    if (!jid) return;

    state.chats = state.chats.filter((chat) => chat.jid !== jid);

    if (state.selectedJid === jid) state.selectedJid = null;

    if (state.currentJid === jid) {
        state.currentJid = null;
        state.currentMessages = [];

        messageContainer.innerHTML = "";

        activeChat.classList.add("hidden");
        activeChat.classList.remove("flex");

        if (window.innerWidth < MOBILE_BREAKPOINT) {
            chatArea.classList.add("hidden");
            chatArea.classList.remove("flex");
            sidebar.classList.remove("hidden");
        } else {
            welcomeScreen.classList.remove("hidden");
        }
    }

    closeDeleteChatModal();
    renderChatList();

    showToast("Chat berhasil dihapus", "success");
}

function handleSocketConnect() {
    console.log(`[WEB]: socket connected ${socket.id}`);
    requestSync();
}

function handleSocketConnectError(error) {
    console.log(`[WEB]: socket connection error: ${error.message}`);
    updateStatus(false, false);
}

function handleChatOpen(data) {
    if (!data) return;

    state.currentJid = data.jid;

    state.currentMessages = Array.isArray(data.messages)
        ? data.messages
        : [];

    headerName.textContent = data.name || data.jid;
    headerAvatar.innerHTML = avatarHTML(data.name, data.profilePicture, "w-10 h-10");

    renderMessages();
    scrollToBottom();
}

function handleMessageUpdate(data) {
    const update = data?.message;

    if (!update?.id) return;

    const messageIndex =
        state.currentMessages.findIndex(
            message => message.id === update.id
        );

    if (messageIndex !== -1) {
        const original =
            state.currentMessages[messageIndex];

        state.currentMessages[messageIndex] = {
            ...original,
            ...update
        };

        const distanceFromBottom =
            messages.scrollHeight -
            messages.scrollTop -
            messages.clientHeight;

        renderMessages();

        if (distanceFromBottom < 80) {
            scrollToBottom();
        }
    }

    const chatIndex = state.chats.findIndex(
        chat =>
            chat.jid === data.jid ||
            chat.last?.id === update.id
    );

    if (chatIndex === -1) return;

    const chat = state.chats[chatIndex];

    if (chat.last?.id === update.id) {
        chat.last = {
            ...chat.last,
            ...update
        };

        state.chats[chatIndex] = chat;

        sortChats();
        renderChatList();
    }
}

function handleIncomingMessage(data) {
    if (!data?.message) return;

    const message = data.message;
    const jid = message.jid || data.chat?.jid;

    if (jid === state.currentJid) {
        if (!message.fromMe) {
            markChatAsRead(jid);
        }

        const exists = state.currentMessages.some((item) => item.id === message.id);

        if (!exists) {
            state.currentMessages.push(message);
            renderMessage(message);
            scrollToBottom(true);
        }
    }

    if (!data.chat) return;

    const index = state.chats.findIndex((chat) => chat.jid === data.chat.jid);
    const updatedChat = {
        ...data.chat,
        last: message
    };

    if (index !== -1) {
        state.chats[index] = {
            ...state.chats[index],
            ...updatedChat
        };
    } else {
        state.chats.push(updatedChat);
    }

    sortChats();
    renderChatList();
}

function handleChatList(data) {
    if (!Array.isArray(data)) return;

    const validChats = data.filter((item) => item?.jid);
    const chatMap = new Map(state.chats.map((chat) => [chat.jid, chat]));

    for (const chat of validChats) {
        if (!chat.last && chat.count === undefined) continue;
        chatMap.set(chat.jid, {
            ...chatMap.get(chat.jid),
            ...chat
        });
    }

    state.chats = [...chatMap.values()].filter((chat) => {
        return (chat.last || Number(chat.count) > 0);
    });

    sortChats();
    renderChatList();
}

function handleChatUpdate(chat) {
    if (!chat?.jid) return;

    const index = state.chats.findIndex((item) => item.jid === chat.jid);
    if (index !== -1) {
        state.chats[index] = {
            ...state.chats[index],
            ...chat
        };
    } else {
        state.chats.push(chat);
    }

    if (chat.jid === state.currentJid) {
        headerName.textContent = chat.name || chat.jid;
        headerAvatar.innerHTML = avatarHTML(chat.name, chat.profilePicture, "w-10 h-10");
    }

    sortChats();
    renderChatList();
}

function handleSync(data) {
    if (!data) return;
    if (Array.isArray(data.chats)) {
        state.chats = data.chats;
        sortChats();
        renderChatList();
    }
    updateStatus(Boolean(data.ready), state.syncing);
}

function handleStatus(data) {
    const connected = Boolean(data?.connected);
    const syncing = Boolean(data?.syncing);

    updateStatus(connected, syncing);

    window.WATON_UI?.setWhatsAppStatus({
        connected,
        syncing
    });
}


function searchContacts() {
    const query = getSearchQuery();

    clearTimeout(searchTimer);

    if (!query) {
        state.searchResults = [];
        updateSearchUI();
        renderChatList();
        return;
    }

    searchTimer = setTimeout(() => {
        if (!socket?.connected) return;

        socket.emit("wa:contact:search", query, results => {
            if (query !== getSearchQuery()) return;

            state.searchResults = Array.isArray(results)
                ? results
                : [];

            renderSearchResults();
        });
    }, 180);
}

function handleSyncStart() {
    state.syncing = true;
    updateStatus(state.connected, true);
    syncBar.classList.remove("hidden");
    showSyncModal();
}

function handleSyncProgress(data) {
    if (!data) return;

    switch (data.type) {
        case "wa:sync:start": {
            const total = Number(data.total || 0);
            showSyncModal();
            resetSyncProgress(total);
            break;
        }

        case "wa:sync:progress":
            updateSyncProgress(data);
            break;

        case "wa:sync:complete":
            completeSyncProgress(data);
            break;
    }
}

function handleSyncComplete(data) {
    state.syncing = false;
    updateStatus(state.connected, false);

    setTimeout(() => {
        hideSyncModal();
    }, 700);

    if (data) {
        showToast(`Synced ${data.messages || 0} messages`, "success");
    }
}

function handlePairingCode(data) {
    const code = data?.body ?? data?.code ?? data;
    if (!code) return;

    window.WATON_UI?.setPairingCode(String(code));
    showToast("Pairing code generated", "success");
}

function handleQrCode(data) {
    const qr = data?.body ?? data?.qr ?? data;
    if (!qr) return;
    window.WATON_UI?.setQrCode(String(qr));
    showToast("QR code generated", "success");
}

function handleSocketError(message) {
    const text = typeof message === "string"
        ? message
        : message?.message || "Unknown error";

    showToast(text, "error");

    if (!state.connected) {
        window.WATON_UI?.setPairingMessage(text);
    }
}

function handleSocketDisconnect(reason) {
    updateStatus(false, false);
    window.WATON_UI?.setWhatsAppStatus({
        connected: false,
        syncing: false
    });
}

function handleMessageDeleted(data) {
    if (!data?.id || data.jid !== state.currentJid) return;

    state.currentMessages = state.currentMessages.filter(
        message => message.id !== data.id
    );

    if (state.replyId === data.id) {
        cancelReply();
    }

    renderMessages();
}

function formatLastSeen(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return null;

    const date = new Date(value * 1000);
    if (Number.isNaN(date.getTime())) return null;

    const now = new Date();

    const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();

    if (isToday) {
        return `terakhir dilihat hari ini ${date.toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit"
        })}`;
    }

    return `terakhir dilihat ${date.toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
    })}`;
}

function handlePresence(data) {
    if (!data?.jid || !state.currentJid) return;
    if (String(data.jid) !== String(state.currentJid)) return;

    switch (data.presence) {
        case "composing":
            headerJid.textContent = "mengetik...";
            return;

        case "recording":
            headerJid.textContent = "merekam suara...";
            return;

        case "available":
            headerJid.textContent = "online";
            return;

        case "unavailable": {
            const lastSeen = formatLastSeen(data.lastSeen);
            headerJid.textContent = lastSeen || data.jid;
            return;
        }

        default:
            break;
    }

    if (data.online) {
        headerJid.textContent = "online";
        return;
    }

    const lastSeen = formatLastSeen(data.lastSeen);
    headerJid.textContent = lastSeen || data.jid;
}


// START SOCKET EMIT HELPERS
function requestOpenChat(jid) {
    if (!socket?.connected) return;
    socket.emit("wa:open", jid);
}

function markChatAsRead(jid) {
    if (state.features.ghost_mode) return;
    socket.emit("wa:chat:read", jid);
}

function sendChatMessage(data, callback) {
    if (!socket?.connected) {
        showToast("Socket is not connected", "error");
        return;
    }

    socket.emit("wa:chat", data, callback);
}

function requestSync() {
    if (!socket?.connected) return;
    socket.emit("wa:sync");
}

function requestWhatsAppAuth(data={}) {
    const method = String(data.method || "");
    const phone = String(data.phone || "").replace(/\D/g, "");

    if (!["qr", "code", "pairing"].includes(method)) {
        window.WATON_UI?.setPairingMessage("Metode pairing tidak valid");
        return;
    }

    if (method !== "qr" && !phone) {
        window.WATON_UI?.setPairingMessage("Nomor WhatsApp diperlukan");
        return;
    }

    const send = () => {
        socket.emit("wa:auth:start", {
            method,
            phone
        });
    };

    if (socket?.connected) {
        send();
        return;
    }

    startWatonApp();

    if (!socket) {
        window.WATON_UI?.setPairingMessage("Socket belum tersedia");
        return;
    }

    socket.once("connect", send);
}

function deleteMessage(message, forEveryone=false) {
    if (!socket?.connected || !state.currentJid || !message?.id) return;
    socket.emit("wa:message:delete", {
        jid: state.currentJid,
        id: message.id,
        key: message.key,
        forEveryone
    });
}
// END SOCKET EMIT HELPERS


// START SOCKET REGISTRATION
function bindSocketEvents() {
    if (!socket) return;

    socket.on("connect", handleSocketConnect);
    socket.on("connect_error", handleSocketConnectError);

    socket.on("wa:status", handleStatus);

    socket.on("wa:chat:open", handleChatOpen);
    socket.on("wa:chat:list", handleChatList);
    socket.on("wa:chat:update", handleChatUpdate);

    socket.on("wa:message:update", handleMessageUpdate);
    socket.on("wa:message", handleIncomingMessage);

    socket.on("wa:sync", handleSync);
    socket.on("wa:sync:start", handleSyncStart);
    socket.on("wa:sync:progress", handleSyncProgress);
    socket.on("wa:sync:complete", handleSyncComplete);

    socket.on("wa:auth:code", handlePairingCode);
    socket.on("wa:auth:qr", handleQrCode);

    socket.on("bot:feature", handleBotFeature);
    socket.on("bot:features", handleBotFeatures);

    socket.on("wa:error", handleSocketError);
    socket.on("disconnect", handleSocketDisconnect);
    socket.on("wa:chat:deleted", handleChatDeleted);
    socket.on("wa:message:deleted", handleMessageDeleted);

    socket.on("wa:presence", handlePresence);
    socket.on("wa:log", addTerminalLog);
}
// END SOCKET REGISTRATION

// START APP LIFECYCLE
async function registerPWA() {
    if (!("serviceWorker" in navigator)) return;

    try {
        await navigator.serviceWorker.register("/service-worker.js", {
            scope: "/"
        });

        console.log("[PWA]: service worker registered");
    } catch (error) {
        console.error("[PWA]:", error);
    }
}

function initializePWA() {
    registerPWA();

    window.addEventListener("appinstalled", () => {
        console.log("[PWA]: WATon installed");
        showToast("WATon berhasil dipasang", "success");
    });
}

function initializeUI() {
    if (uiInitialized) return;

    uiInitialized = true;

    AOS.init({
        duration: 500,
        once: true,
        offset: 10
    });

    bindDomEvents();

    window.openChat = openChat;

    renderChatList();
    lucide.createIcons();
}

function startWatonApp() {
    initializeUI();

    if (socket) {
        if (!socket.connected) socket.connect();
        return socket;
    }

    socket = io({
        autoConnect: false,
        withCredentials: true,
        transports: ["websocket", "polling"]
    });

    bindSocketEvents();
    socket.connect();

    return socket;
}

function stopWatonApp() {
    if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
    }

    resetState();

    document.querySelectorAll(".feature-toggle").forEach((toggle) => {
        toggle.setAttribute("aria-checked", "false");
        toggle.classList.remove("active");
    });
}

async function restoreAuthenticatedSocket() {
    try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        if (!response.ok) return;
        const data = await response.json();
        if (data.authenticated) startWatonApp();
    } catch (error) {
        showToast(error.message, "error");
    }
}

function initialize() {
    initializeUI();
    initializePWA();

    window.startWatonApp = startWatonApp;
    window.stopWatonApp = stopWatonApp;

    restoreAuthenticatedSocket();
}

initialize();