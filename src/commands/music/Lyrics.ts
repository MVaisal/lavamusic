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
        // --- SAFE STRING HELPER ---
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

        // 1. Get Query
        let songQuery = "";
        if (ctx.options && typeof ctx.options.get === "function") {
            try { 
                const songOpt = ctx.options.get("song");
                if (songOpt && typeof songOpt.value === "string") songQuery = songOpt.value;
            } catch (e) { /* ignore */ }
        }
        if (!songQuery && ctx.args?.[0]) songQuery = Array.isArray(ctx.args) ? ctx.args.join(" ") : safeStr(ctx.args);

        const player = client.manager.getPlayer(ctx.guild!.id);

        // 2. No Music Handling
        if (!songQuery && !player) {
            const noMusicContainer = new ContainerBuilder()
                .setAccentColor(client.color.red)
                .addTextDisplayComponents((textDisplay) =>
                    textDisplay.setContent(getTxt("event.message.no_music_playing", {}, "No music playing"))
                );
            return ctx.sendMessage({
                components: [noMusicContainer],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        let trackTitle = "Unknown Title";
        let artistName = "Unknown Artist";
        let trackUrl = "https://discord.com";
        // artworkUrl dihapus dari penggunaan komponen untuk mencegah error
        let lyricsResult: LyricsResult | string = "";

        // 3. Fetch Info
        if (songQuery) {
            const result = await this.fetchTrackAndLyrics({ client, ctx, songQuery, player });
            if (!result) return;
            lyricsResult = result.lyricsResult;
            trackTitle = safeStr(result.trackTitle) || "Unknown Title";
            artistName = safeStr(result.artistName) || "Unknown Artist";
            trackUrl = safeStr(result.trackUrl) || "https://discord.com";
        } else if (player && player.queue.current) {
            lyricsResult = await player.getCurrentLyrics(false);
            const track = player.queue.current;
            trackTitle = safeStr(track.info.title).replace(/\[.*?]|\(.*?\)|{.*?}/g, "").trim() || "Unknown Title";
            artistName = safeStr(track.info.author).replace(/\[.*?]|\(.*?\)|{.*?}/g, "").trim() || "Unknown Artist";
            trackUrl = (track.info.uri && track.info.uri.startsWith("http")) ? track.info.uri : "https://discord.com";
        }

        const safeTitle = trackTitle.length > 50 ? trackTitle.substring(0, 45) + "..." : trackTitle;
        const safeArtist = artistName.length > 40 ? artistName.substring(0, 35) + "..." : artistName;

        // 4. Searching Message
        const searchingContainer = new ContainerBuilder()
            .setAccentColor(client.color.main)
            .addTextDisplayComponents((textDisplay) =>
                textDisplay.setContent(
                    getTxt("cmd.lyrics.searching", { trackTitle: safeTitle }, `Searching for ${safeTitle}...`).substring(0, 100)
                )
            );

        await ctx.sendDeferMessage({
            components: [searchingContainer],
            flags: MessageFlags.IsComponentsV2,
        });

        try {
            // 5. Parse Lyrics
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

            if (!lyricsText || lyricsText.length < 5) {
                const noResultsContainer = new ContainerBuilder()
                    .setAccentColor(client.color.red)
                    .addTextDisplayComponents((textDisplay) =>
                        textDisplay.setContent(getTxt("cmd.lyrics.errors.no_results", {}, "No results found."))
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

                // --- CONTAINER BUILDER (NO THUMBNAIL) ---
                const createLyricsContainer = (pageIndex: number, finalState: boolean = false) => {
                    const currentLyricsPage = lyricsPages[pageIndex] || "End.";

                    let header = `**${safeTitle}**\n`;
                    if(safeArtist) header += `*${safeArtist}*\n\n`;

                    let fullContent = header + currentLyricsPage;

                    if (!finalState) {
                        fullContent += `\n\nPage ${pageIndex + 1}/${lyricsPages.length}`;
                    } else {
                        fullContent += `\n\n*${getTxt("cmd.lyrics.session_expired", {}, "Session Expired")}*`;
                    }

                    // Strict Limit untuk Section Content (Max safe 900 chars)
                    if (fullContent.length > 900) {
                        fullContent = fullContent.substring(0, 890) + "...";
                    }

                    // HAPUS setThumbnailAccessory sepenuhnya untuk menghindari UnionValidator Error
                    const mainLyricsSection = new SectionBuilder()
                        .addTextDisplayComponents((textDisplay) =>
                            textDisplay.setContent(fullContent)
                        );

                    return new ContainerBuilder()
                        .setAccentColor(client.color.main)
                        .addSectionComponents(mainLyricsSection);
                };

                const getNavigationRow = (current: number) => {
                    return new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId("prev").setEmoji(client.emoji.page.back).setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
                        new ButtonBuilder().setCustomId("stop").setEmoji(client.emoji.page.cancel).setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId("next").setEmoji(client.emoji.page.next).setStyle(ButtonStyle.Secondary).setDisabled(current === lyricsPages.length - 1),
                    );
                };

                const liveLyricsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId("lyrics_subscribe").setLabel("Subscribe").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("lyrics_unsubscribe").setLabel("Unsubscribe").setStyle(ButtonStyle.Danger),
                );

                await ctx.editMessage({
                    components: [
                        createLyricsContainer(currentPage),
                        getNavigationRow(currentPage),
                        liveLyricsRow
                    ],
                    flags: MessageFlags.IsComponentsV2,
                });

                // --- COLLECTOR ---
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
                            await interaction.reply({ content: "Subscribed!", flags: MessageFlags.Ephemeral });
                            running = true;
                            subscriptionActive = true;
                            const maxTime = Date.now() + 3 * 60 * 1000;
                            const lyricsLines = (lyricsResult as any).lines;
                            
                            if (lyricsLines && Array.isArray(lyricsLines)) {
                                lyricsUpdater = (async () => {
                                    while (running && Date.now() < maxTime) {
                                        if (!player || !player.playing) break;
                                        const position = player.position;
                                        
                                        let currentIdx = lyricsLines.findIndex((l: any) => {
                                            const time = l.startTime ?? l.time ?? l.timestamp;
                                            return typeof time === "number" && time > position;
                                        });
                                        if (currentIdx === -1) currentIdx = lyricsLines.length - 1;
                                        else if (currentIdx > 0) currentIdx--;

                                        if (currentIdx !== lastLine) {
                                            lastLine = currentIdx;
                                            // Small snippet logic
                                            const startLine = Math.max(0, currentIdx - 2);
                                            const endLine = Math.min(lyricsLines.length, currentIdx + 3);
                                            const formatted = lyricsLines.slice(startLine, endLine)
                                                .map((l: any, i: number) => {
                                                    return (startLine + i) === currentIdx ? `**${safeStr(l.line)}**` : safeStr(l.line);
                                                }).join("\n");
                                            
                                            let liveContent = `**${safeTitle}** (Live)\n\n${formatted}`;
                                            if (liveContent.length > 900) liveContent = liveContent.substring(0, 890) + "...";

                                            const liveContainer = new ContainerBuilder()
                                                .setAccentColor(client.color.main)
                                                .addSectionComponents(
                                                    new SectionBuilder().addTextDisplayComponents((t) => t.setContent(liveContent))
                                                );

                                            await ctx.editMessage({
                                                components: [liveContainer, liveLyricsRow],
                                                flags: MessageFlags.IsComponentsV2,
                                            }).catch(() => {});
                                        }
                                        await new Promise((res) => setTimeout(res, 1000));
                                    }
                                })();
                            }
                            continue;
                        }

                        if (interaction.customId === "lyrics_unsubscribe") {
                            running = false;
                            subscriptionActive = false;
                            await interaction.update({
                                components: [createLyricsContainer(currentPage), getNavigationRow(currentPage), liveLyricsRow],
                            });
                            continue;
                        }

                        if (interaction.customId === "prev") currentPage--;
                        else if (interaction.customId === "next") currentPage++;
                        else if (interaction.customId === "stop") {
                            collectorActive = false;
                            running = false;
                            await interaction.update({ components: [createLyricsContainer(currentPage, true)] });
                            break;
                        }

                        const comps: any[] = [createLyricsContainer(currentPage)];
                        if (!subscriptionActive) comps.push(getNavigationRow(currentPage));
                        comps.push(liveLyricsRow);
                        await interaction.update({ components: comps });

                    } catch (e) {
                        collectorActive = false;
                    }
                }

                if (ctx.guild?.members.me?.permissionsIn(ctx.channelId).has("SendMessages")) {
                    const finalContainer = createLyricsContainer(currentPage, true);
                    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId("ls").setLabel("Sub").setStyle(ButtonStyle.Success).setDisabled(true),
                        new ButtonBuilder().setCustomId("lu").setLabel("Unsub").setStyle(ButtonStyle.Danger).setDisabled(true)
                    );
                    await ctx.editMessage({ components: [finalContainer, disabledRow], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                }

            } else {
                 const noRes = new ContainerBuilder().setAccentColor(client.color.red).addTextDisplayComponents((t) => t.setContent("No lyrics text available."));
                 await ctx.editMessage({ components: [noRes], flags: MessageFlags.IsComponentsV2 });
            }

        } catch (error) {
            client.logger.error(error);
            const errC = new ContainerBuilder().setAccentColor(client.color.red).addTextDisplayComponents((t) => t.setContent("An error occurred."));
            await ctx.editMessage({ components: [errC], flags: MessageFlags.IsComponentsV2 });
        }
    }

    async fetchTrackAndLyrics({ client, ctx, songQuery, player }: { client: Lavamusic; ctx: Context; songQuery: string; player?: any; }) {
        let trackTitle = "", artistName = "", trackUrl = "", artworkUrl = "";
        let lyricsResult: LyricsResult | string = "";

        const searchRes = await client.manager.search(songQuery, ctx.author);
        const track = searchRes.tracks[0];
        if (!track) {
            const noRes = new ContainerBuilder().setAccentColor(client.color.red).addTextDisplayComponents((t) => t.setContent(ctx.locale("cmd.lyrics.errors.no_results")));
            await ctx.editMessage({ components: [noRes], flags: MessageFlags.IsComponentsV2 });
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
        const MAX_CHARACTERS_PER_PAGE = 750; // Ultra Safe Limit

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