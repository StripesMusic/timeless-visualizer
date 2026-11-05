// Turns picked layer ids into positions in the stack, because ids change when layers are duplicated.
// A tree is [{id, layers?}], top of the stack first. A path is the child index at each depth.

function resolvePicks(tree, ids) {
  const wanted = new Set(ids);
  const found = new Set();

  const note = (node) => {
    if (wanted.has(node.id)) found.add(node.id);
    (node.layers || []).forEach(note);
  };
  tree.forEach(note);

  const fullyPicked = (node) =>
    wanted.has(node.id) || (!!node.layers && node.layers.length > 0 && node.layers.every(fullyPicked));

  const paths = [];
  const walk = (nodes, prefix) => {
    nodes.forEach((node, i) => {
      const path = [...prefix, i];
      if (fullyPicked(node)) paths.push(path);
      else if (node.layers) walk(node.layers, path);
    });
  };
  walk(tree, []);

  return { paths, missing: [...wanted].filter((id) => !found.has(id)) };
}

function isWithin(path, container) {
  return container.length <= path.length && container.every((v, i) => path[i] === v);
}

module.exports = { resolvePicks, isWithin };
