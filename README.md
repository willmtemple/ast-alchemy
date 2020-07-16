# ast-alchemy - Expression Trees for TypeScript

*Dark magic that allows libraries to process caller ASTs*

__Warning ⚠️__: This library is not stable and has no ordinary utility. It is
intended to be used in a very specific, small set of TypeScript libraries, and
it is sensitive to small changes in environment. Use at your own peril.

```typescript
import alchemy, { ts } from "ast-alchemy";

/**
 * Prints the body of its argument.
 */
export async function printFunctionBody(_h: () => void) {
  // Get the AST of the value that was passed in for `h`
  const {
    sourceFile,
    expr: {
      // Destructure the arguments of the call
      arguments: [ handlerAst ]
    }
  } = await alchemy();

  // Check to make sure the argument had the syntactic shape we expect
  if (!ts.isArrowFunction(handler) || !ts.isBlock(handler.body)) {
    throw new Error("Expected an arrow function with a block body!");
  }

  const { body } = handler;

  console.log("Argument body:");

  for (const statement of body.statements) {
    console.log(">", statement.getText(sourceFile));
  }
}
```

## About

This little library was inspired by [C# Expression Trees][expressiontree].
Being able to recover the syntactic form of an argument allows libraries to do
a variety of funky (and powerful) transformations on that AST. In general, it
is useful for codegen.

Originally, I envisioned this library as a mechanism for building DSLs that are
embedded into TypeScript that have a code component (e.g. a Parser Generator),
where the DSL would be used to generate some compiler output that would contain
the code the user originally wrote into the DSL program.

So, if a user writes the following code:

```typescript
import { printFunctionBody } from "my-library";

await printFunctionBody(() => {
  console.log("Hello world!");
});
```

The `printFunctionBody` function can access the exact syntactic form of its
function argument, and (in the example above), print it. It can do any kind
of processing/manipulation of this function that it could do on any other kind
of data.

However, the technical mechanisms available in TypeScript lead to this library
having some serious technical limitations (explained below). I nonetheless
decided to publish it.

### Alternatives that you should consider instead

- Not doing this thing in the first place
  - If you're here you might have already considered this
- `Function.toString`
  - If you only need to analyze/transpile the behavior of a function, the JavaScript source will do,
    but ast-alchemy can provide the strongly-typed original TypeScript AST.
  - `Function.toString` won't force you to require your users to pass literals to your API, whereas
    ast-alchemy is sensitive to the _exact_ syntactic form that was typed into the argument
    position of the call.
- Writing a proper compiler/preprocessor

### Limitations

There are many limitations of the current implementation, almost all of which revolve around source code.

1. The original source code __MUST__ be available on disk. This library does
   not support inline source maps, and it opens and reads the source file
   during execution.
2. If compiling TypeScript code, source map support __MUST__ be enabled in
   the caller.
3. Consumers __SHOULD__ use the same version of TypeScript that the Alchemy
   library uses, to ensure compatibility (ast-alchemy exports its copy of
   the TypeScript API as `ts` for library authors' use).

For reasons 1 & 2, it is recommended that scripts that are the ultimate
consumers of ast-alchmey (e.g. DSL files) are invoked using `ts-node`, as it
will automatically handle both concerns.

## How it works

The code for this library is surprisingly simple, if a bit finnicky and subject to breakage. The basic
process for recovering the caller's AST from a library function is:

1. Create an `Error` instance and retrieve a stack trace.
2. Crawl the stack trace until the first library caller (calculated using a depth
   parameter that defaults to `3`) is reached.
3. Use the stack trace to determine the position of the call in the source file.
4. Read the source file on disk into memory (thus, the limitations in the section above)
5. Create an instance of the TypeScript lexer/parser and begin parsing from the position
   of the call until a full expression is parsed.
6. Return the expression.

## License

This project is licensed for use under the MIT license.

Copyright 2020 Will Temple

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

<!-- Links -->
[expressiontree]: https://github.com/dotnet/csharplang/blob/master/spec/types.md#expression-tree-types

