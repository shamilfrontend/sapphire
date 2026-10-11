/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import * as babel from '@babel/core';

const PREFIX = 'void-';
const IGNORE = '@@';

const prefixOne = (token) => {
  if (!token) {
    return '';
  }
  if (token.startsWith(IGNORE)) {
    return token.slice(IGNORE.length);
  }
  const lastColon = token.lastIndexOf(':');
  const selector = token.slice(0, lastColon + 1);
  let className = token.slice(lastColon + 1);
  let important = '';
  let negative = '';
  if (className.startsWith('!')) {
    important = '!';
    className = className.slice(1);
  }
  if (className.startsWith('-')) {
    negative = '-';
    className = className.slice(1);
  }
  if (!className || className.startsWith(PREFIX)) {
    return token;
  }
  return `${selector}${negative}${important}${PREFIX}${className}`;
};

const prefixClassString = (value) =>
  value
    .split(/[\s\n]+/g)
    .map((token) => prefixOne(token))
    .join(' ');

const t = babel.types;

const withPrefixAdded = (expr) => {
  if (!expr) {
    return expr;
  }
  if (t.isParenthesizedExpression(expr)) {
    return t.parenthesizedExpression(withPrefixAdded(expr.expression));
  }
  if (t.isStringLiteral(expr)) {
    return t.stringLiteral(prefixClassString(expr.value));
  }
  if (t.isTemplateLiteral(expr)) {
    return t.templateLiteral(
      expr.quasis.map((quasi) => {
        const next = prefixClassString(quasi.value.raw);
        return t.templateElement({ raw: next, cooked: next }, quasi.tail);
      }),
      expr.expressions.map((child) => withPrefixAdded(child)),
    );
  }
  if (t.isConditionalExpression(expr)) {
    return t.conditionalExpression(
      expr.test,
      withPrefixAdded(expr.consequent),
      withPrefixAdded(expr.alternate),
    );
  }
  if (t.isLogicalExpression(expr)) {
    if (expr.operator === '&&') {
      return t.logicalExpression(expr.operator, expr.left, withPrefixAdded(expr.right));
    }
    return t.logicalExpression(
      expr.operator,
      withPrefixAdded(expr.left),
      withPrefixAdded(expr.right),
    );
  }
  if (t.isArrayExpression(expr)) {
    return t.arrayExpression(expr.elements.map((el) => (el ? withPrefixAdded(el) : el)));
  }
  if (t.isObjectExpression(expr)) {
    return t.objectExpression(
      expr.properties.map((prop) => {
        if (!t.isObjectProperty(prop) || prop.computed) {
          return prop;
        }
        if (t.isIdentifier(prop.key)) {
          return t.objectProperty(t.stringLiteral(prefixOne(prop.key.name)), prop.value);
        }
        if (t.isStringLiteral(prop.key)) {
          return t.objectProperty(t.stringLiteral(prefixClassString(prop.key.value)), prop.value);
        }
        return prop;
      }),
    );
  }
  return expr;
};

const prefixClassExpr = (expr) => {
  let parsed;
  try {
    parsed = babel.parseSync(`(${expr})`, {
      filename: 'class-expr.ts',
      configFile: false,
      babelrc: false,
      parserOpts: { plugins: ['typescript'] },
    });
  } catch {
    return expr;
  }
  const statement = parsed.program.body[0];
  if (!statement || !t.isExpressionStatement(statement)) {
    return expr;
  }
  statement.expression = withPrefixAdded(statement.expression);
  const generated = babel.transformFromAstSync(parsed, undefined, {
    filename: 'class-expr.ts',
    configFile: false,
    babelrc: false,
    comments: false,
    compact: true,
    generatorOpts: {
      compact: true,
      jsescOption: { quotes: 'single' },
    },
  });
  let code = (generated?.code ?? '').trim().replace(/;$/, '');
  if (code.startsWith('(') && code.endsWith(')')) {
    code = code.slice(1, -1);
  }
  return code || expr;
};

const prefixTemplate = (template) => {
  let next = template.replace(/:class="([^"]*)"/g, (_, expr) => `:class="${prefixClassExpr(expr)}"`);
  next = next.replace(/:class='([^']*)'/g, (_, expr) => `:class='${prefixClassExpr(expr)}'`);
  next = next.replace(/(^|[^:])class="([^"]*)"/g, (_, lead, value) => `${lead}class="${prefixClassString(value)}"`);
  next = next.replace(/(^|[^:])class='([^']*)'/g, (_, lead, value) => `${lead}class='${prefixClassString(value)}'`);
  return next;
};

const CLASS_PROP_NAMES = new Set(['class', 'className']);

/** Строка похожа на список Tailwind-классов (а не на произвольный текст). */
const looksLikeClassList = (value) => {
  if (!value || typeof value !== 'string') {
    return false;
  }
  if (!/[\s-]/.test(value) && !/^(flex|grid|block|hidden|relative|absolute|fixed|sticky)$/.test(value)) {
    return false;
  }
  return /(?:^|[\s:])(?:!?-?(?:bg|text|border|ring|outline|from|via|to|fill|stroke|decoration|divide|placeholder|accent|caret|shadow|opacity|blur|brightness|contrast|grayscale|hue|invert|saturate|sepia|backdrop|flex|grid|items|justify|content|self|place|gap|space|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|w|h|min|max|size|overflow|truncate|whitespace|break|rounded|font|leading|tracking|align|underline|line|list|table|border|cursor|select|pointer|resize|scroll|snap|touch|user|visible|invisible|z|top|right|bottom|left|inset|order|grow|shrink|basis|col|row|auto|object|transition|duration|ease|delay|animate|origin|scale|rotate|translate|skew|transform|opacity|mix|isolation)-|[a-z]+-\d|flex|grid|block|inline|hidden|relative|absolute)/.test(
    value,
  );
};

const prefixClassListLiteral = (node) => {
  if (t.isStringLiteral(node) && looksLikeClassList(node.value)) {
    return t.stringLiteral(prefixClassString(node.value));
  }
  if (t.isTemplateLiteral(node)) {
    const raw = node.quasis.map((q) => q.value.raw).join('');
    if (looksLikeClassList(raw) || node.expressions.length > 0) {
      return withPrefixAdded(node);
    }
  }
  return node;
};

const prefixTsAst = (ast, { prefixReturns = false } = {}) => {
  babel.traverse(ast, {
    ObjectProperty(path) {
      if (path.node.computed) {
        return;
      }
      const key = path.node.key;
      const name = t.isIdentifier(key) ? key.name : t.isStringLiteral(key) ? key.value : null;
      if (!name || !CLASS_PROP_NAMES.has(name)) {
        return;
      }
      path.node.value = withPrefixAdded(path.node.value);
    },
    ...(prefixReturns
      ? {
          ReturnStatement(path) {
            if (!path.node.argument) {
              return;
            }
            const arg = path.node.argument;
            if (t.isStringLiteral(arg) || t.isTemplateLiteral(arg) || t.isConditionalExpression(arg)) {
              // return 'text-void-fg-1' / ternary class lists in computed helpers
              const visit = (expr) => {
                if (t.isStringLiteral(expr) || t.isTemplateLiteral(expr)) {
                  return prefixClassListLiteral(expr);
                }
                if (t.isConditionalExpression(expr)) {
                  return t.conditionalExpression(expr.test, visit(expr.consequent), visit(expr.alternate));
                }
                return expr;
              };
              path.node.argument = visit(arg);
            }
          },
        }
      : {}),
  });
};

const prefixTsSource = (code, filename = 'file.ts', { prefixReturns = false } = {}) => {
  let parsed;
  try {
    parsed = babel.parseSync(code, {
      filename,
      configFile: false,
      babelrc: false,
      parserOpts: {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      },
    });
  } catch {
    return code;
  }
  if (!parsed) {
    return code;
  }
  prefixTsAst(parsed, { prefixReturns });
  const generated = babel.transformFromAstSync(parsed, code, {
    filename,
    configFile: false,
    babelrc: false,
    retainLines: true,
    compact: false,
  });
  return generated?.code ?? code;
};

const prefixVueSource = (code) => {
  let cursor = 0;
  let result = '';
  while (cursor < code.length) {
    const start = code.indexOf('<template', cursor);
    if (start < 0) {
      result += code.slice(cursor);
      break;
    }
    result += code.slice(cursor, start);
    const openEnd = code.indexOf('>', start);
    if (openEnd < 0) {
      result += code.slice(start);
      break;
    }
    let depth = 1;
    let scan = openEnd + 1;
    while (scan < code.length && depth > 0) {
      const nextOpen = code.indexOf('<template', scan);
      const nextClose = code.indexOf('</template>', scan);
      if (nextClose < 0) {
        break;
      }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        scan = nextOpen + '<template'.length;
      } else {
        depth -= 1;
        if (depth === 0) {
          const inner = code.slice(openEnd + 1, nextClose);
          result += code.slice(start, openEnd + 1);
          result += prefixTemplate(inner);
          result += '</template>';
          cursor = nextClose + '</template>'.length;
          break;
        }
        scan = nextClose + '</template>'.length;
      }
    }
    if (depth !== 0) {
      result += code.slice(start);
      break;
    }
  }

  // Классы, собранные в <script> (return 'bg-void-bg-3', computed).
  result = result.replace(/<script(\b[^>]*)>([\s\S]*?)<\/script>/g, (full, attrs, scriptBody) => {
    const lang = /lang\s*=\s*["']tsx?["']/.test(attrs) || /lang\s*=\s*["']js["']/.test(attrs);
    if (!lang && !attrs.includes('setup')) {
      // всё равно пробуем — script setup без lang
    }
    const next = prefixTsSource(scriptBody, 'script.ts', { prefixReturns: true });
    return `<script${attrs}>${next}</script>`;
  });

  return result;
};

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (entry.name.endsWith('.vue')) {
      const source = fs.readFileSync(full, 'utf8');
      fs.writeFileSync(full, prefixVueSource(source));
      continue;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      const source = fs.readFileSync(full, 'utf8');
      fs.writeFileSync(full, prefixTsSource(source, entry.name));
    }
  }
};

export { prefixVueSource, prefixTsSource, walk };
