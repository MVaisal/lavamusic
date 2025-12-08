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

        // SAFE LOCALE: Helper untuk mencegah null/undefined pada teks
        const getTxt = (key: string, args?: any, defaultTxt?: string) => {
            const res = ctx.locale(key, args);
            return res && res !== key ? res : (defaultTxt || "Unknown Text");
        };

        if (!songQuery && !player) {
            const noMusicContainer = new ContainerBuilder()
                .setAccentColor(client.color.red)
                .addTextDisplayComponents((textDisplay) =>
                    textDisplay.setContent(getTxt("event.message.no_music_playing", {}, "No music playing!")),
                );
            return ctx.sendMessage({
                components: [noMusicContainer],
                flags: MessageFlags.IsComponentsV2,
            });
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
        } 
        else if (player && player.queue.current) {
            targetTrack = player.queue.current;
        }

        if (!targetTrack) {
            const noResultsContainer = new ContainerBuilder()
                .setAccentColor(client.color.red)
                .addTextDisplayComponents((textDisplay) =>
                    textDisplay.setContent(getTxt("cmd.lyrics.errors.no_results", {}, "No results found.")),
                );
            return ctx.sendMessage({
                components: [noResultsContainer],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        trackTitle = targetTrack.info.title || "Unknown Title";
        artistName = targetTrack.info.author || "Unknown Artist";
        // Default ke google jika url kosong untuk mencegah error markdown
        trackUrl = targetTrack.info.uri || "https://google.com"; 
        artworkUrl = targetTrack.info.artworkUrl || "";

        const safeTitle = trackTitle.length > 50 ? trackTitle.substring(0, 50) + "..." : trackTitle;

        const searchingContainer = new ContainerBuilder()
            .setAccentColor(client.color.main)
            .addTextDisplayComponents((textDisplay) =>
                textDisplay.setContent(
                    getTxt("cmd.lyrics.searching", { trackTitle: safeTitle }, `Searching: ${safeTitle}...`),
                ),
            );

        await ctx.sendDeferMessage({
            components: [searchingContainer],
            flags: MessageFlags.IsComponentsV2,
        });

        // --- [HYBRID FETCHING] ---
        try {
            const cleanTitle = this.cleanTitle(trackTitle);
            const isJp = this.isJapanese(trackTitle) || this.isJapanese(artistName);

            // 1. GENIUS (ROMAJI)
            if (isJp) {
                try {
                    const romajiQuery = `${cleanTitle} ${artistName} Romaji`;
                    const searches = await this.geniusClient.songs.search(romajiQuery);
                    
                    if (searches.length > 0) {
                        const song = searches[0];
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

            // 2. PLUGIN LAVALINK
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

            // 3. GENIUS (NORMAL)
            if (!lyricsResult) {
                try {
                    const normalQuery = `${cleanTitle} ${artistName}`;
                    const searches = await this.geniusClient.songs.search(normalQuery);
                    
                    if (searches.length > 0) {
                        const song = searches[0];
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
                const noResultsContainer = new ContainerBuilder()
                    .setAccentColor(client.color.red)
                    .addTextDisplayComponents((textDisplay) =>
                        textDisplay.setContent(getTxt("cmd.lyrics.errors.no_results", {}, "Lyrics not found.")),
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

                const createLyricsContainer = (
                    pageIndex: number,
                    finalState: boolean = false,
                ) => {
                    const currentLyricsPage =
                        lyricsPages[pageIndex] ||
                        getTxt("cmd.lyrics.no_lyrics_on_page", {}, "No lyrics here.");

                    const headerText = getTxt("cmd.lyrics.lyrics_for_track", {
                        trackTitle: trackTitle,
                        trackUrl: trackUrl,
                    }, `Lyrics for **[${trackTitle}](${trackUrl})**`);

                    let fullContent = 
                        `${headerText}\n` +
                        (artistName ? `*${artistName}*\n\n` : "") +
                        `${currentLyricsPage}`;

                    if (!finalState) {
                        const pageText = getTxt("cmd.lyrics.page_indicator", {
                            current: pageIndex + 1,
                            total: lyricsPages.length,
                        }, `Page ${pageIndex + 1}/${lyricsPages.length}`);
                        fullContent += `\n\n${pageText}`;
                    } else {
                        const expiredText = getTxt("cmd.lyrics.session_expired", {}, "Session expired.");
                        fullContent += `\n\n*${expiredText}*`;
                    }

                    // [CRITICAL] Batasi 1500 chars agar aman dari Validator Error
                    if (fullContent.length > 1500) {
                        fullContent = fullContent.substring(0, 1497) + "...";
                    }

                    const mainLyricsSection =
                        new SectionBuilder().addTextDisplayComponents((textDisplay) =>
                            textDisplay.setContent(fullContent),
                        );

                    // [CRITICAL] Validasi URL Thumbnail
                    if (this.isValidUrl(artworkUrl)) {
                        try {
                            mainLyricsSection.setThumbnailAccessory((thumbnail) =>
                                thumbnail.setURL(artworkUrl).setDescription("Song Artwork")
                            );
                        } catch (e) {
                            // Abaikan jika thumbnail gagal, jangan crash
                        }
                    }

                    return new ContainerBuilder()
                        .setAccentColor(client.color.main)
                        .addSectionComponents(mainLyricsSection);
                };

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

                const liveLyricsRow =
                    new ActionRowBuilder<ButtonBuilder>().addComponents(
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
                    components: [
                        createLyricsContainer(currentPage),
                        getNavigationRow(currentPage),
                        liveLyricsRow,
                    ],
                    flags: MessageFlags.IsComponentsV2,
                });

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
                        if (interaction.customId === "lyrics_subscribe") {
                            await interaction.reply({
                                content: getTxt("cmd.lyrics.subscribed", {}, "Subscribed!"),
                                flags: MessageFlags.Ephemeral,
                            });
                            
                            if (isSynced && typeof lyricsResult === 'object' && (lyricsResult as LyricsResult).lines) {
                                running = true;
                                subscriptionActive = true;
                                const maxTime = Date.now() + 3 * 60 * 1000;
                                const lyricsLines = (lyricsResult as LyricsResult).lines!;
                                lyricsUpdater = (async () => {
                                    while (running && Date.now() < maxTime) {
                                        if (!player || !player.playing) break;
                                        const position = player.position;
                                        let currentIdx = lyricsLines.findIndex((l) => {
                                            const time =
                                                (l as any).startTime ??
                                                (l as any).time ??
                                                (l as any).timestamp;
                                            return typeof time === "number" && time > position;
                                        });
                                        if (currentIdx === -1) currentIdx = lyricsLines.length - 1;
                                        else if (currentIdx > 0) currentIdx--;
                                        if (currentIdx !== lastLine) {
                                            lastLine = currentIdx;
                                            const formatted = lyricsLines
                                                .map((l, i) =>
                                                    i === currentIdx ? `**${l.line}**` : l.line,
                                                )
                                                .join("\n");
                                            
                                            // Safe Live Update
                                            let fullContent = getTxt("cmd.lyrics.lyrics_for_track", {
                                                trackTitle,
                                                trackUrl,
                                            }, `Lyrics for ${trackTitle}`) + "\n" + (artistName ? `*${artistName}*\n\n` : "") + formatted;
                                            
                                            if (fullContent.length > 1500) fullContent = fullContent.substring(0, 1497) + "...";

                                            const liveLyricsContainer = new ContainerBuilder()
                                                .setAccentColor(client.color.main)
                                                .addTextDisplayComponents((textDisplay) =>
                                                    textDisplay.setContent(fullContent),
                                                );
                                            await ctx.editMessage({
                                                components: [liveLyricsContainer, liveLyricsRow],
                                                flags: MessageFlags.IsComponentsV2,
                                            });
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
                            
                            let formatted = "";
                            if (isSynced && typeof lyricsResult === 'object' && (lyricsResult as LyricsResult).lines) {
                                const lyricsLines = (lyricsResult as any).lines as LyricsLine[];
                                formatted = lyricsLines.map((l) => l.line).join("\n");
                            } else {
                                formatted = cleanedLyrics;
                            }

                            // Safe Unsubscribe
                            const unsubTxt = getTxt("cmd.lyrics.unsubscribed", {}, "Unsubscribed");
                            let unsubContent = getTxt("cmd.lyrics.lyrics_for_track", {
                                trackTitle,
                                trackUrl,
                            }, `Lyrics for ${trackTitle}`) + "\n" + (artistName ? `*${artistName}*\n\n` : "") + formatted + `\n\n*${unsubTxt}*`;

                            if (unsubContent.length > 1500) unsubContent = unsubContent.substring(0, 1497) + "...";

                            const unsubLyricsContainer = new ContainerBuilder()
                                .setAccentColor(client.color.main)
                                .addTextDisplayComponents((textDisplay) =>
                                    textDisplay.setContent(unsubContent),
                                );
                            await interaction.update({
                                components: [
                                    unsubLyricsContainer,
                                    getNavigationRow(currentPage),
                                    liveLyricsRow,
                                ],
                            });
                            await interaction.reply({
                                content: unsubTxt,
                                flags: MessageFlags.Ephemeral,
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
                            await interaction.update({
                                components: [
                                    createLyricsContainer(currentPage, true),
                                    getNavigationRow(currentPage),
                                ],
                            });
                            break;
                        }
                        if (subscriptionActive) {
                            await interaction.update({
								components: [createLyricsContainer(currentPage), liveLyricsRow],
							});
						} else {
							await interaction.update({
								components: [
									createLyricsContainer(currentPage),
									getNavigationRow(currentPage),
									liveLyricsRow,
								],
							});
						}
					} catch (e) {
						collectorActive = false;
					}
				}
				if (
					ctx.guild?.members.me
						?.permissionsIn(ctx.channelId)
						.has("SendMessages")
				) {
					const finalContainer = createLyricsContainer(currentPage, true);
					const disabledLiveLyricsRow =
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							new ButtonBuilder()
								.setCustomId("lyrics_subscribe")
								.setLabel(getTxt("cmd.lyrics.button_subscribe", {}, "Subscribe"))
								.setStyle(ButtonStyle.Success)
								.setDisabled(true),
							new ButtonBuilder()
								.setCustomId("lyrics_unsubscribe")
								.setLabel(getTxt("cmd.lyrics.button_unsubscribe", {}, "Unsubscribe"))
								.setStyle(ButtonStyle.Danger)
								.setDisabled(true),
						);
					await ctx
						.editMessage({
							components: [finalContainer, disabledLiveLyricsRow],
							flags: MessageFlags.IsComponentsV2,
						})
						.catch((e) => {
							if (e?.code !== 10008) {
								client.logger.error("Failed to clear lyrics buttons:", e);
							}
						});
				}
			} else {
				const noResultsContainer = new ContainerBuilder()
					.setAccentColor(client.color.red)
					.addTextDisplayComponents((textDisplay) =>
						textDisplay.setContent(getTxt("cmd.lyrics.errors.no_results", {}, "No lyrics found.")),
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
					textDisplay.setContent(getTxt("cmd.lyrics.errors.lyrics_error", {}, "Error fetching lyrics.")),
				);
			await ctx.editMessage({
				components: [errorContainer],
				flags: MessageFlags.IsComponentsV2,
			});
		}
	}

	paginateLyrics(lyrics: string, ctx: Context): string[] {
		const lines = lyrics.split("\n");
		const pages: string[] = [];
		let currentPage = "";
        
        // [SAFETY] Safe Buffer
		const MAX_CHARACTERS_PER_PAGE = 1500; 

		for (const line of lines) {
			const lineWithNewline = `${line}\n`;
			if (
				currentPage.length + lineWithNewline.length >
				MAX_CHARACTERS_PER_PAGE
			) {
				if (currentPage.trim()) {
					pages.push(currentPage.trim());
				}
				currentPage = lineWithNewline;
			} else {
				currentPage += lineWithNewline;
			}
		}

		if (currentPage.trim()) {
			pages.push(currentPage.trim());
		}

		if (pages.length === 0) {
			pages.push("No lyrics available on this page.");
		}

		return pages;
	}

	private cleanLyrics(lyrics: string): string {
		let cleaned = lyrics
			.replace(
				/^(\d+\s*Contributors.*?Lyrics|.*Contributors.*|Lyrics\s*|.*Lyrics\s*)$/gim,
				"",
			)
			.replace(/\[.*?\]/g, "") 
			.replace(/^[\s\n\r]+/, "")
			.replace(/[\s\n\r]+$/, "")
			.replace(/\n{3,}/g, "\n\n");
		return cleaned.trim();
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