module.exports = async (req, res) => {
  try {
    const r = await fetch('https://csvc.hcmussh.edu.vn/api/bookings', {
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
