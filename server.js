// 🚨 全局死因拦截器
process.on('uncaughtException', (err) => {
    console.error('💥 致命全局崩溃:', err.message, err.stack);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('💥 未处理的 Promise 拒绝:', reason);
});

const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
const axios = require('axios');

const token = process.env.TG_BOT_TOKEN;
const mongoUri = process.env.MONGODB_URI;

const TRON_API_KEY = process.env.TRON_API_KEY || ''; 
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || 'demo'; 
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://solana.com';
const XRPL_RPC_URL = process.env.XRPL_RPC_URL || 'https://xrplcluster.com'; 

if (!token || !mongoUri) {
    console.error("❌ 错误：未配置 TG_BOT_TOKEN 或 MONGODB_URI！");
    process.exit(1);
}

mongoose.connect(mongoUri)
  .then(() => console.log("🚀 成功连接到全智能五大币种监控数据库！"))
  .catch(err => console.error("❌ MongoDB 连接失败:", err));

const WalletSchema = new mongoose.Schema({
    address: { type: String, required: true },
    coin: { type: String, required: true },         
    chain: { type: String, required: true },        
    contractAddress: { type: String, default: '' },   
    lastTxId: { type: String, default: '' },
    lastTxTimestamp: { type: Number, default: 0 }
});
WalletSchema.index({ address: 1, chain: 1, contractAddress: 1 }, { unique: true });
const Wallet = mongoose.model('RealtimeMultiChainWallet', WalletSchema);

const bot = new TelegramBot(token, { polling: true });

// 📡 兼容 Render 健康检查
const expressApp = express();
expressApp.get('/', (req, res) => res.status(200).send('OK'));
expressApp.get('/healthz', (req, res) => res.status(200).send('OK'));
const PORT = process.env.PORT || 3000;
expressApp.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 端口监听成功！健康检查已激活，端口: ${PORT}`);
});

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `👋 **欢迎使用秒级全资产流水监控机器人！**\n\n📝 **指令格式：**\n\`/add [币种] [区块链] [钱包地址]\`\n\n💡 示例:\n\`/add BTC BTC 比特币地址\`\n\`/add SOL SOL 索拉纳地址\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/add\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(\S+))?/, async (msg, match) => {
    const coin = match[1].toUpperCase(); const chain = match[2].toUpperCase(); const address = match[3]; const contractAddress = match[4] || ''; const targetChatId = msg.chat.id;
    try {
        await Wallet.create({ address, coin, chain, contractAddress, lastTxTimestamp: Date.now() });
        bot.sendMessage(targetChatId, `✅ **成功切入监控网！**\n🌐 网络: *${chain}*\n📍 地址: \`${address}\``, { parse_mode: 'Markdown' });
    } catch (error) { bot.sendMessage(targetChatId, `❌ 添加失败：资产已存在。`); }
});

// 🔄 引入核心业务逻辑驱动
const utils = require('./utils');

setInterval(async () => {
    try {
        const wallets = await Wallet.find({});
        for (let wallet of wallets) {
            await new Promise(res => setTimeout(res, 300)); 
            try {
                if (wallet.chain === 'BTC') await utils.scanBitcoin(wallet, bot);
                else if (wallet.chain === 'TRON') await utils.scanTron(wallet, bot, TRON_API_KEY);
                else if (wallet.chain === 'ETH') await utils.scanEVM(wallet, bot, ALCHEMY_API_KEY);
                else if (wallet.chain === 'SOL') await utils.scanSolana(wallet, bot, SOLANA_RPC_URL);
                else if (wallet.chain === 'XRPL') await utils.scanXRP(wallet, bot, XRPL_RPC_URL);
            } catch (ie) { console.error(`[${wallet.chain}] 错误:`, ie.message); }
        }
    } catch (err) { console.error("总控制循环报错:", err.message); }
}, 15000);
