"use strict";

const GuildChannel = require("./ClubChannel");

/**
* Represents a store channel. See GuildChannel for more properties and methods. Bots cannot read or send messages in a store channel.
* @extends GuildChannel
*/
class StoreChannel extends GuildChannel {
}

module.exports = StoreChannel;
