import "../utils/bot.utils.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createServer } from "node:http";

import Pino from "pino";
import QRCode from "qrcode";
import express from "express";
import bcrypt from "bcryptjs";
import { Server } from "socket.io";
import expressSession from "express-session";
import sessionFileStore from "session-file-store";

import {
    proto,
    Browsers,
    makeWASocket,
    DisconnectReason,
    WAMessageStatus,
    jidNormalizedUser,
    downloadMediaMessage,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

import { bot_feature } from "../bot_feature.js";
import { SOCKET } from "./socket.js";
import { get_session, create_session } from "./store.js";

import {
    normalize_jid,
    public_message,
    get_user_dir,
    get_chat_database_path,
    get_contact_database_path,
    get_feature_database_path,
    get_media_dir,
    read_chat_db,
    write_chat_db,
    read_contact_db,
    write_contact_db,
    read_feature_db,
    write_feature_db,
    get_contact_list,
    get_contact,
    save_contact,
    update_profile_picture,
    get_chat,
    get_chat_list,
    unwrap_message,
    get_message_content,
    get_message_text,
    get_message_type,
    is_voice_note,
    get_mime,
    get_filename,
    get_timestamp,
    prepare_media,
    serialize_message,
    save_message,
    normalize_identity
} from "../utils/chat.utils.js";

const FileStore = sessionFileStore(expressSession);
const IGNORED_BROADCAST_JID = "status@broadcast";

const _root = path.resolve("./");
const _root_data = path.join(_root, "data");
const _root_data_media = path.join(_root_data, "media");

const ACCOUNT_DIR = path.join(_root_data, "accounts");
const ACCOUNT_FILE = path.join(ACCOUNT_DIR, "users.json");
const WEB_SESSION_DIR = path.join(_root_data, "web-sessions");
const SESSION_SECRET_FILE = path.join(
    ACCOUNT_DIR,
    ".session-secret"
);

fs.mkdirSync(_root_data, { recursive: true });
fs.mkdirSync(_root_data_media, { recursive: true });
fs.mkdirSync(ACCOUNT_DIR, { recursive: true });
fs.mkdirSync(WEB_SESSION_DIR, { recursive: true });

const app = express();
const http = createServer(app);

const io = new Server(http, {
    maxHttpBufferSize: 70 * 1024 * 1024,
    cors: {
        origin: "*"
    }
});

/* =========================================================
 * COMMON
 * ======================================================= */

function get_session_secret() {
    if (fs.existsSync(SESSION_SECRET_FILE)) {
        return fs.readFileSync(
            SESSION_SECRET_FILE,
            "utf8"
        ).trim();
    }

    const secret = crypto.randomBytes(48).toString("hex");

    fs.writeFileSync(SESSION_SECRET_FILE, secret, {
        encoding: "utf8",
        mode: 0o600
    });

    return secret;
}

function read_account_db() {
    if (!fs.existsSync(ACCOUNT_FILE)) {
        return {
            users: []
        };
    }

    try {
        const database = JSON.parse(
            fs.readFileSync(ACCOUNT_FILE, "utf8")
        );

        return {
            users: Array.isArray(database?.users)
                ? database.users
                : []
        };
    } catch (error) {
        console.log(`[ACCOUNT_DB]: ${error.message}`);

        return {
            users: []
        };
    }
}

function write_account_db(database) {
    const temp =
        `${ACCOUNT_FILE}.${process.pid}.${Date.now()}.tmp`;

    fs.writeFileSync(
        temp,
        JSON.stringify(database, null, 4),
        "utf8"
    );

    fs.renameSync(temp, ACCOUNT_FILE);

    return true;
}

function normalize_username(value) {
    return String(value || "").trim();
}

function username_key(value) {
    return normalize_username(value).toLowerCase();
}

function valid_username(username) {
    return /^[a-zA-Z0-9_]{3,24}$/.test(username);
}

function get_account(username) {
    const target = username_key(username);

    return read_account_db().users.find(
        user => username_key(user.username) === target
    ) || null;
}

function account_exists(username) {
    return Boolean(get_account(username));
}

function has_whatsapp_auth(userId) {
    return fs.existsSync(
        path.join(
            _root_data,
            "sessions",
            String(userId),
            "creds.json"
        )
    );
}

function user_room(userId) {
    return `user:${userId}`;
}

function emit_user(userId, event, data) {
    io.to(user_room(userId)).emit(event, data);
}

function emit_user_sync(userId, session) {
    emit_user(userId, SOCKET.WA_SYNC, {
        chats: get_chat_list(session),
        ready: session.ready
    });
}

function __log(userId, level, ...args) {
    const message = args
        .map(value => value instanceof Error ? value.stack || value.message : typeof value === "object" ? JSON.stringify(value) : String(value))
        .join(" ");

    emit_user(userId, "wa:log", {
        level,
        message,
        time: new Date().toLocaleTimeString("en-GB")
    });
}

function is_ignored_key(key={}) {
    return (
        normalize_jid(key.remoteJid || key.key?.remoteJid) === IGNORED_BROADCAST_JID ||
        normalize_jid(key.remoteJidAlt || key.key?.remoteJidAlt) === IGNORED_BROADCAST_JID
    );
}

/* =========================================================
 * WEB SESSION
 * ======================================================= */

const webSession = expressSession({
    name: "waton.sid",
    secret: get_session_secret(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: new FileStore({
        path: WEB_SESSION_DIR,
        ttl: 60 * 60 * 24 * 7,
        retries: 0
    }),
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
});

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

app.use(express.json({
    limit: "1mb"
}));

app.use(webSession);
app.use(express.static(path.join(_root, "public")));

io.engine.use(webSession);

function regenerate_web_session(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate(error => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

function save_web_session(req) {
    return new Promise((resolve, reject) => {
        req.session.save(error => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

async function create_login_session(req, userId) {
    await regenerate_web_session(req);

    req.session.userId = String(userId);
    req.session.createdAt = Date.now();

    await save_web_session(req);
}

function require_auth(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    next();
}

/* =========================================================
 * GLOBAL
 * ======================================================= */
const option = Object.freeze({
    debug: true,
    fatal: true
});

Object.assign(globalThis, {
    app,
    http,
    io,

    fs,
    path,
    Pino,
    QRCode,
    express,
    bcrypt,
    expressSession,
    sessionFileStore,
    FileStore,

    _crypto: crypto,
    _root,
    _root_data,
    _media_dir: _root_data_media,
    db_chat: path.join(_root_data, "db.chat.json"),

    ACCOUNT_DIR,
    ACCOUNT_FILE,
    WEB_SESSION_DIR,
    SESSION_SECRET_FILE,
    IGNORED_BROADCAST_JID,

    proto,
    Browsers,
    makeWASocket,
    DisconnectReason,
    WAMessageStatus,
    jidNormalizedUser,
    downloadMediaMessage,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,

    SOCKET,
    get_session,
    create_session,

    normalize_jid,
    public_message,
    get_user_dir,
    get_chat_database_path,
    get_contact_database_path,
    get_feature_database_path,
    get_media_dir,

    read_chat_db,
    write_chat_db,
    read_contact_db,
    write_contact_db,
    read_feature_db,
    write_feature_db,

    get_contact_list,
    get_contact,
    save_contact,
    update_profile_picture,

    get_chat,
    get_chat_list,

    unwrap_message,
    get_message_content,
    get_message_text,
    get_message_type,
    is_voice_note,
    get_mime,
    get_filename,
    get_timestamp,

    prepare_media,
    serialize_message,
    save_message,

    get_session_secret,
    read_account_db,
    write_account_db,
    normalize_username,
    username_key,
    valid_username,
    get_account,
    account_exists,
    has_whatsapp_auth,
    user_room,
    emit_user,
    emit_user_sync,
    __log,
    is_ignored_key,

    webSession,
    regenerate_web_session,
    save_web_session,
    create_login_session,
    require_auth,
    normalize_identity,
    option,
    bot_feature
});