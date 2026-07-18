const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
const axios = require('axios');

const token = process.env.TG_BOT_TOKEN;
const mongoUri = process.env.MONGODB_URI;

// 🔑 建议配置的 API 密钥（可极大提升稳定性和并发限制）
const TRON_API_KEY = process.env.TRON_API_KEY || ''; 
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || 'demo'; // 用于以太坊/Base 的精准数据提取
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://solana.com';

if (!token || !mongoUri) {
    console.error("❌ 错误：未配置 TG_BOT_TOKEN 或 MONGODB_URI！");
    process.exit(1);
}

// 🌐 连接 MongoDB
mongoose.connect(mongoUri)
  .then(() => console.log("🚀 成功连接到远程全功能多链数据库！"))
  .catch(err => console.error("❌ MongoDB 连接失败:", err));

// 🛠️ 1️⃣ 升级钱包数据模型
const WalletSchema = new mongoose.Schema({
    address: { type: String, required: true },
    coin: { type: String, required: true },       // 监听的币种符号，如 USDT, ETH, SOL, USDC 等
    chain: { type: String, required: true },      // TRON, ETH, BASE, SOL 
    contractAddress: { type: String, default: '' }, // 【新增】如果是代币监控，记录代币的合约地址
    lastTxId: { type: String, default: '' },
    lastTxTimestamp: { type: Number, default: 0 }
});
WalletSchema.index({ address: 1, chain: 1, contractAddress: 1 }, { unique: true });
const Wallet = mongoose.model('AdvancedMultiChainWallet', WalletSchema);

const bot = new TelegramBot(token, { polling: true });

const expressApp = express();
expressApp.get('/', (req, res) => res.send('Advanced Multi-Chain Bot is running'));
expressApp.listen(process.env.PORT || 3000);

// 📱 2️⃣ 升级后的 /start 指令（包含合约配置说明）
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `👋 **欢迎使用高级 Web3 多链资产流水监控机器人！**\n\n` +
                           `您可以自由添加原生代币或特定代币合约的监控：\n\n` +
                           `📝 **基本监控（原生代币）：**\n` +
                           `/add [币种] [区块链] [钱包地址]\n` +
                           `💡 \`/add ETH ETH 0x72e8...0000\`\n` +
                           `💡 \`/add SOL SOL BXbm...Th\`\n\n` +
                           `📝 **高级代币监控（指定合约地址）：**\n` +
                           `/add [币种] [区块链] [钱包地址] [代币合约地址]\n` +
                           `💡 **波场监听USDT：**\n\`/add USDT TRON T-Address TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t\`\n` +
                           `💡 **Base链监听USDC：**\n\`/add USDC BASE 0x-Address 0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913\`\n\n` +
                           `*系统正在每 15 秒分布式轮询链上最新区块...*`;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// 📥 3️⃣ 支持四参数解析的 /add 指令
bot.onText(/\/add\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(\S+))?/, async (msg, match) => {
    const coin = match[1].toUpperCase();
    const chain = match[2].toUpperCase();
    const address = match[3];
    const contractAddress = match[4] || ''; // 如果不填，默认当做原生代币处理
    const targetChatId = msg.chat.id; 

    if (chain === 'TRON' && !address.startsWith('T')) return bot.sendMessage(targetChatId, `❌ 错误：波场地址需以 T 开头！`);
    if ((chain === 'ETH' || chain === 'BASE') && !address.startsWith('0x')) return bot.sendMessage(targetChatId, `❌ 错误：EVM地址需以 0x 开头！`);

    try {
        await Wallet.create({ address, coin, chain, contractAddress, lastTxTimestamp: Date.now() });
        const contractInfo = contractAddress ? `\n📄 代币合约: \`${contractAddress}\`` : '\n📄 监听类型: 原生代币/整链流水';
        bot.sendMessage(targetChatId, `✅ **成功添加精准监控！**\n🪙 监控币种: ${coin}\n🌐 区块链网络: ${chain}\n📍 目标地址: \`${address}\`${contractInfo}\n状态: 实时深度监听中...`, { parse_mode: 'Markdown' });
    } catch (error) {
        bot.sendMessage(targetChatId, `❌ 数据库写入失败！请确认该链、地址及合约的组合是否已存在。`);
    }
});

// 🔄 4️⃣ 分布式多链轮询处理器
setInterval(async () => {
    try {
        const wallets = await Wallet.find({});
        for (let wallet of wallets) {
            try {
                if (wallet.chain === 'TRON') await scanTron(wallet);
                else if (wallet.chain === 'ETH' || wallet.chain === 'BASE') await scanEVM(wallet);
                else if (wallet.chain === 'SOL') await scanSolana(wallet);
            } catch (e) {
                console.error(`[${wallet.chain}] 扫描错误 (${wallet.address}):`, e.message);
            }
        }
    } catch (err) {
        console.error("轮询异常:", err);
    }
}, 15000); 

// =================【核心链升级算法逻辑】=================

// 📌 【波场 TRON】
async function scanTron(wallet) {
    // 如果用户没有指定代币合约，波场默认查询默认的 USDT 核心合约
    const contract = wallet.contractAddress || "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const url = `https://trongrid.io{wallet.address}/transactions/trc20?limit=1&contract_address=${contract}`;
    const headers = TRON_API_KEY ? { 'TRON-PRO-API-KEY': TRON_API_KEY } : {};
    
    const response = await axios.get(url, { headers });
    if (!response.data?.data?.length) return;
    
    const lastTx = response.data.data[0];
    const txTimestamp = lastTx.block_timestamp;

    if (txTimestamp > wallet.lastTxTimestamp) {
        // 波场 TRC-20 大多为 6 位精度 (USDT)
        const decimals = lastTx.token_info?.decimals || 6;
        const value = (parseFloat(lastTx.value) / Math.pow(10, decimals)).toFixed(2);
        
        sendNotification(wallet, lastTx.from, lastTx.to, value, lastTx.transaction_id, lastTx.token_info?.symbol || wallet.coin);
        wallet.lastTxTimestamp = txTimestamp;
        await wallet.save();
    }
}

// 📌 【EVM 链：以太坊 / Base 精准代币级监控】
async function scanEVM(wallet) {
    const network = wallet.chain === 'BASE' ? 'base-mainnet' : 'eth-mainnet';
    const url = `https://${network}://{ALCHEMY_API_KEY}`;
    
    // 配置参数：如果填写了 contractAddress，则精准只看该 ERC-20 资产类别；没填则看外包资产（ETH等）
    const category = wallet.contractAddress ? ["erc20"] : ["external"];
    const params = {
        category,
        maxCount: "0x1",
        order: "desc"
    };

    // 默认监听转入，通常实际生产环境会分别请求 fromAddress 和 toAddress，这里以大盘吞吐量为例
    params.toAddress = wallet.address;

    const postData = {
        jsonrpc: "2.0",
        id: 1,
        method: "alchemy_getAssetTransfers",
        params: [params]
    };
    
    const response = await axios.post(url, postData);
    const transfers = response.data?.result?.transfers;
    if (!transfers || transfers.length === 0) return;

    const lastTx = transfers[0];
    
    // 如果用户设置了具体监听的合约地址，必须强制匹配该哈希
    if (wallet.contractAddress && lastTx.rawContract?.address?.toLowerCase() !== wallet.contractAddress.toLowerCase()) {
        return; 
    }

    const txId = lastTx.hash;
    if (txId !== wallet.lastTxId) {
        const value = lastTx.value ? parseFloat(lastTx.value).toFixed(4) : "未知";
        const txCoinSymbol = lastTx.asset || wallet.coin;
        
        sendNotification(wallet, lastTx.from, lastTx.to, value, txId, txCoinSymbol);
        wallet.lastTxId = txId;
        await wallet.save();
    }
}

// 📌 【Solana 链：完美重构、解析具体金额与代币变动】
async function scanSolana(wallet) {
    // 1. 获取最新一笔交易特征签章
    const sigResponse = await axios.post(SOLANA_RPC_URL, {
        jsonrpc: "2.0", id: 1,
        method: "getSignaturesForAddress",
        params: [wallet.address, { limit: 1 }]
    });
    const lastSigObj = sigResponse.data?.result?.[0];
    if (!lastSigObj) return;

    const currentSig = lastSigObj.signature;

    // 2. 发现新交易，立即请求 getTransaction 提取核心数据明细
    if (currentSig !== wallet.lastTxId) {
        try {
            const txResponse = await axios.post(SOLANA_RPC_URL, {
                jsonrpc: "2.0", id: 1,
                method: "getTransaction",
                params: [currentSig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]
            });

            const txData = txResponse.data?.result;
            if (!txData) return;

            let finalValue = "未知";
            let coinSymbol = wallet.coin;
            let fromAccount = "未知";
            let toAccount = "未知";

            // 情况 A：用户指定监听 SPL 代币（如 Solana 上的 USDC/模因币）
            if (wallet.contractAddress) {
                // 在 meta.postTokenBalances 中寻找目标代币的变动流水
                const tokenBalances = txData.meta?.postTokenBalances || [];
                const matchedBalance = tokenBalances.find(b => b.mint === wallet.contractAddress && b.owner === wallet.address);
                
                if (matchedBalance) {
                    // 通过对比 preTokenBalances 和 postTokenBalances 可以精准算出转入/转出净值
                    const preBalances = txData.meta?.preTokenBalances || [];
                    const preB = preBalances.find(b => b.mint === wallet.contractAddress && b.owner === wallet.address);
                    const preAmount = preB ? parseFloat(preB.uiTokenAmount.uiAmountString) : 0;
                    const postAmount = parseFloat(matchedBalance.uiTokenAmount.uiAmountString);
                    
                    finalValue = Math.abs(postAmount - preAmount).toFixed(4);
                    coinSymbol = wallet.coin; 
                    if (postAmount > preAmount) {
                        toAccount = wallet.address;
                    } else {
                        fromAccount = wallet.address;
                    }
                }
            } else {
                // 情况 B：没有指定合约，解析 Solana 原生代币 SOL 转账
                const instructions = txData.transaction?.message?.instructions || [];
                // 寻找标准的 SystemProgram 转账指令
                const transferInst = instructions.find(i => i.program === "system" && i.parsed?.type === "transfer");
                
                if (transferInst) {
                    const info = transferInst.parsed.info;
                    fromAccount = info.source;
                    toAccount = info.destination;
                    finalValue = (parseFloat(info.lamports) / 1000000000).toFixed(4); // 9位精度
                    coinSymbol = "SOL";
                }
            }

            // 发送通知
            if (finalValue !== "未知") {
                sendNotification(wallet, fromAccount, toAccount, finalValue, currentSig, coinSymbol);
            } else {
