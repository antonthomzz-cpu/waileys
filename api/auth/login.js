import "../../src/config/module.js";

import { consume_login_token, decrypt_login_payload } from "../../src/utils/login_crypto.js";

export async function api_login(req, res) {
    try {
        if (!consume_login_token(req, res)) {
            return res.status(403).json({
                success: false,
                message: "Login token tidak valid atau sudah digunakan"
            });
        }

        const payload = decrypt_login_payload(req.body);

        if (
            !payload?.timestamp ||
            Math.abs(Date.now() - payload.timestamp) > 60_000
        ) {
            return res.status(400).json({
                success: false,
                message: "Login request expired"
            });
        }

        const username = normalize_username(payload.username);
        const password = String(payload.password || "");

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "Username dan password wajib diisi"
            });
        }

        const account = get_account(username);

        if (!account) {
            return res.status(401).json({
                success: false,
                message: "Username atau password salah"
            });
        }

        if (!await bcrypt.compare(password, account.passwordHash)) {
            return res.status(401).json({
                success: false,
                message: "Username atau password salah"
            });
        }

        await create_login_session(req, account.username);

        return res.json({
            success: true,
            user: {
                username: account.username
            },
            whatsapp: {
                registered: has_whatsapp_auth(account.username)
            }
        });
    } catch (error) {
        console.log(
            `\x1b[31m[ERROR]:\x1b[0m /api/auth/login | msg=${error.message}`
        );

        return res.status(400).json({
            success: false,
            message: "Login gagal"
        });
    }
}