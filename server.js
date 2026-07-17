const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const mongoose = require('mongoose');
const express = require('express');

// 🔌 读取您的 Telegram 机器人密钥与数据库配置
const token = process.env.TG_BOT_TOKEN;
const chatId = process.env.TG_CHAT_ID;
const mongoUri = process.env.MONGODB_URI;

if (!token || !chatId || !mongoUri) {
    console.error("❌ 错误：未配置 TG_BOT_TOKEN、TG_CHAT_ID 或 MONGODB_URI！");
    process.exit(1);
}

// 🌐 连接免费的 MongoDB 云数据库
mongoose.connect(mongoUri)
  .then(() => console.log("🚀 成功连接到远程 MongoDB 数据库！"))
  .catch(err => console.error("❌ MongoDB 连接失败:", err));

// 定义钱包数据模型
const WalletSchema = new mongoose.Schema({
    address: { type: String, unique: true, required: true },
    coin: { type: String, required: true }
});
const Wallet = mongoose.model('Wallet', WalletSchema);

const bot = new TelegramBot(token, { polling: true });

const expressApp = express();
expressApp.get('/', (req, res) => res.send('Bot is running'));
expressApp.listen(process.env.PORT || 3000);

// 处理 /add 指令
bot.onText(/\/add\s+(\S+)\s+(\S+)/, async (msg, match) => {
    const coin = match[1].toUpperCase();
    const address = match[2];
    try {
        await Wallet.create({ address, coin });
        bot.sendMessage(chatId, `✅ 成功添加监控地址:\n币种: ${coin}\n地址: ${address}`);
    } catch (error) {
        console.error("写入失败详情:", error);
        bot.sendMessage(chatId, `❌ 数据库写入失败！可能是地址已存在或数据库未连接成功。`);
    }
});
