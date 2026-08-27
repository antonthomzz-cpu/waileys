import "../../src/config/module.js";

export async function api_login(req, res) {
    try {
        const username = normalize_username(req.body?.username);
        const password = String(req.body?.password || "");

        if (!username || !password) {
            return res
                .status(400)
                .json({
                    success: false,
                    message: "Username dan password wajib diisi"
                });
        }

        const account = get_account(username);

        if (!account) {
            return res
                .status(401)
                .json({
                    success: false,
                    message: "Username atau password salah"
                });
        }

        const validPassword = await bcrypt.compare(password, account.passwordHash);

        if (!validPassword) {
            return res
                .status(401)
                .json({
                    success: false,
                    message: "Username atau password salah"
                });
        }

        await create_login_session(req, account.username);

        return res
            .json({
                success: true,
                user: {
                    username: account.username
                },
                whatsapp: {
                    registered: has_whatsapp_auth(account.username)
                }
            });
    } catch (error) {
        console.log(`\x1b[31m[ERROR]:\x1b[0m /api/auth/login | msg=${error.message}`);

        return res
            .status(500)
            .json({
                success: false,
                message: "Login gagal"
            });
    }
}