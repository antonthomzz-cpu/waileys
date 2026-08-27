import "../../src/config/module.js";


export function api_logout(req, res) {
    const userId = String(req.session.userId);

    req
        .session
        .destroy((error) => {
            if (error) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message: "Logout gagal"
                    });
                }

            res
                .clearCookie("waton.sid");
            io
                .in(`user:${userId}`)
                .disconnectSockets(true);

            return res
                .json({
                    success: true
                });
        });
}