const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
const axios = require('axios'); // 引入 axios 用于请求新接口

const token = process.env.TG_BOT_TOKEN;
const mongoUri = process.env.MONGODB_URI;

if (!token || !mongoUri) {
    console.error("❌ 错误：未配置 TG_BOT_TOKEN 或 MONGODB_URI！");
    process.exit(1);
}

// 🌐 连接 MongoDB
mongoose.connect(mongoUri)
  .then(() => console.log("🚀 成功连接到远程 MongoDB 数据库！"))
  .catch(err => console.error("❌ MongoDB 连接失败:", err));

// 钱包数据模型（lastBlock 改为记录最后一次交易的时间戳，防重复）
const WalletSchema = new mongoose.Schema({
    address: { type: String, unique: true, required: true },
    coin: { type: String, required: true },
    lastTxTimestamp: { type: Number, default: 0 } // 记录最后一次处理的交易时间戳
});
const Wallet = mongoose.model('Wallet', WalletSchema);

const bot = new TelegramBot(token, { polling: true });

const expressApp = express();
expressApp.get('/', (req, res) => res.send('Bot is running'));
expressApp.listen(process.env.PORT || 3000);

// 1️⃣ 处理 /add 指令
bot.onText(/\/add\s+(\S+)\s+(\S+)/, async (msg, match) => {
    const coin = match.toUpperCase();
    const address = match;
    const targetChatId = msg.chat.id; 

    if (coin === 'USDT' && !address.startsWith('T')) {
        return bot.sendMessage(targetChatId, `❌ 错误：TRC20 地址必须以大写字母 T 开头！`);
    }

    try {
        // 首次添加时，初始化最后检查时间为当前时间戳
        await Wallet.create({ address, coin, lastTxTimestamp: Date.now() });
        bot.sendMessage(targetChatId, `✅ 成功添加监控地址:\n币种: ${coin}\n地址: ${address}\n状态: 实时监控中...`);
    } catch (error) {
        bot.sendMessage(targetChatId, `❌ 数据库写入失败！可能是地址已存在。`);
    }
});

// 2️⃣ 核心轮询：每 15 秒通过官方标准的 V1 接口扫描地址的 TRC20 最新流水
setInterval(async () => {
    try {
        const wallets = await Wallet.find({});
        if (wallets.length === 0) return;

        for (let wallet of wallets) {
            try {
                // 📡 使用 TronGrid 稳定的官方 v1 接口获取该地址最新的一笔 TRC20 交易
                const url = `https://trongrid.io{wallet.address}/transactions/trc20?limit=1&contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`;
                const response = await axios.get(url);
                
                if (!response.data || !response.data.data || response.data.data.length === 0) {
                    continue; 
                }

                const lastTx = response.data.data[0];
                const txTimestamp = lastTx.block_timestamp; // 交易时间戳

                // 如果发现链上的最新交易时间戳大于我们数据库记录的时间戳，说明有新交易！
                if (txTimestamp > wallet.lastTxTimestamp) {
                    const fromAddress = lastTx.from;
                    const toAddress = lastTx.to;
                    // 转换精度：波场 USDT 精度为 6
                    const value = (parseFloat(lastTx.value) / 1000000).toFixed(2); 
                    const txId = lastTx.transaction_id;

                    // 判断是转出（付款）还是转入（收款）
                    if (fromAddress === wallet.address) {
                        bot.sendMessage(process.env.TG_CHAT_ID, `💸 【转出通知】\n监控地址: ${wallet.address}\n动作: 支出 USDT\n金额: ${value} USDT\n接收方: ${toAddress}\n单号: ${txId.substring(0,8)}...`);
                    } else if (toAddress === wallet.address) {
                        bot.sendMessage(process.env.TG_CHAT_ID, `💰 【收款通知】\n监控地址: ${wallet.address}\n动作: 收到 USDT\n金额: ${value} USDT\n发送方: ${fromAddress}\n单号: ${txId.substring(0,8)}...`);
                    }

                    // 更新数据库中的时间戳锚点，防止下一次轮询重复通知
                    wallet.lastTxTimestamp = txTimestamp;
                    await wallet.save();
                }
            } catch (e) {
                console.error(`扫描地址 ${wallet.address} 出错:`, e.message);
            }
        }
    } catch (err) {
        console.error("定时轮询监控发生错误:", err);
    }
}, 15000); // 每 15 秒自动检查一次
