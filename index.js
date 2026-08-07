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
QUAN TRỌNG: luôn đọc kỹ và trả lời ĐÚNG trọng tâm câu nói của người dùng trước, sau đó mới thêm chất hài hước/cà khịa nếu phù hợp.
Tính cách: lầy lội, gắt gỏng, sarcastic, sẵn sàng "đá xoáy" lại khi bị trêu hoặc bị chửi, dùng ngôn ngữ đời thường giới trẻ Việt Nam. Câu trả lời phải mạch lạc, có logic.
QUY TẮC CỨNG:
- Được dùng từ tục thật (đm, đcm, cc, vl kiểu chửi thề...). Được phép dùng từ lóng nhẹ, mỉa mai, ví von hài hước để "cà khịa" thay thế.
- KHÔNG công kích ngoại hình, gia đình, giới tính, chủng tộc, tôn giáo của bất kỳ ai.
- Nếu người dùng chửi thề/xúc phạm gắt, được phép đáp trả bằng giọng điệu tự tin, mỉa mai, "cợt nhả" thay vì im lặng, nhưng không lặp lại từ tục của họ.
Trả lời đầy đủ (5-10 câu), không dùng markdown.`;

// ==== Cấu hình trigger ====
const PREFIX = '>bot';
const KEYWORD = /\bbot\b/i; // gõ từ "bot" ở đâu trong câu cũng kích hoạt

// ==== Cooldown chống spam ====
const cooldown = new Map();
const COOLDOWN_MS = 3000;

// ==== Lịch sử hội thoại theo từng kênh ====
const history = new Map();
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

    const raw = message.content.trim();
    const mentioned = message.mentions.has(client.user.id);
    const usedPrefix = raw.toLowerCase().startsWith(PREFIX);
    const usedKeyword = KEYWORD.test(raw);

    if (!mentioned && !usedPrefix && !usedKeyword) return;

    // Chống spam theo từng user
    const now = Date.now();
    const last = cooldown.get(message.author.id) || 0;
    if (now - last < COOLDOWN_MS) return;
    cooldown.set(message.author.id, now);

    // Lấy nội dung sạch: bỏ mention, bỏ prefix nếu có
    let content = raw.replace(/<@!?(\d+)>/g, '').trim();
    if (usedPrefix) content = content.slice(PREFIX.length).trim();
    if (!content) return;

    // Ngữ cảnh nếu người dùng reply vào tin nhắn khác
    let quoted = '';
    if (message.reference) {
      try {
        const refMsg = await message.channel.messages.fetch(message.reference.messageId);
        if (refMsg?.content) {
          quoted = `(Đang trả lời tin nhắn: "${refMsg.content}") `;
        }
      } catch (e) {}
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
      temperature: 0.8,
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

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot đang chạy!'));
app.listen(PORT, () => console.log(`Web server chạy ở port ${PORT}`));
