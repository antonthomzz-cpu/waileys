import "./src/config/module.js";

import Fuse from "fuse.js";
import cookieParser from "cookie-parser";

import { api_register } from "./api/auth/register.js";
import { api_login } from "./api/auth/login.js";
import { api_logout } from "./api/auth/logout.js";
import { api_me } from "./api/auth/me.js";
import { api_media } from "./api/media/index.js";

import { create_login_token } from "./src/utils/login_crypto.js";

const MAX_MEDIA_UPLOAD = 64 * 1024 * 1024;

app.use(cookieParser());

app.get("/api/auth/login/bootstrap", (req, res) => {
    const publicKey = create_login_token(res);
    res.set("Cache-Control", "no-store");
    return res.json({success:true,publicKey});
});

app.post("/api/auth/register", async (req, res) => await api_register(req, res));
app.post("/api/auth/login", api_login);
app.post("/api/auth/logout", require_auth, (req, res) => api_logout(req, res));
app.get("/api/auth/me", (req, res) => api_me(req, res));
app.get("/api/media/:userId/:id", require_auth, (req, res) => api_media(req, res));


// START MESSAGE_HELPERS
function prepare_message(m) {
    if (!m?.key) return m;

    m.id = m.key?.id;
    m.chat = m.key?.remoteJid;
    m.fromMe = m.key?.fromMe;
    m.body = m_text(m);
    m.type = m_type(m, false);
    m.type_key = m_type(m, true);

    return m;
}

function get_contact_identity(ses, remoteJid) {
    const source = normalize_jid(remoteJid);

    if (!source) return null;

    const contact = get_contact(ses, source);
    const jid = normalize_jid(contact?.jid);
    const lid = normalize_jid(contact?.lid);

    if (!contact || !jid || !jid.endsWith("@s.whatsapp.net")) {
        return null;
    }

    return { source, jid, lid, contact };
}

function build_quoted_content(m) {
    switch (m.type) {
        case "image":
            return {
                imageMessage: {
                    caption: m.text || "",
                    mimetype: m.mimetype || "image/jpeg"
                }
            };

        case "video":
            return {
                videoMessage: {
                    caption: m.text || "",
                    mimetype: m.mimetype || "video/mp4"
                }
            };

        case "audio":
            return {
                audioMessage: {
                    mimetype: m.mimetype || "audio/ogg",
                    ptt: Boolean(m.isVoiceNote)
                }
            };

        case "document":
            return {
                documentMessage: {
                    caption: m.text || "",
                    fileName: m.filename || "document",
                    mimetype: m.mimetype || "application/octet-stream"
                }
            };

        case "sticker":
            return {
                stickerMessage: {
                    mimetype: m.mimetype || "image/webp"
                }
            };

        default:
            return {
                conversation: m?.text || "Message"
            };
    }
}

function build_quoted_message(target, jid) {
    if (!target?.id) return null;

    const remoteJid = normalize_jid(target.key?.remoteJid || target.jid || jid);

    const key = {
        remoteJid: remoteJid || jid,
        fromMe: Boolean(target.fromMe),
        id: target.id
    };

    const participant = normalize_jid(target.key?.participant);
    if (participant) {
        key.participant = participant;
    }

    return {
        key,
        message: build_quoted_content(target),
        pushName:
            target.from &&
            target.from !== "Me"
                ? target.from
                : undefined
    };
}

function delete_message_media(ses, message) {
    if (!message?.id || !message.hasMedia) return;

    ses.media?.delete(message.id);

    try {
        const file = path.join(get_media_dir(ses), encodeURIComponent(message.id));

        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
        }
    } catch (error) {
        __log(get_user_id(ses), `[ERROR]: delete_message_media() | msg=${error.message}`);
    }
}

function ensure_chat(ses, input) {
    const identity = get_contact_identity(ses, input);

    if (!identity) return null;

    const { jid, lid, contact } = identity;

    const aliases = new Set([jid, lid].filter(Boolean));
    const database = read_chat_db(ses);

    const matches = database
        .chats
        .filter(chat => aliases.has(normalize_jid(chat?.jid)));

    let chat =
        matches.find(chat => normalize_jid(chat?.jid) === jid) ||
        matches[0] ||
        null;

    if (matches.length > 1) {
        const messages = new Map();

        for (const item of matches) {
            for (const message of item.messages || []) {
                if (!message?.id) continue;

                messages.set(message.id, {
                    ...messages.get(message.id),
                    ...message,
                    jid
                });
            }
        }

        chat.messages = [...messages.values()].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
        chat.unreadCount = Math.max(...matches.map(item => Number(item.unreadCount || 0)));
        database.chats = database.chats.filter(item => !matches.includes(item) || item === chat);
    }

    if (!chat) {
        chat = {
            jid,
            name: contact.name || contact.username || jid.split("@")[0],
            profilePicture: contact.profilePicture || null,
            unreadCount: 0,
            archived: false,
            pinned: false,
            messages: []
        };

        database.chats.push(chat);
    }

    chat.jid = jid;

    if (contact.name || contact.username) {
        chat.name = contact.name || contact.username;
    }

    if (contact.profilePicture) {
        chat.profilePicture = contact.profilePicture;
    }

    const index = database.chats.indexOf(chat);

    database.chats[index] = chat;

    write_chat_db(ses, database);

    return {
        database,
        chat,
        index,
        jid,
        lid,
        contact
    };
}
// END MESSAGE_HELPERS


// START SOCKET.IO
io.on("connection", socket => {
    const userId = socket.request.session?.userId;

    if (!userId) {
        console.log(`\x1b[90m[WEB]:\x1b[0m Rejected ${socket.id} - unauthenticated`);
        socket.disconnect(true);
        return;
    }

    socket.data.userId = String(userId);

    const ses = get_session(socket.data.userId);

    if (!(ses.media instanceof Map)) ses.media = new Map();
    if (!(ses.typingTimers instanceof Map)) ses.typingTimers = new Map();

    read_chat_db(ses);
    read_contact_db(ses);
    read_feature_db(ses);

    socket.join(user_room(socket.data.userId));

    console.log(`[WEB_CONNECTED]: socket=${socket.id} | user=${socket.data.userId}`);

    socket.emit("bot:features", read_feature_db(ses));
    socket.emit(SOCKET.WA_STATUS, {
        connected: ses.ready,
        syncing: ses.syncing
    });

    emit_user_sync(socket.data.userId, ses);

    socket.emit(SOCKET.WA_CHAT_LIST, get_chat_list(ses));


    // START SOCKET_AUTH
    socket.on("wa:auth:start", async (data={}) => {
        try {
            if (ses.ready) {
                socket.emit(SOCKET.WA_STATUS, {
                    connected: true,
                    syncing: ses.syncing
                });

                return;
            }

            const method = String(data.method || "");
            const phone = String(data.phone || "").replace(/\D/g, "");

            if (!["qr", "code", "pairing"].includes(method)) {
                socket.emit(SOCKET.WA_ERROR, "Metode pairing tidak valid");
                return;
            }

            if ((method === "code" || method === "pairing") && !phone) {
                socket.emit(SOCKET.WA_ERROR, "Nomor WhatsApp diperlukan");
                return;
            }

            await waton_start({
                userId: socket.data.userId,
                phone,
                method
            });
        } catch (error) {
            console.log(`\x1b[31m[AUTH_START_ERROR][${socket.data.userId}]:\x1b[0m ${error.message}`);
            socket.emit(SOCKET.WA_ERROR, error.message || "Gagal memulai WhatsApp");
        }
    });
    // END SOCKET_AUTH


    // START SYNCING
    socket.on(SOCKET.WA_SYNC, () => {
        emit_user_sync(socket.data.userId, ses);
        socket.emit(SOCKET.WA_CHAT_LIST, get_chat_list(ses));
    });
    // END SYNCING


    // START OPEN_CHAT
    socket.on(SOCKET.WA_OPEN, async input => {
        try {
            if (!ses.sock || !ses.ready) {
                socket.emit(SOCKET.WA_ERROR, "WhatsApp belum terhubung");
                return;
            }

            const result = ensure_chat(ses, input);

            if (!result) {
                socket.emit(SOCKET.WA_ERROR, "Kontak tidak ditemukan");
                return;
            }

            const { database, chat, index, jid } = result;

            chat.unreadCount=0;
            database.chats[index]=chat;

            write_chat_db(ses, database);

            await ses.sock
                .presenceSubscribe(jid)
                .catch(() => {});

            socket.emit(SOCKET.WA_CHAT_OPEN, {
                jid,
                name: chat.name || jid,
                profilePicture: chat.profilePicture || null,
                messages: Array.isArray(chat.messages)
                    ? chat.messages.map(public_message)
                    : []
            });

            emit_user(socket.data.userId, SOCKET.WA_CHAT_LIST, get_chat_list(ses));
        } catch (error) {
            __log(socket.data.userId, "fatal", `[CHAT_OPEN_ERROR]: ${error.message}`);
            socket.emit(SOCKET.WA_ERROR, error.message || "Gagal membuka chat");
        }
    });
    // END OPEN_CHAT


    // START SEND_MESSAGE_TEXT
    socket.on(SOCKET.WA_CHAT, async (data={}, callback) => {
        try {
            if (!ses.sock || !ses.ready) {
                socket.emit(SOCKET.WA_ERROR, "WhatsApp belum terhubung");
                return;
            }

            const text = String(data.text || "").trim();
            if (!text) return;

            const result = ensure_chat(ses, data.jid);
            if (!result) {
                socket.emit(SOCKET.WA_ERROR, "Kontak tidak ditemukan");
                return;
            }

            const { chat, jid } = result;

            let quoted = null;

            if (data.replyId) {
                const target = chat.messages?.find(message => message?.id === data.replyId);

                if (!target) {
                    socket.emit(SOCKET.WA_ERROR, "Pesan reply tidak ditemukan");
                    return;
                }

                quoted = build_quoted_message(target, jid);
            }

            const sent = await ses.sock.sendMessage(jid, { text }, quoted ? { quoted } : undefined);

            if (sent?.key) {
                prepare_message(sent);

                await save_message(ses, sent);

                callback?.({
                    success: true
                });
            }
        } catch (error) {
            __log(socket.data.userId, "fatal", `[SEND_ERROR]: ${error.message}`);

            callback?.({
                success: false,
                message: error.message
            });

            socket.emit(SOCKET.WA_ERROR, error.message || "Gagal mengirim pesan");
        }
    });
    // END SEND_MESSAGE_TEXT


    // START SEND_MESSAGE_MEDIA
    socket.on("wa:media", async (data={}, callback=()=>{}) => {
        try {
            if (!ses.sock || !ses.ready) {
                return callback({
                    success: false,
                    message: "WhatsApp belum terhubung"
                });
            }

            const result = ensure_chat(ses, data.jid);

            if (!result) {
                return callback({
                    success: false,
                    message: "Kontak tidak ditemukan"
                });
            }

            const { chat, jid } = result;
            const type = String(data.type || "");

            if (!["image", "video"].includes(type)) {
                return callback({
                    success: false,
                    message: "Tipe media tidak didukung"
                });
            }

            const buffer = Buffer.isBuffer(data.data)
                ? data.data
                : Buffer.from(data.data || []);

            if (!buffer.length) {
                return callback({
                    success: false,
                    message: "Media kosong"
                });
            }

            if (buffer.length > MAX_MEDIA_UPLOAD) {
                return callback({
                    success: false,
                    message: "Ukuran media terlalu besar"
                });
            }

            const mimetype = String(data.mimetype || "");

            if (type === "image" && !mimetype.startsWith("image/")) {
                return callback({
                    success: false,
                    message: "Format gambar tidak valid"
                });
            }

            if (type === "video" && !mimetype.startsWith("video/")) {
                return callback({
                    success: false,
                    message: "Format video tidak valid"
                });
            }

            let quoted = null;

            if (data.replyId) {
                const target = chat.messages?.find(message => message?.id === data.replyId);

                if (!target) {
                    return callback({
                        success: false,
                        message: "Pesan reply tidak ditemukan"
                    });
                }

                quoted = build_quoted_message(target, jid);
            }

            const caption = String(data.caption || "").trim();
            const content = type === "image"
                ? {
                    image: buffer,
                    caption,
                    mimetype: mimetype || "image/jpeg"
                } : {
                    video: buffer,
                    caption,
                    mimetype: mimetype || "video/mp4"
                };

            const sent = await ses.sock.sendMessage(jid, content, quoted ? { quoted } : undefined);

            if (!sent?.key?.id) {
                throw new Error("WhatsApp tidak mengembalikan ID pesan");
            }

            const id = sent.key.id;
            const filename = String(data.filename || (type === "image" ? `image-${id}.jpg` : `video-${id}.mp4`));
            const mediaDir = get_media_dir(ses);

            fs.mkdirSync(mediaDir, {
                recursive: true
            });

            fs.writeFileSync(path.join(mediaDir, encodeURIComponent(id)), buffer);

            ses.media.set(id, {
                buffer,
                mimetype: mimetype || (type === "image" ? "image/jpeg" : "video/mp4"),
                filename
            });

            prepare_message(sent);

            await save_message(ses, sent);

            callback({
                success: true,
                id
            });
        } catch (error) {
            __log(socket.data.userId, "fatal", `[MEDIA_SEND_ERROR]: ${error.message}`);

            callback({
                success: false,
                message: error.message || "Gagal mengirim media"
            });
        }
    });
    // END SEND_MESSAGE_MEDIA


    // START READ_CHAT
    socket.on(SOCKET.WA_CHAT_READ, async input => {
        try {
            if (!ses.sock || !ses.ready) {
                return;
            }

            const identity = get_contact_identity(ses, input);

            if (!identity) {
                return;
            }

            const jid = identity.jid;
            const database = read_chat_db(ses);
            const chatIndex = database.chats.findIndex(chat => normalize_jid(chat?.jid) === jid);

            if (chatIndex < 0) {
                return;
            }

            const chat = database.chats[chatIndex];
            const chatMessages = Array.isArray(chat.messages)
                ? chat.messages
                : [];

            const target = [...chatMessages]
                .reverse()
                .find(message => message && (!message.fromMe || !message?.key?.fromMe) && message.key);

            if (!target) return;

            await ses.sock.readMessages([target.key]);

            chat.unreadCount = 0;
            database.chats[chatIndex] = chat;

            write_chat_db(ses, database);

            emit_user(socket.data.userId, SOCKET.WA_CHAT_UPDATE, get_chat(ses, jid));
            emit_user(socket.data.userId, SOCKET.WA_CHAT_LIST, get_chat_list(ses));
        } catch (error) {
            __log(socket.data.userId, "fatal", `[CHAT_READ_ERROR]: ${error.message}`);
        }
    });
    // END READ_CHAT


    // START DELETE_MESSAGE
    socket.on("wa:message:delete", async (data={}) => {
        try {
            if (!ses.sock || !ses.ready) {
                socket.emit(SOCKET.WA_ERROR, "WhatsApp belum terhubung");
                return;
            }

            const identity = get_contact_identity(ses, data.jid);
            const jid = identity?.jid;
            const id = String(data.id || "");
            const forEveryone = Boolean(data.forEveryone);

            if (!jid || !id) {
                socket.emit(SOCKET.WA_ERROR, "Pesan tidak valid");
                return;
            }

            const database = read_chat_db(ses);
            const chatIndex = database.chats.findIndex(chat => normalize_jid(chat?.jid) === jid);

            if (chatIndex < 0) {
                socket.emit(SOCKET.WA_ERROR, "Chat tidak ditemukan");
                return;
            }

            const chat = database.chats[chatIndex];
            const messageIndex = chat.messages.findIndex(message => message?.id === id);

            if (messageIndex < 0) {
                socket.emit(SOCKET.WA_ERROR, "Pesan tidak ditemukan");
                return;
            }

            const message = chat.messages[messageIndex];

            if (!message.key) {
                socket.emit(SOCKET.WA_ERROR, "Key pesan tidak tersedia");
                return;
            }

            if (forEveryone) {
                if (!message.fromMe) {
                    socket.emit(SOCKET.WA_ERROR, "Hanya pesan sendiri yang dapat dihapus untuk semua orang");
                    return;
                }

                await ses.sock.sendMessage(jid, { delete: message.key });

                message.deletedForEveryone=true;
                message.deleteForEveryone=true;

                chat.messages[messageIndex]=message;
                database.chats[chatIndex]=chat;

                write_chat_db(ses, database);

                emit_user(socket.data.userId, SOCKET.WA_MESSAGE_UPDATE, {
                    jid,
                    message: public_message(message)
                });

                emit_user(socket.data.userId, SOCKET.WA_CHAT_LIST, get_chat_list(ses));

                return;
            }

            await ses.sock.chatModify({
                deleteForMe: {
                    key: message.key,
                    timestamp: Number(message.timestamp || 0),
                    deleteMedia: Boolean(message.hasMedia)
                }
            }, jid);

            chat.messages.splice(messageIndex, 1);
            database.chats[chatIndex]=chat;
            write_chat_db(ses, database);
            delete_message_media(ses, message);
            emit_user(socket.data.userId, "wa:message:deleted", {
                jid,
                id
            });

            emit_user(socket.data.userId, SOCKET.WA_CHAT_LIST, get_chat_list(ses));
        } catch (error) {
            __log(socket.data.userId, "fatal", `[MESSAGE_DELETE_ERROR]: ${error.message}`);
            socket.emit(SOCKET.WA_ERROR, error.message || "Gagal menghapus pesan");
        }
    });
    // END DELETE_MESSAGE


    // START BOT_FEATURE
    socket.on("bot:feature", async ({ feature, enabled } = {}) => {
        const features = read_feature_db(ses);

        features[feature] = Boolean(enabled);
        write_feature_db(ses, features);

        if (feature === "ghost_mode" && ses.sock && ses.ready) {
            await ses.sock
                .sendPresenceUpdate(enabled ? "unavailable" : "available")
                .catch(() => {});
        }

        emit_user(socket.data.userId, "bot:feature", {
            feature,
            enabled: features[feature]
        });
    });
    // END BOT_FEATURE


    // START DELETE_CHAT
    socket.on("wa:chat:delete", input => {
        try {
            const identity = get_contact_identity(ses, input);
            const jid = identity?.jid;

            if (!jid) {
                socket.emit(SOCKET.WA_ERROR, "JID tidak valid");
                return;
            }

            const database = read_chat_db(ses);
            const chatIndex = database.chats.findIndex(chat => normalize_jid(chat?.jid) === jid);

            if (chatIndex < 0) {
                socket.emit(SOCKET.WA_ERROR, "Chat tidak ditemukan");
                return;
            }

            const chat = database.chats[chatIndex];
            const chatMessages = Array.isArray(chat.messages)
                ? chat.messages
                : [];

            database.chats.splice(chatIndex, 1);

            if (!write_chat_db(ses, database)) {
                socket.emit(SOCKET.WA_ERROR, "Gagal menghapus chat");
                return;
            }

            for (const message of chatMessages) {
                if (!message?.id || !message.hasMedia) {
                    continue;
                }

                ses.media?.delete(message.id);

                try {
                    const file = path.join(get_media_dir(ses), encodeURIComponent(message.id));

                    if (fs.existsSync(file)) {
                        fs.unlinkSync(file);
                    }
                } catch (error) {
                    __log(socket.data.userId, "fatal", `[MEDIA_DELETE]: ${error.message}`);
                }
            }

            emit_user(socket.data.userId, "wa:chat:deleted", { jid });
            emit_user(socket.data.userId, SOCKET.WA_CHAT_LIST, get_chat_list(ses));
        } catch (error) {
            __log(socket.data.userId, "fatal", `[CHAT_DELETE_ERROR]: ${error.message}`);
            socket.emit(SOCKET.WA_ERROR, "Gagal menghapus chat");
        }
    });
    // END DELETE_CHAT


    // START CONTACT_SEARCH
    socket.on("wa:contact:search", (query, callback) => {
        try {
            query = String(query || "").trim();

            if (!query) return callback?.([]);

            const contacts = read_contact_db(ses).contacts || [];

            if (query === "*") {
                return callback?.(contacts);
            }

            const fuse = new Fuse(contacts, {
                threshold: 0.32,
                ignoreLocation: true,
                minMatchCharLength: 2,
                keys: [{
                    name: "name",
                    weight: 1
                }, {
                    name: "username",
                    weight: 0.8
                }, {
                    name: "jid",
                    weight: 0.7
                }, {
                    name: "lid",
                    weight: 0.5
                }]
            });

            const normalized = query.replace(/\D/g, "");

            let results = fuse.search(query).map(({ item }) => item);

            if (normalized.length >= 3) {
                const numbers = contacts.filter(contact => {
                    const jid = String(contact.jid || "").replace(/\D/g, "");
                    const lid = String(contact.lid || "").replace(/\D/g, "");

                    return jid.includes(normalized) || lid.includes(normalized);
                });

                results = [...numbers, ...results];
            }

            const seen = new Set();

            results = results.filter(contact => {
                const jid = normalize_jid(contact?.jid);

                if (!jid || seen.has(jid)) return false;

                seen.add(jid);
                return true;
            }).slice(0, 30);

            callback?.(results);
        } catch (error) {
            __log(socket.data.userId, "fatal", `[CONTACT_SEARCH]: ${error.message}`);
            callback?.([]);
        }
    });
    // END CONTACT_SEARCH

    socket.on("disconnect", () => console.log(`\x1b[90m[WEB]:\x1b[0m Disconnect: ${socket.id} | user=${socket.data.userId}`));
});


async function waton_start({
    userId,
    phone=null,
    method=null
}) {
    userId = String(userId);

    const ses = get_session(userId);
    const feature = read_feature_db(ses);

    if (ses.starting) return;
    if (ses.sock && ses.ready) return;

    ses.starting = true;

    try {
        const authDir = path.join(_root, "data", "sessions", userId);

        fs.mkdirSync(authDir, {
            recursive: true
        });

        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const { version } = await fetchLatestBaileysVersion();

        ses.sock = makeWASocket({
            version,
            auth: state,
            logger: new Pino({ level: "silent" }),
            browser: Browsers.windows("Edge"),
            keepAliveIntervalMs: 30_000,
            markOnlineOnConnect: !feature.ghost_mode,
            generateHighQualityLinkPreview: true,
            defaultQueryTimeoutMs: undefined,
            emitOwnEvents: true,
            fireInitQueries: true,
            syncFullHistory: false,
            shouldSyncHistoryMessage: ({ syncType }) => syncType !== proto.HistorySync.HistorySyncType.FULL
        });

        if (!(ses.media instanceof Map)) {
            ses.media = new Map();
        }

        if (!(ses.typingTimers instanceof Map)) {
            ses.typingTimers = new Map();
        }

        if (!state.creds.registered && (method === "pairing" || method === "code")) {
            if (!phone) {
                throw new Error("Nomor WhatsApp diperlukan");
            }

            await new Promise(resolve => setTimeout(resolve, 3000));

            const code = await ses.sock.requestPairingCode(phone.replace(/\D/g, ""));

            emit_user(userId, SOCKET.WA_AUTH_PAIRING, {
                type: SOCKET.WA_AUTH_PAIRING,
                body: code.match(/.{1,4}/g)?.join("-") || code
            });
        }

        ses.sock.ev.on("creds.update", saveCreds);


        ses.sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
            if (qr && method === "qr") {
                const qrUrl = await QRCode.toDataURL(qr, {
                    width: 260,
                    margin: 2
                });

                emit_user(userId, SOCKET.WA_AUTH_QR, {
                    type: SOCKET.WA_AUTH_QR,
                    body: qrUrl
                });
            }

            if (connection === "open") {
                ses.ready = true;
                ses.starting = false;

                emit_user(userId, SOCKET.WA_STATUS, {
                    connected: true,
                    syncing: ses.syncing
                });

                emit_user_sync(userId, ses);

                for (const chat of read_chat_db(ses).chats) {
                    const jid = normalize_jid(chat?.jid);
                    if (!jid) continue;

                    try {
                        const picture = update_profile_picture(ses, jid);
                        if (!picture) continue;

                        emit_user(userId, SOCKET.WA_CHAT_UPDATE, get_chat(ses, jid));
                        emit_user(userId, SOCKET.WA_CHAT_LIST, get_chat_list(ses));
                    } catch (error) {
                        console.log(error.message);
                    }
                }
            }

            if (connection === "close") {
                ses.ready = false;
                ses.syncing = false;
                ses.starting = false;

                emit_user(userId, SOCKET.WA_STATUS, {
                    connected: false,
                    syncing: false
                });

                const disconnectCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = disconnectCode !== DisconnectReason.loggedOut;

                if (shouldReconnect) {
                    setTimeout(() => {
                        waton_start({
                            userId
                        });
                    }, 2000);
                }
            }
        });


        ses.sock.ev.on("contacts.upsert", async (contacts) => {
            __log(userId, "debug", `Total kontak ${contacts.length}`)

            for (const contact of contacts) {
                await save_contact(ses, contact);
            }

            emit_user(userId, SOCKET.WA_SYNC_PROGRESS, {
                type: SOCKET.WA_CONTACT_LIST,
                count: contacts.length
            });
        });


        ses.sock.ev.on("chats.upsert", incoming => {
            const database = read_chat_db(ses);

            for (const item of incoming) {
                const raw = normalize_jid(item?.id);

                if (!raw) continue;
                if (/@(?:g\.us|broadcast|newsletter)$/.test(String(raw || ""))) continue;

                const identity = get_contact_identity(ses, raw);

                if (!identity) continue;

                const { jid, lid } = identity;

                const chatIndex = database.chats.findIndex(chat => {
                    const id = normalize_jid(chat?.jid);
                    return (id === jid || (lid && id === lid));
                });

                if (chatIndex < 0) continue;

                const chat = database.chats[chatIndex];

                chat.jid = jid;

                for (const key of ["unreadCount", "archived", "pinned"]) {
                    if (item[key] !== undefined) chat[key] = item[key];
                }

                database.chats[chatIndex] = chat;
            }

            write_chat_db(ses, database);
            emit_user(userId, SOCKET.WA_CHAT_LIST, get_chat_list(ses));
        });


        ses.sock.ev.on("chats.update", incoming => {
            const database = read_chat_db(ses);

            for (const item of incoming) {
                const raw = normalize_jid(item?.id);

                if (!raw) continue;
                if (/@(?:g\.us|broadcast|newsletter)$/.test(String(raw || ""))) continue;

                const identity = get_contact_identity(ses, raw);
                if (!identity) continue;

                const { jid, lid, contact } = identity;

                let chatIndex = database.chats.findIndex(chat => {
                    const id = normalize_jid(chat?.jid);
                    return (id === jid || (lid && id === lid));
                });

                if (chatIndex < 0) {
                    database.chats.push({
                        jid,
                        name: contact.name || contact.username || jid,
                        profilePicture: contact.profilePicture || null,
                        unreadCount: 0,
                        archived: false,
                        pinned: false,
                        messages: []
                    });

                    chatIndex = database.chats.length - 1;
                }

                const chat = database.chats[chatIndex];
                chat.jid = jid;

                if (contact.name || contact.username) chat.name = contact.name || contact.username;
                if (contact.profilePicture) chat.profilePicture = contact.profilePicture;

                for (const key of ["unreadCount", "archived", "pinned"]) {
                    if (item[key] !== undefined) chat[key] = item[key];
                }

                database.chats[chatIndex] = chat;
            }

            write_chat_db(ses, database);
            emit_user(userId, SOCKET.WA_CHAT_LIST, get_chat_list(ses));
        });


        ses.sock.ev.on("messages.upsert", async ({ messages }) => {
            for (const m of messages) {
                if (!m?.key || !m.message) continue;

                prepare_message(m);
                bot_feature(ses.sock, m);

                if (/@(?:g\.us|broadcast|newsletter)$/.test(String(m.chat))) continue;

                await save_message(ses, m);

                if (feature.auto_read && !m.fromMe) {
                    await ses.sock.readMessages([m.key]).catch(() => {});
                }

                if (feature.auto_typing && !m.fromMe) {
                    await ses.sock.sendPresenceUpdate("composing", m.chat).catch(() => {});

                    if (ses.typingTimers.has(m.chat)) {
                        clearTimeout(ses.typingTimers.get(m.chat));
                    }

                    const timer = setTimeout(async () => {
                        ses.typingTimers.delete(m.chat);

                        if (!ses.sock || !ses.ready) return;

                        await ses.sock.sendPresenceUpdate("paused", m.chat).catch(() => {});
                    }, 3000);

                    ses.typingTimers.set(m.chat, timer);
                }
            }

            emit_user(userId, SOCKET.WA_CHAT_LIST, get_chat_list(ses));
        });


        ses.sock.ev.on("messages.update", updates => {
            const database = read_chat_db(ses);
            const changedMessages = [];

            for (const { key, update } of updates) {
                const id = key?.id;

                if (!id || is_ignored_key(key)) continue;

                const status = Number(update?.status);
                const hasStatus =
                    Number.isInteger(status) &&
                    status >= WAMessageStatus.ERROR &&
                    status <= WAMessageStatus.PLAYED;

                const deleted =
                    update?.messageStubType === 1 ||
                    update?.message === null;

                if (!hasStatus && !deleted) continue;

                let chatIndex = -1;
                let messageIndex = -1;

                for (let index = 0; index < database.chats.length; index++) {
                    const chat = database.chats[index];
                    if (!Array.isArray(chat?.messages)) continue;

                    const targetIndex = chat.messages.findIndex(message => message?.id === id);
                    if (targetIndex < 0) continue;

                    chatIndex = index;
                    messageIndex = targetIndex;

                    break;
                }

                if (chatIndex < 0 || messageIndex < 0) continue;

                const chat = database.chats[chatIndex];
                const message = chat.messages[messageIndex];

                let changed = false;

                if (hasStatus && message.fromMe) {
                    const currentStatus = Number(message.status);
                    const shouldUpdateStatus = status === WAMessageStatus.ERROR || !Number.isInteger(currentStatus) || status > currentStatus;

                    if (shouldUpdateStatus) {
                        message.status = status;
                        changed = true;
                    }
                }

                if (deleted && !message.deletedForEveryone) {
                    message.deletedForEveryone=true;
                    message.deleteForEveryone=true;
                    changed=true;
                }

                if (!changed) continue;

                chat.messages[messageIndex] = message;
                database.chats[chatIndex] = chat;

                changedMessages.push({
                    jid: chat.jid,
                    message: public_message(message)
                });
            }

            if (!changedMessages.length) return;

            write_chat_db(ses, database);

            for (const payload of changedMessages) {
                emit_user(userId, SOCKET.WA_MESSAGE_UPDATE, payload);
            }

            emit_user(userId, SOCKET.WA_CHAT_LIST, get_chat_list(ses));
        });


        ses.sock.ev.on("presence.update", update => {
            const raw = normalize_identity(update.id);
            if (!raw) return;

            const identity = get_contact_identity(ses, raw);
            if (!identity) return;

            const jid = identity.jid;
            const presences = update.presences || {};
            const entries = Object.entries(presences);

            if (!entries.length) return;

            const [participant, data] = entries[0];

            if (!data) return;

            const presence = data.lastKnownPresence || "unavailable";
            const lastSeen = Number(data.lastSeen);

            emit_user(userId, SOCKET.WA_PRESENCE, {
                jid,
                participant: normalize_identity(participant),
                online: ["available", "composing", "recording"].includes(presence),
                presence,
                lastSeen: Number.isFinite(lastSeen) && lastSeen > 0 ? lastSeen : null
            });
        });


        ses.sock.ev.on("messaging-history.set", async ({
            messages,
            isLatest,
            syncType,
            progress
        }) => {
            const latest = new Map();
            const database = read_chat_db(ses);

            ses.syncing = true;

            emit_user(userId, SOCKET.WA_STATUS, {
                connected: ses.ready,
                syncing: true
            });

            for (const m of messages || []) {
                const jid = m?.key?.remoteJid;

                if (/@(?:g\.us|broadcast|newsletter)$/.test(jid)) continue;

                const timestamp = get_timestamp(m);
                const current = latest.get(jid);

                if (!current || timestamp > get_timestamp(current)) {
                    latest.set(jid, m);
                }
            }

            let processed = 0;
            let skipped = 0;

            for (const [jid, m] of latest) {
                const chat = database.chats.find(v => v.jid === jid);

                const lastTimestamp = Math.max(0, ...(chat?.messages || []).map(v => Number(v.timestamp || 0)));
                const timestamp = get_timestamp(m);

                if (timestamp <= lastTimestamp) {
                    skipped++;
                    continue;
                }

                try {
                    const saved = await save_message(ses, m, { history: true });

                    saved
                        ? processed++
                        : skipped++;
                } catch (error) {
                    skipped++;
                    console.log(`[HISTORY_ERROR][${userId}]:`, error.message || error);
                }
            }

            emit_user(userId, SOCKET.WA_CHAT_LIST, get_chat_list(ses));

            console.log(
                `[HISTORY][${userId}] latest=${processed} skipped=${skipped} ` +
                `syncType=${syncType ?? "-"} progress=${progress ?? "-"}`
            );

            if (progress === 100 || isLatest) {
                ses.syncing = false;

                emit_user(userId, SOCKET.WA_SYNC_COMPLETE, {
                    messages: processed
                });

                emit_user(userId, SOCKET.WA_STATUS, {
                    connected: ses.ready,
                    syncing: false
                });

                emit_user_sync(userId, ses);
            }
        });
    } catch (error) {
        ses.starting = false;
        ses.ready = false;
        console.log(`[ERROR][${userId}]: waton_start(): ${error.message || error}`);
        emit_user(userId, SOCKET.WA_ERROR, error.message || "Gagal menjalankan WhatsApp");
    }
}


http.listen(3000, "0.0.0.0", async () => {
    console.clear();

    const database = read_account_db();
    const users = Array.isArray(database.users) ? database.users : [];

    for (const account of users) {
        const userId = normalize_username(account?.username);
        const ses = get_session(userId);

        if (has_whatsapp_auth(userId) && !ses.ready && !ses.starting) {
            await waton_start({
                userId
            });
        }
    }

    console.log("[SERVER]: WATon running on port 3000");
});