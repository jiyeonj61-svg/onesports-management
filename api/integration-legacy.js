const { staffLoginTarget } = require('../lib/integration-entry.cjs');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const loginUrl = staffLoginTarget(process.env);
    if (!loginUrl) throw new Error('Integration disabled');
    // Do not inspect or forward the retired Bearer token, body, path or cookie.
    res.statusCode = 410;
    res.end(JSON.stringify({ error: '기존 관리자 접속이 중지되었습니다. 통합 앱의 현장 직원 로그인으로 접속해 주세요.', loginUrl }));
  } catch {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: '통합 로그인 주소 설정을 확인해 주세요. 기존 관리자 접속은 중지되었습니다.' }));
  }
};
