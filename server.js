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

// 初始化机器人（增加 polling 错误捕获，防止网络抖动导致的断连）
const bot = new TelegramBot(token, { polling: true });
bot.on('polling_error', (error) => console.log('⏳ 电报轮询网络警告:', error.message));

// 📡 兼容 Render 健康检查
const expressApp = express();
expressApp.get('/', (req, res) => res.status(200).send('OK'));
expressApp.get('/healthz', (req, res) => res.status(200).send('OK'));
const PORT = process.env.PORT || 3000;
expressApp.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 端口监听成功！健康检查已激活，端口: ${PORT}`);
});

// 📱 智能消息分发中心：使用最稳健的 message 监听，彻底告别正则失效
bot.on('message', async (msg) => {
    if (!msg.text) return;
    const targetChatId = msg.chat.id;
    const text = msg.text.trim();

    // 1️⃣ 处理 /start 指令
    if (text.startsWith('/start')) {
        const welcome = `👋 **欢迎使用秒级全资产大额/异动流水监控机器人！**\n\n` +
                        `📝 **快速添加实时监听指令指南：**\n` +
                        `• **BTC 监控：** \`/add BTC BTC [比特币地址]\`\n` +
                        `• **ETH 原生：** \`/add ETH ETH [以太坊地址]\`\n` +
                        `• **SOL 原生：** \`/add SOL SOL [Solana地址]\`\n` +
                        `• **XRP 瑞波：** \`/add XRP XRPL [XRP以r开头的地址]\`\n` +
                        `• **USDT (波场 TRC20)：** \`/add USDT TRON [T开头的地址]\`\n` +
                        `• **USDT (以太坊 ERC20)：** \`/add USDT ETH [0x地址] 0xdAC17F958D2ee523a2206206994597C13D831ec7\`\n\n` +
                        `*⏰ 任务管理器每 15 秒分布式深度清洗多链新区块数据...*`;
        return bot.sendMessage(targetChatId, welcome, { parse_mode: 'Markdown' });
    }

    // 2️⃣ 处理 /add 指令
    if (text.startsWith('/add')) {
        // 使用空格将指令切开，规避复杂的正则符号
        const parts = text.split(/\s+/);
        if (parts.length < 4) {
            return bot.sendMessage(targetChatId, '❌ 格式错误！请输入: `/add [币种] [区块链] [钱包地址] [可选:代币合约]`', { parse_mode: 'Markdown' });
        }

        const coin = parts[1].toUpperCase();
        const chain = parts[2].toUpperCase();
        const address = parts[3];
        const contractAddress = parts[4] || '';

        // 参数合法性基础校验
        if (chain === 'BTC' && !/^(1|3|bc1)/.test(address)) return bot.sendMessage(targetChatId, '❌ 错误：不合法的 BTC 地址类型！');
        if (chain === 'TRON' && !address.startsWith('T')) return bot.sendMessage(targetChatId, '❌ 错误：TRON(TRC20) 地址必须以 T 开头！');
        if (chain === 'ETH' && !address.startsWith('0x')) return bot.sendMessage(targetChatId, '❌ 错误：EVM 链地址必须以 0x 开头！');
        if (chain === 'XRPL' && !address.startsWith('r')) return bot.sendMessage(targetChatId, '❌ 错误：XRP 地址必须以小写 r 开头！');

        try {
            await Wallet.create({ address, coin, chain, contractAddress, lastTxTimestamp: Date.now() });
            return bot.sendMessage(targetChatId, `✅ **成功切入实时监控网！**\n🪙 标的资产: *${coin}*\n🌐 区块网络: *${chain}*\n📍 监控地址: \`${address}\``, { parse_mode: 'Markdown' });
        } catch (error) {
            return bot.sendMessage(targetChatId, `❌ 添加失败：该网络组合资产已在名单内。`);
        }
    }
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
