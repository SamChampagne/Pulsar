import fs from 'node:fs';
import path from 'node:path';
import ts from '../apps/web/node_modules/typescript/lib/typescript.js';
import compiler from '../apps/web/node_modules/svelte/compiler/index.js';

const root = process.cwd();
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const files = walk(path.join(root, 'apps/web/src')).filter((file) => file.endsWith('.svelte'));

// Read-only migration preview. Applying edits remains an explicit patch operation.
if (process.argv.includes('--overlays')) {
  const result = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    if (!source.includes('fixed inset-0 z-40 flex items-center justify-center bg-black/40'))
      continue;
    const overlays = [];
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (
        node.type === 'RegularElement' &&
        node.name === 'div' &&
        node.attributes.some(
          (a) => a.name === 'class' && a.value?.some((v) => v.data?.includes('fixed inset-0')),
        )
      ) {
        const panel = node.fragment.nodes.find((n) => n.type === 'RegularElement');
        const children = panel.fragment.nodes.filter(
          (n) => n.type === 'RegularElement' || n.type === 'Component',
        );
        const header = children[0];
        const footer = children.find((n) =>
          n.attributes?.some(
            (a) => a.name === 'class' && a.value?.some((v) => v.data?.includes('justify-end')),
          ),
        );
        overlays.push({
          start: node.start,
          end: node.end,
          bodyStart: source.indexOf('>', panel.start) + 1,
          bodyEnd: panel.end - 6,
          header: { start: header.start, end: header.end },
          footer: footer ? { start: footer.start, end: footer.end } : null,
        });
        return;
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
    }
    visit(compiler.parse(source, { modern: true }).fragment);
    result.push({ file: path.relative(root, file).replaceAll('\\', '/'), overlays });
  }
  process.stdout.write(JSON.stringify(result));
} else if (process.argv.includes('--confirm-patches')) {
  const result = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const match = /<script[^>]*>([\s\S]*?)<\/script>/.exec(text);
    if (!match) continue;
    const script = match[1];
    const source = ts.createSourceFile(
      file + '.ts',
      script,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const edits = [];
    const asyncFunctions = new Set();
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        (node.expression.getText(source) === 'confirm' ||
          node.expression.getText(source) === 'window.confirm')
      ) {
        const original = node.getText(source);
        edits.push({
          before: original,
          after: '(await confirmAction' + original.slice(original.indexOf('(')) + ')',
        });
        let owner = node.parent;
        while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
        if (!owner) throw new Error('Unscoped confirmation: ' + file);
        if (!owner.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword))
          asyncFunctions.add(owner);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (!edits.length) continue;
    for (const owner of asyncFunctions) {
      if (!ts.isFunctionDeclaration(owner))
        throw new Error('Review non-declaration async conversion: ' + file);
      const line = script.slice(owner.getStart(source)).split(/\r?\n/)[0];
      edits.push({ before: line, after: 'async ' + line });
    }
    edits.push({
      before: match[0].slice(0, match[0].indexOf('>') + 1),
      after:
        match[0].slice(0, match[0].indexOf('>') + 1) +
        "\n  import { confirmAction } from '$lib/stores/confirmation';",
    });
    result.push({ file: file.replaceAll('\\', '/'), edits });
  }
  process.stdout.write(JSON.stringify(result));
} else {
  const pages = files.filter((file) => file.endsWith('+page.svelte'));
  process.stdout.write(
    JSON.stringify(
      pages.map((file) => {
        const source = fs.readFileSync(file, 'utf8');
        return {
          route: path
            .relative(path.join(root, 'apps/web/src/routes'), file)
            .replaceAll('\\', '/')
            .replace('/+page.svelte', ''),
          hasPageHeader: source.includes('<PageHeader'),
          headings: [...source.matchAll(/<h[12][^>]*>([^<]{0,100})/g)].map((m) => m[1].trim()),
          nativeConfirm: /\bconfirm\(/.test(source),
          overlays: (source.match(/<Modal|<Drawer/g) ?? []).length,
        };
      }),
    ),
  );
}
