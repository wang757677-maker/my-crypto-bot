const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// 从你在 Render 配置的钥匙孔里自动读取密码
const token = process.env.TG_BOT_TOKEN;
const chatId = process.env.TG_CHAT_ID;

if (!token || !chatId) {
    console.error("❌ 错误：未在 Render 中配置 TG_BOT_TOKEN 或 TG_CHAT_ID！");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// 📥 【核心监控钱包】把你想要死死盯着的巨鲸钱包地址填在下面
const WALLET_TO_WATCH = "0x71C7656EC7ab88b098defB751B7401B5f6d1476B"; 

let lastBalance = null;

// 24小时在后台免费查账的秘密函数（换用绝对不带任何防火墙拦截的全新极速多链网关）
async function checkMultiChainBalance() {
    try {
        const response = await axios.post('https://meowrpc.com', {
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getBalance",
            params: [WALLET_TO_WATCH, "latest"]
        }, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        if (response.data && response.data.result) {
            // 将十六进制余额转换为人类看得懂的数字
            const rawBalance = parseInt(response.data.result, 16);
            const balanceInEth = (rawBalance / 1e18).toFixed(4);

            console.log(`[监控日志] 巨鲸当前币安链余额: ${balanceInEth} BNB`);

            // 如果是第一次启动，先记录初始余额
            if (lastBalance === null) {
                lastBalance = balanceInEth;
                bot.sendMessage(chatId, `🎉 晚安多链监控机器人已在云端成功上线！\n👀 正在 24 小时死守目标钱包：\n\`${WALLET_TO_WATCH}\``);
                return;
            }

            // 如果余额发生变动，说明巨鲸转账了！立刻向电报群发送精美的中文轰炸通知
            if (balanceInEth !== lastBalance) {
                const changeType = balanceInEth > lastBalance ? "📥 资金流入 (买入/充值)" : "📤 资金流出 (卖出/转账)";
                const difference = Math.abs(balanceInEth - lastBalance).toFixed(4);
                
                const message = `🚨 【巨鲸多链异动提醒】 🚨\n\n` +
                                `📌 钱包地址:\n\`${WALLET_TO_WATCH}\`\n\n` +
                                `动态类型: ${changeType}\n` +
                                `💰 变动金额: ${difference} BNB\n` +
                                `📊 当前总余额: ${balanceInEth} BNB\n\n` +
                                `⏰ 监控源: Render 24小时云端机房`;

                bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                lastBalance = balanceInEth; // 更新余额状态
            }
        }
    } catch (error) {
        console.error("查账时发生微小网络波动，5分钟后会自动重试...");
    }
}

// 激活聊天指令，当你在电报里发 /start 时，机器人会立刻温柔回复你
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🤖 晚安！我已经成功收到了你的唤醒指令。我的后台多链监控引擎正在 Render 云端 24 小时为你站岗，只要目标钱包有资金进出，我会立刻在这个群里通知你！");
});

// 让服务器每隔 5 分钟（300000毫秒）在云端自动跑一次查账代码
setInterval(checkMultiChainBalance, 300000);
// 启动时立刻查一次
checkMultiChainBalance();

// 保持 Render 要求的端口开机状态
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('机器人运行正常'));
app.listen(process.env.PORT || 3000);
