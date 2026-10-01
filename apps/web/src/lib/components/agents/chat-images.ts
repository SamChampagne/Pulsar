export const MAX_CHAT_IMAGES = 4;
const MAX_BYTES = 512 * 1024;

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Encodage de l’image impossible.'))),
      'image/jpeg',
      quality,
    ),
  );
}

async function compact(source: CanvasImageSource, width: number, height: number, name: string) {
  if (!width || !height) throw new Error('Image vide ou illisible.');
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Images indisponibles dans ce navigateur.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.88, 0.72, 0.55, 0.38]) {
    const blob = await encode(canvas, quality);
    if (blob.size <= MAX_BYTES) {
      return new File([blob], `${name.replace(/\.[^.]+$/, '').slice(0, 90) || 'image'}.jpg`, {
        type: 'image/jpeg',
      });
    }
  }
  throw new Error('Image trop détaillée. Recadrez-la avant de la joindre.');
}

/** Re-encode pixels only: no EXIF/GPS metadata; bounded network payload. */
export async function prepareChatImage(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choisissez une image PNG, JPEG ou WebP (pas de PDF/SVG).');
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new Error('L’image source doit faire entre 1 octet et 10 Mo.');
  const bitmap = await createImageBitmap(file);
  try {
    return await compact(bitmap, bitmap.width, bitmap.height, file.name);
  } finally {
    bitmap.close();
  }
}

/** Explicit browser chooser → ONE frame → tracks stopped. Never sends anything. */
export async function captureChatScreen(signal: AbortSignal): Promise<File> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia)
    throw new Error(
      'Capture indisponible ici. Utilisez HTTPS sur un navigateur compatible, ou joignez une capture enregistrée.',
    );
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement('video');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => stream.getTracks().forEach((track) => track.stop());
  signal.addEventListener('abort', stop, { once: true });
  try {
    if (signal.aborted) throw new Error('Capture annulée.');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await Promise.race([
      video.play(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Capture indisponible. Réessayez depuis une fenêtre visible.')),
          10000,
        );
      }),
    ]);
    if (signal.aborted) throw new Error('Capture annulée.');
    // Copy pixels synchronously before stopping the capture; encoding can be asynchronous.
    const frame = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    frame.width = Math.max(1, Math.round(video.videoWidth * scale));
    frame.height = Math.max(1, Math.round(video.videoHeight * scale));
    if (!video.videoWidth || !video.videoHeight) throw new Error('Aucune image reçue.');
    const context = frame.getContext('2d');
    if (!context) throw new Error('Capture indisponible.');
    context.drawImage(video, 0, 0, frame.width, frame.height);
    stop();
    return await compact(frame, frame.width, frame.height, `capture-${Date.now()}.jpg`);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    stop();
    video.pause();
    video.srcObject = null;
  }
}
