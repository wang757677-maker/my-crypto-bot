const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
const axios = require('axios');

const token = process.env.TG_BOT_TOKEN;
const mongoUri = process.env.MONGODB_URI;

// 🔑 第三方核心网络接口凭证（请在环境变量中配齐以确保高并发稳定性）
const TRON_API_KEY = process.env.TRON_API_KEY || ''; 
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || 'demo'; 
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://solana.com';
const XRPL_RPC_URL = process.env.XRPL_RPC_URL || 'https://xrplcluster.com'; // XRP官方公共群集节点

if (!token || !mongoUri) {
    console.error("❌ 错误：未配置 TG_BOT_TOKEN 或 MONGODB_URI！");
    process.exit(1);
}

// 🌐 连接 MongoDB
mongoose.connect(mongoUri)
  .then(() => console.log("🚀 成功连接到全智能五大币种(BTC/ETH/SOL/USDT/XRP)监控数据库！"))
  .catch(err => console.error("❌ MongoDB 连接失败:", err));

// 🛠️ 1️⃣ 精准钱包数据模型
const WalletSchema = new mongoose.Schema({
    address: { type: String, required: true },
    coin: { type: String, required: true },         // BTC, ETH, SOL, USDT, XRP
    chain: { type: String, required: true },        // BTC, ETH, SOL, TRON, XRPL
    contractAddress: { type: String, default: '' },   // 仅代币(如ERC20/TRC20 USDT)需要
    lastTxId: { type: String, default: '' },
    lastTxTimestamp: { type: Number, default: 0 }
});
WalletSchema.index({ address: 1, chain: 1, contractAddress: 1 }, { unique: true });
const Wallet = mongoose.model('RealtimeMultiChainWallet', WalletSchema);

const bot = new TelegramBot(token, { polling: true });

const expressApp = express();
expressApp.get('/', (req, res) => res.send('Enterprise Multi-Chain Monitor is running'));
expressApp.listen(process.env.PORT || 3000);

// 📱 2️⃣ 指令中心说明
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcome = `👋 **欢迎使用秒级全资产大额/异动流水监控机器人！**\n\n` +
                    `📝 **快速添加实时监听指令指南：**\n` +
                    `• **BTC 监控：** \`/add BTC BTC [比特币地址]\`\n` +
                    `• **ETH 原生：** \`/add ETH ETH [以太坊0x地址]\`\n` +
                    `• **SOL 原生：** \`/add SOL SOL [SolanaBase58地址]\`\n` +
                    `• **XRP 瑞波：** \`/add XRP XRPL [XRP以 r 开头的地址]\`\n` +
                    `• **USDT (波场 TRC20)：** \`/add USDT TRON [T开头的地址]\`\n` +
                    `• **USDT (以太坊 ERC20)：** \`/add USDT ETH [0x地址] 0xdAC17F958D2ee523a2206206994597C13D831ec7\`\n\n` +
                    `*⏰ 任务管理器每 15 秒分布式深度清洗多链新区块数据...*`;
    bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
});

// 📥 3️⃣ 智能多链添加处理器
bot.onText(/\/add\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(\S+))?/, async (msg, match) => {
    const coin = match[1].toUpperCase();
    const chain = match[2].toUpperCase();
    const address = match[3];
    const contractAddress = match[4] || ''; 
    const targetChatId = msg.chat.id;

    // 参数健壮性硬核校验
    if (chain === 'BTC' && !/^(1|3|bc1)/.test(address)) return bot.sendMessage(targetChatId, '❌ 错误：不合法的 BTC 地址类型！');
    if (chain === 'TRON' && !address.startsWith('T')) return bot.sendMessage(targetChatId, '❌ 错误：TRON(TRC20) 地址必须以 T 开头！');
    if (chain === 'ETH' && !address.startsWith('0x')) return bot.sendMessage(targetChatId, '❌ 错误：EVM 链地址必须以 0x 开头！');
    if (chain === 'XRPL' && !address.startsWith('r')) return bot.sendMessage(targetChatId, '❌ 错误：XRP 地址必须以小写 r 开头！');

    try {
        await Wallet.create({ address, coin, chain, contractAddress, lastTxTimestamp: Date.now() });
        bot.sendMessage(targetChatId, `✅ **成功切入实时监控网！**\n🪙 标的资产: *${coin}*\n🌐 区块网络: *${chain}*\n📍 监控地址: \`${address}\``, { parse_mode: 'Markdown' });
    } catch (error) {
        bot.sendMessage(targetChatId, `❌ 添加失败：该网络组合资产已在名单内。`);
    }
});

// 🔄 4️⃣ 分布式保护级总控制循环
setInterval(async () => {
    try {
        const wallets = await Wallet.find({});
        for (let wallet of wallets) {
            // 毫秒级防截流休眠器：给高频API留出呼吸时间，杜绝被封主网IP
            await new Promise(resolve => setTimeout(resolve, 300)); 
            try {
                if (wallet.chain === 'BTC') await scanBitcoin(wallet);
                else if (wallet.chain === 'TRON') await scanTron(wallet);
                else if (wallet.chain === 'ETH') await scanEVM(wallet);
                else if (wallet.chain === 'SOL') await scanSolana(wallet);
                else if (wallet.chain === 'XRPL') await scanXRP(wallet);
            } catch (innerError) {
                console.error(`[${wallet.chain}] 扫描跳过 (${wallet.address}):`, innerError.message);
            }
        }
    } catch (err) {
        console.error("引擎总回滚报错:", err.message);
    }
}, 15000);

// =================【🎯 五大币种底层独立驱动解析算法】=================

// 📌 【驱动 A - 比特币 BTC】
async function scanBitcoin(wallet) {
    const response = await axios.get(`https://mempool.space{wallet.address}/txs`);
    if (!response.data?.length) return;
    const lastTx = response.data[0];
    const txId = lastTx.txid;

    if (txId !== wallet.lastTxId) {
        let inVal = 0, outVal = 0, isPart = false;
        if (lastTx.vin) lastTx.vin.forEach(i => { if (i.prevout?.scriptpubkey_address === wallet.address) { outVal += i.prevout.value; isPart = true; } });
        if (lastTx.vout) lastTx.vout.forEach(o => { if (o.scriptpubkey_address === wallet.address) { inVal += o.value; isPart = true; } });
        if (!isPart) return;

        const isOut = outVal > inVal;
        const finalNet = (Math.abs(outVal - inVal) / 100000000).toFixed(6);
        const counterparty = isOut ? (lastTx.vout.find(o => o.scriptpubkey_address !== wallet.address)?.scriptpubkey_address || '多重接收') : (lastTx.vin.find(i => i.prevout?.scriptpubkey_address !== wallet.address)?.prevout?.scriptpubkey_address || '多重发送');

        sendNotification(wallet, isOut, finalNet, txId, wallet.coin, counterparty, lastTx.status.confirmed ? "✅ 链上确认" : "⏳ 内存池排队中");
        wallet.lastTxId = txId;
        await wallet.save();
    }
}

// 📌 【驱动 B - 波场 TRON & TRC20-USDT】
async function scanTron(wallet) {
    const contract = wallet.contractAddress || "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // 默认加载USDT
    const url = `https://trongrid.io{wallet.address}/transactions/trc20?limit=1&contract_address=${contract}`;
    const headers = TRON_API_KEY ? { 'TRON-PRO-API-KEY': TRON_API_KEY } : {};
    
    const response = await axios.get(url, { headers });
    if (!response.data?.data?.length) return;
    const lastTx = response.data.data[0];
    const txTimestamp = lastTx.block_timestamp;

    if (txTimestamp > wallet.lastTxTimestamp) {
        const decimals = lastTx.token_info?.decimals || 6;
        const value = (parseFloat(lastTx.value) / Math.pow(10, decimals)).toFixed(2);
        const isOut = lastTx.from.toLowerCase() === wallet.address.toLowerCase();

        sendNotification(wallet, isOut, value, lastTx.transaction_id, lastTx.token_info?.symbol || 'USDT', isOut ? lastTx.to : lastTx.from);
        wallet.lastTxTimestamp = txTimestamp;
        await wallet.save();
    }
}

// 📌 【驱动 C - 以太坊 ETH & ERC20-USDT】
async function scanEVM(wallet) {
    const url = `https://alchemy.com{ALCHEMY_API_KEY}`;
    const category = wallet.contractAddress ? ["erc20"] : ["external"];
    
    const postData = {
        jsonrpc: "2.0", id: 1,
        method: "alchemy_getAssetTransfers",
        params: [{ toAddress: wallet.address, category, maxCount: "0x1", order: "desc" }]
    };
    
    const response = await axios.post(url, postData);
    const lastTx = response.data?.result?.transfers?.[0];
    if (!lastTx) return;

    if (wallet.contractAddress && lastTx.rawContract?.address?.toLowerCase() !== wallet.contractAddress.toLowerCase()) return;

    const txId = lastTx.hash;
    if (txId !== wallet.lastTxId) {
        const value = lastTx.value ? parseFloat(lastTx.value).toFixed(4) : "未知";
        sendNotification(wallet, false, value, txId, lastTx.asset || wallet.coin, lastTx.from);
        wallet.lastTxId = txId;
        await wallet.save();
    }
}

// 📌 【驱动 D - 索拉纳 SOL & SPL代币】
async function scanSolana(wallet) {
    const sigResponse = await axios.post(SOLANA_RPC_URL, { jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [wallet.address, { limit: 1 }] });
    const currentSig = sigResponse.data?.result?.[0]?.signature;
    if (!currentSig) return;

    if (currentSig !== wallet.lastTxId) {
        const txResponse = await axios.post(SOLANA_RPC_URL, { jsonrpc: "2.0", id: 1, method: "getTransaction", params: [currentSig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }] });
        const txData = txResponse.data?.result;
        if (!txData) return;

        let value = "未知", isOut = false, counterparty = "系统撮合/智能合约";

        const instructions = txData.transaction?.message?.instructions || [];
        const transferInst = instructions.find(i => i.program === "system" && i.parsed?.type === "transfer");
        
        if (transferInst) {
            const info = transferInst.parsed.info;
            isOut = info.source === wallet.address;
            value = (parseFloat(info.lamports) / 1000000000).toFixed(4);
            counterparty = isOut ? info.destination : info.source;
        }

        sendNotification(wallet, isOut, value, currentSig, 'SOL', counterparty);
        wallet.lastTxId = currentSig;
        await wallet.save();
    }
}

// 📌 【驱动 E - 新增：瑞波币 XRP 精准监听】
async function scanXRP(wallet) {
    const postData = {
        method: "account_tx",
        params: [{ account: wallet.address, limit: 1, ledger_index_min: -1, ledger_index_max: -1 }]
    };
    const response = await axios.post(XRPL_RPC_URL, postData);
    const txObj = response.data?.result?.transactions?.[0];
    if (!txObj || !txObj.tx_ok) return;

    const txId = txObj.tx.hash;
    if (txId !== wallet.lastTxId) {
        const txDetail = txObj.tx;
        
        // XRP Ledger 中标准的 Payment 支付指令且必须是纯 XRP 交易（字符串代表XRP微滴 drops）
        if (txDetail.TransactionType === "Payment" && typeof txDetail.Amount === "string") {
