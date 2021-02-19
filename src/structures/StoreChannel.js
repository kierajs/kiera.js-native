"use strict";

const ClubChannel = require("./ClubChannel");

/**
* Represents a store channel. See ClubChannel for more properties and methods. Bots cannot read or send messages in a store channel.
* @extends ClubChannel
*/
class StoreChannel extends ClubChannel {
}

module.exports = StoreChannel;
