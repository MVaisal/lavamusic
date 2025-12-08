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

export default class Lyrics extends Command {
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
    }

    public async run(client: Lavamusic, ctx: Context): Promise<any> {
        // --- HELPER: SAFE STRING & LOCALE ---
        // Memastikan output selalu string agar EmbedBuilder tidak crash
        const safeStr = (str: any): string => {
            if (typeof str === 'string') return str;
            if (!str) return "";
            return String(str);
        };

        const getTxt = (key: string, args?: any, defaultTxt?: string) => {
            try {
                const res = ctx.locale(key, args);
                if (!res || res === key) return defaultTxt || " ";
                return safeStr(res);
            } catch (e) {
                return defaultTxt || " ";
            }
        };

        // 1. Ambil Query Lagu
        let songQuery = "";
        if (ctx.options && typeof ctx.options.get === "function") {
            try { 
                const songOpt = ctx.options.get("song");
                if (songOpt && typeof songOpt.value === "string") songQuery = songOpt.value;
            } catch (e) { /* ignore */ }
        }
        if (!songQuery && ctx.args?.[0]) songQuery = Array.isArray(ctx.args) ? ctx.args.join(" ") : safeStr(ctx.args);

        const player = client.manager.getPlayer(ctx.guild!.id);

        // 2. Cek apakah ada lagu diputar atau input query
        if (!songQuery && !player) {
            const noMusicEmbed = new EmbedBuilder()
                .setColor(client.color.red)
                .setDescription(getTxt("event.message.no_music_playing", {}, "No music playing"));
            
            return ctx.sendMessage({
                embeds: [noMusicEmbed],
            });
        }

        let trackTitle = "Unknown Title";
        let artistName = "Unknown Artist";
        let trackUrl = "https://discord.com";
        let artworkUrl = "";
        let lyricsResult: LyricsResult | string = "";

        // 3. Fetch Data Lirik & Track Info
        if (songQuery) {
            const result = await this.fetchTrackAndLyrics({ client, ctx, songQuery, player });
            if (!result) return;
            lyricsResult = result.lyricsResult;
            trackTitle = safeStr(result.trackTitle) || "Unknown Title";
            artistName = safeStr(result.artistName) || "Unknown Artist";
            trackUrl = safeStr(result.trackUrl) || "https://discord.com";
            artworkUrl = safeStr(result.artworkUrl) || "";
        } else if (player && player.queue.current) {
            lyricsResult = await player.getCurrentLyrics(false);
            const track = player.queue.current;
            trackTitle = safeStr(track.info.title).replace(/\[.*?]|\(.*?\)|{.*?}/g, "").trim() || "Unknown Title";
            artistName = safeStr(track.info.author).replace(/\[.*?]|\(.*?\)|{.*?}/g, "").trim() || "Unknown Artist";
            trackUrl = (track.info.uri && track.info.uri.startsWith("http")) ? track.info.uri : "https://discord.com";
            artworkUrl = safeStr(track.info.artworkUrl) || "";
        }

        // Potong judul jika terlalu panjang (Embed Title limit 256 chars)
        const safeTitle = trackTitle.length > 250 ? trackTitle.substring(0, 245) + "..." : trackTitle;

        // 4. Kirim Pesan "Searching..."
        const searchingEmbed = new EmbedBuilder()
            .setColor(client.color.main)
            .setDescription(getTxt("cmd.lyrics.searching", { trackTitle: safeTitle }, `Searching for ${safeTitle}...`));

        await ctx.sendDeferMessage({
            embeds: [searchingEmbed],
        });

        try {
            // 5. Parsing Hasil Lirik
            let lyricsText: string | null = null;
            if (lyricsResult && typeof lyricsResult === "object") {
                if(Array.isArray((lyricsResult as any).lines)) {
                    lyricsText = (lyricsResult as any).lines.map((l: any) => safeStr(l.line)).join("\n");
                } else if ((lyricsResult as any).text) {
                    lyricsText = safeStr((lyricsResult as any).text);
                }
            } else if (typeof lyricsResult === "string") {
                lyricsText = lyricsResult;
            }

            // Validasi Lirik Kosong
            if (!lyricsText || lyricsText.length < 5) {
                const noResultsEmbed = new EmbedBuilder()
                    .setColor(client.color.red)
                    .setDescription(getTxt("cmd.lyrics.errors.no_results", {}, "No results found."));
                await ctx.editMessage({ embeds: [noResultsEmbed] });
                return;
            }

            const cleanedLyrics = this.cleanLyrics(lyricsText);

            if (cleanedLyrics && cleanedLyrics.length > 0) {
                const lyricsPages = this.paginateLyrics(cleanedLyrics, ctx);
                let currentPage = 0;

                // --- BUILDER EMBED (Standard Embed) ---
                const createLyricsEmbed = (pageIndex: number, finalState: boolean = false) => {
                    const currentLyricsPage = lyricsPages[pageIndex] || "End.";

                    const embed = new EmbedBuilder()
                        .setColor(client.color.main)
                        .setTitle(safeTitle)
                        .setURL(trackUrl)
                        .setDescription(currentLyricsPage);

                    if (artistName && artistName !== "Unknown Artist") {
                        embed.setAuthor({ name: artistName });
                    }

                    // Hanya set thumbnail jika URL valid (dimulai dengan http/https)
                    if (artworkUrl && artworkUrl.startsWith("http")) {
                        embed.setThumbnail(artworkUrl);
                    }

                    if (!finalState) {
                        embed.setFooter({ 
                            text: getTxt("cmd.lyrics.page_indicator", { current: pageIndex + 1, total: lyricsPages.length }, `Page ${pageIndex + 1}/${lyricsPages.length}`) 
                        });
                    } else {
                        embed.setFooter({ 
                            text: getTxt("cmd.lyrics.session_expired", {}, "Session Expired") 
                        });
                    }

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
                    new ButtonBuilder().setCustomId("lyrics_subscribe").setLabel("Subscribe").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("lyrics_unsubscribe").setLabel("Unsubscribe").setStyle(ButtonStyle.Danger),
                );

                // Update pesan awal dengan lirik
                await ctx.editMessage({
                    embeds: [createLyricsEmbed(currentPage)],
                    components: [getNavigationRow(currentPage), liveLyricsRow],
                });

                // --- COLLECTOR (LOGIKA INTERAKSI) ---
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

                        // [CASE 1] SUBSCRIBE LIVE LYRICS
                        if (interaction.customId === "lyrics_subscribe") {
                            await interaction.reply({ content: "Subscribed to live lyrics!", flags: MessageFlags.Ephemeral });
                            
                            running = true;
                            subscriptionActive = true;
                            const maxTime = Date.now() + 3 * 60 * 1000; // Max 3 menit live
                            const lyricsLines = (lyricsResult as any).lines;
                            
                            if (lyricsLines && Array.isArray(lyricsLines)) {
                                lyricsUpdater = (async () => {
                                    while (running && Date.now() < maxTime) {
                                        if (!player || !player.playing) break;
                                        const position = player.position;
                                        
                                        // Cari index lirik berdasarkan waktu
                                        let currentIdx = lyricsLines.findIndex((l: any) => {
                                            const time = l.startTime ?? l.time ?? l.timestamp;
                                            return typeof time === "number" && time > position;
                                        });
                                        if (currentIdx === -1) currentIdx = lyricsLines.length - 1;
                                        else if (currentIdx > 0) currentIdx--;

                                        if (currentIdx !== lastLine) {
                                            lastLine = currentIdx;
                                            
                                            // Tampilkan potongan 7 baris (3 atas, 1 tengah, 3 bawah)
                                            const startLine = Math.max(0, currentIdx - 3);
                                            const endLine = Math.min(lyricsLines.length, currentIdx + 4);
                                            
                                            const formatted = lyricsLines.slice(startLine, endLine)
                                                .map((l: any, i: number) => {
                                                    const isCurrent = (startLine + i) === currentIdx;
                                                    // Highlight baris aktif
                                                    return isCurrent ? `**__${safeStr(l.line)}__**` : safeStr(l.line);
                                                }).join("\n");
                                            
                                            const liveEmbed = new EmbedBuilder()
                                                .setColor(client.color.main)
                                                .setTitle(`${safeTitle} (Live)`)
                                                .setDescription(formatted + "\n\nListening...")
                                                .setURL(trackUrl)
                                                .setFooter({ text: "Live Lyrics Mode" });
                                            
                                            if(artworkUrl && artworkUrl.startsWith("http")) liveEmbed.setThumbnail(artworkUrl);

                                            // Safety Check: Pastikan masih running sebelum edit pesan
                                            if (running) {
                                                await ctx.editMessage({
                                                    embeds: [liveEmbed],
                                                    components: [liveLyricsRow],
                                                }).catch(() => {});
                                            }
                                        }
                                        await new Promise((res) => setTimeout(res, 1000));
                                    }
                                })();
                            }
                            continue;
                        }

                        // [CASE 2] UNSUBSCRIBE (FIX INTERACTION FAILED)
                        if (interaction.customId === "lyrics_unsubscribe") {
                            // 1. Matikan flag loop segera
                            running = false;
                            subscriptionActive = false;

                            // 2. Beritahu Discord "Sabar, sedang diproses"
                            await interaction.deferUpdate();

                            // 3. Edit pesan kembali ke mode pagination
                            await interaction.editReply({
                                embeds: [createLyricsEmbed(currentPage)],
                                components: [getNavigationRow(currentPage), liveLyricsRow],
                            });
                            continue;
                        }

                        // [CASE 3] STOP
                        if (interaction.customId === "stop") {
                            collectorActive = false;
                            running = false;
                            await interaction.update({ 
                                embeds: [createLyricsEmbed(currentPage, true)],
                                components: [] // Hapus tombol
                            });
                            break;
                        }

                        // [CASE 4] PREV/NEXT
                        if (interaction.customId === "prev") currentPage--;
                        else if (interaction.customId === "next") currentPage++;

                        // Update Pagination View
                        const comps: any[] = [];
                        if (!subscriptionActive) comps.push(getNavigationRow(currentPage));
                        comps.push(liveLyricsRow);
                        
                        await interaction.update({ 
                            embeds: [createLyricsEmbed(currentPage)],
                            components: comps 
                        });

                    } catch (e) {
                        collectorActive = false;
                        running = false;
                    }
                }

                // Cleanup saat timeout (60 detik tidak ada aktivitas)
                if (ctx.guild?.members.me?.permissionsIn(ctx.channelId).has("SendMessages")) {
                    const finalEmbed = createLyricsEmbed(currentPage, true);
                    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId("ls").setLabel("Sub").setStyle(ButtonStyle.Success).setDisabled(true),
                        new ButtonBuilder().setCustomId("lu").setLabel("Unsub").setStyle(ButtonStyle.Danger).setDisabled(true)
                    );
                    await ctx.editMessage({ 
                        embeds: [finalEmbed], 
                        components: [disabledRow] 
                    }).catch(() => {});
                }

            } else {
                 // Jika parsing gagal tapi tidak kosong
                 const noResEmbed = new EmbedBuilder().setColor(client.color.red).setDescription("No lyrics text available.");
                 await ctx.editMessage({ embeds: [noResEmbed], components: [] });
            }

        } catch (error) {
            client.logger.error(error);
            const errEmbed = new EmbedBuilder().setColor(client.color.red).setDescription("An error occurred fetching lyrics.");
            await ctx.editMessage({ embeds: [errEmbed], components: [] });
        }
    }

    async fetchTrackAndLyrics({ client, ctx, songQuery, player }: { client: Lavamusic; ctx: Context; songQuery: string; player?: any; }) {
        let trackTitle = "", artistName = "", trackUrl = "", artworkUrl = "";
        let lyricsResult: LyricsResult | string = "";

        const searchRes = await client.manager.search(songQuery, ctx.author);
        const track = searchRes.tracks[0];
        if (!track) {
            const noRes = new EmbedBuilder().setColor(client.color.red).setDescription(ctx.locale("cmd.lyrics.errors.no_results"));
            await ctx.editMessage({ embeds: [noRes] });
            return null;
        }

        try {
            if (!player) {
                const node = client.manager.nodeManager.leastUsedNodes()[0];
                lyricsResult = (await node.lyrics.get(track, true)) ?? "";
            } else {
                lyricsResult = await player.getLyrics(track, true);
            }
        } catch (err) {
            client.logger.error(`[LYRICS] Error: ${err}`);
            throw err;
        }
        trackTitle = track.info.title;
        artistName = track.info.author;
        trackUrl = track.info.uri;
        artworkUrl = track.info.artworkUrl || "";
        return { lyricsResult, trackTitle, artistName, trackUrl, artworkUrl };
    }

    paginateLyrics(lyrics: string, ctx: Context): string[] {
        const lines = lyrics.split("\n");
        const pages: string[] = [];
        let currentPage = "";
        
        // Batas 3000 karakter (Aman untuk Embed Description yang limitnya 4096)
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
        if (pages.length === 0) pages.push("No lyrics available.");
        return pages;
    }

    private cleanLyrics(lyrics: string): string {
        return lyrics.replace(/^(\d+\s*Contributors.*?Lyrics|.*Contributors.*|Lyrics\s*|.*Lyrics\s*)$/gim, "")
            .replace(/^[\s\n\r]+/, "").replace(/[\s\n\r]+$/, "").replace(/\n{3,}/g, "\n\n").trim();
    }
}