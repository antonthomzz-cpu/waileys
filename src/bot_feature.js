import "@antonthomzz/travex";

import got from "got";
import sharp from "sharp";
import jsQR from "jsqr";

import "./config/module.js";

import { Sticker, StickerTypes } from "wa-sticker-formatter";
import { bratGen } from "brat-canvas";

const VERIFICATION = {
    key: {
        remoteJid: "0@s.whatsapp.net",
        fromMe: false,
        participant: "0@s.whatsapp.net"
    },
    message: {
        conversation: "༼⁠ ⁠つ⁠ ⁠◕⁠‿⁠◕⁠ ⁠༽⁠つ WATon - Asisten anda"
    }
};

const MEDIA_TYPES = Object.freeze({
    imageMessage: "image",
    videoMessage: "video",
    audioMessage: "audio",
    stickerMessage: "sticker",
    documentMessage: "document"
});

const FEATURES = Object.freeze({
    scanqr: {
        aliases: ["qrscan"],
        description: "Scan QR dari gambar/sticker"
    },
    toimg: {
        aliases: ["s2img"],
        description: "Ubah sticker menjadi gambar"
    },
    sticker: {
        aliases: ["s"],
        description: "Ubah gambar/video menjadi sticker"
    },
    brat: {
        aliases: [],
        description: "Buat sticker brat"
    },
    rvo: {
        aliases: ["viewonce", "save", "get"],
        description: "Ambil media quoted",
        admin: true
    }
});


const COMMANDS = Object.fromEntries(
    Object.entries(FEATURES).flatMap(([command, feature]) => [
        [command, command],
        ...feature.aliases.map(alias => [alias, command])
    ])
);


export async function bot_feature(sock, m) {
    try {
        m.args = m.body
            .slice(1)
            .trim()
            .split(/\s+/);

        m.inputCommand = m.args.shift()?.toLowerCase();
        m.command = COMMANDS[m.inputCommand] || m.inputCommand;

        // GET_QUOTED_MESSAGE
        m.quoted = m.traverse(".quotedMessage", { group: 1 });

        // REPLY
        m.reply = text => sock.sendMessage(
            m.chat,
            { text },
            { quoted: VERIFICATION }
        );

        m.reply_m = media => sock.sendMessage(
            m.chat,
            media,
            { quoted: VERIFICATION }
        );

        // MEDIA
        m.isQuoted = !!m.quoted;
        m.mediaSource = m.quoted || m.message;

        m.mediaKey = Object.keys(MEDIA_TYPES).find(key =>
            m.mediaSource?.[key]
        ) || null;

        m.media = m.mediaKey
            ? m.mediaSource[m.mediaKey]
            : null;

        m.type = MEDIA_TYPES[m.mediaKey] || null;

        m.isMedia = !!m.media;
        m.isImage = m.type === "image";
        m.isVideo = m.type === "video";
        m.isAudio = m.type === "audio";
        m.isSticker = m.type === "sticker";
        m.isDocument = m.type === "document";
        m.isAnimated = m.isSticker && !!m.media?.isAnimated;
        m.isViewOnce = !!m.media?.viewOnce;

        let mediaBuffer = null;

        m.getBuffer = async () => {
            if (!m.isMedia) return null;

            return mediaBuffer ??= await downloadMediaMessage(
                m.quoted ? { message: m.quoted } : m,
                "buffer",
                {},
                {}
            );
        };

        // AUTO_DOWNLOAD_TIKTOK_VIDEO
        for (const [url] of m.body.matchAll(/https?:\/\/(?:vt|vm|www)?\.?tiktok\.com\/[^\s]+/gi)) {
            try {
                const { data } = await got.post("https://www.tikwm.com/api/", {
                    form: {
                        url,
                        hd: 1
                    }
                }).json();

                if (Array.isArray(data?.images) && data.images.length) {
                    for (const image of data.images) {
                        await m.reply_m({
                            image: {
                                url: image
                            }
                        });
                    }
                    continue;
                }

                const video = data?.hdplay || data?.play;

                if (video) {
                    await m.reply_m({
                        video: {
                            url: video
                        }
                    });
                }
            } catch {
                m.reply("gagal download TikTok");
            }
        }

        if (!m.body.startsWith("/")) return;

        switch (m.command) {
            case "scanqr": {
                if (!(m.isImage || m.isSticker)) return m.reply("Balas gambar/sticker QR dengan /scanqr");

                const buffer = await m.getBuffer();
                const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
                const qr = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: "attemptBoth" });

                if (!qr?.data) return m.reply("QR tidak ditemukan");

                await m.reply(`Hasil QR:\n\n${qr.data}`);
                break;
            }


            case "toimg": {
                if (!m.isSticker) return m.reply("Balas sticker dengan /toimg");

                const image = await sharp(await m.getBuffer()).png().toBuffer();

                await m.reply_m({
                    image,
                    mimetype: "image/png"
                });

                break;
            }


            case "sticker": {
                if (!(m.isImage || m.isVideo)) return m.reply("Balas foto/video dengan /sticker");

                const sticker = await new Sticker(await m.getBuffer(), {
                    pack: "Anton",
                    author: "Anton",
                    type: StickerTypes.FULL,
                    quality: 100
                }).toBuffer();

                await m.reply_m({ sticker });
                break;
            }


            case "brat": {
                const text = m.args.join(" ");

                if (!text) return m.reply("Contoh: /brat waton nih");

                const buffer = await bratGen(text, {
                    theme: "white",
                    BLUR: 2
                });

                const sticker = await new Sticker(buffer, {
                    pack: "Anton",
                    author: "Anton",
                    type: StickerTypes.FULL,
                    quality: 100
                }).toBuffer();

                await m.reply_m({ sticker });
                break;
            }


            case "rvo": {
                if (!m.fromMe || !m.isQuoted || !m.isMedia) return;

                const buffer = await m.getBuffer();

                await m.reply_m({
                    [m.type]: buffer,
                    mimetype: m.media.mimetype,
                    caption: m.media.caption || undefined
                });
                break;
            }


            default: {
                const features = Object.entries(FEATURES)
                    .filter(([, feature]) => !feature.admin || m.fromMe)
                    .map(([command, feature]) => {
                        const aliases = feature.aliases.length
                            ? ` (${feature.aliases.map(v => `/${v}`).join(", ")})`
                            : "";

                        return `/${command}${aliases}\n└ ${feature.description}`;
                    }).join("\n\n");

                return m.reply(
                    `Fitur /${m.inputCommand} tidak tersedia!\n\n` +
                    `Fitur tersedia:\n\n${features}`
                );
            }
        }
    } catch (error) {
        console.error(`\x1b[31m[BOT_FEATURE]:\x1b[0m ${error}`);
    }
}