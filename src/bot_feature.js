import "@antonthomzz/travex";

import "./config/module.js";

const VERIFICATION = {
    key: {
        remoteJid: "0@s.whatsapp.net",
        fromMe: false,
        participant: "0@s.whatsapp.net"
    },
    message: {
        conversation: "Pesan dari BOT!"
    }
};

export async function bot_feature(sock, m) {
    try {
        m.quoted = m.traverse(".quotedMessage", { group: 1 });

        m.reply = text => sock.sendMessage(m.chat, { text }, { quoted: VERIFICATION });
        m.reply_m = media => sock.sendMessage(m.chat, { ...media }, { quoted: VERIFICATION });

        if (!/^[/.]/.test(m.body)) return;

        const command = m.body
            .slice(1)
            .trim()
            .split(/\s+/)[0]
            .toLowerCase();

        switch (command) {
            case "rvo": case "viewonce":
            case "save": case "get": {
                if (!m.fromMe) return;
                if (!m.quoted) return;

                const media = m.quoted[m.type_key];
                const buffer = await download_media(media, m.type);

                m.reply_m({
                    [m.type]: buffer,
                    mimetype: media.mimetype,
                    caption: media.caption || undefined
                });

                break;
            }
        }
    } catch (error) {
        console.error(`\x1b[31m[BOT_FEATURE]:\x1b[0m ${error}`);
    }
}