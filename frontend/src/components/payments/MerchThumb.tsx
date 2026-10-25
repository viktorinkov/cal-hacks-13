import { cn } from '@/lib/utils'
import type { PrintArea } from '@/payments/rows'

function shapeOf(kind: string, title: string): 'tee' | 'mug' | 'poster' {
  const words = `${kind} ${title}`.toLowerCase()
  if (/mug|cup/.test(words)) return 'mug'
  if (/poster|print|sticker/.test(words)) return 'poster'
  return 'tee'
}

const BOX = { tee: [1000, 1000], mug: [1000, 800], poster: [800, 1000] } as const

/**
 * The piece with the night's photo in its print area. With no product image, the piece is drawn in the
 * desk's greys so the photo still sits where it will be printed.
 */
export function MerchThumb({ kind, title, imageUrl, photoUrl, area, className, decorative = false }: {
  kind: string; title: string; imageUrl: string; photoUrl: string; area: PrintArea; className?: string; decorative?: boolean
}) {
  const shape = shapeOf(kind, title)
  const [w, h] = area.width > 0 && area.height > 0 ? [area.width, area.height] : BOX[shape]
  const print = area.w > 0 && area.h > 0 ? area : { x: w * 0.33, y: h * 0.3, w: w * 0.34, h: h * 0.34, width: w, height: h }
  const pct = (value: number, of: number) => `${(value / of) * 100}%`
  return (
    <div
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : `${title}${photoUrl ? ', with your photo printed on it' : ''}`}
      aria-hidden={decorative || undefined}
      className={cn('relative overflow-hidden rounded-[8px] bg-raised', className)}
      style={{ aspectRatio: `${w} / ${h}` }}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
          {shape === 'tee' && <path d="M300 120 L410 86 Q500 150 590 86 L700 120 L900 262 L822 404 L742 352 L742 904 L258 904 L258 352 L178 404 L100 262 Z" fill="#26262a" />}
          {shape === 'mug' && (
            <>
              <rect x="200" y="150" width="460" height="520" rx="34" fill="#26262a" />
              <path d="M660 270 h70 a120 120 0 0 1 0 280 h-70" fill="none" stroke="#26262a" strokeWidth="56" />
            </>
          )}
          {shape === 'poster' && <rect x="40" y="40" width="720" height="920" fill="#26262a" />}
          {!photoUrl && <rect x={print.x} y={print.y} width={print.w} height={print.h} fill="#323237" />}
        </svg>
      )}
      {photoUrl && (
        <img
          src={photoUrl}
          alt=""
          className="absolute object-cover"
          style={{ left: pct(print.x, w), top: pct(print.y, h), width: pct(print.w, w), height: pct(print.h, h) }}
        />
      )}
    </div>
  )
}
