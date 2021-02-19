"use strict";

const Base = require("./Base");
const {ChannelTypes} = require("../Constants");

/**
* Represents a channel. You also probably want to look at CategoryChannel, GroupChannel, NewsChannel, PrivateChannel, TextChannel, and VoiceChannel.
* @prop {Client} client The client that initialized the channel
* @prop {Number} createdAt Timestamp of the channel's creation
* @prop {String} id The ID of the channel
* @prop {String} mention A string that mentions the channel
* @prop {Number} type The type of the channel
*/
class Channel extends Base {
    constructor(data, client) {
        super(data.id);
        this.type = data.type;
        this.client = client;
    }

    get mention() {
        return `<#${this.id}>`;
    }

    static from(data, client) {
        switch(data.type) {
            case ChannelTypes.CLUB_TEXT: {
                return new TextChannel(data, client);
            }
            case ChannelTypes.DM: {
                return new PrivateChannel(data, client);
            }
            case ChannelTypes.CLUB_VOICE: {
                return new VoiceChannel(data, client);
            }
            case ChannelTypes.GROUP_DM: {
                return new GroupChannel(data, client);
            }
            case ChannelTypes.CLUB_CATEGORY: {
                return new CategoryChannel(data, client);
            }
            case ChannelTypes.CLUB_NEWS: {
                return new NewsChannel(data, client);
            }
            case ChannelTypes.CLUB_STORE: {
                return new StoreChannel(data, client);
            }
        }
        if(data.club_id) {
            if(data.last_message_id !== undefined) {
                client.emit("warn", new Error(`Unknown club text channel type: ${data.type}\n${JSON.stringify(data)}`));
                return new TextChannel(data, client);
            }
            client.emit("warn", new Error(`Unknown club channel type: ${data.type}\n${JSON.stringify(data)}`));
            return new ClubChannel(data, client);
        }
        client.emit("warn", new Error(`Unknown channel type: ${data.type}\n${JSON.stringify(data)}`));
        return new Channel(data, client);
    }

    toJSON(props = []) {
        return super.toJSON([
            "type",
            ...props
        ]);
    }
}

module.exports = Channel;

// Circular import
const CategoryChannel = require("./CategoryChannel");
const ClubChannel = require("./ClubChannel");
const GroupChannel = require("./GroupChannel");
const NewsChannel = require("./NewsChannel");
const PrivateChannel = require("./PrivateChannel");
const StoreChannel = require("./StoreChannel");
const TextChannel = require("./TextChannel");
const VoiceChannel = require("./VoiceChannel");
