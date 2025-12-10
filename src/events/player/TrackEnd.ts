import type { TextChannel, Message } from "discord.js";
import type { Player, Track, TrackStartEvent } from "lavalink-client";
import { Event, type Lavamusic } from "../../structures/index";
import { updateSetup } from "../../utils/SetupSystem";

export default class TrackEnd extends Event {
    constructor(client: Lavamusic, file: string) {
        super(client, file, {
            name: "trackEnd",
        });
    }

    public async run(
        player: Player,
        _track: Track | null,
        _payload: TrackStartEvent,
    ): Promise<void> {
        const guild = this.client.guilds.cache.get(player.guildId);
        if (!guild) return;

        // Update setup system (jika pakai setup channel khusus)
        const locale = await this.client.db.getLanguage(player.guildId);
        await updateSetup(this.client, guild, locale);

        // --- [LOGIKA BARU] ---

        // 1. Matikan Interval Auto-Update (Penting agar tidak memori leak)
        const interval = player.get("autoUpdateInterval");
        if (interval) {
            clearInterval(interval as NodeJS.Timeout);
            player.set("autoUpdateInterval", null);
        }

        // 2. Ambil pesan Now Playing
        // Prioritas 1: Ambil dari object 'nowPlayingMessage' yang kita simpan di trackStart/nowPlaying
        let message = player.get<Message | undefined>("nowPlayingMessage");

        // Prioritas 2: Fallback ke cara lama (fetch by ID) jika object tidak ketemu
        if (!message) {
            const messageId = player.get<string | undefined>("messageId");
            if (messageId) {
                const channel = guild.channels.cache.get(player.textChannelId!) as TextChannel;
                if (channel) {
                    message = await channel.messages.fetch(messageId).catch(() => undefined);
                }
            }
        }

        // 3. Hapus Tombol (Edit components jadi kosong)
        // Kita ganti 'message.delete()' menjadi '.edit' agar pesan tetap ada tapi tombol hilang
        if (message) {
            await message.edit({ components: [] }).catch(() => null);
        }

        // 4. Bersihkan data di player
        player.set("nowPlayingMessage", null);
        player.set("messageId", null);
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