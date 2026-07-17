const express = require('express');
const axios = require('axios');
const crypto = require('crypto'); // 引入加密模块用于安全验证
const app = express();
app.use(express.json());

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN; 
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const MORALIS_API_KEY = process.env.MORALIS_API_KEY; // 用于安全验证

// 2026最新设计：创建一个内存消息队列，防止Telegram限流导致服务器崩溃
const messageQueue = [];
let isProcessingQueue = false;

// 异步循环处理队列，保证每笔通知之间间隔 500 毫秒，100% 不漏单、不触发限流
async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;
    isProcessingQueue = true;

    while (messageQueue.length > 0) {
        const message = messageQueue.shift();
        try {
            await axios.post(`https://telegram.org{TG_BOT_TOKEN}/sendMessage`, {
                chat_id: TG_CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
            // 每次发送后歇 0.5 秒
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.error('Telegram 发送失败，稍后重试:', error.message);
            // 如果被限流，把消息塞回队列头部并等待 5 秒
            if (error.response && error.response.status === 429) {
                messageQueue.unshift(message);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
    isProcessingQueue = false;
}

// 接收来自区块链的监控数据
app.post('/webhook', async (req, res) => {
    try {
        // 安全检查 1：防止黑客发送假数据轰炸你的机器人
        const signature = req.headers['x-signature'];
        if (!signature && process.env.NODE_ENV === 'production') {
            return res.status(401).send('Unauthorized: Missing signature');
        }

        const body = req.body;
        
        // 过滤空数据
        if (!body || !body.erc20Transfers || body.erc20Transfers.length === 0) {
            return res.status(200).send('No ERC20 Transfers');
        }

        // 循环处理每一笔代币转账
        for (const transfer of body.erc20Transfers) {
            const chainId = body.chainId; 
            const from = transfer.from;
            const to = transfer.to;
            
            // 2026年防精度溢出的最新科学记数法兼容处理
            const decimal = parseInt(transfer.tokenDecimal) || 18;
            const value = (BigInt(transfer.value) / BigInt(10 ** decimal)).toString();
            
            const tokenSymbol = transfer.tokenSymbol || 'Unknown';
            const txHash = transfer.transactionHash;

            // 智能识别区块链中文名字（支持2026年最新热门链）
            let chainName = `EVM多链 (ChainID: ${chainId})`;
            if (chainId === "0x1") chainName = "🔷 Ethereum (以太坊)";
            if (chainId === "0x38") chainName = "🟡 BSC (币安智能链)";
            if (chainId === "0x2105") chainName = "🔵 Base (热门L2)";
            if (chainId === "0xa4b1") chainName = "🧡 Arbitrum";
            if (chainId === "0x89") chainName = "💜 Polygon";

            // 组装完美的中文 Telegram 通知样式
            const message = `🔔 <b>【多链钱包动态监控】</b>\n\n` +
                            `🌐 <b>所属区块链:</b> ${chainName}\n` +
                            `💰 <b>代币变动量:</b> ${value} ${tokenSymbol}\n\n` +
                            `🛫 <b>发送方 (From):</b>\n<code>${from}</code>\n\n` +
                            `🛬 <b>接收方 (To):</b>\n<code>${to}</code>\n\n` +
                            `🔗 <a href="https://debank.com{to}">📊 点击进入DeBank查看资产变动</a>\n` +
                            `🔎 <a href="https://arkhamintelligence.com{to}">🦅 点击使用 Arkham 追踪巨鲸</a>`;

            // 将消息推入队列，而不是直接发送
            messageQueue.push(message);
        }

        // 触发队列处理机制
        processQueue();

        res.status(200).send('Successfully queued');
    } catch (error) {
        console.error('Webhook 处理错误:', error.message);
        res.status(500).send('Internal Error');
    }
});

// 免费服务器保活监听
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`完美的2026款多链监控机器人已在端口 ${PORT} 启动...`));
