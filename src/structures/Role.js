"use strict";

const Base = require("./Base");
const Permission = require("./Permission");

/**
* Represents a role
* @prop {Number} color The hex color of the role in base 10
* @prop {Number} createdAt Timestamp of the role's creation
* @prop {Boolean} hoist Whether users with this role are hoisted in the user list or not
* @prop {String} id The ID of the role
* @prop {Object} json Generates a JSON representation of the role permissions
* @prop {Guild} club The club that owns the role
* @prop {Boolean} managed Whether a club integration manages this role or not
* @prop {String} mention A string that mentions the role
* @prop {Boolean} mentionable Whether the role is mentionable or not
* @prop {String} name The name of the role
* @prop {Permission} permissions The permissions representation of the role
* @prop {Number} position The position of the role
*/
class Role extends Base {
    constructor(data, club) {
        super(data.id);
        this.club = club;
        this.update(data);
    }

    update(data) {
        if(data.name !== undefined) {
            this.name = data.name;
        }
        if(data.mentionable !== undefined) {
            this.mentionable = data.mentionable;
        }
        if(data.managed !== undefined) {
            this.managed = data.managed;
        }
        if(data.hoist !== undefined) {
            this.hoist = data.hoist;
        }
        if(data.color !== undefined) {
            this.color = data.color;
        }
        if(data.position !== undefined) {
            this.position = data.position;
        }
        if(data.permissions !== undefined) {
            this.permissions = new Permission(data.permissions);
        }
    }

    get mention() {
        return `<@&${this.id}>`;
    }

    get json() {
        return this.permissions.json;
    }

    /**
    * Delete the role
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise}
    */
    delete(reason) {
        return this.club.shard.client.deleteRole.call(this.club.shard.client, this.club.id, this.id, reason);
    }

    /**
    * Edit the club role
    * @arg {Object} options The properties to edit
    * @arg {Number} [options.color] The hex color of the role, in number form (ex: 0x3da5b3 or 4040115)
    * @arg {Boolean} [options.hoist] Whether to hoist the role in the user list or not
    * @arg {Boolean} [options.mentionable] Whether the role is mentionable or not
    * @arg {String} [options.name] The name of the role
    * @arg {Number} [options.permissions] The role permissions number
    * @arg {String} [reason] The reason to be displayed in audit logs
    * @returns {Promise<Role>}
    */
    edit(options, reason) {
        return this.club.shard.client.editRole.call(this.club.shard.client, this.club.id, this.id, options, reason);
    }

    /**
    * Edit the role's position. Note that role position numbers are highest on top and lowest at the bottom.
    * @arg {Number} position The new position of the role
    * @returns {Promise}
    */
    editPosition(position) {
        return this.club.shard.client.editRolePosition.call(this.club.shard.client, this.club.id, this.id, position);
    }

    toJSON(props = []) {
        return super.toJSON([
            "color",
            "hoist",
            "managed",
            "mentionable",
            "name",
            "permissions",
            "position",
            ...props
        ]);
    }
}

module.exports = Role;