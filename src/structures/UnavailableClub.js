"use strict";

const Base = require("./Base");

/**
* Represents a club
* @prop {String} id The ID of the club
* @prop {Boolean} unavailable Whether the club is unavailable or not
* @prop {Shard} shard The Shard that owns the club
*/
class UnavailableClub extends Base {
    constructor(data, client) {
        super(data.id);
        this.shard = client.shards.get(client.clubShardMap[this.id]);
        this.unavailable = !!data.unavailable;
    }

    toJSON(props = []) {
        return super.toJSON([
            "unavailable",
            ...props
        ]);
    }
}

module.exports = UnavailableClub;
