"use strict";

const Base = require("../structures/Base");
const Bucket = require("../util/Bucket");
//const Call = require("../structures/Call");
const Channel = require("../structures/Channel");
const GroupChannel = require("../structures/GroupChannel");
const ClubChannel = require("../structures/ClubChannel");
const PrivateChannel = require("../structures/PrivateChannel");
const {GATEWAY_VERSION, GatewayOPCodes, ChannelTypes} = require("../Constants");
const ExtendedUser = require("../structures/ExtendedUser");
const User = require("../structures/User");
const Invite = require("../structures/Invite");
const Constants = require("../Constants");
let WebSocket = typeof window !== "undefined" ? require("../util/BrowserWebSocket") : require("ws");

let EventEmitter;
try {
    EventEmitter = require("eventemitter3");
} catch(err) {
    EventEmitter = require("events").EventEmitter;
}
let Erlpack;
try {
    Erlpack = require("erlpack");
} catch(err) { // eslint-disable no-empty
}
let ZlibSync;
try {
    ZlibSync = require("zlib-sync");
} catch(err) {
    try {
        ZlibSync = require("pako");
    } catch(err) { // eslint-disable no-empty
    }
}
try {
    WebSocket = require("uws");
} catch(err) { // eslint-disable no-empty
}

/**
* Represents a shard
* @extends EventEmitter
* @prop {Number} id The ID of the shard
* @prop {Boolean} connecting Whether the shard is connecting
* @prop {Array<String>?} helseliaServerTrace Debug trace of Helselia servers
* @prop {Number} lastHeartbeatReceived Last time Helselia acknowledged a heartbeat, null if shard has not sent heartbeat yet
* @prop {Number} lastHeartbeatSent Last time shard sent a heartbeat, null if shard has not sent heartbeat yet
* @prop {Number} latency The current latency between the shard and Helselia, in milliseconds
* @prop {Boolean} ready Whether the shard is ready
* @prop {String} status The status of the shard. "disconnected"/"connecting"/"handshaking"/"ready"
*/
class Shard extends EventEmitter {
    constructor(id, client) {
        super();

        this.id = id;
        this.client = client;

        this.onPacket = this.onPacket.bind(this);
        this._onWSOpen = this._onWSOpen.bind(this);
        this._onWSMessage = this._onWSMessage.bind(this);
        this._onWSError = this._onWSError.bind(this);
        this._onWSClose = this._onWSClose.bind(this);

        this.hardReset();
    }

    checkReady() {
        if(!this.ready) {
            if(this.clubSyncQueue.length > 0) {
                this.requestClubSync(this.clubSyncQueue);
                this.clubSyncQueue = [];
                this.clubSyncQueueLength = 1;
                return;
            }
            if(this.unsyncedClubs > 0) {
                return;
            }
            if(this.getAllUsersQueue.length > 0) {
                this.requestClubMembers(this.getAllUsersQueue);
                this.getAllUsersQueue = [];
                this.getAllUsersLength = 1;
                return;
            }
            if(Object.keys(this.getAllUsersCount).length === 0) {
                this.ready = true;
                /**
                * Fired when the shard turns ready
                * @event Shard#ready
                */
                super.emit("ready");
            }
        }
    }

    /**
    * Tells the shard to connect
    */
    connect() {
        if(this.ws && this.ws.readyState != WebSocket.CLOSED) {
            this.emit("error", new Error("Existing connection detected"), this.id);
            return;
        }
        ++this.connectAttempts;
        this.connecting = true;
        return this.initializeWS();
    }

    createClub(_club) {
        this.client.clubShardMap[_club.id] = this.id;
        const club = this.client.clubs.add(_club, this.client, true);
        if(this.client.bot === false) {
            ++this.unsyncedClubs;
            this.syncClub(club.id);
        }
        if(this.client.options.getAllUsers && club.members.size < club.memberCount) {
            this.getClubMembers(club.id);
        }
        return club;
    }

    /**
    * Disconnects the shard
    * @arg {Object?} [options] Shard disconnect options
    * @arg {String | Boolean} [options.reconnect] false means destroy everything, true means you want to reconnect in the future, "auto" will autoreconnect
    * @arg {Error} [error] The error that causes the disconnect
    */
    disconnect(options = {}, error) {
        if(!this.ws) {
            return;
        }

        if(this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        if(this.ws.readyState !== WebSocket.CLOSED) {
            this.ws.removeEventListener("close", this._onWSClose);
            try {
                if(options.reconnect && this.sessionID) {
                    if(this.ws.readyState === WebSocket.OPEN) {
                        this.ws.close(4901, "Reconnect: Kiera");
                    } else {
                        this.ws.terminate();
                    }
                } else {
                    this.ws.close(1000, "Normal: Kiera");
                }
            } catch(err) {
                this.emit("error", err, this.id);
            }
        }
        this.ws = null;
        this.reset();

        if(error) {
            this.emit("error", error, this.id);
        }

        /**
        * Fired when the shard disconnects
        * @event Shard#disconnect
        */
        super.emit("disconnect");

        if(this.sessionID && this.connectAttempts >= this.client.options.maxResumeAttempts) {
            this.emit("debug", `Automatically invalidating session due to excessive resume attempts | Attempt ${this.connectAttempts}`, this.id);
            this.sessionID = null;
        }

        if(options.reconnect === "auto" && this.client.options.autoreconnect) {
            /**
            * Fired when stuff happens and gives more info
            * @event Client#debug
            * @prop {String} message The debug message
            * @prop {Number} id The ID of the shard
            */
            if(this.sessionID) {
                this.emit("debug", `Immediately reconnecting for potential resume | Attempt ${this.connectAttempts}`, this.id);
                this.client.shards.connect(this);
            } else {
                this.emit("debug", `Queueing reconnect in ${this.reconnectInterval}ms | Attempt ${this.connectAttempts}`, this.id);
                setTimeout(() => {
                    this.client.shards.connect(this);
                }, this.reconnectInterval);
                this.reconnectInterval = Math.min(Math.round(this.reconnectInterval * (Math.random() * 2 + 1)), 30000);
            }
        } else if(!options.reconnect) {
            this.hardReset();
        }
    }

    /**
    * Update the bot's AFK status. Setting this to true will enable push notifications for userbots.
    * @arg {Boolean} afk Whether the bot user is AFK or not
    */
    editAFK(afk) {
        this.presence.afk = !!afk;

        this.sendStatusUpdate();
    }

    /**
    * Updates the bot's status on all clubs the shard is in
    * @arg {String} [status] Sets the bot's status, either "online", "idle", "dnd", or "invisible"
    * @arg {Object} [game] Sets the bot's active game, null to clear
    * @arg {String} game.name Sets the name of the bot's active game
    * @arg {Number} [game.type] The type of game. 0 is default, 1 is streaming (Twitch only)
    * @arg {String} [game.url] Sets the url of the shard's active game
    */
    editStatus(status, game) {
        if(game === undefined && typeof status === "object") {
            game = status;
            status = undefined;
        }
        if(status) {
            this.presence.status = status;
        }
        if(game !== undefined) {
            if(game !== null && !game.hasOwnProperty("type")) {
                game.type = game.url ? 1 : 0; // No other types _yet_
            }
            this.presence.game = game;
        }

        this.sendStatusUpdate();

        this.client.clubs.forEach((club) => {
            if(club.shard.id === this.id) {
                club.members.get(this.client.user.id).update(this.presence);
            }
        });
    }

    emit(event, ...args) {
        this.client.emit.call(this.client, event, ...args);
        if(event !== "error" || this.listeners("error").length > 0) {
            super.emit.call(this, event, ...args);
        }
    }

    getClubMembers(clubID, timeout) {
        if(this.getAllUsersCount.hasOwnProperty(clubID)) {
            throw new Error("Cannot request all members while an existing request is processing");
        }
        this.getAllUsersCount[clubID] = true;
        // Using intents, request one club at a time
        if(this.client.options.intents) {
            if(!(this.client.options.intents & Constants.Intents.clubMembers)) {
                throw new Error("Cannot request all members without clubMembers intent");
            }
            this.requestClubMembers([clubID], timeout);
        } else {
            if(this.getAllUsersLength + 3 + clubID.length > 4048) { // 4096 - "{\"op\":8,\"d\":{\"club_id\":[],\"query\":\"\",\"limit\":0}}".length + 1 for lazy comma offset
                this.requestClubMembers(this.getAllUsersQueue);
                this.getAllUsersQueue = [clubID];
                this.getAllUsersLength = 1 + clubID.length + 3;
            } else {
                this.getAllUsersQueue.push(clubID);
                this.getAllUsersLength += clubID.length + 3;
            }
        }
    }

    hardReset() {
        this.reset();
        this.seq = 0;
        this.sessionID = null;
        this.reconnectInterval = 1000;
        this.connectAttempts = 0;
        this.ws = null;
        this.heartbeatInterval = null;
        this.clubCreateTimeout = null;
        this.globalBucket = new Bucket(120, 60000, {reservedTokens: 5});
        this.presenceUpdateBucket = new Bucket(5, 60000);
        this.presence = JSON.parse(JSON.stringify(this.client.presence)); // Fast copy
        Object.defineProperty(this, "_token", {
            configurable: true,
            enumerable: false,
            value: this.client.token
        });
    }

    heartbeat(normal) {
        // Can only heartbeat after resume succeeds, helselia/helselia-api-docs#1619
        if(this.status === "resuming") {
            return;
        }
        if(normal) {
            if(!this.lastHeartbeatAck) {
                this.emit("debug", "Heartbeat timeout; " + JSON.stringify({
                    lastReceived: this.lastHeartbeatReceived,
                    lastSent: this.lastHeartbeatSent,
                    interval: this.heartbeatInterval,
                    status: this.status,
                    timestamp: Date.now()
                }));
                return this.disconnect({
                    reconnect: "auto"
                }, new Error("Server didn't acknowledge previous heartbeat, possible lost connection"));
            }
            this.lastHeartbeatAck = false;
        }
        this.lastHeartbeatSent = new Date().getTime();
        this.sendWS(GatewayOPCodes.HEARTBEAT, this.seq, true);
    }

    identify() {
        if(this.client.options.compress && !ZlibSync) {
            /**
            * Fired when the shard encounters an error
            * @event Client#error
            * @prop {Error} err The error
            * @prop {Number} id The ID of the shard
            */
            this.emit("error", new Error("pako/zlib-sync not found, cannot decompress data"));
            return;
        }
        const identify = {
            token: this._token,
            v: GATEWAY_VERSION,
            compress: !!this.client.options.compress,
            large_threshold: this.client.options.largeThreshold,
            club_subscriptions: !!this.client.options.clubSubscriptions,
            intents: this.client.options.intents,
            properties: {
                "os": process.platform,
                "browser": "Helselia",
                "device": "Helselia"
            }
        };
        if(this.client.options.maxShards > 1) {
            identify.shard = [this.id, this.client.options.maxShards];
        }
        if(this.presence.status) {
            identify.presence = this.presence;
        }
        this.sendWS(GatewayOPCodes.IDENTIFY, identify);
    }

    initializeWS() {
        if(!this._token) {
            return this.disconnect(null, new Error("Token not specified"));
        }

        this.status = "connecting";
        if(this.client.options.compress) {
            this.emit("debug", "Initializing zlib-sync-based compression");
            this._zlibSync = new ZlibSync.Inflate({
                chunkSize: 128 * 1024
            });
        }
        this.ws = new WebSocket(this.client.gatewayURL, this.client.options.ws);
        this.ws.on("open", this._onWSOpen);
        this.ws.on("message", this._onWSMessage);
        this.ws.on("error", this._onWSError);
        this.ws.on("close", this._onWSClose);

        this.connectTimeout = setTimeout(() => {
            if(this.connecting) {
                this.disconnect({
                    reconnect: "auto"
                }, new Error("Connection timeout"));
            }
        }, this.client.options.connectionTimeout);
    }

    onPacket(packet) {
        if(this.listeners("rawWS").length > 0 || this.client.listeners("rawWS").length) {
            /**
            * Fired when the shard receives a websocket packet
            * @event Client#rawWS
            * @prop {Object} packet The packet
            * @prop {Number} id The ID of the shard
            */
            this.emit("rawWS", packet, this.id);
        }

        if(packet.s) {
            if(packet.s > this.seq + 1 && this.ws && this.status !== "resuming") {
                /**
                * Fired to warn of something weird but non-breaking happening
                * @event Client#warn
                * @prop {String} message The warning message
                * @prop {Number} id The ID of the shard
                */
                this.emit("warn", `Non-consecutive sequence (${this.seq} -> ${packet.s})`, this.id);
            }
            this.seq = packet.s;
        }

        switch(packet.op) {
            case GatewayOPCodes.EVENT: {
                if(!this.client.options.disableEvents[packet.t]) {
                    this.wsEvent(packet);
                }
                break;
            }
            case GatewayOPCodes.HEARTBEAT: {
                this.heartbeat();
                break;
            }
            case GatewayOPCodes.INVALID_SESSION: {
                this.seq = 0;
                this.sessionID = null;
                this.emit("warn", "Invalid session, reidentifying!", this.id);
                this.identify();
                break;
            }
            case GatewayOPCodes.RECONNECT: {
                this.disconnect({
                    reconnect: "auto"
                });
                break;
            }
            case GatewayOPCodes.HELLO: {
                if(packet.d.heartbeat_interval > 0) {
                    if(this.heartbeatInterval) {
                        clearInterval(this.heartbeatInterval);
                    }
                    this.heartbeatInterval = setInterval(() => this.heartbeat(true), packet.d.heartbeat_interval);
                }

                this.helseliaServerTrace = packet.d._trace;
                this.connecting = false;
                if(this.connectTimeout) {
                    clearTimeout(this.connectTimeout);
                }
                this.connectTimeout = null;

                if(this.sessionID) {
                    this.resume();
                } else {
                    this.identify();
                    // Cannot heartbeat when resuming, helselia/helselia-api-docs#1619
                    this.heartbeat();
                }
                /**
                * Fired when a shard receives an OP:10/HELLO packet
                * @event Client#hello
                * @prop {Array<String>} trace The Helselia server trace of the gateway and session servers
                * @prop {Number} id The ID of the shard
                */
                this.emit("hello", packet.d._trace, this.id);
                break; /* eslint-enable no-unreachable */
            }
            case GatewayOPCodes.HEARTBEAT_ACK: {
                this.lastHeartbeatAck = true;
                this.lastHeartbeatReceived = new Date().getTime();
                this.latency = this.lastHeartbeatReceived - this.lastHeartbeatSent;
                break;
            }
            default: {
                this.emit("unknown", packet, this.id);
                break;
            }
        }
    }

    requestClubMembers(clubID, options) {
        const opts = {
            club_id: clubID,
            limit: (options && options.limit) || 0,
            user_ids: options && options.userIDs,
            query: options && options.query,
            nonce: Date.now().toString() + Math.random().toString(36),
            presences: options && options.presences
        };
        if(!opts.user_ids && !opts.query) {
            opts.query = "";
        }
        if(!opts.query && (this.client.options.intents && !(this.client.options.intents & Constants.Intents.clubMembers))) {
            throw new Error("Cannot request all members without clubMembers intent");
        }
        if(opts.user_ids && opts.user_ids.length > 100) {
            throw new Error("Cannot request more than 100 users by their ID");
        }
        this.sendWS(GatewayOPCodes.GET_CLUB_MEMBERS, opts);
        return new Promise((res) => this.requestMembersPromise[opts.nonce] = {
            res: res,
            received: 0,
            members: [],
            timeout: setTimeout(() => {
                res(this.requestMembersPromise[opts.nonce].members);
                delete this.requestMembersPromise[opts.nonce];
            }, (options && options.timeout) || this.client.options.requestTimeout)
        });
    }

    requestClubSync(clubID) {
        this.sendWS(GatewayOPCodes.SYNC_CLUB, clubID);
    }

    reset() {
        this.connecting = false;
        this.ready = false;
        this.preReady = false;
        if(this.requestMembersPromise !== undefined) {
            for(const clubID in this.requestMembersPromise) {
                if(!this.requestMembersPromise.hasOwnProperty(clubID)) {
                    continue;
                }
                clearTimeout(this.requestMembersPromise[clubID].timeout);
                this.requestMembersPromise[clubID].res(this.requestMembersPromise[clubID].received);
            }
        }
        this.requestMembersPromise = {};
        this.getAllUsersCount = {};
        this.getAllUsersQueue = [];
        this.getAllUsersLength = 1;
        this.clubSyncQueue = [];
        this.clubSyncQueueLength = 1;
        this.unsyncedClubs = 0;
        this.latency = Infinity;
        this.lastHeartbeatAck = true;
        this.lastHeartbeatReceived = null;
        this.lastHeartbeatSent = null;
        this.status = "disconnected";
        if(this.connectTimeout) {
            clearTimeout(this.connectTimeout);
        }
        this.connectTimeout = null;
    }

    restartClubCreateTimeout() {
        if(this.clubCreateTimeout) {
            clearTimeout(this.clubCreateTimeout);
            this.clubCreateTimeout = null;
        }
        if(!this.ready) {
            if(this.client.unavailableClubs.size === 0 && this.unsyncedClubs === 0) {
                return this.checkReady();
            }
            this.clubCreateTimeout = setTimeout(() => {
                this.checkReady();
            }, this.client.options.clubCreateTimeout);
        }
    }

    resume() {
        this.status = "resuming";
        this.sendWS(GatewayOPCodes.RESUME, {
            token: this._token,
            session_id: this.sessionID,
            seq: this.seq
        });
    }

    sendStatusUpdate() {
        this.sendWS(GatewayOPCodes.STATUS_UPDATE, {
            afk: !!this.presence.afk, // For push notifications
            game: this.presence.game,
            since: this.presence.status === "idle" ? Date.now() : 0,
            status: this.presence.status
        });
    }

    sendWS(op, _data, priority = false) {
        if(this.ws && this.ws.readyState === WebSocket.OPEN) {
            let i = 0;
            let waitFor = 1;
            const func = () => {
                if(++i >= waitFor && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    const data = Erlpack ? Erlpack.pack({op: op, d: _data}) : JSON.stringify({op: op, d: _data});
                    this.ws.send(data);
                    if(_data.token) {
                        delete _data.token;
                    }
                    this.emit("debug", JSON.stringify({op: op, d: _data}), this.id);
                }
            };
            if(op === GatewayOPCodes.STATUS_UPDATE) {
                ++waitFor;
                this.presenceUpdateBucket.queue(func, priority);
            }
            this.globalBucket.queue(func, priority);
        }
    }

    syncClub(clubID) {
        if(this.clubSyncQueueLength + 3 + clubID.length > 4081) { // 4096 - "{\"op\":12,\"d\":[]}".length + 1 for lazy comma offset
            this.requestClubSync(this.clubSyncQueue);
            this.clubSyncQueue = [clubID];
            this.clubSyncQueueLength = 1 + clubID.length + 3;
        } else if(this.ready) {
            this.requestClubSync([clubID]);
        } else {
            this.clubSyncQueue.push(clubID);
            this.clubSyncQueueLength += clubID.length + 3;
        }
    }

    wsEvent(packet) {
        switch(packet.t) { /* eslint-disable no-redeclare */ // (╯°□°）╯︵ ┻━┻
            case "PRESENCE_UPDATE": {
                if(packet.d.user.username !== undefined) {
                    let user = this.client.users.get(packet.d.user.id);
                    let oldUser = null;
                    if(user && (user.username !== packet.d.user.username || user.avatar !== packet.d.user.avatar || user.discriminator !== packet.d.user.discriminator)) {
                        oldUser = {
                            username: user.username,
                            discriminator: user.discriminator,
                            avatar: user.avatar
                        };
                    }
                    if(!user || oldUser) {
                        user = this.client.users.update(packet.d.user, this.client);
                        /**
                        * Fired when a user's username, avatar, or discriminator changes
                        * @event Client#userUpdate
                        * @prop {User} user The updated user
                        * @prop {Object?} oldUser The old user data
                        * @prop {String} oldUser.username The username of the user
                        * @prop {String} oldUser.discriminator The discriminator of the user
                        * @prop {String?} oldUser.avatar The hash of the user's avatar, or null if no avatar
                        */
                        this.emit("userUpdate", user, oldUser);
                    }
                }
                if(!packet.d.club_id) {
                    packet.d.id = packet.d.user.id;
                    const relationship = this.client.relationships.get(packet.d.id);
                    if(!relationship) { // Removing relationships
                        break;
                    }
                    const oldPresence = {
                        game: relationship.game,
                        status: relationship.status
                    };
                    /**
                    * Fired when a club member or relationship's status or game changes
                    * @event Client#presenceUpdate
                    * @prop {Member | Relationship} other The updated member or relationship
                    * @prop {Object?} oldPresence The old presence data. If the user was offline when the bot started and the client option getAllUsers is not true, this will be null
                    * @prop {Array<Object>?} oldPresence.activities The member's current activities
                    * @prop {Object?} oldPresence.clientStatus The member's per-client status
                    * @prop {String} oldPresence.clientStatus.web The member's status on web. Either "online", "idle", "dnd", or "offline". Will be "online" for bots
                    * @prop {String} oldPresence.clientStatus.desktop The member's status on desktop. Either "online", "idle", "dnd", or "offline". Will be "offline" for bots
                    * @prop {String} oldPresence.clientStatus.mobile The member's status on mobile. Either "online", "idle", "dnd", or "offline". Will be "offline" for bots
                    * @prop {Object?} oldPresence.game The old game the other user was playing
                    * @prop {String} oldPresence.game.name The name of the active game
                    * @prop {Number} oldPresence.game.type The type of the active game (0 is default, 1 is Twitch, 2 is YouTube)
                    * @prop {String} oldPresence.game.url The url of the active game
                    * @prop {String} oldPresence.status The other user's old status. Either "online", "idle", or "offline"
                    */
                    this.emit("presenceUpdate", this.client.relationships.update(packet.d), oldPresence);
                    break;
                }
                const club = this.client.clubs.get(packet.d.club_id);
                if(!club) {
                    this.emit("debug", "Rogue presence update: " + JSON.stringify(packet), this.id);
                    break;
                }
                let member = club.members.get(packet.d.id = packet.d.user.id);
                let oldPresence = null;
                if(member) {
                    oldPresence = {
                        activities: member.activities,
                        clientStatus: member.clientStatus,
                        game: member.game,
                        status: member.status
                    };
                }
                if((!member && packet.d.user.username) || oldPresence) {
                    member = club.members.update(packet.d, club);
                    this.emit("presenceUpdate", member, oldPresence);
                }
                break;
            }
            case "VOICE_STATE_UPDATE": { // (╯°□°）╯︵ ┻━┻
                if(packet.d.club_id === undefined) {
                    packet.d.id = packet.d.user_id;
                    if(packet.d.channel_id === null) {
                        let flag = false;
                        for(const groupChannel of this.client.groupChannels) {
                            const call = (groupChannel[1].call || groupChannel[1].lastCall);
                            if(call && call.voiceStates.remove(packet.d)) {
                                flag = true;
                                break;
                            }
                        }
                        if(!flag) {
                            for(const privateChannel of this.client.privateChannels) {
                                const call = (privateChannel[1].call || privateChannel[1].lastCall);
                                if(call && call.voiceStates.remove(packet.d)) {
                                    flag = true;
                                    break;
                                }
                            }
                            if(!flag) {
                                this.emit("debug", new Error("VOICE_STATE_UPDATE for user leaving call not found"));
                                break;
                            }
                        }
                    } else {
                        const channel = this.client.getChannel(packet.d.channel_id);
                        if(!channel.call && !channel.lastCall) {
                            this.emit("debug", new Error("VOICE_STATE_UPDATE for untracked call"));
                            break;
                        }
                        (channel.call || channel.lastCall).voiceStates.update(packet.d);
                    }
                    break;
                }
                const club = this.client.clubs.get(packet.d.club_id);
                if(!club) {
                    break;
                }
                if(club.pendingVoiceStates) {
                    club.pendingVoiceStates.push(packet.d);
                    break;
                }
                let member = club.members.get(packet.d.id = packet.d.user_id);
                if(!member) {
                    // Updates the member cache with this member for future events.
                    packet.d.member.id = packet.d.user_id;
                    member = club.members.add(packet.d.member, club);

                    const channel = club.channels.find((channel) => channel.type === ChannelTypes.CLUB_VOICE && channel.voiceMembers.get(packet.d.id));
                    if(channel) {
                        channel.voiceMembers.remove(packet.d);
                        this.emit("debug", "VOICE_STATE_UPDATE member null but in channel: " + packet.d.id, this.id);
                    }
                }
                const oldState = {
                    deaf: member.voiceState.deaf,
                    mute: member.voiceState.mute,
                    selfDeaf: member.voiceState.selfDeaf,
                    selfMute: member.voiceState.selfMute,
                    selfStream: member.voiceState.selfStream
                };
                const oldChannelID = member.voiceState.channelID;
                member.update(packet.d, this.client);
                if(member.user.id === this.client.user.id) {
                    const voiceConnection = this.client.voiceConnections.get(packet.d.club_id);
                    if(voiceConnection && voiceConnection.channelID !== packet.d.channel_id) {
                        voiceConnection.switchChannel(packet.d.channel_id, true);
                    }
                }
                if(oldChannelID != packet.d.channel_id) {
                    let oldChannel, newChannel;
                    if(oldChannelID) {
                        oldChannel = club.channels.get(oldChannelID);
                    }
                    if(packet.d.channel_id && (newChannel = club.channels.get(packet.d.channel_id)) && newChannel.type === ChannelTypes.CLUB_VOICE) { // Welcome to Helselia, where one can "join" text channels
                        if(oldChannel) {
                            /**
                            * Fired when a club member switches voice channels
                            * @event Client#voiceChannelSwitch
                            * @prop {Member} member The member
                            * @prop {VoiceChannel} newChannel The new voice channel
                            * @prop {VoiceChannel} oldChannel The old voice channel
                            */
                            oldChannel.voiceMembers.remove(member);
                            this.emit("voiceChannelSwitch", newChannel.voiceMembers.add(member, club), newChannel, oldChannel);
                        } else {
                            /**
                            * Fired when a club member joins a voice channel. This event is not fired when a member switches voice channels, see `voiceChannelSwitch`
                            * @event Client#voiceChannelJoin
                            * @prop {Member} member The member
                            * @prop {VoiceChannel} newChannel The voice channel
                            */
                            this.emit("voiceChannelJoin", newChannel.voiceMembers.add(member, club), newChannel);
                        }
                    } else if(oldChannel) {
                        oldChannel.voiceMembers.remove(member);
                        /**
                        * Fired when a club member leaves a voice channel. This event is not fired when a member switches voice channels, see `voiceChannelSwitch`
                        * @event Client#voiceChannelLeave
                        * @prop {?Member} member The member
                        * @prop {VoiceChannel} oldChannel The voice channel
                        */
                        this.emit("voiceChannelLeave", member, oldChannel);
                    }
                }
                if(oldState.mute !== member.voiceState.mute || oldState.deaf !== member.voiceState.deaf || oldState.selfMute !== member.voiceState.selfMute || oldState.selfDeaf !== member.voiceState.selfDeaf || oldState.selfStream !== member.voiceState.selfStream) {
                    /**
                    * Fired when a club member's voice state changes
                    * @event Client#voiceStateUpdate
                    * @prop {Member} member The member
                    * @prop {Object} oldState The old voice state
                    * @prop {Boolean} oldState.deaf The previous server deaf status
                    * @prop {Boolean} oldState.mute The previous server mute status
                    * @prop {Boolean} oldState.selfDeaf The previous self deaf status
                    * @prop {Boolean} oldState.selfMute The previous self mute status
                    * @prop {Boolean} oldState.selfStream The previous self stream status
                    */
                    this.emit("voiceStateUpdate", member, oldState);
                }
                break;
            }
            case "TYPING_START": {
                if(this.client.listeners("typingStart").length > 0) {
                    /**
                    * Fired when a user begins typing
                    * @event Client#typingStart
                    * @prop {PrivateChannel | TextChannel | NewsChannel | Object} channel The text channel the user is typing in. If the channel is not cached, this will be an object with an `id` key. No other property is guaranteed
                    * @prop {User | Object} user The user. If the user is not cached, this will be an object with an `id` key. No other property is guaranteed
                    */
                    this.emit("typingStart", this.client.getChannel(packet.d.channel_id) || {id: packet.d.channel_id}, this.client.users.get(packet.d.user_id) || {id: packet.d.user_id});
                }
                break;
            }
            case "MESSAGE_CREATE": {
                const channel = this.client.getChannel(packet.d.channel_id);
                if(channel) { // MESSAGE_CREATE just when deleting o.o
                    channel.lastMessageID = packet.d.id;
                    /**
                    * Fired when a message is created
                    * @event Client#messageCreate
                    * @prop {Message} message The message
                    */
                    this.emit("messageCreate", channel.messages.add(packet.d, this.client));
                } else {
                    this.emit("debug", "MESSAGE_CREATE but channel not found (OK if deleted channel)", this.id);
                }
                break;
            }
            case "MESSAGE_UPDATE": {
                const channel = this.client.getChannel(packet.d.channel_id);
                if(!channel) {
                    break;
                }
                const message = channel.messages.get(packet.d.id);
                let oldMessage = null;
                if(message) {
                    oldMessage = {
                        attachments: message.attachments,
                        channelMentions: message.channelMentions,
                        content: message.content,
                        editedTimestamp: message.editedTimestamp,
                        embeds: message.embeds,
                        mentionedBy: message.mentionedBy,
                        mentions: message.mentions,
                        pinned: message.pinned,
                        roleMentions: message.roleMentions,
                        tts: message.tts
                    };
                } else if(!packet.d.timestamp) {
                    packet.d.channel = channel;
                    this.emit("messageUpdate", packet.d, null);
                    break;
                }
                /**
                * Fired when a message is updated
                * @event Client#messageUpdate
                * @prop {Message} message The updated message. If oldMessage is null, it is recommended to discard this event, since the message data will be very incomplete (only `id` and `channel` are guaranteed)
                * @prop {Object?} oldMessage The old message data. If the message was cached, this will return the full old message. Otherwise, it will be null
                * @prop {Array<Object>} oldMessage.attachments Array of attachments
                * @prop {Array<String>} oldMessage.channelMentions Array of mentions channels' ids.
                * @prop {String} oldMessage.content Message content
                * @prop {Number} oldMessage.editedTimestamp Timestamp of latest message edit
                * @prop {Array<Object>} oldMessage.embeds Array of embeds
                * @prop {Object} oldMessage.mentionedBy Object of if different things mention the bot user
                * @prop {Array<String>} oldMessage.mentions Array of mentioned users' ids
                * @prop {Boolean} oldMessage.pinned Whether the message was pinned or not
                * @prop {Array<String>} oldMessage.roleMentions Array of mentioned roles' ids.
                * @prop {Boolean} oldMessage.tts Whether to play the message using TTS or not
                */
                this.emit("messageUpdate", channel.messages.update(packet.d, this.client), oldMessage);
                break;
            }
            case "MESSAGE_DELETE": {
                const channel = this.client.getChannel(packet.d.channel_id);
                if(!channel) {
                    break;
                }
                /**
                * Fired when a cached message is deleted
                * @event Client#messageDelete
                * @prop {Message | Object} message The message object. If the message is not cached, this will be an object with `id` and `channel` keys. No other property is guaranteed
                */
                this.emit("messageDelete", channel.messages.remove(packet.d) || {
                    id: packet.d.id,
                    channel: channel
                });
                break;
            }
            case "MESSAGE_DELETE_BULK": {
                const channel = this.client.getChannel(packet.d.channel_id);
                if(!channel) {
                    break;
                }

                /**
                * Fired when a bulk delete occurs
                * @event Client#messageDeleteBulk
                * @prop {Array<Message> | Array<Object>} messages An array of (potentially partial) message objects. If a message is not cached, it will be an object with `id` and `channel` keys. No other property is guaranteed
                */
                this.emit("messageDeleteBulk", packet.d.ids.map((id) => (channel.messages.remove({
                    id
                }) || {
                    id,
                    channel
                })));
                break;
            }
            case "MESSAGE_REACTION_ADD": {
                const channel = this.client.getChannel(packet.d.channel_id);
                let message;
                let member;
                if(channel) {
                    message = channel.messages.get(packet.d.message_id);
                    if(channel.club) {
                        member = channel.club.members.get(packet.d.user_id);
                        if(!member && packet.d.member) {
                            // Updates the member cache with this member for future events.
                            packet.d.member.id = packet.d.user_id;
                            member = channel.club.members.add(packet.d.member, channel.club);
                        }
                    }
                }
                if(message) {
                    const reaction = packet.d.emoji.id ? `${packet.d.emoji.name}:${packet.d.emoji.id}` : packet.d.emoji.name;
                    if(message.reactions[reaction]) {
                        ++message.reactions[reaction].count;
                        if(packet.d.user_id === this.client.user.id) {
                            message.reactions[reaction].me = true;
                        }
                    } else {
                        message.reactions[reaction] = {
                            count: 1,
                            me: packet.d.user_id === this.client.user.id
                        };
                    }
                } else {
                    message = {
                        id: packet.d.message_id,
                        channel: channel || {id: packet.d.channel_id}
                    };

                    if(packet.d.club_id) {
                        message.clubID = packet.d.club_id;
                        if(!message.channel.club) {
                            message.channel.club = {id: packet.d.club_id};
                        }
                    }
                }
                /**
                * Fired when someone adds a reaction to a message
                * @event Client#messageReactionAdd
                * @prop {Message | Object} message The message object. If the message is not cached, this will be an object with `id`, `channel`, and if inside a club, `clubID` keys. If the channel is not cached, channel key will be an object with only an id. `clubID` will be present if the message was sent in a club channel. No other property is guaranteed
                * @prop {Object} emoji The reaction emoji object
                * @prop {String?} emoji.id The emoji ID (null for non-custom emojis)
                * @prop {String} emoji.name The emoji name
                * @prop {Member | Object} reactor The member, if the reaction is in a club. If the reaction is not in a club or the member is not cached, this will be an object with an `id` key. No other property is guaranteed
                */
                this.emit("messageReactionAdd", message, packet.d.emoji, member || {id: packet.d.user_id});
                break;
            }
            case "MESSAGE_REACTION_REMOVE": {
                const channel = this.client.getChannel(packet.d.channel_id);
                let message;
                if(channel) {
                    message = channel.messages.get(packet.d.message_id);
                }
                if(message) {
                    const reaction = packet.d.emoji.id ? `${packet.d.emoji.name}:${packet.d.emoji.id}` : packet.d.emoji.name;
                    const reactionObj = message.reactions[reaction];
                    if(reactionObj) {
                        --reactionObj.count;
                        if(reactionObj.count === 0) {
                            delete message.reactions[reaction];
                        } else if(packet.d.user_id === this.client.user.id) {
                            reactionObj.me = false;
                        }
                    }
                } else {
                    message = {
                        id: packet.d.message_id,
                        channel: channel || {id: packet.d.channel_id}
                    };

                    if(packet.d.club_id) {
                        message.clubID = packet.d.club_id;
                        if(!message.channel.club) {
                            message.channel.club = {id: packet.d.club_id};
                        }
                    }
                }
                /**
                * Fired when someone removes a reaction from a message
                * @event Client#messageReactionRemove
                * @prop {Message | Object} message The message object. If the message is not cached, this will be an object with `id`, `channel`, and if inside a club, `clubID` keys. If the channel is not cached, channel key will be an object with only an id. `clubID` will be present if the message was sent in a club channel. No other property is guaranteed
                * @prop {Object} emoji The reaction emoji object
                * @prop {String?} emoji.id The ID of the emoji (null for non-custom emojis)
                * @prop {String} emoji.name The emoji name
                * @prop {String} userID The ID of the user that removed the reaction
                */
                this.emit("messageReactionRemove", message, packet.d.emoji, packet.d.user_id);
                break;
            }
            case "MESSAGE_REACTION_REMOVE_ALL": {
                const channel = this.client.getChannel(packet.d.channel_id);
                let message;
                if(channel) {
                    message = channel.messages.get(packet.d.message_id);
                    if(message) {
                        message.reactions = {};
                    }
                }
                if(!message) {
                    message = {
                        id: packet.d.message_id,
                        channel: channel || {id: packet.d.channel_id}
                    };
                    if(packet.d.club_id) {
                        message.clubID = packet.d.club_id;
                        if(!message.channel.club) {
                            message.channel.club = {id: packet.d.club_id};
                        }
                    }
                }
                /**
                * Fired when all reactions are removed from a message
                * @event Client#messageReactionRemoveAll
                * @prop {Message | Object} message The message object. If the message is not cached, this will be an object with `id`, `channel`, and if inside a club, `clubID` keys. If the channel is not cached, channel key will be an object with only an id. No other property is guaranteed
                */
                this.emit("messageReactionRemoveAll", message);
                break;
            }
            case "MESSAGE_REACTION_REMOVE_EMOJI": {
                const channel = this.client.getChannel(packet.d.channel_id);
                let message;
                if(channel) {
                    message = channel.messages.get(packet.d.message_id);
                    if(message) {
                        const reaction = packet.d.emoji.id ? `${packet.d.emoji.name}:${packet.d.emoji.id}` : packet.d.emoji.name;
                        delete message.reactions[reaction];
                    }
                }
                if(!message) {
                    message = {
                        id: packet.d.message_id,
                        channel: channel || {id: packet.d.channel_id}
                    };
                    if(packet.d.club_id) {
                        message.clubID = packet.d.club_id;
                        if(!message.channel.club) {
                            message.channel.club = {id: packet.d.club_id};
                        }
                    }
                }
                /**
                * Fired when someone removes all reactions from a message for a single emoji
                * @event Client#messageReactionRemoveEmoji
                * @prop {Message | Object} message The message object. If the message is not cached, this will be an object with `id` and `channel` keys. If the channel is not cached, channel key will be an object with only an id. No other property is guaranteed
                * @prop {Object} emoji The reaction emoji object
                * @prop {String?} emoji.id The ID of the emoji (null for non-custom emojis)
                * @prop {String} emoji.name The emoji name
                */
                this.emit("messageReactionRemoveEmoji", message, packet.d.emoji);
                break;
            }
            case "CLUB_MEMBER_ADD": {
                const club = this.client.clubs.get(packet.d.club_id);
                if(!club) { // Eventual Consistency™ (╯°□°）╯︵ ┻━┻
                    this.emit("debug", `Missing club ${packet.d.club_id} in CLUB_MEMBER_ADD`);
                    break;
                }
                packet.d.id = packet.d.user.id;
                ++club.memberCount;
                /**
                * Fired when a member joins a server
                * @event Client#clubMemberAdd
                * @prop {Club} club The club
                * @prop {Member} member The member
                */
                this.emit("clubMemberAdd", club, club.members.add(packet.d, club));
                break;
            }
            case "CLUB_MEMBER_UPDATE": {
                // Check for member update if clubPresences intent isn't set, to prevent emitting twice
                if(!(this.client.options.intents & Constants.Intents.clubPresences) && packet.d.user.username !== undefined) {
                    let user = this.client.users.get(packet.d.user.id);
                    let oldUser = null;
                    if(user && (user.username !== packet.d.user.username || user.avatar !== packet.d.user.avatar || user.discriminator !== packet.d.user.discriminator)) {
                        oldUser = {
                            username: user.username,
                            discriminator: user.discriminator,
                            avatar: user.avatar
                        };
                    }
                    if(!user || oldUser) {
                        user = this.client.users.update(packet.d.user, this.client);
                        /**
                        * Fired when a user's username, avatar, or discriminator changes
                        * @event Client#userUpdate
                        * @prop {User} user The updated user
                        * @prop {Object?} oldUser The old user data
                        * @prop {String} oldUser.username The username of the user
                        * @prop {String} oldUser.discriminator The discriminator of the user
                        * @prop {String?} oldUser.avatar The hash of the user's avatar, or null if no avatar
                        */
                        this.emit("userUpdate", user, oldUser);
                    }
                }
                const club = this.client.clubs.get(packet.d.club_id);
                if(!club) {
                    this.emit("debug", `Missing club ${packet.d.club_id} in CLUB_MEMBER_UPDATE`);
                    break;
                }
                let member = club.members.get(packet.d.id = packet.d.user.id);
                let oldMember = null;
                if(member) {
                    oldMember = {
                        roles: member.roles,
                        nick: member.nick,
                        premiumSince: member.premiumSince
                    };
                }
                member = club.members.update(packet.d, club);
                /**
                * Fired when a member's roles or nickname are updated or they start boosting a server
                * @event Client#clubMemberUpdate
                * @prop {Club} club The club
                * @prop {Member} member The updated member
                * @prop {Object?} oldMember The old member data
                * @prop {Array<String>} oldMember.roles An array of role IDs this member is a part of
                * @prop {String?} oldMember.nick The server nickname of the member
                * @prop {Number} oldMember.premiumSince Timestamp of when the member boosted the club
                */
                this.emit("clubMemberUpdate", club, member, oldMember);
                break;
            }
            case "CLUB_MEMBER_REMOVE": {
                if(packet.d.user.id === this.client.user.id) { // The bot is probably leaving
                    break;
                }
                const club = this.client.clubs.get(packet.d.club_id);
                if(!club) {
                    break;
                }
                --club.memberCount;
                packet.d.id = packet.d.user.id;
                /**
                * Fired when a member leaves a server
                * @event Client#clubMemberRemove
                * @prop {Club} club The club
                * @prop {Member | Object} member The member. If the member is not cached, this will be an object with `id` and `user` key
                */
                this.emit("clubMemberRemove", club, club.members.remove(packet.d) || {
                    id: packet.d.id,
                    user: new User(packet.d.user, this.client)
                });
                break;
            }
            case "CLUB_CREATE": {
                if(!packet.d.unavailable) {
                    const club = this.createClub(packet.d);
                    if(this.ready) {
                        if(this.client.unavailableClubs.remove(packet.d)) {
                            /**
                            * Fired when a club becomes available
                            * @event Client#clubAvailable
                            * @prop {Club} club The club
                            */
                            this.emit("clubAvailable", club);
                        } else {
                            /**
                            * Fired when a club is created. This happens when:
                            * - the client creates a club
                            * - the client joins a club
                            * @event Client#clubCreate
                            * @prop {Club} club The club
                            */
                            this.emit("clubCreate", club);
                        }
                    } else {
                        this.client.unavailableClubs.remove(packet.d);
                        this.restartClubCreateTimeout();
                    }
                } else {
                    this.client.clubs.remove(packet.d);
                    /**
                    * Fired when an unavailable club is created
                    * @event Client#unavailableClubCreate
                    * @prop {UnavailableClub} club The unavailable club
                    */
                    this.emit("unavailableClubCreate", this.client.unavailableClubs.add(packet.d, this.client));
                }
                break;
            }
            case "CLUB_UPDATE": {
                const club = this.client.clubs.get(packet.d.id);
                if(!club) {
                    this.emit("debug", `Club ${packet.d.id} undefined in CLUB_UPDATE`);
                    break;
                }
                const oldClub = {
                    afkChannelID: club.afkChannelID,
                    afkTimeout: club.afkTimeout,
                    banner: club.banner,
                    defaultNotifications: club.defaultNotifications,
                    description: club.description,
                    emojis: club.emojis,
                    explicitContentFilter: club.explicitContentFilter,
                    features: club.features,
                    icon: club.icon,
                    large: club.large,
                    maxPresences: club.maxPresences,
                    mfaLevel: club.mfaLevel,
                    name: club.name,
                    ownerID: club.ownerID,
                    preferredLocale: club.preferredLocale,
                    publicUpdatesChannelID: club.publicUpdatesChannelID,
                    region: club.region,
                    rulesChannelID: club.rulesChannelID,
                    splash: club.splash,
                    systemChannelID: club.systemChannelID,
                    verificationLevel: club.verificationLevel
                };
                /**
                * Fired when a club is updated
                * @event Client#clubUpdate
                * @prop {Club} club The club
                * @prop {Object} oldClub The old club data
                * @prop {String} oldClub.afkChannelID The ID of the AFK voice channel
                * @prop {Number} oldClub.afkTimeout The AFK timeout in seconds
                * @prop {String?} oldClub.banner The hash of the club banner image, or null if no splash (VIP only)
                * @prop {Number} oldClub.defaultNotifications The default notification settings for the club. 0 is "All Messages", 1 is "Only @mentions"
                * @prop {String?} oldClub.description The description for the club (VIP only)
                * @prop {Array<Object>} oldClub.emojis An array of club emojis
                * @prop {Number} oldClub.explicitContentFilter The explicit content filter level for the club. 0 is off, 1 is on for people without roles, 2 is on for all
                * @prop {Array<Object>} oldClub.features An array of club features
                * @prop {String?} oldClub.icon The hash of the club icon, or null if no icon
                * @prop {Boolean} oldClub.large Whether the club is "large" by "some Helselia standard"
                * @prop {Number} oldClub.maxPresences The maximum number of people that can be online in a club at once (returned from REST API only)
                * @prop {Number} oldClub.mfaLevel The admin 2FA level for the club. 0 is not required, 1 is required
                * @prop {String} oldClub.name The name of the club
                * @prop {String} oldClub.ownerID The ID of the user that is the club owner
                * @prop {String} oldClub.preferredLocale Preferred "PUBLIC" club language used in server discovery and notices from Helselia
                * @prop {String?} oldClub.publicUpdatesChannelID ID of the club's updates channel if the club has "PUBLIC" features
                * @prop {String} oldClub.region The region of the club
                * @prop {String?} oldClub.rulesChannelID The channel where "PUBLIC" clubs display rules and/or guidelines
                * @prop {String?} oldClub.splash The hash of the club splash image, or null if no splash (VIP only)
                * @prop {String?} oldClub.systemChannelID The ID of the default channel for system messages (built-in join messages and boost messages)
                * @prop {Number} oldClub.verificationLevel The club verification level
                */
                this.emit("clubUpdate", this.client.clubs.update(packet.d, this.client), oldClub);
                break;
            }
            case "CLUB_DELETE": {
                delete this.client.clubShardMap[packet.d.id];
                const club = this.client.clubs.remove(packet.d);
                if(club) { // Helselia sends CLUB_DELETE for clubs that were previously unavailable in READY
                    club.channels.forEach((channel) => {
                        delete this.client.channelClubMap[channel.id];
                    });
                }
                if(packet.d.unavailable) {
                    /**
                    * Fired when a club becomes unavailable
                    * @event Client#clubUnavailable
                    * @prop {Club} club The club
                    */
                    this.emit("clubUnavailable", this.client.unavailableClubs.add(packet.d, this.client));
                } else {
                    /**
                    * Fired when a club is deleted. This happens when:
                    * - the client left the club
                    * - the client was kicked/banned from the club
                    * - the club was literally deleted
                    * @event Client#clubDelete
                    * @prop {Club | Object} club The club. If the club was not cached, it will be an object with an `id` key. No other property is guaranteed
                    */
                    this.emit("clubDelete", club || {
                        id: packet.d.id
                    });
                }
                break;
            }
            case "CLUB_BAN_ADD": {
                /**
                * Fired when a user is banned from a club
                * @event Client#clubBanAdd
                * @prop {Club} club The club
                * @prop {User} user The banned user
                */
                this.emit("clubBanAdd", this.client.clubs.get(packet.d.club_id), this.client.users.update(packet.d.user, this.client));
                break;
            }
            case "CLUB_BAN_REMOVE": {
                /**
                * Fired when a user is unbanned from a club
                * @event Client#clubBanRemove
                * @prop {Club} club The club
                * @prop {User} user The banned user
                */
                this.emit("clubBanRemove", this.client.clubs.get(packet.d.club_id), this.client.users.update(packet.d.user, this.client));
                break;
            }
            case "CLUB_ROLE_CREATE": {
                /**
                * Fired when a club role is created
                * @event Client#clubRoleCreate
                * @prop {Club} club The club
                * @prop {Role} role The role
                */
                const club = this.client.clubs.get(packet.d.club_id);
                if(!club) {
                    this.emit("debug", `Missing club ${packet.d.club_id} in CLUB_ROLE_CREATE`);
                    break;
                }
                this.emit("clubRoleCreate", club, club.roles.add(packet.d.role, club));
                break;
            }
            case "CLUB_ROLE_UPDATE": {
                const club = this.client.clubs.get(packet.d.club_id);
                if(!club) {
                    this.emit("debug", `Club ${packet.d.club_id} undefined in CLUB_ROLE_UPDATE`);
                    break;
                }
                const role = club.roles.add(packet.d.role, club);
                if(!role) {
                    this.emit("debug", `Role ${packet.d.role} in club ${packet.d.club_id} undefined in CLUB_ROLE_UPDATE`);
                    break;
                }
                const oldRole = {
                    color: role.color,
                    hoist: role.hoist,
                    managed: role.managed,
                    mentionable: role.mentionable,
                    name: role.name,
                    permissions: role.permissions,
                    position: role.position
                };
                /**
                * Fired when a club role is updated
                * @event Client#clubRoleUpdate
                * @prop {Club} club The club
                * @prop {Role} role The updated role
                * @prop {Object} oldRole The old role data
                * @prop {Number} oldRole.color The hex color of the role in base 10
                * @prop {Boolean} oldRole.hoist Whether users with this role are hoisted in the user list or not
                * @prop {Boolean} oldRole.managed Whether a club integration manages this role or not
                * @prop {Boolean} oldRole.mentionable Whether the role is mentionable or not
                * @prop {String} oldRole.name The name of the role
                * @prop {Permission} oldRole.permissions The permissions number of the role
                * @prop {Number} oldRole.position The position of the role
                */
                this.emit("clubRoleUpdate", club, club.roles.update(packet.d.role, club), oldRole);
                break;
            }
            case "CLUB_ROLE_DELETE": {
                /**
                * Fired when a club role is deleted
                * @event Client#clubRoleDelete
                * @prop {Club} club The club
                * @prop {Role} role The role
                */
                const club = this.client.clubs.get(packet.d.club_id);
                if(!club) {
                    this.emit("debug", `Missing club ${packet.d.club_id} in CLUB_ROLE_DELETE`);
                    break;
                }
                if(!club.roles.has(packet.d.role_id)) {
                    this.emit("debug", `Missing role ${packet.d.role_id} in CLUB_ROLE_DELETE`);
                    break;
                }
                this.emit("clubRoleDelete", club, club.roles.remove({id: packet.d.role_id}));
                break;
            }
            case "INVITE_CREATE": {
                const club = this.client.clubs.get(packet.d.club_id);
                if(!club) {
                    this.emit("debug", `Missing club ${packet.d.club_id} in INVITE_CREATE`);
                    break;
                }
                const channel = this.client.getChannel(packet.d.channel_id);
                if(!channel) {
                    this.emit("debug", `Missing channel ${packet.d.channel_id} in INVITE_CREATE`);
                    break;
                }
                /**
                * Fired when a club invite is created
                * @event Client#inviteCreate
                * @prop {Club} club The club this invite was created in.
                * @prop {Invite} invite The invite that was created
                */
                this.emit("inviteCreate", club, new Invite({
                    ...packet.d,
                    club,
                    channel
                }, this.client));
                break;
            }
            case "INVITE_DELETE": {
                const club = this.client.clubs.get(packet.d.club_id);
                if(!club) {
                    this.emit("debug", `Missing club ${packet.d.club_id} in INVITE_DELETE`);
                    break;
                }
                const channel = this.client.getChannel(packet.d.channel_id);
                if(!channel) {
                    this.emit("debug", `Missing channel ${packet.d.channel_id} in INVITE_DELETE`);
                    break;
                }
                /**
                * Fired when a club invite is deleted
                * @event Client#inviteDelete
                * @prop {Club} club The club this invite was created in.
                * @prop {Invite} invite The invite that was deleted
                */
                this.emit("inviteDelete", club, new Invite({
                    ...packet.d,
                    club,
                    channel
                }, this.client));
                break;
            }
            case "CHANNEL_CREATE": {
                const channel = Channel.from(packet.d, this.client);
                if(packet.d.club_id) {
                    if(!channel.club) {
                        channel.club = this.client.clubs.get(packet.d.club_id);
                        if(!channel.club) {
                            this.emit("debug", `Received CHANNEL_CREATE for channel in missing club ${packet.d.club_id}`);
                            break;
                        }
                    }
                    channel.club.channels.add(channel, this.client);
                    this.client.channelClubMap[packet.d.id] = packet.d.club_id;
                    /**
                    * Fired when a channel is created
                    * @event Client#channelCreate
                    * @prop {TextChannel | VoiceChannel | CategoryChannel | StoreChannel | NewsChannel | ClubChannel | PrivateChannel} channel The channel
                    */
                    this.emit("channelCreate", channel);
                } else if(channel instanceof PrivateChannel) {
                    if(channel instanceof GroupChannel) {
                        this.client.groupChannels.add(channel, this.client);
                    } else {
                        this.client.privateChannels.add(channel, this.client);
                        this.client.privateChannelMap[packet.d.recipients[0].id] = packet.d.id;
                    }
                    if(this.id === 0) {
                        this.emit("channelCreate", channel);
                    }
                } else {
                    this.emit("warn", new Error("Unhandled CHANNEL_CREATE type: " + JSON.stringify(packet, null, 2)));
                    break;
                }
                break;
            }
            case "CHANNEL_UPDATE": {
                let channel = this.client.getChannel(packet.d.id);
                if(!channel) {
                    break;
                }
                let oldChannel;
                if(channel instanceof GroupChannel) {
                    oldChannel = {
                        name: channel.name,
                        ownerID: channel.ownerID,
                        icon: channel.icon
                    };
                } else if(channel instanceof ClubChannel) {
                    oldChannel = {
                        bitrate: channel.bitrate,
                        name: channel.name,
                        nsfw: channel.nsfw,
                        parentID: channel.parentID,
                        permissionOverwrites: channel.permissionOverwrites,
                        position: channel.position,
                        rateLimitPerUser: channel.rateLimitPerUser,
                        topic: channel.topic,
                        type: channel.type,
                        userLimit: channel.userLimit
                    };
                } else {
                    this.emit("warn", `Unexpected CHANNEL_UPDATE for channel ${packet.d.id} with type ${oldType}`);
                }
                const oldType = channel.type;
                if(oldType === packet.d.type) {
                    channel.update(packet.d);
                } else {
                    this.emit("debug", `Channel ${packet.d.id} changed from type ${oldType} to ${packet.d.type}`);
                    const newChannel = Channel.from(packet.d, this.client);
                    if(packet.d.club_id) {
                        const club = this.client.clubs.get(packet.d.club_id);
                        if(!club) {
                            this.emit("debug", `Received CHANNEL_UPDATE for channel in missing club ${packet.d.club_id}`);
                            break;
                        }
                        club.channels.remove(channel);
                        club.channels.add(newChannel, this.client);
                    } else if(channel instanceof PrivateChannel) {
                        if(channel instanceof GroupChannel) {
                            this.client.groupChannels.remove(channel);
                            this.client.groupChannels.add(newChannel, this.client);
                        } else {
                            this.client.privateChannels.remove(channel);
                            this.client.privateChannels.add(newChannel, this.client);
                        }
                    } else {
                        this.emit("warn", new Error("Unhandled CHANNEL_UPDATE type: " + JSON.stringify(packet, null, 2)));
                        break;
                    }
                    channel = newChannel;
                }

                /**
                * Fired when a channel is updated
                * @event Client#channelUpdate
                * @prop {TextChannel | VoiceChannel | CategoryChannel | StoreChannel | NewsChannel | ClubChannel | PrivateChannel} channel The updated channel
                * @prop {Object} oldChannel The old channel data
                * @prop {Number?} oldChannel.bitrate The bitrate of the channel (voice channels only)
                * @prop {String} oldChannel.name The name of the channel
                * @prop {Boolean} oldChannel.nsfw Whether the channel is NSFW or not
                * @prop {String?} oldChannel.parentID The ID of the category this channel belongs to
                * @prop {Collection} oldChannel.permissionOverwrites Collection of PermissionOverwrites in this channel
                * @prop {Number} oldChannel.position The position of the channel
                * @prop {Number} oldChannel.rateLimitPerUser The ratelimit of the channel, in seconds. 0 means no ratelimit is enabled (text channels only)
                * @prop {String?} oldChannel.topic The topic of the channel (text channels only)
                * @prop {Number} oldChannel.type The type of the old channel
                * @prop {Number} oldChannel.userLimit The max number of users that can join the channel (voice channels only)
                */
                this.emit("channelUpdate", channel, oldChannel);
                break;
            }
            case "CHANNEL_DELETE": {
                if(packet.d.type === ChannelTypes.DM || packet.d.type === undefined) {
                    if(this.id === 0) {
                        const channel = this.client.privateChannels.remove(packet.d);
                        if(channel) {
                            delete this.client.privateChannelMap[channel.recipient.id];
                            /**
                            * Fired when a channel is deleted
                            * @event Client#channelDelete
                            * @prop {PrivateChannel | TextChannel | NewsChannel | VoiceChannel | CategoryChannel} channel The channel
                            */
                            this.emit("channelDelete", channel);
                        }
                    }
                } else if(packet.d.club_id) {
                    delete this.client.channelClubMap[packet.d.id];
                    const club = this.client.clubs.get(packet.d.club_id);
                    if(!club) {
                        this.emit("debug", `Missing club ${packet.d.club_id} in CHANNEL_DELETE`);
                        break;
                    }
                    const channel = club.channels.remove(packet.d);
                    if(!channel) {
                        break;
                    }
                    if(channel.type === ChannelTypes.CLUB_VOICE) {
                        channel.voiceMembers.forEach((member) => {
                            channel.voiceMembers.remove(member);
                            this.emit("voiceChannelLeave", member, channel);
                        });
                    }
                    this.emit("channelDelete", channel);
                } else if(packet.d.type === ChannelTypes.GROUP_DM) {
                    if(this.id === 0) {
                        this.emit("channelDelete", this.client.groupChannels.remove(packet.d));
                    }
                } else {
                    this.emit("warn", new Error("Unhandled CHANNEL_DELETE type: " + JSON.stringify(packet, null, 2)));
                }
                break;
            }
            case "CHANNEL_RECIPIENT_ADD": {
                const channel = this.client.groupChannels.get(packet.d.channel_id);
                /**
                * Fired when a user joins a group channel
                * @event Client#channelRecipientAdd
                * @prop {GroupChannel} channel The channel
                * @prop {User} user The user
                */
                this.emit("channelRecipientAdd", channel, channel.recipients.add(this.client.users.update(packet.d.user, this.client)));
                break;
            }
            case "CHANNEL_RECIPIENT_REMOVE": {
                const channel = this.client.groupChannels.get(packet.d.channel_id);
                /**
                * Fired when a user leaves a group channel
                * @event Client#channelRecipientRemove
                * @prop {GroupChannel} channel The channel
                * @prop {User} user The user
                */
                this.emit("channelRecipientRemove", channel, channel.recipients.remove(packet.d.user));
                break;
            }
            case "FRIEND_SUGGESTION_CREATE": {
                /**
                * Fired when a client receives a friend suggestion
                * @event Client#friendSuggestionCreate
                * @prop {User} user The suggested user
                * @prop {Array<String>} reasons Array of reasons why this suggestion was made
                * @prop {String} reasons.name Username of suggested user on that platform
                * @prop {String} reasons.platform_type Platform you share with the user
                * @prop {Number} reasons.type Type of reason?
                */
                this.emit("friendSuggestionCreate", new User(packet.d.suggested_user, this.client), packet.d.reasons);
                break;
            }
            case "FRIEND_SUGGESTION_DELETE": {
                /**
                * Fired when a client's friend suggestion is removed for any reason
                * @event Client#friendSuggestionDelete
                * @prop {User} user The suggested user
                */
                this.emit("friendSuggestionDelete", this.client.users.get(packet.d.suggested_user_id));
                break;
            }
            case "CLUB_MEMBERS_CHUNK": {
                const club = this.client.clubs.get(packet.d.club_id);
                if(!club) {
                    this.emit("debug", `Received CLUB_MEMBERS_CHUNK, but club ${packet.d.club_id} is ` + (this.client.unavailableClubs.has(packet.d.club_id) ? "unavailable" : "missing"), this.id);
                    break;
                }

                const members = packet.d.members.map((member) => {
                    member.id = member.user.id;
                    return club.members.add(member, club);
                });

                if(packet.d.presences) {
                    packet.d.presences.forEach((presence) => {
                        const member = club.members.get(presence.user.id);
                        if(member) {
                            member.update(presence);
                        }
                    });
                }

                if(this.requestMembersPromise.hasOwnProperty(packet.d.nonce)) {
                    this.requestMembersPromise[packet.d.nonce].members.push(...members);
                }

                if(packet.d.chunk_index >= packet.d.chunk_count - 1) {
                    if(this.requestMembersPromise.hasOwnProperty(packet.d.nonce)) {
                        clearTimeout(this.requestMembersPromise[packet.d.nonce].timeout);
                        this.requestMembersPromise[packet.d.nonce].res(this.requestMembersPromise[packet.d.nonce].members);
                        delete this.requestMembersPromise[packet.d.nonce];
                    }
                    if(this.getAllUsersCount.hasOwnProperty(club.id)) {
                        delete this.getAllUsersCount[club.id];
                        this.checkReady();
                    }
                }

                /**
                * Fired when Helselia sends member chunks
                * @event Client#clubMemberChunk
                * @prop {Club} club The club the chunked members are in
                * @prop {Array<Member>} members The members in the chunk
                */
                this.emit("clubMemberChunk", club, members);

                this.lastHeartbeatAck = true;

                break;
            }
            case "CLUB_SYNC": {// (╯°□°）╯︵ ┻━┻ thx Helselia devs
                const club = this.client.clubs.get(packet.d.id);
                for(const member of packet.d.members) {
                    member.id = member.user.id;
                    club.members.add(member, club);
                }
                for(const presence of packet.d.presences) {
                    if(!club.members.get(presence.user.id)) {
                        let userData = this.client.users.get(presence.user.id);
                        if(userData) {
                            userData = `{username: ${userData.username}, id: ${userData.id}, discriminator: ${userData.discriminator}}`;
                        }
                        this.emit("debug", `Presence without member. ${presence.user.id}. In global user cache: ${userData}. ` + JSON.stringify(presence), this.id);
                        continue;
                    }
                    presence.id = presence.user.id;
                    club.members.update(presence);
                }
                if(club.pendingVoiceStates && club.pendingVoiceStates.length > 0) {
                    for(const voiceState of club.pendingVoiceStates) {
                        if(!club.members.get(voiceState.user_id)) {
                            continue;
                        }
                        voiceState.id = voiceState.user_id;
                        const channel = club.channels.get(voiceState.channel_id);
                        if(channel) {
                            channel.voiceMembers.add(club.members.update(voiceState));
                            if(this.client.options.seedVoiceConnections && voiceState.id === this.client.user.id && !this.client.voiceConnections.get(channel.club ? channel.club.id : "call")) {
                                this.client.joinVoiceChannel(channel.id);
                            }
                        } else { // Phantom voice states from connected users in deleted channels (╯°□°）╯︵ ┻━┻
                            this.client.emit("debug", "Phantom voice state received but channel not found | Club: " + club.id + " | Channel: " + voiceState.channel_id);
                        }
                    }
                }
                club.pendingVoiceStates = null;
                --this.unsyncedClubs;
                this.checkReady();
                break;
            }
            case "RESUMED":
            case "READY": {
                this.connectAttempts = 0;
                this.reconnectInterval = 1000;

                this.connecting = false;
                if(this.connectTimeout) {
                    clearTimeout(this.connectTimeout);
                }
                this.connectTimeout = null;
                this.status = "ready";
                this.presence.status = "online";
                this.client.shards._readyPacketCB();

                if(packet.t === "RESUMED") {
                    // Can only heartbeat after resume succeeds, helselia/helselia-api-docs#1619
                    this.heartbeat();

                    this.preReady = true;
                    this.ready = true;

                    /**
                    * Fired when a shard finishes resuming
                    * @event Shard#resume
                    */
                    super.emit("resume");
                    break;
                }

                this.client.user = this.client.users.update(new ExtendedUser(packet.d.user, this.client), this.client);
                if(this.client.user.bot) {
                    this.client.bot = true;
                    if(!this.client.token.startsWith("Bot ")) {
                        this.client.token = "Bot " + this.client.token;
                    }
                } else {
                    this.client.bot = false;
                    this.client.userClubSettings = {};
                    packet.d.user_club_settings.forEach((clubSettings) => {
                        this.client.userClubSettings[clubSettings.club_id] = clubSettings;
                    });
                    this.client.userSettings = packet.d.user_settings;
                }

                if(packet.d._trace) {
                    this.helseliaServerTrace = packet.d._trace;
                }

                this.sessionID = packet.d.session_id;

                packet.d.clubs.forEach((club) => {
                    if(club.unavailable) {
                        this.client.clubs.remove(club);
                        this.client.unavailableClubs.add(club, this.client, true);
                    } else {
                        this.client.unavailableClubs.remove(this.createClub(club));
                    }
                });

                packet.d.private_channels.forEach((channel) => {
                    if(channel.type === undefined || channel.type === ChannelTypes.DM) {
                        this.client.privateChannelMap[channel.recipients[0].id] = channel.id;
                        this.client.privateChannels.add(channel, this.client, true);
                    } else if(channel.type === ChannelTypes.GROUP_DM) {
                        this.client.groupChannels.add(channel, this.client, true);
                    } else {
                        this.emit("warn", new Error("Unhandled READY private_channel type: " + JSON.stringify(channel, null, 2)));
                    }
                });

                if(packet.d.relationships) {
                    packet.d.relationships.forEach((relationship) => {
                        this.client.relationships.add(relationship, this.client, true);
                    });
                }

                if(packet.d.presences) {
                    packet.d.presences.forEach((presence) => {
                        if(this.client.relationships.get(presence.user.id)) { // Avoid DM channel presences which are also in here
                            presence.id = presence.user.id;
                            this.client.relationships.update(presence, null, true);
                        }
                    });
                }

                if(packet.d.notes) {
                    this.client.notes = packet.d.notes;
                }

                this.preReady = true;
                /**
                * Fired when a shard finishes processing the ready packet
                * @event Client#shardPreReady
                * @prop {Number} id The ID of the shard
                */
                this.emit("shardPreReady", this.id);

                if(this.client.unavailableClubs.size > 0 && packet.d.clubs.length > 0) {
                    this.restartClubCreateTimeout();
                } else {
                    this.checkReady();
                }

                break;
            }
            case "VOICE_SERVER_UPDATE": {
                packet.d.session_id = this.sessionID;
                packet.d.user_id = this.client.user.id;
                packet.d.shard = this;
                this.client.voiceConnections.voiceServerUpdate(packet.d);
                break;
            }
            case "USER_UPDATE": {
                const user = this.client.users.get(packet.d.id);
                const oldUser = {
                    username: user.username,
                    discriminator: user.discriminator,
                    avatar: user.avatar
                };
                this.emit("userUpdate", user.update(packet.d), oldUser);
                break;
            }
            case "RELATIONSHIP_ADD": {
                if(this.client.bot) {
                    break;
                }
                const relationship = this.client.relationships.get(packet.d.id);
                if(relationship) {
                    const oldRelationship = {
                        type: relationship.type
                    };
                    /**
                    * Fired when a relationship is updated
                    * @event Client#relationshipUpdate
                    * @prop {Relationship} relationship The relationship
                    * @prop {Object} oldRelationship The old relationship data
                    * @prop {Number} oldRelationship.type The old type of the relationship
                    */
                    this.emit("relationshipUpdate", this.client.relationships.update(packet.d), oldRelationship);
                } else {
                    /**
                    * Fired when a relationship is added
                    * @event Client#relationshipAdd
                    * @prop {Relationship} relationship The relationship
                    */
                    this.emit("relationshipAdd", this.client.relationships.add(packet.d, this.client));
                }
                break;
            }
            case "RELATIONSHIP_REMOVE": {
                if(this.client.bot) {
                    break;
                }
                /**
                * Fired when a relationship is removed
                * @event Client#relationshipRemove
                * @prop {Relationship} relationship The relationship
                */
                this.emit("relationshipRemove", this.client.relationships.remove(packet.d));
                break;
            }
            case "CLUB_EMOJIS_UPDATE": {
                const club = this.client.clubs.get(packet.d.club_id);
                const {emojis: oldEmojis} = club;
                club.update(packet.d);
                /**
                * Fired when a club's emojis are updated
                * @event Client#clubEmojisUpdate
                * @prop {Club} club The club
                * @prop {Array} emojis The updated emojis of the club
                * @prop {Array} oldEmojis The old emojis of the club
                */
                this.emit("clubEmojisUpdate", club, club.emojis, oldEmojis);
                break;
            }
            case "CHANNEL_PINS_UPDATE": {
                const channel = this.client.getChannel(packet.d.channel_id);
                if(!channel) {
                    this.emit("debug", `CHANNEL_PINS_UPDATE target channel ${packet.d.channel_id} not found`);
                    break;
                }
                const oldTimestamp = channel.lastPinTimestamp;
                channel.lastPinTimestamp = Date.parse(packet.d.last_pin_timestamp);
                /**
                * Fired when a channel pin timestamp is updated
                * @event Client#channelPinUpdate
                * @prop {PrivateChannel | TextChannel | NewsChannel} channel The channel
                * @prop {Number} timestamp The new timestamp
                * @prop {Number} oldTimestamp The old timestamp
                */
                this.emit("channelPinUpdate", channel, channel.lastPinTimestamp, oldTimestamp);
                break;
            }
            case "WEBHOOKS_UPDATE": {
                /**
                * Fired when a channel's webhooks are updated
                * @event Client#webhooksUpdate
                * @prop {Object} data The update data
                * @prop {String} data.channelID The ID of the channel that webhooks were updated in
                * @prop {String} data.clubID The ID of the club that webhooks were updated in
                */
                this.emit("webhooksUpdate", {
                    channelID: packet.d.channel_id,
                    clubID: packet.d.club_id
                });
                break;
            }
            case "PRESENCES_REPLACE": {
                for(const presence of packet.d) {
                    const club = this.client.clubs.get(presence.club_id);
                    if(!club) {
                        this.emit("debug", "Rogue presences replace: " + JSON.stringify(presence), this.id);
                        continue;
                    }
                    const member = club.members.get(presence.user.id);
                    if(!member && presence.user.username) {
                        presence.id = presence.user.id;
                        member.update(presence);
                    }
                }
                break;
            }
            case "USER_NOTE_UPDATE": {
                if(packet.d.note) {
                    this.client.notes[packet.d.id] = packet.d.note;
                } else {
                    delete this.client.notes[packet.d.id];
                }
                break;
            }
            case "USER_CLUB_SETTINGS_UPDATE": {
                this.client.userClubSettings[packet.d.club_id] = packet.d;
                break;
            }
            case "MESSAGE_ACK": // Ignore these
            case "CLUB_INTEGRATIONS_UPDATE":
            case "USER_SETTINGS_UPDATE":
            case "CHANNEL_PINS_ACK": {
                break;
            }
            default: {
                /**
                * Fired when the shard encounters an unknown packet
                * @event Client#unknown
                * @prop {Object} packet The unknown packet
                * @prop {Number} id The ID of the shard
                */
                this.emit("unknown", packet, this.id);
                break;
            }
        } /* eslint-enable no-redeclare */
    }

    _onWSClose(code, reason) {
        this.emit("debug", "WS disconnected: " + JSON.stringify({
            code: code,
            reason: reason,
            status: this.status
        }));
        let err = !code || code === 1000 ? null : new Error(code + ": " + reason);
        let reconnect = "auto";
        if(code) {
            this.emit("debug", `${code === 1000 ? "Clean" : "Unclean"} WS close: ${code}: ${reason}`, this.id);
            if(code === 4001) {
                err = new Error("Gateway received invalid OP code");
            } else if(code === 4002) {
                err = new Error("Gateway received invalid message");
            } else if(code === 4003) {
                err = new Error("Not authenticated");
                this.sessionID = null;
            } else if(code === 4004) {
                err = new Error("Authentication failed");
                this.sessionID = null;
                reconnect = false;
                this.emit("error", new Error(`Invalid token: ${this._token}`));
            } else if(code === 4005) {
                err = new Error("Already authenticated");
            } else if(code === 4006 || code === 4009) {
                err = new Error("Invalid session");
                this.sessionID = null;
            } else if(code === 4007) {
                err = new Error("Invalid sequence number: " + this.seq);
                this.seq = 0;
            } else if(code === 4008) {
                err = new Error("Gateway connection was ratelimited");
            } else if(code === 4010) {
                err = new Error("Invalid shard key");
                this.sessionID = null;
                reconnect = false;
            } else if(code === 4011) {
                err = new Error("Shard has too many clubs (>2500)");
                this.sessionID = null;
                reconnect = false;
            } else if(code === 4013) {
                err = new Error("Invalid intents specified");
                this.sessionID = null;
                reconnect = false;
            } else if(code === 4014) {
                err = new Error("Disallowed intents specified");
                this.sessionID = null;
                reconnect = false;
            } else if(code === 1006) {
                err = new Error("Connection reset by peer");
            } else if(code !== 1000 && reason) {
                err = new Error(code + ": " + reason);
            }
            if(err) {
                err.code = code;
            }
        } else {
            this.emit("debug", "WS close: unknown code: " + reason, this.id);
        }
        this.disconnect({
            reconnect
        }, err);
    }

    _onWSError(err) {
        this.emit("error", err, this.id);
    }

    _onWSMessage(data) {
        try {
            if(data instanceof ArrayBuffer) {
                if(this.client.options.compress || Erlpack) {
                    data = Buffer.from(data);
                }
            } else if(Array.isArray(data)) { // Fragmented messages
                data = Buffer.concat(data); // Copyfull concat is slow, but no alternative
            }
            if(this.client.options.compress) {
                if(data.length >= 4 && data.readUInt32BE(data.length - 4) === 0xFFFF) {
                    this._zlibSync.push(data, ZlibSync.Z_SYNC_FLUSH);
                    if(this._zlibSync.err) {
                        this.emit("error", new Error(`zlib error ${this._zlibSync.err}: ${this._zlibSync.msg}`));
                        return;
                    }

                    data = Buffer.from(this._zlibSync.result);
                    if(Erlpack) {
                        return this.onPacket(Erlpack.unpack(data));
                    } else {
                        return this.onPacket(JSON.parse(data.toString()));
                    }
                } else {
                    this._zlibSync.push(data, false);
                }
            } else if(Erlpack) {
                return this.onPacket(Erlpack.unpack(data));
            } else {
                return this.onPacket(JSON.parse(data.toString()));
            }
        } catch(err) {
            this.emit("error", err, this.id);
        }
    }

    _onWSOpen() {
        this.status = "handshaking";
        /**
        * Fired when the shard establishes a connection
        * @event Client#connect
        * @prop {Number} id The ID of the shard
        */
        this.emit("connect", this.id);
        this.lastHeartbeatAck = true;
    }

    toString() {
        return Base.prototype.toString.call(this);
    }

    toJSON(props = []) {
        return Base.prototype.toJSON.call(this, [
            "connecting",
            "ready",
            "helseliaServerTrace",
            "status",
            "lastHeartbeatReceived",
            "lastHeartbeatSent",
            "latency",
            "preReady",
            "getAllUsersCount",
            "getAllUsersQueue",
            "getAllUsersLength",
            "clubSyncQueue",
            "clubSyncQueueLength",
            "unsyncedClubs",
            "lastHeartbeatAck",
            "seq",
            "sessionID",
            "reconnectInterval",
            "connectAttempts",
            ...props
        ]);
    }
}

module.exports = Shard;
