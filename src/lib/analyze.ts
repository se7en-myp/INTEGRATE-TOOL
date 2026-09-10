import ts from 'typescript';
import type { SourceInfo } from '../types.js';
import { isPrivilegedSupabaseKey } from './providers.js';
export function analyzeSource(file: string, text: string): SourceInfo {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const result: SourceInfo = { path: file, client: false, serverOnly: false, serverAction: false,
    imports: [], resolvedImports: [], env: [], dynamicEnv: false, supabase: [], ai: false, aiRequest: false, hardcodedSecretLines: [] };
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === 'use client') result.client = true;
    if (statement.expression.text === 'use server') result.serverAction = true;
  }
  const line = (node: ts.Node): number => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
  const envObject = (node: ts.Node): boolean =>
    (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'process' && node.name.text === 'env') ||
    (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'process' && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'env');
  const addImport = (name: string): void => {
    result.imports.push(name);
    if (name === 'server-only') result.serverOnly = true;
    if (/^(openai|@ai-sdk\/(openai|openai-compatible)|@openrouter\/)/.test(name)) result.ai = true;
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
      const onlyInlineTypes = bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) && bindings.elements.length > 0 &&
        bindings.elements.every(element => element.isTypeOnly) && !(ts.isImportDeclaration(node) && node.importClause?.name);
      if (!onlyInlineTypes && !(ts.isExportDeclaration(node) && node.isTypeOnly) && !(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)) addImport(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === 'require')) {
      const arg = node.arguments[0]; if (arg && ts.isStringLiteral(arg)) addImport(arg.text);
    }
    if (ts.isPropertyAccessExpression(node) && envObject(node.expression)) result.env.push({ key: node.name.text, file, line: line(node) });
    if (ts.isElementAccessExpression(node) && envObject(node.expression)) {
      if (ts.isStringLiteral(node.argumentExpression)) result.env.push({ key: node.argumentExpression.text, file, line: line(node) });
      else result.dynamicEnv = true;
    }
    if (ts.isVariableDeclaration(node) && node.initializer && envObject(node.initializer)) {
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (element.dotDotDotToken) { result.dynamicEnv = true; continue; }
          const key = element.propertyName ?? element.name;
          if (ts.isIdentifier(key) || ts.isStringLiteral(key)) result.env.push({ key: key.text, file, line: line(element) });
        }
      } else result.dynamicEnv = true;
    }
    if (ts.isStringLiteralLike(node)) {
      if (isPrivilegedSupabaseKey(node.text)) result.hardcodedSecretLines.push(line(node));
      if (/^(?:sk-[A-Za-z0-9_-]{8,}|nvapi-[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]{8,})$/.test(node.text)) result.hardcodedSecretLines.push(line(node));
      if (/api\.openai\.com|openrouter\.ai\/api|integrate\.api\.nvidia\.com/.test(node.text)) { result.ai = true; result.aiRequest = true; }
      if (ts.isPropertyAssignment(node.parent) && /^(apiKey|api_key|Authorization)$/i.test(node.parent.name.getText(ast).replace(/['"]/g, '')) && node.text.length > 8) result.hardcodedSecretLines.push(line(node));
    }
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(ast);
      if (/\.(?:chat\.completions\.create|responses\.create)$/.test(name) || /^(?:generateText|streamText)$/.test(name)) { result.ai = true; result.aiRequest = true; }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  // Resolve renamed Supabase factory imports before inspecting calls.
  const factories = new Map<string, 'browser' | 'server' | 'shared'>();
  const namespaces = new Set<string>();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('@supabase/')) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) for (const specifier of bindings.elements) {
      const original = (specifier.propertyName ?? specifier.name).text;
      const kind = /createBrowser|createClientComponent/.test(original) ? 'browser' : /createServer|createRouteHandler|createMiddleware/.test(original) ? 'server' : original === 'createClient' ? 'shared' : null;
      if (kind) factories.set(specifier.name.text, kind);
    }
  }
  const calls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const property = ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && namespaces.has(expression.expression.text) ? expression.name.text : '';
      const kind = factories.get(expression.getText(ast)) ?? (property === 'createBrowserClient' ? 'browser' : property === 'createServerClient' ? 'server' : property === 'createClient' ? 'shared' : undefined);
      if (kind && !result.supabase.includes(kind)) result.supabase.push(kind);
    }
    ts.forEachChild(node, calls);
  };
  calls(ast);
  result.hardcodedSecretLines = [...new Set(result.hardcodedSecretLines)];
  return result;
}
