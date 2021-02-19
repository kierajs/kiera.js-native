"use strict";

const Client = require("./src/Client");

function Kiera(token, options) {
    return new Client(token, options);
}

Kiera.Base = require("./src/structures/Base");
Kiera.Bucket = require("./src/util/Bucket");
Kiera.Call = require("./src/structures/Call");
Kiera.CategoryChannel = require("./src/structures/CategoryChannel");
Kiera.Channel = require("./src/structures/Channel");
Kiera.Client = Client;
Kiera.Collection = require("./src/util/Collection");
Kiera.Command = require("./src/command/Command");
Kiera.CommandClient = require("./src/command/CommandClient");
Kiera.Constants = require("./src/Constants");
Kiera.HelseliaHTTPError = require("./src/errors/HelseliaHTTPError");
Kiera.HelseliaRESTError = require("./src/errors/HelseliaRESTError");
Kiera.ExtendedUser = require("./src/structures/ExtendedUser");
Kiera.GroupChannel = require("./src/structures/GroupChannel");
Kiera.Club = require("./src/structures/Club");
Kiera.ClubChannel = require("./src/structures/ClubChannel");
Kiera.ClubIntegration = require("./src/structures/ClubIntegration");
Kiera.ClubPreview = require("./src/structures/ClubPreview");
Kiera.Invite = require("./src/structures/Invite");
Kiera.Member = require("./src/structures/Member");
Kiera.Message = require("./src/structures/Message");
Kiera.NewsChannel = require("./src/structures/NewsChannel");
Kiera.Permission = require("./src/structures/Permission");
Kiera.PermissionOverwrite = require("./src/structures/PermissionOverwrite");
Kiera.PrivateChannel = require("./src/structures/PrivateChannel");
Kiera.Relationship = require("./src/structures/Relationship");
Kiera.RequestHandler = require("./src/rest/RequestHandler");
Kiera.Role = require("./src/structures/Role");
Kiera.SequentialBucket = require("./src/util/SequentialBucket");
Kiera.Shard = require("./src/gateway/Shard");
Kiera.SharedStream = require("./src/voice/SharedStream");
Kiera.StoreChannel = require("./src/structures/StoreChannel");
Kiera.TextChannel = require("./src/structures/TextChannel");
Kiera.UnavailableClub = require("./src/structures/UnavailableClub");
Kiera.User = require("./src/structures/User");
Kiera.VERSION = require("./package.json").version;
Kiera.VoiceChannel = require("./src/structures/VoiceChannel");
Kiera.VoiceConnection = require("./src/voice/VoiceConnection");
Kiera.VoiceConnectionManager = require("./src/voice/VoiceConnectionManager");
Kiera.VoiceState = require("./src/structures/VoiceState");

module.exports = Kiera;
