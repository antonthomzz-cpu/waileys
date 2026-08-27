import "../../src/config/module.js";


export function api_media(req, res) {
    const authenticatedUserId = String(req.session.userId);
    const requestedUserId = String(req.params.userId || "");
    const id = String(req.params.id || "");

    if (requestedUserId !== authenticatedUserId) {
        return res
            .status(403)
            .end();
    }

    if (!id) {
        return res
            .status(400)
            .end();
    }

    const ses = get_session(authenticatedUserId);

    if (!(ses.media instanceof Map)) {
        ses.media = new Map();
    }

    let media = ses
        .media
        .get(id);

    if (!media) {
        const file = path.join(get_media_dir(ses), encodeURIComponent(id));

        if (fs.existsSync(file)) {
            const buffer = fs.readFileSync(file);
            const database = read_chat_db(ses);

            let found = null;

            for (const chat of database.chats || []) {
                if (!Array.isArray(chat?.messages)) {
                    continue;
                }

                found = chat
                    .messages
                    .find(i => i["id"] === id);

                if (found) {
                    break;
                }
            }

            media = {
                buffer,
                mimetype: found?.mimetype || "application/octet-stream",
                filename: found?.filename || `media-${id}`
            };

            ses.media.set(id, media);
        }
    }

    if (!media) {
        return res
            .status(404)
            .end();
    }

    res.setHeader("Content-Type", media.mimetype || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=3600");

    if (req.query.download === "1") {
        const filename = String(media.filename || `media-${id}`)
            .replace(/["\r\n]/g, "");

        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    }

    res.end(media.buffer);
}