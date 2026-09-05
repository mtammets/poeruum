import { useId } from 'react'
import { getCardFontFamily, layoutText } from './fonts'
import { getQrMatrix } from './qr'
import { MM_PER_PT, type CardDocument, type CardElement, type CardSideId } from './model'

export function CardElementArtwork({ element: el }: { element: CardElement }) {
  const clipId = useId().replaceAll(':', '')
  if (el.type === 'image' && el.src) {
    const scale = Math.max(el.width / (el.pixelWidth || 1), el.height / (el.pixelHeight || 1))
    const width = (el.pixelWidth || 1) * scale
    const height = (el.pixelHeight || 1) * scale
    return <>
      <defs><clipPath id={clipId}><rect width={el.width} height={el.height} /></clipPath></defs>
      <image href={el.src} x={(el.width - width) * (el.cropX ?? 50) / 100} y={(el.height - height) * (el.cropY ?? 50) / 100} width={width} height={height} preserveAspectRatio="none" clipPath={`url(#${clipId})`} />
    </>
  }
  if (el.type === 'text') {
    const layout = layoutText(el)
    return <>
      <defs><clipPath id={clipId}><rect width={el.width} height={el.height} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`} fill={el.color || '#244d3c'} fontFamily={getCardFontFamily(el.fontFamily || 'sans')} fontWeight={el.fontWeight || 400} fontSize={(el.fontSize || 14) * MM_PER_PT} style={{ fontKerning: 'none', fontVariantLigatures: 'none', fontFeatureSettings: '"kern" 0, "liga" 0, "clig" 0, "calt" 0' }}>
        {layout.lines.map((line, index) => <text key={index} x={line.x} y={line.baseline} xmlSpace="preserve">{line.text}</text>)}
      </g>
    </>
  }
  if (el.type === 'qr') {
    try {
      const matrix = getQrMatrix(el.qrValue || 'https://poeruum.ee')
      const size = Math.min(el.width, el.height)
      const unit = size / matrix.size
      let path = ''
      matrix.data.forEach((cell, i) => { if (cell) path += `M${(i % matrix.size) * unit} ${Math.floor(i / matrix.size) * unit}h${unit}v${unit}h-${unit}z` })
      return <g transform={`translate(${(el.width - size) / 2} ${(el.height - size) / 2})`}><rect width={size} height={size} fill="#ffffff" /><path d={path} fill={el.color || '#17231c'} /></g>
    } catch { return <rect width={el.width} height={el.height} fill="#f7dddd" /> }
  }
  if (el.shape === 'ellipse') return <ellipse cx={el.width / 2} cy={el.height / 2} rx={el.width / 2} ry={el.height / 2} fill={el.color} />
  return <rect width={el.width} height={el.height} fill={el.color} />
}

export function CardThumbnail({ document: doc, side }: { document: CardDocument; side: CardSideId }) {
  return <svg viewBox={`0 0 ${doc.width} ${doc.height}`} aria-hidden="true" style={{ background: doc.sides[side].background }}>
    {doc.sides[side].elements.map((el) => <g key={el.id} transform={`translate(${el.x} ${el.y}) rotate(${el.rotation} ${el.width / 2} ${el.height / 2})`}><CardElementArtwork element={el} /></g>)}
  </svg>
}
