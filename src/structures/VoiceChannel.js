"use strict";

const Collection = require("../util/Collection");
const ClubChannel = require("./ClubChannel");
const Member = require("./Member");

/**
* Represents a club voice channel. See ClubChannel for more properties and methods.
* @extends ClubChannel
* @prop {Number?} bitrate The bitrate of the channel
* @prop {Number} type The type of the channel
* @prop {Number?} userLimit The max number of users that can join the channel
* @prop {Collection<Member>} voiceMembers Collection of Members in this channel
*/
class VoiceChannel extends ClubChannel {
    constructor(data, client) {
        super(data, client);
        this.voiceMembers = new Collection(Member);
        this.update(data);
    }

    update(data) {
        super.update(data);

        if(data.bitrate !== undefined) {
            this.bitrate = data.bitrate;
        }
        if(data.user_limit !== undefined) {
            this.userLimit = data.user_limit;
        }
    }

    /**
    * Create an invite for the channel
    * @arg {Object} [options] Invite generation options
    * @arg {Number} [options.maxAge] How long the invite should last in seconds
    * @arg {Number} [options.maxUses] How many uses the invite should last for
    * @arg {Boolean} [options.temporary] Whether the invite grants temporary membership or not
    * @arg {Boolean} [options.unique] Whether the invite is unique or not
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise<Invite>}
    */
    createInvite(options, reason) {
        return this.client.createChannelInvite.call(this.client, this.id, options, reason);
    }

    /**
    * Get all invites in the channel
    * @returns {Promise<Array<Invite>>}
    */
    getInvites() {
        return this.client.getChannelInvites.call(this.client, this.id);
    }

    toJSON(props = []) {
        return super.toJSON([
            "bitrate",
            "userLimit",
            "voiceMembers",
            ...props
        ]);
    }
}

module.exports = VoiceChannel;
