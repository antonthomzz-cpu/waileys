import "../../src/config/module.js";

export async function api_register(req, res) {
    try {
        const username = normalize_username(req.body?.username);
        const password = String(req.body?.password || "");
        const confirmPassword = String(req.body?.confirmPassword || "");

        if (!valid_username(username)) {
            return res
                .status(400)
                .json({
                    success: false,
                    message: "Username harus 3-24 karakter dan hanya boleh berisi huruf, angka, atau underscore"
                });
        }

        if (password.length < 8) {
            return res
                .status(400)
                .json({
                    success: false,
                    message: "Password minimal 8 karakter"
                });
        }

        if (password !== confirmPassword) {
            return res
                .status(400)
                .json({
                    success: false,
                    message: "Konfirmasi password tidak sama"
                });
        }

        if (account_exists(username)) {
            return res
                .status(409)
                .json({
                    success: false,
                    message: "Username sudah digunakan"
                });
        }

        const database = read_account_db();
        const passwordHash = await bcrypt.hash(password, 12);

        database.users.push({
            id: _crypto.randomUUID(),
            username,
            passwordHash,
            createdAt: Date.now()
        });

        write_account_db(database);

        const ses = get_session(username);

        read_chat_db(ses);
        read_contact_db(ses);
        read_feature_db(ses);

        await create_login_session(req, username);

        return res
            .status(201)
            .json({
                success: true,
                user: { username },
                whatsapp: { registered: false }
            });
    } catch (error) {
        console.log(`\x1b[31m[ERROR]:\x1b[0m /api/auth/register | msg=${error.message}`);

        return res
            .status(500)
            .json({
                success: false,
                message: "Gagal membuat akun"
            });
    }
}