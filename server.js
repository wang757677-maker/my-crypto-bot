const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const Datastore = require('nedb');
const express = require('express');

// 🔐 读取你的 Telegram 机器人密钥
const token = process.env.TG_BOT_TOKEN;
const chatId = process.env.TG_CHAT_ID;

if (!token || !chatId) {
    console.error("❌ 错误：未配置 TG_BOT_TOKEN 或 TG_CHAT_ID！");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// 💾 初始化本地记忆数据库（用于存放你用指令添加的地址）
const db = new Datastore({ filename: 'wallets_db.db', autoload: true });

// 各种区块链的免费极速公开查账网关
const RPC_NODES = {
    "ETH": "https://meowrpc.com",
    "BSC": "https://meowrpc.com",
    "SOL": "https://solana.com",
    "BTC": "https://blockchain.info",
    "XRP": "https://xrplcluster.com"
};

// USDT 在 ETH 和 BSC 上的标准智能合约身份证
const USDT_CONTRACTS = {
    "ETH": "0xdac17f958d2ee523a2206206994597c13d831ec7",
    "BSC": "0x55d398326f99059ff775485246999027b3197955"
};

// ------------------- 🤖 TELEGRAM 指令互动中心 🤖 -------------------

// 1️⃣ 【/start】温馨欢迎菜单
bot.onText(/\/start/, (msg) => {
    const helpMsg = `🤖 **晚安多链动态监控卫星已就位！**\n\n` +
                    `你现在可以直接在聊天框里向我发送以下指令来管理你想监控的钱包：\n\n` +
                    `🟢 **添加监控：**\n` +
                    `\`信号格式：/add 币种 钱包地址\`\n` +
                    `例如：\`/add BTC 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\`\n` +
                    `例如：\`/add USDT 0x71C7656EC7ab88b098defB751B7401B5f6d1476B\`\n\n` +
                    `🔴 **查看当前的死守清单：**\n` +
                    `输入指令： \`/list\`\n\n` +
                    `🟡 **删除某监控：**\n` +
                    `\`信号格式：/del 钱包地址\``;
    bot.sendMessage(msg.chat.id, helpMsg, { parse_mode: 'Markdown' });
});

// 2️⃣ 【/add】指令：让机器人用数据库死死记住新地址
bot.onText(/\/add (.+)/, (msg, match) => {
    const params = match[1].split(' ');
    if (params.length < 2) {
        return bot.sendMessage(msg.chat.id, "⚠️ 格式错误！请使用：\`/add 币种 地址\`\n支持币种：BTC, ETH, SOL, XRP, USDT", { parse_mode: 'Markdown' });
    }
    const coin = params[0].toUpperCase();
    const address = params[1].trim();

    if (!["BTC", "ETH", "SOL", "XRP", "USDT"].includes(coin)) {
        return bot.sendMessage(msg.chat.id, "❌ 暂不支持该币种！目前仅支持：BTC, ETH, SOL, XRP, USDT");
    }

    db.update({ address: address }, { coin: coin, address: address, lastBalance: null }, { upsert: true }, (err) => {
        if (err) return bot.sendMessage(msg.chat.id, "❌ 数据库写入失败！");
        bot.sendMessage(msg.chat.id, `✅ **成功锁定新目标！**\n📡 网络/币种: \`${coin}\`\n📌 盯防地址: \`${address}\`\n\n系统已进入24小时全天候巡逻状态。`, { parse_mode: 'Markdown' });
        checkAllWallets(); // 立即去查一次初始余额
    });
});

// 3️⃣ 【/list】指令：列出目前正在监控的所有人
bot.onText(/\/list/, (msg) => {
    db.find({}, (err, docs) => {
        if (err || docs.length === 0) return bot.sendMessage(msg.chat.id, "📱 当前监控清单为空。请输入 \`/add\` 指令添加地址。");
        let reply = "👀 **当前正在全天候死守的巨鲸清单：**\n\n";
        docs.forEach((doc, index) => {
            reply += `${index + 1}. 【${doc.coin}】 \`${doc.address}\`\n`;
        });
        bot.sendMessage(msg.chat.id, reply, { parse_mode: 'Markdown' });
    });
});

// 4️⃣ 【/del】指令：移除某个钱包
bot.onText(/\/del (.+)/, (msg, match) => {
    const address = match[1].trim();
    db.remove({ address: address }, {}, (err, numRemoved) => {
        if (err || numRemoved === 0) return bot.sendMessage(msg.chat.id, "❌ 未找到该地址，请检查是否输入正确。");
        bot.sendMessage(msg.chat.id, `🗑️ 成功解除对地址 \`${address}\` 的警报监控。`, { parse_mode: 'Markdown' });
    });
});

// ------------------- 📡 全网多链资产爬虫核心引擎 -------------------

async function fetchBalance(coin, address) {
    try {
        if (coin === "BTC") {
            const res = await axios.get(`${RPC_NODES.BTC}${address}`);
            return (res.data.final_balance / 1e8).toFixed(4); // 聪换算为BTC
        }
        if (coin === "SOL") {
            const res = await axios.post(RPC_NODES.SOL, {
                jsonrpc: "2.0", id: 1, method: "getBalance", params: [address]
            });
            return (res.data.result.value / 1e9).toFixed(4); // Lamports换算为SOL
        }
        if (coin === "XRP") {
            const res = await axios.post(RPC_NODES.XRP, {
                method: "account_info", params: [{ account: address, ledger_index: "validated" }]
            });
            return (res.data.result.account_data.Balance / 1e6).toFixed(2); // 换算为XRP
        }
        if (coin === "ETH") {
            const res = await axios.post(RPC_NODES.ETH, {
                jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"]
            });
            return (parseInt(res.data.result, 16) / 1e18).toFixed(4);
        }
        if (coin === "USDT") {
            // 默认走BSC链查USDT，速度最快最省带宽
            const dataData = "0x70a08231000000000000000000000000" + address.replace("0x", "").toLowerCase();
            const res = await axios.post(RPC_NODES.BSC, {
                jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: USDT_CONTRACTS.BSC, data: dataData }, "latest"]
            });
            return (Number(BigInt(res.data.result)) / 1e18).toFixed(2);
        }
    } catch (e) {
        console.error(`读取 ${coin} 地址 ${address} 失败，5分钟后重试...`);
        return null;
    }
}

// 核心循环：遍历数据库里的每个人去对账
function checkAllWallets() {
    db.find({}, async (err, docs) => {
        if (err || !docs) return;
        for (let doc of docs) {
            const currentBal = await fetchBalance(doc.coin, doc.address);
            if (currentBal === null) continue;

            if (doc.lastBalance === null) {
                // 初次记录账本
                db.update({ _id: doc._id }, { $set: { lastBalance: currentBal } });
                continue;
            }

            if (currentBal !== doc.lastBalance) {
                const isDiff = Number(currentBal) > Number(doc.lastBalance);
                const changeType = isDiff ? "📥 资金流入 (买入/充值)" : "📤 资金流出 (卖出/转账)";
                const diff = Math.abs(Number(currentBal) - Number(doc.lastBalance)).toFixed(4);

                const alertMsg = `🚨 **【多链巨鲸金额异动提醒】** 🚨\n\n` +
                                 `资产币种: *${doc.coin}*\n` +
                                 `📌 监控地址:\n\`${doc.address}\`\n\n` +
                                 `动态类型: *${changeType}*\n` +
                                 `💰 变动金额: *${diff} ${doc.coin}*\n` +
                                 `📊 钱包当前剩下: *${currentBal} ${doc.coin}*\n\n` +
                                 `⏰ 监听源: Render 私人独占数据卫星`;

                bot.sendMessage(chatId, alertMsg, { parse_mode: 'Markdown' });
                db.update({ _id: doc._id }, { $set: { lastBalance: currentBal } });
            }
        }
    });
}

// 每5分钟自动扫描一次全网账本
setInterval(checkAllWallets, 300000);

// Express 维持开机状态
const app = express();
app.get('/', (req, res) => res.send('Multi-chain Bot running...'));
app.listen(process.env.PORT || 3000);
