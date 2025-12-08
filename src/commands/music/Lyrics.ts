import {
    ActionRowBuilder,
    ButtonBuilder,
    type ButtonInteraction,
    ButtonStyle,
    ComponentType,
    EmbedBuilder, // Menggunakan EmbedBuilder (Standar & Stabil)
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
        // --- 1. Ambil Input Lagu ---
        let songQuery = "";
        if (ctx.options && typeof ctx.options.get === "function") {
            let songOpt = null;
            try { songOpt = ctx.options.get("song"); } catch (e) { songOpt = null; }
            if (songOpt && typeof songOpt.value === "string") songQuery = songOpt.value;
        }
        if (!songQuery && ctx.args?.[0]) songQuery = ctx.args[0];

        const player = client.manager.getPlayer(ctx.guild!.id);

        // --- 2. Helper Text Aman (Mencegah Crash jika Locale Null) ---
        const getTxt = (key: string, args?: any, defaultTxt?: string) => {
            const res = ctx.locale(key, args);
            return res && res !== key ? res : (defaultTxt || " ");
        };

        // Jika tidak ada lagu
        if (!songQuery && !player) {
            const embed = new EmbedBuilder()
                .setColor(client.color.red)
                .setDescription(getTxt("event.message.no_music_playing", {}, "No music playing."));
            return ctx.sendMessage({
                embeds: [embed],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        let trackTitle = "";
        let artistName = "";
        let trackUrl = "";
        let artworkUrl = "";
        let lyricsResult: LyricsResult | string = "";
        
        // --- 3. Fetching Lirik ---
        if (songQuery) {
            const result = await this.fetchTrackAndLyrics({
                client,
                ctx,
                songQuery,
                player,
            });
            if (!result) return;
            lyricsResult = result.lyricsResult;
            trackTitle = result.trackTitle;
            artistName = result.artistName;
            trackUrl = result.trackUrl;
            artworkUrl = result.artworkUrl;
        } else if (player && player.queue.current) {
            lyricsResult = await player.getCurrentLyrics(false);
            const track = player.queue.current;
            trackTitle = track.info.title?.replace(/\[.*?]|\(.*?\)|{.*?}/g, "").trim() || "Unknown";
            artistName = track.info.author?.replace(/\[.*?]|\(.*?\)|{.*?}/g, "").trim() || "Unknown";
            trackUrl = track.info.uri || "";
            artworkUrl = track.info.artworkUrl || "";
        }

        // Kirim pesan "Searching..."
        const searchingEmbed = new EmbedBuilder()
            .setColor(client.color.main)
            .setDescription(`🔎 ${getTxt("cmd.lyrics.searching", { trackTitle: trackTitle.substring(0, 100) }, "Searching...")}`);

        await ctx.sendDeferMessage({
            embeds: [searchingEmbed],
            flags: MessageFlags.IsComponentsV2,
        });

        try {
            // --- 4. Parsing Hasil Lirik ---
            let lyricsText: string | null = null;
            if (lyricsResult && typeof lyricsResult === "object" && Array.isArray((lyricsResult as LyricsResult).lines)) {
                lyricsText = (lyricsResult as LyricsResult).lines!.map((l: LyricsLine) => l.line).join("\n");
            } else if (typeof lyricsResult === "string") {
                lyricsText = lyricsResult;
            } else if (typeof lyricsResult === "object" && (lyricsResult as any).text) {
                 lyricsText = (lyricsResult as any).text;
            }

            if (!lyricsText || lyricsText.length < 10) {
                const embed = new EmbedBuilder()
                    .setColor(client.color.red)
                    .setDescription(getTxt("cmd.lyrics.errors.no_results", {}, "No lyrics found."));
                await ctx.editMessage({
                    embeds: [embed],
                    flags: MessageFlags.IsComponentsV2,
                });
                return;
            }
            const cleanedLyrics = this.cleanLyrics(lyricsText);

            // --- 5. Menampilkan Lirik (Embed Builder) ---
            if (cleanedLyrics && cleanedLyrics.length > 0) {
                const lyricsPages = this.paginateLyrics(cleanedLyrics, ctx);
                let currentPage = 0;

                // Fungsi Membuat Embed Halaman
                const createLyricsEmbed = (pageIndex: number) => {
                    const currentLyricsPage = lyricsPages[pageIndex] || getTxt("cmd.lyrics.no_lyrics_on_page");

                    const embed = new EmbedBuilder()
                        .setColor(client.color.main)
                        .setTitle(trackTitle.substring(0, 256)) // Judul
                        .setURL(trackUrl.startsWith('http') ? trackUrl : null)
                        .setAuthor({ name: artistName.substring(0, 256) || "Unknown Artist" });

                    // Set Deskripsi Lirik
                    embed.setDescription(currentLyricsPage);

                    // Set Footer (Page Indicator)
                    const footerText = getTxt("cmd.lyrics.page_indicator", {
                        current: pageIndex + 1,
                        total: lyricsPages.length,
                    }, `Page ${pageIndex + 1}/${lyricsPages.length}`);
                    embed.setFooter({ text: footerText });

                    // Set Thumbnail (Aman, jika gagal tidak akan crash)
                    if (artworkUrl && artworkUrl.startsWith("http")) {
                        embed.setThumbnail(artworkUrl);
                    }

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
                    new ButtonBuilder().setCustomId("lyrics_subscribe").setLabel(getTxt("cmd.lyrics.button_subscribe", {}, "Subscribe")).setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("lyrics_unsubscribe").setLabel(getTxt("cmd.lyrics.button_unsubscribe", {}, "Unsubscribe")).setStyle(ButtonStyle.Danger),
                );

                await ctx.editMessage({
                    embeds: [createLyricsEmbed(currentPage)],
                    components: [getNavigationRow(currentPage), liveLyricsRow],
                    flags: MessageFlags.IsComponentsV2,
                });

                // --- 6. Collector (Interaksi Tombol) ---
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

                        // LIVE LYRICS
                        if (interaction.customId === "lyrics_subscribe") {
                            await interaction.reply({ content: getTxt("cmd.lyrics.subscribed", {}, "Subscribed!"), flags: MessageFlags.Ephemeral });
                            running = true;
                            subscriptionActive = true;
                            const maxTime = Date.now() + 3 * 60 * 1000;
                            const lyricsLines = (lyricsResult as LyricsResult).lines;
                            
                            if (lyricsLines && Array.isArray(lyricsLines)) {
                                lyricsUpdater = (async () => {
                                    while (running && Date.now() < maxTime) {
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
                                            const formatted = lyricsLines.map((l, i) => i === currentIdx ? `**${l.line}**` : l.line).join("\n");
                                            
                                            // Embed Live Lyrics
                                            const liveEmbed = new EmbedBuilder()
                                                .setColor(client.color.main)
                                                .setTitle(trackTitle)
                                                .setDescription(formatted.substring(0, 4000))
                                                .setFooter({ text: "Live Synced Lyrics" });

                                            await ctx.editMessage({ embeds: [liveEmbed], components: [liveLyricsRow], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                                        }
                                        await new Promise((res) => setTimeout(res, 1000));
                                    }
                                })();
                            }
                            continue;
                        }

                        // UNSUBSCRIBE
                        if (interaction.customId === "lyrics_unsubscribe") {
                            running = false;
                            subscriptionActive = false;
                            
                            let formatted = "";
                            if ((lyricsResult as any).lines) {
                                const lyricsLines = (lyricsResult as any).lines as LyricsLine[];
                                formatted = lyricsLines.map((l) => l.line).join("\n");
                            } else {
                                formatted = cleanedLyrics;
                            }

                            // Kembali ke Embed Normal
                            await interaction.update({
                                embeds: [createLyricsEmbed(currentPage)],
                                components: [getNavigationRow(currentPage), liveLyricsRow],
                            });
                            await interaction.followUp({ content: getTxt("cmd.lyrics.unsubscribed", {}, "Unsubscribed"), flags: MessageFlags.Ephemeral });
                            if (lyricsUpdater) await lyricsUpdater;
                            continue;
                        }

                        // NAVIGASI
                        if (interaction.customId === "prev") currentPage--;
                        else if (interaction.customId === "next") currentPage++;
                        else if (interaction.customId === "stop") {
                            collectorActive = false;
                            running = false;
                            await interaction.update({ components: [] });
                            break;
                        }

                        if (!subscriptionActive) {
                            await interaction.update({
                                embeds: [createLyricsEmbed(currentPage)],
                                components: [getNavigationRow(currentPage), liveLyricsRow],
                            });
                        }
                    } catch (e) {
                        collectorActive = false;
                    }
                }

                // Cleanup
                if (ctx.guild?.members.me?.permissionsIn(ctx.channelId).has("SendMessages")) {
                    await ctx.editMessage({ components: [] }).catch(() => null);
                }

            } else {
                const embed = new EmbedBuilder()
                    .setColor(client.color.red)
                    .setDescription(getTxt("cmd.lyrics.errors.no_results", {}, "No lyrics found."));
                await ctx.editMessage({ embeds: [embed], flags: MessageFlags.IsComponentsV2 });
            }
        } catch (error) {
            client.logger.error(error);
            const embed = new EmbedBuilder()
                .setColor(client.color.red)
                .setDescription(getTxt("cmd.lyrics.errors.lyrics_error", {}, "Error fetching lyrics."));
            await ctx.editMessage({ embeds: [embed], flags: MessageFlags.IsComponentsV2 });
        }
    }

    async fetchTrackAndLyrics({ client, ctx, songQuery, player }: { client: Lavamusic; ctx: Context; songQuery: string; player?: any }) {
        let trackTitle = "";
        let artistName = "";
        let trackUrl = "";
        let artworkUrl = "";
        let lyricsResult: LyricsResult | string = "";

        const searchRes = await client.manager.search(songQuery, ctx.author, undefined);
        const track = searchRes.tracks[0];
        if (!track) {
            const embed = new EmbedBuilder()
                .setColor(client.color.red)
                .setDescription(ctx.locale("cmd.lyrics.errors.no_results"));
            await ctx.editMessage({ embeds: [embed], flags: MessageFlags.IsComponentsV2 });
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

    paginateLyrics(lyrics: string, ctx: Context): string[] {
        const lines = lyrics.split("\n");
        const pages: string[] = [];
        let currentPage = "";
        const MAX_CHARACTERS_PER_PAGE = 3000; // Embed description bisa sampai 4096

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
        if (pages.length === 0) pages.push(ctx.locale("cmd.lyrics.no_lyrics_available"));
        return pages;
    }

    private cleanLyrics(lyrics: string): string {
        let cleaned = lyrics
            .replace(/^(\d+\s*Contributors.*?Lyrics|.*Contributors.*|Lyrics\s*|.*Lyrics\s*)$/gim, "")
            .replace(/^[\s\n\r]+/, "")
            .replace(/[\s\n\r]+$/, "")
            .replace(/\n{3,}/g, "\n\n");
        return cleaned.trim();
    }
}