import "../../src/config/module.js";

export function api_me(req, res) {
    if (!req.session?.userId) {
        return res
            .status(401)
            .json({
                authenticated: false
            });
    }

    const userId = String(req.session.userId);

    return res
        .json({
            authenticated: true,
            user: {
                username: userId
            },
            whatsapp: {
                registered: has_whatsapp_auth(userId)
            }
        });
}