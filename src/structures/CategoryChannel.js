"use strict";

const Collection = require("../util/Collection");
const ClubChannel = require("./ClubChannel");

/**
* Represents a club category channel. See ClubChannel for more properties and methods.
* @extends ClubChannel
* @prop {Collection<ClubChannel>} channels A collection of club channels that are part of this category
*/
class CategoryChannel extends ClubChannel {
    get channels() {
        const channels = new Collection(ClubChannel);
        if(this.club && this.club.channels) {
            for(const channel of this.club.channels.values()) {
                if(channel.parentID === this.id) {
                    channels.add(channel);
                }
            }
        }
        return channels;
    }
}

module.exports = CategoryChannel;
