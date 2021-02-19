"use strict";

const Base = require("../structures/Base");
const Collection = require("../util/Collection");

class VoiceConnectionManager extends Collection {
    constructor(vcObject) {
        super(vcObject || require("./VoiceConnection"));
        this.pendingClubs = {};
    }

    join(clubID, channelID, options) {
        const connection = this.get(clubID);
        if(connection && connection.ws) {
            connection.switchChannel(channelID);
            if(connection.ready) {
                return Promise.resolve(connection);
            } else {
                return new Promise((res, rej) => {
                    const disconnectHandler = () => {
                        connection.removeListener("ready", readyHandler);
                        connection.removeListener("error", errorHandler);
                        rej(new Error("Disconnected"));
                    };
                    const readyHandler = () => {
                        connection.removeListener("disconnect", disconnectHandler);
                        connection.removeListener("error", errorHandler);
                        res(connection);
                    };
                    const errorHandler = (err) => {
                        connection.removeListener("disconnect", disconnectHandler);
                        connection.removeListener("ready", readyHandler);
                        connection.disconnect();
                        rej(err);
                    };
                    connection.once("ready", readyHandler).once("disconnect", disconnectHandler).once("error", errorHandler);
                });
            }
        }
        return new Promise((res, rej) => {
            this.pendingClubs[clubID] = {
                channelID: channelID,
                options: options || {},
                res: res,
                rej: rej,
                timeout: setTimeout(() => {
                    delete this.pendingClubs[clubID];
                    rej(new Error("Voice connection timeout"));
                }, 10000)
            };
        });
    }

    leave(clubID) {
        const connection = this.get(clubID);
        if(!connection) {
            return;
        }
        connection.disconnect();
        connection._destroy();
        this.remove(connection);
    }

    switch(clubID, channelID) {
        const connection = this.get(clubID);
        if(!connection) {
            return;
        }
        connection.switch(channelID);
    }

    voiceServerUpdate(data) {
        if(this.pendingClubs[data.club_id] && this.pendingClubs[data.club_id].timeout) {
            clearTimeout(this.pendingClubs[data.club_id].timeout);
            this.pendingClubs[data.club_id].timeout = null;
        }
        let connection = this.get(data.club_id);
        if(!connection) {
            if(!this.pendingClubs[data.club_id]) {
                return;
            }
            connection = this.add(new this.baseObject(data.club_id, {
                shard: data.shard,
                opusOnly: this.pendingClubs[data.club_id].options.opusOnly,
                shared: this.pendingClubs[data.club_id].options.shared
            }));
        }
        connection.connect({
            channel_id: (this.pendingClubs[data.club_id] || connection).channelID,
            endpoint: data.endpoint,
            token: data.token,
            session_id: data.session_id,
            user_id: data.user_id
        });
        if(!this.pendingClubs[data.club_id] || this.pendingClubs[data.club_id].waiting) {
            return;
        }
        this.pendingClubs[data.club_id].waiting = true;
        const disconnectHandler = () => {
            connection = this.get(data.club_id);
            if(connection) {
                connection.removeListener("ready", readyHandler);
                connection.removeListener("error", errorHandler);
            }
            if(this.pendingClubs[data.club_id]) {
                this.pendingClubs[data.club_id].rej(new Error("Disconnected"));
                delete this.pendingClubs[data.club_id];
            }
        };
        const readyHandler = () => {
            connection = this.get(data.club_id);
            if(connection) {
                connection.removeListener("disconnect", disconnectHandler);
                connection.removeListener("error", errorHandler);
            }
            if(this.pendingClubs[data.club_id]) {
                this.pendingClubs[data.club_id].res(connection);
                delete this.pendingClubs[data.club_id];
            }
        };
        const errorHandler = (err) => {
            connection = this.get(data.club_id);
            if(connection) {
                connection.removeListener("disconnect", disconnectHandler);
                connection.removeListener("ready", readyHandler);
                connection.disconnect();
            }
            if(this.pendingClubs[data.club_id]) {
                this.pendingClubs[data.club_id].rej(err);
                delete this.pendingClubs[data.club_id];
            }
        };
        connection.once("ready", readyHandler).once("disconnect", disconnectHandler).once("error", errorHandler);
    }

    toString() {
        return "[VoiceConnectionManager]";
    }

    toJSON(props = []) {
        return Base.prototype.toJSON.call(this, [
            "pendingClubs",
            ...props
        ]);
    }
}

module.exports = VoiceConnectionManager;
