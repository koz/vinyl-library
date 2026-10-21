export function ButtonLabel({ children }: { children: string }) {
  return (
    <span className="button-label">
      {children}
      <span className="button-underline" aria-hidden="true">
        {children}
      </span>
    </span>
  )
}
