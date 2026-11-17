import * as ts from 'typescript';
import { FileKind } from '../../domain/coverage/file-coverage';

/** `parseDiagnostics` is populated by the parser but not part of the public typings. */
type ParsedSourceFile = ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] };

/**
 * Detects re-export-only ("barrel") files with the TypeScript parser (no type checking, no I/O).
 *
 * A file is `re-export-only` when it has at least one statement and every top-level statement is an
 * export-from declaration: `export * from`, `export * as x from`, `export { a, b as c } from`,
 * `export type { T } from`. Comments and blank lines are trivia and ignored. An empty or comment-only file is a
 * `module` (it re-exports nothing). Anything unparsable falls back to `module`, so a classifier mistake can only
 * ever keep a file as a candidate, never hide one.
 */
export class SourceFileClassifier {
  classify(fileName: string, content: string): FileKind {
    try {
      const source = ts.createSourceFile(
        fileName,
        content,
        ts.ScriptTarget.Latest,
        false,
        fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ) as ParsedSourceFile;
      if ((source.parseDiagnostics?.length ?? 0) > 0 || source.statements.length === 0) {
        return 'module';
      }
      return source.statements.every(isExportFrom) ? 're-export-only' : 'module';
    } catch {
      return 'module';
    }
  }
}

function isExportFrom(statement: ts.Statement): boolean {
  return ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined;
}
