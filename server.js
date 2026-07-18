const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
const axios = require('axios');

const token = process.env.TG_BOT_TOKEN;
const mongoUri = process.env.MONGODB_URI;

// 可选：为了保证高并发和稳定性，建议配置第三方节点的 API KEY
const TRON_API_KEY = process.env.TRON_API_KEY || ''; 
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || 'demo'; // 替换为你的 Alchemy 密钥
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

if (!token || !mongoUri) {
    console.error("❌ 错误：未配置 TG_BOT_TOKEN 或 MONGODB_URI！");
    process.exit(1);
}

// 🌐 连接 MongoDB
mongoose.connect(mongoUri)
  .then(() => console.log("🚀 成功连接到远程多链监控数据库！"))
  .catch(err => console.error("❌ MongoDB 连接失败:", err));

// 🛠️ 1️⃣ 重构钱包数据模型（加入链字段与最新的唯一标识符）
const WalletSchema = new mongoose.Schema({
    address: { type: String, required: true },
    coin: { type: String, required: true },
    chain: { type: String, required: true }, // TRON, ETH, SOL, BASE 等
    lastTxId: { type: String, default: '' },   // 针对 Solana 使用签名特征码，针对EVM/TRON可用时间戳或txId
    lastTxTimestamp: { type: Number, default: 0 }
});
// 联合唯一索引：同一个链下的同一个地址不能重复添加
WalletSchema.index({ address: 1, chain: 1 }, { unique: true });
const Wallet = mongoose.model('MultiChainWallet', WalletSchema);

const bot = new TelegramBot(token, { polling: true });

const expressApp = express();
expressApp.get('/', (req, res) => res.send('Multi-Chain Bot is running'));
expressApp.listen(process.env.PORT || 3000);

// 📱 2️⃣ 更新 /start 指令
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `👋 **欢迎使用 Web3 多链资产监控机器人！**\n\n` +
                           `您可以直接使用以下指令来添加想要监控的钱包地址：\n\n` +
                           `📝 **添加监控格式：**\n` +
                           `/add [币种] [区块链] [钱包地址]\n\n` +
                           `💡 **各大主流链支持示例：**\n` +
                           `• **波场监控：** \`/add USDT TRON TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t\`\n` +
                           `• **以太坊监控：** \`/add ETH ETH 0x72e8...0000\`\n` +
                           `• **Solana监控：** \`/add SOL SOL BXbm...Th\`\n\n` +
                           `*目前机器人每 15 秒会自动分布式扫描所有多链资产流水并向通知频道发送播报。*`;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// 📥 3️⃣ 更新 /add 指令解析器
bot.onText(/\/add\s+(\S+)\s+(\S+)\s+(\S+)/, async (msg, match) => {
    const coin = match[1].toUpperCase();
    const chain = match[2].toUpperCase();
    const address = match[3];
    const targetChatId = msg.chat.id; 

    // 简单校验
    if (chain === 'TRON' && !address.startsWith('T')) {
        return bot.sendMessage(targetChatId, `❌ 错误：TRC20 地址必须以大写字母 T 开头！`);
    }
    if ((chain === 'ETH' || chain === 'BASE' || chain === 'BSC') && !address.startsWith('0x')) {
        return bot.sendMessage(targetChatId, `❌ 错误：EVM 链地址必须以 0x 开头！`);
    }

    try {
        await Wallet.create({ address, coin, chain, lastTxTimestamp: Date.now() });
        bot.sendMessage(targetChatId, `✅ **成功添加多链监控！**\n🪙 币种: ${coin}\n🌐 区块链: ${chain}\n📍 地址: ${address}\n状态: 实时监听中...`, { parse_mode: 'Markdown' });
    } catch (error) {
        bot.sendMessage(targetChatId, `❌ 数据库写入失败！该链下的地址可能已在监控中。`);
    }
});

// 🔄 4️⃣ 核心分布式轮询器
setInterval(async () => {
    try {
        const wallets = await Wallet.find({});
        if (wallets.length === 0) return;

        for (let wallet of wallets) {
            try {
                if (wallet.chain === 'TRON') {
                    await scanTron(wallet);
                } else if (wallet.chain === 'ETH' || wallet.chain === 'BASE') {
                    await scanEVM(wallet);
                } else if (wallet.chain === 'SOL') {
                    await scanSolana(wallet);
                }
            } catch (e) {
                console.error(`扫描 [${wallet.chain}] 地址 ${wallet.address} 出错:`, e.message);
            }
        }
    } catch (err) {
        console.error("多链定时轮询发生错误:", err);
    }
}, 15000); 

// =================【各个链的独立扫描算法逻辑】=================

// 📌 【波场 TRON 扫描】
async function scanTron(wallet) {
    const url = `https://trongrid.io{wallet.address}/transactions/trc20?limit=1&contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`;
    const headers = TRON_API_KEY ? { 'TRON-PRO-API-KEY': TRON_API_KEY } : {};
    const response = await axios.get(url, { headers });
    
    if (!response.data?.data?.length) return;
    const lastTx = response.data.data[0];
    const txTimestamp = lastTx.block_timestamp;

    if (txTimestamp > wallet.lastTxTimestamp) {
        const value = (parseFloat(lastTx.value) / 1000000).toFixed(2);
        sendNotification(wallet, lastTx.from, lastTx.to, value, lastTx.transaction_id);
        wallet.lastTxTimestamp = txTimestamp;
        await wallet.save();
    }
}

// 📌 【以太坊 / EVM 链扫描】以 Alchemy [Transfers API] 为例
async function scanEVM(wallet) {
    // 动态判断链网络
    const network = wallet.chain === 'BASE' ? 'base-mainnet' : 'eth-mainnet';
    const url = `https://${network}://{ALCHEMY_API_KEY}`;
    
    // 使用标准的 alchemy_getAssetTransfers 结构体拉取一笔最新转账记录
    const postData = {
        jsonrpc: "2.0",
        id: 1,
        method: "alchemy_getAssetTransfers",
        params: [{
            toAddress: wallet.address, // 或者同时监控从该地址转出，这里以流入为例展示
            category: ["external", "erc20"],
            maxCount: "0x1",
            order: "desc"
        }]
    };
    
    const response = await axios.post(url, postData);
    const lastTx = response.data?.result?.transfers?.[0];
    if (!lastTx) return;

    const txId = lastTx.hash;
    // 如果最新的哈希跟我们存储的不一样，判定有新事件
    if (txId !== wallet.lastTxId) {
        const value = lastTx.value ? parseFloat(lastTx.value).toFixed(4) : "未知";
        sendNotification(wallet, lastTx.from, lastTx.to, value, txId);
        wallet.lastTxId = txId;
        await wallet.save();
    }
}

// 📌 【Solana 链扫描】
async function scanSolana(wallet) {
    // 1. 获取该地址最近的一条交易签名特征码
    const postData = {
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [wallet.address, { limit: 1 }]
    };
    
    const response = await axios.post(SOLANA_RPC_URL, postData);
    const lastSignatureObj = response.data?.result?.[0];
    if (!lastSignatureObj) return;

    const currentSig = lastSignatureObj.signature;

    // 2. 如果最新签名和数据库中留存的不匹配，触发提醒
    if (currentSig !== wallet.lastTxId) {
        // 由于解析原始 Solana 交易数据极度繁琐，在此直接向群组广播发生了最新的链上交互事件。
        // （开发环境中通常可以调用 Helius 的 getTransfersByAddress 或者进一步请求 getTransaction 提取具体数值）
        bot.sendMessage(
            process.env.TG_CHAT_ID, 
            `🔔 【Solana 链上动态提醒】\n` +
            `监控地址: ${wallet.address}\n` +
            `动作: 检测到最新区块交互事件！\n` +
            `交易特征签名: ${currentSig.substring(0, 16)}...\n` +
            `🔗 查看详情: https://solscan.io{currentSig}`
        );
        
        wallet.lastTxId = currentSig;
        await wallet.save();
    }
}

// 📢 5️⃣ 统一通知中心
function sendNotification(wallet, from, to, value, txId) {
    const isOut = from.toLowerCase() === wallet.address.toLowerCase();
    const actionStr = isOut ? `💸 【转出通知】` : `💰 【收款通知】`;
    const arrowStr = isOut ? `支出` : `收到`;
    const counterparty = isOut ? `接收方: ${to}` : `发送方: ${from}`;
    
    let explorerUrl = `https://tronscan.org{txId}`;
    if (wallet.chain === 'ETH') explorerUrl = `https://etherscan.io{txId}`;
    if (wallet.chain === 'BASE') explorerUrl = `https://basescan.org{txId}`;

    const text = `${actionStr}\n` +
                 `网络公链: ${wallet.chain}\n` +
                 `监控地址: ${wallet.address}\n` +
                 `动作类型: ${arrowStr} ${wallet.coin}\n` +
                 `动账金额: ${value} ${wallet.coin}\n` +
                 `${counterparty}\n` +
                 `单号缩略: ${txId.substring(0, 12)}...\n` +
                 `🔗 [区块链浏览器查看详情](${explorerUrl})`;

    bot.sendMessage(process.env.TG_CHAT_ID, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
}
