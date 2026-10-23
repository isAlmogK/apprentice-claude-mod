export type Ctor = (props: Record<string, unknown>) => unknown

export type Elements = {
  Box: Ctor
  Text: Ctor
  Button: Ctor
  Code: Ctor
  Input?: Ctor
  Select?: Ctor
  Svg?: Ctor
  Raster?: Ctor
}

export function line(E: Elements, text: string, props: Record<string, unknown> = {}): unknown {
  return E.Text({ ...props, children: [text] })
}
