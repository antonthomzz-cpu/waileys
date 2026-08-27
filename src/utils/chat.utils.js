import "../config/module.js";

const MAX_CHAT_MESSAGES = 100;
const MAX_MEDIA_CACHE = 200;
const MAX_MEDIA_SIZE = 100 * 1024 * 1024;

const SUPPORTED_MEDIA = new Set([
    "image",
    "video",
    "audio",
    "document",
    "sticker"
]);

const DEFAULT_FEATURES = Object.freeze({
    auto_read: false,
    auto_typing: false,
    ghost_mode: false
});


function get_user_id(ses) {
    const userId = String(ses?.userId || "").trim();

    if (!userId) {
        throw new Error("ses.userId missing");
    }

    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(userId)) {
        throw new Error("Invalid ses.userId");
    }

    return userId;
}


function ensure_directory(dir) {
    fs.mkdirSync(dir, {
        recursive: true
    });

    return dir;
}


const ensure_user_dir = (ses) => ensure_directory(get_user_dir(ses));


function read_json(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            return fallback;
        }

        const raw = fs.readFileSync(file, "utf8").trim();

        if (!raw) {
            return fallback;
        }

        return JSON.parse(raw);
    } catch (error) {
        console.log(`[DB]: read ${path.basename(file)} failed: ${error.message}`);
        return fallback;
    }
}


function write_json(file, data) {
    try {
        ensure_directory(path.dirname(file));

        const temp = `${file}.${process.pid}.${Date.now()}.tmp`;

        fs.writeFileSync(temp, JSON.stringify(data), "utf8");
        fs.renameSync(temp, file);

        return true;
    } catch (error) {
        console.log(`[DB]: write ${path.basename(file)} failed: ${error.message}`);
        return false;
    }
}


export const normalize_identity = (value) => normalize_jid(value);


function same_contact(contact, value) {
    const id = normalize_identity(value);

    if (!contact || !id) return false;

    return [contact.jid, contact.lid].some(
        value => normalize_identity(value) === id
    );
}


function find_contact(database, value) {
    if (!Array.isArray(database?.contacts)) return null;

    return database.contacts.find(
        contact => same_contact(contact, value)
    ) || null;
}


function create_contact_index(contacts=[]) {
    const index = new Map();

    for (const contact of contacts) {
        const jid = normalize_identity(contact?.jid);
        const lid = normalize_identity(contact?.lid);

        if (jid) index.set(jid, contact);
        if (lid) index.set(lid, contact);
    }

    return index;
}


function get_message_identity(m) {
    return normalize_identity(
        m?.chat ||
        m?.key?.remoteJid
    );
}


function get_media_urls(ses, id) {
    const userId = encodeURIComponent(get_user_id(ses));
    const mediaId = encodeURIComponent(String(id));

    return {
        mediaUrl: `/api/media/${userId}/${mediaId}`,
        downloadUrl: `/api/media/${userId}/${mediaId}?download=1`
    };
}


function ensure_media_store(ses) {
    if (!(ses.media instanceof Map)) {
        ses.media = new Map();
    }

    return ses.media;
}


function trim_media_cache(ses) {
    const media = ensure_media_store(ses);

    while (media.size > MAX_MEDIA_CACHE) {
        const key = media.keys().next().value;

        if (key === undefined) {
            break;
        }

        media.delete(key);
    }
}


const emit_session = (ses, event, data) => {
    io.to(`user:${get_user_id(ses)}`).emit(event, data);
};


/* =========================================================
 * JID / PUBLIC DATA
 * ======================================================= */

export function normalize_jid(jid) {
    if (!jid) return null;

    try {
        return jidNormalizedUser(String(jid));
    } catch {
        return String(jid);
    }
}


export function public_message(m) {
    if (!m) return null;

    const status =
        m.status === null || m.status === undefined
            ? null
            : Number(m.status);

    return {
        id: m.id,
        jid: m.jid,
        fromMe: Boolean(m.fromMe),
        from: m.from,
        text: m.text || "",
        type: m.type,
        hasMedia: Boolean(m.hasMedia),
        mediaUrl: m.mediaUrl || null,
        downloadUrl: m.downloadUrl || null,
        mimetype: m.mimetype || null,
        filename: m.filename || null,
        isVoiceNote: Boolean(m.isVoiceNote),
        timestamp: m.timestamp || 0,
        status: Number.isInteger(status) ? status : null,
        quoted: m.quoted
            ? {
                id: m.quoted.id || null,
                jid: m.quoted.jid || null,
                fromMe: Boolean(m.quoted.fromMe),
                from: m.quoted.from || null,
                text: m.quoted.text || "",
                type: m.quoted.type || "text",
                hasMedia: Boolean(m.quoted.hasMedia),
                mediaUrl: m.quoted.mediaUrl || null,
                downloadUrl: m.quoted.downloadUrl || null,
                mimetype: m.quoted.mimetype || null,
                filename: m.quoted.filename || null,
                isVoiceNote: Boolean(m.quoted.isVoiceNote)
            }
            : null,
        deletedForEveryone: Boolean(
            m.deletedForEveryone ||
            m.deleteForEveryone
        ),
        key: m.key || null
    };
}


/* =========================================================
 * PATHS
 * ======================================================= */

export const get_user_dir = (ses) =>
    path.join(
        _root,
        "data",
        "users",
        get_user_id(ses)
    );


export const get_chat_database_path = (ses) =>
    path.join(
        get_user_dir(ses),
        "db.chat.json"
    );


export const get_contact_database_path = (ses) =>
    path.join(
        get_user_dir(ses),
        "db.contact.json"
    );


export const get_feature_database_path = (ses) =>
    path.join(
        get_user_dir(ses),
        "db.feature.json"
    );


export const get_media_dir = (ses) =>
    ensure_directory(
        path.join(
            get_user_dir(ses),
            "media"
        )
    );


/* =========================================================
 * CHAT DATABASE
 * ======================================================= */

export function read_chat_db(ses) {
    if (!ses?.userId) {
        return {
            userId: "",
            chats: []
        };
    }

    const userId = get_user_id(ses);

    const database = read_json(
        get_chat_database_path(ses),
        {
            userId,
            chats: []
        }
    );

    database.userId = userId;
    database.chats = Array.isArray(database.chats)
        ? database.chats
        : [];

    return database;
}


export function write_chat_db(ses, database) {
    if (!ses?.userId) {
        return false;
    }

    ensure_user_dir(ses);

    return write_json(
        get_chat_database_path(ses),
        {
            userId: get_user_id(ses),
            chats: Array.isArray(database?.chats)
                ? database.chats
                : []
        }
    );
}


/* =========================================================
 * CONTACT DATABASE
 * ======================================================= */

export function read_contact_db(ses) {
    if (!ses?.userId) {
        return {
            total: 0,
            contacts: []
        };
    }

    const database = read_json(
        get_contact_database_path(ses),
        {
            total: 0,
            contacts: []
        }
    );

    database.contacts = Array.isArray(database.contacts)
        ? database.contacts
        : [];

    database.total = database.contacts.length;

    return database;
}


export function write_contact_db(ses, database) {
    if (!ses?.userId) {
        return false;
    }

    ensure_user_dir(ses);

    const contacts = Array.isArray(database?.contacts)
        ? database.contacts
        : [];

    return write_json(
        get_contact_database_path(ses),
        {
            total: contacts.length,
            contacts
        }
    );
}


/* =========================================================
 * FEATURE DATABASE
 * ======================================================= */

export function read_feature_db(ses) {
    if (!ses?.userId) {
        return {
            ...DEFAULT_FEATURES
        };
    }

    const database = read_json(
        get_feature_database_path(ses),
        {
            ...DEFAULT_FEATURES
        }
    );

    return {
        auto_read: Boolean(database?.auto_read),
        auto_typing: Boolean(database?.auto_typing),
        ghost_mode: Boolean(database?.ghost_mode)
    };
}


export function write_feature_db(ses, features) {
    if (!ses?.userId) {
        return false;
    }

    ensure_user_dir(ses);

    return write_json(get_feature_database_path(ses), {
            auto_read: Boolean(features?.auto_read),
            auto_typing: Boolean(features?.auto_typing),
            ghost_mode: Boolean(features?.ghost_mode)
    });
}


/* =========================================================
 * CONTACTS
 * ======================================================= */

export function get_contact_list(ses) {
    if (!ses) return [];

    return [...read_contact_db(ses).contacts]
        .sort((a, b) => {
            const nameA = String(
                a?.name ||
                a?.username ||
                a?.jid ||
                a?.lid ||
                ""
            );

            const nameB = String(
                b?.name ||
                b?.username ||
                b?.jid ||
                b?.lid ||
                ""
            );

            return nameA.localeCompare(nameB);
        });
}


export function get_contact(ses, value) {
    if (!ses || !value) return null;

    const id = normalize_identity(value);
    if (!id) return null;

    return find_contact(
        read_contact_db(ses),
        id
    );
}


export function save_contact(ses, data) {
    if (!ses || !data) return null;

    const id = normalize_identity(data.id);

    const jid =
        normalize_identity(data.jid) ||
        (
            id?.endsWith("@s.whatsapp.net")
                ? id
                : null
        );

    const lid =
        normalize_identity(data.lid) ||
        (
            id?.endsWith("@lid")
                ? id
                : null
        );

    if (!jid && !lid) return null;

    const database = read_contact_db(ses);

    const index = database.contacts.findIndex(contact =>
        [jid, lid]
            .filter(Boolean)
            .some(id => same_contact(contact, id))
    );

    const old = index >= 0
        ? database.contacts[index]
        : {};

    const contact = {
        ...old,
        jid:
            jid ||
            old.jid ||
            null,
        lid:
            lid ||
            old.lid ||
            null,
        name:
            data.name ||
            data.username ||
            old.name ||
            jid ||
            lid,
        username:
            data.username ||
            old.username ||
            null,
        profilePicture:
            data.profilePicture ||
            old.profilePicture ||
            null
    };

    if (index >= 0) {
        database.contacts[index] = contact;
    } else {
        database.contacts.push(contact);
    }

    write_contact_db(ses, database);

    return contact;
}


export async function update_profile_picture(ses, value) {
    if (!ses?.sock || !ses.ready || !value) {
        return null;
    }

    try {
        const contactDatabase = read_contact_db(ses);
        const contact = find_contact(
            contactDatabase,
            value
        );

        const jid = normalize_identity(
            contact?.jid
        );

        if (!jid) return null;

        const url = await ses.sock.profilePictureUrl(
            jid,
            "image"
        );

        if (!url) return null;

        contact.profilePicture = url;

        write_contact_db(
            ses,
            contactDatabase
        );

        const chatDatabase = read_chat_db(ses);

        const chat = chatDatabase.chats.find(
            chat =>
                normalize_identity(chat?.jid) === jid
        );

        if (chat) {
            chat.profilePicture = url;

            write_chat_db(
                ses,
                chatDatabase
            );
        }

        return url;
    } catch (error) {
        console.log(
            `[PROFILE:${get_user_id(ses)}]: ${error.message}`
        );

        return null;
    }
}


/* =========================================================
 * CHATS
 * ======================================================= */

export function get_chat(ses, value) {
    if (!ses || !value) return null;

    const contact = get_contact(
        ses,
        value
    );

    const jid = normalize_identity(
        contact?.jid
    );

    if (!jid) return null;

    const database = read_chat_db(ses);

    const chat = database.chats.find(
        chat =>
            normalize_identity(chat?.jid) === jid
    );

    if (!chat) return null;

    const messages = Array.isArray(chat.messages)
        ? chat.messages
        : [];

    const last = messages.at(-1) || null;

    return {
        jid,
        name:
            contact?.name ||
            contact?.username ||
            chat.name ||
            chat.notify ||
            jid,
        profilePicture:
            contact?.profilePicture ||
            chat.profilePicture ||
            null,
        unreadCount:
            Number(chat.unreadCount || 0),
        archived:
            Boolean(chat.archived),
        pinned:
            Boolean(chat.pinned),
        count:
            messages.length,
        last:
            last
                ? public_message(last)
                : null
    };
}


export function get_chat_list(ses) {
    if (!ses) return [];

    const database = read_chat_db(ses);

    const contacts = create_contact_index(
        read_contact_db(ses).contacts
    );

    return database.chats
        .filter(
            chat =>
                Array.isArray(chat?.messages) &&
                chat.messages.length > 0
        )
        .map(chat => {
            const jid = normalize_identity(
                chat.jid
            );

            const last = chat.messages.at(-1);

            if (!jid || !last) {
                return null;
            }

            const contact = contacts.get(jid);

            return {
                jid,
                name:
                    contact?.name ||
                    contact?.username ||
                    chat.name ||
                    chat.notify ||
                    jid,
                profilePicture:
                    contact?.profilePicture ||
                    chat.profilePicture ||
                    null,
                unreadCount:
                    Number(chat.unreadCount || 0),
                archived:
                    Boolean(chat.archived),
                pinned:
                    Boolean(chat.pinned),
                count:
                    chat.messages.length,
                last:
                    public_message(last)
            };
        })
        .filter(Boolean)
        .sort(
            (a, b) =>
                Number(b.last?.timestamp || 0) -
                Number(a.last?.timestamp || 0)
        );
}


/* =========================================================
 * MESSAGE CONTENT
 * ======================================================= */

export function unwrap_message(message) {
    let current = message;

    while (current) {
        const nested =
            current.ephemeralMessage?.message ||
            current.viewOnceMessage?.message ||
            current.viewOnceMessageV2?.message ||
            current.viewOnceMessageV2Extension?.message ||
            current.documentWithCaptionMessage?.message ||
            current.editedMessage?.message;

        if (!nested) break;

        current = nested;
    }

    return current || null;
}


export function get_message_content(message) {
    return unwrap_message(
        message?.message
    );
}


export function get_message_text(message) {
    const content = get_message_content(message);

    if (!content) return "";

    const values = [
        content.conversation,
        content.extendedTextMessage?.text,
        content.imageMessage?.caption,
        content.videoMessage?.caption,
        content.documentMessage?.caption,
        content.buttonsResponseMessage?.selectedDisplayText,
        content.buttonsResponseMessage?.selectedButtonId,
        content.listResponseMessage?.title,
        content.listResponseMessage?.singleSelectReply?.selectedRowId,
        content.templateButtonReplyMessage?.selectedDisplayText,
        content.templateButtonReplyMessage?.selectedId
    ];

    const value = values.find(
        value =>
            typeof value === "string" &&
            value.trim()
    );

    return value?.trim() || "";
}


export function get_message_type(message) {
    const content = get_message_content(message);

    if (!content) return "unknown";

    if (content.imageMessage) return "image";
    if (content.videoMessage) return "video";
    if (content.audioMessage) return "audio";
    if (content.documentMessage) return "document";
    if (content.stickerMessage) return "sticker";

    if (
        content.conversation ||
        content.extendedTextMessage
    ) {
        return "text";
    }

    return "unknown";
}


export function is_voice_note(message) {
    return Boolean(
        get_message_content(message)
            ?.audioMessage
            ?.ptt
    );
}


export function get_mime(
    message,
    type=get_message_type(message)
) {
    const content = get_message_content(message);

    switch (type) {
        case "image":
            return (
                content?.imageMessage?.mimetype ||
                "image/jpeg"
            );

        case "video":
            return (
                content?.videoMessage?.mimetype ||
                "video/mp4"
            );

        case "audio":
            return (
                content?.audioMessage?.mimetype ||
                "audio/ogg"
            );

        case "document":
            return (
                content?.documentMessage?.mimetype ||
                "application/octet-stream"
            );

        case "sticker":
            return (
                content?.stickerMessage?.mimetype ||
                "image/webp"
            );

        default:
            return "application/octet-stream";
    }
}


export function get_filename(
    message,
    type=get_message_type(message)
) {
    const content = get_message_content(message);

    switch (type) {
        case "image":
            return (
                content?.imageMessage?.fileName ||
                "image.jpg"
            );

        case "video":
            return (
                content?.videoMessage?.fileName ||
                "video.mp4"
            );

        case "audio":
            return (
                content?.audioMessage?.fileName ||
                (
                    is_voice_note(message)
                        ? "voice-note.ogg"
                        : "audio.ogg"
                )
            );

        case "document":
            return (
                content?.documentMessage?.fileName ||
                "document"
            );

        case "sticker":
            return "sticker.webp";

        default:
            return `${type || "media"}.bin`;
    }
}


function get_message_context_info(message) {
    const content = get_message_content(message);

    if (!content) return null;

    for (const value of Object.values(content)) {
        if (
            value &&
            typeof value === "object" &&
            value.contextInfo
        ) {
            return value.contextInfo;
        }
    }

    return null;
}


function find_saved_message(ses, value, id) {
    if (!ses || !value || !id) {
        return null;
    }

    const contact = get_contact(
        ses,
        value
    );

    const jid = normalize_identity(
        contact?.jid
    );

    if (!jid) return null;

    const chat = read_chat_db(ses)
        .chats
        .find(
            chat =>
                normalize_identity(chat?.jid) === jid
        );

    if (!Array.isArray(chat?.messages)) {
        return null;
    }

    return chat.messages.find(
        message =>
            message?.id === id
    ) || null;
}


function get_quoted_message(ses, message, jid) {
    const contextInfo =
        get_message_context_info(message);

    if (
        !contextInfo?.stanzaId ||
        !contextInfo?.quotedMessage
    ) {
        return null;
    }

    const id = String(
        contextInfo.stanzaId
    );

    const saved = find_saved_message(
        ses,
        jid,
        id
    );

    if (saved) {
        return {
            id:
                saved.id,
            jid:
                saved.jid ||
                jid,
            fromMe:
                Boolean(saved.fromMe),
            from:
                saved.from ||
                null,
            text:
                saved.text ||
                "",
            type:
                saved.type ||
                "text",
            hasMedia:
                Boolean(saved.hasMedia),
            mediaUrl:
                saved.mediaUrl ||
                null,
            downloadUrl:
                saved.downloadUrl ||
                null,
            mimetype:
                saved.mimetype ||
                null,
            filename:
                saved.filename ||
                null,
            isVoiceNote:
                Boolean(saved.isVoiceNote)
        };
    }

    const quotedMessage = {
        key: {
            id,
            remoteJid: jid,
            participant:
                contextInfo.participant ||
                null,
            fromMe: false
        },
        message:
            contextInfo.quotedMessage
    };

    const type =
        get_message_type(quotedMessage);

    const text =
        get_message_text(quotedMessage);

    return {
        id,
        jid,
        fromMe: false,
        from:
            contextInfo.participant ||
            null,
        text,
        type,
        hasMedia:
            SUPPORTED_MEDIA.has(type),
        mediaUrl:
            null,
        downloadUrl:
            null,
        mimetype:
            SUPPORTED_MEDIA.has(type)
                ? get_mime(quotedMessage, type)
                : null,
        filename:
            SUPPORTED_MEDIA.has(type)
                ? get_filename(quotedMessage, type)
                : null,
        isVoiceNote:
            type === "audio" &&
            is_voice_note(quotedMessage)
    };
}


export function get_timestamp(message) {
    const timestamp =
        message?.messageTimestamp;

    if (timestamp == null) {
        return 0;
    }

    if (typeof timestamp === "number") {
        return Number.isFinite(timestamp)
            ? timestamp
            : 0;
    }

    if (typeof timestamp === "string") {
        return Number(timestamp) || 0;
    }

    if (
        typeof timestamp?.toNumber === "function"
    ) {
        try {
            return timestamp.toNumber();
        } catch {}
    }

    if (typeof timestamp === "object") {
        if (timestamp.value != null) {
            return Number(timestamp.value) || 0;
        }

        const low = Number(
            timestamp.low || 0
        );

        const high = Number(
            timestamp.high || 0
        );

        if (high) {
            return (
                high * 0x100000000 +
                (low >>> 0)
            );
        }

        return low || 0;
    }

    return Number(timestamp) || 0;
}


/* =========================================================
 * MEDIA
 * ======================================================= */

export async function prepare_media(ses, message) {
    if (
        !ses?.sock ||
        !ses.ready ||
        !message?.key
    ) {
        return null;
    }

    const type =
        get_message_type(message);

    if (!SUPPORTED_MEDIA.has(type)) {
        return null;
    }

    const id = String(
        message.key.id || ""
    );

    if (!id) return null;

    const media =
        ensure_media_store(ses);

    const urls =
        get_media_urls(ses, id);

    const cached =
        media.get(id);

    if (cached) {
        return {
            type:
                cached.type ||
                type,
            ...urls,
            filename:
                cached.filename,
            mimetype:
                cached.mimetype
        };
    }

    const mimetype =
        get_mime(message, type);

    const filename =
        get_filename(message, type);

    const mediaDir =
        get_media_dir(ses);

    const file = path.join(
        mediaDir,
        encodeURIComponent(id)
    );

    if (fs.existsSync(file)) {
        try {
            const buffer =
                fs.readFileSync(file);

            media.set(id, {
                buffer,
                mimetype,
                filename,
                type
            });

            trim_media_cache(ses);

            return {
                type,
                ...urls,
                filename,
                mimetype
            };
        } catch (error) {
            console.log(
                `[MEDIA:${get_user_id(ses)}]: read cache failed: ${error.message}`
            );
        }
    }

    try {
        const buffer =
            await downloadMediaMessage(
                message,
                "buffer",
                {},
                {
                    logger:
                        Pino({
                            level: "silent"
                        }),

                    reuploadRequest:
                        async target => {
                            if (!ses.sock) {
                                return null;
                            }

                            return ses.sock
                                .updateMediaMessage(
                                    target
                                );
                        }
                }
            );

        if (
            !Buffer.isBuffer(buffer) ||
            !buffer.length
        ) {
            return null;
        }

        if (buffer.length > MAX_MEDIA_SIZE) {
            console.log(
                `[MEDIA:${get_user_id(ses)}]: skipped ${(buffer.length / 1024 / 1024).toFixed(1)} MB`
            );

            return null;
        }

        media.set(id, {
            buffer,
            mimetype,
            filename,
            type
        });

        trim_media_cache(ses);

        try {
            const temp =
                `${file}.${process.pid}.tmp`;

            fs.writeFileSync(
                temp,
                buffer
            );

            fs.renameSync(
                temp,
                file
            );
        } catch (error) {
            console.log(
                `[MEDIA:${get_user_id(ses)}]: save failed: ${error.message}`
            );
        }

        return {
            type,
            ...urls,
            filename,
            mimetype
        };
    } catch (error) {
        console.log(
            `[MEDIA:${get_user_id(ses)}]: download failed: ${error.message}`
        );

        return null;
    }
}


/* =========================================================
 * SERIALIZE MESSAGE
 * ======================================================= */

export async function serialize_message(ses, m) {
    const id =
        m?.id ||
        m?.key?.id;

    const identity =
        get_message_identity(m);

    if (
        !ses ||
        !id ||
        !identity
    ) {
        return null;
    }

    const contact =
        get_contact(
            ses,
            identity
        );

    const jid =
        normalize_identity(
            contact?.jid
        );

    if (
        !jid ||
        !jid.endsWith("@s.whatsapp.net")
    ) {
        return null;
    }

    const type =
        get_message_type(m);

    const text =
        get_message_text(m);

    const media =
        await prepare_media(
            ses,
            m
        );

    const quoted =
        get_quoted_message(
            ses,
            m,
            jid
        );

    if (
        type === "unknown" &&
        !text &&
        !media
    ) {
        return null;
    }

    const fromMe =
        Boolean(
            m.fromMe ??
            m.key?.fromMe
        );

    const value =
        m.status == null
            ? null
            : Number(m.status);

    const status =
        Number.isInteger(value)
            ? value
            : fromMe
                ? WAMessageStatus.PENDING
                : null;

    return {
        id,
        jid,
        fromMe,
        from:
            fromMe
                ? "Me"
                : (
                    contact?.name ||
                    contact?.username ||
                    m.pushName ||
                    jid
                ),
        text,
        type,
        hasMedia:
            Boolean(media),
        mediaUrl:
            media?.mediaUrl ||
            null,
        downloadUrl:
            media?.downloadUrl ||
            null,
        mimetype:
            media?.mimetype ||
            null,
        filename:
            media?.filename ||
            null,
        isVoiceNote:
            type === "audio" &&
            is_voice_note(m),
        timestamp:
            get_timestamp(m),
        status,
        quoted,

        // Key asli Baileys tetap disimpan.
        key:
            m.key ||
            null
    };
}


/* =========================================================
 * SAVE MESSAGE
 * ======================================================= */

export async function save_message(
    ses,
    m,
    options={}
) {
    if (!ses) return null;

    const content =
        get_message_content(m);

    if (
        !content ||
        content.protocolMessage ||
        content.senderKeyDistributionMessage
    ) {
        return null;
    }

    /*
     * Identity dari message hanya dipakai
     * untuk mencari kontak.
     *
     * Biasanya:
     * m.chat / key.remoteJid = @lid
     */
    const identity =
        get_message_identity(m);

    if (!identity) {
        return null;
    }

    const contact =
        get_contact(
            ses,
            identity
        );

    if (!contact) {
        return null;
    }

    /*
     * JID database selalu berasal
     * dari contact.jid.
     */
    const jid =
        normalize_identity(
            contact.jid
        );

    const lid =
        normalize_identity(
            contact.lid
        );

    if (
        !jid ||
        !jid.endsWith("@s.whatsapp.net")
    ) {
        return null;
    }

    /*
     * Message harus cocok dengan salah satu
     * identity milik contact.
     *
     * Incoming biasanya cocok ke contact.lid.
     * Outgoing / kondisi tertentu bisa cocok
     * langsung ke contact.jid.
     */
    if (
        identity !== jid &&
        identity !== lid
    ) {
        return null;
    }

    const serialized =
        await serialize_message(
            ses,
            m
        );

    if (!serialized) {
        return null;
    }

    const database =
        read_chat_db(ses);

    /*
     * Cari chat lama berdasarkan canonical JID
     * atau LID untuk menangani database lama
     * yang sempat menyimpan @lid.
     */
    const aliases =
        new Set(
            [jid, lid]
                .filter(Boolean)
        );

    const matches =
        database.chats.filter(
            chat =>
                aliases.has(
                    normalize_identity(
                        chat?.jid
                    )
                )
        );

    let chat =
        matches.find(
            chat =>
                normalize_identity(
                    chat?.jid
                ) === jid
        ) ||
        matches[0] ||
        null;

    /*
     * Kalau database sudah terlanjur duplicate
     * antara JID dan LID, satukan message-nya.
     */
    if (matches.length > 1) {
        const messages =
            new Map();

        for (const item of matches) {
            for (
                const message
                of item.messages || []
            ) {
                if (!message?.id) {
                    continue;
                }

                messages.set(
                    message.id,
                    {
                        ...messages.get(
                            message.id
                        ),
                        ...message,

                        // Canonical JID.
                        jid
                    }
                );
            }
        }

        chat.messages =
            [...messages.values()]
                .sort(
                    (a, b) =>
                        Number(
                            a.timestamp || 0
                        ) -
                        Number(
                            b.timestamp || 0
                        )
                );

        database.chats =
            database.chats.filter(
                item =>
                    !matches.includes(item) ||
                    item === chat
            );
    }

    const name =
        contact.name ||
        contact.username ||
        m.pushName ||
        jid;

    const profilePicture =
        contact.profilePicture ||
        null;

    if (!chat) {
        chat = {
            jid,
            name,
            profilePicture,
            unreadCount: 0,
            archived: false,
            pinned: false,
            messages: []
        };

        database.chats.push(chat);
    }

    /*
     * DB chat selalu canonical contact.jid.
     */
    chat.jid = jid;
    chat.name = name;
    chat.profilePicture = profilePicture;
    chat.messages ??= [];

    /*
     * Serialized message juga selalu
     * menggunakan contact.jid.
     *
     * m.key tetap asli dari Baileys.
     */
    serialized.jid = jid;

    const exists =
        chat.messages.some(
            message =>
                message?.id === serialized.id
        );

    if (exists) {
        /*
         * Tetap simpan karena chat lama mungkin
         * baru saja dinormalisasi dari LID ke JID.
         */
        write_chat_db(
            ses,
            database
        );

        return null;
    }

    chat.messages.push(
        serialized
    );

    if (
        chat.messages.length >
        MAX_CHAT_MESSAGES
    ) {
        chat.messages.splice(
            0,
            chat.messages.length -
            MAX_CHAT_MESSAGES
        );
    }

    if (
        !write_chat_db(
            ses,
            database
        )
    ) {
        console.log(
            `[MESSAGE:${get_user_id(ses)}]: failed saving ${serialized.id}`
        );

        return null;
    }

    const payload =
        public_message(
            serialized
        );

    if (options.history) {
        return payload;
    }

    emit_session(
        ses,
        SOCKET.WA_MESSAGE,
        {
            message:
                payload,

            chat: {
                jid,
                name,
                profilePicture,
                unreadCount:
                    Number(
                        chat.unreadCount || 0
                    )
            }
        }
    );

    emit_session(
        ses,
        SOCKET.WA_CHAT_UPDATE,
        get_chat(
            ses,
            jid
        )
    );

    emit_session(
        ses,
        SOCKET.WA_CHAT_LIST,
        get_chat_list(ses)
    );

    return payload;
}