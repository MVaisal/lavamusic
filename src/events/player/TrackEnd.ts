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

        // Update setup system
        const locale = await this.client.db.getLanguage(player.guildId);
        await updateSetup(this.client, guild, locale);

        // 1. Matikan Interval Auto-Update agar tidak memakan resource
        const interval = player.get("autoUpdateInterval");
        if (interval) {
            clearInterval(interval as NodeJS.Timeout);
            player.set("autoUpdateInterval", null);
        }

        // 2. [PENTING] Hanya hapus tombol (components: []).
        // JANGAN hapus pesannya (.delete) di sini karena trackStart yang akan melakukannya nanti.
        // Ini hanya untuk jaga-jaga jika queue habis, tombolnya hilang.
        const message = player.get<Message | undefined>("nowPlayingMessage");
        if (message) {
            await message.edit({ components: [] }).catch(() => null);
        }

        // [PENTING] JANGAN set 'nowPlayingMessage' ke null di sini.
        // Biarkan datanya ada agar trackStart.js bisa menemukannya dan menghapusnya (delete)
        // player.set("nowPlayingMessage", null); <--- INI SUDAH DIHAPUS
    }
}