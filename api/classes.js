// Địa chỉ web mượn phòng học (không có dấu / ở cuối).
const HOST = process.env.ROOMS_HOST || 'https://dkph.hcmussh.edu.vn';

module.exports = async (req, res) => {
  const { from, days } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{1,3}$/.test(days || '')) {
    res.status(400).json({ error: 'from hoặc days không hợp lệ' });
    return;
  }
  try {
    const r = await fetch(`${HOST}/api?from=${from}&days=${days}`, {
      headers: { accept: 'application/json' },
    });
    const text = await r.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(r.status).send(text);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
};
