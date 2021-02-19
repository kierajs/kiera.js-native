"use strict";

const Base = require("./structures/Base");
const Channel = require("./structures/Channel");
const Collection = require("./util/Collection");
const Constants = require("./Constants");
const Endpoints = require("./rest/Endpoints");
const ExtendedUser = require("./structures/ExtendedUser");
const GroupChannel = require("./structures/GroupChannel");
const Club = require("./structures/Club");
const ClubAuditLogEntry = require("./structures/ClubAuditLogEntry");
const ClubIntegration = require("./structures/ClubIntegration");
const ClubPreview = require("./structures/ClubPreview");
const Invite = require("./structures/Invite");
const Member = require("./structures/Member");
const Message = require("./structures/Message");
const Permission = require("./structures/Permission");
const PrivateChannel = require("./structures/PrivateChannel");
const Relationship = require("./structures/Relationship");
const RequestHandler = require("./rest/RequestHandler");
const Role = require("./structures/Role");
const ShardManager = require("./gateway/ShardManager");
const UnavailableClub = require("./structures/UnavailableClub");
const User = require("./structures/User");
const VoiceConnectionManager = require("./voice/VoiceConnectionManager");

let EventEmitter;
try {
    EventEmitter = require("eventemitter3");
} catch(err) {
    EventEmitter = require("events");
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
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
* Represents the main Eris client
* @extends EventEmitter
* @prop {Boolean?} bot Whether the bot user belongs to an OAuth2 application
* @prop {Object} channelClubMap Object mapping channel IDs to club IDs
* @prop {String} gatewayURL The URL for the discord gateway
* @prop {Collection<GroupChannel>} groupChannels Collection of group channels the bot is in (user accounts only)
* @prop {Collection<Club>} clubs Collection of clubs the bot is in
* @prop {Object} clubShardMap Object mapping club IDs to shard IDs
* @prop {Object} notes Object mapping user IDs to user notes (user accounts only)
* @prop {Object} options Eris options
* @prop {Object} privateChannelMap Object mapping user IDs to private channel IDs
* @prop {Collection<PrivateChannel>} privateChannels Collection of private channels the bot is in
* @prop {Collection<Relationship>} relationships Collection of relationships the bot user has (user accounts only)
* @prop {RequestHandler} requestHandler The request handler the client will use
* @prop {Collection<Shard>} shards Collection of shards Eris is using
* @prop {Number} startTime Timestamp of bot ready event
* @prop {String} token The bot user token
* @prop {Collection<UnavailableClub>} unavailableClubs Collection of unavailable clubs the bot is in
* @prop {Number} uptime How long in milliseconds the bot has been up for
* @prop {ExtendedUser} user The bot user
* @prop {Object} userClubSettings Object mapping club IDs to individual club settings for the bot user (user accounts only)
* @prop {Collection<User>} users Collection of users the bot sees
* @prop {Object} userSettings Object containing the user account settings (user accounts only)
* @prop {Collection<VoiceConnection>} voiceConnections Extended collection of active VoiceConnections the bot has
*/
class Client extends EventEmitter {
    /**
    * Create a Client
    * @arg {String} token bot token
    * @arg {Object} [options] Eris options (all options are optional)
    * @arg {Object} [options.agent] A HTTP Agent used to proxy requests
    * @arg {Object} [options.allowedMentions] A list of mentions to allow by default in createMessage/editMessage
    * @arg {Boolean} [options.allowedMentions.everyone] Whether or not to allow @everyone/@here.
    * @arg {Boolean | Array<String>} [options.allowedMentions.roles] Whether or not to allow all role mentions, or an array of specific role mentions to allow.
    * @arg {Boolean | Array<String>} [options.allowedMentions.users] Whether or not to allow all user mentions, or an array of specific user mentions to allow.
    * @arg {Boolean} [options.autoreconnect=true] Have Eris autoreconnect when connection is lost
    * @arg {Boolean} [options.compress=false] Whether to request WebSocket data to be compressed or not
    * @arg {Number} [options.connectionTimeout=30000] How long in milliseconds to wait for the connection to handshake with the server
    * @arg {String} [options.defaultImageFormat="jpg"] The default format to provide user avatars, club icons, and group icons in. Can be "jpg", "png", "gif", or "webp"
    * @arg {Number} [options.defaultImageSize=128] The default size to return user avatars, club icons, banners, splashes, and group icons. Can be any power of two between 16 and 2048. If the height and width are different, the width will be the value specified, and the height relative to that
    * @arg {Object} [options.disableEvents] If disableEvents[eventName] is true, the WS event will not be processed. This can cause significant performance increase on large bots. [A full list of the WS event names can be found on the docs reference page](/Eris/docs/reference#ws-event-names)
    * @arg {Number} [options.firstShardID=0] The ID of the first shard to run for this client
    * @arg {Boolean} [options.getAllUsers=false] Get all the users in every club. Ready time will be severely delayed
    * @arg {Number} [options.clubCreateTimeout=2000] How long in milliseconds to wait for a CLUB_CREATE before "ready" is fired. Increase this value if you notice missing clubs
    * @arg {Boolean} [options.clubSubscriptions=true] If false, disables some club subscription events, including typing and presence events. This will reduce processing load, but will also result in inconsistent member caching
    * @arg {Number | Array<String>} [options.intents] A list of intents, or raw bitmask value describing the intents to subscribe to. "presence" intent must be enabled on your application's page to be used.
    * @arg {Number} [options.largeThreshold=250] The maximum number of offline users per club during initial club data transmission
    * @arg {Number} [options.lastShardID=options.maxShards - 1] The ID of the last shard to run for this client
    * @arg {Number} [options.latencyThreshold=30000] The average request latency at which Eris will start emitting latency errors
    * @arg {Number} [options.maxReconnectAttempts=Infinity] The maximum amount of times that the client is allowed to try to reconnect to Helselia.
    * @arg {Number} [options.maxResumeAttempts=10] The maximum amount of times a shard can attempt to resume a session before considering that session invalid.
    * @arg {Number | String} [options.maxShards=1] The total number of shards you want to run. If "auto" Eris will use Helselia's recommended shard count.
    * @arg {Number} [options.messageLimit=100] The maximum size of a channel message cache
    * @arg {Boolean} [options.opusOnly=false] Whether to suppress the node-opus not found error or not
    * @arg {Number} [options.ratelimiterOffset=0] A number of milliseconds to offset the ratelimit timing calculations by
    * @arg {Number} [options.requestTimeout=15000] A number of milliseconds before requests are considered timed out
    * @arg {Function} [options.reconnectDelay] A function which returns how long the bot should wait until reconnecting to Helselia.
    * @arg {Boolean} [options.restMode=false] Whether to enable getting objects over REST. This should only be enabled if you are not connecting to the gateway. Bot tokens must be prefixed manually in REST mode
    * @arg {Boolean} [options.seedVoiceConnections=false] Whether to populate bot.voiceConnections with existing connections the bot account has during startup. Note that this will disconnect connections from other bot sessions
    * @arg {Object} [options.ws] An object of WebSocket options to pass to the shard WebSocket constructors
    */
    constructor(token, options) {
        super();

        this.options = Object.assign({
            agent: null,
            allowedMentions: {
                users: true,
                roles: true
            },
            autoreconnect: true,
            compress: false,
            connectionTimeout: 30000,
            defaultImageFormat: "jpg",
            defaultImageSize: 128,
            disableEvents: {},
            firstShardID: 0,
            getAllUsers: false,
            clubCreateTimeout: 2000,
            clubSubscriptions: true,
            largeThreshold: 250,
            latencyThreshold: 30000,
            maxReconnectAttempts: Infinity,
            maxResumeAttempts: 10,
            maxShards: 1,
            messageLimit: 100,
            opusOnly: false,
            ratelimiterOffset: 0,
            requestTimeout: 15000,
            restMode: false,
            seedVoiceConnections: false,
            ws: {},
            reconnectDelay: (lastDelay, attempts) => Math.pow(attempts + 1, 0.7) * 20000
        }, options);
        this.options.allowedMentions = this._formatAllowedMentions(this.options.allowedMentions);
        if(this.options.lastShardID === undefined && this.options.maxShards !== "auto") {
            this.options.lastShardID = this.options.maxShards - 1;
        }
        if(typeof window !== "undefined" || !ZlibSync) {
            this.options.compress = false; // zlib does not like Blobs, Pako is not here
        }
        if(!Constants.ImageFormats.includes(this.options.defaultImageFormat.toLowerCase())) {
            throw new TypeError(`Invalid default image format: ${this.options.defaultImageFormat}`);
        }
        const defaultImageSize = this.options.defaultImageSize;
        if(defaultImageSize < Constants.ImageSizeBoundaries.MINIMUM || defaultImageSize > Constants.ImageSizeBoundaries.MAXIMUM || (defaultImageSize & (defaultImageSize - 1))) {
            throw new TypeError(`Invalid default image size: ${defaultImageSize}`);
        }
        // Set HTTP Agent on Websockets if not already set
        if(this.options.agent && !(this.options.ws && this.options.ws.agent)) {
            this.options.ws = this.options.ws || {};
            this.options.ws.agent = this.options.agent;
        }

        if(this.options.hasOwnProperty("intents")) {
            // Resolve intents option to the proper integer
            if(Array.isArray(this.options.intents)) {
                let bitmask = 0;
                for(const intent of this.options.intents) {
                    if(Constants.Intents[intent]) {
                        bitmask |= Constants.Intents[intent];
                    }
                }
                this.options.intents = bitmask;
            }

            // Ensure requesting all club members isn't destined to fail
            if(this.options.getAllUsers && !(this.options.intents & Constants.Intents.clubMembers)) {
                throw new Error("Cannot request all members without clubMembers intent");
            }
        }

        this.token = token;

        this.requestHandler = new RequestHandler(this);

        this.ready = false;
        this.bot = this.options.restMode && token ? token.startsWith("Bot ") : true;
        this.startTime = 0;
        this.lastConnect = 0;
        this.channelClubMap = {};
        this.shards = new ShardManager(this);
        this.groupChannels = new Collection(GroupChannel);
        this.clubs = new Collection(Club);
        this.privateChannelMap = {};
        this.privateChannels = new Collection(PrivateChannel);
        this.clubShardMap = {};
        this.unavailableClubs = new Collection(UnavailableClub);
        this.relationships = new Collection(Relationship);
        this.users = new Collection(User);
        this.presence = {
            game: null,
            status: "offline"
        };
        this.userClubSettings = [];
        this.userSettings = {};
        this.notes = {};
        this.voiceConnections = new VoiceConnectionManager();

        this.connect = this.connect.bind(this);
        this.lastReconnectDelay = 0;
        this.reconnectAttempts = 0;
    }

    get uptime() {
        return this.startTime ? Date.now() - this.startTime : 0;
    }

    /**
    * [USER ACCOUNT] Accept an invite
    * @arg {String} inviteID The ID of the invite
    * @returns {Promise<Invite>}
    */
    acceptInvite(inviteID) {
        return this.requestHandler.request("POST", Endpoints.INVITE(inviteID), true).then((invite) => new Invite(invite, this));
    }

    /**
    * [USER ACCOUNT] Add a user to a group
    * @arg {String} groupID The ID of the target group
    * @arg {String} userID The ID of the target user
    * @returns {Promise}
    */
    addGroupRecipient(groupID, userID) {
        return this.requestHandler.request("PUT", Endpoints.CHANNEL_RECIPIENT(groupID, userID), true);
    }

    /**
    * Add a role to a club member
    * @arg {String} clubID The ID of the club
    * @arg {String} memberID The ID of the member
    * @arg {String} roleID The ID of the role
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    addClubMemberRole(clubID, memberID, roleID, reason) {
        return this.requestHandler.request("PUT", Endpoints.CLUB_MEMBER_ROLE(clubID, memberID, roleID), true, {
            reason
        });
    }

    /**
    * Add a reaction to a message
    * @arg {String} channelID The ID of the channel
    * @arg {String} messageID The ID of the message
    * @arg {String} reaction The reaction (Unicode string if Unicode emoji, `emojiName:emojiID` if custom emoji)
    * @arg {String} [userID="@me"] The ID of the user to react as. Passing this parameter is deprecated and will not be supported in future versions.
    * @returns {Promise}
    */
    addMessageReaction(channelID, messageID, reaction, userID) {
        if(userID !== undefined) {
            this.emit("warn", "[DEPRECATED] addMessageReaction() was called without an \"@me\" `userID` argument");
        }
        if(reaction === decodeURI(reaction)) {
            reaction = encodeURIComponent(reaction);
        }
        return this.requestHandler.request("PUT", Endpoints.CHANNEL_MESSAGE_REACTION_USER(channelID, messageID, reaction, userID || "@me"), true);
    }

    /**
    * [USER ACCOUNT] Create a relationship with a user
    * @arg {String} userID The ID of the target user
    * @arg {Boolean} [block=false] If true, block the user. Otherwise, add the user as a friend
    * @returns {Promise}
    */
    addRelationship(userID, block) {
        return this.requestHandler.request("PUT", Endpoints.USER_RELATIONSHIP("@me", userID), true, {
            type: block ? 2 : undefined
        });
    }

    /**
    * [USER ACCOUNT] Purchase a premium subscription (Nitro) for the current user
    * You must get a Stripe card token from the Stripe API for this to work
    * @arg {String} token The Stripe credit card token
    * @arg {String} plan The plan to purchase, either "premium_month" or "premium_year"
    * @returns {Promise}
    */
    addSelfPremiumSubscription(token, plan) {
        return this.requestHandler.request("PUT", Endpoints.USER_BILLING_PREMIUM_SUBSCRIPTION("@me"), true, {
            token: token,
            payment_gateway: "stripe",
            plan: plan
        });
    }

    /**
    * Ban a user from a club
    * @arg {String} clubID The ID of the club
    * @arg {String} userID The ID of the user
    * @arg {Number} [deleteMessageDays=0] Number of days to delete messages for, between 0-7 inclusive
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    banClubMember(clubID, userID, deleteMessageDays, reason) {
        if(!isNaN(deleteMessageDays) && (deleteMessageDays < 0 || deleteMessageDays > 7)) {
            return Promise.reject(new Error(`Invalid deleteMessageDays value (${deleteMessageDays}), should be a number between 0-7 inclusive`));
        }
        return this.requestHandler.request("PUT", Endpoints.CLUB_BAN(clubID, userID), true, {
            delete_message_days: deleteMessageDays || 0,
            reason: reason
        });
    }

    /**
    * Closes a voice connection with a club ID
    * @arg {String} clubID The ID of the club
    */
    closeVoiceConnection(clubID) {
        this.shards.get(this.clubShardMap[clubID] || 0).sendWS(Constants.GatewayOPCodes.VOICE_STATE_UPDATE, {
            club_id: clubID || null,
            channel_id: null,
            self_mute: false,
            self_deaf: false
        });
        this.voiceConnections.leave(clubID || "call");
    }

    /**
    * Tells all shards to connect.
    * @returns {Promise} Resolves when all shards are initialized
    */
    async connect() {
        try {
            const data = await (this.options.maxShards === "auto" ? this.getBotGateway() : this.getGateway());
            if(!data.url || (this.options.maxShards === "auto" && !data.shards)) {
                throw new Error("Invalid response from gateway REST call");
            }
            if(data.url.includes("?")) {
                data.url = data.url.substring(0, data.url.indexOf("?"));
            }
            if(!data.url.endsWith("/")) {
                data.url += "/";
            }
            this.gatewayURL = `${data.url}?v=${Constants.GATEWAY_VERSION}&encoding=${Erlpack ? "etf" : "json"}`;

            if(this.options.compress) {
                this.gatewayURL += "&compress=zlib-stream";
            }

            if(this.options.maxShards === "auto") {
                if(!data.shards) {
                    throw new Error("Failed to autoshard due to lack of data from Helselia.");
                }
                this.options.maxShards = data.shards;
                if(this.options.lastShardID === undefined) {
                    this.options.lastShardID = data.shards - 1;
                }
            }

            for(let i = this.options.firstShardID; i <= this.options.lastShardID; ++i) {
                this.shards.spawn(i);
            }
        } catch(err) {
            if(!this.options.autoreconnect) {
                throw err;
            }
            const reconnectDelay = this.options.reconnectDelay(this.lastReconnectDelay, this.reconnectAttempts);
            await sleep(reconnectDelay);
            this.lastReconnectDelay = reconnectDelay;
            this.reconnectAttempts = this.reconnectAttempts + 1;
            return this.connect();
        }
    }

    /**
    * Create a channel in a club
    * @arg {String} clubID The ID of the club to create the channel in
    * @arg {String} name The name of the channel
    * @arg {String} [type=0] The type of the channel, either 0 (text), 2 (voice), or 4 (category)
    * @arg {Object | String} [options] The properties the channel should have. If `options` is a string, it will be treated as `options.parentID` (see below). Passing a string is deprecated and will not be supported in future versions.
    * @arg {Number} [options.bitrate] The bitrate of the channel (voice channels only)
    * @arg {Boolean} [options.nsfw] The nsfw status of the channel
    * @arg {String?} [options.parentID] The ID of the parent category channel for this channel
    * @arg {Array} [options.permissionOverwrites] An array containing permission overwrite objects
    * @arg {Number} [options.rateLimitPerUser] The time in seconds a user has to wait before sending another message (does not affect bots or users with manageMessages/manageChannel permissions) (text channels only)
    * @arg {String} [options.reason] The reason to be displayed in audit logs
    * @arg {String} [options.topic] The topic of the channel (text channels only)
    * @arg {Number} [options.userLimit] The channel user limit (voice channels only)
    * @returns {Promise<CategoryChannel | TextChannel | VoiceChannel>}
    */
    createChannel(clubID, name, type, reason, options = {}) {
        if(typeof options === "string") { // This used to be parentID, back-compat
            this.emit("warn", "[DEPRECATED] createChannel() was called with a string `options` argument");
            options = {
                parentID: options
            };
        }
        if(typeof reason === "string") { // Reason is deprecated, will be folded into options
            this.emit("warn", "[DEPRECATED] createChannel() was called with a string `reason` argument");
            options.reason = reason;
            reason = undefined;
        } else if(typeof reason === "object" && reason !== null) {
            options = reason;
            reason = undefined;
        }
        return this.requestHandler.request("POST", Endpoints.CLUB_CHANNELS(clubID), true, {
            name: name,
            type: type,
            bitrate: options.bitrate,
            nsfw: options.nsfw,
            parent_id: options.parentID,
            permission_overwrites: options.permissionOverwrites,
            rate_limit_per_user: options.rateLimitPerUser,
            reason: options.reason,
            topic: options.topic,
            user_limit: options.userLimit
        }).then((channel) => Channel.from(channel, this));
    }

    /**
    * Create an invite for a channel
    * @arg {String} channelID The ID of the channel
    * @arg {Object} [options] Invite generation options
    * @arg {Number} [options.maxAge] How long the invite should last in seconds
    * @arg {Number} [options.maxUses] How many uses the invite should last for
    * @arg {Boolean} [options.temporary] Whether the invite grants temporary membership or not
    * @arg {Boolean} [options.unique] Whether the invite is unique or not
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise<Invite>}
    */
    createChannelInvite(channelID, options = {}, reason) {
        return this.requestHandler.request("POST", Endpoints.CHANNEL_INVITES(channelID), true, {
            max_age: options.maxAge,
            max_uses: options.maxUses,
            temporary: options.temporary,
            unique: options.unique,
            reason: reason
        }).then((invite) => new Invite(invite, this));
    }

    /**
    * Create a channel webhook
    * @arg {String} channelID The ID of the channel to create the webhook in
    * @arg {Object} options Webhook options
    * @arg {String} options.name The default name
    * @arg {String} options.avatar The default avatar as a base64 data URI. Note: base64 strings alone are not base64 data URI strings
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise<Object>} Resolves with a webhook object
    */
    createChannelWebhook(channelID, options, reason) {
        options.reason = reason;
        return this.requestHandler.request("POST", Endpoints.CHANNEL_WEBHOOKS(channelID), true, options);
    }

    /**
    * [USER ACCOUNT] Create a group channel with other users
    * @arg {Array<String>} userIDs The IDs of the other users
    * @returns {Promise<PrivateChannel>}
    */
    createGroupChannel(userIDs) {
        return this.requestHandler.request("POST", Endpoints.USER_CHANNELS("@me"), true, {
            recipients: userIDs,
            type: 3
        }).then((privateChannel) => new GroupChannel(privateChannel, this));
    }

    /**
    * Create a club
    * @arg {String} name The name of the club
    * @arg {Object} options The properties of the club
    * @arg {String} [options.afkChannelID] The ID of the AFK voice channel
    * @arg {Number} [options.afkTimeout] The AFK timeout in seconds
    * @arg {Array<Object>} [options.channels] The new channels of the club. IDs are placeholders which allow use of category channels.
    * @arg {Number} [options.defaultNotifications] The default notification settings for the club. 0 is "All Messages", 1 is "Only @mentions".
    * @arg {Number} [options.explicitContentFilter] The level of the explicit content filter for messages/images in the club. 0 disables message scanning, 1 enables scanning the messages of members without roles, 2 enables scanning for all messages.
    * @arg {String} [options.icon] The club icon as a base64 data URI. Note: base64 strings alone are not base64 data URI strings
    * @arg {String} [options.region] The region of the club
    * @arg {Array<Object>} [options.roles] The new roles of the club, the first one is the @everyone role. IDs are placeholders which allow channel overwrites.
    * @arg {String} [options.systemChannelID] The ID of the system channel
    * @arg {Number} [options.verificationLevel] The club verification level
    * @returns {Promise<Club>}
    */
    createClub(name, options) {
        if(this.clubs.size > 9) {
            throw new Error("This method can't be used when in 10 or more clubs.");
        }

        return this.requestHandler.request("POST", Endpoints.CLUBS, true, {
            name: name,
            region: options.region,
            icon: options.icon,
            verification_level: options.verificationLevel,
            default_message_notifications: options.defaultNotifications,
            explicit_content_filter: options.explicitContentFilter,
            system_channel_id: options.systemChannelID,
            afk_channel_id: options.afkChannelID,
            afk_timeout: options.afkTimeout,
            roles: options.roles,
            channels: options.channels
        }).then((club) => new Club(club, this));
    }

    /**
    * Create a club emoji object
    * @arg {String} clubID The ID of the club to create the emoji in
    * @arg {Object} options Emoji options
    * @arg {String} options.image The base 64 encoded string
    * @arg {String} options.name The name of emoji
    * @arg {Array} [options.roles] An array containing authorized role IDs
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise<Object>} A club emoji object
    */
    createClubEmoji(clubID, options, reason) {
        options.reason = reason;
        return this.requestHandler.request("POST", Endpoints.CLUB_EMOJIS(clubID), true, options);
    }

    /**
    * Create a message in a channel
    * Note: If you want to DM someone, the user ID is **not** the DM channel ID. use Client.getDMChannel() to get the DM channel for a user
    * @arg {String} channelID The ID of the channel
    * @arg {String | Object} content A string or object. If an object is passed:
    * @arg {Object} [content.allowedMentions] A list of mentions to allow (overrides default)
    * @arg {Boolean} [content.allowedMentions.everyone] Whether or not to allow @everyone/@here.
    * @arg {Boolean | Array<String>} [content.allowedMentions.roles] Whether or not to allow all role mentions, or an array of specific role mentions to allow.
    * @arg {Boolean | Array<String>} [content.allowedMentions.users] Whether or not to allow all user mentions, or an array of specific user mentions to allow.
    * @arg {String} content.content A content string
    * @arg {Object} [content.embed] An embed object. See [the official Helselia API documentation entry](https://discord.com/developers/docs/resources/channel#embed-object) for object structure
    * @arg {Boolean} [content.tts] Set the message TTS flag
    * @arg {Object | Array<Object>} [file] A file object (or an Array of them)
    * @arg {Buffer} file.file A buffer containing file data
    * @arg {String} file.name What to name the file
    * @returns {Promise<Message>}
    */
    createMessage(channelID, content, file) {
        if(content !== undefined) {
            if(typeof content !== "object" || content === null) {
                content = {
                    content: "" + content
                };
            } else if(content.content !== undefined && typeof content.content !== "string") {
                content.content = "" + content.content;
            } else if(content.content === undefined && !content.embed && !file) {
                return Promise.reject(new Error("No content, file, or embed"));
            }
            content.allowed_mentions = this._formatAllowedMentions(content.allowedMentions);
        } else if(!file) {
            return Promise.reject(new Error("No content, file, or embed"));
        }
        return this.requestHandler.request("POST", Endpoints.CHANNEL_MESSAGES(channelID), true, content, file).then((message) => new Message(message, this));
    }

    /**
    * Create a club role
    * @arg {String} clubID The ID of the club to create the role in
    * @arg {Object|Role} [options] An object or Role containing the properties to set
    * @arg {Number} [options.color] The hex color of the role, in number form (ex: 0x3d15b3 or 4040115)
    * @arg {Boolean} [options.hoist] Whether to hoist the role in the user list or not
    * @arg {Boolean} [options.mentionable] Whether the role is mentionable or not
    * @arg {String} [options.name] The name of the role
    * @arg {Number} [options.permissions] The role permissions number
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise<Role>}
    */
    createRole(clubID, options, reason) {
        return this.requestHandler.request("POST", Endpoints.CLUB_ROLES(clubID), true, {
            name: options.name,
            permissions: options.permissions instanceof Permission ? options.permissions.allow : options.permissions,
            color: options.color,
            hoist: options.hoist,
            mentionable: options.mentionable,
            reason: reason
        }).then((role) => {
            const club = this.clubs.get(clubID);
            if(club) {
                return club.roles.add(role, club);
            } else {
                return new Role(role);
            }
        });
    }

    /**
     * Crosspost (publish) a message to subscribed channels
     * @arg {String} channelID The ID of the NewsChannel
     * @arg {String} messageID The ID of the message
     * @returns {Promise<Message>}
     */
    crosspostMessage(channelID, messageID) {
        return this.requestHandler.request("POST", Endpoints.CHANNEL_CROSSPOST(channelID, messageID), true).then((message) => new Message(message, this));
    }

    /**
    * Delete a club channel, or leave a private or group channel
    * @arg {String} channelID The ID of the channel
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    deleteChannel(channelID, reason) {
        return this.requestHandler.request("DELETE", Endpoints.CHANNEL(channelID), true, {
            reason
        });
    }

    /**
    * Delete a channel permission overwrite
    * @arg {String} channelID The ID of the channel
    * @arg {String} overwriteID The ID of the overwritten user or role
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    deleteChannelPermission(channelID, overwriteID, reason) {
        return this.requestHandler.request("DELETE", Endpoints.CHANNEL_PERMISSION(channelID, overwriteID), true, {
            reason
        });
    }

    /**
    * Delete a club (bot user must be owner)
    * @arg {String} clubID The ID of the club
    * @returns {Promise}
    */
    deleteClub(clubID) {
        return this.requestHandler.request("DELETE", Endpoints.CLUB(clubID), true);
    }

    /**
    * Delete a club emoji object
    * @arg {String} clubID The ID of the club to delete the emoji in
    * @arg {String} emojiID The ID of the emoji
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    deleteClubEmoji(clubID, emojiID, reason) {
        return this.requestHandler.request("DELETE", Endpoints.CLUB_EMOJI(clubID, emojiID), true, {
            reason
        });
    }

    /**
    * Delete a club integration
    * @arg {String} clubID The ID of the club
    * @arg {String} integrationID The ID of the integration
    * @returns {Promise}
    */
    deleteClubIntegration(clubID, integrationID) {
        return this.requestHandler.request("DELETE", Endpoints.CLUB_INTEGRATION(clubID, integrationID), true);
    }

    /**
    * Delete an invite
    * @arg {String} inviteID The ID of the invite
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    deleteInvite(inviteID, reason) {
        return this.requestHandler.request("DELETE", Endpoints.INVITE(inviteID), true, {
            reason
        });
    }

    /**
    * Delete a message
    * @arg {String} channelID The ID of the channel
    * @arg {String} messageID The ID of the message
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    deleteMessage(channelID, messageID, reason) {
        return this.requestHandler.request("DELETE", Endpoints.CHANNEL_MESSAGE(channelID, messageID), true, {
            reason
        });
    }

    /**
    * Bulk delete messages (bot accounts only)
    * @arg {String} channelID The ID of the channel
    * @arg {Array<String>} messageIDs Array of message IDs to delete
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    deleteMessages(channelID, messageIDs, reason) {
        if(messageIDs.length === 0) {
            return Promise.resolve();
        }
        if(messageIDs.length === 1) {
            return this.deleteMessage(channelID, messageIDs[0]);
        }

        const oldestAllowedSnowflake = (Date.now() - 1421280000000) * 4194304;
        const invalidMessage = messageIDs.find((messageID) => messageID < oldestAllowedSnowflake);
        if(invalidMessage) {
            return Promise.reject(new Error(`Message ${invalidMessage} is more than 2 weeks old.`));
        }

        if(messageIDs.length > 100) {
            return this.requestHandler.request("POST", Endpoints.CHANNEL_BULK_DELETE(channelID), true, {
                messages: messageIDs.splice(0, 100),
                reason: reason
            }).then(() => this.deleteMessages(channelID, messageIDs));
        }
        return this.requestHandler.request("POST", Endpoints.CHANNEL_BULK_DELETE(channelID), true, {
            messages: messageIDs,
            reason: reason
        });
    }

    /**
    * Delete a club role
    * @arg {String} clubID The ID of the club to create the role in
    * @arg {String} roleID The ID of the role
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    deleteRole(clubID, roleID, reason) {
        return this.requestHandler.request("DELETE", Endpoints.CLUB_ROLE(clubID, roleID), true, {
            reason
        });
    }

    /**
    * [USER ACCOUNT] Delete a connection for the current user
    * @arg {String} platform The connection platform (e.g. "twitch", "reddit")
    * @arg {String} id The connection ID
    * @returns {Promise}
    */
    deleteSelfConnection(platform, id) {
        return this.requestHandler.request("DELETE", Endpoints.USER_CONNECTION_PLATFORM("@me", platform, id), true);
    }

    /**
    * [USER ACCOUNT] Cancel the premium subscription (Nitro) for the current user
    * @returns {Promise}
    */
    deleteSelfPremiumSubscription() {
        return this.requestHandler.request("DELETE", Endpoints.USER_BILLING_PREMIUM_SUBSCRIPTION("@me"), true);
    }

    /**
    * [USER ACCOUNT] Delete the current user's note for another user
    * @returns {Promise}
    */
    deleteUserNote(userID) {
        return this.requestHandler.request("DELETE", Endpoints.USER_NOTE("@me", userID), true);
    }

    /**
    * Delete a webhook
    * @arg {String} webhookID The ID of the webhook
    * @arg {String} [token] The token of the webhook, used instead of the Bot Authorization token
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    deleteWebhook(webhookID, token, reason) {
        return this.requestHandler.request("DELETE", token ? Endpoints.WEBHOOK_TOKEN(webhookID, token) : Endpoints.WEBHOOK(webhookID), !token, {
            reason
        });
    }

    /**
    * [USER ACCOUNT] Disable TOTP authentication for the current user
    * @arg {String} code The timed auth code for the current user
    * @returns {Promise<Object>} An object containing the user's new authorization token
    */
    disableSelfMFATOTP(code) {
        return this.requestHandler.request("POST", Endpoints.USER_MFA_TOTP_DISABLE("@me"), true, {
            code
        }).then((data) => {
            if(data.token) {
                this.token = data.token;
            }
        });
    }

    /**
    * Disconnects all shards
    * @arg {Object?} [options] Shard disconnect options
    * @arg {String | Boolean} [options.reconnect] false means destroy everything, true means you want to reconnect in the future, "auto" will autoreconnect
    */
    disconnect(options) {
        this.ready = false;
        this.shards.forEach((shard) => {
            shard.disconnect(options);
        });
        this.shards.connectQueue = [];
    }

    /**
    * Update the bot's AFK status. Setting this to true will enable push notifications for userbots.
    * @arg {Boolean} afk Whether the bot user is AFK or not
    */
    editAFK(afk) {
        this.presence.afk = !!afk;

        this.shards.forEach((shard) => {
            shard.editAFK(afk);
        });
    }

    /**
    * Edit a channel's properties
    * @arg {String} channelID The ID of the channel
    * @arg {Object} options The properties to edit
    * @arg {Number} [options.bitrate] The bitrate of the channel (club voice channels only)
    * @arg {String} [options.icon] The icon of the channel as a base64 data URI (group channels only). Note: base64 strings alone are not base64 data URI strings
    * @arg {String} [options.name] The name of the channel
    * @arg {Boolean} [options.nsfw] The nsfw status of the channel (club channels only)
    * @arg {String} [options.ownerID] The ID of the channel owner (group channels only)
    * @arg {String?} [options.parentID] The ID of the parent channel category for this channel (club text/voice channels only)
    * @arg {Number} [options.rateLimitPerUser] The time in seconds a user has to wait before sending another message (does not affect bots or users with manageMessages/manageChannel permissions) (club text channels only)
    * @arg {String} [options.topic] The topic of the channel (club text channels only)
    * @arg {Number} [options.userLimit] The channel user limit (club voice channels only)
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise<CategoryChannel | GroupChannel | TextChannel | VoiceChannel | NewsChannel>}
    */
    editChannel(channelID, options, reason) {
        return this.requestHandler.request("PATCH", Endpoints.CHANNEL(channelID), true, {
            bitrate: options.bitrate,
            icon: options.icon,
            name: options.name,
            nsfw: options.nsfw,
            owner_id: options.ownerID,
            parent_id: options.parentID,
            rate_limit_per_user: options.rateLimitPerUser,
            topic: options.topic,
            user_limit: options.userLimit,
            reason: reason
        }).then((channel) => Channel.from(channel, this));
    }

    /**
    * Create a channel permission overwrite
    * @arg {String} channelID The ID of channel
    * @arg {String} overwriteID The ID of the overwritten user or role (everyone role ID = club ID)
    * @arg {Number} allow The permissions number for allowed permissions
    * @arg {Number} deny The permissions number for denied permissions
    * @arg {String} type The object type of the overwrite, either "member" or "role"
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    editChannelPermission(channelID, overwriteID, allow, deny, type, reason) {
        return this.requestHandler.request("PUT", Endpoints.CHANNEL_PERMISSION(channelID, overwriteID), true, {
            allow,
            deny,
            type,
            reason
        });
    }

    /**
    * Edit a club channel's position. Note that channel position numbers are lowest on top and highest at the bottom.
    * @arg {String} channelID The ID of the channel
    * @arg {Number} position The new position of the channel
    * @returns {Promise}
    */
    editChannelPosition(channelID, position) {
        let channels = this.clubs.get(this.channelClubMap[channelID]).channels;
        const channel = channels.get(channelID);
        if(!channel) {
            return Promise.reject(new Error(`Channel ${channelID} not found`));
        }
        if(channel.position === position) {
            return Promise.resolve();
        }
        const min = Math.min(position, channel.position);
        const max = Math.max(position, channel.position);
        channels = channels.filter((chan) => {
            return chan.type === channel.type
                && min <= chan.position
                && chan.position <= max
                && chan.id !== channelID;
        }).sort((a, b) => a.position - b.position);
        if(position > channel.position) {
            channels.push(channel);
        } else {
            channels.unshift(channel);
        }
        return this.requestHandler.request("PATCH", Endpoints.CLUB_CHANNELS(this.channelClubMap[channelID]), true, channels.map((channel, index) => ({
            id: channel.id,
            position: index + min
        })));
    }

    /**
    * Edit a club
    * @arg {String} clubID The ID of the club
    * @arg {Object} options The properties to edit
    * @arg {String} [options.afkChannelID] The ID of the AFK voice channel
    * @arg {Number} [options.afkTimeout] The AFK timeout in seconds
    * @arg {String} [options.banner] The club banner image as a base64 data URI (VIP only). Note: base64 strings alone are not base64 data URI strings
    * @arg {Number} [options.defaultNotifications] The default notification settings for the club. 0 is "All Messages", 1 is "Only @mentions".
    * @arg {String} [options.description] The description for the club (VIP only)
    * @arg {Number} [options.explicitContentFilter] The level of the explicit content filter for messages/images in the club. 0 disables message scanning, 1 enables scanning the messages of members without roles, 2 enables scanning for all messages.
    * @arg {String} [options.icon] The club icon as a base64 data URI. Note: base64 strings alone are not base64 data URI strings
    * @arg {String} [options.name] The ID of the club
    * @arg {String} [options.ownerID] The ID of the user to transfer server ownership to (bot user must be owner)
    * @arg {String} [options.preferredLocale] Preferred "PUBLIC" club language used in server discovery and notices from Helselia
    * @arg {String} [options.publicUpdatesChannelID] The id of the channel where admins and moderators of "PUBLIC" clubs receive notices from Helselia
    * @arg {String} [options.region] The region of the club
    * @arg {String} [options.rulesChannelID] The id of the channel where "PUBLIC" clubs display rules and/or guidelines
    * @arg {String} [options.splash] The club splash image as a base64 data URI (VIP only). Note: base64 strings alone are not base64 data URI strings
    * @arg {String} [options.systemChannelID] The ID of the system channel
    * @arg {Number} [options.verificationLevel] The club verification level
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise<Club>}
    */
    editClub(clubID, options, reason) {
        return this.requestHandler.request("PATCH", Endpoints.CLUB(clubID), true, {
            name: options.name,
            region: options.region,
            icon: options.icon,
            verification_level: options.verificationLevel,
            default_message_notifications: options.defaultNotifications,
            explicit_content_filter: options.explicitContentFilter,
            system_channel_id: options.systemChannelID,
            rules_channel_id: options.rulesChannelID,
            public_updates_channel_id: options.publicUpdatesChannelID,
            preferred_locale: options.preferredLocale,
            afk_channel_id: options.afkChannelID,
            afk_timeout: options.afkTimeout,
            owner_id: options.ownerID,
            splash: options.splash,
            banner: options.banner,
            description: options.description,
            reason: reason
        }).then((club) => new Club(club, this));
    }

    /**
    * Edit a club emoji object
    * @arg {String} clubID The ID of the club to edit the emoji in
    * @arg {String} emojiID The ID of the emoji you want to modify
    * @arg {Object} options Emoji options
    * @arg {String} [options.name] The name of emoji
    * @arg {Array} [options.roles] An array containing authorized role IDs
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise<Object>} A club emoji object
    */
    editClubEmoji(clubID, emojiID, options, reason) {
        options.reason = reason;
        return this.requestHandler.request("PATCH", Endpoints.CLUB_EMOJI(clubID, emojiID), true, options);
    }

    /**
    * Edit a club integration
    * @arg {String} clubID The ID of the club
    * @arg {String} integrationID The ID of the integration
    * @arg {Object} options The properties to edit
    * @arg {String} [options.enableEmoticons] Whether to enable integration emoticons or not
    * @arg {String} [options.expireBehavior] What to do when a user's subscription runs out
    * @arg {String} [options.expireGracePeriod] How long before the integration's role is removed from an unsubscribed user
    * @returns {Promise}
    */
    editClubIntegration(clubID, integrationID, options) {
        return this.requestHandler.request("PATCH", Endpoints.CLUB_INTEGRATION(clubID, integrationID), true, {
            expire_behavior: options.expireBehavior,
            expire_grace_period: options.expireGracePeriod,
            enable_emoticons: options.enableEmoticons
        });
    }

    /**
    * Edit a club member
    * @arg {String} clubID The ID of the club
    * @arg {String} memberID The ID of the member
    * @arg {Object} options The properties to edit
    * @arg {String} [options.channelID] The ID of the voice channel to move the member to (must be in voice)
    * @arg {Boolean} [options.deaf] Server deafen the member
    * @arg {Boolean} [options.mute] Server mute the member
    * @arg {String} [options.nick] Set the member's server nickname, "" to remove
    * @arg {Array<String>} [options.roles] The array of role IDs the member should have
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    editClubMember(clubID, memberID, options, reason) {
        return this.requestHandler.request("PATCH", Endpoints.CLUB_MEMBER(clubID, memberID), true, {
            roles: options.roles && options.roles.filter((roleID, index) => options.roles.indexOf(roleID) === index),
            nick: options.nick,
            mute: options.mute,
            deaf: options.deaf,
            channel_id: options.channelID,
            reason: reason
        });
    }

    /**
    * Modify a club's widget
    * @arg {String} clubID The ID of the club
    * @arg {Object} options The widget object to modify (https://discord.com/developers/docs/resources/club#modify-club-widget)
    * @returns {Promise<Object>} A club widget object
    */
    editClubWidget(clubID, options) {
        return this.requestHandler.request("PATCH", Endpoints.CLUB_WIDGET(clubID), true, options);
    }

    /**
    * Edit a message
    * @arg {String} channelID The ID of the channel
    * @arg {String} messageID The ID of the message
    * @arg {String | Array | Object} content A string, array of strings, or object. If an object is passed:
    * @arg {Object} [content.allowedMentions] A list of mentions to allow (overrides default)
    * @arg {Boolean} [content.allowedMentions.everyone] Whether or not to allow @everyone/@here.
    * @arg {Boolean | Array<String>} [content.allowedMentions.roles] Whether or not to allow all role mentions, or an array of specific role mentions to allow.
    * @arg {Boolean | Array<String>} [content.allowedMentions.users] Whether or not to allow all user mentions, or an array of specific user mentions to allow.
    * @arg {String} content.content A content string
    * @arg {Object} [content.embed] An embed object. See [the official Helselia API documentation entry](https://discord.com/developers/docs/resources/channel#embed-object) for object structure
    * @arg {Number} [content.flags] A number representing the flags to apply to the message. See [the official Helselia API documentation entry](https://discord.com/developers/docs/resources/channel#message-object-message-flags) for flags reference
    * @returns {Promise<Message>}
    */
    editMessage(channelID, messageID, content) {
        if(content !== undefined) {
            if(typeof content !== "object" || content === null) {
                content = {
                    content: "" + content
                };
            } else if(content.content !== undefined && typeof content.content !== "string") {
                content.content = "" + content.content;
            } else if(content.content === undefined && !content.embed && content.flags === undefined) {
                return Promise.reject(new Error("No content, embed or flags"));
            }
            content.allowed_mentions = this._formatAllowedMentions(content.allowedMentions);
        }
        return this.requestHandler.request("PATCH", Endpoints.CHANNEL_MESSAGE(channelID, messageID), true, content).then((message) => new Message(message, this));
    }

    /**
    * Edit the bot's nickname in a club
    * @arg {String} clubID The ID of the club
    * @arg {String} nick The nickname
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    editNickname(clubID, nick, reason) {
        return this.requestHandler.request("PATCH", Endpoints.CLUB_MEMBER_NICK(clubID, "@me"), true, {
            nick,
            reason
        });
    }

    /**
    * Edit a club role
    * @arg {String} clubID The ID of the club the role is in
    * @arg {String} roleID The ID of the role
    * @arg {Object} options The properties to edit
    * @arg {Number} [options.color] The hex color of the role, in number form (ex: 0x3da5b3 or 4040115)
    * @arg {Boolean} [options.hoist] Whether to hoist the role in the user list or not
    * @arg {Boolean} [options.mentionable] Whether the role is mentionable or not
    * @arg {String} [options.name] The name of the role
    * @arg {Number} [options.permissions] The role permissions number
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise<Role>}
    */
    editRole(clubID, roleID, options, reason) {
        options.reason = reason;
        return this.requestHandler.request("PATCH", Endpoints.CLUB_ROLE(clubID, roleID), true, options).then((role) => new Role(role, this.clubs.get(clubID)));
    }

    /**
    * Edit a club role's position. Note that role position numbers are highest on top and lowest at the bottom.
    * @arg {String} clubID The ID of the club the role is in
    * @arg {String} roleID The ID of the role
    * @arg {Number} position The new position of the role
    * @returns {Promise}
    */
    editRolePosition(clubID, roleID, position) {
        if(clubID === roleID) {
            return Promise.reject(new Error("Cannot move default role"));
        }
        let roles = this.clubs.get(clubID).roles;
        const role = roles.get(roleID);
        if(!role) {
            return Promise.reject(new Error(`Role ${roleID} not found`));
        }
        if(role.position === position) {
            return Promise.resolve();
        }
        const min = Math.min(position, role.position);
        const max = Math.max(position, role.position);
        roles = roles.filter((role) => min <= role.position && role.position <= max && role.id !== roleID).sort((a, b) => a.position - b.position);
        if(position > role.position) {
            roles.push(role);
        } else {
            roles.unshift(role);
        }
        return this.requestHandler.request("PATCH", Endpoints.CLUB_ROLES(clubID), true, roles.map((role, index) => ({
            id: role.id,
            position: index + min
        })));
    }

    /**
    * Edit properties of the bot user
    * @arg {Object} options The properties to edit
    * @arg {String} [options.username] The new username
    * @arg {String} [options.avatar] The new avatar as a base64 data URI. Note: base64 strings alone are not base64 data URI strings
    * @returns {Promise<ExtendedUser>}
    */
    editSelf(options) {
        return this.requestHandler.request("PATCH", Endpoints.USER("@me"), true, options).then((data) => new ExtendedUser(data, this));
    }

    /**
    * [USER ACCOUNT] Edit a connection for the current user
    * @arg {String} platform The connection platform (e.g. "twitch", "reddit")
    * @arg {String} id The connection ID
    * @arg {Object} data The connection data
    * @arg {Boolean} [data.friendSync] Whether to sync friends from the connection or not
    * @arg {Number} [data.visibility] The visibility level for the connection. 0 = hidden, 1 = shown on profile
    * @returns {Promise<Object>} The updated connection data
    */
    editSelfConnection(platform, id, data) {
        return this.requestHandler.request("PATCH", Endpoints.USER_CONNECTION_PLATFORM("@me", platform, id), true, {
            visibility: data.visibility,
            friend_sync: data.friendSync
        });
    }

    /**
    * [USER ACCOUNT] Edit settings for the current user
    * @arg {Object} data The user settings data
    * @arg {Boolean} [data.convertEmoticons] Whether to convert emoticons or not (e.g. :D => 😄)
    * @arg {Boolean} [data.detectPlatformAccounts] Whether to automatically detect accounts from other platforms or not (Blizzard, Skype, etc.)
    * @arg {Boolean} [data.developerMode] Whether to enable developer mode or not
    * @arg {Boolean} [data.enableTTSCommand] Whether to respect usage of the TTS command or not
    * @arg {Object} [data.friendSourceFlags] An object representing allowed friend request sources
    * @arg {Boolean} [data.friendSourceFlags.all] Whether to allow friends requests from anywhere or not
    * @arg {Boolean} [data.friendSourceFlags.mutualFriends] Whether to allow friend requests from people with mutual friends or not
    * @arg {Boolean} [data.friendSourceFlags.mutualClubs] Whether to allow friend requests from people in mutual clubs or not
    * @arg {Array<String>} [data.clubPositions] An ordered array of club IDs representing the club list order in the Helselia client
    * @arg {Boolean} [data.inlineAttachmentMedia] Whether to show attachment previews or not
    * @arg {Boolean} [data.inlineEmbedMedia] Whether to show embed images or not
    * @arg {String} [data.locale] The locale to use for the Helselia UI
    * @arg {Boolean} [data.messageDisplayCompact] Whether to use compact mode or not
    * @arg {Boolean} [data.renderEmbeds] Whether to show embeds or not
    * @arg {Boolean} [data.renderReactions] Whether to show reactions or not
    * @arg {Array<String>} [data.restrictedClubs] An array of club IDs where direct messages from club members are disallowed
    * @arg {Boolean} [data.showCurrentGame] Whether to set the user's status to the current game or not
    * @arg {String} [data.status] The status of the user, either "invisible", "dnd", "away", or "online"
    * @arg {String} [data.theme] The theme to use for the Helselia UI, either "dark" or "light"
    * @returns {Promise<Object>} The user's settings data.
    */
    editSelfSettings(data) {
        let friendSourceFlags = undefined;
        if(data.friendSourceFlags) {
            friendSourceFlags = {};
            if(data.friendSourceFlags.all) {
                friendSourceFlags.all = true;
            }
            if(data.friendSourceFlags.mutualFriends) {
                friendSourceFlags.mutual_friends = true;
            }
            if(data.friendSourceFlags.mutualClubs) {
                friendSourceFlags.mutual_clubs = true;
            }
        }
        return this.requestHandler.request("PATCH", Endpoints.USER_SETTINGS("@me"), true, {
            convert_emoticons: data.convertEmoticons,
            detect_platform_accounts: data.detectPlatformAccounts,
            developer_mode: data.developerMode,
            enable_tts_command: data.enableTTSCommand,
            friend_source_flags: friendSourceFlags,
            club_positions: data.clubPositions,
            inline_attachment_media: data.inlineAttachmentMedia,
            inline_embed_media: data.inlineEmbedMedia,
            locale: data.locale,
            message_display_compact: data.messageDisplayCompact,
            render_embeds: data.renderEmbeds,
            render_reactions: data.renderReactions,
            restricted_clubs: data.restrictedClubs,
            show_current_game: data.showCurrentGame,
            status: data.status,
            theme: data.theme
        });
    }

    /**
    * Update the bot's status on all clubs
    * @arg {String} [status] Sets the bot's status, either "online", "idle", "dnd", or "invisible"
    * @arg {Object} [game] Sets the bot's active game, null to clear
    * @arg {String} game.name Sets the name of the bot's active game
    * @arg {Number} [game.type] The type of game. 0 is playing, 1 is streaming (Twitch only), 2 is listening, 3 is watching
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
            this.presence.game = game;
        }

        this.shards.forEach((shard) => {
            shard.editStatus(status, game);
        });
    }

    /**
    * [USER ACCOUNT] Edit the current user's note for another user
    * @arg {String} userID The ID of the target user
    * @arg {String} note The note
    * @returns {Promise}
    */
    editUserNote(userID, note) {
        return this.requestHandler.request("PUT", Endpoints.USER_NOTE("@me", userID), true, {
            note
        });
    }

    /**
    * Edit a webhook
    * @arg {String} webhookID The ID of the webhook
    * @arg {Object} options Webhook options
    * @arg {String} [options.name] The new default name
    * @arg {String} [options.avatar] The new default avatar as a base64 data URI. Note: base64 strings alone are not base64 data URI strings
    * @arg {String} [options.channelID] The new channel ID where webhooks should be sent to
    * @arg {String} [token] The token of the webhook, used instead of the Bot Authorization token
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise<Object>} Resolves with a webhook object
    */
    editWebhook(webhookID, options, token, reason) {
        return this.requestHandler.request("PATCH", token ? Endpoints.WEBHOOK_TOKEN(webhookID, token) : Endpoints.WEBHOOK(webhookID), !token, {
            name: options.name,
            avatar: options.avatar,
            channel_id: options.channelID,
            reason: reason
        });
    }

    /**
    * [USER ACCOUNT] Enable TOTP authentication for the current user
    * @arg {String} secret The TOTP secret used to generate the auth code
    * @arg {String} code The timed auth code for the current user
    * @returns {Promise<Object>} An object containing the user's new authorization token and backup codes
    */
    enableSelfMFATOTP(secret, code) {
        return this.requestHandler.request("POST", Endpoints.USER_MFA_TOTP_ENABLE("@me"), true, {
            secret,
            code
        }).then((data) => {
            if(data.token) {
                this.token = data.token;
            }
        });
    }

    /**
    * Execute a slack-style webhook
    * @arg {String} webhookID The ID of the webhook
    * @arg {String} token The token of the webhook
    * @arg {Object} options Slack webhook options
    * @arg {Boolean} [options.auth=false] Whether or not to authorize the request with the bot token (allowing custom emotes from other clubs)
    * @arg {Boolean} [options.wait=false] Whether to wait for the server to confirm the message create or not
    * @returns {Promise}
    */
    executeSlackWebhook(webhookID, token, options) {
        const wait = !!options.wait;
        options.wait = undefined;
        const auth = !!options.auth;
        options.auth = undefined;
        return this.requestHandler.request("POST", Endpoints.WEBHOOK_TOKEN_SLACK(webhookID, token) + (wait ? "?wait=true" : ""), auth, options);
    }

    /**
    * Execute a webhook
    * @arg {String} webhookID The ID of the webhook
    * @arg {String} token The token of the webhook
    * @arg {Object} options Webhook execution options
    * @arg {Object} [options.allowedMentions] A list of mentions to allow (overrides default)
    * @arg {Boolean} [options.allowedMentions.everyone] Whether or not to allow @everyone/@here.
    * @arg {Boolean | Array<String>} [options.allowedMentions.roles] Whether or not to allow all role mentions, or an array of specific role mentions to allow.
    * @arg {Boolean | Array<String>} [options.allowedMentions.users] Whether or not to allow all user mentions, or an array of specific user mentions to allow.
    * @arg {Boolean} [options.auth=false] Whether or not to authorize the request with the bot token (allowing custom emotes from other clubs)
    * @arg {String} [options.avatarURL] A URL for a custom avatar, defaults to webhook default avatar if not specified
    * @arg {String} [options.content=""] A content string
    * @arg {Array<Object>} [options.embeds] An array of Helselia embeds
    * @arg {Object | Array<Object>} [options.file] A file object (or an Array of them)
    * @arg {Buffer} options.file.file A buffer containing file data
    * @arg {String} options.file.name What to name the file
    * @arg {Boolean} [options.tts=false] Whether the message should be a TTS message or not
    * @arg {String} [options.username] A custom username, defaults to webhook default username if not specified
    * @arg {Boolean} [options.wait=false] Whether to wait for the server to confirm the message create or not
    * @returns {Promise<Message?>}
    */
    executeWebhook(webhookID, token, options) {
        if(!options.content && !options.file && !options.embeds) {
            return Promise.reject(new Error("No content, file, or embeds"));
        }
        return this.requestHandler.request("POST", Endpoints.WEBHOOK_TOKEN(webhookID, token) + (options.wait ? "?wait=true" : ""), !!options.auth, {
            content: options.content,
            embeds: options.embeds,
            username: options.username,
            avatar_url: options.avatarURL,
            tts: options.tts,
            allowed_mentions: this._formatAllowedMentions(options.allowedMentions)
        }, options.file).then((response) => options.wait ? new Message(response, this) : undefined);
    }

    /**
     * Follow a NewsChannel in another channel. This creates a webhook in the target channel
     * @param {String} channelID The ID of the NewsChannel
     * @arg {String} webhookChannelID The ID of the target channel
     * @returns {Object} An object containing the NewsChannel's ID and the new webhook's ID
     */
    followChannel(channelID, webhookChannelID) {
        return this.requestHandler.request("POST", Endpoints.CHANNEL_FOLLOW(channelID), true, {webhook_channel_id: webhookChannelID});
    }

    /**
    * Get general and bot-specific info on connecting to the Helselia gateway (e.g. connection ratelimit)
    * @returns {Promise<Object>} Resolves with an object containing gateway connection info
    */
    getBotGateway() {
        if(!this.token.startsWith("Bot ")) {
            this.token = "Bot " + this.token;
        }
        return this.requestHandler.request("GET", Endpoints.GATEWAY_BOT, true);
    }

    /**
    * Get a Channel object from a channel ID
    * @arg {String} channelID The ID of the channel
    * @returns {CategoryChannel | GroupChannel | PrivateChannel | TextChannel | VoiceChannel | NewsChannel}
    */
    getChannel(channelID) {
        if(!channelID) {
            throw new Error(`Invalid channel ID: ${channelID}`);
        }

        if(this.channelClubMap[channelID] && this.clubs.get(this.channelClubMap[channelID])) {
            return this.clubs.get(this.channelClubMap[channelID]).channels.get(channelID);
        }
        return this.privateChannels.get(channelID) || this.groupChannels.get(channelID);
    }

    /**
    * Get all invites in a channel
    * @arg {String} channelID The ID of the channel
    * @returns {Promise<Array<Invite>>}
    */
    getChannelInvites(channelID) {
        return this.requestHandler.request("GET", Endpoints.CHANNEL_INVITES(channelID), true).then((invites) => invites.map((invite) => new Invite(invite, this)));
    }

    /**
    * Get all the webhooks in a channel
    * @arg {String} channelID The ID of the channel to get webhooks for
    * @returns {Promise<Array<Object>>} Resolves with an array of webhook objects
    */
    getChannelWebhooks(channelID) {
        return this.requestHandler.request("GET", Endpoints.CHANNEL_WEBHOOKS(channelID), true);
    }

    /**
    * Get a DM channel with a user, or create one if it does not exist
    * @arg {String} userID The ID of the user
    * @returns {Promise<PrivateChannel>}
    */
    getDMChannel(userID) {
        if(this.privateChannelMap[userID]) {
            return Promise.resolve(this.privateChannels.get(this.privateChannelMap[userID]));
        }
        return this.requestHandler.request("POST", Endpoints.USER_CHANNELS("@me"), true, {
            recipients: [userID],
            type: 1
        }).then((privateChannel) => new PrivateChannel(privateChannel, this));
    }

    /**
    * Get info on connecting to the Helselia gateway
    * @returns {Promise<Object>} Resolves with an object containing gateway connection info
    */
    getGateway() {
        return this.requestHandler.request("GET", Endpoints.GATEWAY);
    }

    /**
    * Get the audit logs for a club
    * @arg {String} clubID The ID of the club to get audit logs for
    * @arg {Number} [limit=50] The maximum number of entries to return
    * @arg {String} [before] Get entries before this entry ID
    * @arg {Number} [actionType] Filter entries by action type
    * @returns {Promise<Object>} Resolves with {users: Users[], entries: ClubAuditLogEntry[]}
    */
    getClubAuditLogs(clubID, limit, before, actionType) {
        return this.requestHandler.request("GET", Endpoints.CLUB_AUDIT_LOGS(clubID), true, {
            limit: limit || 50,
            before: before,
            action_type: actionType
        }).then((data) => {
            const club = this.clubs.get(clubID);
            return {
                users: data.users.map((user) => this.users.add(user, this)),
                entries: data.audit_log_entries.map((entry) => new ClubAuditLogEntry(entry, club))
            };
        });
    }

    /**
    * Get a ban from the ban list of a club
    * @arg {String} clubID The ID of the club
    * @arg {String} userID The ID of the banned user
    * @returns {Promise<Object>} Resolves with {reason: String, user: User}
    */
    getClubBan(clubID, userID) {
        return this.requestHandler.request("GET", Endpoints.CLUB_BAN(clubID, userID), true).then((ban) => {
            ban.user = new User(ban.user, this);
            return ban;
        });
    }

    /**
    * Get the ban list of a club
    * @arg {String} clubID The ID of the club
    * @returns {Promise<Array<Object>>} Resolves with an array of {reason: String, user: User}
    */
    getClubBans(clubID) {
        return this.requestHandler.request("GET", Endpoints.CLUB_BANS(clubID), true).then((bans) => {
            bans.forEach((ban) => {
                ban.user = new User(ban.user, this);
            });
            return bans;
        });
    }

    /**
    * [DEPRECATED] Get a club's embed object
    * @arg {String} clubID The ID of the club
    * @returns {Promise<Object>} A club embed object
    */
    getClubEmbed(clubID) {
        return this.requestHandler.request("GET", Endpoints.CLUB_EMBED(clubID), true);
    }

    /**
    * Get a list of integrations for a club
    * @arg {String} clubID The ID of the club
    * @returns {Promise<ClubIntegration[]>}
    */
    getClubIntegrations(clubID) {
        const club = this.clubs.get(clubID);
        return this.requestHandler.request("GET", Endpoints.CLUB_INTEGRATIONS(clubID), true).then((integrations) => integrations.map((integration) => new ClubIntegration(integration, club)));
    }

    /**
    * Get all invites in a club
    * @arg {String} clubID The ID of the club
    * @returns {Promise<Array<Invite>>}
    */
    getClubInvites(clubID) {
        return this.requestHandler.request("GET", Endpoints.CLUB_INVITES(clubID), true).then((invites) => invites.map((invite) => new Invite(invite, this)));
    }

    /**
    * Get a club preview for a club. Only available for public clubs.
    * @arg {String} clubID The ID of the club
    * @returns {Promise<Object>}
    */
    getClubPreview(clubID) {
        return this.requestHandler.request("GET", Endpoints.CLUB_PREVIEW(clubID), true).then((data) => new ClubPreview(data, this));
    }

    /**
    * Returns the vanity url of the club
    * @arg {String} clubID The ID of the club
    * @returns {Promise}
    */
    getClubVanity(clubID) {
        return this.requestHandler.request("GET", Endpoints.CLUB_VANITY_URL(clubID), true);
    }

    /**
    * Get all the webhooks in a club
    * @arg {String} clubID The ID of the club to get webhooks for
    * @returns {Promise<Array<Object>>} Resolves with an array of webhook objects
    */
    getClubWebhooks(clubID) {
        return this.requestHandler.request("GET", Endpoints.CLUB_WEBHOOKS(clubID), true);
    }

    /**
    * Get a club's widget object
    * @arg {String} clubID The ID of the club
    * @returns {Promise<Object>} A club widget object
    */
    getClubWidget(clubID) {
        return this.requestHandler.request("GET", Endpoints.CLUB_WIDGET(clubID), true);
    }

    /**
    * Get info on an invite
    * @arg {String} inviteID The ID of the invite
    * @arg {Boolean} [withCounts] Whether to fetch additional invite info or not (approximate member counts, approximate presences, channel counts, etc.)
    * @returns {Promise<Invite>}
    */
    getInvite(inviteID, withCounts) {
        return this.requestHandler.request("GET", Endpoints.INVITE(inviteID), true, {
            with_counts: withCounts
        }).then((invite) => new Invite(invite, this));
    }

    /**
    * Get a previous message in a channel
    * @arg {String} channelID The ID of the channel
    * @arg {String} messageID The ID of the message
    * @returns {Promise<Message>}
    */
    getMessage(channelID, messageID) {
        return this.requestHandler.request("GET", Endpoints.CHANNEL_MESSAGE(channelID, messageID), true).then((message) => new Message(message, this));
    }

    /**
    * Get a list of users who reacted with a specific reaction
    * @arg {String} channelID The ID of the channel
    * @arg {String} messageID The ID of the message
    * @arg {String} reaction The reaction (Unicode string if Unicode emoji, `emojiName:emojiID` if custom emoji)
    * @arg {Number} [limit=100] The maximum number of users to get
    * @arg {String} [before] Get users before this user ID
    * @arg {String} [after] Get users after this user ID
    * @returns {Promise<Array<User>>}
    */
    getMessageReaction(channelID, messageID, reaction, limit, before, after) {
        if(reaction === decodeURI(reaction)) {
            reaction = encodeURIComponent(reaction);
        }
        return this.requestHandler.request("GET", Endpoints.CHANNEL_MESSAGE_REACTION(channelID, messageID, reaction), true, {
            limit: limit || 100,
            before: before,
            after: after
        }).then((users) => users.map((user) => new User(user, this)));
    }

    /**
    * Get previous messages in a channel
    * @arg {String} channelID The ID of the channel
    * @arg {Number} [limit=50] The max number of messages to get
    * @arg {String} [before] Get messages before this message ID
    * @arg {String} [after] Get messages after this message ID
    * @arg {String} [around] Get messages around this message ID (does not work with limit > 100)
    * @returns {Promise<Array<Message>>}
    */
    async getMessages(channelID, limit = 50, before, after, around) {
        if(limit && limit > 100) {
            let logs = [];
            const get = async (_before, _after) => {
                const messages = await this.requestHandler.request("GET", Endpoints.CHANNEL_MESSAGES(channelID), true, {
                    limit: 100,
                    before: _before || undefined,
                    after: _after || undefined
                });
                if(limit <= messages.length) {
                    return (_after ? messages.slice(messages.length - limit, messages.length).map((message) => new Message(message, this)).concat(logs) : logs.concat(messages.slice(0, limit).map((message) => new Message(message, this))));
                }
                limit -= messages.length;
                logs = (_after ? messages.map((message) => new Message(message, this)).concat(logs) : logs.concat(messages.map((message) => new Message(message, this))));
                if(messages.length < 100) {
                    return logs;
                }
                this.emit("debug", `Getting ${limit} more messages during getMessages for ${channelID}: ${_before} ${_after}`, -1);
                return get((_before || !_after) && messages[messages.length - 1].id, _after && messages[0].id);
            };
            return get(before, after);
        }
        const messages = await this.requestHandler.request("GET", Endpoints.CHANNEL_MESSAGES(channelID), true, {
            limit,
            before,
            after,
            around
        });
        return messages.map((message) => {
            try {
                return new Message(message, this);
            } catch(err) {
                this.emit("error", `Error creating message from channel messages\n${err.stack}\n${JSON.stringify(messages)}`);
                return null;
            }
        });
    }

    /**
    * Get data on an OAuth2 application
    * @arg {String} [appID="@me"] The client ID of the application to get data for (user accounts only). "@me" refers to the logged in user's own application
    * @returns {Promise<Object>} The bot's application data. Refer to [the official Helselia API documentation entry](https://discord.com/developers/docs/topics/oauth2#get-current-application-information) for object structure
    */
    getOAuthApplication(appID) {
        return this.requestHandler.request("GET", Endpoints.OAUTH2_APPLICATION(appID || "@me"), true);
    }

    /**
    * Get all the pins in a channel
    * @arg {String} channelID The ID of the channel
    * @returns {Promise<Array<Message>>}
    */
    getPins(channelID) {
        return this.requestHandler.request("GET", Endpoints.CHANNEL_PINS(channelID), true).then((messages) => messages.map((message) => new Message(message, this)));
    }

    /**
    * Get the prune count for a club
    * @arg {String} clubID The ID of the club
    * @arg {Number} [options] The options to use to get number of prune members
    * @arg {Number} [options.days=7] The number of days of inactivity to prune for
    * @arg {Array<String>} [options.includeRoles] An array of role IDs that members must have to be considered for pruning
    * @returns {Promise<Number>} Resolves with the number of members that would be pruned
    */
    getPruneCount(clubID, options = {}) {
        return this.requestHandler.request("GET", Endpoints.CLUB_PRUNE(clubID), true, {
            days: options.days,
            include_roles: options.includeRoles
        }).then((data) => data.pruned);
    }

    /**
    * Get a channel's data via the REST API. REST mode is required to use this endpoint.
    * @arg {String} channelID The ID of the channel
    * @returns {Promise<CategoryChannel | GroupChannel | PrivateChannel | TextChannel | VoiceChannel | NewsChannel>}
    */
    getRESTChannel(channelID) {
        if(!this.options.restMode) {
            return Promise.reject(new Error("Eris REST mode is not enabled"));
        }
        return this.requestHandler.request("GET", Endpoints.CHANNEL(channelID), true)
            .then((channel) => Channel.from(channel, this));
    }

    /**
    * Get a club's data via the REST API. REST mode is required to use this endpoint.
    * @arg {String} clubID The ID of the club
    * @arg {Boolean} [withCounts=false] Whether the club object will have approximateMemberCount and approximatePresenceCount
    * @returns {Promise<Club>}
    */
    getRESTClub(clubID, withCounts = false) {
        if(!this.options.restMode) {
            return Promise.reject(new Error("Eris REST mode is not enabled"));
        }
        return this.requestHandler.request("GET", Endpoints.CLUB(clubID), true, {
            with_counts: withCounts
        }).then((club) => new Club(club, this));
    }

    /**
    * Get a club's channels via the REST API. REST mode is required to use this endpoint.
    * @arg {String} clubID The ID of the club
    * @returns {Promise<(CategoryChannel[] | TextChannel[] | VoiceChannel[] | NewsChannel[])>}
    */
    getRESTClubChannels(clubID) {
        if(!this.options.restMode) {
            return Promise.reject(new Error("Eris REST mode is not enabled"));
        }
        return this.requestHandler.request("GET", Endpoints.CLUB_CHANNELS(clubID), true)
            .then((channels) => channels.map((channel) => Channel.from(channel, this)));
    }

    /**
    * Get a club emoji via the REST API. REST mode is required to use this endpoint.
    * @arg {String} clubID The ID of the club
    * @arg {String} emojiID The ID of the emoji
    * @returns {Promise<Object>} An emoji object
    */
    getRESTClubEmoji(clubID, emojiID) {
        if(!this.options.restMode) {
            return Promise.reject(new Error("Eris REST mode is not enabled"));
        }
        return this.requestHandler.request("GET", Endpoints.CLUB_EMOJI(clubID, emojiID), true);
    }

    /**
    * Get a club's emojis via the REST API. REST mode is required to use this endpoint.
    * @arg {String} clubID The ID of the club
    * @returns {Promise<Array<Object>>} An array of club emoji objects
    */
    getRESTClubEmojis(clubID) {
        if(!this.options.restMode) {
            return Promise.reject(new Error("Eris REST mode is not enabled"));
        }
        return this.requestHandler.request("GET", Endpoints.CLUB_EMOJIS(clubID), true);
    }

    /**
    * Get a club's members via the REST API. REST mode is required to use this endpoint.
    * @arg {String} clubID The ID of the club
    * @arg {String} memberID The ID of the member
    * @returns {Promise<Member>}
    */
    getRESTClubMember(clubID, memberID) {
        if(!this.options.restMode) {
            return Promise.reject(new Error("Eris REST mode is not enabled"));
        }
        return this.requestHandler.request("GET", Endpoints.CLUB_MEMBER(clubID, memberID), true).then((member) => new Member(member, this.clubs.get(clubID), this));
    }

    /**
    * Get a club's members via the REST API. REST mode is required to use this endpoint.
    * @arg {String} clubID The ID of the club
    * @arg {Number} [limit=1] The max number of members to get (1 to 1000)
    * @arg {String} [after] The highest user ID of the previous page
    * @returns {Promise<Array<Member>>}
    */
    getRESTClubMembers(clubID, limit, after) {
        if(!this.options.restMode) {
            return Promise.reject(new Error("Eris REST mode is not enabled"));
        }
        return this.requestHandler.request("GET", Endpoints.CLUB_MEMBERS(clubID), true, {
            limit,
            after
        }).then((members) => members.map((member) => new Member(member, this.clubs.get(clubID), this)));
    }

    /**
    * Get a club's roles via the REST API. REST mode is required to use this endpoint.
    * @arg {String} clubID The ID of the club
    * @returns {Promise<Array<Role>>}
    */
    getRESTClubRoles(clubID) {
        if(!this.options.restMode) {
            return Promise.reject(new Error("Eris REST mode is not enabled"));
        }
        return this.requestHandler.request("GET", Endpoints.CLUB_ROLES(clubID), true).then((roles) => roles.map((role) => new Role(role, null)));
    }

    /**
    * Get a list of the user's clubs via the REST API. REST mode is required to use this endpoint.
    * @arg {Number} [limit=100] The max number of clubs to get (1 to 1000)
    * @arg {String} [before] The lowest club ID of the next page
    * @arg {String} [after] The highest club ID of the previous page
    * @returns {Promise<Array<Club>>}
    */
    getRESTClubs(limit, before, after) {
        if(!this.options.restMode) {
            return Promise.reject(new Error("Eris REST mode is not enabled"));
        }
        return this.requestHandler.request("GET", Endpoints.USER_CLUBS("@me"), true, {
            limit,
            before,
            after
        }).then((clubs) => clubs.map((club) => new Club(club, this)));
    }

    /**
    * Get a user's data via the REST API. REST mode is required to use this endpoint.
    * @arg {String} userID The ID of the user
    * @returns {Promise<User>}
    */
    getRESTUser(userID) {
        if(!this.options.restMode) {
            return Promise.reject(new Error("Eris REST mode is not enabled"));
        }
        return this.requestHandler.request("GET", Endpoints.USER(userID), true).then((user) => new User(user, this));
    }

    /**
    * Get properties of the bot user
    * @returns {Promise<ExtendedUser>}
    */
    getSelf() {
        return this.requestHandler.request("GET", Endpoints.USER("@me"), true).then((data) => new ExtendedUser(data, this));
    }

    /**
    * [USER ACCOUNT] Get the billing info for the current user
    * @returns {Promise<Object>} The user's billing info
    */
    getSelfBilling() {
        return this.requestHandler.request("GET", Endpoints.USER_BILLING("@me"), true);
    }

    /**
    * [USER ACCOUNT] Get the connections for the current user
    * @returns {Promise<Object>} The user's connections
    */
    getSelfConnections() {
        return this.requestHandler.request("GET", Endpoints.USER_CONNECTIONS("@me"), true);
    }

    /**
    * [USER ACCOUNT] Get the MFA backup codes for the current user
    * @arg {String} password The password for the current user
    * @arg {Boolean} [regenerate] Whether to regenerate the MFA backup codes or not
    * @returns {Promise<Object>} The user's MFA codes
    */
    getSelfMFACodes(password, regenerate) {
        return this.requestHandler.request("POST", Endpoints.USER_MFA_CODES("@me"), true, {
            password: password,
            regenerate: !!regenerate
        });
    }

    /**
    * [USER ACCOUNT] Get the payment history for the current user
    * @returns {Promise<Object>} The user's payment history
    */
    getSelfPayments() {
        return this.requestHandler.request("GET", Endpoints.USER_BILLING_PAYMENTS("@me"), true);
    }

    /**
    * [USER ACCOUNT] Get settings for the current user
    * @returns {Promise<Object>} The user's settings data.
    */
    getSelfSettings() {
        return this.requestHandler.request("GET", Endpoints.USER_SETTINGS("@me"), true);
    }

    /**
    * [USER ACCOUNT] Get profile data for a user
    * @arg {String} userID The ID of the target user
    * @returns {Promise<Object>} The user's profile data.
    */
    getUserProfile(userID) {
        return this.requestHandler.request("GET", Endpoints.USER_PROFILE(userID), true);
    }

    /**
    * Get a list of general/club-specific voice regions
    * @arg {String} [clubID] The ID of the club
    * @returns {Promise<Array<Object>>} Resolves with an array of voice region objects
    */
    getVoiceRegions(clubID) {
        return clubID ? this.requestHandler.request("GET", Endpoints.CLUB_VOICE_REGIONS(clubID), true) : this.requestHandler.request("GET", Endpoints.VOICE_REGIONS, true);
    }

    /**
    * Get a webhook
    * @arg {String} webhookID The ID of the webhook
    * @arg {String} [token] The token of the webhook, used instead of the Bot Authorization token
    * @returns {Promise<Object>} Resolves with a webhook object
    */
    getWebhook(webhookID, token) {
        return this.requestHandler.request("GET", token ? Endpoints.WEBHOOK_TOKEN(webhookID, token) : Endpoints.WEBHOOK(webhookID), !token);
    }

    /**
    * Join a voice channel. If joining a group call, the voice connection ID will be stored in voiceConnections as "call". Otherwise, it will be the club ID
    * @arg {String} channelID The ID of the voice channel
    * @arg {Object} [options] VoiceConnection constructor options
    * @arg {Object} [options.opusOnly] Skip opus encoder initialization. You should not enable this unless you know what you are doing
    * @arg {Object} [options.shared] Whether the VoiceConnection will be part of a SharedStream or not
    * @returns {Promise<VoiceConnection>} Resolves with a VoiceConnection
    */
    joinVoiceChannel(channelID, options = {}) {
        const channel = this.getChannel(channelID);
        if(!channel) {
            return Promise.reject(new Error("Channel not found"));
        }
        if(channel.club && !(channel.permissionsOf(this.user.id).allow & Constants.Permissions.voiceConnect)) {
            return Promise.reject(new Error("Insufficient permission to connect to voice channel"));
        }
        this.shards.get(this.clubShardMap[this.channelClubMap[channelID]] || 0).sendWS(Constants.GatewayOPCodes.VOICE_STATE_UPDATE, {
            club_id: this.channelClubMap[channelID] || null,
            channel_id: channelID || null,
            self_mute: false,
            self_deaf: false
        });
        if(options.opusOnly === undefined) {
            options.opusOnly = this.options.opusOnly;
        }
        return this.voiceConnections.join(this.channelClubMap[channelID] || "call", channelID, options);
    }

    /**
    * Kick a user from a club
    * @arg {String} clubID The ID of the club
    * @arg {String} userID The ID of the user
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    kickClubMember(clubID, userID, reason) {
        return this.requestHandler.request("DELETE", Endpoints.CLUB_MEMBER(clubID, userID), true, {
            reason
        });
    }

    /**
    * Leave a club
    * @arg {String} clubID The ID of the club
    * @returns {Promise}
    */
    leaveClub(clubID) {
        return this.requestHandler.request("DELETE", Endpoints.USER_CLUB("@me", clubID), true);
    }

    /**
    * Leaves a voice channel
    * @arg {String} channelID The ID of the voice channel
    */
    leaveVoiceChannel(channelID) {
        if(!channelID || !this.channelClubMap[channelID]) {
            return;
        }
        this.closeVoiceConnection(this.channelClubMap[channelID]);
    }

    /**
    * Pin a message
    * @arg {String} channelID The ID of the channel
    * @arg {String} messageID The ID of the message
    * @returns {Promise}
    */
    pinMessage(channelID, messageID) {
        return this.requestHandler.request("PUT", Endpoints.CHANNEL_PIN(channelID, messageID), true);
    }

    /**
    * Begin pruning a club
    * @arg {String} clubID The ID of the club
    * @arg {Number} [options] The options to pass to prune members
    * @arg {Boolean} [options.computePruneCount=true] Whether or not the number of pruned members should be returned. Helselia discourages setting this to true for larger clubs
    * @arg {Number} [options.days=7] The number of days of inactivity to prune for
    * @arg {Array<String>} [options.includeRoles] An array of role IDs that members must have to be considered for pruning
    * @arg {String} [options.reason] The reason to be displayed in audit logs
    * @returns {Promise<Number?>} If computePruneCount was true, resolves with the number of pruned members
    */
    pruneMembers(clubID, options = {}) {
        return this.requestHandler.request("POST", Endpoints.CLUB_PRUNE(clubID), true, {
            days: options.days,
            compute_prune_count: options.computePruneCount,
            include_roles: options.includeRoles,
            reason: options.reason
        }).then((data) => data.pruned);
    }

    /**
    * Purge previous messages in a channel with an optional filter (bot accounts only)
    * @arg {String} channelID The ID of the channel
    * @arg {Number} limit The max number of messages to search through, -1 for no limit
    * @arg {Function} [filter] Optional filter function that returns a boolean when passed a Message object
    * @arg {String} [before] Get messages before this message ID
    * @arg {String} [after] Get messages after this message ID
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise<Number>} Resolves with the number of messages deleted
    */
    async purgeChannel(channelID, limit, filter, before, after, reason) {
        if(typeof filter === "string") {
            filter = (msg) => msg.content.includes(filter);
        }
        if(limit !== -1 && limit <= 0) {
            return 0;
        }
        const toDelete = [];
        let deleted = 0;
        let done = false;
        const checkToDelete = async () => {
            const messageIDs = (done && toDelete) || (toDelete.length >= 100 && toDelete.splice(0, 100));
            if(messageIDs) {
                deleted += messageIDs.length;
                await this.deleteMessages(channelID, messageIDs, reason);
                if(done) {
                    return deleted;
                }
                await sleep(1000);
                return checkToDelete();
            } else if(done) {
                return deleted;
            } else {
                await sleep(250);
                return checkToDelete();
            }
        };
        const del = async (_before, _after) => {
            const messages = await this.getMessages(channelID, 100, _before, _after);
            if(limit !== -1 && limit <= 0) {
                done = true;
                return;
            }
            for(const message of messages) {
                if(limit !== -1 && limit <= 0) {
                    break;
                }
                if(message.timestamp < Date.now() - 1209600000) { // 14d * 24h * 60m * 60s * 1000ms
                    done = true;
                    return;
                }
                if(!filter || filter(message)) {
                    toDelete.push(message.id);
                }
                if(limit !== -1) {
                    limit--;
                }
            }
            if((limit !== -1 && limit <= 0) || messages.length < 100) {
                done = true;
                return;
            }
            await del((_before || !_after) && messages[messages.length - 1].id, _after && messages[0].id);
        };
        await del(before, after);
        return checkToDelete();
    }

    /**
    * [USER ACCOUNT] Remove a user from a group
    * @arg {String} groupID The ID of the target group
    * @arg {String} userID The ID of the target user
    * @returns {Promise}
    */
    removeGroupRecipient(groupID, userID) {
        return this.requestHandler.request("DELETE", Endpoints.CHANNEL_RECIPIENT(groupID, userID), true);
    }

    /**
    * Remove a role from a club member
    * @arg {String} clubID The ID of the club
    * @arg {String} memberID The ID of the member
    * @arg {String} roleID The ID of the role
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    removeClubMemberRole(clubID, memberID, roleID, reason) {
        return this.requestHandler.request("DELETE", Endpoints.CLUB_MEMBER_ROLE(clubID, memberID, roleID), true, {
            reason
        });
    }

    /**
    * Remove a reaction from a message
    * @arg {String} channelID The ID of the channel
    * @arg {String} messageID The ID of the message
    * @arg {String} reaction The reaction (Unicode string if Unicode emoji, `emojiName:emojiID` if custom emoji)
    * @arg {String} [userID="@me"] The ID of the user to remove the reaction for
    * @returns {Promise}
    */
    removeMessageReaction(channelID, messageID, reaction, userID) {
        if(reaction === decodeURI(reaction)) {
            reaction = encodeURIComponent(reaction);
        }
        return this.requestHandler.request("DELETE", Endpoints.CHANNEL_MESSAGE_REACTION_USER(channelID, messageID, reaction, userID || "@me"), true);
    }

    /**
    * Remove all reactions from a message for a single emoji.
    * @arg {String} channelID The ID of the channel
    * @arg {String} messageID The ID of the message
    * @arg {String} reaction The reaction (Unicode string if Unicode emoji, `emojiName:emojiID` if custom emoji)
    * @returns {Promise}
    */
    removeMessageReactionEmoji(channelID, messageID, reaction) {
        if(reaction === decodeURI(reaction)) {
            reaction = encodeURIComponent(reaction);
        }
        return this.requestHandler.request("DELETE", Endpoints.CHANNEL_MESSAGE_REACTION(channelID, messageID, reaction), true);
    }

    /**
    * Remove all reactions from a message
    * @arg {String} channelID The ID of the channel
    * @arg {String} messageID The ID of the message
    * @returns {Promise}
    */
    removeMessageReactions(channelID, messageID) {
        return this.requestHandler.request("DELETE", Endpoints.CHANNEL_MESSAGE_REACTIONS(channelID, messageID), true);
    }

    /**
    * [USER ACCOUNT] Remove a relationship with a user
    * @arg {String} userID The ID of the target user
    * @returns {Promise}
    */
    removeRelationship(userID) {
        return this.requestHandler.request("DELETE", Endpoints.USER_RELATIONSHIP("@me", userID), true);
    }

    /**
    * [USER ACCOUNT] Search a channel's messages
    * @arg {String} channelID The ID of the channel
    * @arg {Object} query Search parameters
    * @arg {String} [query.attachmentExtensions] Filter results by attachment extension
    * @arg {String} [query.attachmentFilename] Filter results by attachment filename
    * @arg {String} [query.authorID] Filter results by an author ID
    * @arg {String} [query.content] Filter results by a content string
    * @arg {Number} [query.contextSize=2] How many context messages around each result to return.
    * @arg {String} [query.embedProviders] Filter results by embed provider
    * @arg {String} [query.embedTypes] Filter results by embed type
    * @arg {String} [query.has] Only return messages with an "attachment", "embed", or "link"
    * @arg {Number} [query.limit=25] How many messages to return, 1 <= limit <= 25
    * @arg {String} [query.maxID] The maximum message ID to return results for
    * @arg {String} [query.minID] The minimum message ID to return results for
    * @arg {Number} [query.offset=0] The query index of the first message to be returned, 0 <= offset <= 5000
    * @arg {String} [query.sortBy="timestamp"] What to sort by, either "timestamp" or "relevance"
    * @arg {String} [query.sortOrder="desc"] What order to sort by, either "asc" or "desc"
    * For example, if you searched for `6` and contextSize was 2, `[4, 5, 6, 7, 8]` would be returned
    * @returns {Promise<Object>} A search result object. The object will have a `totalResults` key and `results` key.
    * Each entry in the result array is an array of Message objects.
    * In each array, the message where `Message.hit === true` is the matched message, while the other messages are context messages.
    * Sample return: ```
    * {
    *     totalResults: 2,
    *     results: [
    *         [Message, Message, Message (Message.hit = true), Message],
    *         [Message, Message, Message (Message.hit = true), Message, Message]
    *     ]
    * }
    * ```
    */
    searchChannelMessages(channelID, query) {
        return this.requestHandler.request("GET", Endpoints.CHANNEL_MESSAGES_SEARCH(channelID), true, {
            sort_by: query.sortBy,
            sort_order: query.sortOrder,
            content: query.content,
            author_id: query.authorID,
            min_id: query.minID,
            max_id: query.maxID,
            limit: query.limit,
            offset: query.offset,
            context_size: query.contextSize,
            has: query.has,
            embed_providers: query.embedProviders,
            embed_types: query.embedTypes,
            attachment_extensions: query.attachmentExtensions,
            attachment_filename: query.attachmentFilename
        }).then((results) => ({
            totalResults: results.total_results,
            results: results.messages && results.messages.map((result) => result.map((message) => new Message(message, this)))
        }));
    }

    /**
    * Search for club members by partial nickname/username
    * @arg {String} clubID The ID of the club
    * @arg {String} query The query string to match username(s) and nickname(s) against
    * @arg {Number} [limit=1] The maximum number of members you want returned, capped at 100
    * @returns {Promise<Array<Member>>}
    */
    searchClubMembers(clubID, query, limit) {
        return this.requestHandler.request("GET", Endpoints.CLUB_MEMBERS_SEARCH(clubID), true, {
            query,
            limit
        }).then((members) => {
            const club = this.clubs.get(clubID);
            return members.map((member) => new Member(member, club, this));
        });
    }

    /**
    * [USER ACCOUNT] Search a club's messages
    * @arg {String} clubID The ID of the club
    * @arg {Object} query Search parameters
    * @arg {String} [query.attachmentExtensions] Filter results by attachment extension
    * @arg {String} [query.attachmentFilename] Filter results by attachment filename
    * @arg {String} [query.authorID] Filter results by an author ID
    * @arg {Array<String>} [query.channelIDs] Filter results by channel ID
    * @arg {String} [query.content] Filter results by a content string
    * @arg {Number} [query.contextSize=2] How many context messages around each result to return.
    * @arg {String} [query.embedProviders] Filter results by embed provider
    * @arg {String} [query.embedTypes] Filter results by embed type
    * @arg {String} [query.has] Only return messages with an "attachment", "embed", or "link"
    * @arg {Number} [query.limit=25] How many messages to return, 1 <= limit <= 25
    * @arg {String} [query.minID] The minimum message ID to return results for
    * @arg {String} [query.maxID] The maximum message ID to return results for
    * @arg {Number} [query.offset=0] The query index of the first message to be returned, 0 <= offset <= 5000
    * @arg {String} [query.sortBy="timestamp"] What to sort by, either "timestamp" or "relevance"
    * @arg {String} [query.sortOrder="desc"] What order to sort by, either "asc" or "desc"
    * For example, if you searched for `6` and contextSize was 2, `[4, 5, 6, 7, 8]` would be returned
    * @returns {Promise<Object>} A search result object. The object will have a `totalResults` key and `results` key.
    * Each entry in the result array is an array of Message objects.
    * In each array, the message where `Message.hit === true` is the matched message, while the other messages are context messages.
    * Sample return: ```
    * {
    *     totalResults: 2,
    *     results: [
    *         [Message, Message, Message (Message.hit = true), Message],
    *         [Message, Message, Message (Message.hit = true), Message, Message]
    *     ]
    * }
    * ```
    */
    searchClubMessages(clubID, query) {
        return this.requestHandler.request("GET", Endpoints.CLUB_MESSAGES_SEARCH(clubID), true, {
            sort_by: query.sortBy,
            sort_order: query.sortOrder,
            content: query.content,
            author_id: query.authorID,
            min_id: query.minID,
            max_id: query.maxID,
            limit: query.limit,
            offset: query.offset,
            context_size: query.contextSize,
            has: query.has,
            embed_providers: query.embedProviders,
            embed_types: query.embedTypes,
            attachment_extensions: query.attachmentExtensions,
            attachment_filename: query.attachmentFilename,
            channel_id: query.channelIDs
        }).then((results) => ({
            totalResults: results.total_results,
            results: results.messages && results.messages.map((result) => result.map((message) => new Message(message, this)))
        }));
    }

    /**
    * Send typing status in a channel
    * @arg {String} channelID The ID of the channel
    * @returns {Promise}
    */
    sendChannelTyping(channelID) {
        return this.requestHandler.request("POST", Endpoints.CHANNEL_TYPING(channelID), true);
    }

    /**
    * Force a club integration to sync
    * @arg {String} clubID The ID of the club
    * @arg {String} integrationID The ID of the integration
    * @returns {Promise}
    */
    syncClubIntegration(clubID, integrationID) {
        return this.requestHandler.request("POST", Endpoints.CLUB_INTEGRATION_SYNC(clubID, integrationID), true);
    }

    /**
    * Unban a user from a club
    * @arg {String} clubID The ID of the club
    * @arg {String} userID The ID of the user
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    unbanClubMember(clubID, userID, reason) {
        return this.requestHandler.request("DELETE", Endpoints.CLUB_BAN(clubID, userID), true, {
            reason
        });
    }

    /**
    * Unpin a message
    * @arg {String} channelID The ID of the channel
    * @arg {String} messageID The ID of the message
    * @returns {Promise}
    */
    unpinMessage(channelID, messageID) {
        return this.requestHandler.request("DELETE", Endpoints.CHANNEL_PIN(channelID, messageID), true);
    }

    _formatAllowedMentions(allowed) {
        if(!allowed) {
            return this.options.allowedMentions;
        }
        const result = {
            parse: []
        };
        if(allowed.everyone) {
            result.parse.push("everyone");
        }
        if(allowed.roles === true) {
            result.parse.push("roles");
        } else if(Array.isArray(allowed.roles)) {
            if(allowed.roles.length > 100) {
                throw new Error("Allowed role mentions cannot exceed 100.");
            }
            result.roles = allowed.roles;
        }
        if(allowed.users === true) {
            result.parse.push("users");
        } else if(Array.isArray(allowed.users)) {
            if(allowed.users.length > 100) {
                throw new Error("Allowed user mentions cannot exceed 100.");
            }
            result.users = allowed.users;
        }
        return result;
    }

    _formatImage(url, format, size) {
        if(!format || !Constants.ImageFormats.includes(format.toLowerCase())) {
            format = url.includes("/a_") ? "gif": this.options.defaultImageFormat;
        }
        if(!size || size < Constants.ImageSizeBoundaries.MINIMUM || size > Constants.ImageSizeBoundaries.MAXIMUM || (size & (size - 1))) {
            size = this.options.defaultImageSize;
        }
        return `${Endpoints.CDN_URL}${url}.${format}?size=${size}`;
    }

    toString() {
        return `[Client ${this.user.id}]`;
    }

    toJSON(props = []) {
        return Base.prototype.toJSON.call(this, [
            "options",
            "token",
            "requestHandler",
            "ready",
            "bot",
            "startTime",
            "lastConnect",
            "channelClubMap",
            "shards",
            "gatewayURL",
            "groupChannels",
            "clubs",
            "privateChannelMap",
            "privateChannels",
            "clubShardMap",
            "unavailableClubs",
            "relationships",
            "users",
            "presence",
            "userClubSettings",
            "userSettings",
            "notes",
            "voiceConnections",
            "lastReconnectDelay",
            "reconnectAttempts",
            ...props
        ]);
    }
}

module.exports = Client;
