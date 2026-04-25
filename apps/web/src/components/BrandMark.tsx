export function BrandMark({
  size = 'md',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <span className={`brand-mark brand-mark-${size} ${className}`.trim()} aria-hidden="true">
      <img src="/brand/leadfill-mark.svg" alt="" />
    </span>
  )
}
