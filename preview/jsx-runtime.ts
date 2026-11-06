// Fake JSX runtime: turns the pane's tree into plain nodes that serve.ts prints as HTML.
export type Node = { type: string; props: Record<string, any> }
export const jsx = (type: any, props: Record<string, any>, key?: string): Node => ({ type, props: { ...props, key: key ?? props?.key } })
export const jsxs = jsx
export const Fragment = 'Fragment'
