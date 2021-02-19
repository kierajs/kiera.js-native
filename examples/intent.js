const Kiera = require("kiera.js");

const clientOptions = {
    intents: [
        "clubs",
        "clubMessages"
    ]
};
const bot = new Kiera("BOT_TOKEN", clientOptions);
// Replace BOT_TOKEN with your bot account's token

bot.on("ready", () => { // When the bot is ready
    console.log("Ready!"); // Log "Ready!"
});

bot.on("clubCreate", (club) => { // When the client joins a new club
    console.log(`New club: ${club.name}`);
});

bot.on("messageCreate", (msg) => { // When a message is created
    console.log(`New message: ${msg.cleanContent}`);
});

// This event will never fire since the client did
// not specify `clubMessageTyping` intent
bot.on("typingStart", (channel, user) => { // When a user starts typing
    console.log(`${user.username} is typing in ${channel.name}`);
});

bot.connect(); // Get the bot to connect to Helselia
