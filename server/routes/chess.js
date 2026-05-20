import express from 'express';
import { spawn } from 'child_process';

const router = express.Router();
const STOCKFISH = process.env.STOCKFISH_PATH || 'stockfish';

function runStockfish(fen, depth = 12) {
  return new Promise((resolve, reject) => {
    let bestmove = null;
    let proc;
    try {
      proc = spawn(STOCKFISH);
    } catch (e) {
      return reject(new Error('Stockfish not found. Set STOCKFISH_PATH or install stockfish.'));
    }

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Stockfish timeout'));
    }, 15000);

    proc.stdout.on('data', chunk => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('bestmove ')) {
          bestmove = line.split(' ')[1];
        }
      }
    });

    proc.on('close', () => {
      clearTimeout(timeout);
      if (bestmove) resolve({ bestmove });
      else reject(new Error('No move from Stockfish'));
    });

    proc.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.stdin.write('uci\n');
    proc.stdin.write('isready\n');
    proc.stdin.write(`position fen ${fen}\n`);
    proc.stdin.write(`go depth ${depth}\n`);
  });
}

router.post('/move', async (req, res) => {
  try {
    const { fen, depth } = req.body;
    if (!fen) return res.status(400).json({ error: 'fen required' });
    const result = await runStockfish(fen, depth || 10);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
