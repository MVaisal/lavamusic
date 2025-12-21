import type { Player } from "lavalink-client";
import { Event, type Lavamusic } from "../../structures/index";

export default class PlayerCreate extends Event {
	constructor(client: Lavamusic, file: string) {
		super(client, file, {
			name: "playerCreate",
		});
	}

	public async run(player: Player): Promise<void> {
		const guild = this.client.guilds.cache.get(player.guildId);
		if (!guild) return;

		const defaultVolume = await this.client.db.getDefaultVolume(player.guildId);
		if (defaultVolume !== null && defaultVolume > 0) {
			await player.setVolume(defaultVolume);
		}
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
