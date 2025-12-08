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
import { Client } from "genius-lyrics"; // [FIX] Menggunakan Named Import agar tidak error constructor

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

		// --- [HYBRID CONFIG] ---
		// Inisialisasi Genius Client dari Environment Variable
		const token = process.env.GENIUS_API || process.env.GENIUS_API_KEY || process.env.GENIUS_TOKEN;
		this.geniusClient = new Client(token);
	}

	public async run(client: Lavamusic, ctx: Context): Promise<any> {
		// Get the song query from options or arguments
		let songQuery = "";
		if (ctx.options && typeof ctx.options.get === "function") {
			let songOpt = null;
			try {
				songOpt = ctx.options.get("song");
			} catch (e) {
				songOpt = null;
			}
			if (songOpt && typeof songOpt.value === "string") {
				songQuery = songOpt.value;
			}
		}
		if (!songQuery && ctx.args?.[0]) {
			songQuery = ctx.args.join(" "); // Modified to join args for better search
		}

		const player = client.manager.getPlayer(ctx.guild!.id);

		// If there is no player and no song title is given, lyrics cannot be fetched
		if (!songQuery && !player) {
			const noMusicContainer = new ContainerBuilder()
				.setAccentColor(client.color.red)
				.addTextDisplayComponents((textDisplay) =>
					textDisplay.setContent(ctx.locale("event.message.no_music_playing")),
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
		let isSynced = false; // Penanda apakah lirik ini synced (Plugin) atau teks biasa (Genius)

		// --- [PREPARE SEARCH INFO] ---
		let targetTrack: any = null;

		// If songQuery is given, we will search for it
		if (songQuery) {
			const searchRes = await client.manager.search(songQuery, ctx.author);
			if (searchRes.tracks.length > 0) {
				targetTrack = searchRes.tracks[0];
			}
		} 
		// If no songquery is given, fetch lyrics for the currently playing song
		else if (player && player.queue.current) {
			targetTrack = player.queue.current;
		}

		if (!targetTrack) {
			const noResultsContainer = new ContainerBuilder()
				.setAccentColor(client.color.red)
				.addTextDisplayComponents((textDisplay) =>
					textDisplay.setContent(ctx.locale("cmd.lyrics.errors.no_results")),
				);
			return ctx.sendMessage({
				components: [noResultsContainer],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		// Set initial metadata
		trackTitle = targetTrack.info.title || "Unknown Title";
		artistName = targetTrack.info.author || "Unknown Artist";
		trackUrl = targetTrack.info.uri || "";
		artworkUrl = targetTrack.info.artworkUrl || "";

		const searchingContainer = new ContainerBuilder()
			.setAccentColor(client.color.main)
			.addTextDisplayComponents((textDisplay) =>
				textDisplay.setContent(
					ctx.locale("cmd.lyrics.searching", { trackTitle }),
				),
			);

		await ctx.sendDeferMessage({
			components: [searchingContainer],
			flags: MessageFlags.IsComponentsV2,
		});

		// --- [HYBRID FETCHING LOGIC START] ---
		try {
			const cleanTitle = this.cleanTitle(trackTitle);
			const isJp = this.isJapanese(trackTitle) || this.isJapanese(artistName);

			// 1. CEK GENIUS (ROMAJI) - Prioritas untuk Lagu Jepang
			if (isJp) {
				try {
					const romajiQuery = `${cleanTitle} ${artistName} Romaji`;
					const searches = await this.geniusClient.songs.search(romajiQuery);
					
					if (searches.length > 0) {
						const song = searches[0];
						const text = await song.lyrics();
						if (text && text.length > 10) {
							lyricsResult = text;
							isSynced = false; // Genius tidak punya timestamp
							// Update info agar sesuai hasil Genius
							trackTitle = song.title;
							artistName = song.artist.name;
							artworkUrl = song.thumbnail;
						}
					}
				} catch (e) { /* Lanjut ke langkah berikutnya */ }
			}

			// 2. CEK PLUGIN LAVALINK (LavaLyrics) - Utama untuk lagu Barat/Indo (Synced)
			if (!lyricsResult) {
				try {
					let res: LyricsResult | null = null;
					// Jika player aktif dan lagu sama, pakai currentLyrics
					if (player && player.queue.current?.info.uri === targetTrack.info.uri) {
						// Gunakan metode bawaan library lavalink-client
						res = await player.getCurrentLyrics(false);
					} else {
						// Jika search manual, minta node cari lirik
						const node = client.manager.nodeManager.leastUsedNodes()[0];
						res = await node.lyrics.get(targetTrack, true);
					}

					if (res) {
						lyricsResult = res;
						// Cek apakah hasil plugin ini synced (ada baris waktunya)
						if (typeof res === 'object' && Array.isArray(res.lines) && res.lines.length > 0) {
							isSynced = true;
						} else {
							isSynced = false;
						}
					}
				} catch (e) { /* Lanjut ke langkah berikutnya */ }
			}

			// 3. CEK GENIUS (NORMAL) - Backup Terakhir
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
				} catch (e) { /* Nyerah */ }
			}

		} catch (error) {
			client.logger.error(error);
		}
		// --- [HYBRID FETCHING LOGIC END] ---

		try {
			// Handle lyricsResult as an object with lines (Musixmatch, Spotify, etc.) OR String (Genius)
			let lyricsText: string | null = null;
			if (
				lyricsResult &&
				typeof lyricsResult === "object" &&
				Array.isArray((lyricsResult as LyricsResult).lines)
			) {
				lyricsText = (lyricsResult as LyricsResult)
					.lines!.map((l: LyricsLine) => l.line)
					.join("\n");
			} else if (typeof lyricsResult === "object" && (lyricsResult as any).text) {
				// Handle some plugins returning { text: string }
				lyricsText = (lyricsResult as any).text;
			} else if (typeof lyricsResult === "string") {
				lyricsText = lyricsResult;
			}

			if (!lyricsText || lyricsText.length < 10) {
				const noResultsContainer = new ContainerBuilder()
					.setAccentColor(client.color.red)
					.addTextDisplayComponents((textDisplay) =>
						textDisplay.setContent(ctx.locale("cmd.lyrics.errors.no_results")),
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
						ctx.locale("cmd.lyrics.no_lyrics_on_page");

					let fullContent =
						ctx.locale("cmd.lyrics.lyrics_for_track", {
							trackTitle: trackTitle,
							trackUrl: trackUrl,
						}) +
						"\n" +
						(artistName ? `*${artistName}*\n\n` : "") +
						`${currentLyricsPage}`;

					if (!finalState) {
						fullContent += `\n\n${ctx.locale("cmd.lyrics.page_indicator", {
							current: pageIndex + 1,
							total: lyricsPages.length,
						})}`;
					} else {
						fullContent += `\n\n*${ctx.locale("cmd.lyrics.session_expired")}*`;
					}

					const mainLyricsSection =
						new SectionBuilder().addTextDisplayComponents((textDisplay) =>
							textDisplay.setContent(fullContent),
						);

					if (artworkUrl && artworkUrl.length > 0) {
						mainLyricsSection.setThumbnailAccessory((thumbnail) =>
							thumbnail
								.setURL(artworkUrl)
								.setDescription(
									ctx.locale("cmd.lyrics.artwork_description", { trackTitle }),
								),
						);
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

				// Add subscribe/unsubscribe buttons to lyrics
				const liveLyricsRow =
					new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId("lyrics_subscribe")
							.setLabel(ctx.locale("cmd.lyrics.button_subscribe"))
							.setStyle(ButtonStyle.Success)
							// [HYBRID] Hanya enable jika lyricsResult synced (dari plugin)
							.setDisabled(!isSynced),
						new ButtonBuilder()
							.setCustomId("lyrics_unsubscribe")
							.setLabel(ctx.locale("cmd.lyrics.button_unsubscribe"))
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
								content: ctx.locale("cmd.lyrics.subscribed"),
								flags: MessageFlags.Ephemeral,
							});
							
							// [HYBRID] Pastikan tipe datanya benar sebelum menjalankan updater
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
											const liveLyricsContainer = new ContainerBuilder()
												.setAccentColor(client.color.main)
												.addTextDisplayComponents((textDisplay) =>
													textDisplay.setContent(
														ctx.locale("cmd.lyrics.lyrics_for_track", {
															trackTitle,
															trackUrl,
														}) +
															"\n" +
															(artistName ? `*${artistName}*\n\n` : "") +
															formatted,
													),
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
							
							// [HYBRID] Fallback logic untuk menampilkan lirik statis saat unsubscribe
							let formatted = "";
							if (isSynced && typeof lyricsResult === 'object' && (lyricsResult as LyricsResult).lines) {
								const lyricsLines = (lyricsResult as any).lines as LyricsLine[];
								formatted = lyricsLines.map((l) => l.line).join("\n");
							} else {
								formatted = cleanedLyrics;
							}

							const unsubLyricsContainer = new ContainerBuilder()
								.setAccentColor(client.color.main)
								.addTextDisplayComponents((textDisplay) =>
									textDisplay.setContent(
										ctx.locale("cmd.lyrics.lyrics_for_track", {
											trackTitle,
											trackUrl,
										}) +
											"\n" +
											(artistName ? `*${artistName}*\n\n` : "") +
											formatted +
											`\n\n*${ctx.locale("cmd.lyrics.unsubscribed")}*`,
									),
								);
							await interaction.update({
								components: [
									unsubLyricsContainer,
									getNavigationRow(currentPage),
									liveLyricsRow,
								],
							});
							await interaction.reply({
								content: ctx.locale("cmd.lyrics.unsubscribed"),
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
						// If subscription is active, do not show navigation buttons
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
				// After collecting is finished
				if (
					ctx.guild?.members.me
						?.permissionsIn(ctx.channelId)
						.has("SendMessages")
				) {
					const finalContainer = createLyricsContainer(currentPage, true);
					// Deactivate subscription buttons after the song ends
					const disabledLiveLyricsRow =
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							new ButtonBuilder()
								.setCustomId("lyrics_subscribe")
								.setLabel(ctx.locale("cmd.lyrics.button_subscribe"))
								.setStyle(ButtonStyle.Success)
								.setDisabled(true),
							new ButtonBuilder()
								.setCustomId("lyrics_unsubscribe")
								.setLabel(ctx.locale("cmd.lyrics.button_unsubscribe"))
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
						textDisplay.setContent(ctx.locale("cmd.lyrics.errors.no_results")),
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
					textDisplay.setContent(ctx.locale("cmd.lyrics.errors.lyrics_error")),
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
		const MAX_CHARACTERS_PER_PAGE = 2800;

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
			pages.push(ctx.locale("cmd.lyrics.no_lyrics_available"));
		}

		return pages;
	}

	private cleanLyrics(lyrics: string): string {
		let cleaned = lyrics
			.replace(
				/^(\d+\s*Contributors.*?Lyrics|.*Contributors.*|Lyrics\s*|.*Lyrics\s*)$/gim,
				"",
			)
			.replace(/\[.*?\]/g, "") // Added: Remove [Verse], [Chorus] tags from Genius
			.replace(/^[\s\n\r]+/, "")
			.replace(/[\s\n\r]+$/, "")
			.replace(/\n{3,}/g, "\n\n");
		return cleaned.trim();
	}

	// --- [HELPER FUNCTIONS UNTUK HYBRID] ---
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