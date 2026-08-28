import crypto from "node:crypto";

const LOGIN_TTL = 60_000;
const LOGIN_COOKIE = "waton.login_once";
const LOGIN_CONTEXT = Buffer.from("waton-login-v1");
const loginTokens = new Map();

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
        type: "spki",
        format: "pem"
    },
    privateKeyEncoding: {
        type: "pkcs8",
        format: "pem"
    }
});


const hash = value => crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");


export function create_login_token(res) {
    const token = crypto
        .randomBytes(32)
        .toString("base64url");

    for (const [key, expires] of loginTokens) {
        if (expires <= Date.now()) {
            loginTokens.delete(key);
        }
    }

    loginTokens.set(hash(token), Date.now() + LOGIN_TTL);

    res.cookie(LOGIN_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: LOGIN_TTL });
    return publicKey;
}


export function consume_login_token(req, res) {
    const token = req.cookies?.[LOGIN_COOKIE];
    res.clearCookie(LOGIN_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/"});
    if (!token) {
        return false;
    }
    const key = hash(token);
    const expires = loginTokens.get(key);
    loginTokens.delete(key);
    return Boolean(expires && expires > Date.now());
}


export function decrypt_login_payload(payload) {
    if (!payload?.key || !payload?.iv || !payload?.tag || !payload?.data) {
        throw new Error("Invalid encrypted payload");
    }
    const aesKey = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256"}, Buffer.from(payload.key, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, Buffer.from(payload.iv, "base64"));
    decipher.setAAD(LOGIN_CONTEXT);
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.data, "base64")), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
}