import "@antonthomzz/travex";

import { downloadContentFromMessage } from "@whiskeysockets/baileys";

async function download_media(message, type) {
    try {
        const stream = await downloadContentFromMessage(message, type);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    } catch (error) {
        throw new Error(error);
    }
}

function m_text(message) {
    try {
        message = message?.message || {};
        return [
            message?.conversation,
            message?.extendedTextMessage?.text,
            message?.imageMessage?.caption,
            message?.videoMessage?.caption,
            message?.documentMessage?.caption,
            message?.buttonsResponseMessage?.selectedButtonId,
        ].find(value => typeof value === "string" && value.trim())?.trim() || "";
    } catch (error) {
        throw new Error(error);
    }
}


function m_type(m, key) {
    const message = m.traverse("#quotedMessage", { group: 1 });

    switch (true) {
        case !!message?.imageMessage:
            return Boolean(key) ? "imageMessage" : "image";

        case !!message?.videoMessage:
            return Boolean(key) ? "videoMessage" : "video";

        case !!message?.audioMessage:
            return Boolean(key) ? "audioMessage" : "audio";

        case !!message?.documentMessage:
            return Boolean(key) ? "documentMessage" : "document";

        case !!message?.stickerMessage:
            return Boolean(key) ? "stickerMessage" : "sticker";

        case !!message?.conversation:
        case !!message?.extendedTextMessage:
            return "text";

        default:
            return "unknown";
    }
}

// globalThis
Object.assign(globalThis, {
    download_media,
    m_text,
    m_type
});