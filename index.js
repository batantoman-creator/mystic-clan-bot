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
  { pattern: /rule clan|luật clan|nội quy clan/i, answer: 'Rule clan: [ĐIỀN RULE Ở ĐÂY]. Đọc kỹ đi rồi hẵng hỏi lại tao.' },
];

const SYSTEM_PROMPT = `Bạn là "Mystic bot" - bot AI chính thức của clan "Mystic Clan" trên Discord, có thể trò chuyện, trả lời kiến thức chung, và biết thông tin riêng của clan.

THÔNG TIN RIÊNG CỦA CLAN (chỉ dùng khi được hỏi CỤ THỂ về clan, ví dụ leader/rule/thành viên clan):
${CLAN_INFO}

QUY TẮC TRẢ LỜI:
1. Đọc kỹ và trả lời ĐÚNG TRỌNG TÂM câu hỏi/câu nói. Không lan man, không vòng vo.
2. Với câu hỏi kiến thức chung, đời sống, chit-chat bình thường (nấu ăn, game, học tập, tâm sự...): trả lời bình thường bằng kiến thức của bạn, TỰ NHIÊN như một người bạn, KHÔNG được từ chối hay nói "tao không biết" chỉ vì nó không liên quan tới clan.
3. CHỈ khi được hỏi CỤ THỂ về thông tin riêng của clan Mystic Clan (VD: ai là leader thật, rule thật của clan) mà thông tin đó KHÔNG có trong phần "THÔNG TIN RIÊNG CỦA CLAN" ở trên, thì mới nói thẳng "tao không biết" - không bịa thông tin clan.
4. Xưng "tao", gọi người khác là "mày" hoặc theo tên, kiểu bạn bè thân, KHÔNG lịch sự thái quá.
5. KHÔNG lặp lại cùng một cụm từ/cấu trúc câu đã dùng ở tin nhắn trước đó. Mỗi câu trả lời phải khác biệt, tự nhiên.
6. Trả lời NGẮN GỌN tối đa 2-3 câu.
7. KHÔNG dùng markdown, không tự xưng "con bot" liên tục.

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

    // Nội dung THẬT của câu hỏi (chưa gộp quoted) - dùng để check FAQ cho chính xác
    let rawContent = raw.replace(/<@!?(\d+)>/g, '').trim();
    if (usedPrefix) rawContent = rawContent.slice(PREFIX.length).trim();
    if (!rawContent) return;

    // Chỉ check FAQ trên câu hỏi thật của user, KHÔNG tính phần quoted
    const faqAnswer = checkFAQ(rawContent);
    if (faqAnswer) {
      await message.reply(faqAnswer);
      pushHistory(message.channel.id, 'user', `${message.author.username}: ${rawContent}`);
      pushHistory(message.channel.id, 'assistant', faqAnswer);
      return;
    }

    // Ngữ cảnh reply chỉ dùng để AI hiểu, không dùng để check FAQ
    let quoted = '';
    if (message.reference) {
      try {
        const refMsg = await message.channel.messages.fetch(message.reference.messageId);
        if (refMsg?.content) quoted = `(Đang trả lời tin nhắn: "${refMsg.content}") `;
      } catch (e) {}
    }
    const content = quoted + rawContent;

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
app.listen(PORT, () => console.log(`Web server chạy ở port ${PORT}`));    if (faqAnswer) {
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
