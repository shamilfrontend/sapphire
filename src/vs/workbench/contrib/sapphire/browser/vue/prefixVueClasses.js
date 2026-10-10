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
  return result;
};

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.vue')) {
      continue;
    }
    const source = fs.readFileSync(full, 'utf8');
    fs.writeFileSync(full, prefixVueSource(source));
  }
};

export { prefixVueSource, walk };
