/** A photo or PDF as base64, ready to upload. Photos are shrunk in the browser so phone pictures fit; PDFs must already be small. */
export interface PhotoData { name: string; type: string; data: string }

const MAX_CHARS = 680_000;

const read = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Could not read the file.'));
  r.readAsDataURL(blob);
});

export async function shrinkPhoto(file: File, allowPdf = true): Promise<PhotoData> {
  if (file.type === 'application/pdf') {
    if (!allowPdf) throw new Error('Please use a photo here, not a PDF.');
    const data = await read(file);
    if (data.length > MAX_CHARS) throw new Error('This PDF is too large. Use one under 500 KB, or photograph the bill instead.');
    return { name: file.name, type: file.type, data };
  }
  if (!file.type.startsWith('image/')) throw new Error('Please choose a photo (JPG or PNG).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not open this image.'));
      i.src = url;
    });
    for (const [max, q] of [[1400, 0.7], [1100, 0.6], [800, 0.55]] as const) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const blob: Blob = await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the image.'))), 'image/jpeg', q));
      const data = await read(blob);
      if (data.length <= MAX_CHARS) return { name: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', data };
    }
    throw new Error('This photo is too large even after shrinking. Try taking it again.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
