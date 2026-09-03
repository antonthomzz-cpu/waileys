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
    fetch: {
        aliases: ["got"],
        description: "Fetch website data"
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


            case "fetch": {
                const url = m.args.join(" ").trim();

                if (!url) return m.reply("Contoh: /fetch https://example.com");

                let parsed;

                try {
                    parsed = new URL(url);
                    if (!["http:", "https:"].includes(parsed.protocol)) return m.reply("URL harus menggunakan http:// atau https://");
                } catch {
                    return m.reply("URL tidak valid");
                }

                try {
                    const response = await got(parsed.toString(), {
                        responseType: "buffer",
                        followRedirect: true,
                        timeout: { request: 30000 },
                        retry: { limit: 2 },
                        headers: {
                            "user-agent":
                                "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 " +
                                "(KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
                            "accept":
                                "text/html,application/xhtml+xml,application/json," +
                                "image/avif,image/webp,image/apng,image/svg+xml," +
                                "video/*,audio/*,*/*;q=0.8"
                        }
                    });

                    const buffer = response.body;

                    const contentType =
                        String(response.headers["content-type"] || "")
                            .split(";")[0]
                            .trim()
                            .toLowerCase();

                    const contentLength = Number(response.headers["content-length"] || buffer.length);

                    if (
                        contentType.startsWith("text/") ||
                        contentType.includes("json") ||
                        contentType.includes("xml") ||
                        contentType.includes("javascript")
                    ) {
                        const text = buffer.toString("utf8");
                        const MAX_TEXT = 60000;

                        if (text.length > MAX_TEXT) {
                            return m.reply(
                                `Content-Type: ${contentType}\n` +
                                `Status: ${response.statusCode}\n` +
                                `Ukuran: ${buffer.length} bytes\n\n` +
                                text.slice(0, MAX_TEXT) +
                                `\n\n... [dipotong]`
                            );
                        }

                        return m.reply(
                            `Content-Type: ${contentType}\n` +
                            `Status: ${response.statusCode}\n` +
                            `Ukuran: ${buffer.length} bytes\n\n` +
                            text
                        );
                    }

                    if (contentType.startsWith("image/")) {
                        return m.reply_m({
                            image: buffer,
                            mimetype: contentType,
                            caption:
                                `Content-Type: ${contentType}\n` +
                                `Ukuran: ${buffer.length} bytes`
                        });
                    }

                    if (contentType.startsWith("video/")) {
                        return m.reply_m({
                            video: buffer,
                            mimetype: contentType,
                            caption:
                                `Content-Type: ${contentType}\n` +
                                `Ukuran: ${buffer.length} bytes`
                        });
                    }

                    if (contentType.startsWith("audio/")) {
                        return m.reply_m({
                            audio: buffer,
                            mimetype: contentType,
                            ptt: true
                        });
                    }

                    const extensionMap = {
                        "application/pdf": "pdf",
                        "application/zip": "zip",
                        "application/x-rar-compressed": "rar",
                        "application/x-7z-compressed": "7z",
                        "application/octet-stream": "bin",
                        "application/vnd.android.package-archive": "apk"
                    };

                    const extension = extensionMap[contentType] || parsed.pathname.split(".").pop()?.slice(0, 10) || "bin";

                    return m.reply_m({
                        document: buffer,
                        mimetype: contentType || "application/octet-stream",
                        fileName: `fetch.${extension}`
                    });

                } catch (error) {
                    if (error.response) {
                        return m.reply(
                            `Fetch gagal\n\n` +
                            `Status: ${error.response.statusCode || "-"}\n` +
                            `URL: ${url}`
                        );
                    }

                    return m.reply(`Fetch gagal\n\n${error.message || "Unknown error"}`);
                }

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