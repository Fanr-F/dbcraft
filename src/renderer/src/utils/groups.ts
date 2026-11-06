import type { SavedConnection } from '../types';

export interface GroupNode {
  name: string;
  path: string;
  children: GroupNode[];
  connections: SavedConnection[];
}

/**
 * 按 `A/B/C` 路径构建分组树；未分组连接挂在根节点（path 为空串）。
 * 路径片段会 trim，空片段被忽略。
 */
export function buildGroupTree(connections: SavedConnection[]): GroupNode {
  const root: GroupNode = { name: '', path: '', children: [], connections: [] };
  const nodes = new Map<string, GroupNode>([['', root]]);

  for (const connection of connections) {
    const segments = connection.input.group
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);

    let node = root;
    let path = '';

    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let child = nodes.get(path);
      if (!child) {
        child = { name: segment, path, children: [], connections: [] };
        nodes.set(path, child);
        node.children.push(child);
      }
      node = child;
    }

    node.connections.push(connection);
  }

  const sortNode = (node: GroupNode) => {
    node.children.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    node.connections.sort((left, right) =>
      left.input.name.localeCompare(right.input.name, 'zh-CN'),
    );
    for (const child of node.children) sortNode(child);
  };
  sortNode(root);

  return root;
}

/** 分组内的连接总数（含所有子分组）。 */
export function countGroup(node: GroupNode): number {
  return (
    node.connections.length +
    node.children.reduce((total, child) => total + countGroup(child), 0)
  );
}
