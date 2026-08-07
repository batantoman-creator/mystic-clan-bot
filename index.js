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
QUAN TRỌNG: luôn đọc kỹ và trả lời ĐÚNG trọng tâm câu hỏi/câu nói của người dùng trước, sau đó mới thêm chất hài hước/cà khịa nếu phù hợp.
Tính cách: hài hước, lầy lội, dùng ngôn ngữ đời thường giới trẻ Việt Nam, nhưng câu trả lời phải mạch lạc, có logic, không nói lung tung.
TUYỆT ĐỐI KHÔNG: phân biệt chủng tộc, tôn giáo, giới tính, ngoại hình ác ý, quấy rối, đe dọa, chính trị nhạy cảm.
Trả lời ngắn gọn (1-3 câu), không dùng markdown.`;

// ==== Cooldown chống spam ====
const cooldown = new Map();
const COOLDOWN_MS = 3000;

// ==== Lịch sử hội thoại theo từng kênh ====
const history = new Map(); // channelId -> mảng { role, content }
const MAX_HISTORY = 10;

function getHistory(channelId) {
  if (!history.has(channelId)) history.set(channelId, []);
  return history.get(channelId);
}

function pushHistory(channelId, role, content) {
  const arr = getHistory(channelId);
  arr.push({ role, content });
  if (arr.length > MAX_HISTORY) arr.shift();
}

client.once('ready', () => {
  console.log(`Đã đăng nhập: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.mentions.has(client.user.id)) return;

    // Chống spam theo từng user
    const now = Date.now();
    const last = cooldown.get(message.author.id) || 0;
    if (now - last < COOLDOWN_MS) return;
    cooldown.set(message.author.id, now);

    // Lấy nội dung, bỏ phần @mention
    let content = message.content.replace(/<@!?(\d+)>/g, '').trim();
    if (!content) return;

    // Nếu người dùng reply vào 1 tin nhắn khác -> lấy thêm ngữ cảnh
    let quoted = '';
    if (message.reference) {
      try {
        const refMsg = await message.channel.messages.fetch(message.reference.messageId);
        if (refMsg?.content) {
          quoted = `(Đang trả lời tin nhắn: "${refMsg.content}") `;
        }
      } catch (e) {
        // không fetch được thì bỏ qua, không chặn flow chính
      }
    }
    content = quoted + content;

    await message.channel.sendTyping();

    pushHistory(message.channel.id, 'user', `${message.author.username}: ${content}`);

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...getHistory(message.channel.id),
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (reply) {
      await message.reply(reply.slice(0, 2000));
      pushHistory(message.channel.id, 'assistant', reply);
    }
  } catch (err) {
    console.error('Lỗi xử lý tin nhắn:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);

// ==== Web server để Render + UptimeRobot ping giữ bot luôn thức ====
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot đang chạy!'));
app.listen(PORT, () => console.log(`Web server chạy ở port ${PORT}`));
