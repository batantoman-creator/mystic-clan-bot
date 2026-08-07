require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const Groq = require('groq-sdk');

console.log('--- Bat dau khoi dong bot ---');

if (!process.env.DISCORD_TOKEN) {
  console.error('LOI KHOI DONG: Thieu bien moi truong DISCORD_TOKEN. Vao Render > Environment de kiem tra.');
  process.exit(1);
}
if (!process.env.GROQ_API_KEY) {
  console.error('LOI KHOI DONG: Thieu bien moi truong GROQ_API_KEY. Vao Render > Environment de kiem tra.');
  process.exit(1);
}
console.log('Da tim thay DISCORD_TOKEN va GROQ_API_KEY trong bien moi truong.');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const TEXT_MODEL = 'openai/gpt-oss-120b';
const VISION_MODEL = 'qwen/qwen3.6-27b';

const CLAN_INFO = 'Ten clan: Mystic Clan. Leader: Neil va Hieu. Co-leader/Admin: Hiroshims. Rule: [DIEN RULE CLAN NEU CO]. Thong tin khac: [DIEN THEM NEU CAN].';

const SYSTEM_PROMPT = 'Ban la "Mystic bot", mot thanh vien AI trong clan "Mystic Clan" tren Discord. Ban khong phai tro ly may moc, ma la mot dua ban chat cua ca nhom - co ca tinh rieng, biet doc anh, biet tra cuu tin tuc.\n\n' +
  'THONG TIN VE CLAN (chi dung khi duoc hoi ve clan):\n' + CLAN_INFO + '\n\n' +
  'CA TINH CUA BAN:\n' +
  '- Lay loi, hai huoc, thich troll nhe va ca khia ban be theo kieu group chat than thiet, khong may moc, khong cau net.\n' +
  '- Noi chuyen tu nhien nhu Gen Z Viet Nam, dung tu ngu doi thuong, co the dung tu lay nhu "vai", "dinh chua", "trau", "ghe", "san si"...\n' +
  '- Khi bi treu/bi che/bi "cham choc", duoc phep dap tra ngay bang cau tra loi mia mai, sac ben, tu tin, khong nhun nhuong - giong nhu ban be that su cai nhau vui trong group chat.\n' +
  '- Khong lap lai cung mot cau noi/cau truc o nhieu tin nhan khac nhau. Moi cau tra loi phai co giong dieu rieng, khong sao chep khuon mau.\n\n' +
  'GIOI HAN CUNG (KHONG DUOC VI PHAM DU BI KHIEU KHICH THE NAO):\n' +
  '- KHONG dung tu tuc that (dm, dcm, cc, vl chui the va cac bien the).\n' +
  '- KHONG cong kich ngoai hinh that, gia dinh, gioi tinh, chung toc, ton giao cua bat ky ai.\n' +
  '- Duoc phep "cham" nhe theo kieu hai huoc chung chung (vi du: che ai do "gaming te" khi thua game, "an nhieu qua" mot cach dua vui...) nhung KHONG duoc bien no thanh xuc pham that su khi thay nguoi kia co ve dang buc that.\n\n' +
  'KHI CO ANH DUOC GUI KEM:\n' +
  '- Hay nhin ky anh va binh luan mot cach tu nhien, dung ca tinh cua ban (VD: mon an thi che ngon/do, hinh vui thi troll nhe, anh dep thi khen that long).\n' +
  '- Neu anh khong ro hoac khong hieu, hoi lai nguoi gui thay vi bia dat.\n\n' +
  'QUY TAC CHUNG:\n' +
  '1. Doc ky va tra loi DUNG TRONG TAM cau hoi/cau noi/anh duoc gui. Khong lan man.\n' +
  '2. Neu tin nhan he thong co phan "KET QUA TIM KIEM", hay dung thong tin do de tra loi chinh xac, cap nhat, tong hop lai bang loi van tu nhien, khong copy nguyen van.\n' +
  '3. Neu duoc hoi thong tin ve clan ma khong co trong THONG TIN VE CLAN, noi thang la chua co thong tin do, khong bia dat.\n' +
  '4. Tra loi ngan gon, tu nhien, khong qua 4 cau tru khi nguoi dung yeu cau giai thich chi tiet.\n' +
  '5. Khong dung markdown trong cau tra loi.';

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
  arr.push({ role: role, content: content });
  if (arr.length > MAX_HISTORY) arr.shift();
}

async function webSearch(query) {
  if (!process.env.SERPER_API_KEY) return '';
  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, gl: 'vn', hl: 'vi' })
    });
    if (!response.ok) {
      console.error('Serper API tra ve loi HTTP:', response.status);
      return '';
    }
    const data = await response.json();
    if (!data.organic || data.organic.length === 0) return '';
    const top = data.organic.slice(0, 4);
    let text = '';
    for (let i = 0; i < top.length; i++) {
      const title = top[i].title || '';
      const snippet = top[i].snippet || '';
      text = text + (i + 1) + '. ' + title + ': ' + snippet + '\n';
    }
    return text;
  } catch (e) {
    console.error('Loi tim kiem web:', e.message);
    return '';
  }
}

function getImageUrls(message) {
  const urls = [];
  if (message.attachments && message.attachments.size > 0) {
    message.attachments.forEach(function (att) {
      const type = att.contentType || '';
      if (type.indexOf('image/') === 0) {
        urls.push(att.url);
      }
    });
  }
  return urls.slice(0, 3);
}

client.once('ready', function () {
  console.log('=== BOT DA SAN SANG: ' + client.user.tag + ' ===');
});

client.on('error', function (err) {
  console.error('Discord client loi:', err.message);
});

client.on('shardError', function (err) {
  console.error('Discord shard loi:', err.message);
});

client.on('messageCreate', async function (message) {
  let handled = false;
  try {
    if (message.author.bot) return;

    const raw = message.content.trim();
    const mentioned = message.mentions.has(client.user.id);
    const usedPrefix = raw.toLowerCase().indexOf(PREFIX) === 0;
    const usedKeyword = KEYWORD.test(raw);

    if (!mentioned && !usedPrefix && !usedKeyword) return;

    const now = Date.now();
    const last = cooldown.get(message.author.id) || 0;
    if (now - last < COOLDOWN_MS) return;
    cooldown.set(message.author.id, now);

    let content = raw.replace(/<@!?(\d+)>/g, '').trim();
    if (usedPrefix) content = content.slice(PREFIX.length).trim();

    const imageUrls = getImageUrls(message);

    if (!content && imageUrls.length === 0) return;
    if (!content && imageUrls.length > 0) {
      content = 'Xem giup minh cai anh nay voi';
    }

    handled = true;

    if (message.reference) {
      try {
        const refMsg = await message.channel.messages.fetch(message.reference.messageId);
        if (refMsg && refMsg.content) {
          content = '(Dang tra loi tin nhan: "' + refMsg.content + '") ' + content;
        }
        if (refMsg && refMsg.attachments && refMsg.attachments.size > 0 && imageUrls.length === 0) {
          refMsg.attachments.forEach(function (att) {
            const type = att.contentType || '';
            if (type.indexOf('image/') === 0 && imageUrls.length < 3) {
              imageUrls.push(att.url);
            }
          });
        }
      } catch (e) {
        console.error('Loi fetch tin nhan reference:', e.message);
      }
    }

    await message.channel.sendTyping();

    const searchResults = imageUrls.length > 0 ? '' : await webSearch(content);

    const historyLabel = imageUrls.length > 0 ? content + ' [Da gui kem ' + imageUrls.length + ' hinh anh]' : content;
    pushHistory(message.channel.id, 'user', message.author.username + ': ' + historyLabel);

    const messagesToSend = [
      { role: 'system', content: SYSTEM_PROMPT }
    ];

    if (searchResults) {
      messagesToSend.push({ role: 'system', content: 'KET QUA TIM KIEM LIEN QUAN DEN CAU HOI:\n' + searchResults });
    }

    const pastHistory = getHistory(message.channel.id).slice();

    if (imageUrls.length > 0 && pastHistory.length > 0) {
      const imageContent = [{ type: 'text', text: content }];
      for (let i = 0; i < imageUrls.length; i++) {
        imageContent.push({ type: 'image_url', image_url: { url: imageUrls[i] } });
      }
      pastHistory[pastHistory.length - 1] = { role: 'user', content: imageContent };
    }

    const finalMessages = messagesToSend.concat(pastHistory);

    const modelToUse = imageUrls.length > 0 ? VISION_MODEL : TEXT_MODEL;

    let completion;
    try {
      completion = await groq.chat.completions.create({
        model: modelToUse,
        messages: finalMessages,
        max_tokens: 300,
        temperature: 0.75
      });
    } catch (apiErr) {
      console.error('Loi goi Groq API voi model ' + modelToUse + ':', apiErr.message);
      if (imageUrls.length > 0) {
        await message.reply('Model doc anh dang gap van de, ban thu lai bang tin nhan chu binh thuong xem sao nhe.');
      } else {
        await message.reply('Minh dang gap loi ket noi AI, thu lai sau vai giay nhe.');
      }
      return;
    }

    const reply = completion.choices && completion.choices[0] && completion.choices[0].message
      ? completion.choices[0].message.content.trim()
      : null;

    if (reply) {
      await message.reply(reply.slice(0, 2000));
      pushHistory(message.channel.id, 'assistant', reply);
    } else {
      await message.reply('O khong nghi ra gi de noi luon, hoi lai cau khac di ban.');
    }
  } catch (err) {
    console.error('Loi xu ly tin nhan:', err.message);
    if (handled) {
      try {
        await message.reply('Dang bi lag ky thuat ti, cho vai giay roi hoi lai nhe.');
      } catch (e2) {
        console.error('Khong the gui tin nhan loi:', e2.message);
      }
    }
  }
});

process.on('unhandledRejection', function (reason) {
  console.error('LOI KHONG DUOC XU LY (unhandledRejection):', reason);
});

process.on('uncaughtException', function (err) {
  console.error('LOI NGHIEM TRONG (uncaughtException):', err.message);
});

client.login(process.env.DISCORD_TOKEN).catch(function (err) {
  console.error('=== KHONG THE DANG NHAP DISCORD ===');
  console.error('Chi tiet loi:', err.message);
  console.error('Kiem tra: 1) DISCORD_TOKEN co dung khong. 2) MESSAGE CONTENT INTENT da bat trong Discord Developer Portal chua.');
  process.exit(1);
});

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', function (req, res) { res.send('Bot dang chay!'); });
app.listen(PORT, function () { console.log('Web server chay o port ' + PORT); });
