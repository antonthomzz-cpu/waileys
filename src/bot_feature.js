import "@antonthomzz/travex";
import got from "got";

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


export async function bot_feature(sock, m) {
    try {
        m.args = m.body
            .slice(1)
            .trim()
            .split(/\s+/);

        m.command = m.args
            .shift()?
            .toLowerCase();

        // GET_QUOTED_MESSAGE
        m.quoted = m.traverse(".quotedMessage", { group: 1 });

        // REPLY_TEXT
        m.reply = text => sock.sendMessage(m.chat,
            { text },
            { quoted: VERIFICATION }
        );

        // REPLY_MEDIA
        m.reply_m = async (media) => await sock.sendMessage(m.chat,
            { ...media },
            { quoted: VERIFICATION }
        );


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

        // AUTO_DOWNLOAD_FACEBOOK_VIDEO
        for (const [url] of m.body.matchAll(/https?:\/\/(?:www\.)?facebook\.com\/(?:reel\/\d+|share\/r\/[a-zA-Z0-9]+)/g)) {
            try {
                const html = await got(url, {
                    headers: {
                        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                        "accept-language": "id-MM,id-ID;q=0.9,id;q=0.8,en-US;q=0.7,en;q=0.6",
                        "cache-control": "max-age=0",
                        priority: "u=0, i",
                        "sec-ch-prefers-color-scheme": "dark",
                        "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"150\", \"Google Chrome\";v=\"150\"",
                        "sec-ch-ua-mobile": "?0",
                        "sec-ch-ua-model": "\"\"",
                        "sec-ch-ua-platform": "\"Linux\"",
                        "sec-ch-ua-platform-version": "\"\"",
                        "sec-fetch-dest": "document",
                        "sec-fetch-mode": "navigate",
                        "sec-fetch-site": "same-origin",
                        "sec-fetch-user": "?1",
                        "upgrade-insecure-requests": "1",
                        "viewport-width": "150"
                    }
                }).text();

                const search_json_data = await html.findall("data-sjs>({.*?ScheduledServerJS.*?})</script>");
                const search_url_data = search_json_data.traverse("#videoDeliveryLegacyFields", { group: 1 });
                const video_url = search_url_data[["browser_native_hd_url", "browser_native_sd_url"].find(key => search_url_data[key])];

                if (video_url) {
                    await m.reply_m({
                        video: {
                            url: video_url
                        }
                    });
                }
            } catch {
                m.reply("gagal download vidio facebook");
            }
        }

        if (!/^[/.]/.test(m.body)) return;

        switch (m.command) {
            // START FITUR_STICKER
            case "s": case "sticker": {
                const media =
                    m.quoted?.imageMessage ||
                    m.quoted?.videoMessage ||
                    m.message?.imageMessage ||
                    m.message?.videoMessage;

                if (!media) {
                    return m.reply("Balas foto/vidio dengan pesan /sticker");
                }

                const buffer = await downloadMediaMessage(m.quoted ? { message: m.quoted } : m, "buffer", {}, {});

                const sticker = await new Sticker(buffer, {
                    pack: "Anton",
                    author: "Anton",
                    type: StickerTypes.FULL,
                    quality: 100
                }).toBuffer();

                await m.reply_m({ sticker });
                break;
            }
            // END FITUR_STICKER


            // START FITUR_BRAT
            case "brat": {
                const text = m.args.join(" ");

                if (!text) {
                    return m.reply("Contoh: /brat waton nih");
                }

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
            // END FITUR_BRAT


            // FITUR_ADMIN
            case "rvo": case "viewonce":
            case "save": case "get": {
                if (!m.fromMe) return;
                if (!m.quoted) return;

                const media = m.quoted[m.type_key];
                const buffer = await download_media(media, m.type);

                await m.reply_m({
                    [m.type]: buffer,
                    mimetype: media.mimetype,
                    caption: media.caption || undefined
                });

                break;
            }

            default: {
                m.reply("Fitur tidak tersedia!");
            }
        }
    } catch (error) {
        console.error(`\x1b[31m[BOT_FEATURE]:\x1b[0m ${error}`);
    }
}