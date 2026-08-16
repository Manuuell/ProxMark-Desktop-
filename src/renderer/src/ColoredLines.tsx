import { lineClass } from './highlight'

interface Props {
  text: string
}

export default function ColoredLines({ text }: Props) {
  return (
    <>
      {text.split('\n').map((l, i) => (
        <div key={i} className={`line ${lineClass(l)}`}>
          {l || '\u00A0'}
        </div>
      ))}
    </>
  )
}
