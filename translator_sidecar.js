const http = require('http');
const url = require('url');

/**
 * AI BOOK READER: TRANSLATION SIDECAR (Node.js v24+)
 */

const SOURCE_URL = "https://translate.googleapis.com/translate_a/single?client=gtx&sl={sl}&tl={tl}&dt=t&q={text}";

async function translateText(text, sourceLang, targetLang, attempt = 1) {
    if (!text || text.trim().length === 0) return text;
    try {
        const encodedText = encodeURIComponent(text.trim());
        const sl = sourceLang || "auto";
        const targetUrl = SOURCE_URL.replace("{sl}", sl).replace("{tl}", targetLang).replace("{text}", encodedText);

        // Emulate a modern browser to reduce scraping detection / 429 errors
        const response = await fetch(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            signal: AbortSignal.timeout(10000) // 10s timeout per item
        });

        if (!response.ok) {
            console.error(`Sidecar: HTTP ${response.status} for "${text.substring(0, 15)}..."`);
            if (response.status === 429 && attempt < 3) {
                await new Promise(r => setTimeout(r, 2000 * attempt)); // Increased backoff
                return translateText(text, sourceLang, targetLang, attempt + 1);
            }
            return null; // Return null on total failure
        }

        const data = await response.json();
        if (data && data[0] && data[0][0]) {
            return data[0].map(segment => segment[0]).join('');
        }
    } catch (e) {
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 2000 * attempt));
            return translateText(text, sourceLang, targetLang, attempt + 1);
        }
        console.error(`Sidecar: Failed after 3 attempts: ${e.message}`);
    }
    return null; // Return null on total failure
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/translate') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const { texts, target_lang, source_lang } = JSON.parse(body);
                if (!texts || !Array.isArray(texts)) {
                    res.writeHead(400); return res.end('Invalid texts');
                }

                // DEEP-BATCHED PARALLEL PROCESSING:
                // We join strings into blocks of approx 4,000 characters to ensure we never
                // exceed the translation API payload limits while maximizing efficiency.
                const results = [];
                const MAX_CHAR_PER_BATCH = 4500; // Optimal balance for Google Translate API limits
                const PARALLE_BATCHES = 4; // Faster concurrency window
                const TAG = " [[~]] ";

                const processBigBatch = async (batch) => {
                    const combined = batch.join(TAG);
                    try {
                        const translated = await translateText(combined, source_lang, target_lang);
                        if (!translated) throw new Error("Translation returned null");
                        
                        // Robust splitting that handles various whitespace-preserving behaviors of translation engines
                        const parts = translated.split(/\s*\[\[~\]\]\s*/);
                        
                        if (parts.length === batch.length) {
                             return parts.map(p => p.trim());
                        }
                        
                        console.warn(`Sidecar Cluster: Split mismatch (${parts.length}/${batch.length}). Falling back to individual retry.`);
                    } catch (e) {
                        console.error(`Sidecar Cluster: Batch Error: ${e.message}`);
                    }
                    // INDIVIDUAL RECOVERY
                    const individualResults = [];
                    for (const t of batch) {
                        individualResults.push(await translateText(t, source_lang, target_lang));
                        await new Promise(r => setTimeout(r, 10)); // Minimal safety delay
                    }
                    return individualResults;
                };

                const charBatches = [];
                let currentBatch = [];
                let currentBatchLen = 0;

                for (const t of texts) {
                    if (currentBatchLen + t.length > MAX_CHAR_PER_BATCH && currentBatch.length > 0) {
                        charBatches.push(currentBatch);
                        currentBatch = [];
                        currentBatchLen = 0;
                    }
                    currentBatch.push(t);
                    currentBatchLen += t.length + TAG.length;
                }
                if (currentBatch.length > 0) charBatches.push(currentBatch);

                // HIGH-CONCURRENCY PIPELINE
                for (let i = 0; i < charBatches.length; i += PARALLE_BATCHES) {
                    const chunkWindow = charBatches.slice(i, i + PARALLE_BATCHES);
                    const windowResults = await Promise.all(chunkWindow.map(c => processBigBatch(c)));
                    windowResults.forEach(r => results.push(...r));

                    // Use immediate resolution for next tick to avoid blocking the event loop
                    if (i + PARALLE_BATCHES < charBatches.length) {
                        await new Promise(r => setTimeout(r, 50)); 
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(results));
            } catch (e) {
                res.writeHead(500); res.end(e.message);
            }
        });
    } else {
        res.writeHead(404); res.end();
    }
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`🌍 Translation Sidecar active on port ${PORT}`);
});
