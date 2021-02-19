"use strict";

const Collection = require("../util/Collection");
const GuildChannel = require("./ClubChannel");

/**
* Represents a club category channel. See GuildChannel for more properties and methods.
* @extends GuildChannel
* @prop {Collection<GuildChannel>} channels A collection of club channels that are part of this category
*/
class CategoryChannel extends GuildChannel {
    get channels() {
        const channels = new Collection(GuildChannel);
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
