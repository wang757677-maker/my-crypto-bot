const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
const { TronWeb } = require('tronweb'); // 引入波场官方库

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

// 钱包数据模型（增加了 lastBlock 用于防止重复通知）
const WalletSchema = new mongoose.Schema({
    address: { type: String, unique: true, required: true },
    coin: { type: String, required: true },
    lastBlock: { type: Number, default: 0 } // 记录上一次检查的区块高度
});
const Wallet = mongoose.model('Wallet', WalletSchema);

const bot = new TelegramBot(token, { polling: true });

// 初始化免费的公共波场节点
const tronWeb = new TronWeb({
    fullHost: 'https://trongrid.io' 
});

const expressApp = express();
expressApp.get('/', (req, res) => res.send('Bot is running'));
expressApp.listen(process.env.PORT || 3000);

// 1️⃣ 处理 /add 指令
bot.onText(/\/add\s+(\S+)\s+(\S+)/, async (msg, match) => {
    const coin = match[1].toUpperCase();
    const address = match[2];
    const targetChatId = msg.chat.id; 

    // 目前仅支持 TRC20 的演示，如果是以 T 开头则视为波场地址
    if (coin === 'USDT' && !address.startsWith('T')) {
        return bot.sendMessage(targetChatId, `❌ 错误：TRC20 地址必须以大写字母 T 开头！`);
    }

    try {
        // 获取当前最新区块，作为初始锚点
        const currentBlock = await tronWeb.trx.getCurrentBlock();
        const blockNum = currentBlock.block_header.raw_data.number;

        await Wallet.create({ address, coin, lastBlock: blockNum });
        bot.sendMessage(targetChatId, `✅ 成功添加监控地址:\n币种: ${coin}\n地址: ${address}\n状态: 实时监控中...`);
    } catch (error) {
        bot.sendMessage(targetChatId, `❌ 数据库写入失败！可能是地址已存在。`);
    }
});

// 2️⃣ 核心轮询：每 15 秒自动扫描一次链上所有被监控地址的流水
setInterval(async () => {
    try {
        const wallets = await Wallet.find({});
        if (wallets.length === 0) return;

        // 获取当前最新区块高度
        const currentBlock = await tronWeb.trx.getCurrentBlock();
        const currentBlockNum = currentBlock.block_header.raw_data.number;

        for (let wallet of wallets) {
            // 如果是首次添加或高度异常，先初始化高度
            if (!wallet.lastBlock) {
                wallet.lastBlock = currentBlockNum - 1;
                await wallet.save();
                continue;
            }

            // 如果链上有了新区块，开始抓取该地址在这些新区块中的交易
            if (currentBlockNum > wallet.lastBlock) {
                try {
                    // 查询该地址近期的 TRC20 (USDT) 交易记录
                    const transactions = await tronWeb.getEventResult({
                        address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", // USDT 智能合约地址
                        eventName: "Transfer",
                        blockNumber: currentBlockNum, // 检查最新区块
                        size: 50
                    });

                    for (let tx of transactions) {
                        const fromAddress = tronWeb.address.fromHex(tx.result.from);
                        const toAddress = tronWeb.address.fromHex(tx.result.to);
                        const value = (parseFloat(tx.result.value) / 1000000).toFixed(2); // 精度转换

                        // 判读转出（付款）
                        if (fromAddress === wallet.address) {
                            // 广播通知到您在群组或特定配置的频道
                            // 注意：这里的通知可以通过在数据库存入入账时的 chatId 动态发送，为了稳妥，暂用全局绑定的 TG_CHAT_ID 或消息来源。
                            // 此处演示直接发往您的全局通知 ID (需确保 Render 里配置了正确的 TG_CHAT_ID)
                            bot.sendMessage(process.env.TG_CHAT_ID, `🚨 【付款通知】\n监控地址: ${wallet.address}\n动作: 💸 转出 USDT\n金额: ${value} USDT\n接收方: ${toAddress}`);
                        }

                        // 判断转入（收款）
                        if (toAddress === wallet.address) {
                            bot.sendMessage(process.env.TG_CHAT_ID, `🎉 【收款通知】\n监控地址: ${wallet.address}\n动作: 💰 收到 USDT\n金额: ${value} USDT\n发送方: ${fromAddress}`);
                        }
                    }

                    // 更新数据库中该地址的检查高度
                    wallet.lastBlock = currentBlockNum;
                    await wallet.save();

                } catch (e) {
                    console.error(`扫描地址 ${wallet.address} 出错:`, e.message);
                }
            }
        }
    } catch (err) {
        console.error("定时轮询监控发生错误:", err);
    }
}, 15000); // 15000毫秒 = 15秒检查一次
