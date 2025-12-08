import {
    ActionRowBuilder,
    ButtonBuilder,
    type ButtonInteraction,
    ButtonStyle,
    ComponentType,
    ContainerBuilder,
    MessageFlags,
    SectionBuilder,
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
        // --- HELPER: SAFE LOCALE ---
        // Mencegah crash jika locale mengembalikan null/undefined/key itu sendiri
        const getTxt = (key: string, args?: any, defaultTxt?: string) => {
            try {
                const res = ctx.locale(key, args);
                if (!res || res === key) return defaultTxt || " ";
                return res;
            } catch (e) {
                return defaultTxt || " ";
            }
        };

        // 1. Ambil Query Lagu
        let songQuery = "";
        if (ctx.options && typeof ctx.options.get === "function") {
            let songOpt = null;
            try { songOpt = ctx.options.get("song"); } catch (e) { songOpt = null; }
            if (songOpt && typeof songOpt.value === "string") songQuery = songOpt.value;
        }
        if (!songQuery && ctx.args?.[0]) songQuery = ctx.args.join(" ");

        const player = client.manager.getPlayer(ctx.guild!.id);

        // 2. Cek apakah ada lagu diputar atau query input
        if (!songQuery && !player) {
            const noMusicContainer = new ContainerBuilder()
                .setAccentColor(client.color.red)
                .addTextDisplayComponents((textDisplay) =>
                    textDisplay.setContent(getTxt("event.message.no_music_playing", {}, "No music playing")),
                );
            return ctx.sendMessage({
                components: [noMusicContainer],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        let trackTitle = "Unknown Title";
        let artistName = "Unknown Artist";
        let trackUrl = "https://discord.com";
        let artworkUrl = "";
        let lyricsResult: LyricsResult | string = "";
        
        // 3. Fetch Data Lirik & Track
        if (songQuery) {
            const result = await this.fetchTrackAndLyrics({ client, ctx, songQuery, player });
            if (!result) return;
            lyricsResult = result.lyricsResult;
            trackTitle = result.trackTitle || "Unknown Title";
            artistName = result.artistName || "Unknown Artist";
            trackUrl = result.trackUrl || "https://discord.com";
            artworkUrl = result.artworkUrl || "";
        } else if (player && player.queue.current) {
            lyricsResult = await player.getCurrentLyrics(false);
            const track = player.queue.current;
            trackTitle = (track.info.title?.replace(/\[.*?]|\(.*?\)|{.*?}/g, "").trim() as string) || "Unknown Title";
            artistName = (track.info.author?.replace(/\[.*?]|\(.*?\)|{.*?}/g, "").trim() as string) || "Unknown Artist";
            trackUrl = (track.info.uri && track.info.uri.startsWith("http")) ? track.info.uri : "https://discord.com";
            artworkUrl = track.info.artworkUrl || "";
        }

        // [SAFETY] Potong string panjang untuk Header
        const safeTitle = trackTitle.length > 50 ? trackTitle.substring(0, 47) + "..." : trackTitle;
        const safeArtist = artistName.length > 40 ? artistName.substring(0, 37) + "..." : artistName;

        // 4. Kirim pesan "Searching..."
        const searchingContainer = new ContainerBuilder()
            .setAccentColor(client.color.main)
            .addTextDisplayComponents((textDisplay) =>
                textDisplay.setContent(
                    getTxt("cmd.lyrics.searching", { trackTitle: safeTitle }, `Searching for ${safeTitle}...`).substring(0, 100)
                ),
            );

        await ctx.sendDeferMessage({
            components: [searchingContainer],
            flags: MessageFlags.IsComponentsV2,
        });

        try {
            // 5. Proses Hasil Lirik
            let lyricsText: string | null = null;
            if (lyricsResult && typeof lyricsResult === "object" && Array.isArray((lyricsResult as LyricsResult).lines)) {
                lyricsText = (lyricsResult as LyricsResult).lines!.map((l: LyricsLine) => l.line).join("\n");
            } else if (typeof lyricsResult === "string") {
                lyricsText = lyricsResult;
            } else if (typeof lyricsResult === "object" && (lyricsResult as any).text) {
                 lyricsText = (lyricsResult as any).text;
            }

            // Jika lirik kosong atau terlalu pendek
            if (!lyricsText || lyricsText.length < 5) {
                const noResultsContainer = new ContainerBuilder()
                    .setAccentColor(client.color.red)
                    .addTextDisplayComponents((textDisplay) =>
                        textDisplay.setContent(getTxt("cmd.lyrics.errors.no_results", {}, "No lyrics found.")),
                    );
                await ctx.editMessage({
                    components: [noResultsContainer],
                    flags: MessageFlags.IsComponentsV2,
                });
                return;
            }

            const cleanedLyrics = this.cleanLyrics(lyricsText);

            if (cleanedLyrics && cleanedLyrics.length > 0) {
                const lyricsPages = this.paginateLyrics(cleanedLyrics, ctx);
                let currentPage = 0;

                // --- FUNGSI PEMBUAT CONTAINER (CORE LOGIC) ---
                const createLyricsContainer = (
                    pageIndex: number,
                    finalState: boolean = false,
                ) => {
                    const currentLyricsPage = lyricsPages[pageIndex] || "End of lyrics.";

                    // Header Manual
                    let header = `**${safeTitle}**\n`;
                    if(safeArtist) header += `*${safeArtist}*\n\n`;

                    let fullContent = header + currentLyricsPage;

                    if (!finalState) {
                        fullContent += `\n\nPage ${pageIndex + 1}/${lyricsPages.length}`;
                    } else {
                        fullContent += `\n\n*${getTxt("cmd.lyrics.session_expired", {}, "Session Expired")}*`;
                    }

                    // [CRITICAL FIX] Limit Total Content untuk Section (Max 1024, Safe 950)
                    if (fullContent.length > 950) {
                        fullContent = fullContent.substring(0, 940) + "...";
                    }

                    const mainLyricsSection =
                        new SectionBuilder().addTextDisplayComponents((textDisplay) =>
                            textDisplay.setContent(fullContent),
                        );

                    // [CRITICAL FIX] Validasi Thumbnail
                    // Hanya izinkan HTTPS dan string pendek untuk deskripsi
                    if (artworkUrl && artworkUrl.startsWith("https") && artworkUrl.length < 500) {
                        try {
                            const descRaw = getTxt("cmd.lyrics.artwork_description", { trackTitle: safeTitle }, "Artwork");
                            // Potong deskripsi thumbnail max 50 char agar tidak crash
                            const safeDesc = descRaw.length > 50 ? descRaw.substring(0, 47) + "..." : descRaw;

                            mainLyricsSection.setThumbnailAccessory((thumbnail) =>
                                thumbnail
                                    .setURL(artworkUrl)
                                    .setDescription(safeDesc),
                            );
                        } catch (e) { /* Ignore thumbnail failure */ }
                    }

                    return new ContainerBuilder()
                        .setAccentColor(client.color.main)
                        .addSectionComponents(mainLyricsSection);
                };

                // Tombol Navigasi
                const getNavigationRow = (current: number) => {
                    return new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder()
                            .setCustomId("prev")
                            .setEmoji(client.emoji.page.back)
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(current === 0),
                        new ButtonBuilder()
                            .setCustomId("stop")
                            .setEmoji(client.emoji.page.cancel)
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId("next")
                            .setEmoji(client.emoji.page.next)
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(current === lyricsPages.length - 1),
                    );
                };

                // Tombol Subscribe
                const liveLyricsRow =
                    new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder()
                            .setCustomId("lyrics_subscribe")
                            .setLabel(getTxt("cmd.lyrics.button_subscribe", {}, "Subscribe").substring(0, 75))
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId("lyrics_unsubscribe")
                            .setLabel(getTxt("cmd.lyrics.button_unsubscribe", {}, "Unsubscribe").substring(0, 75))
                            .setStyle(ButtonStyle.Danger),
                    );

                // Kirim Pesan Awal
                await ctx.editMessage({
                    components: [
                        createLyricsContainer(currentPage),
                        getNavigationRow(currentPage),
                        liveLyricsRow,
                    ],
                    flags: MessageFlags.IsComponentsV2,
                });

                // --- COLLECTOR LOGIC ---
                const filter = (interaction: ButtonInteraction<"cached">) =>
                    interaction.user.id === ctx.author?.id;
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

                        // HANDLE SUBSCRIBE (LIVE LYRICS)
                        if (interaction.customId === "lyrics_subscribe") {
                            await interaction.reply({ 
                                content: getTxt("cmd.lyrics.subscribed", {}, "Subscribed!"), 
                                flags: MessageFlags.Ephemeral 
                            });
                            running = true;
                            subscriptionActive = true;
                            const maxTime = Date.now() + 3 * 60 * 1000; // 3 menit limit
                            const lyricsLines = (lyricsResult as LyricsResult).lines;
                            
                            if (lyricsLines && Array.isArray(lyricsLines)) {
                                lyricsUpdater = (async () => {
                                    while (running && Date.now() < maxTime) {
                                        if (!player || !player.playing) break;
                                        const position = player.position;
                                        
                                        // Cari line aktif
                                        let currentIdx = lyricsLines.findIndex((l) => {
                                            const time = (l as any).startTime ?? (l as any).time ?? (l as any).timestamp;
                                            return typeof time === "number" && time > position;
                                        });
                                        if (currentIdx === -1) currentIdx = lyricsLines.length - 1;
                                        else if (currentIdx > 0) currentIdx--;

                                        if (currentIdx !== lastLine) {
                                            lastLine = currentIdx;
                                            
                                            // [OPTIMISASI] Ambil potongan kecil lirik (scrolling window)
                                            // Ambil 2 baris sebelum dan 2 baris sesudah untuk efisiensi & safety
                                            const startLine = Math.max(0, currentIdx - 2);
                                            const endLine = Math.min(lyricsLines.length, currentIdx + 3);
                                            
                                            const formattedFragment = lyricsLines.slice(startLine, endLine)
                                                .map((l, i) => {
                                                    const actualIdx = startLine + i;
                                                    return actualIdx === currentIdx ? `**${l.line}**` : l.line;
                                                })
                                                .join("\n");
                                            
                                            let liveContent = `**${safeTitle}** (Live)\n\n${formattedFragment}`;
                                            
                                            // Safety check
                                            if (liveContent.length > 950) liveContent = liveContent.substring(0, 940) + "...";

                                            const liveLyricsContainer = new ContainerBuilder()
                                                .setAccentColor(client.color.main)
                                                .addSectionComponents( // Perbaikan: Gunakan SectionBuilder di dalam Container
                                                    new SectionBuilder().addTextDisplayComponents((textDisplay) =>
                                                        textDisplay.setContent(liveContent)
                                                    )
                                                );

                                            await ctx.editMessage({
                                                components: [liveLyricsContainer, liveLyricsRow],
                                                flags: MessageFlags.IsComponentsV2,
                                            }).catch(() => {});
                                        }
                                        await new Promise((res) => setTimeout(res, 1000));
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
                                components: [
                                    createLyricsContainer(currentPage),
                                    getNavigationRow(currentPage),
                                    liveLyricsRow,
                                ],
                             });
                             continue;
                        }

                        // HANDLE NAVIGASI
                        if (interaction.customId === "prev") currentPage--;
                        else if (interaction.customId === "next") currentPage++;
                        else if (interaction.customId === "stop") {
                            collectorActive = false;
                            running = false;
                            await interaction.update({
                                components: [createLyricsContainer(currentPage, true)],
                            });
                            break;
                        }

                        // UPDATE VIEW (PAGINATION)
                        const components: any[] = [createLyricsContainer(currentPage)];
                        if(!subscriptionActive) components.push(getNavigationRow(currentPage));
                        components.push(liveLyricsRow);

                        await interaction.update({ components });

                    } catch (e) {
                        collectorActive = false;
                    }
                }
                
                // Cleanup Buttons setelah timeout
                 if (ctx.guild?.members.me?.permissionsIn(ctx.channelId).has("SendMessages")) {
                    const finalContainer = createLyricsContainer(currentPage, true);
                    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId("s").setLabel("Sub").setStyle(ButtonStyle.Success).setDisabled(true),
                        new ButtonBuilder().setCustomId("u").setLabel("Unsub").setStyle(ButtonStyle.Danger).setDisabled(true)
                    );
                    await ctx.editMessage({
                        components: [finalContainer, disabledRow],
                        flags: MessageFlags.IsComponentsV2,
                    }).catch(() => {});
                 }

            } else {
                // No clean lyrics result
                const noResultsContainer = new ContainerBuilder()
                    .setAccentColor(client.color.red)
                    .addTextDisplayComponents((textDisplay) =>
                        textDisplay.setContent(getTxt("cmd.lyrics.errors.no_results", {}, "No results")),
                    );
                await ctx.editMessage({
                    components: [noResultsContainer],
                    flags: MessageFlags.IsComponentsV2,
                });
            }
        } catch (error) {
            client.logger.error(error);
            const errorContainer = new ContainerBuilder()
                .setAccentColor(client.color.red)
                .addTextDisplayComponents((textDisplay) =>
                    textDisplay.setContent(getTxt("cmd.lyrics.errors.lyrics_error", {}, "An error occurred fetching lyrics.")),
                );
            await ctx.editMessage({
                components: [errorContainer],
                flags: MessageFlags.IsComponentsV2,
            });
        }
    }

    async fetchTrackAndLyrics({
        client,
        ctx,
        songQuery,
        player,
    }: {
        client: Lavamusic;
        ctx: Context;
        songQuery: string;
        player?: any;
    }) {
        let trackTitle = "";
        let artistName = "";
        let trackUrl = "";
        let artworkUrl = "";
        let lyricsResult: LyricsResult | string = "";

        const searchRes = await client.manager.search(
            songQuery,
            ctx.author,
            undefined,
        );
        const track = searchRes.tracks[0];
        if (!track) {
            const noResultsContainer = new ContainerBuilder()
                .setAccentColor(client.color.red)
                .addTextDisplayComponents((textDisplay) =>
                    textDisplay.setContent(ctx.locale("cmd.lyrics.errors.no_results")),
                );
            await ctx.editMessage({
                components: [noResultsContainer],
                flags: MessageFlags.IsComponentsV2,
            });
            return null;
        }
        try {
            if (!player) {
                const node = client.manager.nodeManager.leastUsedNodes()[0];
                const result = await node.lyrics.get(track, true);
                lyricsResult = result ?? "";
            } else {
                lyricsResult = await player.getLyrics(track, true);
            }
        } catch (err) {
            if (client.logger && typeof client.logger.error === "function") {
                client.logger.error(`[LYRICS] Error fetching lyrics: ${err}`);
            }
            throw err;
        }
        trackTitle = track.info.title;
        artistName = track.info.author;
        trackUrl = track.info.uri;
        artworkUrl = track.info.artworkUrl || "";

        return { lyricsResult, trackTitle, artistName, trackUrl, artworkUrl };
    }

    // [PENTING] Pagination dengan batas karakter aman
    paginateLyrics(lyrics: string, ctx: Context): string[] {
        const lines = lyrics.split("\n");
        const pages: string[] = [];
        let currentPage = "";
        
        // Batas 800 agar total dengan header tetap di bawah 1024
        const MAX_CHARACTERS_PER_PAGE = 800; 

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
        if (pages.length === 0) pages.push(ctx.locale("cmd.lyrics.no_lyrics_available") || "No lyrics.");

        return pages;
    }

    private cleanLyrics(lyrics: string): string {
        let cleaned = lyrics
            .replace(
                /^(\d+\s*Contributors.*?Lyrics|.*Contributors.*|Lyrics\s*|.*Lyrics\s*)$/gim,
                "",
            )
            .replace(/^[\s\n\r]+/, "")
            .replace(/[\s\n\r]+$/, "")
            .replace(/\n{3,}/g, "\n\n");
        return cleaned.trim();
    }
}
/**
 * Project: lavamusic
 * Author: Appu
 * Main Contributor: LucasB25
 * Company: Coders
 * Copyright (c) 2024. All rights reserved.
 * This code is the property of Coder and may not be reproduced or
 * modified without permission. For more information, contact us at
 * https://discord.gg/YQsGbTwPBx
 */