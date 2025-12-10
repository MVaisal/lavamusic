import { Command, type Context, type Lavamusic } from "../../structures/index";
import { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ComponentType,
    type Interaction,
    type ButtonInteraction
} from "discord.js";

export default class Nowplaying extends Command {
    constructor(client: Lavamusic) {
        super(client, {
            name: "nowplaying",
            description: {
                content: "cmd.nowplaying.description",
                examples: ["nowplaying"],
                usage: "nowplaying",
            },
            category: "music",
            aliases: ["np"],
            cooldown: 3,
            args: false,
            vote: false,
            player: {
                voice: true,
                dj: false,
                active: true,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: [
                    "SendMessages",
                    "ReadMessageHistory",
                    "ViewChannel",
                    "EmbedLinks",
                ],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(client: Lavamusic, ctx: Context): Promise<any> {
        const player = client.manager.getPlayer(ctx.guild.id);

        if (!player || !player.queue.current) {
            const noMusic = ctx.locale("event.message.no_music_playing");
            const embed = new EmbedBuilder().setColor(this.client.color.red).setDescription(noMusic);
            return ctx.sendMessage({ embeds: [embed] });
        }

        // --- [LOGIKA DELETE PESAN LAMA & INTERVAL] ---
        const oldInterval = player.get("autoUpdateInterval");
        if (oldInterval) {
            clearInterval(oldInterval as NodeJS.Timeout);
        }

        // [UBAHAN] Delete pesan sebelumnya jika ada
        const oldMessage = player.get("nowPlayingMessage");
        if (oldMessage) {
            try {
                await oldMessage.delete(); 
            } catch (e) {
                // Abaikan jika pesan sudah terhapus
            }
        }
        // ---------------------------------------------

        const track = player.queue.current;
        const duration = track.info.duration;
        let position = player.position;
        
        // Progress Bar & Time
        let progressBar = client.utils.progressBar(position, duration, 20);
        let durationText = track.info.isStream ? "🔴 LIVE" : `\`${client.utils.formatTime(position)} / ${client.utils.formatTime(duration)}\``;

        // Create Embed
        const embed = new EmbedBuilder()
            .setColor(this.client.color.main)
            .setAuthor({
                name: ctx.locale("cmd.nowplaying.now_playing"),
                // Gunakan icon source sesuai config (Spotify/Youtube dll)
                iconURL: client.config.icons[track.info.sourceName] ?? client.user?.displayAvatarURL({ extension: "png" })
            })
            .setDescription(`**[${track.info.title}](${track.info.uri ?? ""})**\n\n${progressBar}\n${durationText}`)
            .setThumbnail(track.info.artworkUrl ?? null)
            .setFooter({
                text: ctx.locale("player.trackStart.requested_by", { user: (track.requester as any).username || "Unknown" }),
                iconURL: (track.requester as any).avatarURL || null
            })
            .setTimestamp();

        // Add Fields
        embed.addFields({
            name: ctx.locale("player.trackStart.author") || "Artist", 
            value: track.info.author,
            inline: true
        });

        if (track.pluginInfo && track.pluginInfo.albumName) {
            embed.addFields({
                name: "Album",
                value: track.pluginInfo.albumName,
                inline: true
            });
        }

        embed.addFields({
            name: "Source",
            value: track.info.sourceName,
            inline: true
        });

        // Send Message
        const components = this.createButtonRow(player, client);
        const message = await ctx.sendMessage({
            embeds: [embed],
            components: components
        });

        // --- [SIMPAN PESAN BARU KE PLAYER] ---
        // Simpan agar bisa dihapus oleh TrackStart berikutnya
        player.set("nowPlayingMessage", message);
        // -------------------------------------

        // --- [SETUP INTERVAL UPDATE BARU] ---
        const newInterval = setInterval(async () => {
            if (!player || !player.queue.current || player.queue.current.info.uri !== track.info.uri) {
                clearInterval(newInterval);
                return;
            }
            if (player.paused) return;

            try {
                const currentPos = player.position;
                const newBar = client.utils.progressBar(currentPos, duration, 20);
                const newTimeText = track.info.isStream ? "🔴 LIVE" : `\`${client.utils.formatTime(currentPos)} / ${client.utils.formatTime(duration)}\``;
                
                embed.setDescription(`**[${track.info.title}](${track.info.uri ?? ""})**\n\n${newBar}\n${newTimeText}`);
                
                await message.edit({ embeds: [embed] });
            } catch (e) {
                clearInterval(newInterval);
            }
        }, 30000); 

        player.set("autoUpdateInterval", newInterval);
        // ------------------------------------

        // Button Collector
        const collector = message.createMessageComponentCollector({
            filter: (b: any) => {
                if (b.guild.members.me.voice.channelId === b.member.voice.channelId) return true;
                b.reply({
                    content: ctx.locale("player.trackStart.not_connected_to_voice_channel", { channel: b.guild.members.me.voice.channelId }),
                    ephemeral: true
                });
                return false;
            },
            componentType: ComponentType.Button,
            time: 300000 // 5 Menit
        });

        collector.on("collect", async (interaction: ButtonInteraction) => {
            const updateComponents = async () => {
                const currPos = player.position;
                const barNow = client.utils.progressBar(currPos, duration, 20);
                const timeNow = `\`${client.utils.formatTime(currPos)} / ${client.utils.formatTime(duration)}\``;
                embed.setDescription(`**[${track.info.title}](${track.info.uri ?? ""})**\n\n${barNow}\n${timeNow}`);

                await interaction.editReply({
                    embeds: [embed],
                    components: this.createButtonRow(player, client)
                });
            };

            switch (interaction.customId) {
                case "previous":
                    if (!player.queue.previous.length) {
                         await interaction.reply({ content: ctx.locale("player.trackStart.no_previous_song"), ephemeral: true });
                    } else {
                        await interaction.deferUpdate();
                        player.play({ track: player.queue.previous[0] });
                        await updateComponents();
                    }
                    break;

                case "stop":
                    player.stopPlaying(true, false);
                    await interaction.deferUpdate();
                    // Hapus tombol di nowplaying saat stop
                    await interaction.editReply({ components: [] }); 
                    clearInterval(newInterval);
                    break;

                case "skip":
                    if (!player.queue.tracks.length) {
                        await interaction.reply({ content: ctx.locale("player.trackStart.no_more_songs_in_queue"), ephemeral: true });
                    } else {
                        await interaction.deferUpdate();
                        player.skip();
                        await updateComponents();
                    }
                    break;

                case "shuffle":
                    player.queue.shuffle();
                    await interaction.reply({ content: `Shuffled by ${interaction.user.username}`, ephemeral: true });
                    break;

                case "resume":
                    await interaction.deferUpdate();
                    if (player.paused) player.resume();
                    else player.pause();
                    await updateComponents();
                    break;

                case "loop":
                    await interaction.deferUpdate();
                    switch (player.repeatMode) {
                        case "off": player.setRepeatMode("track"); break;
                        case "track": player.setRepeatMode("queue"); break;
                        case "queue": player.setRepeatMode("off"); break;
                    }
                    await updateComponents();
                    break;
            }
        });

        collector.on("end", () => {
            clearInterval(newInterval);
            if (message.editable) {
                message.edit({ components: [] }).catch(() => null);
            }
        });

        return message;
    }

    private createButtonRow(player: any, client: Lavamusic) {
        const previousButton = new ButtonBuilder().setCustomId("previous").setEmoji(client.emoji.previous).setStyle(ButtonStyle.Secondary).setDisabled(!player.queue.previous.length);
        const resumeButton = new ButtonBuilder().setCustomId("resume").setEmoji(player.paused ? client.emoji.resume : client.emoji.pause).setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Secondary);
        const stopButton = new ButtonBuilder().setCustomId("stop").setEmoji(client.emoji.stop).setStyle(ButtonStyle.Danger);
        const skipButton = new ButtonBuilder().setCustomId("skip").setEmoji(client.emoji.skip).setStyle(ButtonStyle.Secondary);
        
        const shuffleButton = new ButtonBuilder().setCustomId("shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary).setDisabled(player.queue.tracks.length === 0);
        const loopButton = new ButtonBuilder().setCustomId("loop").setEmoji(player.repeatMode === "track" ? client.emoji.loop.track : client.emoji.loop.none).setStyle(player.repeatMode !== "off" ? ButtonStyle.Success : ButtonStyle.Secondary);
        
        const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(previousButton, stopButton, skipButton);
        const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(shuffleButton, resumeButton, loopButton);

        return [row1, row2];
    }
}