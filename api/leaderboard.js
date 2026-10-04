import { get, put } from '@vercel/blob';

const PATHNAME = 'leaderboard.json';
const SEED = [
  { name: 'ACE', time: 24.86, createdAt: 0 },
  { name: 'JAX', time: 27.14, createdAt: 0 },
  { name: 'RCR', time: 29.72, createdAt: 0 },
  { name: 'TJM', time: 32.08, createdAt: 0 },
  { name: 'BUB', time: 34.91, createdAt: 0 }
];

function cleanScores(input) {
  if (!Array.isArray(input)) return [...SEED];
  return input
    .filter(s => s && /^[A-Z]{3}$/.test(String(s.name || '')) && Number.isFinite(Number(s.time)))
    .map(s => ({
      name: String(s.name).toUpperCase(),
      time: Math.round(Number(s.time) * 1000) / 1000,
      createdAt: Number(s.createdAt) || 0
    }))
    .filter(s => s.time >= 5 && s.time <= 600)
    .sort((a, b) => a.time - b.time || a.createdAt - b.createdAt)
    .slice(0, 25);
}

async function readScores() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('Leaderboard storage is not configured.');

  const result = await get(PATHNAME, {
    access: 'public',
    token,
    useCache: false
  });

  if (!result || result.statusCode !== 200) return [...SEED];

  try {
    const text = await new Response(result.stream).text();
    return cleanScores(JSON.parse(text));
  } catch {
    return [...SEED];
  }
}

async function writeScores(scores) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  await put(PATHNAME, JSON.stringify(scores), {
    access: 'public',
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    if (req.method === 'GET') {
      const scores = await readScores();
      return res.status(200).json({ scores: scores.slice(0, 10) });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const name = String(body.name || '').trim().toUpperCase();
      const time = Number(body.time);

      if (!/^[A-Z]{3}$/.test(name)) {
        return res.status(400).json({ error: 'Initials must be exactly 3 letters.' });
      }
      if (!Number.isFinite(time) || time < 5 || time > 600) {
        return res.status(400).json({ error: 'Invalid pit-stop time.' });
      }

      const scores = await readScores();
      const entry = {
        name,
        time: Math.round(time * 1000) / 1000,
        createdAt: Date.now()
      };

      const next = cleanScores([...scores, entry]);
      await writeScores(next);

      const rank = next.findIndex(s =>
        s.name === entry.name &&
        Math.abs(s.time - entry.time) < 0.0005 &&
        s.createdAt === entry.createdAt
      ) + 1;

      return res.status(200).json({
        saved: true,
        rank: rank || null,
        scores: next.slice(0, 10)
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    console.error('Leaderboard API error:', error);
    return res.status(500).json({ error: 'Leaderboard is temporarily unavailable.' });
  }
}