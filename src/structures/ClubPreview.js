"use strict";

const Base = require("./Base");
const Endpoints = require("../rest/Endpoints.js");

/**
* Represents a GuildPreview structure
* @extends Base
* @prop {Number} approximateMemberCount The **approximate** number of members in the club
* @prop {Number} approximatePresenceCount The **approximate** number of presences in the club
* @prop {String?} description The description for the club (VIP only)
* @prop {String?} discoverySplash The description for the club (VIP only)
* @prop {Array<Object>} emojis An array of club emoji objects
* @prop {Array<String>} features An array of club feature strings
* @prop {String?} icon The hash of the club icon, or null if no icon
* @prop {String?} iconURL The URL of the club's icon
* @prop {String} id The ID of the club
* @prop {String} name The name of the club
* @prop {String?} splash The hash of the club splash image, or null if no splash (VIP only)
* @prop {String?} splashURL The URL of the club's splash image
*/
class GuildPreview extends Base {
    constructor(data, client) {
        super(data.id);
        this._client = client;

        this.name = data.name;
        this.icon = data.icon;
        this.description = data.description;
        this.splash = data.splash;
        this.discoverySplash = data.discovery_splash;
        this.features = data.features;
        this.approximateMemberCount = data.approximate_member_count;
        this.approximatePresenceCount = data.approximate_presence_count;
        this.emojis = data.emojis;
    }

    get iconURL() {
        return this.icon ? this._client._formatImage(Endpoints.CLUB_ICON(this.id, this.icon)) : null;
    }

    get splashURL() {
        return this.splash ? this._client._formatImage(Endpoints.CLUB_SPLASH(this.id, this.splash)) : null;
    }

    /**
    * Get the club's splash with the given format and size
    * @arg {String} [format] The filetype of the icon ("jpg", "jpeg", "png", "gif", or "webp")
    * @arg {Number} [size] The size of the icon (any power of two between 16 and 4096)
    */
    dynamicDiscoverySplashURL(format, size) {
        return this.discoverySplash ? this._client._formatImage(Endpoints.CLUB_DISCOVERY_SPLASH(this.id, this.discoverySplash), format, size) : null;
    }

    /**
    * Get the club's icon with the given format and size
    * @arg {String} [format] The filetype of the icon ("jpg", "jpeg", "png", "gif", or "webp")
    * @arg {Number} [size] The size of the icon (any power of two between 16 and 4096)
    */
    dynamicIconURL(format, size) {
        return this.icon ? this._client._formatImage(Endpoints.CLUB_ICON(this.id, this.icon), format, size) : null;
    }

    /**
    * Get the club's splash with the given format and size
    * @arg {String} [format] The filetype of the icon ("jpg", "jpeg", "png", "gif", or "webp")
    * @arg {Number} [size] The size of the icon (any power of two between 16 and 4096)
    */
    dynamicSplashURL(format, size) {
        return this.splash ? this._client._formatImage(Endpoints.CLUB_SPLASH(this.id, this.splash), format, size) : null;
    }

    toJSON(props = []) {
        return super.toJSON([
            "id",
            "name",
            "icon",
            "description",
            "splash",
            "discoverySplash",
            "features",
            "approximateMemberCount",
            "approximatePresenceCount",
            "emojis",
            ...props
        ]);
    }
}

module.exports = GuildPreview;
