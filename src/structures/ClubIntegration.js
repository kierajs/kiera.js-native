"use strict";

const Base = require("./Base");

/**
* Represents a club integration
* @prop {Object} account Info on the integration account
* @prop {String} account.id The ID of the integration account
* @prop {String} account.name The name of the integration account
* @prop {Number} createdAt Timestamp of the club integration's creation
* @prop {Boolean} enabled Whether the integration is enabled or not
* @prop {Boolean} enableEmoticons Whether integration emoticons are enabled or not
* @prop {Number} expireBehavior behavior of expired subscriptions
* @prop {Number} expireGracePeriod grace period for expired subscriptions
* @prop {String} id The ID of the integration
* @prop {String} name The name of the integration
* @prop {String} roleID The ID of the role connected to the integration
* @prop {Number} subscriberCount number of subscribers
* @prop {Number} syncedAt Unix timestamp of last integration sync
* @prop {Boolean} syncing Whether the integration is syncing or not
* @prop {String} type The type of the integration
* @prop {User} user The user connected to the integration
*/
class ClubIntegration extends Base {
    constructor(data, club) {
        super(data.id);
        this.club = club;
        this.name = data.name;
        this.type = data.type;
        this.roleID = data.role_id;
        this.user = club.shard.client.users.add(data.user, club.shard.client);
        this.account = data.account; // not worth making a class for
        this.update(data);
    }

    update(data) {
        this.enabled = data.enabled;
        this.syncing = data.syncing;
        this.expireBehavior = data.expire_behavior;
        this.expireGracePeriod = data.expire_grace_period;
        this.enableEmoticons = data.enable_emoticons;
        this.subscriberCount = data.subscriber_count;
        this.syncedAt = data.synced_at;
    }

    /**
    * Delete the club integration
    * @returns {Promise}
    */
    delete() {
        return this.club.shard.client.deleteClubIntegration.call(this.club.shard.client, this.club.id, this.id);
    }

    /**
    * Edit the club integration
    * @arg {Object} options The properties to edit
    * @arg {String} [options.expireBehavior] What to do when a user's subscription runs out
    * @arg {String} [options.expireGracePeriod] How long before the integration's role is removed from an unsubscribed user
    * @arg {String} [options.enableEmoticons] Whether to enable integration emoticons or not
    * @returns {Promise}
    */
    edit(options) {
        return this.club.shard.client.editClubIntegration.call(this.club.shard.client, this.club.id, this.id, options);
    }

    /**
    * Force the club integration to sync
    * @returns {Promise}
    */
    sync() {
        return this.club.shard.client.syncClubIntegration.call(this.club.shard.client, this.club.id, this.id);
    }

    toJSON(props = []) {
        return super.toJSON([
            "account",
            "enabled",
            "enableEmoticons",
            "expireBehavior",
            "expireGracePeriod",
            "name",
            "roleID",
            "subscriberCount",
            "syncedAt",
            "syncing",
            "type",
            "user",
            ...props
        ]);
    }
}

module.exports = ClubIntegration;
