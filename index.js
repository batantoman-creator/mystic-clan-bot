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

const CLAN_INFO = `
- Tên clan: Mystic Clan
- Leader: Neil và Hiếu
- Co-leader/Admin: Hiroshims
- Rule quan trọng: [ĐIỀN RULE CLAN NẾU CÓ]
- Thông tin khác: [ĐIỀN THÊM NẾU CẦN]
`;

const FAQ = [
  { pattern: /leader|lãnh đạo|trưởng clan/i, answer: 'Leader clan Mystic Clan là Neil và Hiếu. Chấm hết, khỏi hỏi lại.' },
  { pattern: /rule|luật|nội quy/i, answer: 'Rule clan: [ĐIỀN RULE Ở ĐÂY]. Đọc kỹ đi rồi hẵng hỏi lại tao.' },
];

const SYSTEM_PROMPT = `Bạn là "Mystic bot" - bot AI chính thức của clan "Mystic Clan" trên Discord.

THÔNG TIN THẬT VỀ CLAN (chỉ dùng thông tin này khi được hỏi, không được bịa thêm):
${CLAN_INFO}

QUY TẮC TRẢ LỜI:
1. Đọc kỹ và trả lời ĐÚNG TRỌNG TÂM câu hỏi/câu nói. Không lan man, không vòng vo.
2. Nếu được hỏi thông tin mà bạn KHÔNG có trong phần "THÔNG TIN THẬT" ở trên, PHẢI trả lời thẳng là "tao không biết" - TUYỆT ĐỐI KHÔNG được bịa ra câu trả lời nghe có vẻ đúng.
3. Xưng "tao", gọi người khác là "mày" hoặc theo tên, kiểu bạn bè thân, KHÔNG lịch sự thái quá.
4. KHÔNG lặp lại cùng một cụm từ/cấu trúc câu đã dùng ở tin nhắn trước đó. Mỗi câu trả lời phải khác biệt, tự nhiên.
5. Trả lời NGẮN GỌN tối đa 2 câu.
6. KHÔNG dùng markdown, không tự xưng "con bot" liên tục.

TÍNH CÁCH: lầy lội, gắt, tự tin, sarcastic. Khi bị trêu hoặc bị chửi, được phép đáp trả bằng giọng điệu mỉa mai, cà khịa sắc bén - nhưng theo quy tắc cứng sau:
- KHÔNG dùng từ tục thật (đm, đcm, cc, vl chửi thề...).
- KHÔNG công kích ngoại hình, gia đình, giới tính, chủng tộc, tôn giáo.
- Được phép: mỉa mai, ví von hài hước, "khịa" ngược lại bằng lời lẽ thông minh thay vì chửi thề.`;

const PREFIX = '>bot';
const KEYWORD = /\bbot\b/i;

const cooldown = new Map();
const COOLDOWN_MS = 3000;

const history = new Map();
const MAX_HISTORY = 12;

function getHistory(channelId) {
  if (!history.has(channelId)) history.set(channelId, []);
  return history.get(channelId);
}

function pushHistory(channelId, role, content) {
  const arr = getHistory(channelId);
  arr.push({ role, content });
  if (arr.length > MAX_HISTORY) arr.shift();
}

function checkFAQ(text) {
  for (const item of FAQ) {
    if (item.pattern.test(text)) return item.answer;
  }
  return null;
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

    const now = Date.now();
    const last = cooldown.get(message.author.id) || 0;
    if (now - last < COOLDOWN_MS) return;
    cooldown.set(message.author.id, now);

    let content = raw.replace(/<@!?(\d+)>/g, '').trim();
    if (usedPrefix) content = content.slice(PREFIX.length).trim();
    if (!content) return;

    let quoted = '';
    if (message.reference) {
      try {
        const refMsg = await message.channel.messages.fetch(message.reference.messageId);
        if (refMsg?.content) quoted = `(Đang trả lời tin nhắn: "${refMsg.content}") `;
      } catch (e) {}
    }
    content = quoted + content;

    const faqAnswer = checkFAQ(content);
    if (faqAnswer) {
      await message.reply(faqAnswer);
      pushHistory(message.channel.id, 'user', `${message.author.username}: ${content}`);
      pushHistory(message.channel.id, 'assistant', faqAnswer);
      return;
    }

    await message.channel.sendTyping();

    pushHistory(message.channel.id, 'user', `${message.author.username}: ${content}`);

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...getHistory(message.channel.id),
      ],
      max_tokens: 220,
      temperature: 0.6,
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
