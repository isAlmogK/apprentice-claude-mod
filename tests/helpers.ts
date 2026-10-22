import type { Elements } from '../src/views/elements.ts'

type Node = { type: string; props: Record<string, any> }

const make = (type: string) => (props: Record<string, unknown>) => ({ type, props })

export const fakeElements: Elements = {
  Box: make('Box'), Text: make('Text'), Button: make('Button'), Code: make('Code'),
  Input: make('Input'), Select: make('Select'), Svg: make('Svg'), Raster: make('Raster'),
}

export function walk(tree: unknown): Node[] {
  if (!tree || typeof tree !== 'object') return []
  const node = tree as Node
  const children = Array.isArray(node.props?.children) ? node.props.children : []
  return [node, ...children.flatMap(walk)]
}

export const byKey = (tree: unknown, key: string) => walk(tree).find(n => n.props?.key === key)

export const textsOf = (tree: unknown) =>
  walk(tree).filter(n => n.type === 'Text').map(n => (n.props.children ?? []).join(''))
