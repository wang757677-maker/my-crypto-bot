const axios = require('axios');

function sendNotification(bot, wallet, isOut, value, txId, activeSymbol, counterparty, btcStatus = '') {
    const actionStr = isOut ? `💸 【转出通知】` : `💰 【收款通知】`;
    const arrowStr = isOut ? `支出` : `收到`;
    let explorerUrl = `https://tronscan.org{txId}`;
    if (wallet.chain === 'BTC') explorerUrl = `https://mempool.space{txId}`;
    if (wallet.chain === 'ETH') explorerUrl = `https://etherscan.io{txId}`;
    if (wallet.chain === 'SOL') explorerUrl = `https://solscan.io{txId}`;
    if (wallet.chain === 'XRPL') explorerUrl = `https://xrpscan.com{txId}`;
    const btcExtra = btcStatus ? `📊 记账状态: _${btcStatus}_\n` : '';
    const text = `${actionStr}\n=====================\n🌐 网络: *${wallet.chain}*\n📍 账户: \`${wallet.address.substring(0,8)}...${wallet.address.substring(wallet.address.length-4)}\`\n⚡ 业务: *${arrowStr} ${activeSymbol}*\n💵 金额: *${value}* ${activeSymbol}\n👤 对手: \`${counterparty.substring(0,16)}...\`\n${btcExtra}=====================\n🔗 [详情](${explorerUrl})`;
    bot.sendMessage(process.env.TG_CHAT_ID, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
}

async function scanBitcoin(wallet, bot) {
    const r = await axios.get(`https://mempool.space{wallet.address}/txs`);
    if (!r.data?.length) return;
    const tx = r.data[0];
    if (tx.txid !== wallet.lastTxId) {
        let inV = 0, outV = 0, isP = false;
        if (tx.vin) tx.vin.forEach(i => { if (i.prevout?.scriptpubkey_address === wallet.address) { outV += i.prevout.value; isP = true; } });
        if (tx.vout) tx.vout.forEach(o => { if (o.scriptpubkey_address === wallet.address) { inV += o.value; isP = true; } });
        if (!isP) return;
        const isOut = outV > inV; const net = (Math.abs(outV - inV) / 100000000).toFixed(6);
        const cp = isOut ? (tx.vout.find(o => o.scriptpubkey_address !== wallet.address)?.scriptpubkey_address || '多端') : (tx.vin.find(i => i.prevout?.scriptpubkey_address !== wallet.address)?.prevout?.scriptpubkey_address || '多端');
        sendNotification(bot, wallet, isOut, net, tx.txid, wallet.coin, cp, tx.status.confirmed ? "✅ 已确认" : "⏳ 内存池");
        wallet.lastTxId = tx.txid; await wallet.save();
    }
}

async function scanTron(wallet, bot, apiKey) {
    const c = wallet.contractAddress || "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const h = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {};
            const r = await axios.get(`https://trongrid.io{wallet.address}/transactions/trc20?limit=1&contract_address=${c}`, { headers: h });
    if (!r.data?.data?.length) return;
    const tx = r.data.data[0];
    if (tx.block_timestamp > wallet.lastTxTimestamp) {
        const dec = tx.token_info?.decimals || 6;
        const val = (parseFloat(tx.value) / Math.pow(10, dec)).toFixed(2);
        const isOut = tx.from.toLowerCase() === wallet.address.toLowerCase();
        sendNotification(bot, wallet, isOut, val, tx.transaction_id, tx.token_info?.symbol || 'USDT', isOut ? tx.to : tx.from);
        wallet.lastTxTimestamp = tx.block_timestamp; await wallet.save();
    }
}

async function scanEVM(wallet, bot, apiKey) {
        const url = `https://alchemy.com{apiKey}`;
    const cat = wallet.contractAddress ? ["erc20"] : ["external"];
    const r = await axios.post(url, { jsonrpc: "2.0", id: 1, method: "alchemy_getAssetTransfers", params: [{ toAddress: wallet.address, category: cat, maxCount: "0x1", order: "desc" }] });
    const tx = r.data?.result?.transfers?.[0];
    if (!tx) return;
    if (wallet.contractAddress && tx.rawContract?.address?.toLowerCase() !== wallet.contractAddress.toLowerCase()) return;
    if (tx.hash !== wallet.lastTxId) {
        sendNotification(bot, wallet, false, tx.value ? parseFloat(tx.value).toFixed(4) : "0", tx.hash, tx.asset || wallet.coin, tx.from);
        wallet.lastTxId = tx.hash; await wallet.save();
    }
}

async function scanSolana(wallet, bot, rpcUrl) {
    const sr = await axios.post(rpcUrl, { jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [wallet.address, { limit: 1 }] });
    const sig = sr.data?.result?.[0]?.signature; if (!sig) return;
    if (sig !== wallet.lastTxId) {
        const tr = await axios.post(rpcUrl, { jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }] });
        const txData = tr.data?.result; if (!txData) return;
        let val = "0", isOut = false, cp = "智能合约";
        const insts = txData.transaction?.message?.instructions || [];
        const tInst = insts.find(i => i.program === "system" && i.parsed?.type === "transfer");
        if (tInst) {
            const info = tInst.parsed.info; isOut = info.source === wallet.address;
            val = (parseFloat(info.lamports) / 1000000000).toFixed(4); cp = isOut ? info.destination : info.source;
        }
        sendNotification(bot, wallet, isOut, val, sig, 'SOL', cp);
        wallet.lastTxId = sig; await wallet.save();
    }
}

async function scanXRP(wallet, bot, rpcUrl) {
    const r = await axios.post(rpcUrl, { method: "account_tx", params: [{ account: wallet.address, limit: 1, ledger_index_min: -1, ledger_index_max: -1 }] });
    const txObj = r.data?.result?.transactions?.[0];
    if (!txObj || !txObj.tx_ok) return;
    if (txObj.tx.hash !== wallet.lastTxId) {
        const d = txObj.tx;
        if (d.TransactionType === "Payment" && typeof d.Amount === "string") {
            const isOut = d.Account === wallet.address; const val = (parseFloat(d.Amount) / 1000000).toFixed(2);
            sendNotification(bot, wallet, isOut, val, d.hash, 'XRP', isOut ? d.Destination : d.Account);
        }
        wallet.lastTxId = d.hash; await wallet.save();
    }
}

module.exports = { scanBitcoin, scanTron, scanEVM, scanSolana, scanXRP };
