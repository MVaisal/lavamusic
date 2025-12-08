import { Command, type Context, type Lavamusic } from "../../structures/index";

export default class Stop extends Command {
    constructor(client: Lavamusic) {
        super(client, {
            name: "stop",
            description: {
                content: "cmd.stop.description",
                examples: ["stop"],
                usage: "stop",
            },
            category: "music",
            aliases: ["sp"],
            cooldown: 3,
            args: false,
            vote: false,
            player: {
                voice: true,
                dj: true,
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
        const embed = this.client.embed();
        
        if (!player)
            return await ctx.sendMessage(
                ctx.locale("event.message.no_music_playing"),
            );
        
        player.stopPlaying(true, false);

        // --- [LOGIKA TAMBAHAN: BERSIHKAN PESAN SEBELUMNYA] ---
        
        // 1. Matikan auto-update interval jika ada
        const interval = player.get("autoUpdateInterval");
        if (interval) {
            clearInterval(interval as NodeJS.Timeout);
        }

        // 2. Ambil pesan Now Playing terakhir dan hapus tombolnya
        const nowPlayingMessage = player.get("nowPlayingMessage");
        if (nowPlayingMessage) {
            try {
                await nowPlayingMessage.edit({ components: [] });
            } catch (e) {
                // Abaikan error jika pesan sudah dihapus manual oleh user
            }
        }
        // -----------------------------------------------------

        return await ctx.sendMessage({
            embeds: [
                embed
                    .setColor(this.client.color.main)
                    .setDescription(ctx.locale("cmd.stop.messages.stopped")),
            ],
        });
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