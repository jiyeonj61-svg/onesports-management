import { data } from './data.js';

export { escapeHtml } from './common.js';
export const getClient = () => data.getClient();
export const todayKst = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const BUCKET = 'member-service-files';

export async function service(action, payload = {}) {
  return callService('member_service', action, payload);
}

export async function guestService(action, payload = {}) {
  return callService('guest_service', action, payload);
}

async function callService(rpc, action, payload) {
  if (navigator.onLine === false) throw new Error('오프라인입니다. 연결을 확인한 뒤 다시 시도해 주세요. 저장되지 않았습니다.');
  const client = await getClient();
  const { data: result, error } = await client.rpc(rpc, { action, payload });
  if (error) {
    if (['PGRST202', '42883', '42P01'].includes(error.code)) throw new Error('회원서비스 데이터베이스 준비 중입니다. 관리자에게 문의해 주세요.');
    throw new Error(error.message || '서버에서 요청을 처리하지 못했습니다.');
  }
  if (!result || result.ok === false) throw new Error(result?.error || '서버 응답을 확인하지 못했습니다. 내 신청내역을 확인해 주세요.');
  return result;
}

// Re-encode decoded pixels before upload to remove metadata and reject non-image content.
export async function uploadPhoto(file, { kind, recordId } = {}) {
  if (!['posts', 'requests', 'applications'].includes(kind)) throw new Error('올바르지 않은 사진 구분입니다.');
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG·PNG·WebP 사진을 선택해 주세요. HEIC 사진은 JPG로 변환해 주세요.');
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('사진은 8MB 이하로 선택해 주세요.');
  const client = await getClient();
  const { data: auth, error } = await client.auth.getUser();
  if (error || !auth.user) throw new Error('사진을 첨부하려면 다시 로그인해 주세요.');
  if (kind === 'posts' && !/^[a-f0-9-]{36}$/i.test(recordId || '')) throw new Error('게시글을 먼저 임시저장해 주세요.');
  const bitmap = await createImageBitmap(file);
  if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 60000000) {
    bitmap.close(); throw new Error('사진 해상도가 너무 큽니다. 크기를 줄여 주세요.');
  }
  const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const contentType = kind === 'applications' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise(resolve => canvas.toBlob(resolve, contentType, 0.88));
  if (!blob || blob.size > 8 * 1024 * 1024) throw new Error('사진을 변환하지 못했습니다. 다른 사진을 선택해 주세요.');
  const path = `${kind}/${kind === 'posts' ? recordId : auth.user.id}/${crypto.randomUUID()}.${kind === 'applications' ? 'png' : 'jpg'}`;
  const uploaded = await client.storage.from(BUCKET).upload(path, blob, { contentType, cacheControl: '0', upsert: false });
  if (uploaded.error) throw new Error(uploaded.error.message || '사진을 저장하지 못했습니다.');
  return path;
}

export async function photoUrl(path) {
  if (typeof path !== 'string' || !/^(posts|requests|applications)\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp)$/i.test(path)) throw new Error('유효하지 않은 첨부파일입니다.');
  const client = await getClient();
  const { data: signed, error } = await client.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error) throw new Error('사진 열람 권한이 없거나 사진이 만료되었습니다.');
  return signed.signedUrl;
}

// Guest images use bounded private DB payloads, never public Storage objects.
function base64FromBlob(blob) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('사진 데이터를 읽지 못했습니다.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
}
export async function encodeGuestPhoto(file, signature = false) {
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || !file.size || file.size > 8*1024*1024) throw new Error('사진은 JPG·PNG·WebP 형식, 원본 장당 8MB 이하로 선택해 주세요.');
  const bitmap = await createImageBitmap(file);
  if (!bitmap.width || !bitmap.height || bitmap.width*bitmap.height > 60000000) { bitmap.close(); throw new Error('사진 해상도가 너무 큽니다. 크기를 줄여 주세요.'); }
  const mime = signature ? 'image/png' : 'image/jpeg';
  let scale = Math.min(1, 1400/Math.max(bitmap.width,bitmap.height));
  let blob;
  try {
    for (let attempt=0;attempt<5;attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale));
      const ctx = canvas.getContext('2d');
      if (!signature) { ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); }
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      blob = await new Promise(resolve => canvas.toBlob(resolve,mime,0.78));
      if (blob && blob.size <= 512*1024) break;
      scale *= 0.7;
    }
  } finally { bitmap.close(); }
  if (!blob || blob.size > 512*1024) throw new Error('사진 용량을 줄이지 못했습니다. 더 작은 사진을 선택해 주세요.');
  return { mime, base64: await base64FromBlob(blob) };
}
