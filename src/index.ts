/**
 * Magic that recovers the TypeScript AST of a caller.
 *
 * Source-map support, and access to the caller's source code at the location where the
 * source maps point is _required_ for correct functionality.
 *
 * It is recommended to use the same version of TypeScript as is used in AST Alchemy by
 * importing it from the alchemy package:
 *
 * ```typescript
 * import alchemy, { ts } from "ast-alchemy";
 * ```
 *
 * @remarks
 * In principle, this library is meant to be used as part of domain-specific languages (DSLs)
 * that have a mixed-declaration-and-code component. This library can be used to recover the
 * way that a specific piece of syntax appeared in the user's source file. This can be used
 * to embed strongly-typed fragments of the user's code in output.
 *
 * @example
 * ```typescript
 * import alchemy from "ast-alchemy";
 *
 * export function myLibraryFunction(handler: () => void) {
 *   const [handlerAst] = alchemy();
 *
 *   // handlerAst now refers to an instance of ts.Syntax
 * }
 * ```
 *
 * @packageDocumentation
 */

import ts from "typescript";

import * as fs from "fs";
import * as os from "os";

import { promisify } from "util";

const readFile = promisify(fs.readFile);

interface CallSite {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

export class AlchemyError extends Error {
  private site: Partial<CallSite> | undefined;
  constructor(message: string, site?: Partial<CallSite>) {
    super(message);
    this.site = site;
  }

  public toString(): string {
    return `${this.name}: ${this.message}${
      this.site &&
      ` (Alchemy context ${this.site.fileName}:${this.site.lineNumber}:${this.site.columnNumber})`
    }`;
  }
}

function parseStackTraceLines(stack: string[]): Partial<CallSite>[] {
  return stack.map((s) => {
    const [dirtyFN, line, dirtyCol] = s.split(":").slice(-3);

    if (line === undefined || dirtyCol === undefined) {
      return {};
    }

    return {
      fileName: dirtyFN.replace(/^.*\(/, "").replace(/^\s*at\s*/, ""),
      lineNumber: parseInt(line),
      columnNumber: parseInt(dirtyCol.split(")")[0]),
    };
  });
}

function getNthUniqueName(n: number, stack: Partial<CallSite>[]): CallSite {
  let caller = stack[0];
  let count = 1;

  for (const s of stack) {
    if (s.fileName !== caller.fileName) {
      count += 1;
      caller = s;
    }

    if (count >= n) {
      break;
    }
  }

  if (
    count < 3 ||
    caller.fileName === undefined ||
    caller.lineNumber === undefined ||
    caller.columnNumber === undefined
  ) {
    throw new AlchemyError(
      `Error creating Alchemy context (count=${count})`,
      caller
    );
  }

  return caller as CallSite;
}

function scanMatchingParens(scanner: ts.Scanner): number {
  let count: number = 0;
  let token;

  while (count < 1) {
    // Scan until we hit an open paren
    token = scanner.scan();
    if (token === ts.SyntaxKind.OpenParenToken) {
      count += 1;
    }
  }

  // This algorithm sucks
  while ((token = scanner.scan())) {
    switch (token) {
      case ts.SyntaxKind.OpenParenToken:
        count += 1;
        break;
      case ts.SyntaxKind.CloseParenToken:
        count -= 1;
        break;
    }

    if (count === 0) {
      // We have a matched sequence. The expression is fulfilled.
      break;
    }
  }
  return scanner.getTokenPos();
}

/**
 * Options for customizing the AST Alchemy interface
 */
export interface AlchemyOptions {
  /**
   * Which TypeScript ScriptTarget (i.e. ES5, ES6, ES2020, etc.) to use when
   * performing introspective parsing. This has subtle effects on which
   * constructs are allowable.
   *
   * Default: ESNext (generally the most permissive)
   *
   * @default ts.ScriptTarget.ESNext
   */
  introspectionScriptTarget: ts.ScriptTarget;

  /**
   * Permit JSX in call introspection
   *
   * @default false
   */
  jsx: boolean;
}

const defaultAlchemyOptions: AlchemyOptions = {
  introspectionScriptTarget: ts.ScriptTarget.ESNext,
  jsx: false,
};

/**
 * Information about the syntactic form of the call.
 */
export interface AlchemyResponse {
  /**
   * The AST of the Call Expression that resulted in the current execution.
   */
  expr: ts.CallExpression;
  /**
   * The virtual source file used in parsing `expr`.
   *
   * This is useful for getting expression text and other methods in the TypeScript
   * API that may require a SourceFile instance.
   */
  sourceFile: ts.SourceFile;
}

export function createAlchemy(alchemyOptions?: Partial<AlchemyOptions>) {
  const options: AlchemyOptions = {
    ...defaultAlchemyOptions,
    ...(alchemyOptions ?? {}),
  };

  function getCaller(depth: number): CallSite {
    // The relevant stack could be deeper than Node/V8s's default
    const savedStackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = Infinity;

    const stack = parseStackTraceLines(
      new Error().stack?.split(os.EOL).slice(1) ?? []
    );

    const caller = getNthUniqueName(
      depth,
      stack.filter((s) => s.fileName !== undefined) as Partial<CallSite>[]
    );

    if (!caller.fileName || !caller.lineNumber || !caller.columnNumber) {
      throw new Error("Could not locate a caller.");
    }

    Error.stackTraceLimit = savedStackTraceLimit;

    return caller;
  }

  /**
   * Little helper to extract the relevant portion of the file for
   * the scanner.
   *
   * @param callSite The CallSite to open and read
   */
  async function readFragmentToString(callSite: CallSite): Promise<string> {
    const content = (await readFile(callSite.fileName)).toString("utf-8");
    const lines = content.split(os.EOL);

    const relevantLines = lines.slice(callSite.lineNumber - 1);
    return relevantLines.join(os.EOL);
  }

  return async function getCallerSyntaxForm(
    depth: number = 3
  ): Promise<AlchemyResponse> {
    const caller = getCaller(depth);

    const text = await readFragmentToString(caller);

    const scanner = ts.createScanner(
      options.introspectionScriptTarget,
      /* skipTrivia */ true,
      /* variant */ options.jsx
        ? ts.LanguageVariant.JSX
        : ts.LanguageVariant.Standard,
      /* textInitial */ undefined,
      /* onError */ undefined,
      /* start */ undefined,
      /* length */ undefined
    );

    scanner.setText(text, caller.columnNumber - 1);

    const endIndex = scanMatchingParens(scanner);

    const expressionText = text.slice(caller.columnNumber - 1, endIndex + 1);

    const tree = ts.createSourceFile(
      "virtual.ts",
      expressionText,
      options.introspectionScriptTarget,
      /* setParentNodes */ false,
      options.jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    // So much assertion, but since we recovered tokens from a CallExpression,
    // we know exactly what the shape of this object will be
    const expr = (tree.statements[0] as ts.ExpressionStatement).expression;

    if (!ts.isCallExpression(expr)) {
      throw new AlchemyError(
        "Expected to find a call expression in stack trace position."
      );
    }

    return {
      expr,
      sourceFile: tree,
    };
  };
}

export const defaultAlchemy = createAlchemy();

export { ts };

export default defaultAlchemy;
