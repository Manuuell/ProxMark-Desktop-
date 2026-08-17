// Marca de la app: bobina de antena RFID + ondas. Va inline (el CSP prohíbe
// data: URIs, así que nada de importar el PNG/SVG como asset).
export function Logo({ size = 20 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M2 19 L2 7 L18 7 L18 23 L6 23 L6 11 L14 11 L14 19 L10 19"
        strokeWidth="1.9"
      />
      <circle cx="10" cy="15" r="1.6" fill="currentColor" stroke="none" />
      <path d="M23.2 10.2 A14 14 0 0 0 15.9 2.3" strokeWidth="1.7" opacity="0.9" />
      <path d="M26.4 9 A17.5 17.5 0 0 0 17.4 1.1" strokeWidth="1.7" opacity="0.5" />
    </svg>
  )
}
