export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 900 * 1024; // storage bucket limit is 1 MB

function toBlob(canvas: HTMLCanvasElement, type: string, q: number) {
  return new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
}

/** Resizes and re-encodes an image in the browser (this also strips EXIF metadata). */
export async function compressImage(file: File): Promise<Blob> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) throw new Error('نوع الملف غير مسموح (JPG أو PNG أو WebP فقط)');
  if (file.size > MAX_INPUT_BYTES) throw new Error('حجم الصورة أكبر من 10 ميغابايت');
  const bmp = await createImageBitmap(file);
  let maxDim = 1600;
  let quality = 0.8;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    let blob = await toBlob(canvas, 'image/webp', quality);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality);
    if (blob && blob.size <= MAX_OUTPUT_BYTES) return blob;
    maxDim = Math.round(maxDim * 0.8);
    quality = Math.max(0.5, quality - 0.1);
  }
  throw new Error('تعذّر تصغير الصورة إلى الحجم المسموح');
}

export const extFor = (b: Blob) => (b.type === 'image/webp' ? 'webp' : b.type === 'image/png' ? 'png' : 'jpg');
