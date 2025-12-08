import {
    ActionRowBuilder,
    ButtonBuilder,
    type ButtonInteraction,
    ButtonStyle,
    ComponentType,
    EmbedBuilder, // [GANTI] Pakai EmbedBuilder standar (Stabil & Anti-Crash)
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
        // --- 1. AMBIL QUERY ---
        let songQuery = "";
        if (ctx.options && typeof ctx.options.get === "function") {
            const songOpt = ctx.options.get("song");
            if (songOpt && typeof songOpt.value === "string") songQuery = songOpt.value;
        }
        if (!songQuery && ctx.args?.[0]) {
            songQuery = ctx.args.join(" ");
        }

        const player = client.manager.getPlayer(ctx.guild!.id);

        // Helper Locale (Anti-Crash)
        const getTxt = (key: string, args?: any, defaultTxt?: string) => {
            const res = ctx.locale(key, args);
            return res && res !== key ? res : (defaultTxt || "Unknown Text");
        };

        // Jika tidak ada lagu & query
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

        // Tentukan Target Lagu
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

        // Kirim pesan "Searching..."
        const searchingEmbed = new EmbedBuilder()
            .setColor(client.color.main)
            .setDescription(`🔎 ${getTxt("cmd.lyrics.searching", { trackTitle: trackTitle }, `Searching lyrics for **${trackTitle}**...`)}`);
        
        await ctx.sendDeferMessage({ embeds: [searchingEmbed] });

        // --- 2. PROSES PENCARIAN (HYBRID + SMART FILTER) ---
        try {
            const cleanTitle = this.cleanTitle(trackTitle);
            const isJp = this.isJapanese(trackTitle) || this.isJapanese(artistName);

            // A. GENIUS (ROMAJI) - SCANNING MODE
            if (isJp) {
                try {
                    // Cari dengan keyword "Romanized"
                    const romajiQuery = `${cleanTitle} ${artistName} Romanized`; 
                    const searches = await this.geniusClient.songs.search(romajiQuery);
                    
                    if (searches.length > 0) {
                        let selectedSong = null;

                        // [LOGIKA BARU] Scan hasil pencarian untuk menemukan "Genius Romanizations"
                        for (const s of searches) {
                            const t = s.title.toLowerCase();
                            const a = s.artist.name.toLowerCase();
                            
                            // Prioritaskan entry dari "Genius Romanizations" atau judul mengandung "Romanized"
                            if (a.includes("genius romanizations") || t.includes("romanized") || t.includes("romaji")) {
                                selectedSong = s;
                                break; // Ketemu! Stop looping.
                            }
                        }

                        // Jika ketemu yang spesifik Romaji, ambil itu.
                        // Jika tidak, JANGAN ambil yang pertama (karena biasanya Kanji), biarkan lanjut ke Plugin.
                        if (selectedSong) {
                            const text = await selectedSong.lyrics();
                            if (text && text.length > 10) {
                                lyricsResult = text;
                                isSynced = false;
                                // Override info agar sesuai Genius Romaji
                                trackTitle = selectedSong.title; 
                                artistName = selectedSong.artist.name;
                                artworkUrl = selectedSong.thumbnail;
                            }
                        }
                    }
                } catch (e) { }
            }

            // B. PLUGIN LAVALINK (Synced) - Jika Romaji tidak ketemu
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

            // C. GENIUS (NORMAL) - Fallback Terakhir (Kanji/Ori)
            if (!lyricsResult) {
                try {
                    const normalQuery = `${cleanTitle} ${artistName}`;
                    const searches = await this.geniusClient.songs.search(normalQuery);
                    if (searches.length > 0) {
                        const song = searches[0]; // Ambil yang paling atas
                        const text = await song.lyrics();
                        if (text && text.length > 10) {
                            lyricsResult = text;
                            isSynced = false;
                            trackTitle = song.title;
                            artistName = song.artist.name;
                            artworkUrl = song.thumbnail;
                        }
                    }
                } catch (e) { }
            }

        } catch (error) {
            client.logger.error(error);
        }

        // --- 3. FORMATTING HASIL ---
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

                // --- FUNGSI MEMBUAT EMBED ---
                const createLyricsEmbed = (pageIndex: number) => {
                    const embed = new EmbedBuilder()
                        .setColor(client.color.main)
                        .setTitle(trackTitle.substring(0, 250)) // Judul Aman
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

                // Tombol Navigasi
                const getNavigationRow = (current: number) => {
                    return new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId("prev").setEmoji(client.emoji.page.back).setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
                        new ButtonBuilder().setCustomId("stop").setEmoji(client.emoji.page.cancel).setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId("next").setEmoji(client.emoji.page.next).setStyle(ButtonStyle.Secondary).setDisabled(current === lyricsPages.length - 1),
                    );
                };

                // Tombol Live Lyrics
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

                // Kirim Pesan Awal (Pakai EmbedBuilder, bukan Container)
                await ctx.editMessage({
                    embeds: [createLyricsEmbed(currentPage)],
                    components: [getNavigationRow(currentPage), liveLyricsRow]
                });

                // --- 4. COLLECTOR ---
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

                        // HANDLE SUBSCRIBE (KARAOKE)
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
                                            // Ambil 5 baris sekitar baris aktif agar rapi
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
                                        await new Promise((res) => setTimeout(res, 1500)); // Update tiap 1.5 detik
                                    }
                                })();
                            }
                            continue;
                        }

                        // HANDLE UNSUBSCRIBE
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

                        // HANDLE NAVIGASI
                        if (interaction.customId === "prev") {
                            currentPage--;
                        } else if (interaction.customId === "next") {
                            currentPage++;
                        } else if (interaction.customId === "stop") {
                            collectorActive = false;
                            running = false;
                            await interaction.update({ components: [] }); // Hapus tombol
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

                // Cleanup Akhir
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

    // --- UTILS ---
    paginateLyrics(lyrics: string, ctx: Context): string[] {
        const lines = lyrics.split("\n");
        const pages: string[] = [];
        let currentPage = "";
        const MAX_CHARACTERS_PER_PAGE = 3000; // Embed Description max 4096, 3000 aman

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