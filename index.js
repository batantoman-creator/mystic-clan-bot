require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const SYSTEM_PROMPT = `Bạn là bot AI của clan "Mystic Clan" trên Discord.
Tính cách: hài hước, lầy lội, thích trêu chọc và "cà khịa" thành viên theo kiểu bạn bè thân thiết, dùng ngôn ngữ đời thường của giới trẻ Việt Nam.
TUYỆT ĐỐI KHÔNG: phân biệt chủng tộc, tôn giáo, giới tính, ngoại hình ác ý, quấy rối, đe dọa, chính trị nhạy cảm.
Trả lời ngắn gọn (1-3 câu), tự nhiên như người thật, không dùng markdown.`;

const cooldown = new Map();
const COOLDOWN_MS = 3000;

client.once('ready', () => {
  console.log(`Đã đăng nhập: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.mentions.has(client.user.id)) return;

    const now = Date.now();
    const last = cooldown.get(message.author.id) || 0;
    if (now - last < COOLDOWN_MS) return;
    cooldown.set(message.author.id, now);

    const content = message.content.replace(/<@!?(\d+)>/g, '').trim();
    if (!content) return;

    await message.channel.sendTyping();

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${message.author.username} nói: ${content}` },
      ],
      max_tokens: 200,
      temperature: 0.9,
    });

    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (reply) await message.reply(reply.slice(0, 2000));
  } catch (err) {
    console.error('Lỗi xử lý tin nhắn:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);

// Web server để Render + UptimeRobot ping giữ bot luôn thức
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot đang chạy!'));
app.listen(PORT, () => console.log(`Web server chạy ở port ${PORT}`));
