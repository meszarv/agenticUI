import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

const LOG_FILE = path.join(process.cwd(), 'data', 'llm.log');

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const tail = parseInt((req.query.tail as string) || '200', 10);
  const search = (req.query.search as string) || '';

  try {
    if (!fs.existsSync(LOG_FILE)) {
      return res.status(200).json({ lines: [], total: 0 });
    }

    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    let lines = content.split('\n').filter(Boolean);

    if (search) {
      const keywords = search.toLowerCase().split(/\s+/);
      lines = lines.filter((line) =>
        keywords.every((kw) => line.toLowerCase().includes(kw)),
      );
    }

    const total = lines.length;
    const result = lines.slice(-tail);

    res.status(200).json({ lines: result, total });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
