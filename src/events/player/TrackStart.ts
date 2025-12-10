"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var TrackStart_exports = {};
__export(TrackStart_exports, {
  checkDj: () => checkDj,
  default: () => TrackStart
});
module.exports = __toCommonJS(TrackStart_exports);
var import_discord = require("discord.js");
var import_I18n = require("../../structures/I18n");
var import_structures = require("../../structures/index");
var import_SetupSystem = require("../../utils/SetupSystem");

class TrackStart extends import_structures.Event {
  static {
    __name(this, "TrackStart");
  }
  constructor(client, file) {
    super(client, file, {
      name: "trackStart"
    });
  }
  async run(player, track, _payload) {
    const guild = this.client.guilds.cache.get(player.guildId);
    if (!guild) return;
    if (!player.textChannelId) return;
    if (!track) return;
    const channel = guild.channels.cache.get(player.textChannelId);
    if (!channel) return;
    
    // --- [LOGIKA RESET INTERVAL LAMA] ---
    const oldInterval = player.get("autoUpdateInterval");
    if (oldInterval) clearInterval(oldInterval);

    // --- [UBAHAN: DELETE PESAN LAMA] ---
    // Kita ambil pesan nowPlayingMessage dari lagu sebelumnya
    const oldMessage = player.get("nowPlayingMessage");
    if (oldMessage) {
        try {
            // Hapus pesan lama sepenuhnya agar tidak menumpuk
            await oldMessage.delete();
        } catch (e) {
            // Abaikan error jika pesan sudah dihapus manual atau tidak ada
        }
    }
    // ------------------------------------

    // 1. UPDATE STATUS BOT
    try {
      const rawTitle = `${track.info.title} by ${track.info.author}`;
      const songTitle = rawTitle.length > 60 ? rawTitle.substring(0, 60) + '...' : rawTitle;
      this.client.user.setActivity(songTitle, {
        type: import_discord.ActivityType.Listening
      });
    } catch (e) {
      console.error("Gagal update status:", e);
    }

    this.client.utils.updateStatus(this.client, guild.id);
    const locale = await this.client.db.getLanguage(guild.id);

    // 2. UPDATE STATUS VOICE CHANNEL
    if (player.voiceChannelId) {
      const vcStatusText = `\u{1F3B5} ${track.info.title} by ${track.info.author}`;
      const finalVcStatus = vcStatusText.length > 100 ? vcStatusText.substring(0, 100) : vcStatusText;
      await this.client.utils.setVoiceStatus(this.client, player.voiceChannelId, finalVcStatus);
    }
    
    // SETUP PROGRESS BAR AWAL
    const duration = track.info.duration;
    const position = 0; 
    const progressBar = this.client.utils.progressBar(position, duration, 20); 
    const durationText = track.info.isStream ? "🔴 LIVE" : `\`${this.client.utils.formatTime(position)} / ${this.client.utils.formatTime(duration)}\``;

    // 3. MEMBUAT EMBED
    const embed = this.client.embed()
        .setAuthor({
            name: (0, import_I18n.T)(locale, "player.trackStart.now_playing"),
            iconURL: this.client.config.icons[track.info.sourceName] ?? this.client.user?.displayAvatarURL({ extension: "png" })
        })
        .setColor(this.client.color.main)
        .setDescription(`**[${track.info.title}](${track.info.uri})**\n\n${progressBar}\n${durationText}`)
        .setThumbnail(track.info.artworkUrl)
        .setFooter({
            text: (0, import_I18n.T)(locale, "player.trackStart.requested_by", { user: track.requester.username }),
            iconURL: track.requester.avatarURL
        })
        .setTimestamp();

    embed.addFields({
        name: (0, import_I18n.T)(locale, "player.trackStart.author"),
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

    const setup = await this.client.db.getSetup(guild.id);
    if (setup?.textId) {
        const textChannel = guild.channels.cache.get(setup.textId);
        if (textChannel) {
            await (0, import_SetupSystem.trackStart)(setup.messageId, textChannel, player, track, this.client, locale);
        }
    } else {
        const message = await channel.send({
            embeds: [embed],
            components: createButtonRow(player, this.client)
        });
        
        // --- [SIMPAN PESAN BARU] ---
        // Simpan pesan ini agar bisa dihapus saat lagu berikutnya mulai
        player.set("nowPlayingMessage", message);
        // ---------------------------

        // --- [AUTO UPDATE 30 DETIK] ---
        const interval = setInterval(async () => {
            if (!player || !player.queue.current || player.queue.current.info.uri !== track.info.uri) {
                clearInterval(interval);
                return;
            }
            if (player.paused) return;

            try {
                const currentPos = player.position;
                const totalDur = track.info.duration;
                const newBar = this.client.utils.progressBar(currentPos, totalDur, 20);
                const newTime = track.info.isStream ? "🔴 LIVE" : `\`${this.client.utils.formatTime(currentPos)} / ${this.client.utils.formatTime(totalDur)}\``;
                
                embed.setDescription(`**[${track.info.title}](${track.info.uri})**\n\n${newBar}\n${newTime}`);
                await message.edit({ embeds: [embed] });
            } catch (e) {
                clearInterval(interval);
            }
        }, 30000);
        
        player.set("autoUpdateInterval", interval);
        // ------------------------------

        createCollector(message, player, track, embed, this.client, locale);
    }
  }
}

function createButtonRow(player, client) {
  const previousButton = new import_discord.ButtonBuilder().setCustomId("previous").setEmoji(client.emoji.previous).setStyle(import_discord.ButtonStyle.Secondary).setDisabled(!player.queue.previous);
  const resumeButton = new import_discord.ButtonBuilder().setCustomId("resume").setEmoji(player.paused ? client.emoji.resume : client.emoji.pause).setStyle(player.paused ? import_discord.ButtonStyle.Success : import_discord.ButtonStyle.Secondary);
  const stopButton = new import_discord.ButtonBuilder().setCustomId("stop").setEmoji(client.emoji.stop).setStyle(import_discord.ButtonStyle.Danger);
  const skipButton = new import_discord.ButtonBuilder().setCustomId("skip").setEmoji(client.emoji.skip).setStyle(import_discord.ButtonStyle.Secondary);
  const shuffleButton = new import_discord.ButtonBuilder().setCustomId("shuffle").setEmoji("🔀").setStyle(import_discord.ButtonStyle.Secondary).setDisabled(player.queue.tracks.length === 0);
  const loopButton = new import_discord.ButtonBuilder().setCustomId("loop").setEmoji(player.repeatMode === "track" ? client.emoji.loop.track : client.emoji.loop.none).setStyle(player.repeatMode !== "off" ? import_discord.ButtonStyle.Success : import_discord.ButtonStyle.Secondary);
  
  const row1 = new import_discord.ActionRowBuilder().addComponents(previousButton, stopButton, skipButton);
  const row2 = new import_discord.ActionRowBuilder().addComponents(shuffleButton, resumeButton, loopButton);

  return [row1, row2];
}
__name(createButtonRow, "createButtonRow");

function createCollector(message, player, _track, embed, client, locale) {
  const collector = message.createMessageComponentCollector({
    filter: /* @__PURE__ */ __name(async (b) => {
      if (b.member instanceof import_discord.GuildMember) {
        const isSameVoiceChannel = b.guild?.members.me?.voice.channelId === b.member.voice.channelId;
        if (isSameVoiceChannel) return true;
      }
      await b.reply({
        content: (0, import_I18n.T)(locale, "player.trackStart.not_connected_to_voice_channel", {
          channel: b.guild?.members.me?.voice.channelId ?? "None"
        }),
        flags: import_discord.MessageFlags.Ephemeral
      });
      return false;
    }, "filter")
  });
  
  collector.on("collect", async (interaction) => {
    if (!await checkDj(client, interaction)) {
      await interaction.reply({
        content: (0, import_I18n.T)(locale, "player.trackStart.need_dj_role"),
        flags: import_discord.MessageFlags.Ephemeral
      });
      return;
    }

    const editMessage = /* @__PURE__ */ __name(async (text) => {
      if (message) {
        const currentPos = player.position; 
        const totalDur = player.queue.current.info.duration;
        const newBar = client.utils.progressBar(currentPos, totalDur, 20);
        const newTime = `\`${client.utils.formatTime(currentPos)} / ${client.utils.formatTime(totalDur)}\``;
        const newDesc = `**[${player.queue.current.info.title}](${player.queue.current.info.uri})**\n\n${newBar}\n${newTime}`;

        await message.edit({
          embeds: [
            embed
              .setDescription(newDesc)
              .setFooter({
                text,
                iconURL: interaction.user.avatarURL({})
              })
          ],
          components: createButtonRow(player, client)
        });
      }
    }, "editMessage");
    
    switch (interaction.customId) {
      case "previous":
        if (player.queue.previous) {
          await interaction.deferUpdate();
          const previousTrack = player.queue.previous[0];
          player.play({ track: previousTrack });
          await editMessage((0, import_I18n.T)(locale, "player.trackStart.previous_by", { user: interaction.user.tag }));
        } else {
          await interaction.reply({
            content: (0, import_I18n.T)(locale, "player.trackStart.no_previous_song"),
            flags: import_discord.MessageFlags.Ephemeral
          });
        }
        break;
      case "resume":
        if (player.paused) {
          player.resume();
          await interaction.deferUpdate();
          await editMessage((0, import_I18n.T)(locale, "player.trackStart.resumed_by", { user: interaction.user.tag }));
        } else {
          player.pause();
          await interaction.deferUpdate();
          await editMessage((0, import_I18n.T)(locale, "player.trackStart.paused_by", { user: interaction.user.tag }));
        }
        break;
      case "stop": {
        player.stopPlaying(true, false);
        await interaction.deferUpdate();
        // Hapus tombol saat stop
        await message.edit({ components: [] });
        break;
      }
      case "skip":
        if (player.queue.tracks.length > 0) {
          await interaction.deferUpdate();
          player.skip();
          await editMessage((0, import_I18n.T)(locale, "player.trackStart.skipped_by", { user: interaction.user.tag }));
        } else {
          await interaction.reply({
            content: (0, import_I18n.T)(locale, "player.trackStart.no_more_songs_in_queue"),
            flags: import_discord.MessageFlags.Ephemeral
          });
        }
        break;
      case "shuffle": {
        player.queue.shuffle();
        await interaction.deferUpdate();
        await editMessage(`Shuffled by ${interaction.user.tag}`);
        break;
      }
      case "loop": {
        await interaction.deferUpdate();
        switch (player.repeatMode) {
          case "off": {
            player.setRepeatMode("track");
            await editMessage((0, import_I18n.T)(locale, "player.trackStart.looping_by", { user: interaction.user.tag }));
            break;
          }
          case "track": {
            player.setRepeatMode("queue");
            await editMessage((0, import_I18n.T)(locale, "player.trackStart.looping_queue_by", { user: interaction.user.tag }));
            break;
          }
          case "queue": {
            player.setRepeatMode("off");
            await editMessage((0, import_I18n.T)(locale, "player.trackStart.looping_off_by", { user: interaction.user.tag }));
            break;
          }
        }
        break;
      }
    }
  });
}
__name(createCollector, "createCollector");
async function checkDj(client, interaction) {
  const dj = await client.db.getDj(interaction.guildId);
  if (dj?.mode) {
    const djRole = await client.db.getRoles(interaction.guildId);
    if (!djRole) return false;
    const hasDjRole = interaction.member.roles.cache.some((role) => djRole.map((r) => r.roleId).includes(role.id));
    if (!(hasDjRole || interaction.member.permissions.has(import_discord.PermissionFlagsBits.ManageGuild))) {
      return false;
    }
  }
  return true;
}
__name(checkDj, "checkDj");
0 && (module.exports = {
  checkDj
});