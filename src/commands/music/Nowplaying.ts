import { Command, type Context, type Lavamusic } from "../../structures/index";
import { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    GuildMember,
    ComponentType
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

        // 1. Cek apakah ada musik
        if (!player || !player.queue.current) {
            const noMusic = ctx.locale("event.message.no_music_playing");
            const embed = new EmbedBuilder()
                .setColor(this.client.color.red)
                .setDescription(noMusic);
                
            return ctx.sendMessage({
                embeds: [embed]
            });
        }

        const track = player.queue.current;
        const pos = player.position;
        const dur = track.info.duration;
        const bar = client.utils.progressBar(pos, dur, 20);

        // 2. Membuat Embed Utama
        const embed = new EmbedBuilder()
            .setColor(this.client.color.main)
            .setAuthor({
                name: ctx.locale("cmd.nowplaying.now_playing"),
                iconURL: ctx.author.displayAvatarURL()
            })
            .setDescription(`**[${track.info.title}](${track.info.uri ?? ""})**\n\n${bar}\n\`${client.utils.formatTime(pos)} / ${client.utils.formatTime(dur)}\``)
            .setThumbnail(track.info.artworkUrl ?? null)
            .setFooter({
                // Menggunakan key dari TrackStart karena sudah pasti ada
                text: ctx.locale("player.trackStart.requested_by", { user: (track.requester as any).username || "Unknown" }),
                iconURL: (track.requester as any).avatarURL || null
            })
            .setTimestamp();

        // 3. Menambahkan Info Detail
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

        // 4. Membuat Tombol (Fungsi Helper di bawah)
        const components = this.createButtonRow(player, client);

        // 5. Kirim Pesan & Simpan ke Variabel 'message'
        const message = await ctx.sendMessage({
            embeds: [embed],
            components: components
        });

        // 6. [PENTING] Pasang Collector agar tombol berfungsi
        // Kita menggunakan logika yang sama dengan TrackStart
        const collector = message.createMessageComponentCollector({
            filter: (b) => {
                if (b.member instanceof GuildMember) {
                    if (b.guild?.members.me?.voice.channelId === b.member.voice.channelId) return true;
                }
                b.reply({
                    content: ctx.locale("player.trackStart.not_connected_to_voice_channel", {
                        channel: b.guild?.members.me?.voice.channelId ?? "None"
                    }),
                    ephemeral: true
                });
                return false;
            },
            componentType: ComponentType.Button,
            time: 60000 // Tombol aktif selama 60 detik (hemat memori)
        });

        collector.on("collect", async (interaction) => {
             // Cek DJ Permission (Opsional, jika ingin ketat bisa diaktifkan)
             // Untuk NowPlaying biasanya dibebaskan atau cek DJ standar
             
             // Update tombol setiap kali ada interaksi
            const updateComponents = async () => {
                await interaction.editReply({
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
                    await updateComponents();
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
                    // Tidak perlu update tombol untuk shuffle
                    break;

                case "resume": // Menangani Pause/Resume
                    await interaction.deferUpdate();
                    if (player.paused) {
                        player.resume();
                    } else {
                        player.pause();
                    }
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

        // Hapus tombol saat waktu habis agar tidak error jika diklik nanti
        collector.on("end", () => {
            if (message.editable) {
                message.edit({ components: [] }).catch(() => null);
            }
        });

        return message;
    }

    // Helper untuk membuat baris tombol
    private createButtonRow(player: any, client: Lavamusic) {
        const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("previous").setEmoji(client.emoji.previous).setStyle(ButtonStyle.Secondary).setDisabled(!player.queue.previous.length),
            new ButtonBuilder().setCustomId("stop").setEmoji(client.emoji.stop).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("skip").setEmoji(client.emoji.skip).setStyle(ButtonStyle.Secondary)
        );

        const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary).setDisabled(player.queue.tracks.length === 0),
            new ButtonBuilder()
                .setCustomId("resume")
                .setEmoji(player.paused ? client.emoji.resume : client.emoji.pause)
                .setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("loop")
                .setEmoji(player.repeatMode === "track" ? client.emoji.loop.track : client.emoji.loop.none)
                .setStyle(player.repeatMode !== "off" ? ButtonStyle.Success : ButtonStyle.Secondary)
        );

        return [row1, row2];
    }
}