/**
 * 写真を長い辺 maxSide px 以下の JPEG に縮めて base64 で返す。
 * AIに送る画像は小さいほど安く速いので、カロリーの見積もりに十分な大きさに抑える。
 */
export async function photoToJpeg(file: File, maxSide = 1024): Promise<{ data: string; mediaType: 'image/jpeg' }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas is not available')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' }
  } finally {
    URL.revokeObjectURL(url)
  }
}
