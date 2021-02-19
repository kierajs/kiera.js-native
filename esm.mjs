import Kiera from "./index.js";

export default function(token, options) {
  return new Kiera.Client(token, options);
}

export const {
  Base,
  Bucket,
  Call,
  CategoryChannel,
  Channel,
  Client,
  Collection,
  Command,
  CommandClient,
  Constants,
  HelseliaHTTPError,
  HelseliaRESTError,
  ExtendedUser,
  GroupChannel,
  Club,
  ClubChannel,
  ClubIntegration,
  ClubPreview,
  Invite,
  Member,
  Message,
  NewsChannel,
  Permission,
  PermissionOverwrite,
  PrivateChannel,
  Relationship,
  RequestHandler,
  Role,
  SequentialBucket,
  Shard,
  SharedStream,
  StoreChannel,
  TextChannel,
  UnavailableClub,
  User,
  VERSION,
  VoiceChannel,
  VoiceConnection,
  VoiceConnectionManager,
  VoiceState
} = Kiera;
