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
var QueueEnd_exports = {};
__export(QueueEnd_exports, {
  default: () => QueueEnd
});
module.exports = __toCommonJS(QueueEnd_exports);
var import_structures = require("../../structures/index");
var import_SetupSystem = require("../../utils/SetupSystem");

class QueueEnd extends import_structures.Event {
  static {
    __name(this, "QueueEnd");
  }
  constructor(client, file) {
    super(client, file, {
      name: "queueEnd"
    });
  }
  async run(player, _track, _payload) {
    const guild = this.client.guilds.cache.get(player.guildId);
    if (!guild) return;

    // --- PERUBAHAN STATUS DEFAULT (KODE ASLI KAMU) ---
    try {
        const defaultActivity = process.env.BOT_ACTIVITY || "Fubukirea";
        const defaultType = process.env.BOT_ACTIVITY_TYPE ? Number(process.env.BOT_ACTIVITY_TYPE) : 2;
        this.client.user.setActivity(defaultActivity, { type: defaultType });
    } catch (e) {
        console.error("Gagal reset status:", e);
    }
    // --- SELESAI PERUBAHAN ---

    const locale = await this.client.db.getLanguage(player.guildId);
    await (0, import_SetupSystem.updateSetup)(this.client, guild, locale);
    
    if (player.voiceChannelId) {
      await this.client.utils.setVoiceStatus(this.client, player.voiceChannelId, "");
    }

    // --- PERBAIKAN LOGIKA PENGHAPUSAN TOMBOL ---
    // 1. Coba ambil ID pesan dari dua kemungkinan tempat penyimpanan
    const messageId = player.get("messageId") || player.nowPlayingMessage?.id;
    
    if (!messageId) {
        // Jika tidak ada ID, kita tidak bisa menghapus apa-apa
        return; 
    }

    const channel = guild.channels.cache.get(player.textChannelId);
    if (!channel) return;

    try {
        // 2. Fetch pesan secara eksplisit
        const message = await channel.messages.fetch(messageId);
        
        // 3. Jika pesan ditemukan dan bisa diedit, hapus komponennya
        if (message && message.editable) {
            await message.edit({
                components: []
            });
            // Debug log (bisa dihapus nanti jika sudah sukses)
            console.log(`[QueueEnd] Tombol berhasil dihapus dari pesan ID: ${messageId}`);
        }
    } catch (error) {
        // Jika pesan sudah dihapus manual atau tidak ketemu, error akan muncul di sini (tidak bikin bot crash)
        // Kita abaikan error "Unknown Message" karena berarti pesan memang sudah hilang
        if (error.code !== 10008) { 
            console.error("[QueueEnd] Gagal menghapus tombol:", error);
        }
    }
  }
}