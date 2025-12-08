import {
    ActionRowBuilder,
    ButtonBuilder,
    type ButtonInteraction,
    ButtonStyle,
    ComponentType,
    EmbedBuilder,
    MessageFlags,
} from "discord.js";
import { Command, type Context, type Lavamusic } from "../../structures/index";
import { LyricsLine, LyricsResult } from "lavalink-client";
import { Client } from "genius-lyrics";

export default class Lyrics extends Command {
    private geniusClient: Client;

    constructor(client: Lavamusic) {
        super(client, {
            name: "lyrics",
            description: {
                content: "cmd.lyrics.description",
                examples: ["lyrics", "lyrics song:Imagine Dragons - Believer"],
                usage: "lyrics [song]",
            },
            category: "music",
            aliases: ["ly"],
            cooldown: 3,
            args: false,
            vote: false,
            player: {
                voice: true,
                dj: false,
                active: false,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: [
                    "SendMessages",
                    "ReadMessageHistory",
                    "ViewChannel",
                    "EmbedLinks",
                    "AttachFiles",
                ],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: "song",
                    description: "cmd.lyrics.options.song.description",
                    type: 3,
                    required: false,
                },
            ],
        });

        // Setup Genius
        const token = process.env.GENIUS_API || process.env.GENIUS_API_KEY || process.env.GENIUS_TOKEN;
        this.geniusClient = new Client(token);
    }

    public async run(client: Lavamusic, ctx: Context): Promise<any> {
        let songQuery = "";
        if (ctx.options && typeof ctx.options.get === "function") {
            const songOpt = ctx.options.get("song");
            if (songOpt && typeof songOpt.value === "string") songQuery = songOpt.value;
        }
        if (!songQuery && ctx.args?.[0]) {
            songQuery = ctx.args.join(" ");
        }

        const player = client.manager.getPlayer(ctx.guild!.id);

        const getTxt = (key: string, args?: any, defaultTxt?: string) => {
            const res = ctx.locale(key, args);
            return res && res !== key ? res : (defaultTxt || "Unknown Text");
        };

        if (!songQuery && !player) {
            const embed = new EmbedBuilder()
                .setColor(client.color.red)
                .setDescription(getTxt("event.message.no_music_playing", {}, "❌ No music playing."));
            return ctx.sendMessage({ embeds: [embed] });
        }

        let trackTitle = "";
        let artistName = "";
        let trackUrl = "";
        let artworkUrl = "";
        let lyricsResult: LyricsResult | string | null = null;
        let isSynced = false;

        let targetTrack: any = null;

        if (songQuery) {
            const searchRes = await client.manager.search(songQuery, ctx.author);
            if (searchRes.tracks.length > 0) targetTrack = searchRes.tracks[0];
        } else if (player && player.queue.current) {
            targetTrack = player.queue.current;
        }

        if (!targetTrack) {
            const embed = new EmbedBuilder()
                .setColor(client.color.red)
                .setDescription(getTxt("cmd.lyrics.errors.no_results", {}, "❌ No results found."));
            return ctx.sendMessage({ embeds: [embed] });
        }

        trackTitle = targetTrack.info.title || "Unknown Title";
        artistName = targetTrack.info.author || "Unknown Artist";
        trackUrl = targetTrack.info.uri || "";
        artworkUrl = targetTrack.info.artworkUrl || "";

        const searchingEmbed = new EmbedBuilder()
            .setColor(client.color.main)
            .setDescription(`🔎 ${getTxt("cmd.lyrics.searching", { trackTitle: trackTitle }, `Searching lyrics for **${trackTitle}**...`)}`);
        
        await ctx.sendDeferMessage({ embeds: [searchingEmbed] });

        // --- 2. HYBRID FETCHING LOGIC ---
        try {
            const cleanTitle = this.cleanTitle(trackTitle);
            const isJp = this.isJapanese(trackTitle) || this.isJapanese(artistName);

            // =========================================================
            // A. GENIUS (ROMAJI) - MULTI-QUERY AGGRESSIVE MODE
            // =========================================================
            if (isJp) {
                // Daftar Query yang akan dicoba satu per satu
                const queriesToTry = [
                    `Genius Romanizations ${cleanTitle}`, // Coba 1: Artis Spesifik
                    `${cleanTitle} Romanized`,            // Coba 2: Judul + Romanized
                    `${cleanTitle} Romaji`,               // Coba 3: Judul + Romaji
                    `${artistName} ${cleanTitle} Romanized` // Coba 4: Lengkap
                ];

                for (const query of queriesToTry) {
                    if (lyricsResult) break; // Jika sudah ketemu, berhenti loop

                    try {
                        const searches = await this.geniusClient.songs.search(query);
                        
                        // SCAN SEMUA HASIL (Bukan cuma yang teratas)
                        for (const s of searches) {
                            const t = s.title.toLowerCase();
                            const a = s.artist.name.toLowerCase();
                            
                            // Kriteria ROMAJI:
                            // 1. Artisnya "Genius Romanizations"
                            // 2. ATAU Judul mengandung "Romanized" / "Romaji"
                            const isRomanized = a.includes("genius romanizations") || t.includes("romanized") || t.includes("romaji");

                            if (isRomanized) {
                                const text = await s.lyrics();
                                if (text && text.length > 10) {
                                    lyricsResult = text;
                                    isSynced = false;
                                    // Update Info agar sesuai Genius
                                    trackTitle = s.title;
                                    artistName = s.artist.name;
                                    artworkUrl = s.thumbnail;
                                    // STOP SEMUA LOOP
                                    break;
                                }
                            }
                        }
                    } catch (e) { /* Lanjut ke query berikutnya */ }
                }
            }

            // =========================================================
            // B. PLUGIN LAVALINK (Synced - Backup 1)
            // =========================================================
            if (!lyricsResult) {
                try {
                    let res: LyricsResult | null = null;
                    if (player && player.queue.current?.info.uri === targetTrack.info.uri) {
                        res = await player.getCurrentLyrics(false);
                    } else {
                        const node = client.manager.nodeManager.leastUsedNodes()[0];
                        res = await node.lyrics.get(targetTrack, true);
                    }

                    if (res) {
                        lyricsResult = res;
                        if (typeof res === 'object' && Array.isArray(res.lines) && res.lines.length > 0) {
                            isSynced = true;
                        } else {
                            isSynced = false;
                        }
                    }
                } catch (e) { }
            }

            // =========================================================
            // C. GENIUS (NORMAL - Backup Terakhir)
            // =========================================================
            if (!lyricsResult) {
                try {
                    const normalQuery = `${cleanTitle} ${artistName}`;
                    const searches = await this.geniusClient.songs.search(normalQuery);
                    
                    // Loop sedikit untuk mencari yang paling relevan (hindari cover/remix jika bisa)
                    for (const s of searches) {
                        const t = s.title.toLowerCase();
                        // Hindari instrumental atau remix jika pencarian utama gagal
                        if (!t.includes("instrumental")) {
                            const text = await s.lyrics();
                            if (text && text.length > 10) {
                                lyricsResult = text;
                                isSynced = false;
                                trackTitle = s.title;
                                artistName = s.artist.name;
                                artworkUrl = s.thumbnail;
                                break;
                            }
                        }
                    }
                } catch (e) { }
            }

        } catch (error) {
            client.logger.error(error);
        }

        // --- 3. FORMATTING (EmbedBuilder) ---
        try {
            let lyricsText: string | null = null;
            if (lyricsResult && typeof lyricsResult === "object" && Array.isArray((lyricsResult as LyricsResult).lines)) {
                lyricsText = (lyricsResult as LyricsResult).lines!.map((l: LyricsLine) => l.line).join("\n");
            } else if (typeof lyricsResult === "object" && (lyricsResult as any).text) {
                lyricsText = (lyricsResult as any).text;
            } else if (typeof lyricsResult === "string") {
                lyricsText = lyricsResult;
            }

            if (!lyricsText || lyricsText.length < 10) {
                const embed = new EmbedBuilder()
                    .setColor(client.color.red)
                    .setDescription(getTxt("cmd.lyrics.errors.no_results", {}, "❌ No lyrics found."));
                await ctx.editMessage({ embeds: [embed], components: [] });
                return;
            }

            const cleanedLyrics = this.cleanLyrics(lyricsText);

            if (cleanedLyrics && cleanedLyrics.length > 0) {
                const lyricsPages = this.paginateLyrics(cleanedLyrics, ctx);
                let currentPage = 0;

                const createLyricsEmbed = (pageIndex: number) => {
                    const embed = new EmbedBuilder()
                        .setColor(client.color.main)
                        .setTitle(trackTitle.substring(0, 250))
                        .setURL(trackUrl.startsWith('http') ? trackUrl : null)
                        .setAuthor({ name: artistName.substring(0, 250) || "Unknown Artist" });

                    if (this.isValidUrl(artworkUrl)) {
                        embed.setThumbnail(artworkUrl);
                    }

                    const pageContent = lyricsPages[pageIndex] || "No lyrics on this page.";
                    embed.setDescription(pageContent);

                    const footerText = getTxt("cmd.lyrics.page_indicator", {
                        current: pageIndex + 1,
                        total: lyricsPages.length,
                    }, `Page ${pageIndex + 1}/${lyricsPages.length}`);
                    
                    embed.setFooter({ text: footerText });

                    return embed;
                };

                const getNavigationRow = (current: number) => {
                    return new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId("prev").setEmoji(client.emoji.page.back).setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
                        new ButtonBuilder().setCustomId("stop").setEmoji(client.emoji.page.cancel).setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId("next").setEmoji(client.emoji.page.next).setStyle(ButtonStyle.Secondary).setDisabled(current === lyricsPages.length - 1),
                    );
                };

                const liveLyricsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setCustomId("lyrics_subscribe")
                        .setLabel(getTxt("cmd.lyrics.button_subscribe", {}, "Subscribe"))
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(!isSynced),
                    new ButtonBuilder()
                        .setCustomId("lyrics_unsubscribe")
                        .setLabel(getTxt("cmd.lyrics.button_unsubscribe", {}, "Unsubscribe"))
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(!isSynced),
                );

                await ctx.editMessage({
                    embeds: [createLyricsEmbed(currentPage)],
                    components: [getNavigationRow(currentPage), liveLyricsRow]
                });

                const filter = (interaction: ButtonInteraction<"cached">) => interaction.user.id === ctx.author?.id;
                let collectorActive = true;
                let running = false;
                let lyricsUpdater: Promise<void> | null = null;
                let lastLine = -1;
                let subscriptionActive = false;

                while (collectorActive) {
                    try {
                        const interaction = await ctx.channel.awaitMessageComponent({
                            filter,
                            componentType: ComponentType.Button,
                            time: 60000,
                        });

                        if (interaction.customId === "lyrics_subscribe") {
                            await interaction.reply({ content: getTxt("cmd.lyrics.subscribed", {}, "✅ Subscribed!"), flags: MessageFlags.Ephemeral });
                            
                            if (isSynced && typeof lyricsResult === 'object' && (lyricsResult as LyricsResult).lines) {
                                running = true;
                                subscriptionActive = true;
                                const lyricsLines = (lyricsResult as LyricsResult).lines!;
                                
                                lyricsUpdater = (async () => {
                                    while (running) {
                                        if (!player || !player.playing) break;
                                        const position = player.position;
                                        let currentIdx = lyricsLines.findIndex((l) => {
                                            const time = (l as any).startTime ?? (l as any).time ?? (l as any).timestamp;
                                            return typeof time === "number" && time > position;
                                        });
                                        if (currentIdx === -1) currentIdx = lyricsLines.length - 1;
                                        else if (currentIdx > 0) currentIdx--;
                                        
                                        if (currentIdx !== lastLine) {
                                            lastLine = currentIdx;
                                            const startLine = Math.max(0, currentIdx - 2);
                                            const endLine = Math.min(lyricsLines.length, currentIdx + 4);
                                            
                                            const formatted = lyricsLines.slice(startLine, endLine)
                                                .map((l, idx) => {
                                                    const realIdx = startLine + idx;
                                                    return realIdx === currentIdx ? `**__${l.line}__**` : l.line;
                                                }).join("\n");
                                            
                                            const liveEmbed = new EmbedBuilder()
                                                .setColor(client.color.main)
                                                .setTitle(`🎶 ${trackTitle}`)
                                                .setDescription(formatted + "\n\n*Live Synced Lyrics*")
                                                .setFooter({ text: "Press Unsubscribe to return." });

                                            await ctx.editMessage({ embeds: [liveEmbed], components: [liveLyricsRow] }).catch(() => running = false);
                                        }
                                        await new Promise((res) => setTimeout(res, 1500));
                                    }
                                })();
                            }
                            continue;
                        }

                        if (interaction.customId === "lyrics_unsubscribe") {
                            running = false;
                            subscriptionActive = false;
                            await interaction.update({
                                embeds: [createLyricsEmbed(currentPage)],
                                components: [getNavigationRow(currentPage), liveLyricsRow]
                            });
                            if (lyricsUpdater) await lyricsUpdater;
                            continue;
                        }

                        if (interaction.customId === "prev") {
                            currentPage--;
                        } else if (interaction.customId === "next") {
                            currentPage++;
                        } else if (interaction.customId === "stop") {
                            collectorActive = false;
                            running = false;
                            await interaction.update({ components: [] });
                            break;
                        }

                        if (!subscriptionActive) {
                            await interaction.update({
                                embeds: [createLyricsEmbed(currentPage)],
                                components: [getNavigationRow(currentPage), liveLyricsRow]
                            });
                        }

                    } catch (e) {
                        collectorActive = false;
                    }
                }

                if (ctx.guild?.members.me?.permissionsIn(ctx.channelId).has("SendMessages")) {
                    await ctx.editMessage({ components: [] }).catch(() => null);
                }

            } else {
                const embed = new EmbedBuilder()
                    .setColor(client.color.red)
                    .setDescription(getTxt("cmd.lyrics.errors.no_results", {}, "❌ Lyrics empty."));
                await ctx.editMessage({ embeds: [embed], components: [] });
            }

        } catch (error) {
            client.logger.error(error);
            const embed = new EmbedBuilder()
                .setColor(client.color.red)
                .setDescription(getTxt("cmd.lyrics.errors.lyrics_error", {}, "❌ An error occurred."));
            await ctx.editMessage({ embeds: [embed], components: [] });
        }
    }

    paginateLyrics(lyrics: string, ctx: Context): string[] {
        const lines = lyrics.split("\n");
        const pages: string[] = [];
        let currentPage = "";
        const MAX_CHARACTERS_PER_PAGE = 3000;

        for (const line of lines) {
            const lineWithNewline = `${line}\n`;
            if (currentPage.length + lineWithNewline.length > MAX_CHARACTERS_PER_PAGE) {
                if (currentPage.trim()) pages.push(currentPage.trim());
                currentPage = lineWithNewline;
            } else {
                currentPage += lineWithNewline;
            }
        }
        if (currentPage.trim()) pages.push(currentPage.trim());
        if (pages.length === 0) pages.push("Lyrics unavailable.");
        return pages;
    }

    private cleanLyrics(lyrics: string): string {
        return lyrics
            .replace(/^(\d+\s*Contributors.*?Lyrics|.*Contributors.*|Lyrics\s*|.*Lyrics\s*)$/gim, "")
            .replace(/\[.*?\]/g, "")
            .replace(/^[\s\n\r]+/, "")
            .replace(/[\s\n\r]+$/, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    private cleanTitle(title: string): string {
        return title
            .replace(/\[.*?\]|\(.*?\)|{.*?}/g, "") 
            .replace(/official video|lyrics|audio|mv|official/gi, "")
            .trim();
    }

    private isJapanese(text: string | undefined): boolean {
        if (!text) return false;
        return /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(text);
    }

    private isValidUrl(url: string | null | undefined): boolean {
        if (!url) return false;
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch (e) {
            return false;
        }
    }
}